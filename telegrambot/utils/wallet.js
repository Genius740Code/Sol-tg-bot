const { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { encrypt, decrypt } = require('./encryption');
const axios = require('axios');
const { logger } = require('../src/database');
const { WALLET, API, RATE_LIMIT } = require('../../config/constants');
const { resilientRequest, getPriceWithFallbacks } = require('./apiUtils');
const config = require('../../config/config');

// Generate a new Solana wallet
const generateWallet = async () => {
  try {
    // Generate a random mnemonic (seed phrase)
    const mnemonic = bip39.generateMnemonic();
    
    // Derive the seed from the mnemonic
    const seed = await bip39.mnemonicToSeed(mnemonic);
    
    // Derive the ed25519 key using the seed
    const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.slice(0, 32)).key;
    
    // Create a keypair from the derived seed
    const keypair = Keypair.fromSeed(derivedSeed);
    
    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: Buffer.from(keypair.secretKey).toString('hex'),
      mnemonic
    };
  } catch (error) {
    logger.error('Error generating wallet:', error);
    throw new Error('Failed to generate wallet');
  }
};

// Import wallet from private key or mnemonic
const importWalletFromPrivateKey = async (privateKeyOrMnemonic) => {
  try {
    let keypair;
    let mnemonic = null;
    
    // Check if input is a mnemonic phrase (usually 12 or 24 words)
    if (privateKeyOrMnemonic.includes(' ') && bip39.validateMnemonic(privateKeyOrMnemonic)) {
      // It's a mnemonic - derive the keypair
      mnemonic = privateKeyOrMnemonic;
      const seed = await bip39.mnemonicToSeed(mnemonic);
      const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.slice(0, 32)).key;
      keypair = Keypair.fromSeed(derivedSeed);
    } else {
      // Assume it's a private key
      // Check if it's in hex format (64 bytes = 128 hex chars)
      const secretKey = privateKeyOrMnemonic.length === 128 
        ? Buffer.from(privateKeyOrMnemonic, 'hex') 
        : Buffer.from(privateKeyOrMnemonic, 'base58');
        
      keypair = Keypair.fromSecretKey(secretKey);
    }
    
    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: Buffer.from(keypair.secretKey).toString('hex'),
      mnemonic
    };
  } catch (error) {
    logger.error('Error importing wallet:', error);
    throw new Error('Failed to import wallet: Invalid private key or mnemonic');
  }
};

// Rate limiting cache
const rateLimitCache = new Map();

/**
 * Checks if a user is rate limited
 * @param {string|number} userId - The user's Telegram ID
 * @returns {boolean} - Whether the user is rate limited
 */
const isRateLimited = (userId) => {
  const now = Date.now();
  const userKey = `${userId}`;
  
  if (!rateLimitCache.has(userKey)) {
    rateLimitCache.set(userKey, {
      count: 1,
      lastRequest: now,
      blocked: false,
      blockedUntil: 0
    });
    return false;
  }
  
  const userState = rateLimitCache.get(userKey);
  
  // If blocked and still in cooldown period
  if (userState.blocked && now < userState.blockedUntil) {
    return true;
  }
  
  // Reset block if cooldown has passed
  if (userState.blocked && now >= userState.blockedUntil) {
    userState.blocked = false;
    userState.count = 1;
    userState.lastRequest = now;
    return false;
  }
  
  // If window has passed, reset count
  if (now - userState.lastRequest > RATE_LIMIT.WINDOW_MS) {
    userState.count = 1;
    userState.lastRequest = now;
    return false;
  }
  
  // Increment count and check if rate limit exceeded
  userState.count++;
  userState.lastRequest = now;
  
  if (userState.count > RATE_LIMIT.MAX_REQUESTS) {
    userState.blocked = true;
    userState.blockedUntil = now + RATE_LIMIT.COOLDOWN_MS;
    return true;
  }
  
  return false;
};

// Cache for price data to reduce API calls
const priceCache = {
  sol: {
    price: null,
    lastUpdated: 0
  },
  tokens: new Map() // tokenAddress -> {price, lastUpdated}
};

// Cache TTL in milliseconds - Optimized values
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes for normal cache (was 1 minute)
const LONG_CACHE_TTL = 15 * 60 * 1000; // 15 minutes for fallback (was 5 minutes)
const ULTRA_LONG_CACHE_TTL = 60 * 60 * 1000; // 1 hour for extreme fallback

