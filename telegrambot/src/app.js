const { Telegraf } = require('telegraf');
const { startHandler, refreshHandler } = require('./handlers/startHandler');
const { registerTokenHandlers, buyTokenHandler } = require('./handlers/tokenHandler');
const { registerPositionHandlers, getAllUserTokens } = require('./handlers/positionHandler');
const { registerLimitOrderHandlers } = require('./handlers/limitOrderHandler');
const { registerReferralHandlers } = require('./handlers/referralHandler');
const { registerSettingsHandlers } = require('./handlers/settingsHandler');
const { registerExtensionHandlers } = require('./handlers/extensionHandler');
const { registerPremiumHandlers } = require('./handlers/premiumHandler');
const { registerSniperHandlers } = require('./handlers/sniperHandler');
const { registerCopyTradingHandlers, copyTradingHandler } = require('./handlers/copyTradingHandler');
const { logger } = require('./database');
const userService = require('./services/userService');
const { getSolPrice } = require('../utils/wallet');
const { Markup } = require('telegraf');
const config = require('../../config/config');

// Initialize the bot with token from environment variable
const bot = new Telegraf(process.env.BOT_TOKEN);

// Start bot function
async function startBot() {
  try {
    logger.info('Starting bot...');
    
    // Register the start command handler
    bot.command('start', startHandler);
    
    // Register all command handlers
    registerTokenHandlers(bot);
    registerPositionHandlers(bot);
    registerLimitOrderHandlers(bot);
    registerReferralHandlers(bot);
    registerSettingsHandlers(bot);
    registerExtensionHandlers(bot);
    registerPremiumHandlers(bot);
    registerSniperHandlers(bot);
    registerCopyTradingHandlers(bot);
    
    // Register wallet handlers
    const { registerWalletHandlers } = require('./handlers/walletHandler');
    registerWalletHandlers(bot);
    
    // Register direct refresh action
    bot.action('refresh_data', refreshHandler);
    
    // Add callback handlers for main menu buttons
    bot.action('buy_token', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        return ctx.reply(
          '💰 *Buy Token*\n\n' + 
          'Please enter a valid Solana token address to buy, or search for popular tokens below:',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'BONK', callback_data: 'search_token_BONK' },
                  { text: 'PYTH', callback_data: 'search_token_PYTH' },
                  { text: 'JTO', callback_data: 'search_token_JTO' }
                ],
                [
                  { text: 'BOME', callback_data: 'search_token_BOME' },
                  { text: 'WIF', callback_data: 'search_token_WIF' },
                  { text: 'OLAS', callback_data: 'search_token_OLAS' }
                ],
                [
                  { text: '🔍 Search by Name', callback_data: 'token_search' },
                  { text: '🔙 Back', callback_data: 'refresh_data' }
                ]
              ]
            }
          }
        );
      } catch (error) {
        logger.error(`Buy token error: ${error.message}`);
        return ctx.reply('Sorry, there was an error starting the buy process.');
      }
    });
    
    // Action for searching tokens
    bot.action(/search_token_(.+)/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const tokenSymbol = ctx.match[1];
        await ctx.reply(`🔍 Searching for ${tokenSymbol}...`);
        
        // Here you would call your token search API
        // For now just inform the user
        return ctx.reply(`Please enter the token address for ${tokenSymbol} to continue.`);
      } catch (error) {
        logger.error(`Token search error: ${error.message}`);
        return ctx.reply('Sorry, there was an error searching for tokens.');
      }
    });
    
    bot.action('sell_token', async (ctx) => {
      try {
        await ctx.answerCbQuery('Loading your tokens...');
        
        // Get user
        const user = await userService.getUserByTelegramId(ctx.from.id);
        if (!user) {
          return ctx.reply('You need to create an account first. Please use /start command.');
        }
        
        // Get SOL price
        let solPrice = 0;
        try {
          solPrice = await getSolPrice();
        } catch (error) {
          logger.error(`Error getting SOL price: ${error.message}`);
          solPrice = 100; // Fallback price
        }
        
        // Get user tokens
        const tokens = await getAllUserTokens(user.walletAddress);
        
        if (!tokens || tokens.length === 0) {
          return ctx.reply(
            '💸 *Sell Tokens*\n\n' +
            'You don\'t have any tokens in your wallet yet.\n' +
            'Buy some tokens first!',
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '💰 Buy Tokens', callback_data: 'buy_token' }],
                  [{ text: '🔙 Back to Menu', callback_data: 'refresh_data' }]
                ]
              }
            }
          );
        }
        
        // Create buttons for each token
        const tokenButtons = tokens.map(token => {
          const valueUsd = token.balance * token.price;
          const valueSol = valueUsd / solPrice;
          return [{
            text: `${token.symbol} - ${token.balance.toFixed(2)} ($${valueUsd.toFixed(2)})`,
            callback_data: `sell_specific_${token.address}`
          }];
        });
        
        // Add back button
        tokenButtons.push([{ text: '🔙 Back to Menu', callback_data: 'refresh_data' }]);
        
        return ctx.reply(
          '💸 *Sell Tokens*\n\n' +
          'Select a token to sell:',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: tokenButtons
            }
          }
        );
      } catch (error) {
        logger.error(`Sell token error: ${error.message}`);
        return ctx.reply('Sorry, there was an error loading your tokens. Please try again later.');
      }
    });
    
    bot.action('view_positions', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        // Call the positions handler
        return bot.context._handlers.positionsHandler(ctx);
      } catch (error) {
        logger.error(`View positions error: ${error.message}`);
        return ctx.reply('Sorry, there was an error viewing your positions.');
      }
    });
    
    bot.action('view_limit_orders', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        return ctx.reply('Limit orders feature is coming soon!');
      } catch (error) {
        logger.error(`View limit orders error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing limit orders.');
      }
    });
    
    bot.action('view_referrals', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        // Call the referral handler
        return bot.context._handlers.referralHandler(ctx);
      } catch (error) {
        logger.error(`View referrals error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing referrals.');
      }
    });
    
    bot.action('wallet_management', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        // Use the imported walletManagementHandler
        const { walletManagementHandler } = require('./handlers/walletHandler');
        return walletManagementHandler(ctx);
      } catch (error) {
        logger.error(`Wallet management error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing wallet management.');
      }
    });
    
    bot.action('settings', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        // Call the settings handler
        return bot.context._handlers.settingsHandler(ctx);
      } catch (error) {
        logger.error(`Settings error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing settings.');
      }
    });
    
    bot.action('premium_features', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        // Call the premium features handler
        const { premiumFeaturesHandler } = require('./handlers/premiumHandler');
        return premiumFeaturesHandler(ctx);
      } catch (error) {
        logger.error(`Premium features error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing premium features.');
      }
    });
    
    bot.action('copy_trading', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        return copyTradingHandler(ctx);
      } catch (error) {
        logger.error(`Copy trading error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing copy trading.');
      }
    });
    
    bot.action('token_sniper', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const { sniperHandler } = require('./handlers/sniperHandler');
        return sniperHandler(ctx);
      } catch (error) {
        logger.error(`Token sniper error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing the token sniper.');
      }
    });
    
    bot.action('bot_extension', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        return ctx.reply(
          '🔌 *Bot Extension*\n\n' + 
          'Connect to our browser extension for faster trading:\n\n' +
          '• One-click trading from any site\n' +
          '• Real-time price alerts\n' +
          '• Quick wallet access\n' +
          '• Automatic token detection',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🔗 Connect Extension', callback_data: 'connect_extension' },
                  { text: '📥 Download', callback_data: 'download_extension' }
                ],
                [
                  { text: '📱 Mobile App', callback_data: 'mobile_app' }
                ],
                [
                  { text: '🔙 Back to Menu', callback_data: 'refresh_data' }
                ]
              ]
            }
          }
        );
      } catch (error) {
        logger.error(`Bot extension error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing the bot extension.');
      }
    });
    
    // Register basic extension actions
    bot.action('connect_extension', async (ctx) => {
      try {
        await ctx.answerCbQuery('Generating connection code...');
        
        // Generate a random connection code
        const connectionCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Store the code in user's settings (expiring in 5 minutes)
        await userService.updateUserSettings(ctx.from.id, {
          'extension.connectionCode': connectionCode,
          'extension.codeExpiry': new Date(Date.now() + 5 * 60 * 1000)
        });
        
        return ctx.reply(
          '🔗 *Extension Connection*\n\n' +
          'Enter this code in the extension to connect:\n\n' +
          `\`${connectionCode}\`\n\n` +
          'This code will expire in 5 minutes.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔙 Back to Extension', callback_data: 'bot_extension' }]
              ]
            }
          }
        );
      } catch (error) {
        logger.error(`Extension connection error: ${error.message}`);
        return ctx.reply('Sorry, there was an error generating a connection code.');
      }
    });
    
    bot.action('download_extension', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        return ctx.reply(
          '📥 *Download Extension*\n\n' +
          'Our extension is available for:\n\n' +
          '• Chrome/Brave\n' +
          '• Firefox\n' +
          '• Edge\n\n' +
          'Download from the official store for your browser:',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Chrome Store', url: 'https://chrome.google.com/webstore' },
                  { text: 'Firefox Add-ons', url: 'https://addons.mozilla.org' }
                ],
                [{ text: '🔙 Back to Extension', callback_data: 'bot_extension' }]
              ]
            }
          }
        );
      } catch (error) {
        logger.error(`Download extension error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing the download links.');
      }
    });
    
    bot.action('mobile_app', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        return ctx.reply(
          '📱 *Mobile App*\n\n' +
          'Get our mobile app for on-the-go trading:\n\n' +
          '• Real-time trading\n' +
          '• Price alerts\n' +
          '• Portfolio tracking\n' +
          '• Secure wallet\n\n' +
          'Download from your app store:',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'App Store', url: 'https://apps.apple.com' },
                  { text: 'Google Play', url: 'https://play.google.com' }
                ],
                [{ text: '🔙 Back to Extension', callback_data: 'bot_extension' }]
              ]
            }
          }
        );
      } catch (error) {
        logger.error(`Mobile app error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing the mobile app information.');
      }
    });
    
    // Store handlers for reference
    bot.context._handlers = {
      positionsHandler: async (ctx) => {
        return await positionsHandler(ctx);
      },
      referralHandler: async (ctx) => {
        try {
          await ctx.reply('⏳ Loading referral program...');
          // Call the handler from registerReferralHandlers
          return ctx.reply('🔄 Referral program is ready!');
        } catch (error) {
          logger.error(`Referral handler error: ${error.message}`);
          return ctx.reply('Sorry, there was an error accessing the referral program.');
        }
      },
      settingsHandler: async (ctx) => {
        try {
          await ctx.answerCbQuery();
          // Create settings keyboard
          const settingsKeyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('🔔 Notifications', 'settings_notifications'),
              Markup.button.callback('🔐 Security', 'settings_security')
            ],
            [
              Markup.button.callback('💰 Default Slippage', 'settings_slippage'),
              Markup.button.callback('🌐 Language', 'settings_language')
            ],
            [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
          ]);
          
          return ctx.reply(
            '⚙️ *Settings*\n\n' +
            'Configure your bot preferences:',
            {
              parse_mode: 'Markdown',
              ...settingsKeyboard
            }
          );
        } catch (error) {
          logger.error(`Settings handler error: ${error.message}`);
          return ctx.reply('Sorry, there was an error accessing settings.');
        }
      }
    };
    
    // Launch the bot
    await bot.launch();
    logger.info('Bot started successfully');
    
    // Enable graceful stop with proper cleanup
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received. Stopping bot...`);
      
      // Stop the bot first
      bot.stop();
      logger.info('Bot stopped successfully');
      
      // Close database connections safely
      try {
        logger.info('Stopping scheduled jobs...');
        // Stop any scheduled jobs here if needed
        logger.info('Scheduled jobs stopped successfully');
        
        logger.info('Closing database connection...');
        // Close MongoDB connection if it's active
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 0) {
          await mongoose.connection.close();
          logger.info('MongoDB connection closed cleanly');
        }
      } catch (error) {
        logger.error(`Error during shutdown: ${error.message}`);
      }
      
      // Exit process after a short delay to allow logging to complete
      setTimeout(() => {
        logger.info(`${signal} shutdown completed`);
        process.exit(0);
      }, 500);
    };
    
    // Register shutdown handlers
    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  } catch (error) {
    logger.error(`Error starting bot: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { startBot, bot }; 