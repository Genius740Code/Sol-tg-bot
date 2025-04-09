const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { getSolBalance, getSolPrice, isRateLimited, checkAndRepairUserWallet } = require('../../utils/wallet');
const { logger } = require('../database');

// Constants for fee calculations
const NORMAL_FEE_PERCENTAGE = 0.8;
const REFERRAL_DISCOUNT_PERCENTAGE = 11;
const REFERRAL_FEE_PERCENTAGE = NORMAL_FEE_PERCENTAGE * (1 - REFERRAL_DISCOUNT_PERCENTAGE/100);

// Define startHandler reference - will be set later to avoid circular dependency
let startHandler;

// Refresh handler (for 🔄 Refresh button)
const refreshHandler = async (ctx) => {
  try {
    // Try to get callback query first, then message
    let chatId, messageId;

    // Handle both callback query and direct message
    if (ctx.callbackQuery) {
      chatId = ctx.callbackQuery.message.chat.id;
      messageId = ctx.callbackQuery.message.message_id;
      await ctx.answerCbQuery();
    } else {
      chatId = ctx.message.chat.id;
    }

    // Get user and data
    const user = await userService.getUserByTelegramId(ctx.from.id);
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
      `🏷️ You have a referral discount: ${REFERRAL_FEE_PERCENTAGE.toFixed(3)}% trading fee (${REFERRAL_DISCOUNT_PERCENTAGE}% off)` : 
      `💡 Refer friends to get ${REFERRAL_DISCOUNT_PERCENTAGE}% off trading fees (${NORMAL_FEE_PERCENTAGE}% → ${REFERRAL_FEE_PERCENTAGE.toFixed(3)}%)`;
    
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

    // Update the message with fresh data
    if (messageId) {
      await ctx.editMessageText(
        `🤖 *Crypto Trading Bot* 🤖\n\n` +
        `👛 Wallet: \`${walletAddress}\`\n\n` +
        `💎 SOL Balance: ${solBalance.toFixed(4)} SOL\n` +
        `💵 Value: $${balanceUsd.toFixed(2)}\n` +
        `📈 SOL Price: $${solPrice.toFixed(2)}\n\n` +
        `${feeText}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          ...mainMenuInlineKeyboard
        }
      );
    } else {
      return ctx.reply(
        `🤖 *Crypto Trading Bot* 🤖\n\n` +
        `👛 Wallet: \`${walletAddress}\`\n\n` +
        `💎 SOL Balance: ${solBalance.toFixed(4)} SOL\n` +
        `💵 Value: $${balanceUsd.toFixed(2)}\n` +
        `📈 SOL Price: $${solPrice.toFixed(2)}\n\n` +
        `${feeText}`,
        {
          parse_mode: 'Markdown',
          ...mainMenuInlineKeyboard
        }
      );
    }
  } catch (error) {
    logger.error(`Refresh handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later or contact support.');
  }
};

// Set up module exports
module.exports = { 
  refreshHandler,
  setStartHandler: (handler) => {
    startHandler = handler;
  }
}; 