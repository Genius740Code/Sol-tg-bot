// Test script for createUser function
require('dotenv').config();
const mongoose = require('mongoose');
const { createUser } = require('../src/services/userService');
const { logger } = require('../src/database');

async function testCreateUser() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Test data
    const userData = {
      id: "12345678",
      first_name: "Test",
      last_name: "User",
      username: "testuser"
    };

    console.log('Creating test user...');
    const user = await createUser(userData);
    console.log('User created successfully:');
    console.log(`- Telegram ID: ${user.telegramId}`);
    console.log(`- Username: ${user.username}`);
    console.log(`- Wallet address: ${user.walletAddress}`);
    console.log(`- Custom referral code count: ${user.customReferralCodes?.length || 0}`);

    // Disconnect
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

testCreateUser(); 