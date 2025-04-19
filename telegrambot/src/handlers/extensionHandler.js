const { Markup } = require('telegraf');
const extensionService = require('../services/extensionService');
const { logger } = require('../database');
const { extractUserInfo } = require('../../utils/messageUtils');
const config = require('../../../config/config');

/**
 * Handle extension registration
 * Generates a verification code and saves it to the database
 */
const extensionRegisterHandler = async (ctx) => {
  try {
    // Extract user info
    const userInfo = extractUserInfo(ctx);
    if (!userInfo || !userInfo.userId) {
      return ctx.reply('Please use /start to initialize your account first.');
    }
    
    // Extract ref parameter from message if it exists (format: /extension ref_QT_login_extension)
    const message = ctx.message ? ctx.message.text : '';
    const refMatch = message && message.match(/ref_(\w+)/);
    const refSource = refMatch ? refMatch[1] : null;
    
    // User data to save
    const userData = {
      telegramId: userInfo.userId,
      username: userInfo.username
    };
    
    // Create or update extension user and get verification code
    const user = await extensionService.createOrUpdateExtensionUser(userData)
      .catch(error => {
        if (error.message.includes('User not found in main database')) {
          ctx.reply('Please use /start to initialize your account first before using the extension.');
        } else {
          logger.error(`Extension registration error: ${error.message}`);
          ctx.reply('Sorry, there was an error generating your verification code. Please try again later.');
        }
        return null;
      });
    
    if (!user) {
      return;
    }
    
    // Create the verification button with deep link to the extension
    const verificationLink = `https://t.me/${config.BOT_NAME}?start=ref_QT_login_extension`;
    
    // Send message with the verification code
    await ctx.reply(
      `🔐 *Extension Authentication*\n\n` +
      `Your verification code has been generated. Click the button below to open the extension and enter this code:\n\n` +
      `\`${user.verificationCode}\`\n\n` +
      `⚠️ This code will expire in 5 minutes and can only be used once.\n` +
      `🔒 For security reasons, the code will be automatically deleted after successful login.\n` +
      `⏱️ For your protection, you will be automatically logged out after 1 week.`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.url('Get Extension', verificationLink)]
        ])
      }
    );
    
    // Log the request source
    if (refSource) {
      logger.info(`Extension registration from source: ${refSource}, user: ${userInfo.userId}`);
    }
  } catch (error) {
    logger.error(`Extension registration error: ${error.message}`);
    return ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
};

/**
 * Register extension handlers
 */
const registerExtensionHandlers = (bot) => {
  // Extension command
  bot.command('extension', extensionRegisterHandler);
  bot.action('extension_register', extensionRegisterHandler);
  
  // Handle deep link with ref parameter
  bot.hears(/\/start ref_QT_login_extension/, extensionRegisterHandler);
};

module.exports = {
  registerExtensionHandlers,
  extensionRegisterHandler
}; 