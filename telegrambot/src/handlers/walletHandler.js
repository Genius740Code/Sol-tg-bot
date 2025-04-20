const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { logger } = require('../database');
const { generateWallet, importWalletFromPrivateKey, getSolBalance, getSolPrice } = require('../../utils/wallet');
const { encrypt, decrypt } = require('../../utils/encryption');
const { updateOrSendMessage } = require('../../utils/messageUtils');

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
    
    // Fetch SOL balances and prices
    const solPrice = await getSolPrice();
    
    // Get balances for all wallets
    const walletsWithBalances = await Promise.all(wallets.map(async (wallet) => {
      const balance = await getSolBalance(wallet.address);
      const valueUsd = balance * solPrice;
      return {
        ...wallet.toObject(),
        balance,
        valueUsd
      };
    }));
    
    // Create wallet display message
    let message = `💳 *Your Solana Wallets:*\n\n`;
    
    // List all wallets with balances
    walletsWithBalances.forEach(wallet => {
      // Mark active wallet as default
      const isDefault = wallet.isActive ? ' (Default)' : '';
      const balanceText = `${wallet.balance.toFixed(6)} SOL ($${wallet.valueUsd.toFixed(2)} USD)`;
      
      // Add a distinguishing arrow for the default wallet
      const defaultArrow = wallet.isActive ? '→ ' : '• ';
      
      message += `${defaultArrow}${wallet.name}${isDefault} - ${balanceText}\n`;
      message += `${wallet.address}\n\n`;
    });
    
    message += `🔒 Tip: Keep your wallets secure by setting a Security Pin.`;
    
    // Create wallet buttons
    const buttons = [];
    
    // Add default wallet buttons if user has multiple wallets
    if (wallets.length > 1) {
      buttons.push([
        Markup.button.callback('🔄 Change Default Wallet', 'switch_wallet')
      ]);
    }
    
    // Wallet management buttons
    buttons.push([
      Markup.button.callback('🔄 Refresh', 'refresh_wallets'),
      Markup.button.callback('🗑️ Delete Wallet', 'delete_wallet')
    ]);
    
    buttons.push([
      Markup.button.callback('📤 Withdraw', 'withdraw_sol'), 
      Markup.button.callback('🔐 Security Pin', 'set_security_pin')
    ]);
    
    buttons.push([
      Markup.button.callback('⚙️ Wallet Settings', 'wallet_settings'),
      Markup.button.callback('🔙 Back to Menu', 'refresh_data')
    ]);
    
    // Use updateOrSendMessage instead of ctx.reply
    return updateOrSendMessage(ctx, message, Markup.inlineKeyboard(buttons));
  } catch (error) {
    logger.error(`Wallet management error: ${error.message}`);
    return ctx.reply('Sorry, there was an error accessing wallet management. Please try again later.');
  }
};

