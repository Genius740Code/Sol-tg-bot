/**
 * Optimized message utility functions for the Telegram bot
 */

const { logger } = require('../src/database');

// Cache for expensive operations
const userInfoCache = new Map();
const USER_INFO_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Efficiently extracts user information from a Telegram context
 * @param {Object} ctx - Telegram context
 * @returns {Object} User information object
 */
const extractUserInfo = (ctx) => {
  try {
    // Check if we have a cached version for this context
    if (ctx.from && ctx.from.id) {
      const cacheKey = `user_${ctx.from.id}_${Date.now() - (Date.now() % 60000)}`; // Cache key with 1-minute granularity
      
      if (userInfoCache.has(cacheKey)) {
        return userInfoCache.get(cacheKey);
      }
    }
    
    let userInfo = null;
    
    // First check if this is a callback query (most common case in button interactions)
    if (ctx.callbackQuery) {
      const user = ctx.callbackQuery.from;
      userInfo = {
        userId: user.id.toString(),
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        chatId: ctx.callbackQuery.message.chat.id,
        messageId: ctx.callbackQuery.message.message_id,
        messageText: ctx.callbackQuery.data || ''
      };
    }
    // Otherwise, try to extract from message
    else if (ctx.message) {
      const user = ctx.message.from;
      userInfo = {
        userId: user.id.toString(),
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        chatId: ctx.message.chat.id,
        messageText: ctx.message.text || ''
      };
    }
    // Fall back to raw ctx.from if available
    else if (ctx.from) {
      // Try to get message text from ctx.update if available
      let messageText = '';
      if (ctx.update && ctx.update.message && ctx.update.message.text) {
        messageText = ctx.update.message.text;
      }
      
      userInfo = {
        userId: ctx.from.id.toString(),
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
        chatId: ctx.chat ? ctx.chat.id : null,
        messageText: messageText
      };
    }
    // Last resort - try to extract from update
    else if (ctx.update && ctx.update.message) {
      const user = ctx.update.message.from;
      userInfo = {
        userId: user.id.toString(),
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        chatId: ctx.update.message.chat.id,
        messageText: ctx.update.message.text || ''
      };
    }
    
    if (!userInfo) {
      logger.warn('Could not extract user info from context');
      return null;
    }
    
    // Cache the result if we have a userId
    if (userInfo.userId) {
      const cacheKey = `user_${userInfo.userId}_${Date.now() - (Date.now() % 60000)}`; // Cache key with 1-minute granularity
      userInfoCache.set(cacheKey, userInfo);
      
      // Cleanup old cache entries periodically
      if (userInfoCache.size > 1000) {
        const now = Date.now();
        const keysToDelete = [];
        
        userInfoCache.forEach((value, key) => {
          const parts = key.split('_');
          const timestamp = parseInt(parts[2]);
          if (now - timestamp > USER_INFO_CACHE_TTL) {
            keysToDelete.push(key);
          }
        });
        
        keysToDelete.forEach(key => userInfoCache.delete(key));
      }
    }
    
    return userInfo;
  } catch (error) {
    logger.error(`Error extracting user info: ${error.message}`);
    return null;
  }
};

// Cached number formatters for improved performance
const cachedFormatters = {
  standard: new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }),
  price: {
    tiny: new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }),
    small: new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }),
    medium: new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }),
    large: new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
  },
  exponential: (num, precision) => num.toExponential(precision)
};

/**
 * Format a price value for display with improved performance
 * @param {number} price - Price to format
 * @returns {string} Formatted price
 */
const formatPrice = (price) => {
  if (!price && price !== 0) return 'N/A';
  
  if (price < 0.000001) {
    return cachedFormatters.exponential(price, 4);
  } else if (price < 0.001) {
    return cachedFormatters.price.tiny.format(price);
  } else if (price < 1) {
    return cachedFormatters.price.small.format(price);
  } else if (price < 10) {
    return cachedFormatters.price.medium.format(price);
  } else if (price < 1000) {
    return cachedFormatters.price.large.format(price);
  } else {
    return cachedFormatters.standard.format(price);
  }
};

/**
 * Format a token balance for display with improved performance
 * @param {number} balance - Balance to format
 * @param {number} decimals - Token decimals
 * @returns {string} Formatted balance
 */
const formatBalance = (balance, decimals = 9) => {
  if (!balance && balance !== 0) return '0';
  
  if (balance < 0.000001) {
    return cachedFormatters.exponential(balance, 4);
  } else if (balance < 0.001) {
    return cachedFormatters.price.tiny.format(balance);
  } else if (balance < 1000) {
    return balance.toFixed(Math.min(4, decimals)); // Can't use cached formatter because of variable decimals
  } else if (balance < 1000000) {
    return cachedFormatters.standard.format(balance);
  } else {
    // For very large balances, use K/M/B notation
    if (balance < 1000000000) {
      return (balance / 1000000).toFixed(2) + 'M';
    } else {
      return (balance / 1000000000).toFixed(2) + 'B';
    }
  }
};

