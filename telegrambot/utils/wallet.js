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
    lastUpdated: 0,
    isFetching: false
  },
  tokens: new Map() // tokenAddress -> {price, lastUpdated}
};

// Cache for wallet balances
const balanceCache = new Map(); // walletAddress -> {balance, timestamp}
const BALANCE_CACHE_TTL = 30 * 1000; // 30 seconds for balance cache

// Cache TTL in milliseconds - Optimized values
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes for normal cache (was 1 minute)
const LONG_CACHE_TTL = 15 * 60 * 1000; // 15 minutes for fallback (was 5 minutes)
const ULTRA_LONG_CACHE_TTL = 60 * 60 * 1000; // 1 hour for extreme fallback

// Connection pool for Solana RPC
const connectionPool = {
  connections: [],
  maxConnections: 3, // Reduced from 5
  currentIndex: 0,
  endpoints: [
    'https://api.mainnet-beta.solana.com',
    'https://solana.public-rpc.com',
    'https://api.solanamainnet.chainstacklabs.com',
    'https://mainnet.solana-api.com'
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
 * Get SOL price with optimization to use Helius as primary source
 * @returns {Promise<number>} SOL price in USD
 */
const getSolPrice = async () => {
  // Check cache first with shorter check for even faster responses
  const now = Date.now();
  if (priceCache.sol.price && now - priceCache.sol.lastUpdated < CACHE_TTL) {
    return priceCache.sol.price;
  }
  
  // Use the most recent price as a fallback while fetching fresh price
  const cachedPrice = priceCache.sol.price || WALLET.DEFAULT_SOL_PRICE;
  
  // Start fetching in background if this is called frequently
  if (priceCache.sol.isFetching) {
    return cachedPrice;
  }
  
  // Set fetching flag to prevent multiple parallel requests
  priceCache.sol.isFetching = true;
  
  try {
    // First try to get from Helius (fastest source)
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (heliusApiKey) {
      try {
        const endpoint = `https://api.helius.xyz/v0/token-price?api-key=${heliusApiKey}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s timeout
        
        const response = await axios.post(endpoint, { 
          mintAccounts: ['So11111111111111111111111111111111111111112'] // Native SOL
        }, { 
          signal: controller.signal,
          timeout: 1500 // Also set axios timeout
        });
        
        clearTimeout(timeoutId);
        
        if (response.data && response.data.length > 0 && response.data[0].price > 0) {
          const price = response.data[0].price;
          // Cache the result
          priceCache.sol = { 
            price, 
            lastUpdated: now,
            isFetching: false
          };
          logger.debug(`Got SOL price from Helius: $${price}`);
          return price;
        }
      } catch (heliusError) {
        logger.debug(`Helius price API error: ${heliusError.message}`);
        // Continue to fallbacks
      }
    }
    
    // Fallback to CoinGecko and other sources with timeout
    const pricePromise = getPriceWithFallbacks('SOL', 'sol');
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Price API timeout')), 2000)
    );
    
    const price = await Promise.race([pricePromise, timeoutPromise])
      .catch(error => {
        logger.warn(`Price API timed out or failed: ${error.message}`);
        return 0;
      });
    
    if (price > 0) {
      // Cache the result
      priceCache.sol = { 
        price, 
        lastUpdated: now,
        isFetching: false
      };
      return price;
    }
    
    // If we get here, all APIs failed but the utility returned 0
    // Try to use cache even if expired
    if (priceCache.sol.price && now - priceCache.sol.lastUpdated < ULTRA_LONG_CACHE_TTL) {
      logger.warn(`Using cached SOL price (extended fallback): $${priceCache.sol.price}`);
      priceCache.sol.isFetching = false;
      return priceCache.sol.price;
    }
    
    // Last resort, return default price
    priceCache.sol.isFetching = false;
    return WALLET.DEFAULT_SOL_PRICE;
  } catch (error) {
    logger.error(`Error in getSolPrice: ${error.message}`);
    
    // Try to use cache even if expired
    if (priceCache.sol.price) {
      logger.warn(`Using cached SOL price after error: $${priceCache.sol.price}`);
      priceCache.sol.isFetching = false;
      return priceCache.sol.price;
    }
    
    priceCache.sol.isFetching = false;
    return WALLET.DEFAULT_SOL_PRICE;
  }
};

/**
 * Get SOL balance for a wallet - Optimized to use Helius primarily
 * @param {string} address - Wallet address
 * @returns {Promise<number>} - SOL balance
 */
const getSolBalance = async (address) => {
  // Validate address to prevent errors
  if (!address || address === 'Wallet not available') {
    return WALLET.DEFAULT_SOL_BALANCE;
  }
  
  // Check cache first
  const cacheKey = `balance_${address}`;
  const now = Date.now();
  if (balanceCache.has(cacheKey)) {
    const cachedData = balanceCache.get(cacheKey);
    if (now - cachedData.timestamp < BALANCE_CACHE_TTL) {
      return cachedData.balance;
    }
  }
  
  // First try using Helius API which is more reliable and faster
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s timeout
    
    const balanceData = await getWalletBalanceHelius(address, controller.signal);
    clearTimeout(timeoutId);
    
    if (balanceData && typeof balanceData.solBalance === 'number') {
      // Cache the result
      balanceCache.set(cacheKey, {
        balance: balanceData.solBalance,
        timestamp: now
      });
      
      return balanceData.solBalance;
    }
  } catch (heliusError) {
    logger.debug(`Helius balance error, trying RPC fallbacks: ${heliusError.message}`);
    // Continue to RPC fallbacks
  }
  
  // Try all available endpoints in sequence until we get a successful response
  const endpoints = [...connectionPool.endpoints];
  let balance = WALLET.DEFAULT_SOL_BALANCE;
  let success = false;
  
  // Use only first 3 endpoints for faster response
  const limitedEndpoints = endpoints.slice(0, 3);
  
  // Try multiple endpoints in parallel for faster response
  const balancePromises = limitedEndpoints.map(endpoint => {
    return new Promise(async (resolve) => {
      try {
        const connection = new Connection(endpoint, 'confirmed');
        const publicKey = new PublicKey(address);
        const bal = await connection.getBalance(publicKey);
        resolve({ success: true, balance: bal, endpoint });
      } catch (error) {
        connectionPool.markEndpointFailed(endpoint, error);
        resolve({ success: false, endpoint });
      }
    });
  });
  
  // Race for the fastest response
  const results = await Promise.all(balancePromises);
  const successResult = results.find(result => result.success);
  
  if (successResult) {
    // Mark endpoint as successful
    connectionPool.markEndpointSuccess(successResult.endpoint);
    balance = successResult.balance;
    success = true;
  }
  
  // If all endpoints failed, try one more time with a direct fallback
  if (!success) {
    try {
      const fallbackEndpoint = 'https://api.mainnet-beta.solana.com';
      const fallbackConnection = new Connection(fallbackEndpoint, 'confirmed');
      balance = await fallbackConnection.getBalance(new PublicKey(address));
      logger.info(`Successfully retrieved balance using fallback endpoint`);
      success = true;
    } catch (fallbackError) {
      logger.error(`All endpoints failed for balance check: ${fallbackError.message}`);
      // Return default or cached balance
      if (balanceCache.has(cacheKey)) {
        const cachedData = balanceCache.get(cacheKey);
        logger.warn(`Using cached balance after all endpoints failed: ${cachedData.balance}`);
        return cachedData.balance;
      }
    }
  }
  
  const solBalance = balance / LAMPORTS_PER_SOL;
  
  // Cache successful result
  if (success) {
    balanceCache.set(cacheKey, {
      balance: solBalance,
      timestamp: now
    });
  }
  
  return solBalance;
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

/**
 * Get wallet balance using Helius API
 * @param {string} address - Wallet address
 * @param {AbortSignal} signal - Optional abort controller signal
 * @returns {Promise<object>} - Balance data including SOL and tokens
 */
const getWalletBalanceHelius = async (address, signal) => {
  try {
    // Validate address to prevent errors
    if (!address || address === 'Wallet not available') {
      return { solBalance: WALLET.DEFAULT_SOL_BALANCE, tokens: [] };
    }
    
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      logger.error('Helius API key not found for balance check');
      throw new Error('Helius API key not found');
    }
    
    // Call the Helius API to get balance data
    const endpoint = `https://api.helius.xyz/v0/addresses/${address}/balances?api-key=${heliusApiKey}`;
    
    const options = {
      url: endpoint,
      method: 'GET',
      timeout: 1500,
      signal
    };
    
    const data = await resilientRequest(options);
    
    if (data && data.tokens) {
      // Extract SOL balance (native SOL has mint address of "So11111111111111111111111111111111111111112")
      const solToken = data.tokens.find(t => t.mint === 'So11111111111111111111111111111111111111112');
      const solBalance = solToken ? solToken.amount / LAMPORTS_PER_SOL : WALLET.DEFAULT_SOL_BALANCE;
      
      // Return formatted result
      return {
        solBalance,
        tokens: data.tokens.filter(t => t.mint !== 'So11111111111111111111111111111111111111112')
      };
    } else {
      throw new Error('Invalid balance data from Helius API');
    }
  } catch (error) {
    logger.error(`Error fetching balance with Helius API: ${error.message}`);
    
    // Fallback to regular getSolBalance for SOL only
    const solBalance = await getSolBalance(address);
    return { solBalance, tokens: [] };
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
  checkAndRepairUserWallet,
  getWalletBalanceHelius
}; 