/**
 * Constants and configuration values for the Telegram bot
 */

// Fee configuration
const FEES = {
  NORMAL_PERCENTAGE: 0.8,          // Standard trading fee in percent
  REFERRAL_DISCOUNT: 11,           // Referral discount in percent
  get REFERRAL_PERCENTAGE() {
    return this.NORMAL_PERCENTAGE * (1 - this.REFERRAL_DISCOUNT/100);
  }
};

// Rate limiting
const RATE_LIMIT = {
  MAX_REQUESTS: 5,                 // Max requests per time window
  WINDOW_MS: 5000,                 // Time window in milliseconds
  COOLDOWN_MS: 3000                // Cooldown period after rate limit hit
};

// Wallet configuration
const WALLET = {
  DEFAULT_SOL_BALANCE: 0,          // Default SOL balance if can't be fetched
  DEFAULT_SOL_PRICE: 100,          // Default SOL price if can't be fetched
  MIN_BALANCE_THRESHOLD: 0.02,     // Minimum SOL needed for operations
  GAS_FEE_SOL: 0.000005            // Standard gas fee in SOL
};

// API service configuration
const API = {
  TIMEOUT_MS: 10000,              // API request timeout
  MAX_RETRIES: 3,                 // Number of retries for failed API calls
  RETRY_DELAY_MS: 1000            // Delay between retries
};

// Telegram message configuration
const MESSAGE = {
  PARSE_MODE: 'Markdown',         // Default parse mode
  DISABLE_WEB_PAGE_PREVIEW: true, // Disable link previews by default
  MAX_LENGTH: 4096,               // Maximum message length
  DEFAULT_REPLY_TIMEOUT: 60000    // Default timeout for awaitng replies
};

// Command related constants
const COMMANDS = {
  START: 'start',
  HELP: 'help',
  SELL: 'sell',
  SETTINGS: 'settings',
  POSITIONS: 'positions',
  ORDERS: 'orders',
  REFERRALS: 'referrals'
};

// Action command data
const ACTIONS = {
  REFRESH: 'refresh_data',
  BUY: 'buy_placeholder',
  SELL: 'sell_token',
  POSITIONS: 'view_positions',
  REFERRALS: 'view_referrals',
  LIMIT_ORDERS: 'view_limit_orders',
  COPY_TRADING: 'copy_trading_placeholder',
  WALLETS: 'wallet_management',
  SETTINGS: 'settings'
};

module.exports = {
  FEES,
  RATE_LIMIT,
  WALLET,
  API,
  MESSAGE,
  COMMANDS,
  ACTIONS
}; 