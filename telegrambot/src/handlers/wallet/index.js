const { walletManagementHandler, refreshWalletsHandler } = require('./walletManagementHandler');
const { createNewWalletHandler, confirmNewWalletHandler } = require('./walletCreateHandler');
const { importWalletHandler, handleWalletTextInput } = require('./walletImportHandler');
const { walletSettingsHandler, exportKeyHandler, confirmExportHandler } = require('./walletSettingsHandler');

// Add wallet handler (placeholder for backward compatibility)
const addWalletHandler = async (ctx) => {
  return importWalletHandler(ctx);
};

// Register all wallet-related handlers
const registerWalletHandlers = (bot) => {
  // Wallet management menu
  bot.action('wallet_management', walletManagementHandler);
  bot.action('back_to_main_menu', ctx => {
    ctx.answerCbQuery().catch(e => {});
    return ctx.scene.enter('main_menu');
  });
  
  // Refresh wallets
  bot.action('refresh_wallets', refreshWalletsHandler);
  
  // Create new wallet flow
  bot.action('create_new_wallet', createNewWalletHandler);
  bot.action('confirm_new_wallet', confirmNewWalletHandler);
  
  // Import wallet flow
  bot.action('import_wallet', importWalletHandler);
  
  // Wallet settings
  bot.action('wallet_settings', walletSettingsHandler);
  
  // Export private key flow
  bot.action('export_private_key', exportKeyHandler);
  bot.action('confirm_export', confirmExportHandler);
  
  // Handle text messages for wallet operations (import, etc.)
  bot.on('text', (ctx, next) => {
    // Get user from context state if available
    const user = ctx.state?.user;
    
    // Only process text for wallet operations if user has wallet state
    if (user && user.state && (
      user.state === 'IMPORT_WALLET_WAITING_KEY'
    )) {
      return handleWalletTextInput(ctx);
    }
    
    // Pass to next middleware if not wallet-related
    return next();
  });
};

module.exports = {
  registerWalletHandlers,
  walletManagementHandler,
  addWalletHandler
}; 