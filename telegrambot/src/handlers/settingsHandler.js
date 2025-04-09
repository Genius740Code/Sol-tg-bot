const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { logger } = require('../database');
const { isRateLimited } = require('../../utils/wallet');
const { encrypt, decrypt } = require('../../utils/encryption');

// Fee constants
const FEE_TYPES = {
  FAST: { name: 'Fast', percentage: 1.5 },
  TURBO: { name: 'Turbo', percentage: 2.5 },
  CUSTOM: { name: 'Custom', percentage: 0.5 } // Lower fee but may take longer
};

// Show settings menu
const settingsHandler = async (ctx) => {
  try {
    // Check rate limit
    if (isRateLimited(ctx.from.id)) {
      return ctx.reply('Please wait a moment before trying again.');
    }

    await ctx.reply('⚙️ Settings Menu', 
      Markup.keyboard([
        ['🔧 Transaction Settings', '👛 Wallet Management'],
        ['🔔 Notifications', '📊 Trading Preferences'],
        ['⬅️ Back to Main Menu']
      ]).resize()
    );
  } catch (error) {
    logger.error(`Settings handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing settings. Please try again later.');
  }
};

// Transaction settings handler
const txSettingsHandler = async (ctx) => {
  try {
    // Get user's current settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }

    // Get current fee type (default to FAST if not set)
    const currentFeeType = user.feeType || 'FAST';
    
    await ctx.reply(
      `🔧 Transaction Settings\n\n` +
      `Current Fee Type: ${FEE_TYPES[currentFeeType].name} (${FEE_TYPES[currentFeeType].percentage}%)\n\n` +
      `Select a transaction fee type:`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Fast (1.5%)', 'fee_FAST'),
          Markup.button.callback('Turbo (2.5%)', 'fee_TURBO')
        ],
        [Markup.button.callback('Custom (0.5%)', 'fee_CUSTOM')],
        [Markup.button.callback('⬅️ Back to Settings', 'back_to_settings')]
      ])
    );
  } catch (error) {
    logger.error(`Transaction settings error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing transaction settings. Please try again later.');
  }
};

// Handle fee type selection
const feeTypeHandler = async (ctx) => {
  try {
    const feeType = ctx.match[0].split('_')[1]; // Extract fee type from callback
    
    if (!FEE_TYPES[feeType]) {
      return ctx.answerCbQuery('Invalid fee type selected');
    }

    // Update user's fee type preference
    await userService.updateUserSettings(ctx.from.id, { feeType });

    await ctx.answerCbQuery(`Fee type updated to ${FEE_TYPES[feeType].name}`);
    await ctx.editMessageText(
      `✅ Fee type updated to ${FEE_TYPES[feeType].name} (${FEE_TYPES[feeType].percentage}%)\n\n` +
      `Note: ${feeType === 'CUSTOM' ? 'Custom fee is lower but transactions may take longer to process.' : 
         feeType === 'TURBO' ? 'Turbo fee ensures fastest transaction processing but costs more.' : 
         'Fast fee provides a good balance between speed and cost.'}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Back to Transaction Settings', 'tx_settings')]
      ])
    );
  } catch (error) {
    logger.error(`Fee type update error: ${error.message}`);
    ctx.answerCbQuery('Failed to update fee type');
  }
};

// Wallet management handler
const walletManagementHandler = async (ctx) => {
  try {
    await ctx.reply(
      '👛 Wallet Management\n\n' +
      'You can manage your wallet keys and create new wallets here:',
      Markup.inlineKeyboard([
        [Markup.button.callback('🔑 Export Private Key', 'export_key')],
        [Markup.button.callback('📥 Import Wallet', 'import_wallet')],
        [Markup.button.callback('🆕 Create New Wallet', 'create_wallet')],
        [Markup.button.callback('✏️ Rename Wallet', 'rename_wallet')],
        [Markup.button.callback('⬅️ Back to Settings', 'back_to_settings')]
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
      '⚠️ SECURITY WARNING ⚠️\n\n' +
      'Your private key is extremely sensitive information.\n' +
      '• NEVER share it with anyone\n' +
      '• Save it securely\n' +
      '• Delete this message after saving the key\n\n' +
      'Are you sure you want to continue?',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Yes, show my key', 'confirm_export'),
          Markup.button.callback('No, cancel', 'wallet_management')
        ]
      ])
    );

    // Store private key temporarily in session state
    await userService.updateUserSettings(ctx.from.id, { 
      state: 'EXPORTING_KEY'
    });
  } catch (error) {
    logger.error(`Export key error: ${error.message}`);
    ctx.answerCbQuery('Failed to export private key');
  }
};

// Confirm export private key
const confirmExportHandler = async (ctx) => {
  try {
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user || !user.encryptedPrivateKey || user.state !== 'EXPORTING_KEY') {
      return ctx.answerCbQuery('No private key found or invalid operation');
    }

    // Decrypt private key
    const privateKey = decrypt(user.encryptedPrivateKey);

    // Send private key
    await ctx.reply(
      '🔑 Your Private Key (DELETE AFTER SAVING):\n\n' +
      `\`${privateKey}\`\n\n` +
      '⚠️ DELETE THIS MESSAGE after saving the key!',
      { parse_mode: 'Markdown' }
    );

    // Clear state
    await userService.updateUserSettings(ctx.from.id, { state: null });

    // Provide option to go back
    await ctx.reply(
      'Private key exported. For security, delete the message with your key after saving it.',
      Markup.inlineKeyboard([
        [Markup.button.callback('⬅️ Back to Wallet Management', 'wallet_management')]
      ])
    );
  } catch (error) {
    logger.error(`Confirm export error: ${error.message}`);
    ctx.answerCbQuery('Failed to export private key');
  }
};

// Import wallet handler - first step
const importWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Starting wallet import process');
    await ctx.reply(
      '📥 Import Wallet\n\n' +
      'Please enter your private key or seed phrase to import a wallet.\n\n' +
      '⚠️ WARNING: This will replace your current wallet.\n' +
      'Make sure you have backed up your current wallet before proceeding.\n\n' +
      'Type your private key or seed phrase, or click Cancel to abort:',
      Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'wallet_management')]
      ])
    );
    
    // Set user state to await private key
    await userService.updateUserSettings(ctx.from.id, { 
      state: 'AWAITING_PRIVATE_KEY' 
    });
  } catch (error) {
    logger.error(`Import wallet error: ${error.message}`);
    ctx.answerCbQuery('Failed to start wallet import');
  }
};

