const { User } = require('../../models/User');
const { generateWallet } = require('../../utils/wallet');
const { encrypt } = require('../../utils/encryption');
const { logger } = require('../database');

/**
 * Get user by Telegram ID
 * @param {number} telegramId - User's Telegram ID
 * @returns {Promise<Object>} User object
 */
const getUserByTelegramId = async (telegramId) => {
  try {
    return await User.findOne({ telegramId });
  } catch (error) {
    logger.error(`Error getting user by Telegram ID: ${error.message}`);
    throw new Error('Failed to get user');
  }
};

/**
 * Create a new user
 * @param {Object} telegramUser - User data from Telegram
 * @param {string} referralCode - Optional referral code
 * @returns {Promise<Object>} Created user object
 */
const createUser = async (telegramUser, referralCode = null) => {
  try {
    // Check if referral code is valid
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        referredBy = referrer.telegramId;
      }
    }

    // Generate wallet
    const wallet = await generateWallet();
    
    // Create new user
    const user = new User({
      telegramId: telegramUser.id,
      username: telegramUser.username,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      walletAddress: wallet.publicKey,
      encryptedPrivateKey: encrypt(wallet.privateKey),
      mnemonic: wallet.mnemonic,
      referredBy
    });
    
    await user.save();
    
    // Update referrer's referrals list if exists
    if (referredBy) {
      await User.findOneAndUpdate(
        { telegramId: referredBy },
        { 
          $push: { 
            referrals: { 
              telegramId: telegramUser.id,
              username: telegramUser.username,
              firstName: telegramUser.first_name,
              joinedAt: new Date()
            } 
          } 
        }
      );
    }
    
    return user;
  } catch (error) {
    logger.error(`Error creating user: ${error.message}`);
    throw new Error('Failed to create user');
  }
};

/**
 * Update user activity timestamp
 * @param {number} telegramId - User's Telegram ID
 * @returns {Promise<void>}
 */
const updateUserActivity = async (telegramId) => {
  try {
    await User.findOneAndUpdate(
      { telegramId },
      { lastActivity: new Date() }
    );
  } catch (error) {
    logger.error(`Error updating user activity: ${error.message}`);
    // Don't throw, just log
  }
};

/**
 * Update user settings
 * @param {number} telegramId - User's Telegram ID
 * @param {Object} settings - Updated settings object
 * @returns {Promise<Object>} Updated user
 */
const updateSettings = async (telegramId, settings) => {
  try {
    const user = await User.findOneAndUpdate(
      { telegramId },
      { settings },
      { new: true }
    );
    return user;
  } catch (error) {
    logger.error(`Error updating settings: ${error.message}`);
    throw new Error('Failed to update settings');
  }
};

/**
 * Update specific user settings fields
 * @param {number} telegramId - User's Telegram ID
 * @param {Object} fields - Fields to update
 * @returns {Promise<Object>} Updated user
 */
const updateUserSettings = async (telegramId, fields) => {
  try {
    const user = await User.findOneAndUpdate(
      { telegramId },
      { $set: fields },
      { new: true }
    );
    return user;
  } catch (error) {
    logger.error(`Error updating user settings: ${error.message}`);
    throw new Error('Failed to update user settings');
  }
};

/**
 * Generate a new wallet for existing user
 * @param {number} telegramId - User's Telegram ID
 * @returns {Promise<Object>} Updated user
 */
const generateNewWallet = async (telegramId) => {
  try {
    // Generate new wallet
    const wallet = await generateWallet();
    
    // Update user
    const user = await User.findOneAndUpdate(
      { telegramId },
      { 
        walletAddress: wallet.publicKey,
        encryptedPrivateKey: encrypt(wallet.privateKey),
        mnemonic: wallet.mnemonic
      },
      { new: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return user;
  } catch (error) {
    logger.error(`Error generating new wallet: ${error.message}`);
    throw new Error('Failed to generate new wallet');
  }
};

/**
 * Get user's referral info
 * @param {number} telegramId - User's Telegram ID
 * @returns {Promise<Object>} Referral info
 */
const getReferralInfo = async (telegramId) => {
  try {
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return {
      referralCode: user.referralCode,
      referralCount: user.referrals ? user.referrals.length : 0,
      referrals: user.referrals || []
    };
  } catch (error) {
    logger.error(`Error getting referral info: ${error.message}`);
    throw new Error('Failed to get referral information');
  }
};

/**
 * Import wallet from private key or mnemonic
 * @param {number} telegramId - User's Telegram ID
 * @param {string} privateKeyOrMnemonic - Private key or mnemonic phrase
 * @returns {Promise<Object>} Updated user
 */
const importWallet = async (telegramId, privateKeyOrMnemonic) => {
  try {
    // Implementation will depend on your wallet utility functions
    // This is a placeholder that would need to be completed
    
    // Here you would:
    // 1. Determine if input is private key or mnemonic
    // 2. Generate wallet from it
    // 3. Update user record
    
    logger.error('Wallet import not fully implemented');
    throw new Error('Wallet import functionality not implemented');
  } catch (error) {
    logger.error(`Error importing wallet: ${error.message}`);
    throw new Error('Failed to import wallet');
  }
};

module.exports = {
  getUserByTelegramId,
  createUser,
  updateUserActivity,
  updateSettings,
  updateUserSettings,
  generateNewWallet,
  getReferralInfo,
  importWallet
}; 