// Connection pool for Solana RPC
const connectionPool = {
  connections: [],
  maxConnections: 5,
  currentIndex: 0,
  endpoints: [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
    'https://solana-mainnet.g.alchemy.com/v2/demo',
    'https://solana.public-rpc.com',
    'https://mainnet.rpcpool.com',
    'https://mainnet.solana.com',
    'https://solana.rpcpool.com',
    'https://api.solscan.io/rpc',
    'https://solana-api.tt-prod.net'  // Fixed truncated endpoint
  ],
  // Track failed endpoints to avoid retrying them too often
  failedEndpoints: new Map(),
  getConnection() {
    if (this.connections.length < this.maxConnections) {
      // Create new connection if pool not full
      // Filter out recently failed endpoints
      const now = Date.now();
      const availableEndpoints = this.endpoints.filter(endpoint => {
        const failedInfo = this.failedEndpoints.get(endpoint);
        return !failedInfo || (now - failedInfo.timestamp > 30000); // 30 seconds cooldown
      });
      
      // If all endpoints are in cooldown, use the oldest failed one
      const endpoint = availableEndpoints.length > 0 
        ? availableEndpoints[this.connections.length % availableEndpoints.length]
        : Array.from(this.failedEndpoints.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0] || this.endpoints[0];
      
      try {
        const connection = new Connection(endpoint, 'confirmed');
        this.connections.push({
          connection,
          endpoint,
          lastUsed: Date.now(),
          failures: 0
        });
        return connection;
      } catch (error) {
        // If creating connection fails, mark endpoint as failed
        this.markEndpointFailed(endpoint, error);
        
        // Try another endpoint as fallback
        const fallbackEndpoint = this.endpoints.find(ep => ep !== endpoint && !this.failedEndpoints.has(ep));
        if (fallbackEndpoint) {
          try {
            const fallbackConnection = new Connection(fallbackEndpoint, 'confirmed');
            this.connections.push({
              connection: fallbackConnection,
              endpoint: fallbackEndpoint,
              lastUsed: Date.now(),
              failures: 0
            });
            return fallbackConnection;
          } catch (fallbackError) {
            logger.error(`Failed to create connection with fallback endpoint: ${fallbackError.message}`);
            // Return a default connection to the first endpoint as last resort
            const defaultConnection = new Connection(this.endpoints[0], 'confirmed');
            this.connections.push({
              connection: defaultConnection,
              endpoint: this.endpoints[0],
              lastUsed: Date.now(),
              failures: 0
            });
            return defaultConnection;
          }
        }
      }
    }
    
    // Find the connection with the fewest failures and oldest usage
    this.connections.sort((a, b) => {
      if (a.failures !== b.failures) {
        return a.failures - b.failures;
      }
      return a.lastUsed - b.lastUsed;
    });
    
    const connectionData = this.connections[0];
    connectionData.lastUsed = Date.now();
    return connectionData.connection;
  },
  
  // Mark an endpoint as failed to avoid retrying it immediately
  markEndpointFailed(endpoint, error) {
    logger.warn(`RPC endpoint ${endpoint} failed: ${error.message}`);
    this.failedEndpoints.set(endpoint, {
      timestamp: Date.now(),
      error: error.message
    });
    
    // Update failure count for the connection
    const connectionIndex = this.connections.findIndex(c => c.endpoint === endpoint);
    if (connectionIndex >= 0) {
      this.connections[connectionIndex].failures++;
      
      // If too many failures, remove the connection
      if (this.connections[connectionIndex].failures > 5) {
        this.connections.splice(connectionIndex, 1);
      }
    }
    
    // If all endpoints are failing, clear the oldest failure to retry
    if (this.failedEndpoints.size >= this.endpoints.length) {
      // Find the oldest failed endpoint
      const oldestEntry = Array.from(this.failedEndpoints.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      
      if (oldestEntry) {
        this.failedEndpoints.delete(oldestEntry[0]);
      }
    }
  },
  
  // Reset the failure count for an endpoint that works
  markEndpointSuccess(endpoint) {
    this.failedEndpoints.delete(endpoint);
    
    // Reset failure count for the connection
    const connectionIndex = this.connections.findIndex(c => c.endpoint === endpoint);
    if (connectionIndex >= 0) {
      this.connections[connectionIndex].failures = 0;
    }
  }
};

/**
 * Get SOL price with caching to handle rate limits - Optimized with new API utils
 * @returns {Promise<number>} SOL price in USD
 */
const getSolPrice = async () => {
  // Check cache first
  const now = Date.now();
  if (priceCache.sol.price && now - priceCache.sol.lastUpdated < CACHE_TTL) {
    return priceCache.sol.price;
  }
  
  try {
    // Use the new utility for resilient price fetching
    const price = await getPriceWithFallbacks('SOL', 'sol');
    
    if (price > 0) {
      // Cache the result
      priceCache.sol = { price, lastUpdated: now };
      return price;
    }
    
    // If we get here, all APIs failed but the utility returned 0
    // Try to use cache even if expired
    if (priceCache.sol.price && now - priceCache.sol.lastUpdated < ULTRA_LONG_CACHE_TTL) {
      logger.warn(`Using cached SOL price (extended fallback): $${priceCache.sol.price}`);
      return priceCache.sol.price;
    }
    
    // Last resort, return default price
    return WALLET.DEFAULT_SOL_PRICE;
  } catch (error) {
    logger.error(`Error in getSolPrice: ${error.message}`);
    
    // Try to use cache even if expired
    if (priceCache.sol.price) {
      logger.warn(`Using cached SOL price after error: $${priceCache.sol.price}`);
      return priceCache.sol.price;
    }
    
    return WALLET.DEFAULT_SOL_PRICE;
  }
};

/**
 * Get SOL balance for a wallet - Optimized with connection pooling
 * @param {string} address - Wallet address
 * @returns {Promise<number>} - SOL balance
 */
const getSolBalance = async (address) => {
  // Validate address to prevent errors
  if (!address || address === 'Wallet not available') {
    return WALLET.DEFAULT_SOL_BALANCE;
  }
  
  // Use connection pool to distribute load
  const connection = connectionPool.getConnection();
  let usedEndpoint = '';
  
  try {
    // Find the endpoint used by this connection
    for (const connData of connectionPool.connections) {
      if (connData.connection === connection) {
        usedEndpoint = connData.endpoint;
        break;
      }
    }
    
    const publicKey = new PublicKey(address);
    const balance = await connection.getBalance(publicKey);
    
    // Mark the endpoint as successful
    if (usedEndpoint) {
      connectionPool.markEndpointSuccess(usedEndpoint);
    }
    
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    // Mark the endpoint as failed
    if (usedEndpoint) {
      connectionPool.markEndpointFailed(usedEndpoint, error);
    }
    
    logger.warn(`Error fetching balance with primary connection: ${error.message}, trying backup`);
    
    // Try multiple backup endpoints in sequence
    const backupEndpoints = [
      'https://api.mainnet-beta.solana.com',
      'https://solana.api.mango.com',
      'https://rpc.hellomoon.io',
      'https://rpc.ankr.com/solana'
    ];
    
    // Try each backup endpoint
    for (const backupEndpoint of backupEndpoints) {
      try {
        const backupConnection = new Connection(backupEndpoint, 'confirmed');
        const balance = await backupConnection.getBalance(new PublicKey(address));
        return balance / LAMPORTS_PER_SOL;
      } catch (backupError) {
        logger.warn(`Backup endpoint ${backupEndpoint} failed: ${backupError.message}`);
        // Continue to next backup endpoint
      }
    }
    
    // All backups failed, log error and return default balance
    logger.error(`All RPC endpoints failed for ${address}: ${error.message}`);
    return WALLET.DEFAULT_SOL_BALANCE;
  }
};

// Get token information from Helius
const getTokenInfo = async (tokenAddress) => {
  try {
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) throw new Error('Helius API key not found');
    
    const endpoint = `https://api.helius.xyz/v0/tokens/metadata?api-key=${heliusApiKey}`;
    const response = await axios.post(endpoint, { 
      mintAccounts: [tokenAddress]
    });
    
    if (response.data && response.data.length > 0) {
      return response.data[0];
    } else {
      throw new Error('Token not found');
    }
  } catch (error) {
    logger.error('Error getting token info:', error);
    throw new Error('Failed to get token information');
  }
};

