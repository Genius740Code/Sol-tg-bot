const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { logger } = require('../database');
const { isRateLimited } = require('../../utils/wallet');
const { encrypt, decrypt } = require('../../utils/encryption');
const { walletSettingsHandler } = require('./wallet/walletSettingsHandler');

// Fee constants
const FEE_TYPES = {
  FAST: { name: 'Fast', percentage: 0.001 },
  TURBO: { name: 'Turbo', percentage: 0.005 },
  CUSTOM: { name: 'Custom', percentage: 0.001 } // Default custom value
};

// Show settings menu
const settingsHandler = async (ctx) => {
  try {
    // Check rate limit
    if (isRateLimited(ctx.from.id)) {
      return ctx.reply('Please wait a moment before trying again.');
    }

    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }

    // Get current fee type (default to FAST if not set)
    const currentFeeType = user.settings?.tradingSettings?.feeType || 'FAST';
    const feePercentage = FEE_TYPES[currentFeeType].percentage;

    await ctx.reply('⚙️ *Settings Menu*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(`🔧 Fee: ${currentFeeType.toLowerCase()} (${feePercentage})`, 'tx_settings')
          ],
          [
            Markup.button.callback('💰 Buy Settings', 'buy_settings'),
            Markup.button.callback('💸 Sell Settings', 'sell_settings')
          ],
          [
            Markup.button.callback('🛡️ MEV Protection', 'mev_protection')
          ],
          [
            Markup.button.callback('⚡ Presets', 'trading_presets'),
            Markup.button.callback('✅ Confirm Trades', 'confirm_trades')
          ],
          [
            Markup.button.callback('🔐 Account Security', 'account_security'),
            Markup.button.callback('💤 AFK Mode', 'afk_mode')
          ],
          [
            Markup.button.callback('🤖 Bot Clicks', 'bot_clicks')
          ],
          [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Settings handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing settings. Please try again later.');
  }
};

// Transaction settings handler
const txSettingsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user's current settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }

    // Get current fee type (default to FAST if not set)
    const currentFeeType = user.settings?.tradingSettings?.feeType || 'FAST';
    
    // Get current buy and sell tip values (default to 0.001)
    const buyTip = user.settings?.tradingSettings?.buyTip || 0.001;
    const sellTip = user.settings?.tradingSettings?.sellTip || 0.001;
    
    await ctx.reply(
      `🔧 *Fee Settings*\n\n` +
      `Current Fee Type: ${FEE_TYPES[currentFeeType].name} (${FEE_TYPES[currentFeeType].percentage})\n\n` +
      `Buy Tip: ${buyTip}\n` +
      `Sell Tip: ${sellTip}\n\n` +
      `Select a transaction fee type:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(`Fast (${FEE_TYPES.FAST.percentage})`, 'fee_FAST'),
            Markup.button.callback(`Turbo (${FEE_TYPES.TURBO.percentage})`, 'fee_TURBO')
          ],
          [Markup.button.callback(`Custom Fee`, 'fee_CUSTOM')],
          [
            Markup.button.callback(`Buy Tip: ${buyTip}`, 'set_buy_tip'),
            Markup.button.callback(`Sell Tip: ${sellTip}`, 'set_sell_tip')
          ],
          [Markup.button.callback('⬅️ Back to Settings', 'settings')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Transaction settings error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing transaction settings. Please try again later.');
  }
};

// Handle fee type selection
const feeTypeHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const feeType = ctx.match[0].split('_')[1]; // Extract fee type from callback
    
    if (!FEE_TYPES[feeType]) {
      return ctx.answerCbQuery('Invalid fee type selected');
    }
    
    // If custom fee, prompt for value
    if (feeType === 'CUSTOM') {
      // Set state to collect custom fee input
      await userService.updateUserSettings(ctx.from.id, { 
        state: 'CUSTOM_FEE_INPUT'
      });
      
      return ctx.reply(
        '💰 *Custom Fee Setting*\n\n' +
        'Please enter your desired fee value between 0 and 0.1:\n' +
        'Example: 0.002 (for 0.2%)',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Cancel', 'tx_settings')]
          ])
        }
      );
    }

    // Update user's fee type preference
    await userService.updateUserSettings(ctx.from.id, { 
      'settings.tradingSettings.feeType': feeType 
    });

    await ctx.editMessageText(
      `✅ Fee type updated to ${FEE_TYPES[feeType].name} (${FEE_TYPES[feeType].percentage})\n\n` +
      `Note: ${feeType === 'TURBO' ? 'Turbo fee ensures fastest transaction processing but costs more.' : 
         'Fast fee provides a good balance between speed and cost.'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Transaction Settings', 'tx_settings')]
        ])
      }
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

