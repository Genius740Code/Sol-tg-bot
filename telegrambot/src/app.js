const { Telegraf } = require('telegraf');
const { startHandler, refreshHandler } = require('./handlers/startHandler');
const { registerTokenHandlers, buyTokenHandler } = require('./handlers/tokenHandler');
const { registerPositionHandlers, getAllUserTokens } = require('./handlers/positionHandler');
const { registerLimitOrderHandlers } = require('./handlers/limitOrderHandler');
const { registerReferralHandlers } = require('./handlers/referralHandler');
const { registerSettingsHandlers } = require('./handlers/settingsHandler');
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
        // Call the wallet management handler
        return bot.context._handlers.walletManagementHandler(ctx);
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
    
    bot.action('copy_trading', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        return ctx.reply('Copy trading feature is coming soon!');
      } catch (error) {
        logger.error(`Copy trading error: ${error.message}`);
        return ctx.reply('Sorry, there was an error accessing copy trading.');
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
      walletManagementHandler: async (ctx) => {
        try {
          await ctx.answerCbQuery();
          // Get user
          const user = await userService.getUserByTelegramId(ctx.from.id);
          if (!user) {
            return ctx.reply('You need to create an account first. Please use /start command.');
          }
          
          // Create wallet management keyboard
          const walletKeyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('📥 Import Wallet', 'import_wallet'),
              Markup.button.callback('📤 Export Wallet', 'export_wallet')
            ],
            [
              Markup.button.callback('🔑 Generate New Wallet', 'generate_wallet'),
              Markup.button.callback('💼 Switch Wallet', 'switch_wallet')
            ],
            [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
          ]);
          
          return ctx.reply(
            '💳 *Wallet Management*\n\n' +
            `Current Wallet: \`${user.walletAddress}\`\n\n` +
            'Choose an option:',
            {
              parse_mode: 'Markdown',
              ...walletKeyboard
            }
          );
        } catch (error) {
          logger.error(`Wallet management handler error: ${error.message}`);
          return ctx.reply('Sorry, there was an error accessing wallet management.');
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
    
    // Enable graceful stop
    process.once('SIGINT', () => {
      logger.info('SIGINT received. Stopping bot...');
      bot.stop('SIGINT');
    });
    
    process.once('SIGTERM', () => {
      logger.info('SIGTERM received. Stopping bot...');
      bot.stop('SIGTERM');
    });
  } catch (error) {
    logger.error(`Error starting bot: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { startBot, bot }; 