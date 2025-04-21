const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { logger } = require('../database');
const { isRateLimited } = require('../../utils/wallet');
const { encrypt, decrypt } = require('../../utils/encryption');
const { walletSettingsHandler } = require('./wallet/walletSettingsHandler');
const { updateOrSendMessage } = require('../../utils/messageUtils');

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

    await updateOrSendMessage(ctx, 
      '⚙️ *Settings Menu*',
      Markup.inlineKeyboard([
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
    
    await updateOrSendMessage(
      ctx,
      `🔧 *Fee Settings*\n\n` +
      `Current Fee Type: ${FEE_TYPES[currentFeeType].name} (${FEE_TYPES[currentFeeType].percentage})\n\n` +
      `Buy Tip: ${buyTip}\n` +
      `Sell Tip: ${sellTip}\n\n` +
      `Select a transaction fee type:`,
      Markup.inlineKeyboard([
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
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Get current buy settings or set defaults
    const buySettings = user.settings?.tradingSettings?.buySettings || {
      defaultAmount: 0.5,
      customAmounts: [0.5, 1, 2, 5, 10],
      autoSell: false,
      takeProfit: null,
      stopLoss: null
    };
    
    // Create keyboard with buy amount options
    const buyAmountButtons = [];
    const amounts = buySettings.customAmounts || [0.5, 1, 2, 5, 10];
    
    // Split amounts into pairs for the keyboard
    for (let i = 0; i < amounts.length; i += 2) {
      const row = [];
      
      // First button in the row
      const amount1 = amounts[i];
      const isDefault1 = amount1 === buySettings.defaultAmount;
      row.push(Markup.button.callback(
        `${isDefault1 ? '✅ ' : ''}${amount1} SOL`, 
        `buy_amount_${amount1}`
      ));
      
      // Second button if exists
      if (i + 1 < amounts.length) {
        const amount2 = amounts[i + 1];
        const isDefault2 = amount2 === buySettings.defaultAmount;
        row.push(Markup.button.callback(
          `${isDefault2 ? '✅ ' : ''}${amount2} SOL`, 
          `buy_amount_${amount2}`
        ));
      }
      
      buyAmountButtons.push(row);
    }
    
    // Add custom amount option
    buyAmountButtons.push([
      Markup.button.callback('➕ Custom Amount', 'buy_amount_custom')
    ]);
    
    // Add auto sell toggle button
    const autoSellStatus = buySettings.autoSell ? '🟢 ON' : '🔴 OFF';
    buyAmountButtons.push([
      Markup.button.callback(`Auto Sell: ${autoSellStatus}`, 'toggle_auto_sell')
    ]);
    
    // Add TP/SL buttons if auto sell is enabled
    if (buySettings.autoSell) {
      buyAmountButtons.push([
        Markup.button.callback(`TP: ${buySettings.takeProfit ? buySettings.takeProfit + '%' : 'Not Set'}`, 'set_buy_tp'),
        Markup.button.callback(`SL: ${buySettings.stopLoss ? buySettings.stopLoss + '%' : 'Not Set'}`, 'set_buy_sl')
      ]);
    }
    
    // Add back button
    buyAmountButtons.push([
      Markup.button.callback('🔄 Refresh', 'buy_settings'),
      Markup.button.callback('🔙 Back', 'settings')
    ]);
    
    const buySettingsKeyboard = Markup.inlineKeyboard(buyAmountButtons);
    
    // Create message text
    let message = '💰 *Buy Settings*\n\n';
    message += `Default Buy Amount: ${buySettings.defaultAmount} SOL\n\n`;
    message += 'Select an amount to set as default for all buys. ✅ indicates your current default.\n\n';
    
    if (buySettings.autoSell) {
      message += '🔄 *Auto Sell:* Enabled\n';
      
      if (buySettings.takeProfit) {
        message += `📈 Take Profit: ${buySettings.takeProfit}%\n`;
      }
      
      if (buySettings.stopLoss) {
        message += `📉 Stop Loss: ${buySettings.stopLoss}%\n`;
      }
    } else {
      message += '🔄 *Auto Sell:* Disabled\n';
    }
    
    await updateOrSendMessage(ctx, message, buySettingsKeyboard);
  } catch (error) {
    logger.error(`Buy settings handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing buy settings. Please try again later.');
  }
};

// Sell settings handler
const sellSettingsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Get current sell settings or set defaults
    const sellSettings = user.settings?.tradingSettings?.sellSettings || {
      defaultPercentage: 100,
      percentageOptions: [25, 50, 100],
      takeProfit: null,
      stopLoss: null,
      devSell: false
    };
    
    // Create keyboard with sell percentage options
    const sellPctButtons = [];
    const percentages = sellSettings.percentageOptions || [25, 50, 100];
    
    // Create a row for percentage options
    const percentageRow = percentages.map(pct => {
      const isDefault = pct === sellSettings.defaultPercentage;
      return Markup.button.callback(
        `${isDefault ? '✅ ' : ''}${pct}%`, 
        `sell_pct_${pct}`
      );
    });
    
    sellPctButtons.push(percentageRow);
    
    // Add custom percentage option
    sellPctButtons.push([
      Markup.button.callback('➕ Custom Percentage', 'sell_pct_custom')
    ]);
    
    // Add DEV sell toggle
    const devSellStatus = sellSettings.devSell ? '🟢 ON' : '🔴 OFF';
    sellPctButtons.push([
      Markup.button.callback(`DEV Sell: ${devSellStatus}`, 'toggle_dev_sell')
    ]);
    
    // Add TP/SL buttons
    sellPctButtons.push([
      Markup.button.callback(`TP: ${sellSettings.takeProfit ? sellSettings.takeProfit + '%' : 'Not Set'}`, 'set_sell_tp'),
      Markup.button.callback(`SL: ${sellSettings.stopLoss ? sellSettings.stopLoss + '%' : 'Not Set'}`, 'set_sell_sl')
    ]);
    
    // Add back button
    sellPctButtons.push([
      Markup.button.callback('🔄 Refresh', 'sell_settings'),
      Markup.button.callback('🔙 Back', 'settings')
    ]);
    
    const sellSettingsKeyboard = Markup.inlineKeyboard(sellPctButtons);
    
    // Create message text
    let message = '💸 *Sell Settings*\n\n';
    message += `Default Sell Percentage: ${sellSettings.defaultPercentage}%\n\n`;
    message += 'Select a percentage to set as default for all sells. ✅ indicates your current default.\n\n';
    
    message += `👨‍💻 DEV Sell: ${sellSettings.devSell ? '🟢 Enabled' : '🔴 Disabled'}\n`;
    
    if (sellSettings.takeProfit) {
      message += `📈 Take Profit: ${sellSettings.takeProfit}%\n`;
    }
    
    if (sellSettings.stopLoss) {
      message += `📉 Stop Loss: ${sellSettings.stopLoss}%\n`;
    }
    
    await updateOrSendMessage(ctx, message, sellSettingsKeyboard);
  } catch (error) {
    logger.error(`Sell settings handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing sell settings. Please try again later.');
  }
};

// Set buy amount handler
const setBuyAmountHandler = async (ctx, amount) => {
  try {
    await ctx.answerCbQuery(`Setting default buy amount to ${amount} SOL`);
    
    // Update user's buy settings
    await userService.updateUserSettings(ctx.from.id, {
      'settings.tradingSettings.buySettings.defaultAmount': parseFloat(amount)
    });
    
    // Refresh the buy settings page
    return buySettingsHandler(ctx);
  } catch (error) {
    logger.error(`Set buy amount error: ${error.message}`);
    ctx.reply('Sorry, there was an error updating your buy settings. Please try again later.');
  }
};

// Set sell percentage handler
const setSellPercentageHandler = async (ctx, percentage) => {
  try {
    await ctx.answerCbQuery(`Setting default sell percentage to ${percentage}%`);
    
    // Update user's sell settings
    await userService.updateUserSettings(ctx.from.id, {
      'settings.tradingSettings.sellSettings.defaultPercentage': parseInt(percentage)
    });
    
    // Refresh the sell settings page
    return sellSettingsHandler(ctx);
  } catch (error) {
    logger.error(`Set sell percentage error: ${error.message}`);
    ctx.reply('Sorry, there was an error updating your sell settings. Please try again later.');
  }
};

// Toggle auto sell
const toggleAutoSellHandler = async (ctx) => {
  try {
    // Get current user settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    const currentSetting = user.settings?.tradingSettings?.buySettings?.autoSell || false;
    
    // Toggle the setting
    await userService.updateUserSettings(ctx.from.id, {
      'settings.tradingSettings.buySettings.autoSell': !currentSetting
    });
    
    await ctx.answerCbQuery(`Auto sell ${!currentSetting ? 'enabled' : 'disabled'}`);
    
    // Refresh the buy settings page
    return buySettingsHandler(ctx);
  } catch (error) {
    logger.error(`Toggle auto sell error: ${error.message}`);
    ctx.reply('Sorry, there was an error updating your settings. Please try again later.');
  }
};

// Toggle DEV sell
const toggleDevSellHandler = async (ctx) => {
  try {
    // Get current user settings
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    const currentSetting = user.settings?.tradingSettings?.sellSettings?.devSell || false;
    
    // Toggle the setting
    await userService.updateUserSettings(ctx.from.id, {
      'settings.tradingSettings.sellSettings.devSell': !currentSetting
    });
    
    await ctx.answerCbQuery(`DEV sell ${!currentSetting ? 'enabled' : 'disabled'}`);
    
    // Refresh the sell settings page
    return sellSettingsHandler(ctx);
  } catch (error) {
    logger.error(`Toggle DEV sell error: ${error.message}`);
    ctx.reply('Sorry, there was an error updating your settings. Please try again later.');
  }
};

// Set take profit for buy
const setBuyTakeProfitHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Set user state for input
    await userService.updateUserState(ctx.from.id, {
      state: 'SETTING_BUY_TP',
      stateData: null
    });
    
    await ctx.reply(
      '📈 *Set Take Profit*\n\n' +
      'Enter the percentage increase at which you want to automatically sell for profit.\n\n' +
      'For example, enter `20` to sell when the price increases by 20%.\n\n' +
      'Send 0 to disable Take Profit.',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error(`Set buy take profit error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Set stop loss for buy
const setBuyStopLossHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Set user state for input
    await userService.updateUserState(ctx.from.id, {
      state: 'SETTING_BUY_SL',
      stateData: null
    });
    
    await ctx.reply(
      '📉 *Set Stop Loss*\n\n' +
      'Enter the percentage decrease at which you want to automatically sell to limit losses.\n\n' +
      'For example, enter `10` to sell when the price decreases by 10%.\n\n' +
      'Send 0 to disable Stop Loss.',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error(`Set buy stop loss error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Set take profit for sell
const setSellTakeProfitHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Set user state for input
    await userService.updateUserState(ctx.from.id, {
      state: 'SETTING_SELL_TP',
      stateData: null
    });
    
    await ctx.reply(
      '📈 *Set Take Profit*\n\n' +
      'Enter the percentage increase at which you want to automatically sell for profit.\n\n' +
      'For example, enter `20` to sell when the price increases by 20%.\n\n' +
      'Send 0 to disable Take Profit.',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error(`Set sell take profit error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Set stop loss for sell
const setSellStopLossHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Set user state for input
    await userService.updateUserState(ctx.from.id, {
      state: 'SETTING_SELL_SL',
      stateData: null
    });
    
    await ctx.reply(
      '📉 *Set Stop Loss*\n\n' +
      'Enter the percentage decrease at which you want to automatically sell to limit losses.\n\n' +
      'For example, enter `10` to sell when the price decreases by 10%.\n\n' +
      'Send 0 to disable Stop Loss.',
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    logger.error(`Set sell stop loss error: ${error.message}`);
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
    await ctx.answerCbQuery();
    
    // Get user data
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Create AFK mode keyboard
    const afkKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('➕ Add New Config', 'afk_add_config')
      ],
      [
        Markup.button.callback('⏸️ Pause All', 'afk_pause_all'),
        Markup.button.callback('▶️ Start All', 'afk_start_all')
      ],
      [
        Markup.button.callback('🔄 Refresh', 'afk_refresh')
      ],
      [
        Markup.button.callback('🔙 Back', 'settings')
      ]
    ]);
    
    // Format AFK mode status message
    let message = '💤 *AFK Mode Settings*\n\n';
    
    // Check if user has any AFK configs
    const afkConfigs = user.settings?.afkMode?.configs || [];
    
    if (afkConfigs.length > 0) {
      message += 'Your active configurations:\n\n';
      
      afkConfigs.forEach((config, index) => {
        const statusEmoji = config.active ? '🟢' : '🔴';
        message += `${index + 1}. ${statusEmoji} ${config.name}\n`;
        message += `   Type: ${config.type} | Token: ${config.tokenSymbol || 'Any'}\n`;
        
        if (config.type === 'buy') {
          message += `   Amount: ${config.amount} SOL | Slippage: ${config.slippage}%\n`;
        } else if (config.type === 'sell') {
          message += `   Percentage: ${config.percentage}% | TP: ${config.takeProfit || 'Off'} | SL: ${config.stopLoss || 'Off'}\n`;
        }
        
        message += `   Created: ${new Date(config.createdAt).toLocaleString()}\n\n`;
      });
    } else {
      message += 'You don\'t have any AFK configurations yet. Use "Add New Config" to create one.\n\n';
      message += 'AFK Mode allows the bot to automatically buy or sell tokens based on your predefined settings while you\'re away.';
    }
    
    // Update or send message
    await updateOrSendMessage(ctx, message, afkKeyboard);
  } catch (error) {
    logger.error(`AFK mode handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error accessing AFK mode settings. Please try again later.');
  }
};

// Add new AFK config handler
const afkAddConfigHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Show config type selection
    const configTypeKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💰 Buy Settings', 'afk_config_buy'),
        Markup.button.callback('💸 Sell Settings', 'afk_config_sell')
      ],
      [
        Markup.button.callback('🔙 Back to AFK Mode', 'afk_mode')
      ]
    ]);
    
    await updateOrSendMessage(ctx, 
      '➕ *Create New AFK Configuration*\n\n' +
      'Select the type of configuration you want to create:',
      configTypeKeyboard
    );
  } catch (error) {
    logger.error(`AFK add config error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// AFK buy config handler
const afkConfigBuyHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user data
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Show buy amount options
    const buyAmountKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('0.5 SOL', 'afk_buy_amount_0.5'),
        Markup.button.callback('1 SOL', 'afk_buy_amount_1')
      ],
      [
        Markup.button.callback('2 SOL', 'afk_buy_amount_2'),
        Markup.button.callback('5 SOL', 'afk_buy_amount_5')
      ],
      [
        Markup.button.callback('10 SOL', 'afk_buy_amount_10'),
        Markup.button.callback('Custom', 'afk_buy_amount_custom')
      ],
      [
        Markup.button.callback('🔙 Back', 'afk_add_config')
      ]
    ]);
    
    await updateOrSendMessage(ctx, 
      '💰 *AFK Buy Configuration*\n\n' +
      'Select the amount of SOL to use for each buy:',
      buyAmountKeyboard
    );
  } catch (error) {
    logger.error(`AFK buy config error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// AFK sell config handler
const afkConfigSellHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user data
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Show sell percentage options
    const sellPercentageKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('25%', 'afk_sell_pct_25'),
        Markup.button.callback('50%', 'afk_sell_pct_50'),
        Markup.button.callback('100%', 'afk_sell_pct_100')
      ],
      [
        Markup.button.callback('Custom %', 'afk_sell_pct_custom')
      ],
      [
        Markup.button.callback('🔙 Back', 'afk_add_config')
      ]
    ]);
    
    await updateOrSendMessage(ctx, 
      '💸 *AFK Sell Configuration*\n\n' +
      'Select the percentage of tokens to sell:',
      sellPercentageKeyboard
    );
  } catch (error) {
    logger.error(`AFK sell config error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Handle AFK refresh
const afkRefreshHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Refreshing AFK configurations...');
    return afkModeHandler(ctx);
  } catch (error) {
    logger.error(`AFK refresh error: ${error.message}`);
    return ctx.reply('Sorry, there was an error refreshing AFK settings. Please try again later.');
  }
};

// Handle AFK pause all
const afkPauseAllHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user data
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Update all configs to inactive
    await userService.updateUserSettings(ctx.from.id, {
      'settings.afkMode.configs.$[].active': false
    });
    
    await ctx.reply('✅ All AFK configurations have been paused.');
    
    // Refresh the AFK mode menu
    return afkModeHandler(ctx);
  } catch (error) {
    logger.error(`AFK pause all error: ${error.message}`);
    return ctx.reply('Sorry, there was an error pausing configurations. Please try again later.');
  }
};

// Handle AFK start all
const afkStartAllHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user data
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return ctx.reply('Please start the bot first by sending /start');
    }
    
    // Update all configs to active
    await userService.updateUserSettings(ctx.from.id, {
      'settings.afkMode.configs.$[].active': true
    });
    
    await ctx.reply('✅ All AFK configurations have been activated.');
    
    // Refresh the AFK mode menu
    return afkModeHandler(ctx);
  } catch (error) {
    logger.error(`AFK start all error: ${error.message}`);
    return ctx.reply('Sorry, there was an error activating configurations. Please try again later.');
  }
};

// Handle AFK buy/sell amount selection
const afkBuyAmountHandler = async (ctx, match) => {
  try {
    await ctx.answerCbQuery();
    
    // Extract amount from the callback data
    const amount = match[1];
    
    // Store in user state for next step
    await userService.updateUserState(ctx.from.id, {
      state: 'AFK_CONFIG_BUY',
      stateData: { amount }
    });
    
    // Show auto-sell options
    const autoSellKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('Auto Sell: ON', 'afk_auto_sell_on'),
        Markup.button.callback('Auto Sell: OFF', 'afk_auto_sell_off')
      ],
      [
        Markup.button.callback('🔙 Back', 'afk_config_buy')
      ]
    ]);
    
    await updateOrSendMessage(ctx, 
      `💰 *AFK Buy Configuration*\n\n` +
      `Amount: ${amount} SOL\n\n` +
      `Would you like to enable automatic selling after buying?`,
      autoSellKeyboard
    );
  } catch (error) {
    logger.error(`AFK buy amount handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Handle AFK sell percentage selection
const afkSellPercentageHandler = async (ctx, match) => {
  try {
    await ctx.answerCbQuery();
    
    // Extract percentage from the callback data
    const percentage = match[1];
    
    // Store in user state for next step
    await userService.updateUserState(ctx.from.id, {
      state: 'AFK_CONFIG_SELL',
      stateData: { percentage }
    });
    
    // Show take profit / stop loss options
    const tpSlKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('Set Take Profit', 'afk_set_tp'),
        Markup.button.callback('Set Stop Loss', 'afk_set_sl')
      ],
      [
        Markup.button.callback('Skip (No TP/SL)', 'afk_complete_sell_config')
      ],
      [
        Markup.button.callback('🔙 Back', 'afk_config_sell')
      ]
    ]);
    
    await updateOrSendMessage(ctx, 
      `💸 *AFK Sell Configuration*\n\n` +
      `Sell percentage: ${percentage}%\n\n` +
      `Would you like to set Take Profit or Stop Loss levels?`,
      tpSlKeyboard
    );
  } catch (error) {
    logger.error(`AFK sell percentage handler error: ${error.message}`);
    ctx.reply('Sorry, there was an error. Please try again later.');
  }
};

