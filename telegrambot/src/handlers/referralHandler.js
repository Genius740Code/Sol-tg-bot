const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { logger } = require('../database');
const { isRateLimited } = require('../../utils/wallet');

// Constants for fee calculations
const NORMAL_FEE_PERCENTAGE = 0.8;
const REFERRAL_DISCOUNT_PERCENTAGE = 11;
const REFERRAL_FEE_PERCENTAGE = NORMAL_FEE_PERCENTAGE * (1 - REFERRAL_DISCOUNT_PERCENTAGE/100);
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
    
    // Add referral reward info with updated percentages
    message += `💰 *Rewards*\n`;
    message += `• You earn ${REFERRER_EARNING_PERCENTAGE}% of your referrals' trading fees\n`;
    message += `• Your referrals get a ${REFERRAL_DISCOUNT_PERCENTAGE}% discount on their fees (${NORMAL_FEE_PERCENTAGE}% → ${REFERRAL_FEE_PERCENTAGE.toFixed(3)}%)\n\n`;
    
    // Add list of referrals if any
    if (referralInfo.referrals && referralInfo.referrals.length > 0) {
      message += `👥 *Your Referrals:*\n`;
      let totalEarnings = 0;
      
      referralInfo.referrals.forEach((ref, index) => {
        const username = ref.username ? `@${ref.username}` : ref.firstName;
        const joinDate = new Date(ref.joinedAt).toLocaleDateString();
        
        // For demo, we'll show some placeholder earnings
        // In a real app, you'd track this in the database
        const estimatedEarnings = Math.random() * 0.05 * (Date.now() - new Date(ref.joinedAt).getTime()) / (1000 * 60 * 60 * 24);
        totalEarnings += estimatedEarnings;
        
        message += `${index + 1}. ${username} - Joined: ${joinDate} - Est. earnings: $${estimatedEarnings.toFixed(2)}\n`;
      });
      
      message += `\n💵 *Total Estimated Earnings: $${totalEarnings.toFixed(2)}*\n\n`;
    } else {
      message += `You haven't referred any users yet. Share your link to start earning!\n\n`;
    }
    
    message += `🚀 *How It Works*\n`;
    message += `1. Share your referral link with friends\n`;
    message += `2. When they join and trade, they get a ${REFERRAL_DISCOUNT_PERCENTAGE}% discount\n`;
    message += `3. You earn ${REFERRER_EARNING_PERCENTAGE}% of their trading fees\n`;
    message += `4. Everyone wins!`;
    
    // Create keyboard for sharing
    const shareKeyboard = Markup.inlineKeyboard([
      [Markup.button.url('Share on Telegram', `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join me on this awesome crypto trading bot! You get 11% off on fees and I earn rewards when you trade!')}`)],
      [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
    ]);
    
    // Send referral information
    return ctx.reply(message, {
      parse_mode: 'Markdown',
      ...shareKeyboard
    });
    
  } catch (error) {
    logger.error(`Referral handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Register referral handlers
const registerReferralHandlers = (bot) => {
  // Handle referral button click
  bot.hears('🔄 Referrals', referralHandler);
  
  // Back to menu action
  bot.action('back_to_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      // Redirect to start menu
      await ctx.reply('Returning to main menu...');
    } catch (error) {
      logger.error(`Back to menu error: ${error.message}`);
    }
  });
};

module.exports = {
  referralHandler,
  registerReferralHandlers
}; 