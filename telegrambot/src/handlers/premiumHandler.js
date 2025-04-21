const { Markup } = require('telegraf');
const { logger } = require('../database');
const { updateOrSendMessage } = require('../../utils/messageUtils');
const userService = require('../services/userService');

/**
 * Handler for premium features button
 * @param {Object} ctx - Telegram context
 */
const premiumFeaturesHandler = async (ctx) => {
  try {
    // If this is a callback query, acknowledge it
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
    }
    
    // Get user data
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Check if user already has premium
    const hasPremium = user.premiumStatus || false;
    
    // Create message based on premium status
    let messageText = '';
    
    if (hasPremium) {
      messageText = 
        '⭐ *Premium Features - Activated* ⭐\n\n' +
        '✅ Your premium subscription is active!\n\n' +
        '*Active Benefits:*\n' +
        '• 50% reduced trading fees\n' +
        '• Advanced trading signals\n' +
        '• Priority transaction processing\n' +
        '• Premium-only AFK strategies\n' +
        '• Unlimited limit orders\n' +
        '• Email/SMS price alerts\n\n' +
        'Premium subscription expires: ' + 
        (user.premiumExpiryDate ? new Date(user.premiumExpiryDate).toLocaleDateString() : 'N/A');
    } else {
      messageText = 
        '⭐ *Premium Features* ⭐\n\n' +
        'Upgrade to Premium for exclusive benefits:\n\n' +
        '• 50% reduced trading fees\n' +
        '• Advanced trading signals and insights\n' +
        '• Priority transaction processing\n' +
        '• Premium-only AFK strategies\n' +
        '• Unlimited limit orders\n' +
        '• Email/SMS price alerts\n\n' +
        'Premium plans starting at just $19.99/month';
    }
    
    // Create appropriate keyboard based on premium status
    const keyboard = hasPremium ? 
      Markup.inlineKeyboard([
        [Markup.button.callback('💰 Extend Subscription', 'premium_extend')],
        [Markup.button.callback('📋 Premium Analytics', 'premium_analytics')],
        [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
      ]) : 
      Markup.inlineKeyboard([
        [Markup.button.callback('💳 Subscribe Monthly - $19.99', 'premium_subscribe_monthly')],
        [Markup.button.callback('💎 Subscribe Yearly - $199.99', 'premium_subscribe_yearly')],
        [Markup.button.callback('🎁 Redeem Code', 'premium_redeem_code')],
        [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
      ]);
    
    // Update or send message
    await updateOrSendMessage(ctx, messageText, keyboard);
    
  } catch (error) {
    logger.error(`Premium features handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing premium features. Please try again later.');
  }
};

// Handler for premium subscription (placeholder for payment integration)
const premiumSubscribeHandler = async (ctx, plan) => {
  try {
    await ctx.answerCbQuery();
    
    // Here you would integrate with a payment processor
    // For now, just show a placeholder message
    
    await ctx.reply(
      `📋 *Premium Subscription - ${plan}*\n\n` +
      'To complete your subscription, please contact the administrator at @admin_username\n\n' +
      'We will be adding direct payment integration soon!',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Premium', 'premium_features')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Premium subscribe handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
};

// Handler for premium code redemption
const premiumRedeemCodeHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Set user state to wait for redemption code
    await userService.updateUserSettings(ctx.from.id, {
      state: 'AWAITING_PREMIUM_CODE'
    });
    
    await ctx.reply(
      '🎟️ *Premium Code Redemption*\n\n' +
      'Please enter your premium redemption code:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Cancel', 'premium_features')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Premium redeem code handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error processing your request. Please try again later.');
  }
};

// Register premium handlers
const registerPremiumHandlers = (bot) => {
  // Premium features menu
  bot.action('premium_features', premiumFeaturesHandler);
  
  // Subscription handlers
  bot.action('premium_subscribe_monthly', (ctx) => premiumSubscribeHandler(ctx, 'Monthly'));
  bot.action('premium_subscribe_yearly', (ctx) => premiumSubscribeHandler(ctx, 'Yearly'));
  
  // Redeem code handler
  bot.action('premium_redeem_code', premiumRedeemCodeHandler);
  
  // Handle text input for premium codes
  bot.on('text', async (ctx, next) => {
    try {
      // Get user and check state
      const user = await userService.getUserByTelegramId(ctx.from.id);
      
      if (!user || user.state !== 'AWAITING_PREMIUM_CODE') {
        // Pass to next handler if not waiting for premium code
        return next();
      }
      
      // Process premium code
      const code = ctx.message.text.trim();
      
      // Reset user state
      await userService.updateUserSettings(ctx.from.id, { state: null });
      
      // Very basic validation
      if (code.length < 6) {
        return ctx.reply(
          '❌ Invalid premium code. Please check your code and try again.',
          Markup.inlineKeyboard([
            [Markup.button.callback('Try Again', 'premium_redeem_code')],
            [Markup.button.callback('Back to Premium', 'premium_features')]
          ])
        );
      }
      
      // For demo purposes, accept any valid-looking code
      // In production, you'd validate this against a database
      await userService.updateUserSettings(ctx.from.id, {
        premiumStatus: true,
        premiumExpiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      });
      
      await ctx.reply(
        '✅ *Premium Activated!*\n\n' +
        'Congratulations! Your premium status has been activated.\n' +
        'Your premium features are now available.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('View Premium Features', 'premium_features')]
          ])
        }
      );
    } catch (error) {
      logger.error(`Premium code processing error: ${error.message}`);
      return next();
    }
  });
  
  // Back to premium features
  bot.action('premium_extend', (ctx) => premiumFeaturesHandler(ctx));
  bot.action('premium_analytics', (ctx) => {
    ctx.answerCbQuery('Premium analytics coming soon');
    return premiumFeaturesHandler(ctx);
  });
};

module.exports = {
  premiumFeaturesHandler,
  registerPremiumHandlers
}; 