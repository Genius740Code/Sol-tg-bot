const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');
const { connectDB, logger } = require('./database');
const { startHandler } = require('./handlers/startHandler');
const { refreshHandler } = require('./handlers/refreshHandler');
const { tokenInfoHandler, registerTokenHandlers, sellTokenHandler } = require('./handlers/tokenHandler');
const { referralHandler, registerReferralHandlers } = require('./handlers/referralHandler');
const { settingsHandler, registerSettingsHandlers } = require('./handlers/settingsHandler');
const { positionsHandler, registerPositionHandlers } = require('./handlers/positionHandler');
const { limitOrdersHandler, registerLimitOrderHandlers } = require('./handlers/limitOrderHandler');
const { registerWalletHandlers } = require('./handlers/walletHandler');
const { getSolPrice } = require('../utils/wallet');
const { updateOrSendMessage, extractUserInfo, formatPrice } = require('../utils/messageUtils');
const { COMMANDS, ACTIONS } = require('../../config/constants');
const fs = require('fs');
const path = require('path');
const { User, FEE_CONFIG } = require('./models/user');
const userService = require('./services/userService');
const mongoose = require('mongoose');
const dns = require('dns');
const { promisify } = require('util');
const config = require('../../config/config');

// Add this at the top of the file, before any imports
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Temporarily disable SSL certificate validation for development

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  logger.info('Created logs directory');
} else {
  // Clear logs on startup
  try {
    const logFiles = fs.readdirSync(logsDir);
    logFiles.forEach(file => {
      fs.writeFileSync(path.join(logsDir, file), '', { flag: 'w' });
    });
    logger.info('Cleared log files on startup');
  } catch (err) {
    logger.error(`Error clearing logs: ${err.message}`);
  }
}

// Create bot instance
const bot = new Telegraf(config.BOT_TOKEN);

// Set error handling
bot.catch((err, ctx) => {
  logger.error(`Bot error for ${ctx.updateType}`, err);
  ctx.reply('An error occurred. Please try again.')
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
  { command: COMMANDS.START, description: 'Start the bot and show main menu' },
  { command: COMMANDS.SELL, description: 'Sell tokens' },
  { command: COMMANDS.HELP, description: 'Show help information' },
  { command: COMMANDS.SETTINGS, description: 'Configure bot settings' },
  { command: COMMANDS.POSITIONS, description: 'View your trading positions' },
  { command: COMMANDS.ORDERS, description: 'View your limit orders' },
  { command: COMMANDS.REFERRALS, description: 'View and manage referrals' },
  { command: COMMANDS.WALLETS, description: 'Manage your wallets' }
]);

// Register all handlers
registerTokenHandlers(bot);
registerPositionHandlers(bot);
registerLimitOrderHandlers(bot);
registerReferralHandlers(bot);
registerSettingsHandlers(bot);
registerWalletHandlers(bot);

// Start command
bot.command(COMMANDS.START, startHandler);

// Sell command
bot.command(COMMANDS.SELL, async (ctx) => {
  return positionsHandler(ctx);
});

