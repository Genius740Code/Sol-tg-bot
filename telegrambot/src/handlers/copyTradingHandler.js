const { Markup } = require('telegraf');
const { logger } = require('../database');
const { updateOrSendMessage } = require('../../utils/messageUtils');
const userService = require('../services/userService');

/**
 * Handler for copy trading feature
 * @param {Object} ctx - Telegram context
 */
const copyTradingHandler = async (ctx) => {
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
    
    // Get copy trading state
    const copyTradingEnabled = user.copyTrading?.isActive || false;
    const followingCount = user.copyTrading?.followingUsers?.length || 0;
    
    // Create message
    const message = 
      '📈 *Copy Trading*\n\n' +
      `Status: ${copyTradingEnabled ? '✅ ENABLED' : '❌ DISABLED'}\n` +
      `Following: ${followingCount} traders\n\n` +
      'Copy successful traders automatically:\n\n' +
      '• Follow top traders\n' +
      '• Automatic trade mirroring\n' +
      '• Real-time notifications\n' +
      '• Performance analytics';
    
    // Create keyboard
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔝 Top Traders', 'top_traders'),
        Markup.button.callback('👥 My Following', 'my_following')
      ],
      [
        Markup.button.callback('⚙️ Copy Settings', 'copy_settings')
      ],
      [
        Markup.button.callback('🔙 Back to Menu', 'refresh_data')
      ]
    ]);
    
    await updateOrSendMessage(ctx, message, keyboard);
    
  } catch (error) {
    logger.error(`Copy trading handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing copy trading. Please try again later.');
  }
};

/**
 * Handler for top traders
 * @param {Object} ctx - Telegram context
 */
const topTradersHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Simulated top trader data
    const topTraders = [
      {
        username: 'trader1',
        displayName: 'Crypto King',
        profitLast30Days: '+456%',
        followers: 1250,
        isFollowing: false
      },
      {
        username: 'trader2',
        displayName: 'SOL Master',
        profitLast30Days: '+312%',
        followers: 876,
        isFollowing: true
      },
      {
        username: 'trader3',
        displayName: 'Token Hunter',
        profitLast30Days: '+189%',
        followers: 543,
        isFollowing: false
      }
    ];
    
    // Create message with top traders
    let message = '🔝 *Top Performing Traders*\n\n';
    
    topTraders.forEach((trader, index) => {
      message += `${index + 1}. *${trader.displayName}* (@${trader.username})\n`;
      message += `   Profit (30d): ${trader.profitLast30Days} | Followers: ${trader.followers}\n`;
      message += `   Status: ${trader.isFollowing ? '✅ Following' : '❌ Not Following'}\n\n`;
    });
    
    // Create buttons for each trader
    const traderButtons = topTraders.map(trader => [
      Markup.button.callback(
        trader.isFollowing ? `Unfollow @${trader.username}` : `Follow @${trader.username}`,
        trader.isFollowing ? `unfollow_${trader.username}` : `follow_${trader.username}`
      ),
      Markup.button.callback(`View @${trader.username}`, `view_trader_${trader.username}`)
    ]);
    
    // Add back button
    traderButtons.push([
      Markup.button.callback('🔙 Back to Copy Trading', 'copy_trading')
    ]);
    
    const keyboard = Markup.inlineKeyboard(traderButtons);
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
  } catch (error) {
    logger.error(`Top traders handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error fetching top traders. Please try again later.');
  }
};

/**
 * Handler for traders the user is following
 * @param {Object} ctx - Telegram context
 */
const myFollowingHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Check if user is following any traders
    const followingUsers = user.copyTrading?.followingUsers || [];
    
    if (followingUsers.length === 0) {
      return ctx.reply(
        '👥 *My Following*\n\n' +
        'You are not following any traders yet.\n\n' +
        'Browse the Top Traders list to find successful traders to follow.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔝 View Top Traders', 'top_traders')],
            [Markup.button.callback('🔙 Back to Copy Trading', 'copy_trading')]
          ])
        }
      );
    }
    
    // Simulated data for followed traders
    const followedTraders = [
      {
        username: 'trader2',
        displayName: 'SOL Master',
        profitLast30Days: '+312%',
        yourProfitFromCopying: '+145%',
        lastTradeTime: '2 hours ago'
      },
      {
        username: 'trader5',
        displayName: 'Moon Chaser',
        profitLast30Days: '+98%',
        yourProfitFromCopying: '+42%',
        lastTradeTime: '5 hours ago'
      }
    ];
    
    // Create message
    let message = '👥 *Traders You Follow*\n\n';
    
    followedTraders.forEach((trader, index) => {
      message += `${index + 1}. *${trader.displayName}* (@${trader.username})\n`;
      message += `   Their Profit (30d): ${trader.profitLast30Days}\n`;
      message += `   Your Profit: ${trader.yourProfitFromCopying}\n`;
      message += `   Last Trade: ${trader.lastTradeTime}\n\n`;
    });
    
    // Create buttons
    const traderButtons = followedTraders.map(trader => [
      Markup.button.callback(`Unfollow @${trader.username}`, `unfollow_${trader.username}`),
      Markup.button.callback(`View Trades`, `view_trades_${trader.username}`)
    ]);
    
    // Add back button
    traderButtons.push([
      Markup.button.callback('🔙 Back to Copy Trading', 'copy_trading')
    ]);
    
    const keyboard = Markup.inlineKeyboard(traderButtons);
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
  } catch (error) {
    logger.error(`My following handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error fetching your followed traders. Please try again later.');
  }
};

/**
 * Handler for copy trading settings
 * @param {Object} ctx - Telegram context
 */
const copySettingsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Get copy trading settings
    const copyTradingEnabled = user.copyTrading?.isActive || false;
    const maxCopyAmount = user.settings?.copyTradingSettings?.maxCopyAmount || 0.5;
    const copySell = user.settings?.copyTradingSettings?.copySell !== false; // Default to true
    const copyBuy = user.settings?.copyTradingSettings?.copyBuy !== false; // Default to true
    
    // Create message
    const message = 
      '⚙️ *Copy Trading Settings*\n\n' +
      `Copy Trading: ${copyTradingEnabled ? '✅ ENABLED' : '❌ DISABLED'}\n\n` +
      'Configuration:\n' +
      `• Max Amount Per Trade: ${maxCopyAmount} SOL\n` +
      `• Copy Buy Orders: ${copyBuy ? '✅ Yes' : '❌ No'}\n` +
      `• Copy Sell Orders: ${copySell ? '✅ Yes' : '❌ No'}\n` +
      '• Delay After Signal: 1 second';
    
    // Create keyboard
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          copyTradingEnabled ? '❌ Disable Copy Trading' : '✅ Enable Copy Trading', 
          'toggle_copy_trading'
        )
      ],
      [
        Markup.button.callback('💰 Max Amount', 'set_copy_amount'),
        Markup.button.callback('⏱️ Copy Delay', 'set_copy_delay')
      ],
      [
        Markup.button.callback(`${copyBuy ? '✅' : '❌'} Copy Buys`, 'toggle_copy_buy'),
        Markup.button.callback(`${copySell ? '✅' : '❌'} Copy Sells`, 'toggle_copy_sell')
      ],
      [
        Markup.button.callback('🔙 Back to Copy Trading', 'copy_trading')
      ]
    ]);
    
    await updateOrSendMessage(ctx, message, keyboard);
    
  } catch (error) {
    logger.error(`Copy settings handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing copy settings. Please try again later.');
  }
};

/**
 * Toggle copy trading
 * @param {Object} ctx - Telegram context
 */
const toggleCopyTradingHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Get current copy trading state
    const currentState = user.copyTrading?.isActive || false;
    
    // Toggle state
    await userService.updateUserSettings(ctx.from.id, {
      'copyTrading.isActive': !currentState
    });
    
    // Show feedback
    await ctx.reply(`Copy Trading has been ${!currentState ? 'enabled' : 'disabled'}.`);
    
    // Return to copy settings page
    return copySettingsHandler(ctx);
    
  } catch (error) {
    logger.error(`Toggle copy trading error: ${error.message}`);
    ctx.reply('Sorry, there was an error updating your settings. Please try again later.');
  }
};

// Handlers for follow/unfollow
const followTraderHandler = async (ctx, traderUsername) => {
  try {
    await ctx.answerCbQuery(`Following @${traderUsername}...`);
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Add trader to following list if not already following
    const followingUsers = user.copyTrading?.followingUsers || [];
    
    if (!followingUsers.includes(traderUsername)) {
      await userService.updateUserSettings(ctx.from.id, {
        $push: { 'copyTrading.followingUsers': traderUsername }
      });
    }
    
    await ctx.reply(`You are now following @${traderUsername}. Their trades will be copied to your account.`);
    
    // Return to top traders list
    return topTradersHandler(ctx);
    
  } catch (error) {
    logger.error(`Follow trader error: ${error.message}`);
    ctx.reply('Sorry, there was an error following this trader. Please try again later.');
  }
};

const unfollowTraderHandler = async (ctx, traderUsername) => {
  try {
    await ctx.answerCbQuery(`Unfollowing @${traderUsername}...`);
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Remove trader from following list
    await userService.updateUserSettings(ctx.from.id, {
      $pull: { 'copyTrading.followingUsers': traderUsername }
    });
    
    await ctx.reply(`You have unfollowed @${traderUsername}. Their trades will no longer be copied.`);
    
    // Return to my following list
    return myFollowingHandler(ctx);
    
  } catch (error) {
    logger.error(`Unfollow trader error: ${error.message}`);
    ctx.reply('Sorry, there was an error unfollowing this trader. Please try again later.');
  }
};

// Register copy trading handlers
const registerCopyTradingHandlers = (bot) => {
  // Main handlers
  bot.action('copy_trading', copyTradingHandler);
  bot.action('top_traders', topTradersHandler);
  bot.action('my_following', myFollowingHandler);
  bot.action('copy_settings', copySettingsHandler);
  
  // Setting handlers
  bot.action('toggle_copy_trading', toggleCopyTradingHandler);
  
  // Follow/unfollow handlers
  bot.action(/follow_(.+)/, (ctx) => {
    const username = ctx.match[1];
    return followTraderHandler(ctx, username);
  });
  
  bot.action(/unfollow_(.+)/, (ctx) => {
    const username = ctx.match[1];
    return unfollowTraderHandler(ctx, username);
  });
  
  // Trader details
  bot.action(/view_trader_(.+)/, async (ctx) => {
    const username = ctx.match[1];
    await ctx.answerCbQuery(`Loading profile for @${username}...`);
    await ctx.reply(`Trader profile for @${username}. Feature coming soon!`);
  });
  
  bot.action(/view_trades_(.+)/, async (ctx) => {
    const username = ctx.match[1];
    await ctx.answerCbQuery(`Loading trades from @${username}...`);
    await ctx.reply(`Trade history for @${username}. Feature coming soon!`);
  });
  
  // Settings handlers
  bot.action('set_copy_amount', async (ctx) => {
    await ctx.answerCbQuery('Set copy amount feature coming soon');
    return copySettingsHandler(ctx);
  });
  
  bot.action('set_copy_delay', async (ctx) => {
    await ctx.answerCbQuery('Set copy delay feature coming soon');
    return copySettingsHandler(ctx);
  });
  
  bot.action('toggle_copy_buy', async (ctx) => {
    await ctx.answerCbQuery('Toggle copy buy feature coming soon');
    return copySettingsHandler(ctx);
  });
  
  bot.action('toggle_copy_sell', async (ctx) => {
    await ctx.answerCbQuery('Toggle copy sell feature coming soon');
    return copySettingsHandler(ctx);
  });
};

module.exports = {
  copyTradingHandler,
  registerCopyTradingHandlers
}; 