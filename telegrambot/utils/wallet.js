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

/**
 * Get SOL price from API
 * @returns {Promise<number>} - Current SOL price in USD
 */
const getSolPrice = async () => {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      timeout: API.TIMEOUT_MS
    });
    return response.data.solana.usd;
  } catch (error) {
    logger.error(`Error fetching SOL price: ${error.message}`);
    return WALLET.DEFAULT_SOL_PRICE; // Return default price on error
  }
};

/**
 * Get SOL balance for a wallet
 * @param {string} address - Wallet address
 * @returns {Promise<number>} - SOL balance
 */
const getSolBalance = async (address) => {
  try {
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    const balance = await connection.getBalance(new PublicKey(address));
    return balance / LAMPORTS_PER_SOL;
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

// Get token price from Helius (Price Oracle)
const getTokenPrice = async (tokenAddress) => {
  try {
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) throw new Error('Helius API key not found');
    
    // First get token metadata
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) throw new Error('Token not found');
    
    // Use Helius token API to get additional info
    try {
      const heliusBalancesEndpoint = `https://api.helius.xyz/v0/addresses/${tokenAddress}/balances?api-key=${heliusApiKey}`;
      const balancesResponse = await axios.get(heliusBalancesEndpoint);
      
      // Format response with token info plus available balance data
      return {
        price: tokenInfo.price?.value || 'Unknown',
        marketCap: tokenInfo.marketCap || 'Unknown',
        liquidity: 'See on Jupiter or Raydium',
        volume24h: tokenInfo.volume24h || 'Unknown',
        tokenInfo
      };
    } catch (balanceError) {
      logger.error('Error getting token balances:', balanceError);
      
      // Return just the token info if balance check fails
      return {
        price: 'Unknown',
        marketCap: 'Unknown',
        liquidity: 'Unknown',
        volume24h: 'Unknown',
        tokenInfo
      };
    }
  } catch (error) {
    logger.error('Error getting token price:', error);
    throw new Error('Failed to get token price information');
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
          name: 'Main Wallet',
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