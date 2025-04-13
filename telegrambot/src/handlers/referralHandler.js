const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { logger } = require('../database');
const { isRateLimited } = require('../../utils/wallet');
const { FEES } = require('../../utils/constants');

// Referrer earning percentage - not included in constants.js
const REFERRER_EARNING_PERCENTAGE = 35;

// Show referral information
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
    const referralLink = `https://t.me/${botUsername}?start=${referralInfo.referralCode}`;
    
    // Create referral message
    let message = `👥 *Your Referral Information*\n\n`;
    message += `📊 Total Referrals: ${referralInfo.referralCount}\n\n`;
    message += `🔗 Your Referral Link:\n\`${referralLink}\`\n\n`;
    message += `📋 Referral Code: \`${referralInfo.referralCode}\`\n\n`;
    
    // Add custom referral codes if any
    if (referralInfo.customReferralCodes && referralInfo.customReferralCodes.length > 0) {
      message += `📝 *Your Custom Referral Codes:*\n`;
      referralInfo.customReferralCodes.forEach(codeObj => {
        const customLink = `https://t.me/${botUsername}?start=${codeObj.code}`;
        message += `• \`${codeObj.code}\` - [Use Link](${customLink})\n`;
      });
      message += `\n`;
    }
    
    // Add referral reward info with updated percentages
    message += `💰 *Rewards*\n`;
    message += `• You earn ${REFERRER_EARNING_PERCENTAGE}% of your referrals' trading fees\n`;
    message += `• Your referrals get a ${FEES.REFERRAL_DISCOUNT}% discount on their fees (${FEES.NORMAL_PERCENTAGE}% → ${FEES.REFERRAL_PERCENTAGE.toFixed(3)}%)\n\n`;
    
    // Add list of referrals if any
    if (referralInfo.referrals && referralInfo.referrals.length > 0) {
      message += `👥 *Your Referrals:*\n`;
      
      // Create a table header
      message += `User | Join Date | Trading Volume | Earnings\n`;
      message += `-----------------------------------\n`;
      
      let totalVolume = 0;
      let totalEarnings = 0;
      
      referralInfo.referrals.forEach((ref, index) => {
        const username = ref.username ? `@${ref.username}` : `User_${ref.telegramId.substring(0, 5)}`;
        const joinDate = new Date(ref.joinedAt).toLocaleDateString();
        
        // For demo, we'll show some placeholder trading volume and earnings
        // In a real app, you'd track this in the database
        const tradingVolume = Math.random() * 1000 * (Date.now() - new Date(ref.joinedAt).getTime()) / (1000 * 60 * 60 * 24 * 30);
        const estimatedEarnings = tradingVolume * FEES.NORMAL_PERCENTAGE / 100 * REFERRER_EARNING_PERCENTAGE / 100;
        
        totalVolume += tradingVolume;
        totalEarnings += estimatedEarnings;
        
        message += `${index + 1}. ${username} | ${joinDate} | $${tradingVolume.toFixed(2)} | $${estimatedEarnings.toFixed(2)}\n`;
      });
      
      message += `\n💵 *Total Trading Volume: $${totalVolume.toFixed(2)}*\n`;
      message += `💰 *Total Estimated Earnings: $${totalEarnings.toFixed(2)}*\n\n`;
    } else {
      message += `You haven't referred any users yet. Share your link to start earning!\n\n`;
    }
    
    message += `🚀 *How It Works*\n`;
    message += `1. Share your referral link with friends\n`;
    message += `2. When they join and trade, they get a ${FEES.REFERRAL_DISCOUNT}% discount\n`;
    message += `3. You earn ${REFERRER_EARNING_PERCENTAGE}% of their trading fees\n`;
    message += `4. Everyone wins!`;
    
    // Create keyboard for sharing and managing referral codes
    const referralKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.url('Share on Telegram', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join me on this awesome crypto trading bot! You get 11% off on fees and I earn rewards when you trade!')}`)
      ],
      [
        Markup.button.callback('➕ Create Custom Code', 'create_referral_code')
      ],
      [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
    ]);
    
    // Send referral information
    return ctx.reply(message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...referralKeyboard
    });
    
  } catch (error) {
    logger.error(`Referral handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Custom referral code handler
const createReferralCodeHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '➕ *Create Custom Referral Code*\n\n' +
      'Please enter a custom referral code (4-15 alphanumeric characters).\n\n' +
      'This code will be used in addition to your default referral code.',
      {
        parse_mode: 'Markdown'
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
      // Add custom referral code
      await userService.addCustomReferralCode(ctx.from.id, code);
      
      // Create link with the new code
      const botUsername = ctx.botInfo.username;
      const referralLink = `https://t.me/${botUsername}?start=${code}`;
      
      // Reset user state
      await userService.updateUserSettings(ctx.from.id, { state: null });
      
      return ctx.reply(
        '✅ *Custom Referral Code Created!*\n\n' +
        `Your new referral code: \`${code}\`\n\n` +
        `Share this link: \`${referralLink}\``,
        {
          parse_mode: 'Markdown',
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
        parse_mode: 'Markdown'
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
        `Your new main referral code: \`${code}\`\n\n` +
        `Share this link: \`${referralLink}\``,
        {
          parse_mode: 'Markdown',
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
    await ctx.answerCbQuery();
    return referralHandler(ctx);
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
    }
  });
};

module.exports = {
  referralHandler,
  createReferralCodeHandler,
  handleReferralCodeInput,
  changeMainCodeHandler,
  handleMainCodeInput,
  registerReferralHandlers
}; 