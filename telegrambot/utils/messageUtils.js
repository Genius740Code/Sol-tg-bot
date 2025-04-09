/**
 * Utility functions for message handling and formatting in the Telegram bot
 */
const { logger } = require('../src/database');

/**
 * Updates an existing message or sends a new one based on context
 * @param {Object} ctx - Telegraf context or message object
 * @param {String} messageText - The text content of the message
 * @param {Object} keyboard - Inline keyboard markup or other reply markup
 * @returns {Promise<Boolean>} - Success status
 */
const updateOrSendMessage = async (ctx, messageText, keyboard) => {
  try {
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      // Update existing message if it's from a callback
      await ctx.editMessageText(messageText, {
        chat_id: ctx.callbackQuery.message.chat.id,
        message_id: ctx.callbackQuery.message.message_id,
        parse_mode: 'Markdown',
        ...keyboard
      });
      return true;
    } else if (typeof ctx.reply === 'function') {
      // Send new message if using Telegraf context
      await ctx.reply(messageText, {
        parse_mode: 'Markdown',
        ...keyboard
      });
      return true;
    } else if (ctx.chat && ctx.sendMessage) {
      // Fallback for bot instance
      await ctx.sendMessage(ctx.chat.id, messageText, {
        parse_mode: 'Markdown',
        ...keyboard
      });
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Error updating/sending message: ${error.message}`);
    // If edit failed (e.g. content unchanged), just answer callback
    if (ctx.callbackQuery && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery('Current view refreshed').catch(() => {});
    }
    return false;
  }
};

/**
 * Extracts user information from various context formats
 * @param {Object} ctx - Telegraf context or message object
 * @returns {Object|null} - User information or null if not found
 */
const extractUserInfo = (ctx) => {
  try {
    let userInfo = {
      chatId: null,
      userId: null,
      messageId: null,
      firstName: null,
      lastName: null,
      username: null,
      messageText: null
    };
    
    // Extract from callback query
    if (ctx.callbackQuery) {
      userInfo.chatId = ctx.callbackQuery.message.chat.id;
      userInfo.userId = ctx.callbackQuery.from.id;
      userInfo.messageId = ctx.callbackQuery.message.message_id;
      userInfo.firstName = ctx.callbackQuery.from.first_name;
      userInfo.lastName = ctx.callbackQuery.from.last_name;
      userInfo.username = ctx.callbackQuery.from.username;
      userInfo.messageText = ctx.callbackQuery.data || '';
    }
    // Extract from Telegraf message
    else if (ctx.message) {
      userInfo.chatId = ctx.message.chat.id;
      userInfo.userId = ctx.message.from.id;
      userInfo.messageId = ctx.message.message_id;
      userInfo.firstName = ctx.message.from.first_name;
      userInfo.lastName = ctx.message.from.last_name;
      userInfo.username = ctx.message.from.username;
      userInfo.messageText = ctx.message.text || '';
    }
    // Extract from direct message object
    else if (ctx.chat && ctx.from) {
      userInfo.chatId = ctx.chat.id;
      userInfo.userId = ctx.from.id;
      userInfo.messageId = ctx.message_id;
      userInfo.firstName = ctx.from.first_name;
      userInfo.lastName = ctx.from.last_name;
      userInfo.username = ctx.from.username;
      userInfo.messageText = ctx.text || '';
    } else {
      return null;
    }
    
    return userInfo;
  } catch (error) {
    logger.error(`Error extracting user info: ${error.message}`);
    return null;
  }
};

/**
 * Formats a price with appropriate number of decimal places
 * @param {Number} price - The price to format
 * @param {Number} maxDecimals - Maximum number of decimal places
 * @returns {String} - Formatted price
 */
const formatPrice = (price, maxDecimals = 2) => {
  if (price === null || price === undefined || isNaN(price)) return '0.00';
  
  // For very small values, show more decimals
  if (price < 0.0001) return price.toExponential(2);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  
  // Normal case
  return price.toFixed(Math.min(maxDecimals, 2)); 
};

/**
 * Formats a token balance with appropriate number of decimal places
 * @param {Number} balance - The balance to format
 * @param {Number} price - The token price (used to determine decimals)
 * @returns {String} - Formatted balance
 */
const formatBalance = (balance, price = null) => {
  if (balance === null || balance === undefined || isNaN(balance)) return '0';
  
  // Format based on value
  if (balance < 0.0001) return balance.toExponential(2);
  if (balance < 0.01) return balance.toFixed(6);
  if (balance < 1) return balance.toFixed(4);
  if (balance < 1000) return balance.toFixed(2);
  
  // Large numbers with comma separators
  return balance.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

module.exports = {
  updateOrSendMessage,
  extractUserInfo,
  formatPrice,
  formatBalance
}; 