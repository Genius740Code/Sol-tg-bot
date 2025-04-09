const { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { encrypt, decrypt } = require('./encryption');
const axios = require('axios');
const { logger } = require('../src/database');
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

// Get SOL balance for an address
const getSolBalance = async (publicKey) => {
  try {
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    const balance = await connection.getBalance(new PublicKey(publicKey));
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    logger.error('Error getting SOL balance:', error);
    throw new Error('Failed to get SOL balance');
  }
};

// Get SOL price from CoinGecko (using free API)
const getSolPrice = async () => {
  try {
    // Use free CoinGecko API endpoint with no key required
    const endpoint = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
    
    // Add a user agent and delay to avoid getting blocked
    const response = await axios.get(endpoint, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    if (response.data && response.data.solana && response.data.solana.usd) {
      return response.data.solana.usd;
    } else {
      throw new Error('Invalid response from CoinGecko');
    }
  } catch (error) {
    logger.error('Error getting SOL price:', error);
    throw new Error('Failed to get SOL price');
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

// Add rate limiting for user requests (to prevent API abuse)
const userLastRequest = {};
const isRateLimited = (userId) => {
  const now = Date.now();
  const lastRequest = userLastRequest[userId] || 0;
  
  // Rate limit of 0.5 seconds per user
  if (now - lastRequest < 500) {
    return true;
  }
  
  userLastRequest[userId] = now;
  return false;
};

module.exports = {
  generateWallet,
  importWalletFromPrivateKey,
  getSolBalance,
  getSolPrice,
  getTokenInfo,
  getTokenPrice,
  isRateLimited
}; 