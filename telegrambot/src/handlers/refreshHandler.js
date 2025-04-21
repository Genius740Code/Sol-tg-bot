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
    
    // Get user from database
    const user = await userService.getUserByTelegramId(userId);
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
    
    // Create menu keyboard (show this immediately)
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
    let hasReferrer = user.referredBy !== null;
    
    // If we have cache that's still valid, use it for initial display
    let usedCache = false;
    if (cachedData && now - cachedData.timestamp < REFRESH_CACHE_TTL) {
      walletAddress = cachedData.walletAddress;
      solBalance = cachedData.solBalance;
      solPrice = cachedData.solPrice;
      balanceUsd = cachedData.balanceUsd;
      hasReferrer = cachedData.hasReferrer;
      usedCache = true;
    } else {
      // Get active wallet info
      try {
        await checkAndRepairUserWallet(user);
        const activeWallet = user.getActiveWallet();
        walletAddress = activeWallet.address;
      } catch (walletError) {
        logger.error(`Error getting active wallet: ${walletError.message}`);
        walletAddress = user.walletAddress || 'Wallet not available';
      }
    }
    
    // Generate fee text based on referrer status
    const feeText = hasReferrer ? 
      `🏷️ You have a referral discount: ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}% trading fee (${FEES.REFERRAL_DISCOUNT}% off)` : 
      `💡 Refer friends to get ${FEES.REFERRAL_DISCOUNT}% off trading fees (${FEES.NORMAL_PERCENTAGE}% → ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}%)`;

    // Initial message text (will be updated with balance)
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
      // Show loading indicators
      messageText += 
        `💎 SOL Balance: --\n` +
        `📈 SOL Price: --\n\n` +
        `${feeText}`;
    }

    // Display initial menu immediately
    const sentMessage = await updateOrSendMessage(ctx, messageText, menuKeyboard);
    
    // If we used cache, update in background and return
    if (usedCache) {
      // Update cache in background
      setTimeout(() => {
        updateBalanceData(ctx, userId, cacheKey, walletAddress, sentMessage);
      }, 100);
      return sentMessage;
    }
    
    // Otherwise, get fresh data and update the message
    try {
      // Fetch SOL price and balance in parallel
      const [newSolPrice, newSolBalance] = await Promise.all([
        getSolPrice(),
        (async () => {
          try {
            if (walletAddress && walletAddress !== 'Wallet not available' && walletAddress !== '--') {
              return await getSolBalance(walletAddress);
            }
            return 0;
          } catch (error) {
            logger.error(`Error fetching SOL balance: ${error.message}`);
            return 0;
          }
        })()
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
      
      // Update message text
      const updatedMessageText = 
        `🤖 *Crypto Trading Bot* 🤖\n\n` +
        `👛 Wallet: \`${walletAddress}\`\n\n` +
        `💎 SOL Balance: ${newSolBalance.toFixed(4)} SOL ($${newBalanceUsd.toFixed(2)})\n` +
        `📈 SOL Price: $${newSolPrice.toFixed(2)}\n\n` +
        `${feeText}`;
      
      // Update message if we have chatId and messageId
      if (sentMessage && sentMessage.chatId && sentMessage.messageId) {
        await ctx.telegram.editMessageText(
          sentMessage.chatId,
          sentMessage.messageId,
          null,
          updatedMessageText,
          {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            ...menuKeyboard
          }
        ).catch(err => {
          logger.error(`Error updating refresh message: ${err.message}`);
        });
      }
      
      return sentMessage;
    } catch (error) {
      logger.error(`Error fetching balance data: ${error.message}`);
      return sentMessage;
    }
  } catch (error) {
    logger.error(`Refresh handler error: ${error.message}`);
    if (typeof ctx.reply === 'function') {
      return ctx.reply('Sorry, something went wrong. Please try again later or contact support.');
    }
  }
};

// Background update function for balance data
async function updateBalanceData(ctx, userId, cacheKey, walletAddress, sentMessage) {
  try {
    // Fetch SOL price and balance in parallel
    const [newSolPrice, newSolBalance] = await Promise.all([
      getSolPrice(),
      (async () => {
        try {
          if (walletAddress && walletAddress !== 'Wallet not available' && walletAddress !== '--') {
            return await getSolBalance(walletAddress);
          }
          return 0;
        } catch (error) {
          logger.error(`Error fetching SOL balance in background: ${error.message}`);
          return 0;
        }
      })()
    ]);
    
    // Get user for current referrer status
    const user = await userService.getUserByTelegramId(userId);
    if (!user) return;
    
    const hasReferrer = user.referredBy !== null;
    
    // Calculate USD value
    const newBalanceUsd = newSolBalance * newSolPrice;
    
    // Update cache
    refreshCache.set(cacheKey, {
      timestamp: Date.now(),
      walletAddress,
      solBalance: newSolBalance,
      solPrice: newSolPrice,
      balanceUsd: newBalanceUsd,
      hasReferrer
    });
    
  } catch (error) {
    logger.error(`Background balance update error: ${error.message}`);
  }
}

// Clean up old cache entries
setInterval(() => {
  try {
    const now = Date.now();
    for (const [key, value] of refreshCache.entries()) {
      if (now - value.timestamp > REFRESH_CACHE_TTL * 2) {
        refreshCache.delete(key);
      }
    }
  } catch (error) {
    logger.error(`Cache cleanup error: ${error.message}`);
  }
}, 60000); // Run every minute

// Expose the handler and utilities
module.exports = { 
  refreshHandler,
  setStartHandler: (handler) => {
    startHandler = handler;
  }
}; 