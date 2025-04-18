/**
 * Utility to create example users for testing
 */

const { User } = require('../models/User');
const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * Generate a random referral code
 * @returns {string} Random 6-character referral code
 */
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Creates example users with test data
 * @param {number} count - Number of users to create
 * @param {boolean} shouldDrop - Whether to drop the collection first
 * @returns {Promise<number>} Number of users created
 */
async function createExampleUsers(count = 3, shouldDrop = false) {
  try {
    // Make sure mongoose connection is established
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      console.error('ERROR: MongoDB connection not established before calling createExampleUsers');
      console.error('Make sure to call connectToDatabase() first and wait for it to complete');
      return 0;
    }

    // Generate users with local IDs first, in case database operations fail
    const exampleUsers = [];
    
    // First drop collection if requested - only do this explicitly
    // when the shouldDrop flag is true
    if (shouldDrop) {
      try {
        console.log('Attempting to drop users collection...');
        const conn = mongoose.connection;
        const collectionExists = (await conn.db.listCollections({ name: 'users' }).toArray()).length > 0;
        if (collectionExists) {
          await conn.db.dropCollection('users');
          console.log('Users collection dropped successfully');
        } else {
          console.log('Users collection does not exist, nothing to drop');
        }
      } catch (error) {
        console.warn('Failed to drop users collection:', error.message);
      }
    }
    
    // Always try to remove existing test users
    try {
      await User.deleteMany({ 
        telegramId: { 
          $gte: 100000001,
          $lte: 100000000 + count
        } 
      });
      console.log(`Removed existing test users with IDs 100000001-${100000000 + count}`);
    } catch (removeError) {
      console.warn('Error removing existing test users:', removeError.message);
    }
    
    // Generate user data
    console.log(`Generating ${count} test users...`);
    for (let i = 1; i <= count; i++) {
      // Generate unique referral code for the main referral
      const mainReferralCode = generateReferralCode();
      
      // Generate a custom referral code (different from main code)
      const customReferralCode = generateReferralCode() + i;
      
      exampleUsers.push({
        telegramId: 100000000 + i,
        username: `testuser${i}`,
        firstName: `Test${i}`,
        lastName: `User${i}`,
        encryptedPrivateKey: crypto.randomBytes(32).toString('hex'),
        wallets: [{
          name: 'Main Wallet',
          address: '0x' + crypto.randomBytes(20).toString('hex'),
          isActive: true
        }],
        // Include exactly one custom referral code to avoid null values
        customReferralCodes: [{
          code: customReferralCode,
          createdAt: new Date()
        }],
        referralCode: mainReferralCode,
        referredBy: null,
        referrals: [],
        positions: [],
        limitOrders: [],
        settings: {
          notifications: {
            priceAlerts: true,
            tradingUpdates: true
          },
          tradingSettings: {
            maxSlippage: 1.0
          }
        },
        feeType: 'FAST',
        autoSlippage: true,
        slippageValue: 1.0,
        state: null,
        lastActivity: new Date(),
        createdAt: new Date()
      });
    }

    try {
      // Insert users with bulk operation for better performance
      console.log(`Creating ${count} users in database...`);
      
      // Use insertMany for better performance
      const result = await User.insertMany(exampleUsers, { ordered: false });
      console.log(`Successfully created ${result.length} users`);
      return result.length;
    } catch (error) {
      // Check for partial success
      if (error.insertedDocs && error.insertedDocs.length > 0) {
        console.warn(`Partially succeeded: ${error.insertedDocs.length} users created, but had errors:`, error.message);
        return error.insertedDocs.length;
      }
      
      // If complete failure, try individual creation as fallback
      console.warn('Bulk insert failed, trying individual user creation:', error.message);
      
      let successCount = 0;
      for (const userData of exampleUsers) {
        try {
          await User.create(userData);
          successCount++;
        } catch (err) {
          console.warn(`Failed to create user with telegramId ${userData.telegramId}: ${err.message}`);
        }
      }
      
      return successCount;
    }
  } catch (error) {
    console.error('Unexpected error in createExampleUsers:', error);
    return 0;
  }
}

module.exports = { createExampleUsers }; 