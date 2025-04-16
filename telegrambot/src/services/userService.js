const { User, FEE_CONFIG } = require('../models/user');
const { generateWallet } = require('../../utils/wallet');
const { encrypt } = require('../../utils/encryption');
const { logger } = require('../database');
const walletUtils = require('../../utils/wallet');
const { SECURITY } = require('../../utils/constants');

// Helper function to sanitize inputs for security
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  
  // Remove potential XSS or injection patterns
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .trim();
};

// Helper to avoid logging sensitive data
const logSafeUserData = (user) => {
  if (!user) return 'null';
  if (SECURITY.LOG_SENSITIVE_INFO === false) {
    // Only log non-sensitive fields
    return {
      telegramId: user.telegramId,
      username: user.username ? `${user.username.substring(0, 3)}...` : null,
      hasWallet: !!user.walletAddress,
      walletCount: user.wallets ? user.wallets.length : 0,
      referralCount: user.referrals ? user.referrals.length : 0,
      joinedAt: user.joinedAt
    };
  }
  return user;
};

/**
 * Get user by Telegram ID
 * @param {number} telegramId - User's Telegram ID
 * @returns {Promise<Object>} User object
 */
const getUserByTelegramId = async (telegramId) => {
  try {
    const user = await User.findOne({ telegramId });
    logger.debug(`Retrieved user: ${logSafeUserData(user)}`);
    return user;
  } catch (error) {
    logger.error(`Error getting user by Telegram ID: ${error.message}`);
    throw new Error('Failed to get user');
  }
};

/**
 * Track referral tiers when a new user is referred
 * This updates the referral chain up to Tier 3
 * @param {string} referrerId - Telegram ID of the referrer
 * @param {string} newUserId - Telegram ID of the new user
 */
const updateReferralTiers = async (referrerId, newUserId) => {
  try {
    if (!referrerId || !newUserId) return;
    
    // Get the referrer
    const referrer = await User.findOne({ telegramId: referrerId });
    if (!referrer) return;
    
    // Update Tier 1 stats (direct referral)
    await User.updateOne(
      { telegramId: referrerId },
      { 
        $inc: { 
          'referralStats.tier1.users': 1 
        },
        $push: {
          'referralTransactions': {
            type: 'new_referral',
            tier: 1,
            referredUser: newUserId,
            timestamp: new Date()
          }
        }
      }
    );
    
    // Check if referrer has a referrer (for Tier 2)
    if (referrer.referredBy) {
      const tier2Referrer = referrer.referredBy;
      
      // Update Tier 2 stats
      await User.updateOne(
        { telegramId: tier2Referrer },
        { 
          $inc: { 
            'referralStats.tier2.users': 1 
          },
          $push: {
            'referralTransactions': {
              type: 'new_referral',
              tier: 2,
              referredUser: newUserId,
              timestamp: new Date()
            }
          }
        }
      );
      
      // Get Tier 2 referrer to check for Tier 3
      const tier2ReferrerUser = await User.findOne({ telegramId: tier2Referrer });
      
      // Check if Tier 2 referrer has a referrer (for Tier 3)
      if (tier2ReferrerUser && tier2ReferrerUser.referredBy) {
        const tier3Referrer = tier2ReferrerUser.referredBy;
        
        // Update Tier 3 stats
        await User.updateOne(
          { telegramId: tier3Referrer },
          { 
            $inc: { 
              'referralStats.tier3.users': 1 
            },
            $push: {
              'referralTransactions': {
                type: 'new_referral',
                tier: 3,
                referredUser: newUserId,
                timestamp: new Date()
              }
            }
          }
        );
      }
    }
    
    logger.info(`Updated referral tiers for new user ${newUserId} referred by ${referrerId}`);
  } catch (error) {
    logger.error(`Error updating referral tiers: ${error.message}`);
  }
};

