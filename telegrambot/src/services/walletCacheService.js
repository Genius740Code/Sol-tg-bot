const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const apiService = require('./apiService');
const { Settings } = require('../models/settings');
const { User } = require('../models/user');

/**
 * WalletCache service for optimized wallet balance and token price loading
 */
class WalletCacheService {
  constructor() {
    // Cache configuration
    this.balanceCache = new NodeCache({
      stdTTL: 60, // 1 minute TTL for balances
      checkperiod: 120,
      useClones: false
    });
    
    this.priceCache = new NodeCache({
      stdTTL: 300, // 5 minutes TTL for prices
      checkperiod: 120,
      useClones: false
    });
    
    this.metadataCache = new NodeCache({
      stdTTL: 3600, // 1 hour TTL for metadata
      checkperiod: 120,
      useClones: false
    });
    
    this.initialized = false;
    this.refreshInterval = null;
    this.activeWallets = new Set();
  }
  
  /**
   * Initialize the wallet cache service
   */
  async initialize() {
    try {
      // Load cache TTL settings
      const balanceTTL = await Settings.getSetting('cache_ttl_short') || 60;
      const priceTTL = await Settings.getSetting('cache_ttl_medium') || 300;
      const metadataTTL = await Settings.getSetting('cache_ttl_long') || 3600;
      
      // Update cache TTLs
      this.balanceCache.options.stdTTL = balanceTTL;
      this.priceCache.options.stdTTL = priceTTL;
      this.metadataCache.options.stdTTL = metadataTTL;
      
      // Preload SOL price
      await this.getSolPrice(true);
      
      // Start refresh interval
      this.startAutoRefresh();
      
      this.initialized = true;
      logger.info('Wallet Cache Service initialized successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize Wallet Cache Service: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Start automatic refresh of wallet data
   */
  startAutoRefresh() {
    // Clear existing interval if any
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    // Set up refresh interval - 2 minutes for balances, 5 minutes for prices
    this.refreshInterval = setInterval(async () => {
      try {
        // Refresh SOL price
        await this.getSolPrice(true);
        
        // Refresh active wallet balances
        for (const walletAddress of this.activeWallets) {
          await this.getWalletBalances(walletAddress, true);
        }
        
        logger.debug(`Auto-refreshed wallet cache for ${this.activeWallets.size} active wallets`);
      } catch (error) {
        logger.error(`Error in auto-refresh: ${error.message}`);
      }
    }, 120000); // 2 minutes
    
    logger.info('Started wallet cache auto-refresh');
  }
  
  /**
   * Get SOL price, using cache if available
   * @param {boolean} forceRefresh - Force refresh from API
   * @returns {Promise<number>} SOL price in USD
   */
  async getSolPrice(forceRefresh = false) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const cacheKey = 'sol_price';
    
    // Return cached price if available and not forcing refresh
    if (!forceRefresh && this.priceCache.has(cacheKey)) {
      return this.priceCache.get(cacheKey);
    }
    
    try {
      // Get SOL price from API
      const price = await apiService.getSolPrice();
      
      // Cache the price
      this.priceCache.set(cacheKey, price);
      
      return price;
    } catch (error) {
      logger.error(`Failed to fetch SOL price: ${error.message}`);
      
      // Return cached price if available, even though refresh failed
      if (this.priceCache.has(cacheKey)) {
        return this.priceCache.get(cacheKey);
      }
      
      throw error;
    }
  }
  
  /**
   * Get wallet balances, using cache if available
   * @param {string} walletAddress - Wallet address
   * @param {boolean} forceRefresh - Force refresh from API
   * @returns {Promise<Object>} Wallet balances
   */
  async getWalletBalances(walletAddress, forceRefresh = false) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // Add to active wallets set for auto-refresh
    this.activeWallets.add(walletAddress);
    
    const cacheKey = `balance_${walletAddress}`;
    
    // Return cached balances if available and not forcing refresh
    if (!forceRefresh && this.balanceCache.has(cacheKey)) {
      return this.balanceCache.get(cacheKey);
    }
    
    try {
      // Get wallet balances from API
      const balances = await apiService.getWalletBalances(walletAddress);
      
      // Cache the balances
      this.balanceCache.set(cacheKey, balances);
      
      return balances;
    } catch (error) {
      logger.error(`Failed to fetch wallet balances for ${walletAddress}: ${error.message}`);
      
      // Return cached balances if available, even though refresh failed
      if (this.balanceCache.has(cacheKey)) {
        return this.balanceCache.get(cacheKey);
      }
      
      throw error;
    }
  }
  
  /**
   * Get token metadata, using cache if available
   * @param {Array<string>} tokenAddresses - Token mint addresses
   * @param {boolean} forceRefresh - Force refresh from API
   * @returns {Promise<Object>} Token metadata
   */
  async getTokenMetadata(tokenAddresses, forceRefresh = false) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const cacheKey = `metadata_${tokenAddresses.sort().join('_')}`;
    
    // Return cached metadata if available and not forcing refresh
    if (!forceRefresh && this.metadataCache.has(cacheKey)) {
      return this.metadataCache.get(cacheKey);
    }
    
    try {
      // Get token metadata from API
      const metadata = await apiService.getTokenMetadata(tokenAddresses);
      
      // Cache the metadata
      this.metadataCache.set(cacheKey, metadata);
      
      // Also cache individual tokens for faster lookups
      metadata.forEach(token => {
        if (token.mint) {
          this.metadataCache.set(`metadata_${token.mint}`, [token]);
        }
      });
      
      return metadata;
    } catch (error) {
      logger.error(`Failed to fetch token metadata: ${error.message}`);
      
      // Return cached metadata if available, even though refresh failed
      if (this.metadataCache.has(cacheKey)) {
        return this.metadataCache.get(cacheKey);
      }
      
      throw error;
    }
  }
  