/**
 * Get token price with caching and improved error handling using new API utils
 * @param {string} tokenAddress - Token mint address
 * @returns {Promise<object>} - Price and token info
 */
const getTokenPrice = async (tokenAddress) => {
  // Check cache first
  const now = Date.now();
  if (priceCache.tokens.has(tokenAddress)) {
    const cachedData = priceCache.tokens.get(tokenAddress);
    if (now - cachedData.lastUpdated < CACHE_TTL) {
      return cachedData.data;
    }
  }
  
  try {
    // Get token info
    const tokenInfo = await getTokenInfo(tokenAddress);
    
    // Use the new utility for resilient price fetching
    const price = await getPriceWithFallbacks(tokenAddress, 'token');
    
    // Prepare result
    const result = {
      price,
      marketCap: 0, // Not reliably available from all APIs
      liquidity: 0, // Not reliably available from all APIs
      tokenInfo
    };
    
    // Cache the result
    priceCache.tokens.set(tokenAddress, {
      data: result,
      lastUpdated: now
    });
    
    return result;
  } catch (error) {
    logger.error(`Failed to get token info and price: ${error.message}`);
    
    // If cache exists, use it even if expired
    if (priceCache.tokens.has(tokenAddress)) {
      const cachedData = priceCache.tokens.get(tokenAddress);
      logger.info(`Using expired cache for token ${tokenAddress} due to API failures`);
      return cachedData.data;
    }
    
    // Try to get just token info without price
    try {
      const tokenInfo = await getTokenInfo(tokenAddress);
      return {
        price: 0,
        marketCap: 0,
        liquidity: 0,
        tokenInfo
      };
    } catch (infoError) {
      logger.error(`Failed to get even basic token info: ${infoError.message}`);
      throw error; // Rethrow the original error
    }
  }
};

