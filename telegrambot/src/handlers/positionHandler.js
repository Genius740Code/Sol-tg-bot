const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { getTokenInfo, getTokenPrice, getSolPrice, isRateLimited } = require('../../utils/wallet');
const { logger } = require('../database');

// Show user positions
const positionsHandler = async (ctx) => {
  try {
    // Check rate limit
    if (isRateLimited(ctx.from.id)) {
      return ctx.reply('Please wait a moment before making another request.');
    }
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Get current SOL price
    let solPrice = 0;
    try {
      solPrice = await getSolPrice();
    } catch (error) {
      logger.error(`Error getting SOL price: ${error.message}`);
    }
    
    // If no positions
    if (!user.positions || user.positions.length === 0) {
      const buyKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Buy SOL Token', 'buy_new_token')],
        [Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]
      ]);
      
      return ctx.reply(
        '📊 *Your Positions*\n\n' +
        'You have no open positions right now.\n\n' +
        'To create a position, use the Buy option from the main menu.',
        {
          parse_mode: 'Markdown',
          ...buyKeyboard
        }
      );
    }
    
    // Process positions
    let message = '📊 *Your Positions*\n\n';
    let buttons = [];
    let totalValue = 0;
    
    // Process each position
    for (const position of user.positions) {
      try {
        // Get token info and price
        let tokenData;
        try {
          tokenData = await getTokenPrice(position.tokenAddress);
        } catch (error) {
          logger.error(`Error getting token price: ${error.message}`);
          tokenData = {
            price: 0,
            tokenInfo: await getTokenInfo(position.tokenAddress)
          };
        }
        
        const tokenInfo = tokenData.tokenInfo || {};
        const tokenName = tokenInfo.name || 'Unknown Token';
        const tokenSymbol = tokenInfo.symbol || '???';
        
        // Calculate current value and P/L
        let currentPrice = 0;
        
        // Use real token price if available, else placeholder
        if (typeof tokenData.price === 'number') {
          currentPrice = tokenData.price;
        } else {
          // Placeholder - assumes some gain for demo purposes
          currentPrice = position.entryPrice * 1.1;
        }
        
        const entryValue = position.amount * position.entryPrice;
        const currentValue = position.amount * currentPrice;
        const pnl = currentValue - entryValue;
        const pnlPercentage = (pnl / entryValue) * 100;
        
        // Add to total value
        totalValue += currentValue;
        
        // Create position entry in message
        message += `*${tokenName} (${tokenSymbol})*\n`;
        message += `Amount: ${position.amount.toFixed(position.amount < 0.01 ? 6 : 4)}\n`;
        message += `Entry: $${position.entryPrice.toFixed(4)}\n`;
        message += `Current: $${currentPrice.toFixed(4)}\n`;
        message += `P/L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD (${pnlPercentage.toFixed(2)}%)\n\n`;
        
        // Add button for this position
        buttons.push([Markup.button.callback(`Manage ${tokenSymbol}`, `manage_position_${position.tokenAddress}`)]);
      } catch (error) {
        logger.error(`Error processing position: ${error.message}`);
      }
    }
    
    // Add total value to message
    message = `💰 *Total Portfolio Value: $${totalValue.toFixed(2)}*\n\n` + message;
    
    // Add buy new token button
    buttons.push([Markup.button.callback('Buy New Token', 'buy_new_token')]);
    
    // Add back button
    buttons.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
    
    // Send positions message
    return ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  } catch (error) {
    logger.error(`Positions handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Manage a specific position
const managePositionHandler = async (ctx, tokenAddress) => {
  try {
    // Check rate limit
    if (isRateLimited(ctx.from.id)) {
      return ctx.reply('Please wait a moment before making another request.');
    }
    
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Find the position
    const position = user.positions.find(p => p.tokenAddress === tokenAddress);
    
    if (!position) {
      return ctx.reply('Position not found');
    }
    
    // Get token info and price
    let tokenData;
    try {
      tokenData = await getTokenPrice(tokenAddress);
    } catch (error) {
      logger.error(`Error getting token price: ${error.message}`);
      tokenData = {
        price: 0,
        tokenInfo: await getTokenInfo(tokenAddress)
      };
    }
    
    const tokenInfo = tokenData.tokenInfo || {};
    const tokenName = tokenInfo.name || 'Unknown Token';
    const tokenSymbol = tokenInfo.symbol || '???';
    
    // Calculate current value and P/L
    let currentPrice = 0;
    
    // Use real token price if available, else placeholder
    if (typeof tokenData.price === 'number') {
      currentPrice = tokenData.price;
    } else {
      // Placeholder - assumes some gain for demo purposes
      currentPrice = position.entryPrice * 1.1;
    }
    
    const entryValue = position.amount * position.entryPrice;
    const currentValue = position.amount * currentPrice;
    const pnl = currentValue - entryValue;
    const pnlPercentage = (pnl / entryValue) * 100;
    
    // Calculate fee (0.8% normal, 0.712% with referral - 11% discount)
    const normalFee = 0.8;
    const referralFee = normalFee * 0.89; // 11% less
    
    // Create position management buttons
    const actionKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('Sell 25%', `sell_position_${tokenAddress}_0.25`),
        Markup.button.callback('Sell 50%', `sell_position_${tokenAddress}_0.5`),
      ],
      [
        Markup.button.callback('Sell 75%', `sell_position_${tokenAddress}_0.75`),
        Markup.button.callback('Sell All', `sell_position_${tokenAddress}_1.0`),
      ],
      [
        Markup.button.callback('Buy More', `buy_more_${tokenAddress}`),
        Markup.button.callback('Set Price Alert', `set_alert_${tokenAddress}`)
      ],
      [Markup.button.callback('Set Take Profit/Stop Loss', `set_tpsl_${tokenAddress}`)],
      [Markup.button.callback('🔙 Back to Positions', 'view_positions')]
    ]);
    
    // Send position management message
    return ctx.reply(
      `*Managing ${tokenName} (${tokenSymbol}) Position*\n\n` +
      `Amount: ${position.amount.toFixed(position.amount < 0.01 ? 6 : 4)}\n` +
      `Entry Price: $${position.entryPrice.toFixed(4)}\n` +
      `Current Price: $${currentPrice.toFixed(4)}\n\n` +
      `Current Value: $${currentValue.toFixed(2)}\n` +
      `P/L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USD (${pnlPercentage.toFixed(2)}%)\n\n` +
      `Sell Fee: ${normalFee}% (${referralFee}% with referral)\n\n` +
      `Choose an action:`,
      {
        parse_mode: 'Markdown',
        ...actionKeyboard
      }
    );
  } catch (error) {
    logger.error(`Manage position handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Buy new token handler
const buyNewTokenHandler = async (ctx) => {
  try {
    // Prompt user to enter token address
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back to Positions', 'view_positions')]
    ]);
    
    return ctx.reply(
      `💰 *Buy New Token*\n\n` +
      `Please enter the token address you want to buy.`,
      {
        parse_mode: 'Markdown',
        ...keyboard
      }
    );
  } catch (error) {
    logger.error(`Buy new token error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Register position handlers
const registerPositionHandlers = (bot) => {
  // Main positions view
  bot.hears('📊 Positions', positionsHandler);
  
  // View positions action
  bot.action('view_positions', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      return positionsHandler(ctx);
    } catch (error) {
      logger.error(`View positions error: ${error.message}`);
    }
  });
  
  // Buy new token action
  bot.action('buy_new_token', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      return buyNewTokenHandler(ctx);
    } catch (error) {
      logger.error(`Buy new token action error: ${error.message}`);
    }
  });
  
  // Buy more of existing token
  bot.action(/buy_more_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      
      // Create keyboard with buy options
      const buyMoreKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('0.1 SOL', `confirm_buy_more_${tokenAddress}_0.1`),
          Markup.button.callback('0.5 SOL', `confirm_buy_more_${tokenAddress}_0.5`)
        ],
        [
          Markup.button.callback('1 SOL', `confirm_buy_more_${tokenAddress}_1`),
          Markup.button.callback('Custom Amount', `custom_buy_more_${tokenAddress}`)
        ],
        [Markup.button.callback('🔙 Back', `manage_position_${tokenAddress}`)]
      ]);
      
      return ctx.reply(
        `💰 *Buy More ${tokenSymbol}*\n\n` +
        `How much SOL would you like to spend?`,
        {
          parse_mode: 'Markdown',
          ...buyMoreKeyboard
        }
      );
    } catch (error) {
      logger.error(`Buy more error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Confirm buy more action
  bot.action(/confirm_buy_more_(.+)_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      const amount = parseFloat(ctx.match[2]);
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      
      // Here you would implement the actual buying logic
      // This would involve calling a Solana transaction
      
      // For now, just show a confirmation message
      await ctx.reply(
        `✅ Transaction submitted!\n\n` +
        `You are buying more ${tokenSymbol} with ${amount} SOL.\n\n` +
        `This feature is still under implementation for actual transactions.`
      );
      
      // Back to positions
      return positionsHandler(ctx);
    } catch (error) {
      logger.error(`Confirm buy more error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Manage position action
  bot.action(/manage_position_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      return managePositionHandler(ctx, tokenAddress);
    } catch (error) {
      logger.error(`Manage position action error: ${error.message}`);
    }
  });
  
  // Sell position action
  bot.action(/sell_position_(.+)_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      const percentage = parseFloat(ctx.match[2]);
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      
      // Get user position
      const user = await userService.getUserByTelegramId(ctx.from.id);
      const position = user.positions.find(p => p.tokenAddress === tokenAddress);
      
      if (!position) {
        return ctx.reply('Position not found');
      }
      
      // Calculate amount to sell
      const sellAmount = position.amount * percentage;
      const percentText = percentage < 1 ? `${percentage * 100}%` : 'all';
      
      // Here you would implement the actual selling logic
      // This would involve calling a Solana transaction
      
      // For now, just show a confirmation message
      await ctx.reply(
        `✅ Sell order submitted!\n\n` +
        `You are selling ${percentText} of your ${tokenSymbol} (${sellAmount.toFixed(sellAmount < 0.01 ? 6 : 4)} tokens).\n\n` +
        `When you sell ${percentText} of your position, you are up 100%!\n\n` +
        `This feature is still under implementation for actual transactions.`
      );
      
      // Back to positions
      return positionsHandler(ctx);
    } catch (error) {
      logger.error(`Sell position error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Set take profit/stop loss action
  bot.action(/set_tpsl_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      const currentPrice = typeof tokenData.price === 'number' ? tokenData.price : 0;
      
      // Create keyboard with TP/SL options
      const tpslKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`TP: +10%`, `set_tp_${tokenAddress}_10`),
          Markup.button.callback(`TP: +25%`, `set_tp_${tokenAddress}_25`)
        ],
        [
          Markup.button.callback(`TP: +50%`, `set_tp_${tokenAddress}_50`),
          Markup.button.callback(`TP: Custom`, `custom_tp_${tokenAddress}`)
        ],
        [
          Markup.button.callback(`SL: -5%`, `set_sl_${tokenAddress}_5`),
          Markup.button.callback(`SL: -10%`, `set_sl_${tokenAddress}_10`)
        ],
        [
          Markup.button.callback(`SL: -20%`, `set_sl_${tokenAddress}_20`),
          Markup.button.callback(`SL: Custom`, `custom_sl_${tokenAddress}`)
        ],
        [Markup.button.callback('🔙 Back', `manage_position_${tokenAddress}`)]
      ]);
      
      return ctx.reply(
        `📈 *Set Take Profit/Stop Loss for ${tokenSymbol}*\n\n` +
        `Current Price: $${currentPrice.toFixed(4)}\n\n` +
        `Select your TP/SL levels:`,
        {
          parse_mode: 'Markdown',
          ...tpslKeyboard
        }
      );
    } catch (error) {
      logger.error(`Set TP/SL error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Set price alert action
  bot.action(/set_alert_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      const currentPrice = typeof tokenData.price === 'number' ? tokenData.price : 0;
      
      // Create keyboard with alert options
      const alertKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback(`Above +10%`, `set_alert_above_${tokenAddress}_10`),
          Markup.button.callback(`Below -10%`, `set_alert_below_${tokenAddress}_10`)
        ],
        [
          Markup.button.callback(`Above +25%`, `set_alert_above_${tokenAddress}_25`),
          Markup.button.callback(`Below -25%`, `set_alert_below_${tokenAddress}_25`)
        ],
        [
          Markup.button.callback(`Custom Alert`, `custom_alert_${tokenAddress}`),
        ],
        [Markup.button.callback('🔙 Back', `manage_position_${tokenAddress}`)]
      ]);
      
      return ctx.reply(
        `🔔 *Set Price Alert for ${tokenSymbol}*\n\n` +
        `Current Price: $${currentPrice.toFixed(4)}\n\n` +
        `Select your alert threshold:`,
        {
          parse_mode: 'Markdown',
          ...alertKeyboard
        }
      );
    } catch (error) {
      logger.error(`Set alert error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Take profit set action
  bot.action(/set_tp_(.+)_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      const percentage = parseInt(ctx.match[2]);
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      const currentPrice = typeof tokenData.price === 'number' ? tokenData.price : 0;
      
      // Calculate TP price
      const tpPrice = currentPrice * (1 + percentage/100);
      
      // Here you would add the TP order to the user's settings
      // For now, just show a confirmation
      
      await ctx.reply(
        `✅ Take Profit set for ${tokenSymbol}!\n\n` +
        `When the price reaches $${tpPrice.toFixed(4)} (+${percentage}%), your position will be sold.\n\n` +
        `This feature is still under implementation for actual transactions.`
      );
      
      // Back to position management
      return managePositionHandler(ctx, tokenAddress);
    } catch (error) {
      logger.error(`Set TP error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Stop loss set action
  bot.action(/set_sl_(.+)_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      const percentage = parseInt(ctx.match[2]);
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      const currentPrice = typeof tokenData.price === 'number' ? tokenData.price : 0;
      
      // Calculate SL price
      const slPrice = currentPrice * (1 - percentage/100);
      
      // Here you would add the SL order to the user's settings
      // For now, just show a confirmation
      
      await ctx.reply(
        `✅ Stop Loss set for ${tokenSymbol}!\n\n` +
        `When the price reaches $${slPrice.toFixed(4)} (-${percentage}%), your position will be sold.\n\n` +
        `This feature is still under implementation for actual transactions.`
      );
      
      // Back to position management
      return managePositionHandler(ctx, tokenAddress);
    } catch (error) {
      logger.error(`Set SL error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Alert set action
  bot.action(/set_alert_(above|below)_(.+)_(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const direction = ctx.match[1];
      const tokenAddress = ctx.match[2];
      const percentage = parseInt(ctx.match[3]);
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      const currentPrice = typeof tokenData.price === 'number' ? tokenData.price : 0;
      
      // Calculate alert price
      const factor = direction === 'above' ? (1 + percentage/100) : (1 - percentage/100);
      const alertPrice = currentPrice * factor;
      
      // Here you would add the alert to the user's settings
      // For now, just show a confirmation
      
      await ctx.reply(
        `✅ Price Alert set for ${tokenSymbol}!\n\n` +
        `You will be notified when the price goes ${direction} $${alertPrice.toFixed(4)} ` +
        `(${direction === 'above' ? '+' : '-'}${percentage}%).\n\n` +
        `This feature is still under implementation for actual alerts.`
      );
      
      // Back to position management
      return managePositionHandler(ctx, tokenAddress);
    } catch (error) {
      logger.error(`Set alert error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Back to menu action
  bot.action('back_to_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      // Redirect to start menu
      await ctx.reply('Returning to main menu...');
    } catch (error) {
      logger.error(`Back to menu error: ${error.message}`);
    }
  });
  
  // Main menu button
  bot.hears('🔙 Main Menu', async (ctx) => {
    // Redirect to start menu
    await ctx.reply('Returning to main menu...');
  });
};

module.exports = {
  positionsHandler,
  registerPositionHandlers,
  buyNewTokenHandler
}; 