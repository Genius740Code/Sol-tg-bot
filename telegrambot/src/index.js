const { Telegraf } = require('telegraf');
const schedule = require('node-schedule');
const { connectDB, logger, dbCache } = require('./database');
const { startHandler } = require('./handlers/startHandler');
const { refreshHandler } = require('./handlers/refreshHandler');
const { tokenInfoHandler, registerTokenHandlers } = require('./handlers/tokenHandler');
const { referralHandler, registerReferralHandlers } = require('./handlers/referralHandler');
const { settingsHandler, registerSettingsHandlers } = require('./handlers/settingsHandler');
const { positionsHandler, registerPositionHandlers } = require('./handlers/positionHandler');
const { limitOrdersHandler, registerLimitOrderHandlers } = require('./handlers/limitOrderHandler');
const { registerWalletHandlers } = require('./handlers/wallet');
const { registerExtensionHandlers } = require('./handlers/extensionHandler');
const { registerSniperHandlers } = require('./handlers/sniperHandler');
const { registerCopyTradingHandlers } = require('./handlers/copyTradingHandler');
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

// Constants for performance tuning
const CONNECTION_TIMEOUT_MS = 30000;
const CONNECTION_RETRY_DELAY_MS = 5000;
const MAX_CONNECTION_RETRIES = 10;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window for rate limiting
const RATE_LIMIT_MAX_REQUESTS = 60; // Max 60 requests per minute per user

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
  logger.info('Created logs directory');
}

// Rate limiting map with automatic cleanup
const rateLimitMap = new Map();
let lastRateLimitCleanup = Date.now();

// Performance metrics tracking
const metrics = {
  totalRequests: 0,
  totalErrors: 0,
  responseTime: {
    sum: 0,
    count: 0,
    avg: 0
  },
  commandCounts: {},
  startTime: Date.now()
};

// Create bot instance with advanced options for better performance
const botOptions = {
  telegram: {
    apiRoot: config.TELEGRAM_API_ROOT || 'https://api.telegram.org',
    webhookReply: false, // Must be false for polling
    testEnv: process.env.NODE_ENV === 'development'
  },
  handlerTimeout: 90000, // 90 seconds timeout for handlers
};

const bot = new Telegraf(config.BOT_TOKEN, botOptions);

// Enhanced error handling with better logging and retry mechanisms
bot.catch((err, ctx) => {
  metrics.totalErrors++;
  
  // Log detailed error information
  const errorInfo = {
    message: err.message,
    stack: err.stack,
    updateType: ctx.updateType,
    user: ctx.from ? `${ctx.from.id} (${ctx.from.username || 'no username'})` : 'unknown',
    chat: ctx.chat ? `${ctx.chat.id} (${ctx.chat.type})` : 'unknown'
  };
  
  logger.error(`Bot error for ${errorInfo.updateType}`, errorInfo);
  
  // Respond to user with appropriate message based on error type
  if (err.code === 'ETELEGRAM' && err.response && err.response.description) {
    // Telegram API error
    if (err.response.description.includes('retry after')) {
      // Rate limit error
      ctx.reply('You\'re making too many requests. Please wait a moment before trying again.')
        .catch(e => logger.error('Error sending rate limit message', e));
    } else {
      // Other Telegram API error
      ctx.reply('An error occurred. Please try again later.')
        .catch(e => logger.error('Error sending API error message', e));
    }
  } else {
    // Generic error
    ctx.reply('An error occurred. Please try again.')
      .catch(e => logger.error('Error sending error message to user', e));
  }
});

