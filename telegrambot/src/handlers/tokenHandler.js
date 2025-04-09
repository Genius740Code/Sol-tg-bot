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
    
    // Get token address from message
    const message = ctx.message.text;
    const tokenAddress = message.trim();
    
    // Check if input is a valid Solana address format
    if (!tokenAddress.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      return ctx.reply('Please enter a valid Solana token address.');
    }
    
    await ctx.reply('⏳ Analyzing token, please wait...');
    
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
      tokenData.price;
    
    const marketCap = typeof tokenData.marketCap === 'number' ? 
      `$${tokenData.marketCap.toLocaleString()}` : 
      tokenData.marketCap;
    
    // Build response message
    let responseMessage = `🔍 *Token Analysis*\n\n`;
    responseMessage += `📛 *Name:* ${tokenName}\n`;
    responseMessage += `🔤 *Symbol:* ${tokenSymbol}\n`;
    responseMessage += `🏦 *Address:* \`${tokenAddress}\`\n`;
    responseMessage += `🔢 *Decimals:* ${tokenDecimals}\n\n`;
    responseMessage += `💲 *Price:* ${price}\n`;
    responseMessage += `💰 *Market Cap:* ${marketCap}\n`;
    responseMessage += `💧 *Liquidity:* ${tokenData.liquidity}\n\n`;
    
    // Add supply info if available
    if (tokenInfo.supply) {
      const totalSupply = parseInt(tokenInfo.supply.total) / Math.pow(10, tokenDecimals);
      responseMessage += `📊 *Total Supply:* ${totalSupply.toLocaleString()}\n\n`;
    }
    
    // Add links to explorers
    responseMessage += `🔗 *Links:*\n`;
    responseMessage += `• [Solscan](https://solscan.io/token/${tokenAddress})\n`;
    responseMessage += `• [SolanaFM](https://solana.fm/address/${tokenAddress})\n`;
    responseMessage += `• [Jupiter](https://jup.ag/swap/SOL-${tokenAddress})\n`;
    
    // Add action buttons
    const actionKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💰 Buy', `buy_${tokenAddress}`),
        Markup.button.callback('💸 Sell', `sell_${tokenAddress}`)
      ],
      [
        Markup.button.callback('📈 Set Price Alert', `alert_${tokenAddress}`),
        Markup.button.callback('🔙 Back', 'back_to_menu')
      ]
    ]);
    
    // Send response
    return ctx.reply(responseMessage, {
      parse_mode: 'Markdown',
      disable_web_page_preview: !imageUrl,
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
    // This would be a scene or wizard to handle the selling process
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
    
    // Send message with sell options
    const sellKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('25%', `confirm_sell_${tokenAddress}_25`),
        Markup.button.callback('50%', `confirm_sell_${tokenAddress}_50`)
      ],
      [
        Markup.button.callback('75%', `confirm_sell_${tokenAddress}_75`),
        Markup.button.callback('All', `confirm_sell_${tokenAddress}_100`)
      ],
      [Markup.button.callback('Custom Amount', `custom_sell_${tokenAddress}`)],
      [Markup.button.callback('🔙 Back', `token_info_${tokenAddress}`)]
    ]);
    
    return ctx.reply(
      `💸 *Sell ${tokenSymbol}*\n\n` +
      `Current Price: ${tokenPrice}\n\n` +
      `Trading Fee: ${normalFee}% (${referralFee}% with referral)\n\n` +
      `How much would you like to sell?`,
      {
        parse_mode: 'Markdown',
        ...sellKeyboard
      }
    );
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
    await ctx.answerCbQuery();
    // Return to main menu
    return ctx.reply('Returning to main menu...');
  });
};

module.exports = { tokenInfoHandler, registerTokenHandlers, buyTokenHandler, sellTokenHandler }; 