/**
 * Records a trade for referral tracking and updates tier statistics
 * @param {string} userId - The user's Telegram ID
 * @param {number} tradeAmount - The SOL amount of the trade
 * @param {number} fee - The fee amount in SOL
 * @returns {Promise<boolean>} Success indicator
 */
const recordReferralTrade = async (userId, tradeAmount, fee) => {
  try {
    // Find the user who made the trade
    const user = await User.findOne({ telegramId: userId });
    if (!user || !user.referredBy) {
      return false;
    }

    // Calculate earnings for each tier
    const tierMultipliers = {
      1: FEES.TIER1_PERCENTAGE / 100, // Convert percentage to decimal
      2: FEES.TIER2_PERCENTAGE / 100,
      3: FEES.TIER3_PERCENTAGE / 100
    };

    // Find tier 1 referrer (direct referrer)
    const tier1Referrer = await User.findOne({ 
      $or: [
        { referralCode: user.referredBy },
        { 'customReferralCodes.code': user.referredBy }
      ]
    });

    if (tier1Referrer) {
      // Calculate tier 1 earnings
      const tier1Earnings = fee * tierMultipliers[1];
      
      // Update tier 1 referrer's stats
      await User.updateOne(
        { _id: tier1Referrer._id },
        { 
          $inc: { 
            'referralStats.tier1.volume': tradeAmount,
            'referralStats.tier1.earnings': tier1Earnings
          }
        }
      );

      // Add transaction record
      await User.updateOne(
        { _id: tier1Referrer._id },
        {
          $push: {
            referralTransactions: {
              type: 'trade',
              tier: 1,
              referredUser: user.telegramId,
              amount: tradeAmount,
              earnings: tier1Earnings,
              timestamp: new Date()
            }
          }
        }
      );

      // Find tier 2 referrer (referrer's referrer)
      if (tier1Referrer.referredBy) {
        const tier2Referrer = await User.findOne({
          $or: [
            { referralCode: tier1Referrer.referredBy },
            { 'customReferralCodes.code': tier1Referrer.referredBy }
          ]
        });

        if (tier2Referrer) {
          // Calculate tier 2 earnings
          const tier2Earnings = fee * tierMultipliers[2];
          
          // Update tier 2 referrer's stats
          await User.updateOne(
            { _id: tier2Referrer._id },
            { 
              $inc: { 
                'referralStats.tier2.volume': tradeAmount,
                'referralStats.tier2.earnings': tier2Earnings
              }
            }
          );

          // Add transaction record
          await User.updateOne(
            { _id: tier2Referrer._id },
            {
              $push: {
                referralTransactions: {
                  type: 'trade',
                  tier: 2,
                  referredUser: user.telegramId,
                  amount: tradeAmount,
                  earnings: tier2Earnings,
                  timestamp: new Date()
                }
              }
            }
          );

          // Find tier 3 referrer (referrer's referrer's referrer)
          if (tier2Referrer.referredBy) {
            const tier3Referrer = await User.findOne({
              $or: [
                { referralCode: tier2Referrer.referredBy },
                { 'customReferralCodes.code': tier2Referrer.referredBy }
              ]
            });

            if (tier3Referrer) {
              // Calculate tier 3 earnings
              const tier3Earnings = fee * tierMultipliers[3];
              
              // Update tier 3 referrer's stats
              await User.updateOne(
                { _id: tier3Referrer._id },
                { 
                  $inc: { 
                    'referralStats.tier3.volume': tradeAmount,
                    'referralStats.tier3.earnings': tier3Earnings
                  }
                }
              );

              // Add transaction record
              await User.updateOne(
                { _id: tier3Referrer._id },
                {
                  $push: {
                    referralTransactions: {
                      type: 'trade',
                      tier: 3,
                      referredUser: user.telegramId,
                      amount: tradeAmount,
                      earnings: tier3Earnings,
                      timestamp: new Date()
                    }
                  }
                }
              );
            }
          }
        }
      }

      return true;
    }

    return false;
  } catch (error) {
    logger.error(`Error recording referral trade: ${error.message}`);
    return false;
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

    // Sanitize input data
    const sanitizedUsername = telegramUser.username ? sanitizeInput(telegramUser.username) : null;
    const sanitizedFirstName = telegramUser.first_name ? sanitizeInput(telegramUser.first_name) : null;
    const sanitizedReferralCode = referralCode ? sanitizeInput(referralCode) : null;

    // Check if referral code is valid
    let referredBy = null;
    if (sanitizedReferralCode) {
      // Check custom referral codes first
      const referrerWithCustomCode = await User.findOne({ 'customReferralCodes.code': sanitizedReferralCode });
      
      if (referrerWithCustomCode) {
        referredBy = referrerWithCustomCode.telegramId;
      } else {
        // Check default referral code
        const referrer = await User.findOne({ referralCode: sanitizedReferralCode });
        if (referrer) {
          referredBy = referrer.telegramId;
        }
      }
    }

    // Generate wallet
    const wallet = await generateWallet();
    
    // Create new user with display name - ensure it's sanitized
    const displayName = sanitizedFirstName || sanitizedUsername || `User_${telegramId.substring(0, 5)}`;
    
    // Generate a custom referral code to prevent null values
    const customReferralCode = `${telegramId.substring(0, 5)}_${Math.random().toString(36).substring(2, 8)}`;
    
    // Create new user
    const user = new User({
      telegramId: telegramId,
      username: sanitizedUsername,
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
      }],
      referralStats: {
        tier1: { users: 0, volume: 0, earnings: 0 },
        tier2: { users: 0, volume: 0, earnings: 0 },
        tier3: { users: 0, volume: 0, earnings: 0 }
      },
      referralTransactions: []
    });
    
    // Save the user with better error handling
    try {
      await user.save();
      logger.info(`Created new user: ${logSafeUserData(user)}`);
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
              username: sanitizedUsername,
              displayName: displayName,
              joinedAt: new Date()
            } 
          } 
        }
      );
      
      // Update referral tiers
      await updateReferralTiers(referredBy, telegramId);
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
 * Gets complete referral information for a user
 * @param {string} telegramId - User's Telegram ID
 * @returns {Promise<Object>} Complete referral information
 */
