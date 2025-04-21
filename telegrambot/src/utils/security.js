const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Settings } = require('../models/settings');
const logger = require('./logger');

/**
 * Security utility functions for the application
 */
class SecurityService {
  constructor() {
    this.encryptionKey = null;
    this.jwtSecret = null;
    this.jwtExpiry = '24h';
    this.initialized = false;
    this.rateLimits = new Map();
  }

  /**
   * Initialize the security service
   */
  async initialize() {
    try {
      // Load encryption key from settings
      this.encryptionKey = await Settings.getSetting('encryption_key');
      if (!this.encryptionKey) {
        logger.error('Encryption key not found in settings!');
        throw new Error('Missing encryption key');
      }

      // Convert to buffer if needed
      if (typeof this.encryptionKey === 'string') {
        // Check if already base64
        try {
          const decoded = Buffer.from(this.encryptionKey, 'base64');
          if (decoded.toString('base64') === this.encryptionKey) {
            this.encryptionKey = decoded;
          } else {
            // Generate a key from the string
            this.encryptionKey = crypto.scryptSync(this.encryptionKey, 'salt', 32);
          }
        } catch (err) {
          // Generate a key from the string
          this.encryptionKey = crypto.scryptSync(this.encryptionKey, 'salt', 32);
        }
      }

      // Load JWT secret
      this.jwtSecret = await Settings.getSetting('security_jwt_secret');
      if (!this.jwtSecret) {
        logger.warn('JWT secret not found in settings, generating new one.');
        this.jwtSecret = crypto.randomBytes(32).toString('hex');
        await Settings.setSetting('security_jwt_secret', this.jwtSecret, 'security', 'JWT secret for authentication', true, true);
      }

      // Load JWT expiry
      const expiry = await Settings.getSetting('security_jwt_expiry');
      if (expiry) {
        this.jwtExpiry = expiry;
      }

      this.initialized = true;
      logger.info('Security Service initialized successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize Security Service: ${error.message}`);
      return false;
    }
  }

  /**
   * Encrypt sensitive data
   * @param {string} text - Text to encrypt
   * @returns {string} Encrypted text (base64)
   */
  async encrypt(text) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      // Get the auth tag
      const authTag = cipher.getAuthTag();
      
      // Combine IV, encrypted data, and auth tag
      return Buffer.concat([
        iv,
        Buffer.from(encrypted, 'base64'),
        authTag
      ]).toString('base64');
    } catch (error) {
      logger.error(`Encryption error: ${error.message}`);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt encrypted data
   * @param {string} encryptedText - Encrypted text (base64)
   * @returns {string} Decrypted text
   */
  async decrypt(encryptedText) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // Convert from base64 to buffer
      const buffer = Buffer.from(encryptedText, 'base64');
      
      // Extract IV, encrypted data, and auth tag
      const iv = buffer.slice(0, 16);
      const authTag = buffer.slice(buffer.length - 16);
      const encryptedData = buffer.slice(16, buffer.length - 16);
      
      // Create decipher
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      
      // Decrypt
      let decrypted = decipher.update(encryptedData, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error(`Decryption error: ${error.message}`);
      throw new Error('Decryption failed');
    }
  }

  /**
   * Generate JWT token
   * @param {Object} payload - Token payload
   * @returns {string} JWT token
   */
  async generateToken(payload) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return jwt.sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiry });
    } catch (error) {
      logger.error(`Token generation error: ${error.message}`);
      throw new Error('Token generation failed');
    }
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token
   * @returns {Object} Decoded token payload
   */
  async verifyToken(token) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      logger.error(`Token verification error: ${error.message}`);
      throw new Error('Invalid token');
    }
  }

  /**
   * Generate secure random bytes
   * @param {number} length - Length of bytes
   * @returns {string} Random bytes in hexadecimal format
   */
  generateRandomBytes(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate secure hash
   * @param {string} data - Data to hash
   * @returns {string} Hashed data
   */
  hash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Rate limit checker
   * @param {string} key - Rate limit key (e.g. IP address, user ID)
   * @param {number} maxRequests - Maximum requests allowed
   * @param {number} timeWindow - Time window in milliseconds
   * @returns {boolean} true if rate limit exceeded, false otherwise
   */
  isRateLimited(key, maxRequests = 100, timeWindow = 3600000) {
    const now = Date.now();
    
    // Initialize rate limit entry if not exists
    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, { 
        count: 1, 
        firstRequest: now,
        lastRequest: now
      });
      return false;
    }
    
    const entry = this.rateLimits.get(key);
    
    // Reset if time window has passed
    if (now - entry.firstRequest > timeWindow) {
      entry.count = 1;
      entry.firstRequest = now;
      entry.lastRequest = now;
      return false;
    }
    
    // Update request count and time
    entry.count++;
    entry.lastRequest = now;
    
    // Check if rate limit exceeded
    if (entry.count > maxRequests) {
      logger.warn(`Rate limit exceeded for ${key}: ${entry.count} requests in ${timeWindow}ms`);
      return true;
    }
    
    return false;
  }

  /**
   * Clean up expired rate limit entries
   */
  cleanupRateLimits(maxAge = 3600000) {
    const now = Date.now();
    
    for (const [key, entry] of this.rateLimits.entries()) {
      if (now - entry.lastRequest > maxAge) {
        this.rateLimits.delete(key);
      }
    }
  }
}

// Create singleton instance
const securityService = new SecurityService();

// Schedule periodic cleanup
setInterval(() => {
  securityService.cleanupRateLimits();
}, 300000); // Clean up every 5 minutes

module.exports = securityService; 