const { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { encrypt, decrypt } = require('./encryption');
const axios = require('axios');
const { logger } = require('../src/database');
const { WALLET, API, RATE_LIMIT } = require('./constants');
require('dotenv').config();

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
    'https://solana.public-rpc.com'
  ],
  getConnection() {
    if (this.connections.length < this.maxConnections) {
      // Create new connection if pool not full
      const endpoint = this.endpoints[this.connections.length % this.endpoints.length];
      const connection = new Connection(endpoint, 'confirmed');
      this.connections.push(connection);
      return connection;
    }
    
    // Round-robin through existing connections
    const connection = this.connections[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.connections.length;
    return connection;
  }
};

/**
 * Get SOL price with caching to handle rate limits - Optimized
 * @returns {Promise<number>} SOL price in USD
 */
const getSolPrice = async () => {
  // Check cache first
  const now = Date.now();
  if (priceCache.sol.price && now - priceCache.sol.lastUpdated < CACHE_TTL) {
    return priceCache.sol.price;
  }
  
  // Try multiple API endpoints in parallel for faster response
  try {
    const [coingeckoPromise, jupPromise] = [
      axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { 
        timeout: API.TIMEOUT_MS / 2 
      }).catch(err => ({ error: err })),
      axios.get('https://price.jup.ag/v4/price?ids=SOL', { 
        timeout: API.TIMEOUT_MS / 2 
      }).catch(err => ({ error: err }))
    ];
    
    // Race for fastest response
    const results = await Promise.allSettled([coingeckoPromise, jupPromise]);
    
    // Process CoinGecko result if successful
    if (results[0].status === 'fulfilled' && !results[0].value.error) {
      const response = results[0].value;
      if (response.data && response.data.solana && response.data.solana.usd) {
        const price = response.data.solana.usd;
        priceCache.sol = { price, lastUpdated: now };
        return price;
      }
    }
    
    // Process Jupiter result if successful
    if (results[1].status === 'fulfilled' && !results[1].value.error) {
      const response = results[1].value;
      if (response.data && response.data.data && response.data.data.SOL) {
        const price = response.data.data.SOL.price;
        priceCache.sol = { price, lastUpdated: now };
        return price;
      }
    }
    
    throw new Error('Failed to fetch price from primary sources');
  } catch (error) {
    logger.error(`Error fetching SOL price: ${error.message}`);
    
    // Tiered fallback strategy
    // 1. First try normal cache if not too old
    if (priceCache.sol.price && now - priceCache.sol.lastUpdated < LONG_CACHE_TTL) {
      logger.info(`Using cached SOL price (normal fallback): $${priceCache.sol.price}`);
      return priceCache.sol.price;
    }
    
    // 2. Try third backup API
    try {
      const coinbaseResponse = await axios.get('https://api.coinbase.com/v2/prices/SOL-USD/spot', {
        timeout: API.TIMEOUT_MS
      });
      if (coinbaseResponse.data && coinbaseResponse.data.data && coinbaseResponse.data.data.amount) {
        const price = parseFloat(coinbaseResponse.data.data.amount);
        priceCache.sol = { price, lastUpdated: now };
        return price;
      }
    } catch (cbError) {
      logger.error(`Error fetching SOL price from Coinbase: ${cbError.message}`);
    }
    
    // 3. Use ultra-long cache if available
    if (priceCache.sol.price && now - priceCache.sol.lastUpdated < ULTRA_LONG_CACHE_TTL) {
      logger.info(`Using cached SOL price (extended fallback): $${priceCache.sol.price}`);
      return priceCache.sol.price;
    }
    
    // 4. Last resort, return default price
    return priceCache.sol.price || WALLET.DEFAULT_SOL_PRICE;
  }
};

/**
 * Get SOL balance for a wallet - Optimized with connection pooling
 * @param {string} address - Wallet address
 * @returns {Promise<number>} - SOL balance
 */
const getSolBalance = async (address) => {
  // Get connection from pool
  try {
    // Validate address to prevent errors
    if (!address || address === 'Wallet not available') {
      return WALLET.DEFAULT_SOL_BALANCE;
    }
    
    // Use connection pool to distribute load
    const connection = connectionPool.getConnection();
    
    try {
      const publicKey = new PublicKey(address);
      const balance = await connection.getBalance(publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      // Try one more time with a different connection if this one failed
      logger.warn(`Error fetching balance with primary connection: ${error.message}, trying backup`);
      const backupConnection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
      const balance = await backupConnection.getBalance(new PublicKey(address));
      return balance / LAMPORTS_PER_SOL;
    }
  } catch (error) {
    logger.error(`Error fetching SOL balance for ${address}: ${error.message}`);
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
 * Get token price with caching
 * @param {string} tokenAddress - Token mint address
 * @returns {Promise<Object>} Token price data
 */
const getTokenPrice = async (tokenAddress) => {
  // Check cache first
  const now = Date.now();
  const cachedToken = priceCache.tokens.get(tokenAddress);
  if (cachedToken && now - cachedToken.lastUpdated < CACHE_TTL) {
    return cachedToken.data;
  }
  
  try {
    // Try to get price from Jupiter aggregator
    const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenAddress}`);
    
    if (response.data && response.data.data && response.data.data[tokenAddress]) {
      const tokenData = {
        price: response.data.data[tokenAddress].price,
        marketCap: response.data.data[tokenAddress].market_cap || 0,
        liquidity: response.data.data[tokenAddress].liquidity || 0,
        tokenInfo: await getTokenInfo(tokenAddress)
      };
      
      // Cache the result
      priceCache.tokens.set(tokenAddress, {
        data: tokenData,
        lastUpdated: now
      });
      
      return tokenData;
    }
    
    throw new Error('Token not found in price API');
  } catch (error) {
    logger.error(`Error fetching token price for ${tokenAddress}: ${error.message}`);
    
    // If cache is not too old, use cached price as fallback
    if (cachedToken && now - cachedToken.lastUpdated < LONG_CACHE_TTL) {
      logger.info(`Using cached price for token ${tokenAddress} due to API error`);
      return cachedToken.data;
    }
    
    // Return default fallback
    return {
      price: 0,
      marketCap: 0,
      liquidity: 0,
      tokenInfo: await getTokenInfo(tokenAddress)
    };
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