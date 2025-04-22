const { Telegraf } = require('telegraf');
const { startHandler, refreshHandler } = require('./handlers/startHandler');
const { registerTokenHandlers, buyTokenHandler } = require('./handlers/tokenHandler');
const { registerPositionHandlers, getAllUserTokens } = require('./handlers/positionHandler');
const { registerLimitOrderHandlers } = require('./handlers/limitOrderHandler');
const { registerReferralHandlers } = require('./handlers/referralHandler');
const { registerSettingsHandlers } = require('./handlers/settingsHandler');
const { registerExtensionHandlers } = require('./handlers/extensionHandler');
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
    registerSniperHandlers(bot);
    registerCopyTradingHandlers(bot);
    
    // Register wallet handlers
    const { registerWalletHandlers } = require('./handlers/wallet');
    registerWalletHandlers(bot);
    
    // Register direct refresh action
    bot.action('refresh_data', refreshHandler);
    
    // Add callback handlers for main menu buttons
    bot.action('buy_token', (ctx) => {
      // Use the imported buyTokenHandler
      return buyTokenHandler(ctx);
    });
    
    bot.action('sell_token', async (ctx) => {
      try {
        // Get user
        const user = await userService.getUserByTelegramId(ctx.from.id);
        
        if (!user) {
          return ctx.reply('You need to start the bot first with /start');
        }
        
        // Get user's tokens
        const tokens = await getAllUserTokens(user.id);
        
        if (!tokens || tokens.length === 0) {
          return ctx.reply(
            '❌ *No Tokens to Sell*\n\n' +
            'You don\'t have any tokens to sell.\n' +
            'Buy some tokens first using the Buy function.',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🪙 Buy Tokens', 'buy_token')],
                [Markup.button.callback('🔙 Back to Menu', 'back_to_main_menu')]
              ])
            }
          );
        } else {
          // Forward to token handler's sell function
          const { sellTokenHandler } = require('./handlers/tokenHandler');
          return sellTokenHandler(ctx);
        }
      } catch (error) {
        logger.error(`Error in sell token action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('token_sniper', async (ctx) => {
      try {
        // Use the imported handler
        const { sniperMenuHandler } = require('./handlers/sniperHandler');
        return sniperMenuHandler(ctx);
      } catch (error) {
        logger.error(`Error in token sniper action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('copy_trading', async (ctx) => {
      try {
        // Use the imported handler
        return copyTradingHandler(ctx);
      } catch (error) {
        logger.error(`Error in copy trading action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('view_positions', async (ctx) => {
      try {
        // Use the imported handler from positionHandler.js
        const { viewPositionsHandler } = require('./handlers/positionHandler');
        return viewPositionsHandler(ctx);
      } catch (error) {
        logger.error(`Error in view positions action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('view_limit_orders', async (ctx) => {
      try {
        // Use the imported handler from limitOrderHandler.js
        const { viewLimitOrdersHandler } = require('./handlers/limitOrderHandler');
        return viewLimitOrdersHandler(ctx);
      } catch (error) {
        logger.error(`Error in view limit orders action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('afk_mode', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        
        // Check if bot is expired
        const user = await userService.getUserByTelegramId(ctx.from.id);
        
        if (!user) {
          return ctx.reply('You need to start the bot first with /start');
        }
        
        // Use imported handler
        const { afkModeHandler } = require('./handlers/settingsHandler');
        return afkModeHandler(ctx);
      } catch (error) {
        logger.error(`Error in AFK mode action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('bot_extension', async (ctx) => {
      try {
        // Use the imported handler from extensionHandler.js
        const { extensionHandler } = require('./handlers/extensionHandler');
        return extensionHandler(ctx);
      } catch (error) {
        logger.error(`Error in bot extension action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('view_referrals', async (ctx) => {
      try {
        // Use the imported handler from referralHandler.js
        const { viewReferralsHandler } = require('./handlers/referralHandler');
        return viewReferralsHandler(ctx);
      } catch (error) {
        logger.error(`Error in view referrals action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('wallet_management', async (ctx) => {
      try {
        // Use the imported walletManagementHandler
        const { walletManagementHandler } = require('./handlers/wallet');
        return walletManagementHandler(ctx);
      } catch (error) {
        logger.error(`Error in wallet management action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    bot.action('settings', async (ctx) => {
      try {
        // Use the imported handler from settingsHandler.js
        const { settingsHandler } = require('./handlers/settingsHandler');
        return settingsHandler(ctx);
      } catch (error) {
        logger.error(`Error in settings action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    // Add back to main menu handler
    bot.action('back_to_main_menu', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        
        // Check if user exists
        const user = await userService.getUserByTelegramId(ctx.from.id);
        
        if (!user) {
          return startHandler(ctx);
        }
        
        // Get wallet and SOL balance
        let walletAddress = 'Wallet not available';
        let solBalance = 0;
        
        try {
          const activeWallet = user.getActiveWallet ? user.getActiveWallet() : (user.wallets && user.wallets.length > 0 ? user.wallets.find(w => w.isActive) : null);
          if (activeWallet && activeWallet.address) {
            walletAddress = activeWallet.address;
            solBalance = await getSolPrice(walletAddress).catch(() => 0);
          }
        } catch (error) {
          logger.error(`Error getting wallet in back_to_main_menu: ${error.message}`);
        }
        
        // Get SOL price
        const solPrice = await getSolPrice().catch(() => 100);
        
        // Calculate USD value
        const balanceUsd = solBalance * solPrice;
        
        // Generate fee text based on referrer status
        const hasReferrer = user.referredBy !== null;
        const feeText = hasReferrer ? 
          `🏷️ You have a referral discount: Trading fee ${config.REFERRAL_FEE}% (${config.REFERRAL_DISCOUNT}% off)` : 
          `💡 Refer friends to get ${config.REFERRAL_DISCOUNT}% off trading fees (${config.NORMAL_FEE}% → ${config.REFERRAL_FEE}%)`;
        
        // Create menu keyboard
        const menuKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🪙 Buy', 'buy_token'),
            Markup.button.callback('💰 Sell', 'sell_token')
          ],
          [
            Markup.button.callback('🎯 Sniper', 'token_sniper'),
            Markup.button.callback('📈 Copy Trade', 'copy_trading')
          ],
          [
            Markup.button.callback('📊 Positions', 'view_positions'),
            Markup.button.callback('⏰ Orders', 'view_limit_orders')
          ],
          [
            Markup.button.callback('💤 AFK Mode', 'afk_mode'),
            Markup.button.callback('🔌 Extension', 'bot_extension')
          ],
          [
            Markup.button.callback('👥 Referrals', 'view_referrals'),
            Markup.button.callback('👛 Wallets', 'wallet_management')
          ],
          [
            Markup.button.callback('⚙️ Settings', 'settings'),
            Markup.button.callback('🔄 Refresh', 'refresh_data')
          ]
        ]);
        
        // Send main menu
        return ctx.reply(
          `🤖 *Crypto Trading Bot* 🤖\n\n` +
          `👛 Wallet: \`${walletAddress}\`\n\n` +
          `💎 SOL Balance: ${solBalance.toFixed(4)} SOL ($${balanceUsd.toFixed(2)})\n` +
          `📈 SOL Price: $${solPrice.toFixed(2)}\n\n` +
          `${feeText}`,
          {
            parse_mode: 'Markdown',
            reply_markup: menuKeyboard.reply_markup
          }
        );
      } catch (error) {
        logger.error(`Error in back to main menu action: ${error.message}`);
        return ctx.reply('❌ Sorry, there was an error. Please try again later.');
      }
    });
    
    // Start the bot with polling
    await bot.launch();
    logger.info('Bot started successfully!');
    return true;
  } catch (error) {
    logger.error(`Error starting bot: ${error.message}`);
    throw error;
  }
}

module.exports = { startBot, bot }; 