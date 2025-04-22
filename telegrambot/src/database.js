const mongoose = require('mongoose');
const winston = require('winston');
const { createLogger, format, transports } = winston;
const path = require('path');
const fs = require('fs');
const config = require('../../config/config');
const { createExtensionUserModel } = require('./models/extension');
const { User } = require('./models/user');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configure Winston logger with daily rotation and better formatting
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }), // Include stack traces for errors
    winston.format.printf(info => {
      const { timestamp, level, message, stack, ...rest } = info;
      const restString = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
      const stackInfo = stack ? `\n${stack}` : '';
      return `${timestamp} ${level.toUpperCase()}: ${message}${stackInfo} ${restString}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ]
});

// Connection status tracking
let isConnecting = false;
let connectionRetries = 0;
const MAX_RETRIES = 10;
const INITIAL_RETRY_DELAY = 1000;

// Global variable to store the extension connection
let extensionConnection = null;
let ExtensionUser = null;

// Connection state tracking for better debugging
mongoose.connection.on('connected', () => {
  isConnecting = false;
  connectionRetries = 0;
  logger.info('MongoDB connected successfully');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection error: ${err}`);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected - attempting reconnection');
  
  // Only attempt to reconnect if we're not already connecting
  if (!isConnecting) {
    setTimeout(() => connectWithRetry(), 2000);
  }
});

// Properly handle application shutdown
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed through app termination');
    process.exit(0);
  } catch (err) {
    logger.error(`Error during shutdown: ${err.message}`);
    process.exit(1);
  }
});

/**
 * Connect to MongoDB with exponential backoff retry strategy
 * @param {number} retryNumber - Current retry attempt (internal use)
 * @returns {Promise<boolean>} Connection success status
 */