// Check if user wallet is properly structured and fix it if needed
const checkAndRepairUserWallet = async (user) => {
  try {
    // If no wallets array or empty array
    if (!user.wallets || user.wallets.length === 0) {
      // Create wallet array using walletAddress if available
      if (user.walletAddress) {
        user.wallets = [{
          name: 'Wallet 1',
          address: user.walletAddress,
          encryptedPrivateKey: user.encryptedPrivateKey || encrypt('placeholder-key'),
          mnemonic: user.mnemonic || '',
          isActive: true
        }];
        await user.save();
        logger.info(`Created wallets array for user: ${user.telegramId}`);
        return true;
      } else {
        // Generate new wallet if none exists
        try {
          const wallet = await generateWallet();
          user.walletAddress = wallet.publicKey;
          user.wallets = [{
            name: 'Main Wallet',
            address: wallet.publicKey,
            encryptedPrivateKey: encrypt(wallet.privateKey),
            mnemonic: wallet.mnemonic,
            isActive: true
          }];
          user.encryptedPrivateKey = encrypt(wallet.privateKey);
          user.mnemonic = wallet.mnemonic;
          await user.save();
          logger.info(`Generated new wallet for user: ${user.telegramId}`);
          return true;
        } catch (walletError) {
          logger.error(`Error generating wallet: ${walletError.message}`);
          // Create a placeholder entry to prevent repeated failures
          const placeholderWallet = {
            publicKey: "placeholder-address-" + Math.random().toString(36).substring(2, 10),
            privateKey: "placeholder-key-" + Math.random().toString(36).substring(2, 10),
            mnemonic: "placeholder mnemonic"
          };
          user.walletAddress = placeholderWallet.publicKey;
          user.wallets = [{
            name: 'Temporary Wallet',
            address: placeholderWallet.publicKey,
            encryptedPrivateKey: encrypt(placeholderWallet.privateKey),
            mnemonic: placeholderWallet.mnemonic,
            isActive: true
          }];
          user.encryptedPrivateKey = encrypt(placeholderWallet.privateKey);
          user.mnemonic = placeholderWallet.mnemonic;
          await user.save();
          logger.info(`Created placeholder wallet for user: ${user.telegramId}`);
          return true;
        }
      }
    }
    
    // Check if wallets need encryptedPrivateKey/mnemonic fields
    let needsSave = false;
    user.wallets.forEach(wallet => {
      if (!wallet.encryptedPrivateKey) {
        wallet.encryptedPrivateKey = user.encryptedPrivateKey || encrypt('placeholder-key');
        needsSave = true;
      }
      if (!wallet.mnemonic && user.mnemonic) {
        wallet.mnemonic = user.mnemonic;
        needsSave = true;
      }
    });
    
    // Check if any wallet is marked as active
    const hasActiveWallet = user.wallets.some(w => w.isActive);
    if (!hasActiveWallet && user.wallets.length > 0) {
      // Set the first wallet as active
      user.wallets[0].isActive = true;
      needsSave = true;
    }
    
    if (needsSave) {
      await user.save();
      logger.info(`Updated wallet data for user: ${user.telegramId}`);
      return true;
    }
    
    // Add getActiveWallet method if not exists
    if (!user.getActiveWallet) {
      user.getActiveWallet = function() {
        return this.wallets.find(wallet => wallet.isActive) || this.wallets[0];
      };
    }
    
    return false; // No repairs needed
  } catch (error) {
    logger.error(`Error checking/repairing user wallet: ${error.message}`);
    return false;
  }
};

module.exports = {
  generateWallet,
  importWalletFromPrivateKey,
  getSolBalance,
  getSolPrice,
  getTokenInfo,
  getTokenPrice,
  isRateLimited,
  checkAndRepairUserWallet
}; 