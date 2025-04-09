const { Markup } = require('telegraf');
const userService = require('../services/userService');
const { getTokenInfo } = require('../../utils/wallet');
const { logger } = require('../database');

// Show user limit orders
const limitOrdersHandler = async (ctx) => {
  try {
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // If no limit orders
    if (!user.limitOrders || user.limitOrders.length === 0) {
      return ctx.reply(
        '📝 *Your Limit Orders*\n\n' +
        'You have no active limit orders.\n\n' +
        'To create a limit order, use the Buy or Sell options and select the limit order option.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
          ])
        }
      );
    }
    
    // Process limit orders
    let message = '📝 *Your Limit Orders*\n\n';
    let buttons = [];
    
    // Filter active limit orders
    const activeOrders = user.limitOrders.filter(order => order.status === 'active');
    
    // Process each order
    for (const order of activeOrders) {
      try {
        // Get token info
        let tokenName = 'Unknown Token';
        let tokenSymbol = '???';
        
        try {
          const tokenInfo = await getTokenInfo(order.tokenAddress);
          if (tokenInfo) {
            tokenName = tokenInfo.name || 'Unknown Token';
            tokenSymbol = tokenInfo.symbol || '???';
          }
        } catch (error) {
          logger.error(`Error getting token info: ${error.message}`);
        }
        
        // Create order entry in message
        message += `*${tokenName} (${tokenSymbol})*\n`;
        message += `Type: ${order.type === 'buy' ? '💰 Buy' : '💸 Sell'}\n`;
        message += `Amount: ${order.amount}\n`;
        message += `Price: $${order.price.toFixed(4)}\n`;
        message += `Created: ${new Date(order.createdAt).toLocaleString()}\n\n`;
        
        // Add button for this order
        buttons.push([Markup.button.callback(`Cancel ${order.type} ${tokenSymbol}`, `cancel_order_${order._id}`)]);
      } catch (error) {
        logger.error(`Error processing limit order: ${error.message}`);
      }
    }
    
    // Add action buttons
    buttons.push([
      Markup.button.callback('Create Buy Order', 'create_buy_order'),
      Markup.button.callback('Create Sell Order', 'create_sell_order')
    ]);
    
    // Add back button
    buttons.push([Markup.button.callback('🔙 Back to Menu', 'refresh_data')]);
    
    // Send limit orders message
    return ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  } catch (error) {
    logger.error(`Limit orders handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Cancel a limit order
const cancelOrderHandler = async (ctx, orderId) => {
  try {
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    // Find the order
    const orderIndex = user.limitOrders.findIndex(o => o._id.toString() === orderId);
    
    if (orderIndex === -1) {
      return ctx.reply('Order not found');
    }
    
    // Update order status
    user.limitOrders[orderIndex].status = 'cancelled';
    await user.save();
    
    // Confirm cancellation
    await ctx.reply('✅ Limit order has been cancelled.');
    
    // Show updated orders
    return limitOrdersHandler(ctx);
  } catch (error) {
    logger.error(`Cancel order error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Create a new order (placeholder)
const createOrderHandler = async (ctx, type) => {
  try {
    await ctx.reply(
      `To create a ${type} limit order, please enter the token address you want to ${type}.`
    );
    
    // This is where you would enter a scene/state to collect token, amount, and price
    // For now, just show a placeholder message
    
    await ctx.reply(
      `This feature is still under implementation. Check back later!`
    );
    
    return limitOrdersHandler(ctx);
  } catch (error) {
    logger.error(`Create order error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Register limit order handlers
const registerLimitOrderHandlers = (bot) => {
  // Main limit orders view
  bot.hears('📝 Limit Orders', limitOrdersHandler);
  
  // Cancel order action
  bot.action(/cancel_order_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const orderId = ctx.match[1];
      return cancelOrderHandler(ctx, orderId);
    } catch (error) {
      logger.error(`Cancel order action error: ${error.message}`);
    }
  });
  
  // Create order actions
  bot.action('create_buy_order', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      return createOrderHandler(ctx, 'buy');
    } catch (error) {
      logger.error(`Create buy order error: ${error.message}`);
    }
  });
  
  bot.action('create_sell_order', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      return createOrderHandler(ctx, 'sell');
    } catch (error) {
      logger.error(`Create sell order error: ${error.message}`);
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
};

module.exports = {
  limitOrdersHandler,
  registerLimitOrderHandlers
}; 