// Save AFK Buy Config
const afkSaveBuyConfigHandler = async (ctx, autoSell) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user data and state
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user || !user.state || user.state !== 'AFK_CONFIG_BUY' || !user.stateData) {
      return ctx.reply('Configuration session expired. Please try again.');
    }
    
    // Get the amount from state data
    const { amount } = user.stateData;
    
    // Create new AFK config
    const newConfig = {
      type: 'buy',
      name: `Buy ${amount} SOL`,
      amount: parseFloat(amount),
      autoSell: autoSell,
      slippage: 1.0, // Default slippage
      active: true,
      createdAt: new Date()
    };
    
    // Add the config to user's settings
    await userService.addAfkConfig(ctx.from.id, newConfig);
    
    // Clear user state
    await userService.updateUserState(ctx.from.id, { state: null, stateData: null });
    
    // Show success message
    await ctx.reply(`✅ AFK Buy configuration saved successfully.\n\nAmount: ${amount} SOL\nAuto-sell: ${autoSell ? 'ON' : 'OFF'}`);
    
    // Return to AFK mode menu
    return afkModeHandler(ctx);
  } catch (error) {
    logger.error(`AFK save buy config error: ${error.message}`);
    return ctx.reply('Sorry, there was an error saving your configuration. Please try again later.');
  }
};

