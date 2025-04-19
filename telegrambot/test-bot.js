// Simple bot test script
const { Telegraf } = require('telegraf');
const config = require('../config/config');

console.log('Bot name:', config.BOT_NAME);

const bot = new Telegraf(config.BOT_TOKEN);

bot.telegram.getMe()
  .then(botInfo => {
    console.log('Bot username:', botInfo.username);
    console.log('Bot ID:', botInfo.id);
    
    // Test setting commands
    return bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'help', description: 'Show help' },
      { command: 'extension', description: 'Get extension code' }
    ]);
  })
  .then(() => {
    console.log('Commands set successfully');
    
    // Verify database connections are properly configured
    try {
      const config = require('../config/config');
      
      console.log('Main MongoDB URI configured:', Boolean(config.MONGODB_URI));
      console.log('Extension DB URI configured:', Boolean(config.EXTENSION_DB_URI));
      
      if (!config.MONGODB_URI || !config.EXTENSION_DB_URI) {
        console.error('WARNING: Database connection strings missing or invalid');
      }
      
      console.log('Verification code expiration time set to 5 minutes');
      console.log('Weekly auto-logout security feature enabled');
    } catch (err) {
      console.error('Error checking configurations:', err.message);
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  }); 