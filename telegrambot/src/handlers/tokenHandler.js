const { getTokenInfo, getTokenPrice, isRateLimited, getSolPrice } = require('../../utils/wallet');
const { Markup } = require('telegraf');
const { logger } = require('../database');
const axios = require('axios');
const userService = require('../services/userService');
const { MESSAGE } = require('../../utils/constants');

// Helper function to escape special characters for MarkdownV2
const escapeMarkdown = (text) => {
  if (!text) return '';
  return text.toString().replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
};

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
    
    // Escape special characters for MarkdownV2
    const escapedTokenName = escapeMarkdown(tokenName);
    const escapedTokenSymbol = escapeMarkdown(tokenSymbol);
    const escapedTokenAddress = escapeMarkdown(tokenAddress);
    const escapedPrice = escapeMarkdown(price);
    const escapedMarketCap = escapeMarkdown(marketCap);
    const escapedLiquidity = escapeMarkdown(liquidity);
    
    // Build response message with proper escaping for MarkdownV2
    let responseMessage = `🔍 *Token Analysis*\n\n`;
    responseMessage += `📛 *Name:* ${escapedTokenName}\n`;
    responseMessage += `🔤 *Symbol:* ${escapedTokenSymbol}\n`;
    responseMessage += `🏦 *Address:* \`${escapedTokenAddress}\`\n`;
    responseMessage += `🔢 *Decimals:* ${tokenDecimals}\n\n`;
    responseMessage += `💲 *Price:* ${escapedPrice}\n`;
    responseMessage += `💰 *Market Cap:* ${escapedMarketCap}\n`;
    responseMessage += `💧 *Liquidity:* ${escapedLiquidity}\n\n`;
    
    // Add supply info if available
    if (tokenInfo.supply) {
      const totalSupply = parseInt(tokenInfo.supply.total) / Math.pow(10, tokenDecimals);
      const escapedSupply = escapeMarkdown(totalSupply.toLocaleString());
      responseMessage += `📊 *Total Supply:* ${escapedSupply}\n\n`;
    }
    
    // Check if token is verified/renounced
    const isRenounced = tokenInfo.isRenounced || false;
    responseMessage += `${isRenounced ? '✅ Renounced' : '⚠️ Not Renounced'}\n\n`;
    
    // Add links to explorers - URLs don't need to be escaped in MarkdownV2
    responseMessage += `🔗 *Links:*\n`;
    responseMessage += `• [Chart](https://dexscreener.com/solana/${tokenAddress})\n`;
    responseMessage += `• [Solscan](https://solscan.io/token/${tokenAddress})\n`;
    responseMessage += `• [Jupiter](https://jup.ag/swap/SOL\\-${tokenAddress})\n`;
    
    // Create referral link - must properly escape hyphens
    const refLink = `https://t.me/sol\\_trojanbot?start=r\\-${ctx.from.username}\\-${tokenAddress}`;
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
    
    // Send response with MarkdownV2 format
    return ctx.reply(responseMessage, {
      parse_mode: MESSAGE.PARSE_MODE,
      disable_web_page_preview: MESSAGE.DISABLE_WEB_PAGE_PREVIEW,
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
    // If no tokenAddress provided, prompt for token address
    if (!tokenAddress) {
      return ctx.reply(
        `Please send a token address.`,
        {
          parse_mode: 'Markdown',
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback('0.1 SOL', `confirm_buy_${tokenAddress}_0.1`),
              Markup.button.callback('0.2 SOL', `confirm_buy_${tokenAddress}_0.2`)
            ],
            [
              Markup.button.callback('0.5 SOL', `confirm_buy_${tokenAddress}_0.5`),
              Markup.button.callback('1 SOL', `confirm_buy_${tokenAddress}_1`)
            ],
            [
              Markup.button.callback('Custom Amount', `custom_buy_${tokenAddress}`)
            ],
            [
              Markup.button.callback('🔙 Back', 'refresh_data')
            ]
          ])
        }
      );
    }
    
    // If tokenAddress is provided, get token info
    const tokenData = await getTokenPrice(tokenAddress);
    const tokenInfo = tokenData.tokenInfo;
    const tokenSymbol = tokenInfo.symbol || 'Unknown';
    const tokenPrice = typeof tokenData.price === 'number' ? 
      `$${tokenData.price.toFixed(4)}` : 'Unknown';
    
    // Format market cap
    const marketCap = typeof tokenData.marketCap === 'number' ? 
      `$${tokenData.marketCap.toLocaleString()}` : 'Unknown';
    
    // Calculate fee (0.8% normal, 0.712% with referral - 11% discount)
    const normalFee = 0.8;
    const referralFee = normalFee * 0.89; // 11% less
    
    return ctx.reply(
      `💰 *Buy ${tokenSymbol}*\n\n` +
      `Current Price: ${tokenPrice}\n` +
      `Market Cap: ${marketCap}\n\n` +
      `Trading Fee: ${normalFee}% (${referralFee}% with referral)\n\n` +
      `Enter token CA:`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [
            Markup.button.callback('0.1 SOL', `confirm_buy_${tokenAddress}_0.1`),
            Markup.button.callback('0.2 SOL', `confirm_buy_${tokenAddress}_0.2`)
          ],
          [
            Markup.button.callback('0.5 SOL', `confirm_buy_${tokenAddress}_0.5`),
            Markup.button.callback('1 SOL', `confirm_buy_${tokenAddress}_1`)
          ],
          [
            Markup.button.callback('Custom Amount', `custom_buy_${tokenAddress}`)
          ],
          [
            Markup.button.callback('🔙 Back', 'refresh_data')
          ]
        ])
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
    // Get user
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
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
    
    // Get user token balance - this would be implemented in your wallet utils
    const tokenBalance = await getUserTokenBalance(user.getActiveWallet().address, tokenAddress);
    const tokenValueUsd = tokenBalance * price;
    
    // Get SOL price for conversion
    const solPrice = await getSolPrice();
    
    // Create links
    const dexScreenerLink = `https://dexscreener.com/solana/${tokenAddress}`;
    
    // Build message
    let message = `💸 *Sell ${tokenSymbol}*\n\n`;
    message += `Token: ${tokenName} (${tokenSymbol})\n`;
    message += `Address: \`${tokenAddress}\`\n\n`;
    
    message += `Your Balance: ${tokenBalance.toFixed(6)} ${tokenSymbol}\n`;
    message += `Value: $${tokenValueUsd.toFixed(2)} (${(tokenValueUsd / solPrice).toFixed(4)} SOL)\n\n`;
    
    message += `Current Price: $${price.toFixed(8)}\n`;
    message += `Liquidity: ${liquidity}\n`;
    message += `Market Cap: ${marketCap}\n\n`;
    
    message += `Select amount to sell:`;
    
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

