/**
 * positionsHandler.js - This file handles displaying the overall positions list for the user.
 * It provides a simple overview of all token holdings in the user's wallet.
 * 
 * NOTE: This file differs from positionHandler.js (singular) which provides more detailed
 * position management features including selling percentages, setting alerts, stop losses, etc.
 * The positionsHandler.js shows a simpler view for quicker access to basic position information.
 */

// Handle positions
const positionsHandler = async (ctx) => {
  try {
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    if (!user) {
      return ctx.reply('You need to create an account first. Please use /start command.');
    }
    
    // Get wallet address
    const walletAddress = user.walletAddress;
    
    // Get SOL balance
    const solBalance = await wallet.getSolBalance(walletAddress);
    
    // Get SOL price for USD value calculation
    const solPrice = await wallet.getSolPrice();
    const balanceUsd = solBalance * solPrice;
    
    // Fetch token positions from wallet using Helius API
    const tokens = await fetchTokenPositions(walletAddress);
    
    // Create message
    let message = `📊 *Your Positions*\n\n`;
    message += `💰 *Wallet:* \`${walletAddress}\`\n\n`;
    message += `💎 *SOL Balance:* ${solBalance.toFixed(4)} SOL ($${balanceUsd.toFixed(2)})\n\n`;
    
    if (tokens.length > 0) {
      message += `🪙 *Token Positions:*\n\n`;
      
      // Display token positions
      tokens.forEach((token, index) => {
        message += `${index + 1}. ${token.name || 'Unknown Token'} (${token.symbol || '???'})\n`;
        message += `   Balance: ${token.balance.toFixed(token.decimals >= 6 ? 2 : token.decimals)} ${token.symbol || 'tokens'}\n`;
        if (token.price) {
          message += `   Value: $${(token.balance * token.price).toFixed(2)}\n`;
        }
        message += `   Address: \`${token.address}\`\n\n`;
      });
    } else {
      message += `No token positions found in this wallet.`;
    }
    
    // Create keyboard
    const positionsKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔄 Refresh', 'refresh_positions'),
        Markup.button.callback('📤 Send Tokens', 'send_tokens')
      ],
      [
        Markup.button.callback('💱 Swap Tokens', 'swap_tokens'),
        Markup.button.callback('💰 Add SOL', 'add_sol')
      ],
      [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
    ]);
    
    return ctx.reply(message, {
      parse_mode: 'Markdown',
      ...positionsKeyboard
    });
  } catch (error) {
    console.error('Positions handler error:', error);
    return ctx.reply('Sorry, there was an error fetching your positions. Please try again later.');
  }
};

// Helper function to fetch token positions
const fetchTokenPositions = async (walletAddress) => {
  try {
    // Use the Helius API to fetch token balances
    const apiKey = process.env.HELIUS_API_KEY;
    const apiUrl = `https://api.helius.xyz/v0/addresses/${walletAddress}/balances?api-key=${apiKey}`;
    
    const response = await axios.get(apiUrl);
    const data = response.data;
    
    if (!data || !data.tokens) {
      return [];
    }
    
    // Format token data
    const tokens = data.tokens.map(token => {
      // Calculate real balance using decimals
      const balance = token.amount / Math.pow(10, token.decimals);
      
      return {
        address: token.mint,
        name: token.name || 'Unknown Token',
        symbol: token.symbol || '???',
        balance: balance,
        decimals: token.decimals,
        price: token.price || null
      };
    });
    
    // Sort by value (if price available) or balance
    return tokens.sort((a, b) => {
      const aValue = a.price ? a.balance * a.price : 0;
      const bValue = b.price ? b.balance * b.price : 0;
      
      if (aValue !== bValue) {
        return bValue - aValue; // Sort by value descending
      }
      
      return b.balance - a.balance; // Sort by balance descending if values are equal
    });
  } catch (error) {
    console.error('Error fetching token positions:', error);
    return [];
  }
};

// Refresh positions handler
const refreshPositionsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Refreshing positions...');
    return positionsHandler(ctx);
  } catch (error) {
    console.error('Refresh positions error:', error);
    return ctx.reply('Sorry, there was an error refreshing your positions.');
  }
};

// Register handlers
const registerPositionsHandlers = (bot) => {
  bot.hears('📊 My Positions', positionsHandler);
  bot.command('positions', positionsHandler);
  bot.action('refresh_positions', refreshPositionsHandler);
  bot.action('back_to_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      return ctx.scene.enter('startScene');
    } catch (error) {
      console.error('Back to menu error:', error);
      return ctx.reply('Sorry, there was an error going back to the menu.');
    }
  });
};

module.exports = {
  positionsHandler,
  registerPositionsHandlers
}; 