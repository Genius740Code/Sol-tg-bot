const { models, logger } = require('../database');
const { generateRandomString } = require('../utils/codeGenerator');

/**
 * Service for managing extension users
 */
class ExtensionService {
  /**
   * Create or update an extension user
   * @param {Object} userData - User data
   * @param {number} userData.telegramId - Telegram ID
   * @param {string} userData.username - Username
   * @returns {Promise<Object>} Created user with verification code
   */
  async createOrUpdateExtensionUser(userData) {
    try {
      const ExtensionUser = models.ExtensionUser();
      if (!ExtensionUser) {
        throw new Error('Extension database not initialized');
      }
      
      // Check if user exists in main User database
      const User = models.User();
      if (!User) {
        throw new Error('User database not initialized');
      }
      const mainUser = await User.findOne({ telegramId: userData.telegramId });
      if (!mainUser) {
        throw new Error('User not found in main database');
      }

      const { telegramId, username } = userData;
      
      // Generate a random verification code
      const verificationCode = await generateRandomString(40);
      
      // Calculate expiration time (5 minutes from now)
      const verificationCodeExpires = new Date(Date.now() + 5 * 60 * 1000);
      
      // Calculate auto logout date (7 days from now)
      const autoLogoutDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      // Find user by telegramId or create a new one
      const user = await ExtensionUser.findOneAndUpdate(
        { telegramId },
        { 
          telegramId,
          username,
          verificationCode,
          verificationCodeExpires,
          autoLogoutDate,
          lastLogin: new Date()
        },
        { upsert: true, new: true }
      );
      
      logger.info(`Extension user created/updated: ${telegramId}`);
      return user;
    } catch (error) {
      logger.error(`Error creating/updating extension user: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Verify a user with their verification code
   * @param {string} verificationCode - The verification code to check
   * @returns {Promise<Object|null>} The user object if verification successful, null otherwise
   */
  async verifyExtensionUser(verificationCode) {
    try {
      const ExtensionUser = models.ExtensionUser();
      if (!ExtensionUser) {
        throw new Error('Extension database not initialized');
      }
      
      // Find user by verification code
      const user = await ExtensionUser.findOne({ 
        verificationCode,
        verificationCodeExpires: { $gt: new Date() } // Check that code hasn't expired
      });
      
      if (user) {
        // Update last login time and auto logout date
        const now = new Date();
        user.lastLogin = now;
        
        // Set auto logout date to 7 days from now
        user.autoLogoutDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        
        // Clear the verification code after successful use
        user.verificationCode = null;
        user.verificationCodeExpires = null;
        
        await user.save();
        
        logger.info(`Extension user verified: ${user.telegramId}`);
        return user;
      }
      
      logger.warn(`Invalid or expired verification code: ${verificationCode}`);
      return null;
    } catch (error) {
      logger.error(`Error verifying extension user: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get user by telegram ID
   * @param {number} telegramId - Telegram ID
   * @returns {Promise<Object|null>} User object or null
   */
  async getExtensionUserByTelegramId(telegramId) {
    try {
      const ExtensionUser = models.ExtensionUser();
      if (!ExtensionUser) {
        throw new Error('Extension database not initialized');
      }
      
      return await ExtensionUser.findOne({ telegramId });
    } catch (error) {
      logger.error(`Error getting extension user: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Process auto logout for users who have been logged in for more than 7 days
   * @returns {Promise<number>} Number of users logged out
   */
  async processAutoLogouts() {
    try {
      const ExtensionUser = models.ExtensionUser();
      if (!ExtensionUser) {
        throw new Error('Extension database not initialized');
      }
      
      const now = new Date();
      
      // Find users who should be auto-logged out (autoLogoutDate has passed)
      const result = await ExtensionUser.updateMany(
        { 
          autoLogoutDate: { $lt: now },
          verificationCode: null // Only target logged in users (those who have used their code)
        },
        { 
          $set: {
            // Clear any stored session info and mark last logout date
            verificationCode: null,
            verificationCodeExpires: null,
            lastLogout: now
          }
        }
      );
      
      if (result.modifiedCount > 0) {
        logger.info(`Auto-logged out ${result.modifiedCount} users due to 7-day security policy`);
      }
      
      return result.modifiedCount;
    } catch (error) {
      logger.error(`Error during auto logout process: ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Update extension user settings
   * @param {number} telegramId - Telegram ID
   * @param {Object} settings - New settings
   * @returns {Promise<Object|null>} Updated user or null
   */
  async updateExtensionUserSettings(telegramId, settings) {
    try {
      const ExtensionUser = models.ExtensionUser();
      if (!ExtensionUser) {
        throw new Error('Extension database not initialized');
      }
      
      // First check if user exists in main database
      const User = models.User();
      if (!User) {
        throw new Error('User database not initialized');
      }
      
      const mainUser = await User.findOne({ telegramId });
      if (!mainUser) {
        logger.error(`User not found in main database: ${telegramId}`);
        return null;
      }
      
      // Synchronize settings with main user if needed
      await User.findOneAndUpdate(
        { telegramId },
        { $set: { 'settings.tradingSettings': settings.tradingSettings } }
      );
      
      // Update extension user settings
      return await ExtensionUser.findOneAndUpdate(
        { telegramId },
        { $set: { settings } },
        { new: true }
      );
    } catch (error) {
      logger.error(`Error updating extension user settings: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new ExtensionService(); 