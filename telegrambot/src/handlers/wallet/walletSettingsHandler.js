/**
 * Wallet settings handler
 * This file handles wallet-related settings and operations that were previously in settingsHandler.js
 */

const { Markup } = require('telegraf');
const userService = require('../../services/userService');
const { logger } = require('../../database');
const { encrypt, decrypt } = require('../../../utils/encryption');

// Wallet management handler
const walletSettingsHandler = async (ctx) => {
  try {
    await ctx.reply(
      '👛 Wallet Management\n\n' +
      'You can manage your wallet keys and create new wallets here:',
      Markup.inlineKeyboard([
        [Markup.button.callback('🔑 Export Private Key', 'export_key')],
        [Markup.button.callback('📥 Import Wallet', 'import_wallet')],
        [Markup.button.callback('🆕 Create New Wallet', 'create_wallet')],
        [Markup.button.callback('✏️ Rename Wallet', 'rename_wallet')],
        [Markup.button.callback('⬅️ Back to Start Menu', 'refresh_data')]
      ])
    );
  } catch (error) {
    logger.error(`Wallet management error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing wallet management. Please try again later.');
  }
};

// Export private key handler
const exportKeyHandler = async (ctx) => {
  try {
    // Find user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user || !user.encryptedPrivateKey) {
      return ctx.answerCbQuery('No wallet found');
    }

    // Send warning first
    await ctx.answerCbQuery('Preparing to export your private key');
    
    await ctx.reply(
      '⚠️ *SECURITY WARNING*\n\n' +
      'Your private key gives *complete control* over your wallet!\n\n' +
      '- NEVER share it with anyone\n' +
      '- Store it securely\n' +
      '- Delete this message after copying\n\n' +
      'Are you sure you want to proceed?',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('Yes, show my private key', 'confirm_export'),
            Markup.button.callback('No, cancel', 'wallet_settings')
          ]
        ])
      }
    );
  } catch (error) {
    logger.error(`Export key error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Confirm export handler
const confirmExportHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user || !user.encryptedPrivateKey) {
      return ctx.reply('No wallet found');
    }
    
    try {
      // Get active wallet and decrypt key
      const activeWallet = user.getActiveWallet();
      const privateKey = decrypt(activeWallet.encryptedPrivateKey || user.encryptedPrivateKey);
      
      // Show private key
      await ctx.reply(
        '🔑 *YOUR PRIVATE KEY*\n\n' +
        `\`${privateKey}\`\n\n` +
        '⚠️ KEEP THIS SAFE AND DELETE THIS MESSAGE ⚠️',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('I\'ve saved it securely', 'wallet_settings')]
          ])
        }
      );
      
      // If mnemonic is available, also show it
      if (activeWallet.mnemonic || user.mnemonic) {
        const mnemonic = decrypt(activeWallet.mnemonic || user.mnemonic);
        
        await ctx.reply(
          '📝 *YOUR SECRET RECOVERY PHRASE*\n\n' +
          `\`${mnemonic}\`\n\n` +
          '⚠️ KEEP THIS SAFE AND DELETE THIS MESSAGE ⚠️',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('I\'ve saved it securely', 'wallet_settings')]
            ])
          }
        );
      }
    } catch (error) {
      logger.error(`Decrypt error: ${error.message}`);
      return ctx.reply('Error decrypting your private key. Please contact support.');
    }
  } catch (error) {
    logger.error(`Confirm export error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Import wallet handler
const importWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '📥 *Import Wallet*\n\n' +
      'To import a wallet, please enter your private key or seed phrase (mnemonic).\n\n' +
      '⚠️ *Security Warning*\n' +
      '- Only import from a secure, private location\n' +
      '- Never import your wallet in a public place\n' +
      '- Delete the message after importing',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Cancel', 'wallet_settings')]
        ])
      }
    );
    
    // Set user state to collect key
    await userService.updateUserSettings(ctx.from.id, { state: 'IMPORTING_WALLET' });
  } catch (error) {
    logger.error(`Import wallet error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Create new wallet handler
const createWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '🆕 *Create New Wallet*\n\n' +
      'Would you like to create a new Solana wallet?\n\n' +
      'This will generate a new wallet address and private key. Your current wallet will remain available.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('Yes, create new wallet', 'confirm_create_wallet'),
            Markup.button.callback('No, cancel', 'wallet_settings')
          ]
        ])
      }
    );
  } catch (error) {
    logger.error(`Create wallet error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Register wallet settings handlers
const registerWalletSettingsHandlers = (bot) => {
  // Wallet management menu
  bot.action('wallet_settings', walletSettingsHandler);
  
  // Export key flow
  bot.action('export_key', exportKeyHandler);
  bot.action('confirm_export', confirmExportHandler);
  
  // Import wallet
  bot.action('import_wallet', importWalletHandler);
  
  // Create new wallet
  bot.action('create_wallet', createWalletHandler);
};

module.exports = {
  walletSettingsHandler,
  exportKeyHandler,
  confirmExportHandler,
  importWalletHandler,
  createWalletHandler,
  registerWalletSettingsHandlers
}; 