const { Markup } = require('telegraf');
const userService = require('./services/userService');
const { getSolBalance, getSolPrice, isRateLimited, checkAndRepairUserWallet } = require('../utils/wallet');
const { logger } = require('./database');

const FEES = require('../../config/constants').FEES;

// Cache for refresh data to prevent redundant fetches
const refreshCache = new Map();
const REFRESH_CACHE_TTL = 30 * 1000; // 30 seconds

// Define startHandler reference - will be set later to avoid circular dependency
let startHandler;

/**
 * Progressive refresh handler that shows data as it becomes available
 * @param {Object} ctx - Telegram context
 * @returns {Promise<void>}
 */
const refreshHandler = async (ctx) => {
  try {
    // Try to get callback query first, then message
    let chatId, messageId;

    // Handle both callback query and direct message
    if (ctx.callbackQuery) {
      chatId = ctx.callbackQuery.message.chat.id;
      messageId = ctx.callbackQuery.message.message_id;
      await ctx.answerCbQuery('Refreshing data...');
    } else {
      chatId = ctx.message.chat.id;
    }

    // Generate a unique cache key for this user
    const userId = ctx.from.id;
    const cacheKey = `refresh_${userId}`;
    const now = Date.now();
    
    // Always start the SOL price request immediately for faster response
    const solPricePromise = getSolPrice().catch(error => {
      logger.error(`Error fetching SOL price: ${error.message}`);
      return FEES.DEFAULT_SOL_PRICE || 100;
    });
    
    // Get user data
    const user = await userService.getUserByTelegramId(userId);
    if (!user) {
      // If startHandler is not available yet (avoid circular dependency)
      if (!startHandler) {
        startHandler = require('./startHandler').startHandler;
      }
      return startHandler(ctx);
    }
    
    // Check and repair wallet if needed
    await checkAndRepairUserWallet(user);
    
    // Get active wallet with error handling
    let activeWallet = null;
    let walletAddress = 'Wallet not available';
    
    try {
      activeWallet = user.getActiveWallet();
      walletAddress = activeWallet.address;
    } catch (walletError) {
      logger.error(`Error getting active wallet in refresh: ${walletError.message}`);
      walletAddress = user.walletAddress || 'Wallet not available';
    }
    
    // Check if we have recent cached data
    const cachedData = refreshCache.get(cacheKey);
    
    // Prepare initial data with placeholder values
    const refreshData = {
      user,
      walletAddress,
      solBalance: null,
      solPrice: null,
      balanceUsd: null,
      hasReferrer: user.referredBy !== null,
      referralCount: user.referrals ? user.referrals.length : 0
    };
    
    // Use cached values if they're recent (last 30 seconds)
    if (cachedData && now - cachedData.timestamp < REFRESH_CACHE_TTL) {
      // Use cached values for anything we have
      if (cachedData.data.solPrice) refreshData.solPrice = cachedData.data.solPrice;
      if (cachedData.data.solBalance) refreshData.solBalance = cachedData.data.solBalance;
      if (cachedData.data.balanceUsd) refreshData.balanceUsd = cachedData.data.balanceUsd;
      
      // Send message with cached data
      refreshData.partial = false;
      await sendRefreshMessage(ctx, refreshData, chatId, messageId);
      
      // Start updating cache in background for next time
      setTimeout(() => {
        updateCacheInBackground(userId, cacheKey, walletAddress);
      }, 100);
      
      return;
    }
    
    // If we don't have cached data, send an immediate response with loading placeholders
    refreshData.partial = true;
    await sendRefreshMessage(ctx, refreshData, chatId, messageId);
    
    // Get SOL balance in parallel with price that's already being fetched
    const solBalancePromise = (async () => {
      try {
        if (walletAddress && walletAddress !== 'Wallet not available') {
          return await getSolBalance(walletAddress);
        }
        return 0;
      } catch (error) {
        logger.error(`Error fetching SOL balance: ${error.message}`);
        return 0;
      }
    })();
    
    // Wait for both promises to resolve
    const [solPrice, solBalance] = await Promise.all([
      solPricePromise,
      solBalancePromise
    ]);

    // Calculate USD balance
    const balanceUsd = solBalance * solPrice;
    
    // Update refresh data with real values
    refreshData.solBalance = solBalance;
    refreshData.solPrice = solPrice;
    refreshData.balanceUsd = balanceUsd;
    refreshData.partial = false;
    
    // Cache the data for future use
    refreshCache.set(cacheKey, {
      timestamp: now,
      data: refreshData
    });
    
    // Send the final message with all data
    await sendRefreshMessage(ctx, refreshData, chatId, messageId);
  } catch (error) {
    logger.error(`Refresh handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later or contact support.');
  }
};

/**
 * Background update function to keep cache fresh
 * @param {string|number} userId - User ID
 * @param {string} cacheKey - Cache key
 * @param {string} walletAddress - Wallet address
 */
async function updateCacheInBackground(userId, cacheKey, walletAddress) {
  try {
    // Skip if address is invalid
    if (!walletAddress || walletAddress === 'Wallet not available') return;
    
    // Get latest data
    const [solPrice, solBalance] = await Promise.all([
      getSolPrice(),
      getSolBalance(walletAddress)
    ]);
    
    const balanceUsd = solBalance * solPrice;
    
    // Get the existing cached data
    const cachedData = refreshCache.get(cacheKey);
    if (!cachedData) return;
    
    // Update just the fields that matter
    cachedData.timestamp = Date.now();
    cachedData.data.solPrice = solPrice;
    cachedData.data.solBalance = solBalance;
    cachedData.data.balanceUsd = balanceUsd;
    
    // Save updated cache
    refreshCache.set(cacheKey, cachedData);
  } catch (error) {
    logger.error(`Background cache update error: ${error.message}`);
  }
}

/**
 * Helper function to send the refresh message with current data
 * @param {Object} ctx - Telegram context
 * @param {Object} data - Refresh data object
 * @param {string|number} chatId - Chat ID
 * @param {string|number} messageId - Message ID (if updating)
 */
async function sendRefreshMessage(ctx, data, chatId, messageId) {
  try {
    // Calculate referral savings
    const feePercentage = data.hasReferrer ? FEES.REFERRAL_PERCENTAGE : FEES.NORMAL_PERCENTAGE;
    const feeText = data.hasReferrer ? 
      `🏷️ You have a referral discount: ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}% trading fee (${FEES.REFERRAL_DISCOUNT}% off)` : 
      `💡 Refer friends to get ${FEES.REFERRAL_DISCOUNT}% off trading fees (${FEES.NORMAL_PERCENTAGE}% → ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}%)`;
    
    // Additional stats to show
    const statsText = data.referralCount > 0 ? 
      `\n👥 Referrals: ${data.referralCount}` : '';
    
    // Build the main menu inline keyboard
    const mainMenuInlineKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💰 Buy', 'buy_placeholder'),
        Markup.button.callback('💸 Sell', 'sell_token')
      ],
      [
        Markup.button.callback('💤 AFK Mode', 'afk_mode'),
        Markup.button.callback('📊 Positions', 'view_positions')
      ],
      [
        Markup.button.callback('⏰ Orders', 'view_limit_orders'),
        Markup.button.callback('👥 Referrals', 'view_referrals')
      ],
      [
        Markup.button.callback('👛 Wallets', 'wallet_management'),
        Markup.button.callback('⚙️ Settings', 'settings')
      ],
      [
        Markup.button.callback('🔄 Refresh', 'refresh_data')
      ]
    ]);

    // Create message text based on available data
    const solBalanceText = data.solBalance !== null ? 
      `💎 SOL Balance: ${data.solBalance.toFixed(4)} SOL` + 
      (data.balanceUsd !== null ? ` ($${data.balanceUsd.toFixed(2)})` : '') : 
      '💎 SOL Balance: --';
    
    const solPriceText = data.solPrice !== null ? 
      `📈 SOL Price: $${data.solPrice.toFixed(2)}` : 
      '📈 SOL Price: --';
    
    // Build complete message
    const messageText = `🤖 *Crypto Trading Bot* 🤖\n\n` +
      `👛 Wallet: \`${data.walletAddress}\`\n\n` +
      `${solBalanceText}\n` +
      `${solPriceText}\n\n` +
      `${feeText}${statsText}`;
      
    // Send or update message
    if (messageId) {
      try {
        await ctx.telegram.editMessageText(
          chatId,
          messageId,
          null,
          messageText,
          {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: mainMenuInlineKeyboard.reply_markup
          }
        );
      } catch (error) {
        // If message can't be edited (e.g. same content), just ignore
        logger.debug(`Edit message error (probably same content): ${error.message}`);
      }
    } else {
      await ctx.reply(messageText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: mainMenuInlineKeyboard.reply_markup
      });
    }
  } catch (error) {
    logger.error(`Error in sendRefreshMessage: ${error.message}`);
    // Try a simpler fallback message if needed
    try {
      const fallbackMessage = `*Crypto Trading Bot*\n\nWallet: ${data.walletAddress}\n\nUse /refresh to update your data.`;
      if (messageId) {
        await ctx.telegram.editMessageText(chatId, messageId, null, fallbackMessage, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(fallbackMessage, { parse_mode: 'Markdown' });
      }
    } catch (fallbackError) {
      logger.error(`Fallback message also failed: ${fallbackError.message}`);
    }
  }
}
