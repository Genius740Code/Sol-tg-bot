const { getUserByTelegramId, createUser, updateUserActivity } = require('../services/userService');
const { checkAndRepairUserWallet, getSolPrice, isRateLimited } = require('../../utils/wallet');
const { logger } = require('../database');
const { refreshHandler } = require('./refreshHandler');
const { updateOrSendMessage, extractUserInfo, formatPrice } = require('../../utils/messageUtils');

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
    
    // Lookup user in database
    let user = await getUserByTelegramId(userInfo.userId);
    
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
    
    // Get user and SOL price in parallel
    const [existingUser, solPrice] = await Promise.all([
      getUserByTelegramId(userInfo.userId),
      getSolPrice()
    ]);
    
    let isNewUser = false;
    
    if (!existingUser) {
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
        // Handle the error gracefully
        if (typeof ctx.reply === 'function') {
          ctx.reply('❌ There was an error creating your account. Please try again later.');
        }
        return;
      }
    } else {
      user = existingUser;
      
      // Reset any existing state that might be causing issues
      if (user.state) {
        user.state = null;
        await user.save();
        logger.info(`Reset state for user: ${user.telegramId}`);
      }
    }
    
    // Ensure wallet is properly structured - this will create a new wallet if needed
    const walletCreated = await checkAndRepairUserWallet(user);
    
    // Send welcome message for new users, or show main menu for returning users
    if (isNewUser || walletCreated) {
      try {
        // Always get the active wallet to ensure we're using the correct one
        const activeWallet = user.getActiveWallet ? user.getActiveWallet() : (user.wallets && user.wallets.length > 0 ? user.wallets.find(w => w.isActive) : null);
        
        if (activeWallet && activeWallet.address) {
          // For new users, send a welcome message first
          const welcomeMessage = `🎉 *Welcome to the Solana Bot!*\n\nYour wallet has been created:\n\`${activeWallet.address}\`\n\nSOL Price: $${formatPrice(solPrice)}\n\nUse /help to see all available commands.`;
          
          await updateOrSendMessage(ctx, welcomeMessage, {});
          
          // Short delay to ensure messages are ordered properly
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (walletError) {
        logger.error(`Error displaying wallet for new user: ${walletError.message}`);
      }
    }
    
    // Show main menu for all users (using refreshHandler)
    await refreshHandler(ctx);
    
    // Update user activity
    await updateUserActivity(userInfo.userId);
    
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