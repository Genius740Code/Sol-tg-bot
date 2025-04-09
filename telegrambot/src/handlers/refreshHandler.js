const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { getSolBalance, getSolPrice, isRateLimited, checkAndRepairUserWallet } = require('../../utils/wallet');
const { logger } = require('../database');
const { updateOrSendMessage, extractUserInfo, formatPrice, formatBalance } = require('../../utils/messageUtils');
const { FEES, ACTIONS } = require('../../utils/constants');

// Store startHandler reference
let startHandler;

// Refresh handler (for 🔄 Refresh button)
const refreshHandler = async (ctx) => {
  try {
    // Extract user info from context
    const userInfo = extractUserInfo(ctx);
    
    if (!userInfo || !userInfo.userId) {
      logger.error(`Missing user information in refreshHandler`);
      if (userInfo && userInfo.chatId) {
        if (typeof ctx.telegram?.sendMessage === 'function') {
          ctx.telegram.sendMessage(userInfo.chatId, 'Error: Could not identify user. Please try /start again.').catch(() => {});
        }
      }
      return;
    }
    
    // If this is a callback query, acknowledge it
    if (ctx.callbackQuery && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery().catch(() => {});
    }

    // Get user data
    const user = await userService.getUserByTelegramId(userInfo.userId);
    if (!user) {
      // If we need to direct to start handler
      if (typeof ctx.reply === 'function') {
        // Check if startHandler is available
        if (!startHandler) {
          try {
            startHandler = require('./startHandler').startHandler;
          } catch (e) {
            logger.error(`Could not load startHandler: ${e.message}`);
            return ctx.reply('Please use /start to initialize your account.').catch(() => {});
          }
        }
        return startHandler(ctx);
      }
      return;
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
    
    // Get SOL price and balance in parallel
    const [solPrice, solBalance] = await Promise.all([
      getSolPrice(),
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

    const balanceUsd = solBalance * solPrice;
    
    // Calculate referral savings
    const hasReferrer = user.referredBy !== null;
    const feeText = hasReferrer ? 
      `🏷️ You have a referral discount: ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}% trading fee (${FEES.REFERRAL_DISCOUNT}% off)` : 
      `💡 Refer friends to get ${FEES.REFERRAL_DISCOUNT}% off trading fees (${FEES.NORMAL_PERCENTAGE}% → ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}%)`;
    
    // Build the main menu inline keyboard
    const mainMenuInlineKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💰 Buy', ACTIONS.BUY),
        Markup.button.callback('💸 Sell', ACTIONS.SELL)
      ],
      [
        Markup.button.callback('📊 Positions', ACTIONS.POSITIONS),
        Markup.button.callback('🔄 Referrals', ACTIONS.REFERRALS)
      ],
      [
        Markup.button.callback('📝 Limit Orders', ACTIONS.LIMIT_ORDERS),
        Markup.button.callback('👥 Copy Trading', ACTIONS.COPY_TRADING)
      ],
      [
        Markup.button.callback('💳 Wallets', ACTIONS.WALLETS),
        Markup.button.callback('⚙️ Settings', ACTIONS.SETTINGS)
      ],
      [
        Markup.button.callback('🔄 Refresh', ACTIONS.REFRESH)
      ]
    ]);

    // Create message text
    const messageText = 
      `🤖 *Crypto Trading Bot* 🤖\n\n` +
      `👛 Wallet: \`${walletAddress}\`\n\n` +
      `💎 SOL Balance: ${formatBalance(solBalance)} SOL\n` +
      `💵 Value: $${formatPrice(balanceUsd)}\n` +
      `📈 SOL Price: $${formatPrice(solPrice)}\n\n` +
      `${feeText}`;

    // Update or send message using utility function
    return updateOrSendMessage(ctx, messageText, mainMenuInlineKeyboard);
    
  } catch (error) {
    logger.error(`Refresh handler error: ${error.message}`);
    if (typeof ctx.reply === 'function') {
      return ctx.reply('Sorry, something went wrong. Please try again later or contact support.');
    }
  }
};

// Expose the handler and utilities
module.exports = { 
  refreshHandler,
  setStartHandler: (handler) => {
    startHandler = handler;
  }
}; 