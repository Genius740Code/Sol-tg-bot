const { Telegraf } = require('telegraf');
const { startHandler, refreshHandler } = require('./handlers/startHandler');
const { registerTokenHandler } = require('./handlers/tokenHandler');
const { registerPositionHandlers } = require('./handlers/positionHandler');
const { registerLimitOrderHandlers } = require('./handlers/limitOrderHandler');
const { registerReferralHandlers } = require('./handlers/referralHandler');
const { registerSettingsHandlers } = require('./handlers/settingsHandler');
const { logger } = require('./database');
require('dotenv').config();

// Initialize the bot with token from environment variable
const bot = new Telegraf(process.env.BOT_TOKEN);

// Start bot function
async function startBot() {
  try {
    logger.info('Starting bot...');
    
    // Register the start command handler
    bot.command('start', startHandler);
    
    // Register all command handlers
    registerTokenHandler(bot);
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
        return ctx.scene.enter('buy_token_scene');
      } catch (error) {
        logger.error(`Buy token error: ${error.message}`);
        return ctx.reply('Sorry, there was an error starting the buy process.');
      }
    });
    
    bot.action('sell_token', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        return ctx.scene.enter('sell_token_scene');
      } catch (error) {
        logger.error(`Sell token error: ${error.message}`);
        return ctx.reply('Sorry, there was an error starting the sell process.');
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