// Helper function to get user token balance (placeholder)
const getUserTokenBalance = async (walletAddress, tokenAddress) => {
  // This would be implemented to fetch actual token balance
  // For now return a small random amount
  return Math.random() * 100 + 10;
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
      const amount = parseFloat(ctx.match[2]);
      
      // Get user
      const user = await userService.getUserByTelegramId(ctx.from.id);
      if (!user) {
        return ctx.reply('You need to start the bot first with /start');
      }
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo;
      const tokenSymbol = tokenInfo.symbol || 'Unknown';
      
      // Calculate fee based on amount
      const feeInfo = await userService.getUserFeeInfo(ctx.from.id);
      const feePercentage = feeInfo.hasReferral ? feeInfo.discountedFee : feeInfo.baseFee;
      const feeAmount = amount * feePercentage;
      
      // Record the trade for referral tracking
      if (feeInfo.hasReferral) {
        await userService.recordReferralTrade(ctx.from.id, amount, feeAmount);
      }
      
      // Here you would implement the actual buying logic
      // This would involve calling a Solana transaction
      
      // Escape special characters for MarkdownV2
      const escapedSymbol = escapeMarkdown(tokenSymbol);
      
      // For now, just show a confirmation message
      return ctx.reply(
        `✅ Transaction submitted\\!\n\n` +
        `You are buying ${escapedSymbol} with ${amount} SOL\\.\n\n` +
        `Fee: ${feeAmount.toFixed(6)} SOL ${feeInfo.hasReferral ? '\\(includes referral discount\\)' : ''}\n\n` +
        `This feature is still under implementation for actual transactions\\.`,
        {
          parse_mode: MESSAGE.PARSE_MODE,
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
          ])
        }
      );
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
      const percentage = parseInt(ctx.match[2]);
      
      // Get user
      const user = await userService.getUserByTelegramId(ctx.from.id);
      if (!user) {
        return ctx.reply('You need to start the bot first with /start');
      }
      
      // Get token info
      const tokenData = await getTokenPrice(tokenAddress);
      const tokenInfo = tokenData.tokenInfo;
      const tokenSymbol = tokenInfo.symbol || 'Unknown';
      
      // Get user token balance
      const walletAddress = user.getActiveWallet().address;
      const tokenBalance = await getUserTokenBalance(walletAddress, tokenAddress);
      const sellAmount = tokenBalance * (percentage / 100);
      
      // Calculate SOL value of the sell
      const price = tokenData.price || 0;
      const solPrice = await getSolPrice();
      const solValue = (price * sellAmount) / solPrice;
      
      // Calculate fee based on SOL value
      const feeInfo = await userService.getUserFeeInfo(ctx.from.id);
      const feePercentage = feeInfo.hasReferral ? feeInfo.discountedFee : feeInfo.baseFee;
      const feeAmount = solValue * feePercentage;
      
      // Record the trade for referral tracking
      if (feeInfo.hasReferral) {
        await userService.recordReferralTrade(ctx.from.id, solValue, feeAmount);
      }
      
      // Escape special characters for MarkdownV2
      const escapedSymbol = escapeMarkdown(tokenSymbol);
      
      // Here you would implement the actual selling logic
      // This would involve calling a Solana transaction
      
      // For now, just show a confirmation message
      return ctx.reply(
        `✅ Transaction submitted\\!\n\n` +
        `You are selling ${percentage}\\% of your ${escapedSymbol} tokens \\(${sellAmount.toFixed(6)} ${escapedSymbol}\\)\\.\n\n` +
        `Value: ${solValue.toFixed(6)} SOL\n` +
        `Fee: ${feeAmount.toFixed(6)} SOL ${feeInfo.hasReferral ? '\\(includes referral discount\\)' : ''}\n\n` +
        `This feature is still under implementation for actual transactions\\.`,
        {
          parse_mode: MESSAGE.PARSE_MODE,
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back to Menu', 'refresh_data')]
          ])
        }
      );
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