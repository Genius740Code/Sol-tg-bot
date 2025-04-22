const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { getSolBalance, getSolPrice, isRateLimited, checkAndRepairUserWallet } = require('../../utils/wallet');
const { logger } = require('../database');
const { updateOrSendMessage, extractUserInfo, formatPrice, formatBalance } = require('../../utils/messageUtils');
const { FEES, ACTIONS } = require('../../../config/constants');

// Store startHandler reference
let startHandler;

// Cache for refresh data to avoid redundant fetches
const refreshCache = new Map();
const REFRESH_CACHE_TTL = 30 * 1000; // 30 seconds

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
    
    // If this is a callback query, acknowledge it immediately
    if (ctx.callbackQuery && typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery().catch(() => {});
    }

    // Get user data
    const userId = userInfo.userId;
    const cacheKey = `refresh_${userId}`;
    const cachedData = refreshCache.get(cacheKey);
    const now = Date.now();
    
    // Start fetching SOL price immediately for maximum responsiveness
    const solPricePromise = getSolPrice().catch(error => {
      logger.error(`Error fetching SOL price: ${error.message}`);
      return FEES.DEFAULT_SOL_PRICE || 100;
    });
    
    // Create menu keyboard
    const menuKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🪙 Buy', 'buy_token'),
        Markup.button.callback('💰 Sell', 'sell_token')
      ],
      [
        Markup.button.callback('🎯 Sniper', 'token_sniper'),
        Markup.button.callback('📈 Copy Trade', 'copy_trading')
      ],
      [
        Markup.button.callback('📊 Positions', 'view_positions'),
        Markup.button.callback('⏰ Orders', 'view_limit_orders')
      ],
      [
        Markup.button.callback('💤 AFK Mode', 'afk_mode'),
        Markup.button.callback('🔌 Extension', 'bot_extension')
      ],
      [
        Markup.button.callback('👥 Referrals', 'view_referrals'),
        Markup.button.callback('👛 Wallets', 'wallet_management')
      ],
      [
        Markup.button.callback('⚙️ Settings', 'settings'),
        Markup.button.callback('🔄 Refresh', 'refresh_data')
      ]
    ]);
    
    // Extract wallet address
    let walletAddress = '--';
    let solBalance = 0;
    let solPrice = 0;
    let balanceUsd = 0;
    let hasReferrer = false;
    
    // Load user in parallel with message display
    const userPromise = userService.getUserByTelegramId(userId);
    
    // If we have cache that's still valid, show it immediately
    let usedCache = false;
    if (cachedData && now - cachedData.timestamp < REFRESH_CACHE_TTL) {
      walletAddress = cachedData.walletAddress;
      solBalance = cachedData.solBalance;
      solPrice = cachedData.solPrice;
      balanceUsd = cachedData.balanceUsd;
      hasReferrer = cachedData.hasReferrer;
      usedCache = true;
    }
    
    // Show initial message with cache data if available, or loading indicators if not
    const feeText = hasReferrer ? 
      `🏷️ You have a referral discount: ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}% trading fee (${FEES.REFERRAL_DISCOUNT}% off)` : 
      `💡 Refer friends to get ${FEES.REFERRAL_DISCOUNT}% off trading fees (${FEES.NORMAL_PERCENTAGE}% → ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}%)`;

    // Initial message text
    let messageText = 
      `🤖 *Crypto Trading Bot* 🤖\n\n` +
      `👛 Wallet: \`${walletAddress}\`\n\n`;
    
    if (usedCache) {
      // Display cached data
      messageText += 
        `💎 SOL Balance: ${solBalance.toFixed(4)} SOL ($${balanceUsd.toFixed(2)})\n` +
        `📈 SOL Price: $${solPrice.toFixed(2)}\n\n` +
        `${feeText}`;
    } else {
      // Show loading indicators with a better message
      messageText += 
        `💎 SOL Balance: Loading...\n` +
        `📈 SOL Price: Loading...\n\n` +
        `${feeText}`;
    }

    // Display initial menu immediately
    const sentMessage = await updateOrSendMessage(ctx, messageText, menuKeyboard);

    // Get user data (already started loading)
    const user = await userPromise;
    
    if (!user) {
      // If we need to direct to start handler
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
    
    // Get updated hasReferrer status from fresh user data
    hasReferrer = user.referredBy !== null;
    
    // Setup timeout promise to ensure we don't wait too long
    const timeoutPromise = ms => new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), ms));
    
    // Wallet check and balance fetching in parallel
    try {
      await checkAndRepairUserWallet(user);
      const activeWallet = user.getActiveWallet();
      walletAddress = activeWallet.address;
    } catch (walletError) {
      logger.error(`Error getting active wallet: ${walletError.message}`);
      walletAddress = user.walletAddress || 'Wallet not available';
    }
    
    // Start balance check now that we have wallet address
    const balancePromise = (walletAddress && walletAddress !== 'Wallet not available' && walletAddress !== '--') ?
      getSolBalance(walletAddress).catch(error => {
        logger.error(`Error fetching SOL balance: ${error.message}`);
        return 0;
      }) : 
      Promise.resolve(0);
    
    try {
      // Get data with timeout - if it takes more than 2.5 seconds, use defaults
      const [newSolPrice, newSolBalance] = await Promise.all([
        Promise.race([solPricePromise, timeoutPromise(2500)]).catch(() => FEES.DEFAULT_SOL_PRICE || 100),
        Promise.race([balancePromise, timeoutPromise(2500)]).catch(() => 0)
      ]);
      
      // Calculate USD value
      const newBalanceUsd = newSolBalance * newSolPrice;
      
      // Update cache
      refreshCache.set(cacheKey, {
        timestamp: now,
        walletAddress,
        solBalance: newSolBalance,
        solPrice: newSolPrice,
        balanceUsd: newBalanceUsd,
        hasReferrer
      });
      
      // Update fee text with current referrer status
      const updatedFeeText = hasReferrer ? 
        `🏷️ You have a referral discount: ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}% trading fee (${FEES.REFERRAL_DISCOUNT}% off)` : 
        `💡 Refer friends to get ${FEES.REFERRAL_DISCOUNT}% off trading fees (${FEES.NORMAL_PERCENTAGE}% → ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}%)`;
      
      // Update message text
      const updatedMessageText = 
        `🤖 *Crypto Trading Bot* 🤖\n\n` +
        `👛 Wallet: \`${walletAddress}\`\n\n` +
        `💎 SOL Balance: ${newSolBalance.toFixed(4)} SOL ($${newBalanceUsd.toFixed(2)})\n` +
        `📈 SOL Price: $${newSolPrice.toFixed(2)}\n\n` +
        `${updatedFeeText}`;
      
      // Update message if we have chat and message IDs
      if (sentMessage && sentMessage.chat && sentMessage.message_id) {
        await ctx.telegram.editMessageText(
          sentMessage.chat.id,
          sentMessage.message_id,
          null,
          updatedMessageText,
          {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: menuKeyboard.reply_markup
          }
        ).catch(err => {
          logger.debug(`Edit message error (probably same content): ${err.message}`);
        });
      } else if (sentMessage && sentMessage.chatId && sentMessage.messageId) {
        await ctx.telegram.editMessageText(
          sentMessage.chatId,
          sentMessage.messageId,
          null,
          updatedMessageText,
          {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: menuKeyboard.reply_markup
          }
        ).catch(err => {
          logger.debug(`Edit message error: ${err.message}`);
        });
      }
      
      return sentMessage;
    } catch (error) {
      logger.error(`Error fetching or updating balance data: ${error.message}`);
      // The initial message with loading indicators or cached data is already displayed
      return sentMessage;
    }
  } catch (error) {
    logger.error(`Refresh handler error: ${error.message}`);
    if (typeof ctx.reply === 'function') {
      return ctx.reply('Sorry, something went wrong. Please try again later or contact support.');
    }
  }
};

// Function to set the start handler to avoid circular dependency
const setStartHandler = (handler) => {
  startHandler = handler;
};

module.exports = {
  refreshHandler,
  setStartHandler
}; 