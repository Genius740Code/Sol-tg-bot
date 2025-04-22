const { Markup } = require('telegraf');
const userService = require('../../services/userService');
const { logger } = require('../../database');
const { importWalletFromPrivateKey } = require('../../../utils/wallet');
const { encrypt } = require('../../../utils/encryption');

// Import wallet handler
const importWalletHandler = async (ctx) => {
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
        'Please delete an existing wallet before importing a new one.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
    
    // Store state to expect private key in next message
    user.state = 'IMPORT_WALLET_WAITING_KEY';
    await user.save();
    
    return ctx.reply(
      '🔑 *Import Wallet*\n\n' +
      'Please send your Solana private key or mnemonic phrase (seed words).\n\n' +
      '⚠️ This message with your private key will be deleted after processing for security.\n\n' +
      'Note: For better security, consider using a secure messaging app to send yourself the key, then copy-paste it here.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('❌ Cancel Import', 'wallet_management')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Import wallet error: ${error.message}`);
    return ctx.reply('❌ Sorry, there was an error. Please try again later.');
  }
};

// Handle wallet text input (for private key/mnemonic)
const handleWalletTextInput = async (ctx) => {
  try {
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user || !user.state) {
      return;
    }
    
    // Handle based on state
    if (user.state === 'IMPORT_WALLET_WAITING_KEY') {
      // Get the private key or mnemonic from message
      const privateKeyOrMnemonic = ctx.message.text.trim();
      
      // Delete message containing private key/mnemonic for security
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (deleteError) {
        logger.warn(`Failed to delete message with private key: ${deleteError.message}`);
      }
      
      // Reset state first to prevent issues
      user.state = null;
      await user.save();
      
      try {
        const importedWallet = await importWalletFromPrivateKey(privateKeyOrMnemonic);
        
        // Check if wallet already exists
        const walletExists = user.wallets.some(w => w.address === importedWallet.publicKey);
        if (walletExists) {
          return ctx.reply(
            '❌ *Wallet Already Exists*\n\n' +
            'This wallet is already in your wallet list.\n' +
            'Please use wallet switching to select it.',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
              ])
            }
          );
        }
        
        // Set all existing wallets to inactive
        user.wallets.forEach(w => {
          w.isActive = false;
        });
        
        // Determine wallet name
        const walletNumber = user.wallets.length + 1;
        const walletName = `Wallet ${walletNumber}`;
        
        // Add new wallet
        user.wallets.push({
          name: walletName,
          address: importedWallet.publicKey,
          encryptedPrivateKey: encrypt(importedWallet.privateKey),
          mnemonic: importedWallet.mnemonic ? encrypt(importedWallet.mnemonic) : null,
          isActive: true
        });
        
        // Also update main wallet fields for compatibility
        user.walletAddress = importedWallet.publicKey;
        user.encryptedPrivateKey = encrypt(importedWallet.privateKey);
        if (importedWallet.mnemonic) {
          user.mnemonic = encrypt(importedWallet.mnemonic);
        }
        
        await user.save();
        
        return ctx.reply(
          '✅ *Wallet Imported Successfully*\n\n' +
          `Name: ${walletName}\n` +
          `Address: \`${importedWallet.publicKey}\`\n\n` +
          'Your imported wallet is now active.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      } catch (importError) {
        logger.error(`Error importing wallet: ${importError.message}`);
        return ctx.reply(
          '❌ *Import Failed*\n\n' +
          'The private key or mnemonic you provided is invalid.\n' +
          'Please check your input and try again.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Try Again', 'import_wallet')],
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      }
    }
  } catch (error) {
    logger.error(`Handle wallet text input error: ${error.message}`);
    return ctx.reply('❌ Sorry, there was an error processing your input.');
  }
};

module.exports = {
  importWalletHandler,
  handleWalletTextInput
}; 