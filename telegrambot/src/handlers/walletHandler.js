const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { logger } = require('../database');
const { generateWallet, importWalletFromPrivateKey } = require('../../utils/wallet');
const { encrypt, decrypt } = require('../../utils/encryption');

// Wallet management handler
const walletManagementHandler = async (ctx) => {
  try {
    // Get user and their wallets
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    const wallets = user.wallets || [];
    const activeWallet = user.getActiveWallet();
    
    // Create wallet selection buttons
    let walletButtons = [];
    
    // Only show wallet switching if user has multiple wallets
    if (wallets.length > 1) {
      let walletRows = [];
      wallets.forEach(wallet => {
        // Don't show button for the already active wallet
        if (wallet.address !== activeWallet.address) {
          walletRows.push(Markup.button.callback(
            `Switch to ${wallet.name}`, 
            `switch_wallet_${wallet.address}`
          ));
        }
      });
      
      // Group wallet buttons in pairs
      for (let i = 0; i < walletRows.length; i += 2) {
        if (i + 1 < walletRows.length) {
          walletButtons.push([walletRows[i], walletRows[i + 1]]);
        } else {
          walletButtons.push([walletRows[i]]);
        }
      }
    }
    
    // Main wallet management buttons
    const managementButtons = [
      [Markup.button.callback('🔑 Export Private Key', 'export_key')],
      [Markup.button.callback('📥 Import Wallet', 'import_wallet')],
      [Markup.button.callback('🆕 Create New Wallet', 'create_new_wallet')],
      [Markup.button.callback('✏️ Rename Wallet', 'rename_wallet')],
      [Markup.button.callback('🔄 Change Wallet Address', 'change_wallet')]
    ];
    
    // Combine all buttons
    const allButtons = [
      ...walletButtons,
      ...managementButtons,
      [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
    ];
    
    await ctx.reply(
      '👛 *Wallet Management*\n\n' +
      `Current Wallet: *${activeWallet.name}*\n` +
      `Address: \`${activeWallet.address}\`\n\n` +
      `You have ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''}.\n\n` +
      'Choose an action:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(allButtons)
      }
    );
  } catch (error) {
    logger.error(`Wallet management error: ${error.message}`);
    return ctx.reply('Sorry, there was an error accessing wallet management. Please try again later.');
  }
};

