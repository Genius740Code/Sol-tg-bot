const { Markup } = require('telegraf');
const { logger } = require('../database');
const { updateOrSendMessage } = require('../../utils/messageUtils');
const userService = require('../services/userService');

/**
 * Handler for token sniper feature
 * @param {Object} ctx - Telegram context
 */
const sniperHandler = async (ctx) => {
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
    
    // Show token sniper menu
    const message = 
      '🎯 *Token Sniper*\n\n' +
      'Automatically detect and buy new tokens:\n\n' +
      '• Real-time monitoring of new token listings\n' +
      '• Custom buy parameters\n' +
      '• Auto sell settings\n' +
      '• Gas optimization';
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔍 New Listings', 'new_listings'),
        Markup.button.callback('🚀 Auto Snipe', 'auto_snipe')
      ],
      [
        Markup.button.callback('⚙️ Sniper Settings', 'sniper_settings')
      ],
      [
        Markup.button.callback('🔙 Back to Menu', 'refresh_data')
      ]
    ]);
    
    await updateOrSendMessage(ctx, message, keyboard);
    
  } catch (error) {
    logger.error(`Token sniper handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing the token sniper. Please try again later.');
  }
};

/**
 * Handler for new token listings
 * @param {Object} ctx - Telegram context
 */
const newListingsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Simulated data for new token listings
    const listings = [
      {
        symbol: 'NEW1',
        name: 'New Token 1',
        time: '5 min ago',
        price: '$0.00025'
      },
      {
        symbol: 'MOON',
        name: 'MoonShot',
        time: '15 min ago',
        price: '$0.00132'
      },
      {
        symbol: 'LAUNCH',
        name: 'LaunchPad',
        time: '32 min ago',
        price: '$0.00078'
      }
    ];
    
    // Create message with listings
    let message = '🔍 *New Token Listings*\n\n';
    
    listings.forEach((token, index) => {
      message += `${index + 1}. *${token.symbol}* - ${token.name}\n`;
      message += `   Price: ${token.price} | Listed: ${token.time}\n\n`;
    });
    
    message += 'Select a token to view details or snipe it automatically.';
    
    // Create keyboard with listing options
    const listingButtons = listings.map(token => [
      Markup.button.callback(`Snipe ${token.symbol}`, `snipe_token_${token.symbol}`),
      Markup.button.callback(`Details ${token.symbol}`, `token_details_${token.symbol}`)
    ]);
    
    // Add refresh and back buttons
    listingButtons.push([
      Markup.button.callback('🔄 Refresh Listings', 'new_listings'),
      Markup.button.callback('🔙 Back', 'token_sniper')
    ]);
    
    const keyboard = Markup.inlineKeyboard(listingButtons);
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard
    });
    
  } catch (error) {
    logger.error(`New listings handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error fetching new listings. Please try again later.');
  }
};

/**
 * Handler for auto snipe settings
 * @param {Object} ctx - Telegram context
 */
const autoSnipeHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Check if user has auto snipe enabled
    const autoSnipeEnabled = user.settings?.sniperSettings?.autoSnipeEnabled || false;
    const buyAmount = user.settings?.sniperSettings?.buyAmount || 0.5;
    const maxSlippage = user.settings?.sniperSettings?.maxSlippage || 5;
    
    // Create message
    const message = 
      '🚀 *Auto Snipe Configuration*\n\n' +
      `Status: ${autoSnipeEnabled ? '✅ ENABLED' : '❌ DISABLED'}\n\n` +
      'When enabled, new token listings will be automatically bought based on your settings:\n\n' +
      `• Buy Amount: ${buyAmount} SOL\n` +
      `• Max Slippage: ${maxSlippage}%\n` +
      '• Auto Sell: Disabled';
    
    // Create keyboard
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          autoSnipeEnabled ? '❌ Disable Auto Snipe' : '✅ Enable Auto Snipe', 
          'toggle_auto_snipe'
        )
      ],
      [
        Markup.button.callback('💰 Change Buy Amount', 'change_snipe_amount'),
        Markup.button.callback('📊 Max Slippage', 'change_snipe_slippage')
      ],
      [
        Markup.button.callback('⚙️ Advanced Settings', 'advanced_snipe_settings')
      ],
      [
        Markup.button.callback('🔙 Back', 'token_sniper')
      ]
    ]);
    
    await updateOrSendMessage(ctx, message, keyboard);
    
  } catch (error) {
    logger.error(`Auto snipe handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing auto snipe settings. Please try again later.');
  }
};

/**
 * Handler for sniper settings
 * @param {Object} ctx - Telegram context
 */
const sniperSettingsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Default settings
    const settings = user.settings?.sniperSettings || {
      gasMultiplier: 1.5,
      antiRugEnabled: true,
      buyAmount: 0.5,
      maxSlippage: 5,
      autoSellEnabled: false,
      takeProfit: 50,
      stopLoss: 20
    };
    
    // Create message
    const message = 
      '⚙️ *Sniper Settings*\n\n' +
      `Gas Boost: ${settings.gasMultiplier}x\n` +
      `Anti-Rug Protection: ${settings.antiRugEnabled ? '✅ ON' : '❌ OFF'}\n` +
      `Default Buy Amount: ${settings.buyAmount} SOL\n` +
      `Max Slippage: ${settings.maxSlippage}%\n\n` +
      '*Auto Sell Settings:*\n' +
      `Auto Sell: ${settings.autoSellEnabled ? '✅ ON' : '❌ OFF'}\n` + 
      `Take Profit: ${settings.takeProfit}%\n` +
      `Stop Loss: ${settings.stopLoss}%`;
    
    // Create keyboard
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('⛽ Gas Boost', 'set_gas_boost'),
        Markup.button.callback('🛡️ Anti-Rug', 'toggle_anti_rug')
      ],
      [
        Markup.button.callback('💰 Default Amount', 'set_default_amount'),
        Markup.button.callback('📊 Slippage', 'set_slippage')
      ],
      [
        Markup.button.callback('🔄 Auto Sell', 'toggle_auto_sell_sniper'),
        Markup.button.callback('📈 TP/SL', 'set_tp_sl')
      ],
      [
        Markup.button.callback('🔙 Back', 'token_sniper')
      ]
    ]);
    
    await updateOrSendMessage(ctx, message, keyboard);
    
  } catch (error) {
    logger.error(`Sniper settings handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing sniper settings. Please try again later.');
  }
};

/**
 * Toggle auto snipe
 * @param {Object} ctx - Telegram context
 */
const toggleAutoSnipeHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Get current auto snipe state
    const currentState = user.settings?.sniperSettings?.autoSnipeEnabled || false;
    
    // Toggle state
    await userService.updateUserSettings(ctx.from.id, {
      'settings.sniperSettings.autoSnipeEnabled': !currentState
    });
    
    // Show feedback
    await ctx.reply(`Auto Snipe has been ${!currentState ? 'enabled' : 'disabled'}.`);
    
    // Return to auto snipe page
    return autoSnipeHandler(ctx);
    
  } catch (error) {
    logger.error(`Toggle auto snipe error: ${error.message}`);
    ctx.reply('Sorry, there was an error updating your settings. Please try again later.');
  }
};

// Register sniper handlers
const registerSniperHandlers = (bot) => {
  // Main handlers
  bot.action('token_sniper', sniperHandler);
  bot.action('new_listings', newListingsHandler);
  bot.action('auto_snipe', autoSnipeHandler);
  bot.action('sniper_settings', sniperSettingsHandler);
  
  // Setting handlers
  bot.action('toggle_auto_snipe', toggleAutoSnipeHandler);
  
  // Token specific handlers
  bot.action(/snipe_token_(.+)/, async (ctx) => {
    const tokenSymbol = ctx.match[1];
    await ctx.answerCbQuery(`Setting up snipe for ${tokenSymbol}...`);
    await ctx.reply(`Preparing to snipe ${tokenSymbol}. Feature coming soon!`);
  });
  
  bot.action(/token_details_(.+)/, async (ctx) => {
    const tokenSymbol = ctx.match[1];
    await ctx.answerCbQuery(`Loading details for ${tokenSymbol}...`);
    await ctx.reply(`Token details for ${tokenSymbol}. Feature coming soon!`);
  });
  
  // Setting update handlers
  bot.action('change_snipe_amount', async (ctx) => {
    await ctx.answerCbQuery('Change buy amount feature coming soon');
    return autoSnipeHandler(ctx);
  });
  
  bot.action('change_snipe_slippage', async (ctx) => {
    await ctx.answerCbQuery('Change slippage feature coming soon');
    return autoSnipeHandler(ctx);
  });
  
  bot.action('advanced_snipe_settings', async (ctx) => {
    await ctx.answerCbQuery('Advanced settings feature coming soon');
    return autoSnipeHandler(ctx);
  });
};

module.exports = {
  sniperHandler,
  registerSniperHandlers
}; 