// Help command
bot.command(COMMANDS.HELP, async (ctx) => {
  // Get the user to show their specific fee info
  const userInfo = extractUserInfo(ctx);
  if (!userInfo || !userInfo.userId) {
    return ctx.reply('Please use /start to initialize your account.');
  }
  
  const user = await userService.getUserByTelegramId(userInfo.userId);
  let feeText;
  
  if (user) {
    const feeInfo = await userService.getUserFeeInfo(userInfo.userId);
    feeText = `• Trade Solana tokens with ${feeInfo.baseFee * 100}% fees (${feeInfo.discountedFee * 100}% with referral)`;
  } else {
    // Default text if user not found
    feeText = `• Trade Solana tokens with low fees (even lower with referrals)`;
  }
  
  await ctx.reply(
    '🤖 *Crypto Trading Bot Help*\n\n' +
    '*Available Commands:*\n' +
    '/start - Show main menu\n' +
    '/sell - Sell tokens from your positions\n' +
    '/help - Show this help message\n' +
    '/settings - Configure bot settings\n' +
    '/positions - View your trading positions\n' +
    '/orders - View your limit orders\n' +
    '/referrals - View and manage referrals\n' +
    '/wallets - Manage your wallets\n\n' +
    '*Features:*\n' +
    `${feeText}\n` +
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
bot.command(COMMANDS.SETTINGS, settingsHandler);

// Positions command
bot.command(COMMANDS.POSITIONS, positionsHandler);

// Orders command
bot.command(COMMANDS.ORDERS, limitOrdersHandler);

// Referrals command
bot.command(COMMANDS.REFERRALS, referralHandler);

// Wallets command
bot.command(COMMANDS.WALLETS, async (ctx) => {
  const { walletManagementHandler } = require('./handlers/walletHandler');
  return walletManagementHandler(ctx);
});

// Refresh button handler
bot.action(ACTIONS.REFRESH, refreshHandler);

// Sell button handler
bot.action(ACTIONS.SELL, async (ctx) => {
  await ctx.answerCbQuery();
  return positionsHandler(ctx);
});

// Other action handlers
bot.action(ACTIONS.POSITIONS, async (ctx) => {
  await ctx.answerCbQuery();
  return positionsHandler(ctx);
});

bot.action(ACTIONS.REFERRALS, async (ctx) => {
  await ctx.answerCbQuery();
  return referralHandler(ctx);
});

bot.action(ACTIONS.LIMIT_ORDERS, async (ctx) => {
  await ctx.answerCbQuery();
  return limitOrdersHandler(ctx);
});

bot.action(ACTIONS.SETTINGS, async (ctx) => {
  await ctx.answerCbQuery();
  return settingsHandler(ctx);
});

bot.action(ACTIONS.WALLETS, async (ctx) => {
  await ctx.answerCbQuery();
  // Use the walletManagementHandler from walletHandler.js
  const { walletManagementHandler } = require('./handlers/walletHandler');
  return walletManagementHandler(ctx);
});

// Placeholder handlers for buy and copy trading
bot.action(ACTIONS.BUY, async (ctx) => {
  try {
    await ctx.answerCbQuery('Buy feature available soon');
    // Display current message with brief notification
    return refreshHandler(ctx);
  } catch (error) {
    logger.error(`Buy placeholder error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
});

bot.action(ACTIONS.COPY_TRADING, async (ctx) => {
  try {
    await ctx.answerCbQuery('Copy Trading feature available soon');
    // Display current message with brief notification
    return refreshHandler(ctx);
  } catch (error) {
    logger.error(`Copy trading placeholder error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
});

// Update the input text handler for wallet and referral code actions
bot.on('text', async (ctx, next) => {
  try {
    // Extract user info
    const userInfo = extractUserInfo(ctx);
    if (!userInfo || !userInfo.userId) {
      return next();
    }
    
    // Skip handling if this is a command (starts with /)
    const message = ctx.message.text;
    if (message.startsWith('/')) {
      return next();
    }
    
    // Check if this is a token address (for token info)
    if (message.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      // This looks like a token address
      return tokenInfoHandler(ctx);
    }
    
    // If not a token address, we check if there's a special state in user
    const user = await userService.getUserByTelegramId(userInfo.userId);
    
    if (!user || !user.state) {
      // No special state, just respond that we don't understand
      return ctx.reply(
        "Please use the menu or type a token address to get information about it."
      );
    }
    
    // Handle specific states through their own handlers
    if (user.state === 'IMPORTING_WALLET' || 
        user.state === 'CHANGING_WALLET_ADDRESS' ||
        user.state === 'RENAMING_WALLET') {
      // Get the wallet handler module
      const walletHandler = require('./handlers/walletHandler');
      return walletHandler.handleWalletTextInput(ctx);
    } else if (user.state === 'CREATING_REFERRAL_CODE') {
      // Get the referral handler module
      const referralHandler = require('./handlers/referralHandler');
      return referralHandler.handleReferralCodeInput(ctx);
    }
    
    // If we reach here, the state wasn't handled
    return next();
  } catch (error) {
    logger.error(`Error handling text input: ${error.message}`);
    return next();
  }
});

// Run scheduled processes for updating prices
schedule.scheduleJob('*/1 * * * *', async () => {
  try {
    const solPrice = await getSolPrice();
    logger.info(`Scheduled price update: SOL = $${solPrice}`);
    
    // Here you could check user limit orders against current prices
    // and execute trades if conditions are met
  } catch (error) {
    logger.error(`Error updating SOL price: ${error.message}`);
  }
});

// Schedule periodic memory cleanup
const memoryCleanupJob = schedule.scheduleJob('*/30 * * * *', async () => {
  try {
    logger.info('Running scheduled memory cleanup');
    
    // Force garbage collection if available (Node must be started with --expose-gc)
    if (global.gc) {
      global.gc();
      logger.info('Forced garbage collection completed');
    }
    
    // Check memory usage
    const memoryUsage = process.memoryUsage();
    logger.info(`Memory usage: RSS ${Math.round(memoryUsage.rss / 1024 / 1024)} MB, Heap ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}/${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`);
  } catch (error) {
    logger.error(`Error during memory cleanup: ${error.message}`);
  }
});

// Handle graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Stopping bot...`);
  
  // Stop all scheduled jobs
  schedule.gracefulShutdown()
    .then(() => logger.info('Scheduled jobs stopped'))
    .catch(err => logger.error(`Error stopping scheduled jobs: ${err.message}`))
    .finally(() => {
      // Close database connection
      mongoose.connection.close()
        .then(() => logger.info('Database connection closed'))
        .catch(err => logger.error(`Error closing database connection: ${err.message}`))
        .finally(() => {
          // Stop bot
          bot.stop();
          logger.info('Bot started successfully');
          process.exit(0);
        });
    });
};

// Handle termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Add direct AFK mode handler to the main file
bot.action('afk_mode', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Toggle AFK mode for the user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Toggle AFK mode
    const currentAfkMode = user.settings?.afkMode || false;
    const newAfkMode = !currentAfkMode;
    
    // Update user settings
    await userService.updateUserSettings(ctx.from.id, {
      'settings.afkMode': newAfkMode
    });
    
    // Show confirmation and return to main menu
    await ctx.reply(
      `✅ AFK Mode ${newAfkMode ? 'Enabled' : 'Disabled'}\n\n` +
      `${newAfkMode ? 
        'Bot will now automatically process trades without confirmation.' : 
        'Bot will now ask for confirmation before executing trades.'}`
    );
    
    // Return to main menu
    return refreshHandler(ctx);
  } catch (error) {
    logger.error(`AFK mode error: ${error.message}`);
    return ctx.reply('Sorry, there was an error changing AFK mode. Please try again later.');
  }
});

// Configure DNS fallback
dns.setServers([
  '8.8.8.8',      // Google DNS
  '1.1.1.1',      // Cloudflare DNS
  '208.67.222.222', // OpenDNS
  '9.9.9.9'       // Quad9 DNS
]);

// DNS resolver function for API calls
const resolveDns = async (hostname) => {
  try {
    const lookup = promisify(dns.lookup);
    const result = await lookup(hostname);
    console.log(`Resolved ${hostname} to ${result.address}`);
    return result.address;
  } catch (error) {
    console.error(`DNS resolution failed for ${hostname}: ${error.message}`);
    // Return a default IP if resolution fails (this is just a fallback)
    return '104.16.56.34'; // Example fallback IP (should be replaced with actual IP)
  }
};

// Pre-resolve critical domains
(async () => {
  try {
    await resolveDns('price.jup.ag');
    await resolveDns('api.coingecko.com');
    await resolveDns('api.helius.xyz');
  } catch (error) {
    console.error(`Failed to pre-resolve domains: ${error.message}`);
  }
})();

// Start the bot
bot.launch()
  .then(() => {
    logger.info('Bot started successfully');
  })
  .catch((error) => {
    logger.error(`Failed to start bot: ${error.message}`);
    process.exit(1);
  });