// Export private key handler
const exportPrivateKeyHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Security warning
    await ctx.reply(
      '⚠️ *SECURITY WARNING* ⚠️\n\n' +
      'Your private key gives complete access to your wallet.\n' +
      '• Never share it with anyone\n' +
      '• Store it securely\n' +
      '• Delete this message after copying\n\n' +
      'Are you sure you want to export your private key?',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('Yes, show me the key', 'confirm_export_key'),
            Markup.button.callback('No, cancel', 'wallet_management')
          ]
        ])
      }
    );
  } catch (error) {
    logger.error(`Export private key error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Confirm export private key
const confirmExportKeyHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Get active wallet
    const activeWallet = user.getActiveWallet();
    
    // Decrypt private key from active wallet
    let privateKey;
    try {
      privateKey = decrypt(activeWallet.encryptedPrivateKey);
    } catch (error) {
      logger.error(`Error decrypting private key: ${error.message}`);
      return ctx.reply('Error decrypting your private key. Please contact support.');
    }
    
    // Send private key
    await ctx.reply(
      '🔑 *Your Private Key:*\n\n' +
      `\`${privateKey}\`\n\n` +
      '⚠️ DELETE THIS MESSAGE after saving your key!',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
        ])
      }
    );
    
    // Also show mnemonic if available
    if (activeWallet.mnemonic) {
      try {
        const mnemonic = decrypt(activeWallet.mnemonic);
        if (mnemonic) {
          await ctx.reply(
            '🔐 *Your Recovery Phrase:*\n\n' +
            `\`${mnemonic}\`\n\n` +
            '⚠️ DELETE THIS MESSAGE after saving your recovery phrase!',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
              ])
            }
          );
        }
      } catch (error) {
        logger.error(`Error decrypting mnemonic: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Confirm export key error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Import wallet handler
const importWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '📥 *Import Wallet*\n\n' +
      'Please paste your private key or seed phrase to import a wallet.\n\n' +
      '⚠️ This will replace your current wallet!\n' +
      'Make sure you have backed up your current wallet first.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Cancel', 'wallet_management')]
        ])
      }
    );
    
    // Update user state to import wallet
    await userService.updateUserSettings(ctx.from.id, { state: 'IMPORTING_WALLET' });
  } catch (error) {
    logger.error(`Import wallet error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Create new wallet handler
const createNewWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '🆕 *Create New Wallet*\n\n' +
      'This will generate a new wallet for you.\n\n' +
      '⚠️ Your current wallet will be replaced!\n' +
      'Make sure you have backed up your current wallet first.\n\n' +
      'Do you want to continue?',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('Yes, create new wallet', 'confirm_new_wallet'),
            Markup.button.callback('No, cancel', 'wallet_management')
          ]
        ])
      }
    );
  } catch (error) {
    logger.error(`Create new wallet error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
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
    
    // Generate new wallet
    const newWallet = await generateWallet();
    
    // Set all existing wallets to inactive
    if (user.wallets && user.wallets.length > 0) {
      user.wallets.forEach(wallet => {
        wallet.isActive = false;
      });
    }
    
    // Determine wallet name
    const walletNumber = (user.wallets ? user.wallets.length : 0) + 1;
    const walletName = `Wallet ${walletNumber}`;
    
    // Add new wallet to user's wallets array
    if (!user.wallets) {
      user.wallets = [];
    }
    
    user.wallets.push({
      name: walletName,
      address: newWallet.publicKey,
      encryptedPrivateKey: encrypt(newWallet.privateKey),
      mnemonic: encrypt(newWallet.mnemonic),
      isActive: true
    });
    
    // Also update main wallet fields for compatibility
    user.walletAddress = newWallet.publicKey;
    user.encryptedPrivateKey = encrypt(newWallet.privateKey);
    user.mnemonic = encrypt(newWallet.mnemonic);
    
    await user.save();
    
    // Confirm new wallet creation
    await ctx.reply(
      '✅ *New Wallet Created!*\n\n' +
      `Wallet Name: *${walletName}*\n` +
      `Address: \`${newWallet.publicKey}\`\n\n` +
      'Make sure to backup your private key!',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔑 Export Private Key', 'export_key')],
          [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Confirm new wallet error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Change wallet address handler
const changeWalletAddressHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '🔄 *Change Wallet Address*\n\n' +
      'Please paste the wallet address you want to use.\n\n' +
      '⚠️ You must have the private key for this address!\n' +
      'This only changes the displayed address for tracking.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Cancel', 'wallet_management')]
        ])
      }
    );
    
    // Update user state to change wallet address
    await userService.updateUserSettings(ctx.from.id, { state: 'CHANGING_WALLET_ADDRESS' });
  } catch (error) {
    logger.error(`Change wallet address error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Handle text input for wallet operations
const handleWalletTextInput = async (ctx) => {
  try {
    // Get user state
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    const userState = user.state;
    const stateData = user.stateData || {};
    
    // Reset state
    await userService.updateUserSettings(ctx.from.id, { 
      state: null,
      stateData: {}
    });
    
    if (userState === 'IMPORTING_WALLET') {
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
      
      // Import wallet
      const privateKeyOrMnemonic = ctx.message.text.trim();
      
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
          '✅ *Wallet Imported Successfully!*\n\n' +
          `Wallet Name: *${walletName}*\n` +
          `Address: \`${importedWallet.publicKey}\`\n\n` +
          'Your new wallet is now active.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      } catch (error) {
        logger.error(`Error importing wallet: ${error.message}`);
        return ctx.reply(
          '❌ Error importing wallet: Invalid private key or seed phrase.\n\n' +
          'Please try again or contact support.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      }
    } else if (userState === 'CHANGING_WALLET_ADDRESS') {
      // Change wallet address
      const walletAddress = ctx.message.text.trim();
      
      // Check if input is a valid Solana address format
      if (!walletAddress.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
        return ctx.reply(
          '❌ Invalid wallet address format. Please enter a valid Solana address.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      }
      
      // Check if wallet already exists
      const existingWallet = user.wallets.find(w => w.address === walletAddress);
      if (existingWallet) {
        // Just switch to it
        await userService.setActiveWallet(ctx.from.id, walletAddress);
        
        return ctx.reply(
          `✅ Switched to existing wallet: *${existingWallet.name}*\n\n` +
          `Address: \`${existingWallet.address}\``,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      }
      
      // Add new wallet
      user.wallets.forEach(w => {
        w.isActive = false;
      });
      
      const walletName = `Wallet ${user.wallets.length + 1}`;
      
      user.wallets.push({
        name: walletName,
        address: walletAddress,
        isActive: true
      });
      
      await user.save();
      
      return ctx.reply(
        '✅ *Wallet Address Added!*\n\n' +
        `Your new wallet address is:\n\`${walletAddress}\`\n\n` +
        'Your wallet has been updated for tracking.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    } else if (userState === 'RENAMING_WALLET') {
      // Rename wallet
      const newName = ctx.message.text.trim();
      const walletAddress = stateData.walletAddress;
      
      if (!walletAddress) {
        return ctx.reply(
          '❌ Error: No wallet selected for renaming.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      }
      
      // Find the wallet
      const wallet = user.wallets.find(w => w.address === walletAddress);
      
      if (!wallet) {
        return ctx.reply(
          '❌ Error: Wallet not found.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      }
      
      // Update wallet name
      wallet.name = newName;
      await user.save();
      
      return ctx.reply(
        '✅ *Wallet Renamed Successfully!*\n\n' +
        `Wallet is now named: *${newName}*\n` +
        `Address: \`${wallet.address}\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
  } catch (error) {
    logger.error(`Handle wallet text input error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Switch wallet handler
const switchWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Extract wallet address from callback data
    const walletAddress = ctx.match[1];
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Set the wallet as active
    await userService.setActiveWallet(ctx.from.id, walletAddress);
    
    // Find the wallet to get its name
    const wallet = user.wallets.find(w => w.address === walletAddress);
    
    // Confirm the switch
    await ctx.reply(
      `✅ Switched to wallet: *${wallet.name}*\n\n` +
      `Address: \`${wallet.address}\``,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Switch wallet error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Rename wallet handler
const renameWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user and their wallets
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    const wallets = user.wallets || [];
    
    // Create wallet selection buttons for renaming
    let walletRows = [];
    wallets.forEach(wallet => {
      walletRows.push(Markup.button.callback(
        `${wallet.name}`, 
        `rename_wallet_${wallet.address}`
      ));
    });
    
    // Group wallet buttons in pairs
    let walletButtons = [];
    for (let i = 0; i < walletRows.length; i += 2) {
      if (i + 1 < walletRows.length) {
        walletButtons.push([walletRows[i], walletRows[i + 1]]);
      } else {
        walletButtons.push([walletRows[i]]);
      }
    }
    
    // Add back button
    walletButtons.push([Markup.button.callback('🔙 Cancel', 'wallet_management')]);
    
    await ctx.reply(
      '✏️ *Rename Wallet*\n\n' +
      'Select the wallet you want to rename:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(walletButtons)
      }
    );
  } catch (error) {
    logger.error(`Rename wallet error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Prepare wallet rename
const prepareWalletRenameHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Extract wallet address from callback data
    const walletAddress = ctx.match[1];
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Find the wallet
    const wallet = user.wallets.find(w => w.address === walletAddress);
    
    if (!wallet) {
      return ctx.reply(
        '❌ Wallet not found.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
    
    // Update user state for renaming
    await userService.updateUserSettings(ctx.from.id, { 
      state: 'RENAMING_WALLET',
      stateData: { walletAddress }
    });
    
    await ctx.reply(
      `✏️ *Rename Wallet*\n\n` +
      `Current name: *${wallet.name}*\n` +
      `Address: \`${wallet.address}\`\n\n` +
      `Please enter a new name for this wallet:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Cancel', 'wallet_management')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Prepare wallet rename error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Register wallet handlers
const registerWalletHandlers = (bot) => {
  // Wallet management
  bot.action('wallet_management', walletManagementHandler);
  
  // Export private key
  bot.action('export_key', exportPrivateKeyHandler);
  bot.action('confirm_export_key', confirmExportKeyHandler);
  
  // Import wallet
  bot.action('import_wallet', importWalletHandler);
  
  // Create new wallet
  bot.action('create_new_wallet', createNewWalletHandler);
  bot.action('confirm_new_wallet', confirmNewWalletHandler);
  
  // Change wallet address
  bot.action('change_wallet', changeWalletAddressHandler);
  
  // Switch wallet
  bot.action(/switch_wallet_([1-9A-HJ-NP-Za-km-z]{32,44})/, switchWalletHandler);
  
  // Rename wallet
  bot.action('rename_wallet', renameWalletHandler);
  bot.action(/rename_wallet_([1-9A-HJ-NP-Za-km-z]{32,44})/, prepareWalletRenameHandler);
  
  // Handle wallet state text input
  bot.on('text', async (ctx, next) => {
    try {
      // Skip commands (messages starting with /)
      if (ctx.message.text.startsWith('/')) {
        return next();
      }
      
      // Get user
      const user = await userService.getUserByTelegramId(ctx.from.id);
      
      if (user && (
        user.state === 'IMPORTING_WALLET' || 
        user.state === 'CHANGING_WALLET_ADDRESS' ||
        user.state === 'RENAMING_WALLET'
      )) {
        return handleWalletTextInput(ctx);
      }
      
      // Not a wallet operation, pass to next handler
      return next();
    } catch (error) {
      logger.error(`Wallet text handler error: ${error.message}`);
      return next();
    }
  });
};

module.exports = {
  walletManagementHandler,
  registerWalletHandlers,
  handleWalletTextInput
}; 