// Handle text input for settings that require it
const textInputHandler = async (bot) => {
  // Register general message handler for private key input during wallet import
  bot.on('text', async (ctx, next) => {
    try {
      // Skip commands (messages starting with /)
      if (ctx.message.text.startsWith('/')) {
        return next();
      }
      
      // Get user and check state
      const user = await userService.getUserByTelegramId(ctx.from.id);
      
      if (!user || user.state !== 'AWAITING_PRIVATE_KEY') {
        // Just pass to next handler if user is not waiting for private key
        return next();
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
      return next();
    }
  });
};

// Buy tip handler
const setBuyTipHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Set buy tip feature coming soon');
    
    // Just return to fee settings for now
    return txSettingsHandler(ctx);
  } catch (error) {
    logger.error(`Set buy tip error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Sell tip handler
const setSellTipHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Set sell tip feature coming soon');
    
    // Just return to fee settings for now
    return txSettingsHandler(ctx);
  } catch (error) {
    logger.error(`Set sell tip error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Buy settings handler
const buySettingsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Buy settings feature coming soon');
    
    // Just return to main settings for now
    return settingsHandler(ctx);
  } catch (error) {
    logger.error(`Buy settings error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Sell settings handler
const sellSettingsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Sell settings feature coming soon');
    
    // Just return to main settings for now
    return settingsHandler(ctx);
  } catch (error) {
    logger.error(`Sell settings error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// MEV protection handler
const mevProtectionHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('MEV protection feature coming soon');
    
    // Just return to main settings for now
    return settingsHandler(ctx);
  } catch (error) {
    logger.error(`MEV protection error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Trading presets handler
const tradingPresetsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Trading presets feature coming soon');
    
    // Just return to main settings for now
    return settingsHandler(ctx);
  } catch (error) {
    logger.error(`Trading presets error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Confirm trades handler
const confirmTradesHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Confirm trades settings coming soon');
    
    // Just return to main settings for now
    return settingsHandler(ctx);
  } catch (error) {
    logger.error(`Confirm trades error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Account security handler
const accountSecurityHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Account security settings coming soon');
    
    // Just return to main settings for now
    return settingsHandler(ctx);
  } catch (error) {
    logger.error(`Account security error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// AFK mode handler
const afkModeHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('AFK mode coming soon');
    
    // Just return to main settings for now
    return settingsHandler(ctx);
  } catch (error) {
    logger.error(`AFK mode error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Bot clicks handler
const botClicksHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Bot clicks settings coming soon');
    
    // Just return to main settings for now
    return settingsHandler(ctx);
  } catch (error) {
    logger.error(`Bot clicks error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Create wallet handler
const createWalletHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Creating a new wallet...');
    
    // Generate new wallet through the userService
    const user = await userService.generateNewWallet(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Failed to create wallet. Please try again later.');
    }
    
    // Get the active wallet
    const activeWallet = user.getActiveWallet();
    
    await ctx.reply(
      '✅ *New Wallet Created*\n\n' +
      `Name: ${activeWallet.name}\n` +
      `Address: \`${activeWallet.address}\`\n\n` +
      'Your new wallet is now active.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔑 Export Private Key', 'export_key')],
          [Markup.button.callback('⬅️ Back to Settings', 'settings')]
        ])
      }
    );
  } catch (error) {
    logger.error(`Create wallet error: ${error.message}`);
    await ctx.reply('Failed to create new wallet. Please try again later.');
  }
};

// Register settings handlers
const registerSettingsHandlers = (bot) => {
  // Main settings menu
  bot.hears('⚙️ Settings', settingsHandler);
  bot.command('settings', settingsHandler);
  bot.action('settings', settingsHandler);
  
  // Transaction fee settings
  bot.action('tx_settings', txSettingsHandler);
  bot.action(/fee_(FAST|TURBO|CUSTOM)/, feeTypeHandler);
  bot.action('set_buy_tip', setBuyTipHandler);
  bot.action('set_sell_tip', setSellTipHandler);
  
  // Buy/Sell settings
  bot.action('buy_settings', buySettingsHandler);
  bot.action('sell_settings', sellSettingsHandler);
  
  // MEV and process settings
  bot.action('mev_protection', mevProtectionHandler);
  
  // Other settings
  bot.action('trading_presets', tradingPresetsHandler);
  bot.action('confirm_trades', confirmTradesHandler);
  bot.action('afk_mode', afkModeHandler);
  bot.action('bot_clicks', botClicksHandler);
  
  // Wallet integration - link to wallet management
  bot.action('account_security', async (ctx) => {
    await ctx.answerCbQuery();
    // Redirect to wallet management using the handler from walletHandler.js
    const { walletManagementHandler } = require('./walletHandler');
    return walletManagementHandler(ctx);
  });
  
  // Back buttons
  bot.action('back_to_settings', settingsHandler);
  
  // Add the text handler for settings that require text input
  bot.on('text', async (ctx, next) => {
    try {
      const user = await userService.getUserByTelegramId(ctx.from.id);
      
      if (!user || !user.state) {
        return next();
      }
      
      // Handle text input based on user state
      if (user.state === 'IMPORTING_WALLET') {
        // This will be handled by the walletHandler
        return next();
      } else if (user.state === 'CUSTOM_FEE_INPUT') {
        // Handle custom fee input
        const feeInput = parseFloat(ctx.message.text.trim());
        
        if (isNaN(feeInput) || feeInput < 0 || feeInput > 0.1) {
          await ctx.reply('Invalid fee value. Please enter a number between 0 and 0.1');
          return;
        }
        
        // Update the custom fee value
        await userService.updateUserSettings(ctx.from.id, {
          'settings.tradingSettings.feeType': 'CUSTOM',
          'settings.tradingSettings.customFeeValue': feeInput,
          state: null
        });
        
        await ctx.reply(`✅ Custom fee set to ${feeInput}`);
        return txSettingsHandler(ctx);
      }
      
      return next();
    } catch (error) {
      logger.error(`Settings text input error: ${error.message}`);
      return next();
    }
  });
};

module.exports = {
  settingsHandler,
  registerSettingsHandlers,
  txSettingsHandler,
  feeTypeHandler,
  walletManagementHandler,
  importWalletHandler,
  exportKeyHandler,
  confirmExportHandler,
  // New exports
  setBuyTipHandler,
  setSellTipHandler,
  buySettingsHandler,
  sellSettingsHandler,
  mevProtectionHandler,
  tradingPresetsHandler,
  confirmTradesHandler,
  accountSecurityHandler,
  afkModeHandler,
  botClicksHandler,
  createWalletHandler
};