const connectWithRetry = async (retryNumber = 0) => {
  if (isConnecting) return false;
  
  isConnecting = true;
  connectionRetries = retryNumber;
  
  try {
    if (mongoose.connection.readyState === 1) {
      logger.info('Already connected to MongoDB');
      isConnecting = false;
      return true;
    }
    
    // Calculate delay with exponential backoff (1s, 2s, 4s, 8s...)
    const delay = retryNumber === 0 ? 0 : Math.min(INITIAL_RETRY_DELAY * Math.pow(2, retryNumber - 1), 30000);
    
    if (delay > 0) {
      logger.info(`Waiting ${delay}ms before connection attempt ${retryNumber + 1}/${MAX_RETRIES}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Configure MongoDB connection with optimized settings
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      // Connection pool settings for better performance
      maxPoolSize: 30, // Increased for better parallel processing
      minPoolSize: 5,
      maxIdleTimeMS: 60000,
      // Only use compatible options for current mongoose version
      heartbeatFrequencyMS: 30000,
      autoIndex: process.env.NODE_ENV !== 'production', // Disable auto-indexing in production for performance
      autoCreate: false, // Disable auto-creation for better control
      // Enable read preference secondary for better load balancing if using replica set
      ...(config.MONGODB_URI.includes('replicaSet') && { 
        readPreference: 'secondaryPreferred' 
      })
    });
    
    logger.info('MongoDB Connected to main database');
    
    // Connect to extension database
    extensionConnection = mongoose.createConnection(config.EXTENSION_DB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      maxPoolSize: 15, // Increased for better parallel processing
      minPoolSize: 2
    });
    
    extensionConnection.on('connected', () => {
      logger.info('MongoDB Connected to extension database');
      // Initialize the ExtensionUser model
      ExtensionUser = createExtensionUserModel(extensionConnection);
    });
    
    extensionConnection.on('error', (err) => {
      logger.error(`MongoDB extension database connection error: ${err}`);
    });
    
    isConnecting = false;
    return true;
  } catch (err) {
    logger.error(`MongoDB Connection Error: ${err.message}`);
    
    if (retryNumber < MAX_RETRIES) {
      isConnecting = false;
      return connectWithRetry(retryNumber + 1);
    } else {
      logger.error(`Failed to connect to MongoDB after ${MAX_RETRIES} attempts`);
      isConnecting = false;
      
      // In production, exit on connection failure
      if (process.env.NODE_ENV === 'production') {
        logger.error('Exiting application due to database connection failure');
        process.exit(1);
      }
      
      return false;
    }
  }
};

// Initialize database cache for common queries
const dbCache = (() => {
  const cacheMap = new Map();
  const ttlMap = new Map(); // Separate map for TTL tracking for better performance
  const stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    lastCleanup: Date.now()
  };
  
  // Set default TTL (1 minute)
  const DEFAULT_TTL = 60000;
  
  // Maximum cache size (items)
  const MAX_CACHE_SIZE = 500;
  
  return {
    stats,
    
    /**
     * Get cached query result
     * @param {string} key - Cache key
     * @returns {any|null} Cached value or null
     */
    get(key) {
      this.cleanupIfNeeded();
      
      const expiry = ttlMap.get(key);
      
      if (expiry && Date.now() < expiry) {
        stats.hits++;
        return cacheMap.get(key);
      }
      
      // If key exists but expired, delete it
      if (expiry) {
        cacheMap.delete(key);
        ttlMap.delete(key);
        stats.evictions++;
      }
      
      stats.misses++;
      return null;
    },
    
    /**
     * Store value in cache
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} customTtl - Optional custom TTL in ms
     */
    set(key, value, customTtl = null) {
      // Check if cache is full and needs eviction (LRU-like behavior)
      if (cacheMap.size >= MAX_CACHE_SIZE && !cacheMap.has(key)) {
        this.evictOldest();
      }
      
      const ttl = customTtl || DEFAULT_TTL;
      cacheMap.set(key, value);
      ttlMap.set(key, Date.now() + ttl);
    },
    
    /**
     * Clean expired cache entries if needed
     */
    cleanupIfNeeded() {
      const now = Date.now();
      
      // Only run cleanup once per minute to avoid performance hit
      if (now - stats.lastCleanup < 60000) return;
      
      let evicted = 0;
      ttlMap.forEach((expiry, key) => {
        if (now > expiry) {
          cacheMap.delete(key);
          ttlMap.delete(key);
          evicted++;
        }
      });
      
      stats.evictions += evicted;
      stats.lastCleanup = now;
      
      if (evicted > 0) {
        logger.debug(`Cache cleanup: removed ${evicted} expired items. Current size: ${cacheMap.size}`);
      }
    },
    
    /**
     * Evict oldest cache entry based on expiration
     */
    evictOldest() {
      let oldestKey = null;
      let oldestExpiry = Infinity;
      
      ttlMap.forEach((expiry, key) => {
        if (expiry < oldestExpiry) {
          oldestExpiry = expiry;
          oldestKey = key;
        }
      });
      
      if (oldestKey) {
        cacheMap.delete(oldestKey);
        ttlMap.delete(oldestKey);
        stats.evictions++;
      }
    },
    
    /**
     * Clear entire cache
     */
    clear() {
      cacheMap.clear();
      ttlMap.clear();
      stats.evictions = 0;
      stats.hits = 0;
      stats.misses = 0;
      logger.debug('Cache cleared');
    },
    
    /**
     * Get cache statistics
     */
    getStats() {
      return {
        ...stats,
        size: cacheMap.size,
        hitRatio: stats.hits / (stats.hits + stats.misses) || 0
      };
    }
  };
})();

module.exports = {
  connectDB: connectWithRetry,
  mongoose,
  logger,
  dbCache,
  closeConnection: async () => {
    try {
      // Close both connections properly
      const promises = [mongoose.connection.close()];
      if (extensionConnection && extensionConnection.readyState === 1) {
        promises.push(extensionConnection.close());
      }
      await Promise.all(promises);
      logger.info('All database connections closed');
      return true;
    } catch (err) {
      logger.error(`Error closing database connections: ${err.message}`);
      return false;
    }
  },
  extensionConnection: () => extensionConnection,
  models: {
    ExtensionUser: () => ExtensionUser,
    User: () => User
  },
  // Utility method to monitor database performance
  getDbStats: () => ({
    mainConnection: {
      readyState: mongoose.connection.readyState,
      collections: mongoose.connection.collections ? Object.keys(mongoose.connection.collections).length : 0
    },
    extensionConnection: extensionConnection ? {
      readyState: extensionConnection.readyState,
      collections: extensionConnection.collections ? Object.keys(extensionConnection.collections).length : 0
    } : null,
    cache: dbCache.getStats()
  })
}; 