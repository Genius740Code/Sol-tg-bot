const crypto = require('crypto');
const config = require('../../config/config');

// Encryption key cache to avoid repeatedly deriving the same key
let ENCRYPTION_KEY = null;

// Encryption algorithm - changed from AES-256-GCM to AES-128-GCM to work with 64-bit keys
const ALGORITHM = 'aes-128-gcm';

// Cache for frequently used operations
const operationCache = {
  encrypt: new Map(),
  decrypt: new Map(),
  cacheTTL: 5 * 60 * 1000, // 5 minutes cache TTL
  maxSize: 500, // Maximum number of items in cache
  lastCleanup: Date.now()
};

/**
 * Get or derive encryption key - modified to use 64-bit key (8 bytes)
 * @returns {Buffer} Encryption key
 */
const getEncryptionKey = () => {
  // Return cached key if available
  if (ENCRYPTION_KEY) return ENCRYPTION_KEY;
  
  const configKey = config.ENCRYPTION_KEY || 'default-encryption-key-that-needs-to-be-changed-in-prod';
  
  // Use a custom hash approach to create a 64-bit key (8 bytes)
  // For AES-128-GCM, we'll need to pad this to 16 bytes (128 bits)
  const hash = crypto.createHash('md5').update(configKey).digest();
  ENCRYPTION_KEY = Buffer.from(hash.slice(0, 16)); // Take first 16 bytes of MD5 hash
  return ENCRYPTION_KEY;
};

/**
 * Clean up operation cache to prevent memory leaks
 */
const cleanupCache = () => {
  const now = Date.now();
  
  // Only run cleanup once per minute at most
  if (now - operationCache.lastCleanup < 60000) return;
  
  // Clean encrypt cache
  if (operationCache.encrypt.size > operationCache.maxSize) {
    const keysToDelete = [];
    operationCache.encrypt.forEach((value, key) => {
      if (now - value.timestamp > operationCache.cacheTTL) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => operationCache.encrypt.delete(key));
  }
  
  // Clean decrypt cache
  if (operationCache.decrypt.size > operationCache.maxSize) {
    const keysToDelete = [];
    operationCache.decrypt.forEach((value, key) => {
      if (now - value.timestamp > operationCache.cacheTTL) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => operationCache.decrypt.delete(key));
  }
  
  operationCache.lastCleanup = now;
};

/**
 * Encrypt sensitive data with improved performance
 * @param {string} text - Text to encrypt
 * @returns {string} Encrypted data
 */
const encrypt = (text) => {
  try {
    // Skip encryption for empty values
    if (!text) return '';
    
    // Check cache first for frequently encrypted values (like placeholder keys)
    const cacheKey = typeof text === 'string' ? text.substring(0, 32) : '';
    if (cacheKey && operationCache.encrypt.has(cacheKey)) {
      const cached = operationCache.encrypt.get(cacheKey);
      if (cached.original === text) {
        return cached.result;
      }
    }
    
    // Get key once instead of calling function repeatedly
    const key = getEncryptionKey();
    
    // Generate a random initialization vector
    const iv = crypto.randomBytes(16);
    
    // Create cipher with key
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    // Encrypt the data
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get the authentication tag
    const authTag = cipher.getAuthTag();
    
    // Create result string
    const result = iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    
    // Cache the result for future use
    if (cacheKey) {
      operationCache.encrypt.set(cacheKey, {
        original: text,
        result,
        timestamp: Date.now()
      });
      
      // Cleanup cache if needed
      cleanupCache();
    }
    
    return result;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

/**
 * Decrypt sensitive data with improved performance
 * @param {string} encryptedData - Data to decrypt
 * @returns {string} Decrypted text
 */
const decrypt = (encryptedData) => {
  try {
    // Skip decryption for empty values
    if (!encryptedData) return '';
    
    // Check cache first
    if (operationCache.decrypt.has(encryptedData)) {
      return operationCache.decrypt.get(encryptedData).result;
    }
    
    // Split the encrypted data
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
    // Get key once
    const key = getEncryptionKey();
    
    // Create decipher with key
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    // Set authentication tag
    decipher.setAuthTag(authTag);
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // Cache the result
    operationCache.decrypt.set(encryptedData, {
      result: decrypted,
      timestamp: Date.now()
    });
    
    // Cleanup cache if needed
    cleanupCache();
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
};

module.exports = {
  encrypt,
  decrypt
}; 