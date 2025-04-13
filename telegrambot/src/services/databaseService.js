/**
 * Database Service
 * Provides functions for database operations including seeding test data
 */

const mongoose = require('mongoose');
const { createExampleUsers } = require('../../utils/populateExampleUsers');

/**
 * Connect to MongoDB
 * @returns {Promise<mongoose.Connection>} Mongoose connection
 */
async function connectToDatabase() {
  try {
    // Check for MongoDB URI in environment
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not defined in environment variables. Please check your .env file.');
    }
    
    // Connect to MongoDB
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

/**
 * Close MongoDB connection
 * @returns {Promise<void>}
 */
async function closeConnection() {
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    throw error;
  }
}

/**
 * Populate database with test data
 * @param {boolean} shouldDropCollections - Whether to drop existing collections
 * @param {number} userCount - Number of users to create
 * @returns {Promise<object>} Object containing counts of created entities
 */
async function seedDatabase(shouldDropCollections = false, userCount = 3) {
  try {
    console.log('Starting database population...');
    
    // For --drop option, we'll let the createExampleUsers function handle dropping
    // since it needs to reset indexes too
    if (shouldDropCollections) {
      console.log('Will drop collections before seeding...');
    }
    
    // Create example users with error handling
    console.log(`Creating ${userCount} example users...`);
    let usersCreated = 0;
    try {
      // Pass the shouldDropCollections flag to createExampleUsers
      usersCreated = await createExampleUsers(userCount, shouldDropCollections);
      console.log(`Created ${usersCreated} example users`);
    } catch (err) {
      console.error('Error creating example users:', err.message);
      if (err.message.includes('duplicate key error')) {
        console.error('This appears to be a duplicate key error with indexes.');
        console.error('Try running with the --drop option to completely reset the collections.');
      }
    }
    
    // Add any other population functions here
    // e.g., createExampleTransactions(), createExampleTokens(), etc.
    
    return {
      users: usersCreated
      // Add other counts here as they're implemented
    };
  } catch (error) {
    console.error('Error populating database:', error);
    throw error;
  }
}

module.exports = {
  connectToDatabase,
  closeConnection,
  seedDatabase
}; 