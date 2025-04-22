const { Markup } = require('telegraf');
const userService = require('../../services/userService');
const { logger } = require('../../database');
const { getSolPrice } = require('../../../utils/wallet');
const { formatPrice } = require('../../../utils/messageUtils');

// Create new wallet handler
const createNewWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Check if user already has 6 wallets
    if (user.wallets && user.wallets.length >= 6) {
      return ctx.reply(
        '❌ *Maximum Wallets Reached*\n\n' +
        'You already have 6 wallets, which is the maximum allowed.\n' +
        'Please delete an existing wallet before creating a new one.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
    
    // Ask for confirmation
    return ctx.reply(
      '🆕 *Create New Wallet*\n\n' +
      'Would you like to create a new Solana wallet?\n\n' +
      'This will generate a new wallet address and private key. Your current wallet will remain available.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Create Wallet', 'confirm_new_wallet'),
            Markup.button.callback('❌ Cancel', 'wallet_management')
          ]
        ])
      }
    );
  } catch (error) {
    logger.error(`Create wallet error: ${error.message}`);
    return ctx.reply('❌ Sorry, there was an error. Please try again later.');
  }
};

// Confirm new wallet creation
const confirmNewWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Generate new wallet through the userService
    const updatedUser = await userService.generateNewWallet(ctx.from.id);
    
    if (!updatedUser) {
      return ctx.reply('Failed to create wallet. Please try again later.');
    }
    
    // Get the active wallet
    const activeWallet = updatedUser.getActiveWallet();
    
    // Get SOL price for display
    const solPrice = await getSolPrice();
    
    await ctx.reply(
      '✅ *New Wallet Created*\n\n' +
      `Name: ${activeWallet.name}\n` +
      `Address: \`${activeWallet.address}\`\n\n` +
      `SOL Price: $${formatPrice(solPrice)}\n\n` +
      'Your new wallet is now active.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔑 Export Private Key', 'export_key')],
          [Markup.button.callback('⬅️ Back to Wallet Management', 'wallet_management')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Confirm create wallet error: ${error.message}`);
    await ctx.reply('Failed to create new wallet. Please try again later.');
  }
};

module.exports = {
  createNewWalletHandler,
  confirmNewWalletHandler
}; 