// Connect to database with enhanced retry strategy
const connectWithRetry = async (retries = MAX_CONNECTION_RETRIES, delay = CONNECTION_RETRY_DELAY_MS) => {
  try {
    logger.info(`Attempting to connect to database (attempt ${MAX_CONNECTION_RETRIES - retries + 1}/${MAX_CONNECTION_RETRIES})`);
    await connectDB();
    logger.info('✅ Connected to MongoDB');
    return true;
  } catch (err) {
    if (retries === 0) {
      logger.error(`Database connection error after all retries: ${err.message}`);
      process.exit(1);
    }
    
    logger.warn(`Database connection error: ${err.message}, retrying in ${delay/1000}s... (${retries} retries left)`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return connectWithRetry(retries - 1, Math.min(delay * 1.5, 30000)); // Exponential backoff with max 30s
  }
};

// Start sequence with proper error handling
const startBot = async () => {
  try {
    // Step 1: Connect to database
    await connectWithRetry();
    logger.info('Database connection established');
    
    // Step 2: Check DNS connectivity (optional but helps with network diagnosis)
    await checkDnsConnectivity();
    
    // Step 3: Set up bot commands and middleware
    setupBot();
    
    // Step 4: Start scheduled jobs
    setupScheduledJobs();
    
    // Step 5: Start the bot
    if (process.env.NODE_ENV === 'production' && config.WEBHOOK_URL) {
      // Use webhooks in production if configured
      await startWebhook();
    } else {
      // Use polling otherwise
      await startPolling();
    }
    
    // Step 6: Log successful start
    logger.info(`Bot started successfully in ${process.env.NODE_ENV || 'development'} mode`);
    
    // Return the bot instance
    return bot;
  } catch (error) {
    logger.error(`Failed to start bot: ${error.message}`, { stack: error.stack });
    process.exit(1);
  }
};

// Check DNS connectivity to verify network access
const checkDnsConnectivity = async () => {
  try {
    const resolve4 = promisify(dns.resolve4);
    await resolve4('api.telegram.org');
    logger.info('DNS resolution successful');
    return true;
  } catch (error) {
    logger.warn(`DNS resolution failed: ${error.message}. This may indicate network connectivity issues.`);
    return false;
  }
};

// Setup bot commands and middleware
const setupBot = () => {
  // Add performance monitoring middleware
  bot.use(async (ctx, next) => {
    const startTime = Date.now();
    metrics.totalRequests++;
    
    // Track command usage
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
      const command = ctx.message.text.split(' ')[0];
      metrics.commandCounts[command] = (metrics.commandCounts[command] || 0) + 1;
    }
    
    // Rate limiting check
    if (isRateLimited(ctx)) {
      return ctx.reply('You are making too many requests. Please slow down.');
    }
    
    // Process request
    await next();
    
    // Calculate response time
    const responseTime = Date.now() - startTime;
    metrics.responseTime.sum += responseTime;
    metrics.responseTime.count++;
    metrics.responseTime.avg = metrics.responseTime.sum / metrics.responseTime.count;
    
    // Log slow responses
    if (responseTime > 2000) {
      logger.warn(`Slow response (${responseTime}ms) for update type: ${ctx.updateType}`);
    }
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
    { command: COMMANDS.WALLETS, description: 'Manage your wallets' },
    { command: COMMANDS.EXTENSION, description: 'Get authentication code for the browser extension' }
  ]);
  
  // Register all handlers
  registerTokenHandlers(bot);
  registerPositionHandlers(bot);
  registerLimitOrderHandlers(bot);
  registerReferralHandlers(bot);
  registerSettingsHandlers(bot);
  registerWalletHandlers(bot);
  registerExtensionHandlers(bot);
  registerSniperHandlers(bot);
  registerCopyTradingHandlers(bot);
  
  // Register command handlers
  registerCommandHandlers();
  
  // Register action handlers
  registerActionHandlers();
  
  // Register text message handler
  registerTextHandler();
};

// Start bot with polling (development mode)
const startPolling = async () => {
  try {
    await bot.launch({
      allowedUpdates: ['message', 'callback_query', 'inline_query'],
      dropPendingUpdates: true
    });
    logger.info('Bot started in polling mode');
    return true;
  } catch (error) {
    logger.error(`Failed to start polling: ${error.message}`);
    throw error;
  }
};

// Start bot with webhook (production mode)
const startWebhook = async () => {
  try {
    const webhookInfo = await bot.telegram.getWebhookInfo();
    
    if (webhookInfo.url !== config.WEBHOOK_URL) {
      // Set webhook if not already set correctly
      await bot.telegram.setWebhook(config.WEBHOOK_URL, {
        max_connections: 100,
        allowed_updates: ['message', 'callback_query', 'inline_query']
      });
      logger.info(`Webhook set to ${config.WEBHOOK_URL}`);
    } else {
      logger.info(`Webhook already set to ${webhookInfo.url}`);
    }
    
    // Start Express server for webhook
    const express = require('express');
    const app = express();
    
    // Middleware to parse JSON
    app.use(express.json());
    
    // Webhook route
    app.post(`/${config.BOT_TOKEN}`, (req, res) => {
      bot.handleUpdate(req.body, res);
    });
    
    // Health check route
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - metrics.startTime) / 1000),
        metrics: {
          requests: metrics.totalRequests,
          errors: metrics.totalErrors,
          avgResponseTime: Math.round(metrics.responseTime.avg)
        }
      });
    });
    
    // Start server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      logger.info(`Webhook server listening on port ${PORT}`);
    });
    
    return true;
  } catch (error) {
    logger.error(`Failed to set webhook: ${error.message}`);
    throw error;
  }
};

