/**
 * Constants and configuration values for the Telegram bot
 */

// Fee configuration
const FEES = {
  NORMAL_PERCENTAGE: 1.0,          // Standard trading fee in percent
  REFERRAL_DISCOUNT: 11,           // Referral discount in percent
  TIER1_PERCENTAGE: 30,            // Tier 1 referral earning (30% of Nova's fee)
  TIER2_PERCENTAGE: 5,             // Tier 2 referral earning (5% of Nova's fee)
  TIER3_PERCENTAGE: 3,             // Tier 3 referral earning (3% of Nova's fee)
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
  MIN_BALANCE_THRESHOLD: 0.002,    // Minimum SOL needed for operations
  GAS_FEE_SOL: 0.0005,             // Standard gas fee in SOL
  MAX_PRIVATE_KEY_ATTEMPTS: 3      // Max attempts to decrypt private key
};

// API service configuration
const API = {
  TIMEOUT_MS: 15000,               // API request timeout (increased from 10s)
  MAX_RETRIES: 5,                  // Number of retries for failed API calls (increased from 3)
  RETRY_DELAY_MS: 2000,            // Delay between retries (increased from 1s)
  CACHE_DURATION_MS: 300000,       // Cache duration for API responses (5 minutes)
  ALTERNATIVE_PROVIDERS: true      // Whether to use alternative API providers on failure
};

// Telegram message configuration
const MESSAGE = {
  PARSE_MODE: 'Markdown',        // Use standard Markdown instead of MarkdownV2 for compatibility
  DISABLE_WEB_PAGE_PREVIEW: true,  // Disable link previews by default
  MAX_LENGTH: 4096,                // Maximum message length
  DEFAULT_REPLY_TIMEOUT: 60000     // Default timeout for awaiting replies
};

// Security configuration
const SECURITY = {
  SESSION_TIMEOUT_MS: 1800000,     // User session timeout (30 minutes)
  MAX_LOGIN_ATTEMPTS: 5,           // Maximum login attempts before temporary ban
  TEMP_BAN_DURATION_MS: 900000,    // Temporary ban duration (15 minutes)
  LOG_SENSITIVE_INFO: true         // Whether to log sensitive information (enabled for debugging)
};

// Command related constants
const COMMANDS = {
  START: 'start',
  HELP: 'help',
  SELL: 'sell',
  SETTINGS: 'settings',
  POSITIONS: 'positions',
  ORDERS: 'orders',
  REFERRALS: 'referrals',
  WALLETS: 'wallets'
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
  SECURITY,
  COMMANDS,
  ACTIONS
}; 