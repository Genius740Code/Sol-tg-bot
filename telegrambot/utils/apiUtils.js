/**
 * API Utilities for resilient API requests
 */
const axios = require('axios');
const { logger } = require('../src/database');
const { API } = require('../../config/constants');

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
      // For SOL, use only CoinGecko (50 req/min limit)
      const options = {
        url: 'https://api.coingecko.com/api/v3/simple/price',
        method: 'GET',
        params: { ids: 'solana', vs_currencies: 'usd' },
        timeout: API.TIMEOUT_MS,
        validateResponse: (response) => {
          return response.status === 200 && 
                 response.data && 
                 response.data.solana && 
                 response.data.solana.usd;
        }
      };
      
      try {
        const data = await resilientRequest(options);
        
        if (data.solana && data.solana.usd) {
          return data.solana.usd;
        }
        
        throw new Error('Price data not found in response');
      } catch (error) {
        logger.error(`CoinGecko price service failed: ${error.message}`);
        return 0;
      }
    } else if (type === 'token') {
      // For tokens, use only Helius API via token info instead of price APIs
      // This will return 0 for price, but the token metadata will still be available
      logger.info(`Using Helius API for token information only: ${coinId}`);
      return 0;
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