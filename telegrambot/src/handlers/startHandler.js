const { getUserByTelegramId, createUser, updateUserActivity } = require('../services/userService');
const { checkAndRepairUserWallet, getSolPrice, getSolBalance, isRateLimited } = require('../../utils/wallet');
const { logger } = require('../database');
const { refreshHandler } = require('./refreshHandler');
const { updateOrSendMessage, extractUserInfo, formatPrice } = require('../../utils/messageUtils');
const { Markup } = require('telegraf');
const { FEES } = require('../../../config/constants');

/**
 * Handler for /start command
 * @param {TelegramBot|Telegraf context} ctx - Telegram bot instance or Telegraf context
 */
const startHandler = async (ctx) => {
  try {
    // Extract user information
    const userInfo = extractUserInfo(ctx);
    
    if (!userInfo || !userInfo.userId) {
      return ctx.reply('Error: Could not identify user. Please try again or contact support.');
    }
    
    // Check rate limiting
    if (isRateLimited(userInfo.userId)) {
      if (typeof ctx.reply === 'function') {
        ctx.reply('⚠️ Please slow down. Try again in a few seconds.');
      } else if (ctx.sendMessage) {
        ctx.sendMessage(userInfo.chatId, '⚠️ Please slow down. Try again in a few seconds.');
      }
      return;
    }

    // Extract referral code if any
    let referralCode = null;
    if (userInfo.messageText && typeof userInfo.messageText === 'string') {
      const parts = userInfo.messageText.split(' ');
      if (parts.length > 1) {
        referralCode = parts[1]; // Format: /start referralCode
      }
    }
    
    // Start fetching SOL price immediately (don't wait for it)
    const solPricePromise = getSolPrice();
    
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
    
    // Start loading user data in parallel with first message
    const userPromise = getUserByTelegramId(userInfo.userId);
    
    // Show initial loading message with keyboard while data loads
    let initialMsg = `🤖 *Crypto Trading Bot* 🤖\n\n`+
                    `Loading your data...\n\n`+
                    `Use the buttons below to navigate:`;
    
    // Send initial message with keyboard to make UI feel responsive
    const sentMessage = await ctx.reply(initialMsg, {
      parse_mode: 'Markdown',
      reply_markup: menuKeyboard.reply_markup
    });
    
    // Now get user from database (already started loading)
    let user = await userPromise;
    let isNewUser = false;
    let walletAddress = 'Wallet not available';
    
    if (!user) {
      // Create user object with available data
      const userData = { 
        id: userInfo.userId, 
        first_name: userInfo.firstName,
        last_name: userInfo.lastName,
        username: userInfo.username
      };
      
      try {
        user = await createUser(userData, referralCode);
        isNewUser = true;
      } catch (createError) {
        logger.error(`Error creating user: ${createError.message}`);
        if (typeof ctx.reply === 'function') {
          ctx.reply('❌ There was an error creating your account. Please try again later.');
        }
        return;
      }
    } else {
      // Reset any existing state that might be causing issues
      if (user.state) {
        user.state = null;
        await user.save();
      }
    }
    
    // Ensure wallet is properly structured in parallel with message update
    // Capture whether a wallet was created
    const walletCreated = await checkAndRepairUserWallet(user);
    
    // Try to get the active wallet immediately
    try {
      const activeWallet = user.getActiveWallet ? user.getActiveWallet() : (user.wallets && user.wallets.length > 0 ? user.wallets.find(w => w.isActive) : null);
      if (activeWallet && activeWallet.address) {
        walletAddress = activeWallet.address;
      }
    } catch (walletError) {
      logger.error(`Error getting active wallet: ${walletError.message}`);
    }
    
    // Start fetching balance while waiting for other operations
    const balancePromise = walletAddress !== 'Wallet not available' ? 
      getSolBalance(walletAddress) : 
      Promise.resolve(0);
    
    // Generate fee text based on referrer status
    const hasReferrer = user.referredBy !== null;
    const feeText = hasReferrer ? 
      `🏷️ You have a referral discount: ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}% trading fee (${FEES.REFERRAL_DISCOUNT}% off)` : 
      `💡 Refer friends to get ${FEES.REFERRAL_DISCOUNT}% off trading fees (${FEES.NORMAL_PERCENTAGE}% → ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}%)`;
    
    // We should now have the correct wallet from checkAndRepairUserWallet
    if (walletAddress === 'Wallet not available') {
      try {
        const updatedActiveWallet = user.getActiveWallet ? user.getActiveWallet() : (user.wallets && user.wallets.length > 0 ? user.wallets.find(w => w.isActive) : null);
        if (updatedActiveWallet && updatedActiveWallet.address) {
          walletAddress = updatedActiveWallet.address;
        }
      } catch (walletError) {
        logger.error(`Error getting active wallet after repair: ${walletError.message}`);
      }
    }
    
    // Get SOL price and balance in parallel
    // Set a timeout for the promises to ensure we don't wait too long
    const timeoutPromise = ms => new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), ms));
    
    try {
      // Get data with timeout - if it takes more than 2 seconds, we'll use defaults
      const [solPrice, solBalance] = await Promise.all([
        Promise.race([solPricePromise, timeoutPromise(2000)]).catch(() => FEES.DEFAULT_SOL_PRICE || 100),
        Promise.race([balancePromise, timeoutPromise(2000)]).catch(() => 0)
      ]);
      
      // Calculate USD value
      const balanceUsd = solBalance * solPrice;
      
      // Update message with actual data
      const updatedMessageText = 
        `🤖 *Crypto Trading Bot* 🤖\n\n` +
        `👛 Wallet: \`${walletAddress}\`\n\n` +
        `💎 SOL Balance: ${solBalance.toFixed(4)} SOL ($${balanceUsd.toFixed(2)})\n` +
        `📈 SOL Price: $${solPrice.toFixed(2)}\n\n` +
        `${feeText}`;
      
      // Update initial message with loaded data
      if (sentMessage) {
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
          logger.debug(`Edit message error: ${err.message}`);
        });
      }
    } catch (dataError) {
      logger.error(`Error fetching or displaying SOL data: ${dataError.message}`);
      // The initial message is already displayed, so we'll continue
    }
    
    // Handle welcome message for new users
    if (isNewUser || walletCreated) {
      try {
        const activeWallet = user.getActiveWallet ? user.getActiveWallet() : (user.wallets && user.wallets.length > 0 ? user.wallets.find(w => w.isActive) : null);
        
        if (activeWallet && activeWallet.address) {
          const solPrice = await solPricePromise.catch(() => FEES.DEFAULT_SOL_PRICE || 100);
          
          // For new users, send a separate welcome message
          const welcomeMessage = `🎉 *Welcome to the Solana Bot!*\n\nYour wallet has been created:\n\`${activeWallet.address}\`\n\nSOL Price: $${formatPrice(solPrice)}\n\nUse /help to see all available commands.`;
          
          await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
        }
      } catch (walletError) {
        logger.error(`Error displaying wallet for new user: ${walletError.message}`);
      }
    }
    
    // Update user activity in background
    updateUserActivity(userInfo.userId).catch(err => 
      logger.error(`Error updating user activity: ${err.message}`)
    );
    
  } catch (error) {
    logger.error(`Error in startHandler: ${error.message}`);
    // Handle error message based on context type
    if (typeof ctx.reply === 'function') {
      ctx.reply('❌ Sorry, something went wrong. Please try again later.');
    } else if (ctx.chat && ctx.sendMessage) {
      ctx.sendMessage(ctx.chat.id, '❌ Sorry, something went wrong. Please try again later.');
    }
  }
};

// Initialize circular dependency resolution
require('./refreshHandler').setStartHandler(startHandler);

module.exports = { startHandler }; 