// Trading preferences handler
const tradingPreferencesHandler = async (ctx) => {
  try {
    // Get user's current settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }

    // Get current trade settings with defaults
    const autoSlippage = user.autoSlippage !== false; // Default to true
    const slippageValue = user.slippageValue || 1.0; // Default to 1.0%
    const mevProtection = user.settings?.tradingSettings?.mevProtection !== false; // Default to true
    const confirmTrades = user.settings?.tradingSettings?.confirmTrades !== false; // Default to true
    
    await ctx.reply(
      '📊 Trading Preferences\n\n' +
      `Slippage: ${autoSlippage ? 'Auto' : `${slippageValue}%`}\n` +
      `MEV Protection: ${mevProtection ? 'ON ✅' : 'OFF ❌'}\n` +
      `Confirm Trades: ${confirmTrades ? 'ON ✅' : 'OFF ❌'}\n\n` +
      'Adjust your trading preferences:',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('Auto Slippage: ' + (autoSlippage ? 'ON ✅' : 'OFF ❌'), 'toggle_auto_slippage')
        ],
        [
          Markup.button.callback('-0.5%', 'slippage_decrease'),
          Markup.button.callback(`${slippageValue}%`, 'show_slippage'),
          Markup.button.callback('+0.5%', 'slippage_increase')
        ],
        [
          Markup.button.callback('MEV Protection: ' + (mevProtection ? 'ON ✅' : 'OFF ❌'), 'toggle_mev_protection')
        ],
        [
          Markup.button.callback('Confirm Trades: ' + (confirmTrades ? 'ON ✅' : 'OFF ❌'), 'toggle_confirm_trades')
        ],
        [Markup.button.callback('⬅️ Back to Settings', 'back_to_settings')]
      ])
    );
  } catch (error) {
    logger.error(`Trading preferences error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing trading preferences. Please try again later.');
  }
};

// Toggle auto slippage
const toggleAutoSlippageHandler = async (ctx) => {
  try {
    // Get user's current settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.answerCbQuery('User not found');
    }

    // Toggle auto slippage
    const newAutoSlippage = !(user.autoSlippage === true);
    
    // Update user settings
    await userService.updateUserSettings(ctx.from.id, { 
      autoSlippage: newAutoSlippage 
    });

    await ctx.answerCbQuery(`Auto slippage ${newAutoSlippage ? 'enabled' : 'disabled'}`);
    
    // Refresh trading preferences view
    await tradingPreferencesHandler(ctx);
  } catch (error) {
    logger.error(`Toggle auto slippage error: ${error.message}`);
    ctx.answerCbQuery('Failed to update slippage settings');
  }
};

// Toggle MEV protection
const toggleMevProtectionHandler = async (ctx) => {
  try {
    // Get user's current settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.answerCbQuery('User not found');
    }

    // Get current value (default to true if not set)
    const currentValue = user.settings?.tradingSettings?.mevProtection !== false;
    
    // Update user settings
    const newSettings = {
      ...user.settings,
      tradingSettings: {
        ...user.settings?.tradingSettings,
        mevProtection: !currentValue
      }
    };
    
    await userService.updateSettings(ctx.from.id, newSettings);

    await ctx.answerCbQuery(`MEV Protection ${!currentValue ? 'enabled' : 'disabled'}`);
    
    // Refresh trading preferences view
    await tradingPreferencesHandler(ctx);
  } catch (error) {
    logger.error(`Toggle MEV protection error: ${error.message}`);
    ctx.answerCbQuery('Failed to update MEV protection setting');
  }
};

// Toggle confirm trades
const toggleConfirmTradesHandler = async (ctx) => {
  try {
    // Get user's current settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.answerCbQuery('User not found');
    }

    // Get current value (default to true if not set)
    const currentValue = user.settings?.tradingSettings?.confirmTrades !== false;
    
    // Update user settings
    const newSettings = {
      ...user.settings,
      tradingSettings: {
        ...user.settings?.tradingSettings,
        confirmTrades: !currentValue
      }
    };
    
    await userService.updateSettings(ctx.from.id, newSettings);

    await ctx.answerCbQuery(`Confirm Trades ${!currentValue ? 'enabled' : 'disabled'}`);
    
    // Refresh trading preferences view
    await tradingPreferencesHandler(ctx);
  } catch (error) {
    logger.error(`Toggle confirm trades error: ${error.message}`);
    ctx.answerCbQuery('Failed to update confirm trades setting');
  }
};

// Update slippage value
const updateSlippageHandler = async (ctx) => {
  try {
    // Get action (increase or decrease)
    const action = ctx.match[0].includes('increase') ? 'increase' : 'decrease';
    
    // Get user's current settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.answerCbQuery('User not found');
    }

    // Get current slippage value (default 1.0%)
    let slippageValue = user.slippageValue || 1.0;
    
    // Update slippage value
    if (action === 'increase') {
      slippageValue = Math.min(5.0, slippageValue + 0.5); // Max 5%
    } else {
      slippageValue = Math.max(0.1, slippageValue - 0.5); // Min 0.1%
    }
    
    // Round to 1 decimal place
    slippageValue = Math.round(slippageValue * 10) / 10;
    
    // Update user settings
    await userService.updateUserSettings(ctx.from.id, { 
      slippageValue, 
      autoSlippage: false // Also disable auto slippage
    });

    await ctx.answerCbQuery(`Slippage updated to ${slippageValue}%`);
    
    // Refresh trading preferences view
    await tradingPreferencesHandler(ctx);
  } catch (error) {
    logger.error(`Update slippage error: ${error.message}`);
    ctx.answerCbQuery('Failed to update slippage');
  }
};

// Handle text input for private key during wallet import
const textInputHandler = async (bot) => {
  // Register general message handler for private key input during wallet import
  bot.on('text', async (ctx) => {
    try {
      // Get user and check state
      const user = await userService.getUserByTelegramId(ctx.from.id);
      
      if (!user || user.state !== 'AWAITING_PRIVATE_KEY') {
        // Just ignore text input if user is not waiting for private key
        return;
      }
      
      // User is in the process of importing a wallet
      const privateKeyOrMnemonic = ctx.message.text.trim();
      
      if (privateKeyOrMnemonic.length < 20) {
        // Private keys and mnemonics are longer than this
        return ctx.reply(
          '❌ Invalid input.\n\n' +
          'Please enter a valid private key or mnemonic phrase.',
          Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'wallet_management')]
          ])
        );
      }
      
      try {
        // Delete the message with private key for security
        await ctx.deleteMessage(ctx.message.message_id).catch(() => {
          // Ignore deletion errors, bot might not have permission
        });
        
        // Show loading message
        const loadingMsg = await ctx.reply('⏳ Importing wallet...');
        
        // Try to import wallet
        const result = await userService.importWallet(ctx.from.id, privateKeyOrMnemonic);
        
        // Remove the loading message
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});
        
        // Reset user state
        await userService.updateUserSettings(ctx.from.id, { state: null });
        
        // Show success message with truncated wallet address
        await ctx.reply(
          '✅ Wallet imported successfully!\n\n' +
          `Your new wallet address: \`${result.publicKey}\`\n\n` +
          'Your wallet has been securely stored. You can now use it for transactions.',
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback('⬅️ Back to Wallet Management', 'wallet_management')]
              ]
            }
          }
        );
      } catch (error) {
        logger.error(`Wallet import error: ${error.message}`);
        await ctx.reply(
          `❌ Failed to import wallet: ${error.message}\n\n` +
          'Please check your private key or mnemonic and try again.',
          Markup.inlineKeyboard([
            [Markup.button.callback('Try Again', 'import_wallet')],
            [Markup.button.callback('Cancel', 'wallet_management')]
          ])
        );
      }
    } catch (error) {
      logger.error(`Text input handler error: ${error.message}`);
    }
  });
};

