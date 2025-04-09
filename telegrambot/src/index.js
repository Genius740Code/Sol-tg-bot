const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');
require('dotenv').config();
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
const { COMMANDS, ACTIONS } = require('../utils/constants');
const fs = require('fs');
const path = require('path');
const { User, FEE_CONFIG } = require('./models/user');
const userService = require('./services/userService');

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
const bot = new Telegraf(process.env.BOT_TOKEN);

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
  { command: COMMANDS.REFERRALS, description: 'View and manage referrals' }
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
    '/referrals - View and manage referrals\n\n' +
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

// Start the bot
bot.launch()
  .then(() => {
    logger.info('Bot started successfully');
  })
  .catch((error) => {
    logger.error(`Failed to start bot: ${error.message}`);
    process.exit(1);
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