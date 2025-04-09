const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');
const { startHandler, registerStartHandlers } = require('./handlers/startHandler');
const { buyHandler, registerBuyHandlers } = require('./handlers/buyHandler');
const { sellHandler, registerSellHandlers } = require('./handlers/sellHandler');
const { balanceHandler, registerBalanceHandlers } = require('./handlers/balanceHandler');
const { registerSettingsHandlers } = require('./handlers/settingsHandler');

// Load environment variables
dotenv.config();

// Initialize the bot with token from .env
const bot = new Telegraf(process.env.BOT_TOKEN);

async function startBot() {
  try {
    // Set bot commands
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'buy', description: 'Buy tokens' },
      { command: 'sell', description: 'Sell tokens' },
      { command: 'balance', description: 'Check your wallet balance' },
      { command: 'settings', description: 'Configure bot settings' }
    ]);
    
    // Register handlers
    registerStartHandlers(bot);
    registerBuyHandlers(bot);
    registerSellHandlers(bot);
    registerBalanceHandlers(bot);
    registerSettingsHandlers(bot);
    
    // Start the bot
    await bot.launch();
    console.log('Bot started successfully!');
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    console.error('Error starting bot:', error);
  }
}

// Start the bot
startBot(); 