// Save AFK Sell Config
const afkSaveSellConfigHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Get user data and state
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user || !user.state || user.state !== 'AFK_CONFIG_SELL' || !user.stateData) {
      return ctx.reply('Configuration session expired. Please try again.');
    }
    
    // Get the percentage and TP/SL from state data
    const { percentage, takeProfit, stopLoss } = user.stateData;
    
    // Create new AFK config
    const newConfig = {
      type: 'sell',
      name: `Sell ${percentage}%`,
      percentage: parseFloat(percentage),
      takeProfit: takeProfit || null,
      stopLoss: stopLoss || null,
      active: true,
      createdAt: new Date()
    };
    
    // Add the config to user's settings
    await userService.addAfkConfig(ctx.from.id, newConfig);
    
    // Clear user state
    await userService.updateUserState(ctx.from.id, { state: null, stateData: null });
    
    // Show success message
    let message = `✅ AFK Sell configuration saved successfully.\n\nPercentage: ${percentage}%`;
    if (takeProfit) message += `\nTake Profit: ${takeProfit}%`;
    if (stopLoss) message += `\nStop Loss: ${stopLoss}%`;
    
    await ctx.reply(message);
    
    // Return to AFK mode menu
    return afkModeHandler(ctx);
  } catch (error) {
    logger.error(`AFK save sell config error: ${error.message}`);
    return ctx.reply('Sorry, there was an error saving your configuration. Please try again later.');
  }
};