// Setup scheduled jobs
const setupScheduledJobs = () => {
  // Schedule job to update SOL price every 5 minutes
  schedule.scheduleJob('*/5 * * * *', async () => {
    try {
      const price = await getSolPrice();
      logger.info(`Scheduled SOL price update: $${price}`);
      
      // Cache the price for faster access
      dbCache.set('sol_price', price, 300000); // 5 minutes TTL
    } catch (error) {
      logger.error(`Failed to update SOL price: ${error.message}`);
    }
  });
  
  // Schedule job to clean up cache every hour
  schedule.scheduleJob('0 * * * *', async () => {
    try {
      const cacheStats = dbCache.getStats();
      logger.info(`Cache cleanup: ${JSON.stringify(cacheStats)}`);
    } catch (error) {
      logger.error(`Cache cleanup error: ${error.message}`);
    }
  });
  
  // Add more scheduled jobs as needed
};

// Rate limiting implementation
const isRateLimited = (ctx) => {
  if (!ctx.from) return false;
  
  const userId = ctx.from.id;
  const now = Date.now();
  
  // Clean up rate limit map periodically
  if (now - lastRateLimitCleanup > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.forEach((data, key) => {
      if (now - data.firstRequest > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    });
    lastRateLimitCleanup = now;
  }
  
  // Get user's rate limit data
  let userData = rateLimitMap.get(userId);
  
  if (!userData) {
    // First request from this user
    userData = {
      count: 1,
      firstRequest: now
    };
    rateLimitMap.set(userId, userData);
    return false;
  }
  
  // Reset counter if window has passed
  if (now - userData.firstRequest > RATE_LIMIT_WINDOW_MS) {
    userData.count = 1;
    userData.firstRequest = now;
    return false;
  }
  
  // Increment counter
  userData.count++;
  
  // Check if user has exceeded rate limit
  return userData.count > RATE_LIMIT_MAX_REQUESTS;
};

// Register command handlers
const registerCommandHandlers = () => {
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
      '/wallets - Manage your wallets\n' +
      '/extension - Get code for browser extension login\n\n' +
      '*Features:*\n' +
      `${feeText}\n` +
      '• Create limit orders for precise trading\n' +
      '• Analyze tokens with Helius API\n' +
      '• View your trading positions and P/L\n' +
      '• Set price alerts and take profit/stop loss\n' +
      '• Refer friends and earn 35% of their fees\n' +
      '• Use our browser extension for quick trading\n\n' +
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
    const { walletManagementHandler } = require('./handlers/wallet');
    return walletManagementHandler(ctx);
  });
};

// Register action handlers
const registerActionHandlers = () => {
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
    const { walletManagementHandler } = require('./handlers/wallet');
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
};

// Register text message handler
const registerTextHandler = () => {
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
      
      // Handle based on current user state
      switch (user.state.action) {
        case 'awaiting_wallet':
          const { addWalletHandler } = require('./handlers/wallet');
          return addWalletHandler(ctx);
        
        case 'awaiting_referral_code':
          const { addReferralHandler } = require('./handlers/referralHandler');
          return addReferralHandler(ctx);
          
        // Add other state handlers as needed
          
        default:
          // Unknown state
          return ctx.reply(
            "I'm not sure what you want to do. Please use the menu."
          );
      }
      
    } catch (error) {
      logger.error(`Text handler error: ${error.message}`, { stack: error.stack });
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
};

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  try {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    
    // Stop bot
    await bot.stop(signal);
    logger.info('Bot stopped');
    
    // Close DB connection
    await mongoose.connection.close();
    logger.info('Database connection closed');
    
    // Report final metrics
    logger.info(`Final metrics: ${JSON.stringify({
      uptime: Math.floor((Date.now() - metrics.startTime) / 1000),
      totalRequests: metrics.totalRequests,
      totalErrors: metrics.totalErrors,
      avgResponseTime: Math.round(metrics.responseTime.avg)
    })}`);
    
    process.exit(0);
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
};

// Handle signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
  
  // Exit after logging in production, stay alive in development
  if (process.env.NODE_ENV === 'production') {
    logger.error('Exiting due to uncaught exception in production mode');
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason: reason?.stack || reason });
  
  // Exit after logging in production, stay alive in development
  if (process.env.NODE_ENV === 'production') {
    logger.error('Exiting due to unhandled rejection in production mode');
    process.exit(1);
  }
});

// Start the bot and export it
startBot()
  .then(botInstance => {
    // Export the bot if needed for testing
    module.exports = { bot: botInstance };
  })
  .catch(error => {
    logger.error(`Failed to start application: ${error.message}`);
    process.exit(1);
  });