// Add refresh wallets handler
const refreshWalletsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Refreshing wallet information...');
    return walletManagementHandler(ctx);
  } catch (error) {
    logger.error(`Refresh wallets error: ${error.message}`);
    return ctx.reply('Sorry, there was an error refreshing wallet information. Please try again later.');
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
    
    // Send private key with a notice about auto-deletion after 5 minutes
    const keyMessage = await ctx.reply(
      '🔑 *Your Private Key:*\n\n' +
      `\`${privateKey}\`\n\n` +
      '⚠️ This message will automatically delete in 5 minutes for security\n' +
      '⏱️ Time remaining: 5:00',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
        ])
      }
    );
    
    // Also show mnemonic if available
    let mnemonicMessage = null;
    let mnemonic = null;
    if (activeWallet.mnemonic) {
      try {
        mnemonic = decrypt(activeWallet.mnemonic);
        if (mnemonic) {
          mnemonicMessage = await ctx.reply(
            '🔐 *Your Recovery Phrase:*\n\n' +
            `\`${mnemonic}\`\n\n` +
            '⚠️ This message will automatically delete in 5 minutes for security\n' +
            '⏱️ Time remaining: 5:00',
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
    
    // Schedule immediate deletion after 5 minutes (300,000 ms)
    setTimeout(async () => {
      try {
        // Delete the key message
        await ctx.deleteMessage(keyMessage.message_id);
        
        // Delete the mnemonic message if it exists
        if (mnemonicMessage) {
          await ctx.deleteMessage(mnemonicMessage.message_id);
        }
        
        // Notify user that messages were deleted
        await ctx.reply(
          '🔒 Your private key and recovery phrase messages have been automatically deleted for security.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      } catch (error) {
        logger.error(`Error deleting key messages: ${error.message}`);
      }
    }, 300000); // 5 minutes = 300,000 ms
    
    // Set update intervals for countdown (every minute)
    const intervals = [4, 3, 2, 1]; // Minutes remaining
    intervals.forEach(minute => {
      setTimeout(async () => {
        try {
          // Update key message
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            keyMessage.message_id,
            null,
            '🔑 *Your Private Key:*\n\n' +
            `\`${privateKey}\`\n\n` +
            '⚠️ This message will automatically delete for security\n' +
            `⏱️ Time remaining: ${minute}:00`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
              ])
            }
          );
          
          // Update mnemonic message if it exists
          if (mnemonicMessage && mnemonic) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              mnemonicMessage.message_id,
              null,
              '🔐 *Your Recovery Phrase:*\n\n' +
              `\`${mnemonic}\`\n\n` +
              '⚠️ This message will automatically delete for security\n' +
              `⏱️ Time remaining: ${minute}:00`,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
                ])
              }
            );
          }
        } catch (error) {
          logger.error(`Error updating countdown: ${error.message}`);
        }
      }, (5 - minute) * 60000); // Calculate when to run each update
    });
    
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
      
      // Validate the new name (4-15 alphanumeric characters, no spaces)
      if (!newName.match(/^[a-zA-Z0-9]{4,15}$/)) {
        return ctx.reply(
          '❌ Invalid wallet name format.\n\n' +
          'Wallet names must be 4-15 alphanumeric characters (no spaces or special characters).\n' +
          'Please try again:',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Cancel Renaming', 'wallet_management')]
            ])
          }
        );
      }
      
      try {
        // Update the wallet name
        const updatedUser = await userService.updateWalletName(ctx.from.id, walletAddress, newName);
        
        if (!updatedUser) {
          throw new Error('Failed to update wallet name');
        }
        
        return ctx.reply(
          '✅ *Wallet Renamed Successfully!*\n\n' +
          `Your wallet has been renamed to: *${newName}*`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      } catch (error) {
        logger.error(`Error updating wallet name: ${error.message}`);
        return ctx.reply(
          '❌ Error updating wallet name. Please try again later.',
          {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
            ])
          }
        );
      }
    }
  } catch (error) {
    logger.error(`Handle wallet text input error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Switch wallet selection handler
const switchWalletSelectionHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user and their wallets
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    const wallets = user.wallets || [];
    const activeWallet = user.getActiveWallet();
    
    if (wallets.length <= 1) {
      return ctx.reply(
        '❌ You only have one wallet. Create additional wallets first.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🆕 Create New Wallet', 'create_new_wallet')],
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
    
    // Create buttons for each wallet
    const walletButtons = wallets.map(wallet => {
      // Don't show the active wallet in the list
      if (wallet.address === activeWallet.address) {
        return null;
      }
      
      return [Markup.button.callback(
        `Set ${wallet.name} as Default`,
        `switch_to_wallet_${wallet._id}`
      )];
    }).filter(button => button !== null);
    
    // Add back button
    walletButtons.push([Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]);
    
    await ctx.reply(
      '↔️ *Change Default Wallet*\n\n' +
      `Current default wallet: *${activeWallet.name}*\n` +
      `Address: \`${activeWallet.address}\`\n\n` +
      'Select a wallet to set as default:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(walletButtons)
      }
    );
  } catch (error) {
    logger.error(`Switch wallet selection error: ${error.message}`);
    return ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Switch to wallet handler
const switchToWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Extract wallet ID from callback data using regex match
    const walletId = ctx.match[0].split('switch_to_wallet_')[1];
    
    if (!walletId) {
      return ctx.reply('Invalid wallet selection');
    }
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Find the wallet in user's wallets
    const wallet = user.wallets.id(walletId);
    if (!wallet) {
      return ctx.reply(
        '❌ Wallet not found. Please try again.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
    
    // Set all wallets to inactive
    user.wallets.forEach(w => {
      w.isActive = false;
    });
    
    // Set the selected wallet to active
    wallet.isActive = true;
    
    // Update legacy fields for backward compatibility
    user.walletAddress = wallet.address;
    user.encryptedPrivateKey = wallet.encryptedPrivateKey;
    user.mnemonic = wallet.mnemonic;
    
    await user.save();
    
    await ctx.reply(
      `✅ Default wallet changed to *${wallet.name}*\n\n` +
      `Address: \`${wallet.address}\`\n\n` +
      `This wallet will now be used for all transactions.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
        ])
      }
    );
    
  } catch (error) {
    logger.error(`Switch to wallet error: ${error.message}`);
    return ctx.reply('Sorry, there was an error switching wallets. Please try again later.');
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
        '❌ Wallet not found. Please try selecting a wallet again.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
    
    logger.info(`Found wallet to rename: ${wallet.name} (${wallet.address})`);
    
    // Update user state for renaming
    await userService.updateUserSettings(ctx.from.id, { 
      state: 'RENAMING_WALLET',
      stateData: { walletAddress }
    });
    
    await ctx.reply(
      `✏️ *Rename Wallet*\n\n` +
      `Current name: *${wallet.name}*\n` +
      `Address: \`${wallet.address}\`\n\n` +
      `Please enter a new name for this wallet (4-15 alphanumeric characters, no spaces or special characters):`,
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

// Delete wallet handler
const deleteWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    const wallets = user.wallets || [];
    
    // Can't delete if only one wallet
    if (wallets.length <= 1) {
      return ctx.reply(
        '❌ You cannot delete your only wallet.\n\n' +
        'Create additional wallets first before deleting this one.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
    
    // Create buttons for each wallet
    const walletButtons = wallets.map(wallet => {
      return [Markup.button.callback(
        `${wallet.name} - ${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length - 4)}`,
        `confirm_delete_wallet_${wallet._id}`
      )];
    });
    
    // Add back button
    walletButtons.push([Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]);
    
    await ctx.reply(
      '🗑️ *Delete Wallet*\n\n' +
      '⚠️ WARNING: This action cannot be undone!\n\n' +
      'Make sure you have exported or backed up your private key\n' +
      'before deleting a wallet.\n\n' +
      'Select a wallet to delete:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(walletButtons)
      }
    );
  } catch (error) {
    logger.error(`Delete wallet error: ${error.message}`);
    return ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Confirm delete wallet handler
const confirmDeleteWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Extract wallet ID from callback data
    const walletId = ctx.match[0].split('_').slice(3).join('_');
    
    if (!walletId) {
      return ctx.reply('Invalid wallet selection');
    }
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Find the wallet by ID
    const wallet = user.wallets.id(walletId);
    
    if (!wallet) {
      return ctx.reply('Wallet not found');
    }
    
    // Can't delete active wallet if it's the only one
    if (wallet.isActive && user.wallets.length <= 1) {
      return ctx.reply(
        '❌ You cannot delete your only active wallet.\n\n' +
        'Create and activate another wallet first.',
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
          ])
        }
      );
    }
    
    // If deleting active wallet, activate another one
    if (wallet.isActive) {
      // Find another wallet to set as active
      const otherWallet = user.wallets.find(w => w._id.toString() !== walletId);
      if (otherWallet) {
        otherWallet.isActive = true;
      }
    }
    
    // Remove the wallet
    user.wallets.pull(walletId);
    
    // Save changes
    await user.save();
    
    await ctx.reply(
      '✅ *Wallet Deleted Successfully*\n\n' +
      `The wallet "${wallet.name}" has been deleted.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Confirm delete wallet error: ${error.message}`);
    return ctx.reply('Sorry, there was an error deleting the wallet. Please try again later.');
  }
};

