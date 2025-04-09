const { getTokenInfo, getTokenPrice, isRateLimited } = require('../../utils/wallet');
const { Markup } = require('telegraf');
const { logger } = require('../database');
const axios = require('axios');

// Handle token address analysis
const tokenInfoHandler = async (ctx) => {
  try {
    // Check rate limit
    if (isRateLimited(ctx.from.id)) {
      return ctx.reply('Please wait a moment before making another request.');
    }
    
    // Initial loading message
    await ctx.reply('⏳ Analyzing token, please wait...');
    
    // Get token address from message
    const message = ctx.message.text;
    const tokenAddress = message.trim();
    
    // Check if input is a valid Solana address format
    if (!tokenAddress.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      return ctx.reply('Please enter a valid Solana token address.');
    }
    
    // Get token price and info from Helius
    const tokenData = await getTokenPrice(tokenAddress);
    
    if (!tokenData || !tokenData.tokenInfo) {
      return ctx.reply('❌ Could not find information for this token.');
    }
    
    const tokenInfo = tokenData.tokenInfo;
    
    // Prepare token info message
    const tokenName = tokenInfo.name || 'Unknown';
    const tokenSymbol = tokenInfo.symbol || 'Unknown';
    const tokenDecimals = tokenInfo.decimals || 0;
    
    // Get token image if available
    let imageUrl = '';
    if (tokenInfo.content && tokenInfo.content.links && tokenInfo.content.links.image) {
      imageUrl = tokenInfo.content.links.image;
    }
    
    // Format price data
    const price = typeof tokenData.price === 'number' ? 
      `$${tokenData.price.toFixed(tokenData.price < 0.01 ? 8 : 4)}` : 
      'Unknown';
    
    const marketCap = typeof tokenData.marketCap === 'number' ? 
      `$${tokenData.marketCap.toLocaleString()}` : 
      'Unknown';
      
    const liquidity = typeof tokenData.liquidity === 'number' ? 
      `$${tokenData.liquidity.toLocaleString()}` : 
      'Unknown';
    
    // Build response message
    let responseMessage = `🔍 *Token Analysis*\n\n`;
    responseMessage += `📛 *Name:* ${tokenName}\n`;
    responseMessage += `🔤 *Symbol:* ${tokenSymbol}\n`;
    responseMessage += `🏦 *Address:* \`${tokenAddress}\`\n`;
    responseMessage += `🔢 *Decimals:* ${tokenDecimals}\n\n`;
    responseMessage += `💲 *Price:* ${price}\n`;
    responseMessage += `💰 *Market Cap:* ${marketCap}\n`;
    responseMessage += `💧 *Liquidity:* ${liquidity}\n\n`;
    
    // Add supply info if available
    if (tokenInfo.supply) {
      const totalSupply = parseInt(tokenInfo.supply.total) / Math.pow(10, tokenDecimals);
      responseMessage += `📊 *Total Supply:* ${totalSupply.toLocaleString()}\n\n`;
    }
    
    // Check if token is verified/renounced
    const isRenounced = tokenInfo.isRenounced || false;
    responseMessage += `${isRenounced ? '✅ Renounced' : '⚠️ Not Renounced'}\n\n`;
    
    // Add links to explorers
    responseMessage += `🔗 *Links:*\n`;
    responseMessage += `• [Chart](https://dexscreener.com/solana/${tokenAddress})\n`;
    responseMessage += `• [Solscan](https://solscan.io/token/${tokenAddress})\n`;
    responseMessage += `• [Jupiter](https://jup.ag/swap/SOL-${tokenAddress})\n`;
    
    // Create referral link
    const refLink = `https://t.me/sol_trojanbot?start=r-${ctx.from.username}-${tokenAddress}`;
    responseMessage += `• [Share with Referral](${refLink})\n`;
    
    // Add action buttons
    const actionKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💰 Buy', `buy_${tokenAddress}`),
        Markup.button.callback('💸 Sell', `sell_${tokenAddress}`)
      ],
      [
        Markup.button.callback('📈 Set Price Alert', `alert_${tokenAddress}`),
        Markup.button.callback('🔍 Track', `track_${tokenAddress}`)
      ],
      [
        Markup.button.callback('🔙 Back', 'refresh_data')
      ]
    ]);
    
    // Send response
    return ctx.reply(responseMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...actionKeyboard
    });
    
  } catch (error) {
    logger.error(`Token info handler error: ${error.message}`);
    return ctx.reply('Sorry, I could not analyze this token. Please try again later.');
  }
};