// Auto sell handlers
const afkAutoSellOnHandler = async (ctx) => {
  return afkSaveBuyConfigHandler(ctx, true);
};

const afkAutoSellOffHandler = async (ctx) => {
  return afkSaveBuyConfigHandler(ctx, false);
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
      } else if (user.state === 'SETTING_BUY_TP') {
        // Handle Buy TP input
        const tpInput = parseFloat(ctx.message.text.trim());
        
        if (isNaN(tpInput) || tpInput < 0 || tpInput > 1000) {
          await ctx.reply('Invalid take profit value. Please enter a number between 0 and 1000');
          return;
        }
        
        // Update take profit (0 means disable)
        const tpValue = tpInput === 0 ? null : tpInput;
        await userService.updateUserSettings(ctx.from.id, {
          'settings.tradingSettings.buySettings.takeProfit': tpValue,
          state: null
        });
        
        await ctx.reply(`✅ Take profit ${tpValue ? `set to ${tpValue}%` : 'disabled'}`);
        return buySettingsHandler(ctx);
      } else if (user.state === 'SETTING_BUY_SL') {
        // Handle Buy SL input
        const slInput = parseFloat(ctx.message.text.trim());
        
        if (isNaN(slInput) || slInput < 0 || slInput > 100) {
          await ctx.reply('Invalid stop loss value. Please enter a number between 0 and 100');
          return;
        }
        
        // Update stop loss (0 means disable)
        const slValue = slInput === 0 ? null : slInput;
        await userService.updateUserSettings(ctx.from.id, {
          'settings.tradingSettings.buySettings.stopLoss': slValue,
          state: null
        });
        
        await ctx.reply(`✅ Stop loss ${slValue ? `set to ${slValue}%` : 'disabled'}`);
        return buySettingsHandler(ctx);
      } else if (user.state === 'SETTING_SELL_TP') {
        // Handle Sell TP input
        const tpInput = parseFloat(ctx.message.text.trim());
        
        if (isNaN(tpInput) || tpInput < 0 || tpInput > 1000) {
          await ctx.reply('Invalid take profit value. Please enter a number between 0 and 1000');
          return;
        }
        
        // Update take profit (0 means disable)
        const tpValue = tpInput === 0 ? null : tpInput;
        await userService.updateUserSettings(ctx.from.id, {
          'settings.tradingSettings.sellSettings.takeProfit': tpValue,
          state: null
        });
        
        await ctx.reply(`✅ Take profit ${tpValue ? `set to ${tpValue}%` : 'disabled'}`);
        return sellSettingsHandler(ctx);
      } else if (user.state === 'SETTING_SELL_SL') {
        // Handle Sell SL input
        const slInput = parseFloat(ctx.message.text.trim());
        
        if (isNaN(slInput) || slInput < 0 || slInput > 100) {
          await ctx.reply('Invalid stop loss value. Please enter a number between 0 and 100');
          return;
        }
        
        // Update stop loss (0 means disable)
        const slValue = slInput === 0 ? null : slInput;
        await userService.updateUserSettings(ctx.from.id, {
          'settings.tradingSettings.sellSettings.stopLoss': slValue,
          state: null
        });
        
        await ctx.reply(`✅ Stop loss ${slValue ? `set to ${slValue}%` : 'disabled'}`);
        return sellSettingsHandler(ctx);
      }
      
      return next();
    } catch (error) {
      logger.error(`Settings text input error: ${error.message}`);
      return next();
    }
  });
  
  // AFK mode
  bot.action('afk_mode', afkModeHandler);
  bot.action('afk_add_config', afkAddConfigHandler);
  bot.action('afk_config_buy', afkConfigBuyHandler);
  bot.action('afk_config_sell', afkConfigSellHandler);
  bot.action('afk_refresh', afkRefreshHandler);
  bot.action('afk_pause_all', afkPauseAllHandler);
  bot.action('afk_start_all', afkStartAllHandler);
  
  // AFK buy settings
  bot.action(/afk_buy_amount_(.+)/, (ctx) => {
    const match = /afk_buy_amount_(.+)/.exec(ctx.callbackQuery.data);
    return afkBuyAmountHandler(ctx, match);
  });
  bot.action('afk_auto_sell_on', afkAutoSellOnHandler);
  bot.action('afk_auto_sell_off', afkAutoSellOffHandler);
  
  // AFK sell settings
  bot.action(/afk_sell_pct_(\d+)/, (ctx) => {
    const match = /afk_sell_pct_(\d+)/.exec(ctx.callbackQuery.data);
    return afkSellPercentageHandler(ctx, match);
  });
  bot.action('afk_complete_sell_config', afkSaveSellConfigHandler);
  
  // Buy settings
  bot.action('buy_settings', buySettingsHandler);
  bot.action(/buy_amount_([0-9.]+)/, (ctx) => {
    const match = /buy_amount_([0-9.]+)/.exec(ctx.callbackQuery.data);
    if (match && match[1]) {
      return setBuyAmountHandler(ctx, match[1]);
    }
    return ctx.answerCbQuery('Invalid amount');
  });
  bot.action('toggle_auto_sell', toggleAutoSellHandler);
  bot.action('set_buy_tp', setBuyTakeProfitHandler);
  bot.action('set_buy_sl', setBuyStopLossHandler);
  
  // Sell settings
  bot.action('sell_settings', sellSettingsHandler);
  bot.action(/sell_pct_(\d+)/, (ctx) => {
    const match = /sell_pct_(\d+)/.exec(ctx.callbackQuery.data);
    if (match && match[1]) {
      return setSellPercentageHandler(ctx, match[1]);
    }
    return ctx.answerCbQuery('Invalid percentage');
  });
  bot.action('toggle_dev_sell', toggleDevSellHandler);
  bot.action('set_sell_tp', setSellTakeProfitHandler);
  bot.action('set_sell_sl', setSellStopLossHandler);
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
  afkAddConfigHandler,
  afkConfigBuyHandler,
  afkConfigSellHandler,
  afkRefreshHandler,
  afkPauseAllHandler,
  afkStartAllHandler,
  afkBuyAmountHandler,
  afkSellPercentageHandler,
  afkSaveBuyConfigHandler,
  afkAutoSellOnHandler,
  afkAutoSellOffHandler,
  afkSaveSellConfigHandler,
  botClicksHandler,
  createWalletHandler
};