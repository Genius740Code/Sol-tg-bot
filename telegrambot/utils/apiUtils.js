/**
 * API Utilities for resilient API requests
 */
const axios = require('axios');
const { logger } = require('../src/database');
const { API } = require('./constants');

/**
 * Makes a resilient API request with retries and fallbacks
 * @param {Object} options - Request options
 * @param {string} options.url - Primary URL to request
 * @param {string[]} [options.fallbackUrls] - Fallback URLs to try if primary fails
 * @param {string} options.method - HTTP method (GET, POST, etc)
 * @param {Object} [options.data] - Request body for POST requests
 * @param {Object} [options.params] - URL parameters for GET requests
 * @param {number} [options.timeout] - Request timeout in ms
 * @param {number} [options.retries] - Number of retries (default from API.MAX_RETRIES)
 * @param {number} [options.retryDelay] - Delay between retries in ms (default from API.RETRY_DELAY_MS)
 * @param {function} [options.validateResponse] - Function to validate response (return true if valid)
 * @returns {Promise<Object>} Response data
 */
const resilientRequest = async (options) => {
  const {
    url,
    fallbackUrls = [],
    method = 'GET',
    data = null,
    params = null,
    headers = {},
    timeout = API.TIMEOUT_MS,
    retries = API.MAX_RETRIES,
    retryDelay = API.RETRY_DELAY_MS,
    validateResponse = null
  } = options;
  
  // Add all URLs to try in sequence
  const urlsToTry = [url, ...fallbackUrls];
  let lastError = null;
  
  // Try each URL with retries
  for (const currentUrl of urlsToTry) {
    let attemptsLeft = retries + 1; // +1 for initial try
    
    while (attemptsLeft > 0) {
      try {
        const response = await axios({
          method,
          url: currentUrl,
          data,
          params,
          headers,
          timeout
        });
        
        // Validate response if validator provided
        if (validateResponse && !validateResponse(response)) {
          throw new Error('Response validation failed');
        }
        
        // Success! Return the data
        return response.data;
      } catch (error) {
        attemptsLeft--;
        lastError = error;
        
        // Log the error but not on the last attempt (will be logged outside)
        if (attemptsLeft > 0) {
          logger.warn(`API request to ${currentUrl} failed: ${error.message}. Retries left: ${attemptsLeft}`);
          
          // Special handling for rate limiting
          if (error.response && error.response.status === 429) {
            logger.warn(`Rate limited. Waiting longer before retry.`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * 2));
          } else {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }
    }
    
    // All retries for current URL failed, log before trying next URL
    logger.warn(`All retries failed for ${currentUrl}, trying next fallback URL if available.`);
  }
  
  // All URLs failed
  logger.error(`All API requests failed. Last error: ${lastError.message}`);
  throw lastError;
};

/**
 * Get price data with fallbacks to multiple services
 * @param {string} coinId - Coin ID or token address
 * @param {string} type - 'sol' or 'token'
 * @returns {Promise<number>} Price in USD
 */
const getPriceWithFallbacks = async (coinId, type = 'sol') => {
  try {
    if (type === 'sol') {
      // For SOL, try multiple price APIs
      const options = {
        url: 'https://api.coingecko.com/api/v3/simple/price',
        fallbackUrls: [
          'https://price.jup.ag/v4/price',
          'https://api.coinbase.com/v2/prices/SOL-USD/spot',
          'https://api.binance.com/api/v3/ticker/price'
        ],
        method: 'GET',
        params: type === 'sol' ? { ids: 'solana', vs_currencies: 'usd' } : { ids: coinId },
        timeout: API.TIMEOUT_MS,
        validateResponse: (response) => {
          if (response.status !== 200) return false;
          
          // Different validation for different APIs based on URL
          if (response.config.url.includes('coingecko')) {
            return response.data && response.data.solana && response.data.solana.usd;
          } else if (response.config.url.includes('jup.ag')) {
            return response.data && response.data.data && response.data.data.SOL;
          } else if (response.config.url.includes('coinbase')) {
            return response.data && response.data.data && response.data.data.amount;
          } else if (response.config.url.includes('binance')) {
            return response.data && response.data.symbol === 'SOLUSDT' && response.data.price;
          }
          
          return false;
        }
      };
      
      try {
        const data = await resilientRequest(options);
        
        // Parse price based on which API succeeded
        if (data.solana && data.solana.usd) {
          return data.solana.usd;
        } else if (data.data && data.data.SOL) {
          return data.data.SOL.price;
        } else if (data.data && data.data.amount) {
          return parseFloat(data.data.amount);
        } else if (data.symbol === 'SOLUSDT') {
          return parseFloat(data.price);
        }
        
        throw new Error('Price data not found in response');
      } catch (error) {
        logger.error(`All price services failed: ${error.message}`);
        return 0;
      }
    } else if (type === 'token') {
      // For tokens, try Jupiter then fallbacks
      const options = {
        url: `https://price.jup.ag/v4/price?ids=${coinId}`,
        fallbackUrls: [
          `https://public-api.birdeye.so/public/price?address=${coinId}`,
          `https://api.dexscreener.com/latest/dex/tokens/${coinId}`
        ],
        method: 'GET',
        timeout: API.TIMEOUT_MS
      };
      
      try {
        const data = await resilientRequest(options);
        
        // Parse based on which API succeeded
        if (data.data && data.data[coinId] && data.data[coinId].price) {
          return data.data[coinId].price;
        } else if (data.success && data.data && data.data.value) {
          return data.data.value;
        } else if (data.pairs && data.pairs.length > 0) {
          // DexScreener returns multiple pairs, use the one with highest liquidity
          const pairs = data.pairs.sort((a, b) => 
            parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
          );
          
          if (pairs.length > 0 && pairs[0].priceUsd) {
            return parseFloat(pairs[0].priceUsd);
          }
        }
        
        throw new Error('Token price data not found in response');
      } catch (error) {
        logger.error(`All token price services failed for ${coinId}: ${error.message}`);
        return 0;
      }
    }
    
    throw new Error(`Unsupported price type: ${type}`);
  } catch (error) {
    logger.error(`Price fetch failed: ${error.message}`);
    return 0;
  }
};

module.exports = {
  resilientRequest,
  getPriceWithFallbacks
}; 