// Keep track of message updates to avoid Telegram API errors
const messageUpdateTracker = {
  lastUpdates: new Map(), // chatId_messageId -> timestamp
  updateInterval: 1100, // Minimum time between updates (ms), to avoid Telegram's 30 msgs/second limit
  pendingUpdates: new Map(), // chatId_messageId -> { text, options }
  isProcessing: false
};

/**
 * Process pending message updates in a rate-limited manner
 */
const processPendingUpdates = async (ctx) => {
  // If already processing, don't start another process
  if (messageUpdateTracker.isProcessing) return;
  
  try {
    messageUpdateTracker.isProcessing = true;
    
    const now = Date.now();
    const pendingKeys = Array.from(messageUpdateTracker.pendingUpdates.keys());
    
    for (const key of pendingKeys) {
      const [chatId, messageId] = key.split('_');
      const lastUpdate = messageUpdateTracker.lastUpdates.get(key) || 0;
      
      // Skip if we updated this message too recently
      if (now - lastUpdate < messageUpdateTracker.updateInterval) continue;
      
      const updateData = messageUpdateTracker.pendingUpdates.get(key);
      
      try {
        // Update the message
        await ctx.telegram.editMessageText(
          chatId, 
          messageId,
          null,
          updateData.text,
          updateData.options
        );
        
        // Record the update time
        messageUpdateTracker.lastUpdates.set(key, now);
        // Remove from pending
        messageUpdateTracker.pendingUpdates.delete(key);
      } catch (error) {
        if (error.description && error.description.includes('message is not modified')) {
          // Message content hasn't changed, just remove from pending
          messageUpdateTracker.pendingUpdates.delete(key);
        } else if (error.description && (
          error.description.includes('message to edit not found') || 
          error.description.includes('message can\'t be edited')
        )) {
          // Message can't be edited, remove from pending
          messageUpdateTracker.pendingUpdates.delete(key);
          messageUpdateTracker.lastUpdates.delete(key);
        } else {
          logger.error(`Error updating message: ${error.message}`);
        }
      }
      
      // Add a small delay between updates to help stay within rate limits
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (error) {
    logger.error(`Error in processPendingUpdates: ${error.message}`);
  } finally {
    messageUpdateTracker.isProcessing = false;
    
    // If we still have pending updates, schedule another run
    if (messageUpdateTracker.pendingUpdates.size > 0) {
      setTimeout(() => processPendingUpdates(ctx), messageUpdateTracker.updateInterval);
    }
  }
};

/**
 * Updates an existing message or sends a new one with rate limiting
 * @param {Object} ctx - Telegram context
 * @param {string} text - Message text
 * @param {Object} keyboard - Markup keyboard
 * @returns {Promise} Result of the operation
 */
const updateOrSendMessage = async (ctx, text, keyboard) => {
  try {
    // Extract user info to get messageId and chatId if available
    const userInfo = extractUserInfo(ctx);
    
    // Set message options
    const options = {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...keyboard
    };
    
    // If this was a callback query, we can edit the message
    if (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_id) {
      const chatId = ctx.callbackQuery.message.chat.id;
      const messageId = ctx.callbackQuery.message.message_id;
      const updateKey = `${chatId}_${messageId}`;
      
      // Queue the update instead of immediately executing it
      messageUpdateTracker.pendingUpdates.set(updateKey, { text, options });
      
      // Start processing updates if not already running
      processPendingUpdates(ctx);
      
      // Return immediately to improve responsiveness
      return { chatId, messageId, pending: true };
    } else if (userInfo && userInfo.chatId && userInfo.messageId) {
      // We have chatId and messageId from previous extraction
      const updateKey = `${userInfo.chatId}_${userInfo.messageId}`;
      
      // Queue the update
      messageUpdateTracker.pendingUpdates.set(updateKey, { text, options });
      
      // Start processing updates
      processPendingUpdates(ctx);
      
      // Return immediately
      return { chatId: userInfo.chatId, messageId: userInfo.messageId, pending: true };
    } else {
      // Just send a new message
      return await ctx.reply(text, options);
    }
  } catch (error) {
    logger.error(`Update/send message error: ${error.message}`);
    // Last resort fallback
    try {
      return await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (replyError) {
      logger.error(`Final fallback reply error: ${replyError.message}`);
      return null;
    }
  }
};

module.exports = {
  extractUserInfo,
  formatPrice,
  formatBalance,
  updateOrSendMessage
}; 