  /**
   * Get all balances and details for user presentation
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object>} Wallet details with balances, prices, etc.
   */
  async getWalletDetails(walletAddress) {
    try {
      // Get wallet balances
      const balances = await this.getWalletBalances(walletAddress);
      
      // Get SOL price
      const solPrice = await this.getSolPrice();
      
      // Get token mints from balances
      const tokenMints = balances.tokens
        ? balances.tokens.map(token => token.mint)
        : [];
      
      // Get token metadata if there are tokens
      let tokenMetadata = {};
      if (tokenMints.length > 0) {
        const metadata = await this.getTokenMetadata(tokenMints);
        
        // Convert to map for easier lookup
        metadata.forEach(token => {
          if (token.mint) {
            tokenMetadata[token.mint] = token;
          }
        });
      }
      
      // Calculate total value in USD
      let totalValueUsd = 0;
      
      // Add SOL value
      const solBalanceUsd = balances.nativeBalance * solPrice;
      totalValueUsd += solBalanceUsd;
      
      // Add token values
      const tokensWithDetails = balances.tokens
        ? balances.tokens.map(token => {
            const metadata = tokenMetadata[token.mint] || {};
            let valueUsd = 0;
            
            if (token.price) {
              valueUsd = token.amount * token.price;
              totalValueUsd += valueUsd;
            }
            
            return {
              ...token,
              ...metadata,
              valueUsd
            };
          })
        : [];
      
      // Sort tokens by USD value (descending)
      tokensWithDetails.sort((a, b) => b.valueUsd - a.valueUsd);
      
      return {
        address: walletAddress,
        nativeBalance: balances.nativeBalance,
        solPrice,
        solValueUsd: solBalanceUsd,
        tokens: tokensWithDetails,
        totalValueUsd
      };
    } catch (error) {
      logger.error(`Failed to get wallet details for ${walletAddress}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Preload balances for all active users
   */
  async preloadActiveUsers() {
    try {
      logger.info('Preloading wallet cache for active users...');
      
      // Find users active in the last 24 hours
      const activeUsers = await User.find({
        lastActivity: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });
      
      logger.info(`Found ${activeUsers.length} active users`);
      
      // Preload balances for active wallets
      for (const user of activeUsers) {
        const activeWallet = user.getActiveWallet();
        
        if (activeWallet && activeWallet.address) {
          try {
            await this.getWalletBalances(activeWallet.address, true);
            this.activeWallets.add(activeWallet.address);
          } catch (error) {
            logger.error(`Failed to preload wallet ${activeWallet.address}: ${error.message}`);
          }
        }
      }
      
      logger.info(`Preloaded ${this.activeWallets.size} active wallets`);
    } catch (error) {
      logger.error(`Failed to preload active users: ${error.message}`);
    }
  }
  
  /**
   * Clear wallet from active set (e.g. when user goes inactive)
   * @param {string} walletAddress - Wallet address to remove
   */
  removeActiveWallet(walletAddress) {
    this.activeWallets.delete(walletAddress);
  }
  
  /**
   * Clear cache for specific wallet
   * @param {string} walletAddress - Wallet address
   */
  clearWalletCache(walletAddress) {
    const cacheKey = `balance_${walletAddress}`;
    this.balanceCache.del(cacheKey);
  }
}

// Create singleton instance
const walletCacheService = new WalletCacheService();

module.exports = walletCacheService; 