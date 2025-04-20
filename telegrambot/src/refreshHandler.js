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
    
    // Check if we have recent cached data
    const cachedData = refreshCache.get(cacheKey);
    if (cachedData && now - cachedData.timestamp < REFRESH_CACHE_TTL) {
      // Use cached data and return immediately for a fast response
      await sendRefreshMessage(ctx, cachedData.data, chatId, messageId);
      
      // Optionally update data in background for next refresh
      updateCacheInBackground(userId, cacheKey);
      return;
    }

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
    
    // First, do a quick check if we have partial cached data
    const partialCache = refreshCache.get(cacheKey);
    if (partialCache) {
      // Use cached values for anything we have
      if (partialCache.data.solPrice) refreshData.solPrice = partialCache.data.solPrice;
      if (partialCache.data.solBalance) refreshData.solBalance = partialCache.data.solBalance;
    }
    
    // Send intermediate message with partial data if we have it
    if (refreshData.solPrice || refreshData.solBalance) {
      refreshData.partial = true;
      await sendRefreshMessage(ctx, refreshData, chatId, messageId);
    }
    
    // Get SOL price and balance in parallel
    const [solPrice, solBalance] = await Promise.all([
      getSolPrice().catch(error => {
        logger.error(`Error fetching SOL price: ${error.message}`);
        return FEES.DEFAULT_SOL_PRICE || 100;
      }),
      (async () => {
        try {
          if (walletAddress && walletAddress !== 'Wallet not available') {
            return await getSolBalance(walletAddress);
          }
          return 0;
        } catch (error) {
          logger.error(`Error fetching SOL balance: ${error.message}`);
          return 0;
        }
      })()
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
        Markup.button.callback('📊 Positions', 'view_positions'),
        Markup.button.callback('🔄 Referrals', 'view_referrals')
      ],
      [
        Markup.button.callback('📝 Limit Orders', 'view_limit_orders'),
        Markup.button.callback('👥 Copy Trading', 'copy_trading_placeholder')
      ],
      [
        Markup.button.callback('💳 Wallets', 'wallet_management'),
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
    
    // Display loading indicator for partial data
    const loadingIndicator = data.partial ? '\n\n⏳ Updating...' : '';
    
    const messageText = 
      `