// Withdraw SOL handler
const withdrawSolHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '📤 *Withdraw SOL*\n\n' +
      'Please enter the destination wallet address and amount in SOL\n' +
      'in the following format:\n\n' +
      '`address amount`\n\n' +
      'Example: `7VH2NuKuwdfpgFt7uyWSUgkQT4KnXhVMJaXd2YTsLcH 0.5`',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Cancel', 'wallet_management')]
        ])
      }
    );
    
    // Set user state for handling input
    await userService.updateUserSettings(ctx.from.id, { state: 'WITHDRAWING_SOL' });
  } catch (error) {
    logger.error(`Withdraw SOL error: ${error.message}`);
    return ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Security PIN handler
const securityPinHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    await ctx.reply(
      '🔐 *Security PIN*\n\n' +
      'Setting a security PIN adds an extra layer of protection\n' +
      'for your wallet operations.\n\n' +
      'Please enter a 4-6 digit PIN code:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Cancel', 'wallet_management')]
        ])
      }
    );
    
    // Set user state for handling input
    await userService.updateUserSettings(ctx.from.id, { state: 'SETTING_SECURITY_PIN' });
  } catch (error) {
    logger.error(`Security PIN error: ${error.message}`);
    return ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Register wallet handlers
const registerWalletHandlers = (bot) => {
  // Wallet management
  bot.action('wallet_management', walletManagementHandler);
  
  // Refresh wallets
  bot.action('refresh_wallets', refreshWalletsHandler);
  
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
  
  // Wallet switching
  bot.action('switch_wallet', switchWalletSelectionHandler);
  bot.action(/switch_to_wallet_.*/, switchToWalletHandler);
  
  // Rename wallet
  bot.action('rename_wallet', renameWalletHandler);
  bot.action(/rename_wallet_([1-9A-HJ-NP-Za-km-z]{32,44})/, prepareWalletRenameHandler);
  
  // Delete wallet
  bot.action('delete_wallet', deleteWalletHandler);
  bot.action(/confirm_delete_wallet_.*/, confirmDeleteWalletHandler);
  
  // Withdraw SOL
  bot.action('withdraw_sol', withdrawSolHandler);
  
  // Security PIN
  bot.action('set_security_pin', securityPinHandler);
  
  // Wallet settings
  bot.action('wallet_settings', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.reply(
      '⚙️ *Wallet Settings*\n\n' +
      'Advanced wallet management options:',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔑 Export Private Key', 'export_key')],
          [Markup.button.callback('📥 Import Wallet', 'import_wallet')],
          [Markup.button.callback('🆕 Create New Wallet', 'create_new_wallet')],
          [Markup.button.callback('✏️ Rename Wallet', 'rename_wallet')],
          [Markup.button.callback('🔙 Back to Wallet Management', 'wallet_management')]
        ])
      }
    );
  });
  
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
  exportPrivateKeyHandler,
  confirmExportKeyHandler,
  importWalletHandler,
  createNewWalletHandler,
  confirmNewWalletHandler,
  changeWalletAddressHandler,
  switchWalletSelectionHandler,
  switchToWalletHandler,
  renameWalletHandler,
  prepareWalletRenameHandler,
  withdrawSolHandler,
  refreshWalletsHandler,
  registerWalletHandlers,
  deleteWalletHandler,
  confirmDeleteWalletHandler,
  securityPinHandler,
  handleWalletTextInput
}; 