const getReferralInfo = async (telegramId) => {
  try {
    const user = await User.findOne({ telegramId }).lean();
    if (!user) {
      throw new Error('User not found');
    }

    // Get user's referral code
    const referralCode = user.referralCode;
    
    // Get custom referral codes
    const customReferralCodes = user.customReferralCodes || [];
    
    // Get tier stats or initialize defaults
    const stats = {
      tier1: {
        users: user.referralStats?.tier1?.users || 0,
        volume: user.referralStats?.tier1?.volume || 0,
        earnings: user.referralStats?.tier1?.earnings || 0
      },
      tier2: {
        users: user.referralStats?.tier2?.users || 0,
        volume: user.referralStats?.tier2?.volume || 0,
        earnings: user.referralStats?.tier2?.earnings || 0
      },
      tier3: {
        users: user.referralStats?.tier3?.users || 0,
        volume: user.referralStats?.tier3?.volume || 0,
        earnings: user.referralStats?.tier3?.earnings || 0
      }
    };
    
    // Get user's referral count
    const totalDirectReferrals = user.referrals?.length || 0;
    
    // Get recent transactions (limited to last 10)
    const recentTransactions = (user.referralTransactions || [])
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);
      
    return {
      referralCode,
      customReferralCodes,
      stats,
      totalDirectReferrals,
      recentTransactions,
      hasReferrer: !!user.referredBy,
      referralLink: `https://t.me/${process.env.BOT_USERNAME}?start=${referralCode}`
    };
  } catch (error) {
    logger.error(`Error getting referral info: ${error.message}`);
    throw error;
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
    // Sanitize input
    const sanitizedCode = sanitizeInput(code);
    
    // Validate code format
    if (!sanitizedCode.match(/^[a-zA-Z0-9]{4,15}$/)) {
      throw new Error('Invalid code format. Code must be 4-15 alphanumeric characters.');
    }
    
    // Check if the code is already taken
    const existingUser = await User.findOne({
      $or: [
        { referralCode: sanitizedCode },
        { 'customReferralCodes.code': sanitizedCode }
      ]
    });
    
    if (existingUser) {
      throw new Error('This referral code is already taken.');
    }
    
    // Get current user
    const user = await User.findOne({ telegramId });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Store old codes for cleanup
    const oldCodes = user.customReferralCodes.map(c => c.code);
    
    // First, remove any old custom referral codes (limit to just one)
    if (user.customReferralCodes && user.customReferralCodes.length > 0) {
      user.customReferralCodes = [];
    }
    
    // Add the new custom code
    user.customReferralCodes.push({
      code: sanitizedCode,
      createdAt: new Date()
    });
    
    // Save the user
    await user.save();
    
    logger.info(`Updated referral code for user ${telegramId}: ${oldCodes.join(', ')} -> ${sanitizedCode}`);
    
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
 * Retrieves fee information for a user including discounts for referrals
 * @param {string} telegramId - The user's Telegram ID 
 * @returns {Promise<Object>} Fee information including base and discounted rates
 */
const getUserFeeInfo = async (telegramId) => {
  try {
    const user = await User.findOne({ telegramId });
    if (!user) {
      return {
        baseFee: FEES.NORMAL_PERCENTAGE / 100, // Convert to decimal
        discountedFee: FEES.NORMAL_PERCENTAGE / 100,
        hasReferral: false
      };
    }

    // Check if user has a referral
    const hasReferral = !!user.referredBy;
    
    // Get base fee from user settings or use default
    const baseFeePercentage = FEES.NORMAL_PERCENTAGE / 100; // Convert to decimal
    
    // Calculate discounted fee if user has a referral
    let discountedFeePercentage = baseFeePercentage;
    if (hasReferral) {
      discountedFeePercentage = FEES.REFERRAL_PERCENTAGE / 100;
    }
    
    return {
      baseFee: baseFeePercentage,
      discountedFee: discountedFeePercentage,
      hasReferral: hasReferral,
      referralDiscount: FEES.REFERRAL_DISCOUNT
    };
  } catch (error) {
    logger.error(`Error getting user fee info: ${error.message}`);
    return {
      baseFee: FEES.NORMAL_PERCENTAGE / 100,
      discountedFee: FEES.NORMAL_PERCENTAGE / 100,
      hasReferral: false
    };
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
    // Sanitize input
    const sanitizedCode = sanitizeInput(code);
    
    // Validate code format
    if (!sanitizedCode.match(/^[a-zA-Z0-9]{4,15}$/)) {
      throw new Error('Invalid code format. Code must be 4-15 alphanumeric characters.');
    }
    
    // Check if the code is already taken
    const existingUser = await User.findOne({
      $or: [
        { referralCode: sanitizedCode },
        { 'customReferralCodes.code': sanitizedCode }
      ]
    });
    
    if (existingUser) {
      throw new Error('This referral code is already taken.');
    }
    
    // Get old code for logging
    const user = await User.findOne({ telegramId });
    if (user) {
      const oldCode = user.referralCode;
      
      // Update the main referral code
      const updatedUser = await User.findOneAndUpdate(
        { telegramId },
        { referralCode: sanitizedCode },
        { new: true }
      );
      
      logger.info(`Updated main referral code for user ${telegramId}: ${oldCode} -> ${sanitizedCode}`);
      
      if (!updatedUser) {
        throw new Error('User not found');
      }
      
      return updatedUser;
    } else {
      throw new Error('User not found');
    }
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
  updateReferralTiers,
  recordReferralTrade,
  FEE_CONFIG
}; 