// Buy token handler
const buyTokenHandler = async (ctx, tokenAddress) => {
  try {
    // This would be a scene or wizard to handle the buying process
    // For now we'll show a placeholder
    
    // Get token info
    const tokenData = await getTokenPrice(tokenAddress);
    const tokenInfo = tokenData.tokenInfo;
    const tokenSymbol = tokenInfo.symbol || 'Unknown';
    const tokenPrice = typeof tokenData.price === 'number' ? 
      `$${tokenData.price.toFixed(4)}` : 'Unknown';
    
    // Calculate fee (0.8% normal, 0.712% with referral - 11% discount)
    const normalFee = 0.8;
    const referralFee = normalFee * 0.89; // 11% less
    
    // Send message with buy options
    const buyKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('0.1 SOL', `confirm_buy_${tokenAddress}_0.1`),
        Markup.button.callback('0.5 SOL', `confirm_buy_${tokenAddress}_0.5`)
      ],
      [
        Markup.button.callback('1 SOL', `confirm_buy_${tokenAddress}_1`),
        Markup.button.callback('Custom Amount', `custom_buy_${tokenAddress}`)
      ],
      [Markup.button.callback('🔙 Back', `token_info_${tokenAddress}`)]
    ]);
    
    return ctx.reply(
      `💰 *Buy ${tokenSymbol}*\n\n` +
      `Current Price: ${tokenPrice}\n\n` +
      `Trading Fee: ${normalFee}% (${referralFee}% with referral)\n\n` +
      `How much SOL would you like to spend?`,
      {
        parse_mode: 'Markdown',
        ...buyKeyboard
      }
    );
  } catch (error) {
    logger.error(`Buy token handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Sell token handler
const sellTokenHandler = async (ctx, tokenAddress) => {
  try {
    // Get token info
    const tokenData = await getTokenPrice(tokenAddress);
    const tokenInfo = tokenData.tokenInfo || {};
    const tokenSymbol = tokenInfo.symbol || 'Unknown';
    const tokenName = tokenInfo.name || 'Unknown Token';
    
    // Format data for display
    const price = typeof tokenData.price === 'number' ? 
      tokenData.price : 0;
    
    const marketCap = typeof tokenData.marketCap === 'number' ? 
      `$${tokenData.marketCap.toLocaleString()}` : 
      'Unknown';
      
    const liquidity = typeof tokenData.liquidity === 'number' ? 
      `$${tokenData.liquidity.toLocaleString()}` : 
      'Unknown';
    
    // Mock token balance - would come from user's actual holdings
    const tokenBalance = 1865.569512;
    const tokenValueUsd = tokenBalance * price;
    
    // Mock entry data - would come from user's actual position
    const entryPrice = price * 100; // Simulate a 99% loss for example
    const entryMC = entryPrice * (tokenData.marketCap / price);
    
    // Calculate PNL
    const pnlUsd = tokenValueUsd - (tokenBalance * entryPrice);
    const pnlUsdPercent = (price / entryPrice - 1) * 100;
    
    // SOL price for conversion
    const solPrice = 100; // Mock SOL price
    const pnlSol = pnlUsd / solPrice;
    const pnlSolPercent = pnlUsdPercent; // Same percentage
    
    // Create links
    const dexScreenerLink = `https://dexscreener.com/solana/${tokenAddress}`;
    const swapLink = `https://t.me/sol_trojanbot/bmaps?startapp=${tokenAddress}_sol`;
    const refLink = `https://t.me/sol_trojanbot?start=r-${ctx.from.username}-${tokenAddress}`;
    const walletLink = `https://t.me/sol_trojanbot?start=walletMenu`;
    
    // Build message
    let message = `💸 *Sell $${tokenSymbol}* — ${tokenName}\n`;
    message += `[📈](${dexScreenerLink}) [🫧](${swapLink})\n`;
    message += `\`${tokenAddress}\`\n`;
    message += `[Share token with your Reflink](${refLink})\n\n`;
    
    message += `Balance: ${tokenBalance.toFixed(6)} ${tokenSymbol} ($${tokenValueUsd.toFixed(2)}) — [W1 ✏️](${walletLink})\n`;
    message += `Price: $${price.toFixed(8)} — LIQ: ${liquidity} — MC: ${marketCap}\n`;
    
    // Add renounced status if available
    const isRenounced = tokenInfo.isRenounced || false;
    message += `${isRenounced ? 'Renounced ✅' : 'Not Renounced ⚠️'}\n\n`;
    
    // Add entry and PNL info
    message += `Avg Entry Price & MC: $${entryPrice.toFixed(6)} — $${entryMC.toLocaleString()}\n`;
    
    // Format PNL with color indicators
    const usdPnlColor = pnlUsdPercent >= 0 ? '🟩' : '🟥';
    const solPnlColor = pnlSolPercent >= 0 ? '🟩' : '🟥';
    
    message += `PNL USD: ${pnlUsdPercent.toFixed(2)}% ($${pnlUsd.toFixed(2)}) ${usdPnlColor}\n`;
    message += `PNL SOL: ${pnlSolPercent.toFixed(2)}% (${pnlSol.toFixed(3)} SOL) ${solPnlColor}\n\n`;
    
    // Add sell information
    message += `You Sell:\n`;
    message += `${Math.floor(tokenBalance)} ${tokenSymbol} ($${tokenValueUsd.toFixed(2)}) [⇄](https://t.me/sol_trojanbot?start=switchToBuy) ${(tokenValueUsd / solPrice).toFixed(3)} SOL ($${tokenValueUsd.toFixed(2)})\n`;
    message += `Price Impact: 0.00%`;
    
    // Create sell options keyboard
    const sellKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('Sell 25%', `confirm_sell_${tokenAddress}_25`),
        Markup.button.callback('Sell 50%', `confirm_sell_${tokenAddress}_50`)
      ],
      [
        Markup.button.callback('Sell 75%', `confirm_sell_${tokenAddress}_75`),
        Markup.button.callback('Sell 100%', `confirm_sell_${tokenAddress}_100`)
      ],
      [
        Markup.button.callback('Custom %', `custom_sell_${tokenAddress}`),
        Markup.button.callback('Slippage: 1%', `set_slippage_${tokenAddress}_1`)
      ],
      [
        Markup.button.callback('🔙 Back', 'refresh_data')
      ]
    ]);
    
    return ctx.reply(message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...sellKeyboard
    });
  } catch (error) {
    logger.error(`Sell token handler error: ${error.message}`);
    return ctx.reply('Sorry, something went wrong. Please try again later.');
  }
};

