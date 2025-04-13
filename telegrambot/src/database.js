const mongoose = require('mongoose');
const winston = require('winston');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

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
    winston.format.printf(info => {
      const { timestamp, level, message, ...rest } = info;
      const restString = Object.keys(rest).length ? JSON.stringify(rest) : '';
      return `${timestamp} ${level.toUpperCase()}: ${message} ${restString}`;
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
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      // Connection pool settings for better performance
      maxPoolSize: 20,
      minPoolSize: 5,
      maxIdleTimeMS: 60000,
      // Only use compatible options for current mongoose version
      heartbeatFrequencyMS: 30000,
      autoIndex: false, // Disable auto-indexing in production for performance
      autoCreate: false // Disable auto-creation for better control
    });
    
    logger.info('MongoDB Connected');
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
const dbCache = {
  data: new Map(),
  ttl: 60000, // 1 minute cache TTL
  lastCleanup: Date.now(),
  
  /**
   * Get cached query result
   * @param {string} key - Cache key
   * @returns {any|null} Cached value or null
   */
  get(key) {
    this.cleanup();
    const cached = this.data.get(key);
    if (cached && Date.now() < cached.expires) {
      return cached.value;
    }
    return null;
  },
  
  /**
   * Store value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} customTtl - Optional custom TTL in ms
   */
  set(key, value, customTtl = null) {
    const ttl = customTtl || this.ttl;
    this.data.set(key, {
      value,
      expires: Date.now() + ttl
    });
  },
  
  /**
   * Clean expired cache entries
   */
  cleanup() {
    const now = Date.now();
    
    // Only run cleanup once per minute
    if (now - this.lastCleanup < 60000) return;
    
    this.data.forEach((value, key) => {
      if (now > value.expires) {
        this.data.delete(key);
      }
    });
    
    this.lastCleanup = now;
  }
};

module.exports = { 
  connectDB: connectWithRetry, 
  mongoose, 
  logger,
  dbCache 
}; 