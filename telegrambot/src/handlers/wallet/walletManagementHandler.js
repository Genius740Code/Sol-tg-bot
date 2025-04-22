const { Markup } = require('telegraf');
const userService = require('../../services/userService');
const { logger } = require('../../database');
const { getSolBalance, getSolPrice } = require('../../../utils/wallet');

// Wallet management handler
const walletManagementHandler = async (ctx) => {
  try {
    // Get user and their wallets
    const user = await userService.getUserByTelegramId(ctx.from.id);
    
    if (!user) {
      return ctx.reply('You need to start the bot first with /start');
    }
    
    const wallets = user.wallets || [];
    const activeWallet = user.getActiveWallet ? user.getActiveWallet() : (wallets.length > 0 ? wallets.find(w => w.isActive) : null);
    
    // Fetch SOL price
    const solPrice = await getSolPrice();
    
    // Get balances for all wallets
    const walletsWithBalances = await Promise.all(wallets.map(async (wallet) => {
      const balance = await getSolBalance(wallet.address);
      const valueUsd = balance * solPrice;
      return {
        ...wallet.toObject ? wallet.toObject() : wallet,
        balance,
        valueUsd
      };
    }));
    
    // Create wallet display message
    let message = `💳 *Your Solana Wallets:*\n\n`;
    
    if (walletsWithBalances.length === 0) {
      message += `You don't have any wallets yet. Create a new wallet to get started.`;
    } else {
      // List all wallets with balances
      walletsWithBalances.forEach(wallet => {
        // Mark active wallet as default
        const isDefault = wallet.isActive ? ' (Default)' : '';
        const balanceText = `${wallet.balance.toFixed(6)} SOL ($${wallet.valueUsd.toFixed(2)} USD)`;
        
        // Add a distinguishing arrow for the default wallet
        const defaultArrow = wallet.isActive ? '→ ' : '• ';
        
        message += `${defaultArrow}${wallet.name}${isDefault} - ${balanceText}\n`;
        message += `\`${wallet.address}\`\n\n`;
      });
      
      message += `🔒 Tip: Keep your wallets secure by setting a Security Pin.`;
    }
    
    // Create wallet buttons
    const buttons = [];
    
    // First row - Main wallet actions
    buttons.push([
      Markup.button.callback('🆕 Create Wallet', 'create_new_wallet'),
      Markup.button.callback('📥 Import Wallet', 'import_wallet')
    ]);
    
    // Only show these buttons if user has at least one wallet
    if (wallets.length > 0) {
      // Second row - Management
      buttons.push([
        Markup.button.callback('🔁 Switch Wallet', 'switch_wallet'),
        Markup.button.callback('✏️ Rename Wallet', 'rename_wallet')
      ]);
      
      // Third row - Security & Export
      buttons.push([
        Markup.button.callback('🔑 Export Private Key', 'export_private_key'),
        Markup.button.callback('🗑️ Delete Wallet', 'delete_wallet')
      ]);
      
      // Fourth row - Withdrawals & security
      buttons.push([
        Markup.button.callback('📤 Withdraw SOL', 'withdraw_sol'),
        Markup.button.callback('🔄 Refresh', 'refresh_wallets')
      ]);
    }
    
    // Back button
    buttons.push([
      Markup.button.callback('⬅️ Back to Menu', 'back_to_main_menu')
    ]);
    
    return ctx.reply(message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  } catch (error) {
    logger.error(`Wallet management error: ${error.message}`);
    return ctx.reply('❌ Sorry, there was an error. Please try again later.');
  }
};

// Refresh wallets handler
const refreshWalletsHandler = async (ctx) => {
  try {
    await ctx.answerCbQuery('Refreshing wallet data...');
    return walletManagementHandler(ctx);
  } catch (error) {
    logger.error(`Refresh wallets error: ${error.message}`);
    return ctx.reply('❌ Sorry, there was an error refreshing. Please try again.');
  }
};

module.exports = {
  walletManagementHandler,
  refreshWalletsHandler
}; 