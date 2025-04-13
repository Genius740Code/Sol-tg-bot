const { User, FEE_CONFIG } = require('../models/user');
const { generateWallet } = require('../../utils/wallet');
const { encrypt } = require('../../utils/encryption');
const { logger } = require('../database');
const walletUtils = require('../../utils/wallet');

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
    // Validate telegramUser has necessary fields
    if (!telegramUser || !telegramUser.id) {
      throw new Error('Invalid user data provided');
    }

    // Ensure telegramId is stored as string
    const telegramId = telegramUser.id.toString();

    // Check if user already exists to avoid duplicate creation
    const existingUser = await User.findOne({ telegramId });
    if (existingUser) {
      return existingUser;
    }

    // Check if referral code is valid
    let referredBy = null;
    if (referralCode) {
      // Check custom referral codes first
      const referrerWithCustomCode = await User.findOne({ 'customReferralCodes.code': referralCode });
      
      if (referrerWithCustomCode) {
        referredBy = referrerWithCustomCode.telegramId;
      } else {
        // Check default referral code
        const referrer = await User.findOne({ referralCode });
        if (referrer) {
          referredBy = referrer.telegramId;
        }
      }
    }

    // Generate wallet
    const wallet = await generateWallet();
    
    // Create new user with display name
    const displayName = telegramUser.first_name || telegramUser.username || `User_${telegramId.substring(0, 5)}`;
    
    // Generate a custom referral code to prevent null values
    const customReferralCode = `${telegramId.substring(0, 5)}_${Math.random().toString(36).substring(2, 8)}_${Date.now()}`;
    
    // Create new user
    const user = new User({
      telegramId: telegramId,
      username: telegramUser.username,
      displayName: displayName,
      walletAddress: wallet.publicKey, // For backward compatibility
      wallets: [{
        name: 'Main Wallet',
        address: wallet.publicKey,
        encryptedPrivateKey: encrypt(wallet.privateKey),
        mnemonic: wallet.mnemonic,
        isActive: true
      }],
      encryptedPrivateKey: encrypt(wallet.privateKey), // For backward compatibility
      mnemonic: wallet.mnemonic, // For backward compatibility
      referredBy,
      // Initialize customReferralCodes with at least one valid code
      customReferralCodes: [{
        code: customReferralCode,
        createdAt: new Date()
      }]
    });
    
    // Save the user with better error handling
    try {
      await user.save();
    } catch (saveError) {
      logger.error(`Failed to save user: ${saveError.message}`);
      
      // Try again if it's a duplicate key error with simpler data
      if (saveError.message.includes('duplicate key') || saveError.message.includes('E11000')) {
        logger.info(`Retrying user creation with simplified data for telegramId ${telegramId}`);
        
        // Create a simplified user with minimal data
        const simpleUser = new User({
          telegramId: telegramId,
          walletAddress: wallet.publicKey,
          encryptedPrivateKey: encrypt(wallet.privateKey),
          mnemonic: wallet.mnemonic,
          wallets: [{
            name: 'Main Wallet',
            address: wallet.publicKey,
            encryptedPrivateKey: encrypt(wallet.privateKey),
            mnemonic: wallet.mnemonic,
            isActive: true
          }],
          customReferralCodes: [] // Start with an empty array
        });
        
        await simpleUser.save();
        return simpleUser;
      }
      
      throw saveError;
    }
    
    // Update referrer's referrals list if exists
    if (referredBy) {
      await User.findOneAndUpdate(
        { telegramId: referredBy },
        { 
          $push: { 
            referrals: { 
              telegramId: telegramId,
              username: telegramUser.username,
              displayName: displayName,
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
    // Get user
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Generate new wallet
    const wallet = await generateWallet();
    
    // Add new wallet to user's wallets
    const walletName = `Wallet ${user.wallets.length + 1}`;
    
    // Set all wallets to inactive
    user.wallets.forEach(w => {
      w.isActive = false;
    });
    
    // Add new wallet with encrypted private key and mnemonic
    user.wallets.push({
      name: walletName,
      address: wallet.publicKey,
      encryptedPrivateKey: encrypt(wallet.privateKey),
      mnemonic: wallet.mnemonic,
      isActive: true
    });
    
    // Also update legacy fields for backward compatibility
    user.walletAddress = wallet.publicKey;
    user.encryptedPrivateKey = encrypt(wallet.privateKey);
    user.mnemonic = wallet.mnemonic;
    
    await user.save();
    
    return user;
  } catch (error) {
    logger.error(`Error generating new wallet: ${error.message}`);
    throw new Error('Failed to generate new wallet');
  }
};

/**
 * Update fee type for user
 * @param {number} telegramId - User's Telegram ID 
 * @param {string} feeType - Fee type (FAST or TURBO)
 * @returns {Promise<Object>} Updated user
 */
const updateFeeType = async (telegramId, feeType) => {
  try {
    if (!Object.keys(FEE_CONFIG).includes(feeType)) {
      throw new Error(`Invalid fee type: ${feeType}`);
    }
    
    const user = await User.findOneAndUpdate(
      { telegramId },
      { 'settings.tradingSettings.feeType': feeType },
      { new: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return user;
  } catch (error) {
    logger.error(`Error updating fee type: ${error.message}`);
    throw new Error(`Failed to update fee type: ${error.message}`);
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
      customReferralCodes: user.customReferralCodes || [],
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
 * @param {number} userId - User's Telegram ID
 * @param {string} privateKeyOrMnemonic - Private key or mnemonic phrase
 * @returns {Promise<Object>} Updated user
 */
const importWallet = async (userId, privateKeyOrMnemonic) => {
  try {
    // Validate the user first
    const user = await User.findOne({ telegramId: userId });
    if (!user) {
      throw new Error('User not found');
    }

    // Import the wallet using utility function
    const wallet = await walletUtils.importWalletFromPrivateKey(privateKeyOrMnemonic);
    
    // Add as a new wallet
    const walletName = `Wallet ${user.wallets.length + 1}`;
    
    // Set all wallets to inactive
    user.wallets.forEach(w => {
      w.isActive = false;
    });
    
    // Add new wallet with encrypted private key and mnemonic
    user.wallets.push({
      name: walletName,
      address: wallet.publicKey,
      encryptedPrivateKey: encrypt(wallet.privateKey),
      mnemonic: wallet.mnemonic ? wallet.mnemonic : null,
      isActive: true
    });
    
    // Update legacy fields for backward compatibility
    user.walletAddress = wallet.publicKey;
    user.encryptedPrivateKey = encrypt(wallet.privateKey);
    user.mnemonic = wallet.mnemonic || '';
    
    await user.save();

    return { publicKey: wallet.publicKey };
  } catch (error) {
    logger.error(`Error importing wallet for user ${userId}:`, error);
    throw new Error('Failed to import wallet: ' + error.message);
  }
};

/**
 * Add a custom referral code
 * @param {number} telegramId - User's Telegram ID
 * @param {string} code - Custom referral code
 * @returns {Promise<Object>} Updated user
 */
const addCustomReferralCode = async (telegramId, code) => {
  try {
    // Validate code format
    if (!code.match(/^[a-zA-Z0-9]{4,15}$/)) {
      throw new Error('Invalid code format. Code must be 4-15 alphanumeric characters.');
    }
    
    // Check if the code is already taken
    const existingUser = await User.findOne({
      $or: [
        { referralCode: code },
        { 'customReferralCodes.code': code }
      ]
    });
    
    if (existingUser) {
      throw new Error('This referral code is already taken.');
    }
    
    // Add the custom code
    const user = await User.findOneAndUpdate(
      { telegramId },
      { 
        $push: { 
          customReferralCodes: {
            code,
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return user;
  } catch (error) {
    logger.error(`Error adding custom referral code: ${error.message}`);
    throw error;
  }
};

/**
 * Update wallet name
 * @param {number} telegramId - User's Telegram ID
 * @param {string} address - Wallet address
 * @param {string} name - New wallet name
 * @returns {Promise<Object>} Updated user
 */
const updateWalletName = async (telegramId, address, name) => {
  try {
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Find the wallet index
    const walletIndex = user.wallets.findIndex(w => w.address === address);
    
    if (walletIndex === -1) {
      throw new Error('Wallet not found');
    }
    
    // Update using MongoDB's positional operator
    await User.updateOne(
      { telegramId, 'wallets.address': address },
      { $set: { [`wallets.${walletIndex}.name`]: name } }
    );
    
    // Fetch updated user
    const updatedUser = await User.findOne({ telegramId });
    return updatedUser;
  } catch (error) {
    logger.error(`Error updating wallet name: ${error.message}`);
    throw error;
  }
};

/**
 * Set active wallet
 * @param {number} telegramId - User's Telegram ID
 * @param {string} address - Wallet address to set as active
 * @returns {Promise<Object>} Updated user
 */
const setActiveWallet = async (telegramId, address) => {
  try {
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Set active wallet
    user.setActiveWallet(address);
    
    // Update legacy wallet address for backward compatibility
    user.walletAddress = address;
    const activeWallet = user.wallets.find(w => w.address === address);
    if (activeWallet) {
      user.encryptedPrivateKey = activeWallet.encryptedPrivateKey;
      user.mnemonic = activeWallet.mnemonic;
    }
    
    await user.save();
    
    return user;
  } catch (error) {
    logger.error(`Error setting active wallet: ${error.message}`);
    throw error;
  }
};

/**
 * Get all user wallets
 * @param {number} telegramId - User's Telegram ID
 * @returns {Promise<Array>} User wallets
 */
const getUserWallets = async (telegramId) => {
  try {
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return user.wallets || [];
  } catch (error) {
    logger.error(`Error getting user wallets: ${error.message}`);
    throw error;
  }
};

/**
 * Get active wallet
 * @param {number} telegramId - User's Telegram ID
 * @returns {Promise<Object>} Active wallet
 */
const getActiveWallet = async (telegramId) => {
  try {
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return user.getActiveWallet();
  } catch (error) {
    logger.error(`Error getting active wallet: ${error.message}`);
    throw error;
  }
};

/**
 * Get user fee information
 * @param {number} telegramId - User's Telegram ID
 * @returns {Promise<Object>} Fee information
 */
const getUserFeeInfo = async (telegramId) => {
  try {
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    const feeType = user.settings?.tradingSettings?.feeType || 'FAST';
    const feePercentage = user.getFeePercentage();
    const discountedFee = user.getReferralDiscount();
    const hasReferral = !!user.referredBy;
    
    return {
      feeType,
      baseFee: feePercentage,
      discountedFee,
      hasReferral,
      discount: hasReferral ? 11 : 0 // 11% discount
    };
  } catch (error) {
    logger.error(`Error getting user fee info: ${error.message}`);
    throw error;
  }
};

/**
 * Update main referral code
 * @param {number} telegramId - User's Telegram ID
 * @param {string} code - New referral code
 * @returns {Promise<Object>} Updated user
 */
const updateReferralCode = async (telegramId, code) => {
  try {
    // Validate code format
    if (!code.match(/^[a-zA-Z0-9]{4,15}$/)) {
      throw new Error('Invalid code format. Code must be 4-15 alphanumeric characters.');
    }
    
    // Check if the code is already taken
    const existingUser = await User.findOne({
      $or: [
        { referralCode: code },
        { 'customReferralCodes.code': code }
      ]
    });
    
    if (existingUser) {
      throw new Error('This referral code is already taken.');
    }
    
    // Update the main referral code
    const user = await User.findOneAndUpdate(
      { telegramId },
      { referralCode: code },
      { new: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return user;
  } catch (error) {
    logger.error(`Error updating referral code: ${error.message}`);
    throw error;
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
  importWallet,
  addCustomReferralCode,
  updateReferralCode,
  updateWalletName,
  setActiveWallet,
  getUserWallets,
  getActiveWallet,
  updateFeeType,
  getUserFeeInfo,
  FEE_CONFIG
}; 