const axios = require('axios');
const { Connection } = require('@solana/web3.js');
const logger = require('../utils/logger');
const { Settings } = require('../models/settings');
const NodeCache = require('node-cache');

// Cache for API responses with configurable TTL
const cache = new NodeCache({
  stdTTL: 60, // 60 seconds default TTL
  checkperiod: 120, // Check for expired keys every 120 seconds
  useClones: false, // Don't clone objects for performance
  maxKeys: 1000 // Limit cache size
});

class ApiService {
  constructor() {
    this.heliusApiKey = null;
    this.solanaConnection = null;
    this.initialized = false;
    this.retryConfig = {
      maxRetries: 5,
      baseDelay: 1000, // 1s initial delay
      maxDelay: 30000 // 30s max delay
    };
  }

  /**
   * Initialize the API service with required configurations
   */
  async initialize() {
    try {
      // Load API key from settings
      this.heliusApiKey = await Settings.getSetting('helius_api_key');
      if (!this.heliusApiKey) {
        logger.error('Helius API key not found in settings!');
        throw new Error('Missing Helius API key');
      }

      // Initialize Solana connection
      const rpcUrl = await Settings.getSetting('solana_rpc_url') || 'https://api.mainnet-beta.solana.com';
      this.solanaConnection = new Connection(rpcUrl, 'confirmed');
      
      this.initialized = true;
      logger.info('API Service initialized successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize API Service: ${error.message}`);
      return false;
    }
  }

  /**
   * Make API request with retry logic and caching
   * @param {string} url - Request URL
   * @param {Object} options - Axios request options
   * @param {boolean} useCache - Whether to use cached response if available
   * @param {number} cacheTTL - Cache TTL in seconds
   * @returns {Promise<Object>} API response
   */
  async makeRequest(url, options = {}, useCache = true, cacheTTL = 60) {
    if (!this.initialized) {
      await this.initialize();
    }

    const cacheKey = `${url}-${JSON.stringify(options)}`;
    
    // Return cached response if available and cache is enabled
    if (useCache && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    let retries = 0;
    
    while (retries <= this.retryConfig.maxRetries) {
      try {
        const response = await axios({
          url,
          ...options,
          timeout: 30000 // 30 second timeout
        });
        
        // Cache successful response
        if (useCache && response.data) {
          cache.set(cacheKey, response.data, cacheTTL);
        }
        
        return response.data;
      } catch (error) {
        retries++;
        
        // Only log error on final retry
        if (retries > this.retryConfig.maxRetries) {
          logger.error(`API request to ${url} failed: ${error.message}`);
          throw error;
        }
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(2, retries - 1),
          this.retryConfig.maxDelay
        );
        
        logger.warn(`API request to ${url} failed: ${error.message}. Retries left: ${this.retryConfig.maxRetries - retries + 1}`);
        
        if (error.response && error.response.status === 429) {
          logger.warn(`Rate limited. Waiting longer before retry.`);
          // Add extra delay for rate limit errors
          await new Promise(resolve => setTimeout(resolve, delay * 2));
        } else {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }

  /**
   * Get token price from Helius API
   * @param {string} tokenAddress - Token mint address
   * @returns {Promise<Object>} Token price data
   */
  async getTokenPrice(tokenAddress) {
    const endpoint = `https://api.helius.xyz/v0/token-price?api-key=${this.heliusApiKey}`;
    
    return this.makeRequest(endpoint, {
      method: 'post',
      data: { mints: [tokenAddress] }
    });
  }

  /**
   * Get SOL price in USD
   * @returns {Promise<number>} SOL price in USD
   */
  async getSolPrice() {
    const solAddress = 'So11111111111111111111111111111111111111112';
    const priceData = await this.getTokenPrice(solAddress);
    
    if (priceData && priceData[solAddress] && priceData[solAddress].price) {
      return priceData[solAddress].price;
    }
    
    throw new Error('Failed to fetch SOL price');
  }

  /**
   * Get token metadata
   * @param {Array<string>} tokenAddresses - Token mint addresses
   * @returns {Promise<Object>} Token metadata
   */
  async getTokenMetadata(tokenAddresses) {
    const endpoint = `https://api.helius.xyz/v0/tokens/metadata?api-key=${this.heliusApiKey}`;
    
    return this.makeRequest(endpoint, {
      method: 'post',
      data: { mintAccounts: tokenAddresses }
    });
  }

  /**
   * Get wallet balances
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object>} Wallet balances data
   */
  async getWalletBalances(walletAddress) {
    const endpoint = `https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${this.heliusApiKey}`;
    
    return this.makeRequest(endpoint);
  }

  /**
   * Clear cache for specific key or entire cache
   * @param {string} key - Specific cache key to clear (optional)
   */
  clearCache(key = null) {
    if (key) {
      cache.del(key);
    } else {
      cache.flushAll();
    }
  }
  
  /**
   * Preload common data like SOL price into cache
   */
  async preloadCache() {
    try {
      // Preload SOL price
      await this.getSolPrice();
      logger.info('Preloaded SOL price into cache');
    } catch (error) {
      logger.error(`Failed to preload cache: ${error.message}`);
    }
  }
}

// Create singleton instance
const apiService = new ApiService();

module.exports = apiService; 