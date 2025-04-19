/**
 * Configuration file for the Telegram Bot
 * This loads and exports environment variables
 */

require('dotenv').config({ path: __dirname + '/.env' });

module.exports = {
  // MongoDB connection string
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/main',
  
  // Extension DB connection
  EXTENSION_DB_URI: process.env.EXTENSION_DB_URI || 'mongodb://localhost:27017/extension',
  
  // Bot token
  BOT_TOKEN: process.env.BOT_TOKEN,
  
  // Bot name
  BOT_NAME: process.env.BOT_NAME || 'slbotnamehere',
  
  // Encryption key
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  
  // API Keys
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  
  // Other settings
  RATE_LIMIT_MS: 500, // Minimum time between user requests
  MAX_WALLETS_PER_USER: 6,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
}; 