const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { getSolBalance, getSolPrice, isRateLimited } = require('../../utils/wallet');
const { logger } = require('../database');

// Constants for fee calculations
const NORMAL_FEE_PERCENTAGE = 0.8;
const REFERRAL_DISCOUNT_PERCENTAGE = 11;
const REFERRAL_FEE_PERCENTAGE = NORMAL_FEE_PERCENTAGE * (1 - REFERRAL_DISCOUNT_PERCENTAGE/100);

// Main start menu
const startHandler = async (ctx) => {
  try {
    logger.info(`Start command received from user: ${ctx.from.id}`);
    
    // Check rate limit
    if (isRateLimited(ctx.from.id)) {
      return ctx.reply('Please wait a moment before making another request.');
    }
    
    // Initial loading message
    const loadingMsg = await ctx.reply('Loading your account information...');
    
    // Create user if doesn't exist
    let user;
    try {
      user = await userService.getUserByTelegramId(ctx.from.id);
      
      if (!user) {
        // Extract referral code if exists
        let referralCode = null;
        const startPayload = ctx.startPayload;
        if (startPayload && startPayload.length > 0) {
          referralCode = startPayload;
        }
        
        user = await userService.createUser(ctx.from, referralCode);
        
        // Welcome new user
        await ctx.reply(
          `👋 Welcome to the Crypto Trading Bot, ${ctx.from.first_name}!\n\n` +
          `We've created a Solana wallet for you:\n` +
          `${user.walletAddress}\n\n` +
          `This wallet is secured with strong encryption. Keep using the bot to trade SOL and other tokens!`
        );
      }
    } catch (error) {
      logger.error(`Error creating/fetching user: ${error.message}`);
      return ctx.reply(
        'Sorry, we are having trouble connecting to our database. Please try again in a few moments.' +
        '\n\nIf the problem persists, contact support.'
      );
    }
    
    // Update user activity
    await userService.updateUserActivity(ctx.from.id);
    
    // Get SOL balance and price
    let solBalance = 0;
    let solPrice = 0;
    
    try {
      // Get SOL balance
      solBalance = await getSolBalance(user.walletAddress);
    } catch (error) {
      logger.error(`Error fetching SOL balance: ${error.message}`);
      // Continue with zero balance
    }
    
    try {
      // Get SOL price (retry once on failure)
      try {
        solPrice = await getSolPrice();
      } catch (initialError) {
        logger.warn(`First attempt to get SOL price failed: ${initialError.message}, retrying...`);
        // Wait a moment before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        solPrice = await getSolPrice();
      }
    } catch (error) {
      logger.error(`Error fetching SOL price (after retry): ${error.message}`);
      // Use a hardcoded price as fallback
      solPrice = 180.00; // Fallback SOL price
    }
    
    const balanceUsd = solBalance * solPrice;
    
    // Delete loading message
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    } catch (error) {
      // Ignore if deletion fails
    }
    
    // Replace keyboard with inline buttons
    const mainMenuInlineKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💰 Buy', 'buy_token'),
        Markup.button.callback('💸 Sell', 'sell_token')
      ],
      [
        Markup.button.callback('📊 Positions', 'view_positions'),
        Markup.button.callback('📝 Limit Orders', 'view_limit_orders')
      ],
      [
        Markup.button.callback('👥 Copy Trading', 'copy_trading'),
        Markup.button.callback('🔄 Referrals', 'view_referrals')
      ],
      [
        Markup.button.callback('💳 Wallets', 'wallet_management'),
        Markup.button.callback('⚙️ Settings', 'settings')
      ],
      [
        Markup.button.callback('🔄 Refresh', 'refresh_data')
      ]
    ]);
    
    // Calculate referral savings
    const hasReferrer = user.referredBy !== null;
    const feeText = hasReferrer ? 
      `🏷️ You have a referral discount: ${REFERRAL_FEE_PERCENTAGE.toFixed(3)}% trading fee (${REFERRAL_DISCOUNT_PERCENTAGE}% off)` : 
      `💡 Refer friends to get ${REFERRAL_DISCOUNT_PERCENTAGE}% off trading fees (${NORMAL_FEE_PERCENTAGE}% → ${REFERRAL_FEE_PERCENTAGE.toFixed(3)}%)`;
    
    // Send main menu
    return ctx.reply(
      `🤖 *Crypto Trading Bot* 🤖\n\n` +
      `👛 Wallet: \`${user.walletAddress.slice(0, 8)}...${user.walletAddress.slice(-8)}\`\n\n` +
      `💎 SOL Balance: ${solBalance.toFixed(4)} SOL\n` +
      `💵 Value: $${balanceUsd.toFixed(2)}\n` +
      `📈 SOL Price: $${solPrice.toFixed(2)}\n\n` +
      `${feeText}`,
      {
        parse_mode: 'Markdown',
        ...mainMenuInlineKeyboard
      }
    );
  } catch (error) {
    logger.error(`Start handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later or contact support.');
  }
};

// Refresh handler (for 🔄 Refresh button)
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

    // Start by showing loading message
    let loadingMsg;
    if (messageId) {
      await ctx.editMessageText('🔄 Refreshing your data...', {
        chat_id: chatId,
        message_id: messageId
      });
    } else {
      loadingMsg = await ctx.reply('🔄 Refreshing your data...');
    }

    // Then call the startHandler to refresh everything
    await startHandler(ctx);

    // Delete loading message if needed
    if (loadingMsg && !messageId) {
      try {
        await ctx.telegram.deleteMessage(chatId, loadingMsg.message_id);
      } catch (error) {
        // Ignore if deletion fails
      }
    }
  } catch (error) {
    logger.error(`Refresh handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later or contact support.');
  }
};

module.exports = { startHandler, refreshHandler }; 