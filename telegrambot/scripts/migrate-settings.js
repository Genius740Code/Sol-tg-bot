const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { Settings } = require('../src/models/settings');

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../config/.env') });

// Connect to database
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/main');
    console.log('Connected to MongoDB');
    return true;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    return false;
  }
}

// Map of settings to migrate
const settingsToMigrate = [
  {
    key: 'helius_api_key',
    value: process.env.HELIUS_API_KEY,
    category: 'api',
    description: 'API key for Helius API service',
    isSensitive: true
  },
  {
    key: 'solana_rpc_url',
    value: 'https://api.mainnet-beta.solana.com',
    category: 'api',
    description: 'Solana RPC URL for blockchain interactions'
  },
  {
    key: 'bot_token',
    value: process.env.BOT_TOKEN,
    category: 'telegram',
    description: 'Telegram bot token',
    isSensitive: true
  },
  {
    key: 'bot_name',
    value: process.env.BOT_NAME || 'slbotnamehere',
    category: 'telegram',
    description: 'Telegram bot name'
  },
  {
    key: 'encryption_key',
    value: process.env.ENCRYPTION_KEY,
    category: 'security',
    description: 'Encryption key for sensitive data',
    isSensitive: true
  },
  {
    key: 'rate_limit_ms',
    value: 500,
    category: 'performance',
    description: 'Minimum time between user requests in milliseconds'
  },
  {
    key: 'max_wallets_per_user',
    value: 6,
    category: 'limits',
    description: 'Maximum number of wallets per user'
  },
  {
    key: 'log_level',
    value: process.env.LOG_LEVEL || 'info',
    category: 'logging',
    description: 'Application logging level (debug, info, warn, error)'
  },
  {
    key: 'cache_ttl_short',
    value: 60,
    category: 'cache',
    description: 'Short-term cache TTL in seconds'
  },
  {
    key: 'cache_ttl_medium',
    value: 300,
    category: 'cache',
    description: 'Medium-term cache TTL in seconds'
  },
  {
    key: 'cache_ttl_long',
    value: 3600,
    category: 'cache',
    description: 'Long-term cache TTL in seconds'
  },
  {
    key: 'security_api_rate_limit',
    value: 100,
    category: 'security',
    description: 'API rate limit per IP address per hour'
  },
  {
    key: 'security_jwt_secret',
    value: process.env.ENCRYPTION_KEY || require('crypto').randomBytes(32).toString('hex'),
    category: 'security',
    description: 'JWT secret for authentication',
    isSensitive: true
  },
  {
    key: 'security_jwt_expiry',
    value: '24h',
    category: 'security',
    description: 'JWT token expiry time'
  }
];

// Migrate settings
async function migrateSettings() {
  console.log('Starting settings migration...');
  
  try {
    let migratedCount = 0;
    
    for (const setting of settingsToMigrate) {
      if (setting.value === undefined || setting.value === null) {
        console.warn(`Skipping missing setting: ${setting.key}`);
        continue;
      }
      
      // Check if setting already exists
      const existingSetting = await Settings.findOne({ key: setting.key });
      
      if (existingSetting) {
        console.log(`Setting already exists: ${setting.key}`);
      } else {
        await Settings.create(setting);
        migratedCount++;
        console.log(`Migrated setting: ${setting.key}`);
      }
    }
    
    console.log(`Migration complete! Migrated ${migratedCount} settings.`);
  } catch (error) {
    console.error('Migration error:', error);
  }
}

// Run the migration
async function run() {
  const connected = await connectDB();
  
  if (connected) {
    await migrateSettings();
    console.log('Closing database connection...');
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Execute the script
run().catch(console.error); 