// Register token scene
const registerTokenHandlers = (bot) => {
  // Listen for token address inputs in format mode
  bot.hears(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, tokenInfoHandler);
  
  // Token info action
  bot.action(/token_info_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      // Simulate user sending the token address as a message
      ctx.message = { text: tokenAddress };
      return tokenInfoHandler(ctx);
    } catch (error) {
      logger.error(`Token info action error: ${error.message}`);
    }
  });
  
  // Callback for action buttons
  bot.action(/buy_(.+)/, async (ctx) => {
    const tokenAddress = ctx.match[1];
    await ctx.answerCbQuery();
    return buyTokenHandler(ctx, tokenAddress);
  });
  
  bot.action(/sell_(.+)/, async (ctx) => {
    const tokenAddress = ctx.match[1];
    await ctx.answerCbQuery();
    return sellTokenHandler(ctx, tokenAddress);
  });
  
  // Confirm buy action
  bot.action(/confirm_buy_(.+)_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      const amount = ctx.match[2];
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo;
      const tokenSymbol = tokenInfo.symbol || 'Unknown';
      
      // Here you would implement the actual buying logic
      // This would involve calling a Solana transaction
      
      // For now, just show a confirmation message
      await ctx.reply(
        `✅ Transaction submitted!\n\n` +
        `You are buying ${tokenSymbol} with ${amount} SOL.\n\n` +
        `This feature is still under implementation for actual transactions.`
      );
      
      // Back to main menu
      return ctx.reply('Returning to main menu...');
    } catch (error) {
      logger.error(`Confirm buy error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  // Confirm sell action
  bot.action(/confirm_sell_(.+)_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      const percentage = ctx.match[2];
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo;
      const tokenSymbol = tokenInfo.symbol || 'Unknown';
      
      // Here you would implement the actual selling logic
      // This would involve calling a Solana transaction
      
      // For now, just show a confirmation message
      await ctx.reply(
        `✅ Transaction submitted!\n\n` +
        `You are selling ${percentage}% of your ${tokenSymbol}.\n\n` +
        `This feature is still under implementation for actual transactions.`
      );
      
      // Back to main menu
      return ctx.reply('Returning to main menu...');
    } catch (error) {
      logger.error(`Confirm sell error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
  
  bot.action(/alert_(.+)/, async (ctx) => {
    const tokenAddress = ctx.match[1];
    // Handle alert action
    await ctx.answerCbQuery();
    await ctx.reply(`Please enter the price target for your alert.`);
    // Here you would enter a scene for setting a price alert
  });
  
  bot.action('back_to_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery();
      // Redirect to refresh_data handler to show main menu
      return ctx.callbackQuery.data = 'refresh_data';
    } catch (error) {
      logger.error(`Back to menu error: ${error.message}`);
      return ctx.reply('Returning to main menu...');
    }
  });
  
  // Handle track token action
  bot.action(/track_(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const tokenAddress = ctx.match[1];
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo || {};
      const tokenSymbol = tokenInfo.symbol || '???';
      
      // Reply with confirmation
      return ctx.reply(
        `✅ Now tracking ${tokenSymbol}!\n\nYou'll be notified of significant price movements.`,
        {
          reply_markup: {
            inline_keyboard: [
              [Markup.button.callback('🔙 Back', 'refresh_data')]
            ]
          }
        }
      );
    } catch (error) {
      logger.error(`Track token error: ${error.message}`);
      return ctx.reply('Sorry, something went wrong. Please try again later.');
    }
  });
};

module.exports = { tokenInfoHandler, registerTokenHandlers, buyTokenHandler, sellTokenHandler }; 