// Register settings handlers
const registerSettingsHandlers = (bot) => {
  // Main settings menu
  bot.hears('⚙️ Settings', settingsHandler);
  bot.command('settings', settingsHandler);
  
  // Settings sections
  bot.hears('🔧 Transaction Settings', txSettingsHandler);
  bot.hears('👛 Wallet Management', walletManagementHandler);
  bot.hears('📊 Trading Preferences', tradingPreferencesHandler);
  
  // Transaction settings
  bot.action('tx_settings', txSettingsHandler);
  bot.action(/fee_(FAST|TURBO|CUSTOM)/, feeTypeHandler);
  
  // Wallet management
  bot.action('wallet_management', walletManagementHandler);
  bot.action('export_key', exportKeyHandler);
  bot.action('confirm_export', confirmExportHandler);
  bot.action('import_wallet', importWalletHandler);
  bot.action('create_wallet', async (ctx) => {
    try {
      await ctx.answerCbQuery('Creating a new wallet...');
      // Generate new wallet
      const user = await userService.generateNewWallet(ctx.from.id);
      await ctx.reply(
        `✅ New wallet created successfully!\n\nAddress: ${user.walletAddress}`
      );
    } catch (error) {
      logger.error(`Create wallet error: ${error.message}`);
      await ctx.reply('Failed to create new wallet. Please try again later.');
    }
  });
  
  // Trading preferences
  bot.action('toggle_auto_slippage', toggleAutoSlippageHandler);
  bot.action('toggle_mev_protection', toggleMevProtectionHandler);
  bot.action('toggle_confirm_trades', toggleConfirmTradesHandler);
  bot.action(/slippage_(increase|decrease)/, updateSlippageHandler);
  
  // Back buttons
  bot.action('back_to_settings', settingsHandler);
  bot.hears('⬅️ Back to Main Menu', async (ctx) => {
    try {
      // Import startHandler to avoid circular dependencies
      const { startHandler } = require('./startHandler');
      return await startHandler(ctx);
    } catch (error) {
      logger.error(`Back to main menu error: ${error.message}`);
      return ctx.reply('Returning to main menu...');
    }
  });
  
  // Register text input handler for private keys
  textInputHandler(bot);
};

module.exports = {
  settingsHandler,
  registerSettingsHandlers
};