const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');
require('dotenv').config();
const { connectDB, logger } = require('./database');
const { startHandler, refreshHandler } = require('./handlers/startHandler');
const { tokenInfoHandler, registerTokenHandlers, buyTokenHandler, sellTokenHandler } = require('./handlers/tokenHandler');
const { referralHandler, registerReferralHandlers } = require('./handlers/referralHandler');
const { settingsHandler, registerSettingsHandlers } = require('./handlers/settingsHandler');
const { positionsHandler, registerPositionHandlers, buyNewTokenHandler } = require('./handlers/positionHandler');
const { limitOrdersHandler, registerLimitOrderHandlers } = require('./handlers/limitOrderHandler');
const { getSolPrice, getTokenPrice } = require('../utils/wallet');
const fs = require('fs');
const path = require('path');

// Check if logs directory exists, if not create it
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Create bot instance
const bot = new Telegraf(process.env.BOT_TOKEN);

// Set error handling
bot.catch((err, ctx) => {
  logger.error(`Bot error for ${ctx.updateType}`, err);
  ctx.reply('An error occurred while processing this request. Please try again later.')
    .catch(e => logger.error('Error sending error message to user', e));
});

// Connect to database with retry strategy
const connectWithRetry = async (retries = 5, delay = 5000) => {
  try {
    await connectDB();
    logger.info('Connected to MongoDB');
    return true;
  } catch (err) {
    if (retries === 0) {
      logger.error(`Database connection error after all retries: ${err.message}`);
      process.exit(1);
    }
    
    logger.warn(`Database connection error: ${err.message}, retrying in ${delay/1000}s... (${retries} retries left)`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return connectWithRetry(retries - 1, delay);
  }
};

connectWithRetry()
  .then(() => {
    logger.info('Database connection established');
  })
  .catch(err => {
    logger.error(`Fatal database error: ${err.message}`);
    process.exit(1);
  });

// Set bot commands
bot.telegram.setMyCommands([
  { command: 'start', description: 'Start the bot and show main menu' },
  { command: 'buy', description: 'Buy tokens' },
  { command: 'sell', description: 'Sell tokens' },
  { command: 'help', description: 'Show help information' },
  { command: 'settings', description: 'Configure bot settings' },
  { command: 'positions', description: 'View your trading positions' },
  { command: 'orders', description: 'View your limit orders' },
  { command: 'referrals', description: 'View and manage referrals' }
]);

// Start command
bot.command('start', startHandler);

// Buy command
bot.command('buy', buyNewTokenHandler);

// Sell command
bot.command('sell', async (ctx) => {
  await ctx.reply('To sell, please select a token from your positions:');
  return positionsHandler(ctx);
});

// Help command
bot.command('help', async (ctx) => {
  await ctx.reply(
    '🤖 *Crypto Trading Bot Help*\n\n' +
    '*Available Commands:*\n' +
    '/start - Show main menu\n' +
    '/buy - Buy tokens\n' +
    '/sell - Sell tokens from your positions\n' +
    '/help - Show this help message\n' +
    '/settings - Configure bot settings\n' +
    '/positions - View your trading positions\n' +
    '/orders - View your limit orders\n' +
    '/referrals - View and manage referrals\n\n' +
    '*Features:*\n' +
    '• Buy and sell Solana tokens with 0.8% fees (0.712% with referral)\n' +
    '• Create limit orders for precise trading\n' +
    '• Analyze tokens with Helius API\n' +
    '• View your trading positions and P/L\n' +
    '• Set price alerts and take profit/stop loss\n' +
    '• Refer friends and earn 35% of their fees\n\n' +
    '*Paste a token address to analyze it and get market data.*',
    {
      parse_mode: 'Markdown'
    }
  );
});

// Settings command
bot.command('settings', settingsHandler);

// Positions command
bot.command('positions', positionsHandler);

// Orders command
bot.command('orders', limitOrdersHandler);

// Referrals command
bot.command('referrals', referralHandler);

// Refresh button handler
bot.hears('🔄 Refresh', refreshHandler);

// Buy button handler
bot.hears('💰 Buy', buyNewTokenHandler);

// Sell button handler
bot.hears('💸 Sell', async (ctx) => {
  await ctx.reply('To sell, please select a token from your positions:');
  return positionsHandler(ctx);
});

// Register handlers for other commands
registerTokenHandlers(bot);
registerReferralHandlers(bot);
registerSettingsHandlers(bot);
registerPositionHandlers(bot);
registerLimitOrderHandlers(bot);

// Handle unknown commands
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  
  // Check if this might be a token address
  if (message.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
    return tokenInfoHandler(ctx);
  }
  
  // Default response
  await ctx.reply(
    "I'm not sure what you're trying to do. Please use the menu or type /help for available commands."
  );
});

// Schedule price update job (every minute)
schedule.scheduleJob('* * * * *', async () => {
  try {
    // Get current SOL price
    const solPrice = await getSolPrice();
    logger.info(`Scheduled price update: SOL = $${solPrice}`);
    
    // Here you could check user limit orders against current prices
    // and execute trades if conditions are met
    
    // For a production system, you would implement a separate worker
    // that processes all active orders against current prices
  } catch (error) {
    logger.error(`Scheduled price update error: ${error.message}`);
  }
});

// Start bot
logger.info('Starting bot...');
bot.launch()
  .then(() => {
    logger.info('Bot started successfully');
  })
  .catch((err) => {
    logger.error(`Bot failed to start: ${err.message}`);
  });

// Enable graceful stop
process.once('SIGINT', () => {
  logger.info('SIGINT received. Stopping bot...');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  logger.info('SIGTERM received. Stopping bot...');
  bot.stop('SIGTERM');
});