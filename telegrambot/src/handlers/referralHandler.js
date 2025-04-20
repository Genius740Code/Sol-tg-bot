const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { logger } = require('../database');
const { isRateLimited } = require('../../utils/wallet');
const { FEES, MESSAGE } = require('../../../config/constants');
const { updateOrSendMessage } = require('../../utils/messageUtils');

// Helper function to properly escape special characters for Markdown
const escapeMarkdown = (text) => {
  if (!text) return '';
  // Only escape underscore and backtick for traditional Markdown
  return text.toString().replace(/([_`])/g, '\\$1');
};

// Show referral information with the updated display
const referralHandler = async (ctx) => {
  try {
    // Check rate limit
    if (isRateLimited(ctx.from.id)) {
      return ctx.reply('Please wait a moment before making another request.');
    }
    
    // Get user's referral information
    const referralInfo = await userService.getReferralInfo(ctx.from.id);
    
    if (!referralInfo) {
      return ctx.reply('Failed to retrieve your referral information. Please try again.');
    }
    
    // Create bot username to use in referral link
    const botUsername = ctx.botInfo.username;
    
    // Get first/main referral code to display
    const mainCode = referralInfo.referralCode;
    const referralLink = `https://t.me/${botUsername}?start=${mainCode}`;
    
    // Get custom code if exists (should only be 1 now)
    const customCode = referralInfo.customReferralCodes && referralInfo.customReferralCodes.length > 0 
      ? referralInfo.customReferralCodes[0].code
      : null;
      
    // Create referral message with the requested format
    let message = `📈 *Referrals*\n\n`;
    
    // Add tier information using stats from referralInfo
    message += `*Tier 1*\n`;
    message += `• Users: ${referralInfo.stats.tier1.users}\n`;
    message += `• Volume: ${referralInfo.stats.tier1.volume} SOL\n`;
    message += `• Earnings: ${referralInfo.stats.tier1.earnings} SOL\n\n`;
    
    message += `*Tier 2*\n`;
    message += `• Users: ${referralInfo.stats.tier2.users}\n`;
    message += `• Volume: ${referralInfo.stats.tier2.volume} SOL\n`;
    message += `• Earnings: ${referralInfo.stats.tier2.earnings} SOL\n\n`;
    
    message += `*Tier 3*\n`;
    message += `• Users: ${referralInfo.stats.tier3.users}\n`;
    message += `• Volume: ${referralInfo.stats.tier3.volume} SOL\n`;
    message += `• Earnings: ${referralInfo.stats.tier3.earnings} SOL\n\n`;
    
    // Add explanation of tier system
    message += `*Referral Rewards*\n`;
    message += `• Tier 1 - Direct Referrals: Earn ${FEES.TIER1_PERCENTAGE}% of Nova's ${FEES.NORMAL_PERCENTAGE}% fee on every trade.\n`;
    message += `• Tier 2 - Indirect Referrals: Earn ${FEES.TIER2_PERCENTAGE}% of Nova's ${FEES.NORMAL_PERCENTAGE}% fee on every trade.\n`;
    message += `• Tier 3 - Extended Referrals: Earn ${FEES.TIER3_PERCENTAGE}% of Nova's ${FEES.NORMAL_PERCENTAGE}% fee on every trade.\n\n`;
    
    // Add referral code information - properly escape the codes
    message += `📋 *Your Referral Code:* \`${escapeMarkdown(mainCode)}\`\n`;
    
    // Add custom code if exists
    if (customCode) {
      message += `📝 *Custom Code:* \`${escapeMarkdown(customCode)}\`\n`;
    }
    
    message += `\n🔗 *Share Link:* \`${escapeMarkdown(referralLink)}\`\n\n`;
    
    // Create keyboard for sharing and managing referral codes
    const referralKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.url('Share on Telegram', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join me on this awesome crypto trading bot! You get 11% off on fees and I earn rewards when you trade!')}`)
      ],
      [
        Markup.button.callback('✏️ Change Code', 'create_referral_code')
      ],
      [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
    ]);
    
    // Use updateOrSendMessage instead of ctx.reply to update existing message
    return updateOrSendMessage(ctx, message, referralKeyboard);
    
  } catch (error) {
    logger.error(`Referral handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Custom referral code handler - renamed for consistency but keeping the action name the same
const createReferralCodeHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '✏️ *Change Referral Code*\n\n' +
      'Please enter a new referral code (4-15 alphanumeric characters).\n\n' +
      'This will replace your current referral code.',
      {
        parse_mode: 'Markdown' // Use standard Markdown
      }
    );
    
    // Set user state for handling input
    await userService.updateUserSettings(ctx.from.id, { state: 'CREATING_REFERRAL_CODE' });
  } catch (error) {
    logger.error(`Create referral code error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Handle text input for referral code creation
const handleReferralCodeInput = async (ctx) => {
  try {
    const code = ctx.message.text.trim();
    
    // Validate code format
    if (!code.match(/^[a-zA-Z0-9]{4,15}$/)) {
      return ctx.reply(
        '❌ Invalid code format. Code must be 4-15 alphanumeric characters.\n\n' +
        'Please try again:',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Cancel', 'view_referrals')]
          ])
        }
      );
    }
    
    try {
      // Add custom referral code and replace any existing ones
      await userService.addCustomReferralCode(ctx.from.id, code);
      
      // Create link with the new code
      const botUsername = ctx.botInfo.username;
      const referralLink = `https://t.me/${botUsername}?start=${code}`;
      
      // Reset user state
      await userService.updateUserSettings(ctx.from.id, { state: null });
      
      return ctx.reply(
        '✅ *Referral Code Updated!*\n\n' +
        `Your new referral code: \`${escapeMarkdown(code)}\`\n\n` +
        `Share this link: \`${escapeMarkdown(referralLink)}\``,
        {
          parse_mode: 'Markdown', // Use standard Markdown
          ...Markup.inlineKeyboard([
            [
              Markup.button.url('Share on Telegram', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join me on this awesome crypto trading bot! You get 11% off on fees and I earn rewards when you trade!')}`)
            ],
            [Markup.button.callback('🔙 Back to Referrals', 'view_referrals')]
          ])
        }
      );
    } catch (error) {
      logger.error(`Error adding custom referral code: ${error.message}`);
      return ctx.reply(
        `❌ Error: ${error.message}\n\n` +
        'Please try a different code:',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Cancel', 'view_referrals')]
          ])
        }
      );
    }
  } catch (error) {
    logger.error(`Handle referral code input error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Change main referral code handler
const changeMainCodeHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '✏️ *Change Main Referral Code*\n\n' +
      'Please enter a new main referral code (4-15 alphanumeric characters).\n\n' +
      'This will replace your default referral code that is shown to others.',
      {
        parse_mode: 'Markdown' // Use standard Markdown
      }
    );
    
    // Set user state for handling input
    await userService.updateUserSettings(ctx.from.id, { state: 'CHANGING_MAIN_REFERRAL_CODE' });
  } catch (error) {
    logger.error(`Change main referral code error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Handle text input for main referral code change
const handleMainCodeInput = async (ctx) => {
  try {
    const code = ctx.message.text.trim();
    
    try {
      // Update main referral code
      await userService.updateReferralCode(ctx.from.id, code);
      
      // Create link with the new code
      const botUsername = ctx.botInfo.username;
      const referralLink = `https://t.me/${botUsername}?start=${code}`;
      
      // Reset user state
      await userService.updateUserSettings(ctx.from.id, { state: null });
      
      return ctx.reply(
        '✅ *Main Referral Code Updated!*\n\n' +
        `Your new main referral code: \`${escapeMarkdown(code)}\`\n\n` +
        `Share this link: \`${escapeMarkdown(referralLink)}\``,
        {
          parse_mode: 'Markdown', // Use standard Markdown
          ...Markup.inlineKeyboard([
            [
              Markup.button.url('Share on Telegram', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join me on this awesome crypto trading bot! You get 11% off on fees and I earn rewards when you trade!')}`)
            ],
            [Markup.button.callback('🔙 Back to Referrals', 'view_referrals')]
          ])
        }
      );
    } catch (error) {
      logger.error(`Error updating main referral code: ${error.message}`);
      return ctx.reply(
        `❌ Error: ${error.message}\n\n` +
        'Please try a different code:',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Cancel', 'view_referrals')]
          ])
        }
      );
    }
  } catch (error) {
    logger.error(`Handle main code input error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Register referral handlers
const registerReferralHandlers = (bot) => {
  // Handle referral button click
  bot.hears('🔄 Referrals', referralHandler);
  bot.action('view_referrals', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      return referralHandler(ctx);
    } catch (error) {
      logger.error(`View referrals action error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Create custom referral code
  bot.action('create_referral_code', createReferralCodeHandler);
  
  // Change main referral code
  bot.action('change_main_code', changeMainCodeHandler);
  
  // Handle text input for referral code creation or change
  bot.on('text', async (ctx, next) => {
    try {
      const user = await userService.getUserByTelegramId(ctx.from.id);
      
      if (user && user.state === 'CREATING_REFERRAL_CODE') {
        return handleReferralCodeInput(ctx);
      } else if (user && user.state === 'CHANGING_MAIN_REFERRAL_CODE') {
        return handleMainCodeInput(ctx);
      }
      
      // Pass to next middleware if not handled
      return next();
    } catch (error) {
      logger.error(`Referral text input error: ${error.message}`);
      return next();
    }
  });
  
  // Back to menu action
  bot.action('back_to_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      // Redirect to start menu
      return ctx.callbackQuery.data = 'refresh_data';
    } catch (error) {
      logger.error(`Back to menu error: ${error.message}`);
      ctx.reply('Returning to main menu...');
    }
  });
};

module.exports = {
  referralHandler,
  createReferralCodeHandler,
  handleReferralCodeInput,
  changeMainCodeHandler,
  handleMainCodeInput,
  registerReferralHandlers,
  escapeMarkdown
};