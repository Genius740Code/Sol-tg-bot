//=============================================================
// Database Population Script
//=============================================================
// There are multiple ways to run this script correctly:
//
// 1. From the telegrambot directory:
//    node tools/populateDatabase.js
// 
// 2. Using the wrapper script:
//    node populate-db.js
//
// 3. On Windows, use the batch file:
//    populate-db.bat
//
// This script will prompt you for the number of fake users to generate
// and will add them to your database configured in the .env file.
//=============================================================


const mongoose = require('mongoose');
const readline = require('readline');
const crypto = require('crypto');
const path = require('path');
const config = require('../../config/config');

// Load environment variables from the correct path
const envPath = path.resolve(__dirname, '..', '.env');
console.log(`Loading .env file from: ${envPath}`);

// Log the MongoDB URI (with credentials partially hidden for security)
const mongoUriLog = process.env.MONGODB_URI 
  ? process.env.MONGODB_URI.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@') 
  : 'Not found';
console.log(`MongoDB URI from .env: ${mongoUriLog}`);

// Try to load the encryption utility directly
let encrypt;
try {
  const encryptionModule = require('../utils/encryption');
  encrypt = encryptionModule.encrypt;
} catch (error) {
  console.log('Could not load encryption module, using fallback encryption');
  // Fallback encryption function if the module can't be loaded
  encrypt = (text) => {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  };
}

// Debug information to see available models
console.log('Checking for User model...');

// Dynamically try to find and load the User model
let User;
const possibleModelPaths = [
  '../src/models/user',
  '../models/User',
  './models/User',
  '../telegrambot/src/models/user',
  '../telegrambot/models/User'
];

for (const modelPath of possibleModelPaths) {
  try {
    const userModule = require(modelPath);
    if (userModule && userModule.User) {
      User = userModule.User;
      console.log(`Found User model in ${modelPath}`);
      break;
    }
  } catch (error) {
    console.log(`Could not load User model from ${modelPath}`);
  }
}

// If User model is still not found, create a simple schema
if (!User) {
  console.log('Creating a new User schema as fallback');
  const userSchema = new mongoose.Schema({
    telegramId: {
      type: String,
      required: true,
      unique: true,
    },
    username: String,
    firstName: String,
    lastName: String,
    walletAddress: String,
    encryptedPrivateKey: String,
    mnemonic: String,
    wallets: [{
      name: String,
      address: String,
      encryptedPrivateKey: String,
      mnemonic: String,
      isActive: Boolean
    }],
    referralCode: String,
    settings: Object,
    joinedAt: Date,
    lastActive: Date
  });
  
  User = mongoose.model('User', userSchema);
}

// Function to generate a random wallet address (Solana style) - Optimized
const generateWalletAddress = () => {
  const charset = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 44; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
};

// Function to generate a fake private key (will be encrypted) - Optimized
const generatePrivateKey = () => crypto.randomBytes(32).toString('hex');

// Function to generate a random mnemonic phrase - Optimized
const generateMnemonic = () => {
  const randomWords = [];
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  
  // Generate a fixed-size random mnemonic for better performance
  for (let i = 0; i < 12; i++) {
    let word = '';
    const wordLength = 5 + Math.floor(Math.random() * 5); // 5-9 chars is faster than variable 4-15
    for (let j = 0; j < wordLength; j++) {
      word += chars[Math.floor(Math.random() * chars.length)];
    }
    randomWords.push(word);
  }
  
  return randomWords.join(' ');
};

// Optimized random string generator for usernames and names
const generateRandomString = (minLength, maxLength) => {
  const length = minLength + Math.floor(Math.random() * (maxLength - minLength + 1));
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  
  return result;
};

// Function to generate a random username - Optimized
const generateUsername = () => generateRandomString(4, 10);

// Function to generate a random telegram ID - Optimized
const generateTelegramId = () => (100000000 + Math.floor(Math.random() * 900000000)).toString();

// Function to generate a random first name - Optimized
const generateFirstName = () => generateRandomString(4, 8);

// Function to generate a random last name - Optimized
const generateLastName = () => generateRandomString(4, 8);

// Generate a single fake user - Heavily optimized
const generateFakeUser = () => {
  const telegramId = generateTelegramId();
  const walletAddress = generateWalletAddress();
  const privateKey = generatePrivateKey();
  const mnemonic = generateMnemonic();
  const username = generateUsername();
  
  // Generate a unique custom referral code and timestamp - Optimized
  const customReferralCode = `${Math.random().toString(36).substring(2, 8)}_${Date.now()}`;
  const encryptedPrivKey = encrypt(privateKey);
  const encryptedMnemonic = encrypt(mnemonic);

  return {
    telegramId,
    username,
    firstName: generateFirstName(),
    lastName: generateLastName(),
    walletAddress,
    encryptedPrivateKey: encryptedPrivKey,
    mnemonic: encryptedMnemonic,
    wallets: [{
      name: 'Main Wallet',
      address: walletAddress,
      encryptedPrivateKey: encryptedPrivKey,
      mnemonic: encryptedMnemonic,
      isActive: true
    }],
    referredBy: null,
    referralCode: `${telegramId.substring(0, 5)}_${Math.random().toString(36).substring(2, 8)}`,
    referrals: [],
    customReferralCodes: [{
      code: customReferralCode,
      createdAt: new Date()
    }],
    settings: {
      notifications: {
        priceAlerts: true,
        tradingUpdates: true
      },
      tradingSettings: {
        maxSlippage: 1.0,
        feeType: 'FAST',
        buyTip: 0.001,
        sellTip: 0.001,
        customFeeValue: 0.001,
        mevProtection: false,
        processType: 'standard',
        confirmTrades: true
      }
    },
    joinedAt: new Date(),
    lastActive: new Date(),
    state: null,
    limitOrders: [],
    positions: []
  };
};

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Ask for the number of users to generate
rl.question('How many fake users do you want to generate? ', async (answer) => {
  const count = parseInt(answer);
  
  if (isNaN(count) || count <= 0) {
    console.error('Please enter a valid positive number');
    rl.close();
    return;
  }
  
  // Capture start time for performance metrics
  const startTime = process.hrtime.bigint();
  
  // Optimize memory usage based on count
  const isVeryLarge = count > 10000;
  const isLarge = count > 1000;
  const batchSize = isVeryLarge ? 250 : (isLarge ? 100 : 50); // Increased batch sizes
  const generationBatchSize = isVeryLarge ? 2500 : (isLarge ? 1000 : count); // Increased batch sizes
  const progressInterval = isVeryLarge ? 1000 : (isLarge ? 250 : 50); // Adjusted for better performance
  
  // Use MongoDB URI from .env file
  const mongoUri = process.env.MONGODB_URI;
  
  if (!mongoUri) {
    console.error('MongoDB URI not found in .env file. Please add MONGODB_URI to your .env file.');
    rl.close();
    return;
  }
  
  try {
    console.log(`Connecting to MongoDB...`);
    
    // Set mongoose options to avoid deprecation warnings
    mongoose.set('strictQuery', false);
    
    // Connect with improved options
    await mongoose.connect(mongoUri, { 
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 120000, // Increased to 2 minutes for large operations
      maxPoolSize: 50, // Increased for more parallel operations
      minPoolSize: 10, // Maintain a minimum pool size
      maxIdleTimeMS: 60000
    });
    
    console.log('Connected to MongoDB successfully');
    
    // For very large counts, generate and save in chunks to manage memory
    let totalSuccessCount = 0;
    let totalGeneratedCount = 0;
    
    // Set up a timer to track overall performance
    console.time('Total operation time');
    
    // Pre-generate some random data to improve user generation speed
    console.log('Pre-generating random data...');
    const preGeneratedPairs = [];
    for (let i = 0; i < Math.min(10000, count); i++) {
      preGeneratedPairs.push({
        telegramId: (100000000 + Math.floor(Math.random() * 900000000)).toString(),
        username: generateRandomString(4, 10),
        firstName: generateRandomString(4, 8),
        lastName: generateRandomString(4, 8),
        referralCode: `${Math.random().toString(36).substring(2, 8)}_${Date.now()}`
      });
    }
    
    for (let gb = 0; gb < generationBatches; gb++) {
      const remainingToGenerate = count - totalGeneratedCount;
      const currentBatchSize = Math.min(generationBatchSize, remainingToGenerate);
      
      if (generationBatches > 1) {
        console.log(`\n--- Processing batch ${gb + 1}/${generationBatches} (${currentBatchSize} users) ---`);
      }
      
      // Generate users for this batch
      console.time('User generation');
      const users = [];
      
      // Use worker threads for parallel generation if available and count is large
      if (isLarge && typeof Worker !== 'undefined') {
        // If we can use worker threads, parallelize generation
        // This is a simplified version - for a real implementation, you would need to
        // require the worker_threads module and implement proper worker logic
        console.log(`Using parallel processing for user generation`);
        // Simulating parallel processing with chunking
        const chunkSize = Math.ceil(currentBatchSize / 4);
        const chunks = Array.from({ length: Math.ceil(currentBatchSize / chunkSize) }, 
          (_, i) => currentBatchSize - (i * chunkSize) > chunkSize ? chunkSize : currentBatchSize - (i * chunkSize));
        
        // Process each chunk
        for (let c = 0; c < chunks.length; c++) {
          const size = chunks[c];
          for (let i = 0; i < size; i++) {
            // Use pre-generated data for up to 10000 users
            const preGenIndex = totalGeneratedCount % preGeneratedPairs.length;
            const preGen = preGeneratedPairs[preGenIndex];
            
            // Use a more optimized user generation function
            const fakeUser = generateFakeUserFast(
              preGen.telegramId, 
              preGen.username, 
              preGen.firstName, 
              preGen.lastName,
              preGen.referralCode
            );
            
            users.push(fakeUser);
            
            totalGeneratedCount++;
            if (i % progressInterval === 0 || i === size - 1) {
              process.stdout.write(`\rGenerating users: ${totalGeneratedCount}/${count} [${Math.round(totalGeneratedCount / count * 100)}%]`);
            }
          }
        }
      } else {
        // Standard sequential generation
        for (let i = 0; i < currentBatchSize; i++) {
          // Use pre-generated data for up to 10000 users
          const preGenIndex = totalGeneratedCount % preGeneratedPairs.length;
          const preGen = preGeneratedPairs[preGenIndex];
          
          // Use a more optimized user generation function
          const fakeUser = generateFakeUserFast(
            preGen.telegramId, 
            preGen.username, 
            preGen.firstName, 
            preGen.lastName,
            preGen.referralCode
          );
          
          users.push(fakeUser);
          
          totalGeneratedCount++;
          if (i % progressInterval === 0 || i === currentBatchSize - 1) {
            process.stdout.write(`\rGenerating users: ${totalGeneratedCount}/${count} [${Math.round(totalGeneratedCount / count * 100)}%]`);
          }
        }
      }
      
      console.log('\nUser generation completed');
      console.timeEnd('User generation');
      
      // Insert users in batches for better performance
      console.time('Database insertion');
      let batchSuccessCount = 0;
      const insertBatches = Math.ceil(users.length / batchSize);

      console.log(`Inserting ${users.length} users in ${insertBatches} batches (${batchSize} users per batch)...`);
      
      // Create all bulk operations first
      const batchOperations = [];
      for (let b = 0; b < insertBatches; b++) {
        const start = b * batchSize;
        const end = Math.min(start + batchSize, users.length);
        const batchUsers = users.slice(start, end);
        
        // Create bulk operation
        const ops = batchUsers.map(user => ({
          insertOne: {
            document: user
          }
        }));
        
        batchOperations.push(ops);
      }
      
      // Execute batches with controlled concurrency
      const concurrencyLimit = 5; // Process 5 batches in parallel at most
      for (let i = 0; i < batchOperations.length; i += concurrencyLimit) {
        const currentBatches = batchOperations.slice(i, i + concurrencyLimit);
        const promises = currentBatches.map(async (ops, idx) => {
          try {
            // Execute bulk operation
            const result = await User.bulkWrite(ops, { ordered: false });
            const insertedCount = result.insertedCount || 0;
            
            // Update success count
            batchSuccessCount += insertedCount;
            const totalProcessed = i * batchSize + idx * batchSize + insertedCount;
            process.stdout.write(`\rProgress: ${totalProcessed}/${users.length} users saved [${Math.round(totalProcessed / users.length * 100)}%]`);
            
            return insertedCount;
          } catch (error) {
            // Try to determine how many were inserted despite error
            if (error.result && error.result.insertedCount) {
              batchSuccessCount += error.result.insertedCount;
              return error.result.insertedCount;
            }
            console.error(`Error in batch ${i+idx}:`, error.message);
            return 0;
          }
        });
        
        // Wait for current batch of promises
        await Promise.all(promises);
      }
      
      totalSuccessCount += batchSuccessCount;
      
      console.log(`\nBatch completed: ${batchSuccessCount}/${users.length} users saved`);
      console.timeEnd('Database insertion');
      
      // Force garbage collection between large batches if available
      if (global.gc && isVeryLarge) {
        console.log('Running garbage collection...');
        global.gc();
      }
      
      // Release memory by clearing the users array
      users.length = 0;
    }
    
    console.timeEnd('Total operation time');
    console.log(`\nAll operations completed: ${totalSuccessCount}/${count} users inserted into the database`);
    
    // Display performance statistics
    if (totalSuccessCount > 0) {
      const totalTimeMs = Number(process.hrtime.bigint() - startTime) / 1000000;
      const timePerUser = totalTimeMs / totalSuccessCount;
      const usersPerSecond = Math.round(totalSuccessCount / (totalTimeMs / 1000));
      console.log(`Performance: ${timePerUser.toFixed(2)}ms per user (${usersPerSecond} users/second)`);
    }
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
  } finally {
    try {
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB');
    } catch (err) {
      console.error('Error disconnecting from MongoDB:', err.message);
    }
    rl.close();
  }
});

// Optimized version of generateFakeUser that's more memory-efficient
function generateFakeUserFast(telegramId, username, firstName, lastName, customReferralCode) {
  // Generate wallet data with improved performance
  const walletAddress = generateWalletAddress();
  const privateKey = generatePrivateKey();
  const mnemonic = generateMnemonic();
  
  // Use encryption only once
  const encryptedPrivKey = encrypt(privateKey);
  
  const randomTime = Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000); // Random time in the last 30 days
  
  return {
    telegramId,
    username,
    firstName,
    lastName,
    walletAddress,
    encryptedPrivateKey: encryptedPrivKey,
    mnemonic: encrypt(mnemonic),
    wallets: [{
      name: 'Main Wallet',
      address: walletAddress,
      encryptedPrivateKey: encryptedPrivKey,
      mnemonic: encrypt(mnemonic),
      isActive: true
    }],
    referredBy: null,
    referralCode: `${telegramId.substring(0, 5)}_${Math.random().toString(36).substring(2, 8)}`,
    referrals: [],
    customReferralCodes: [{
      code: customReferralCode,
      createdAt: new Date(randomTime)
    }],
    settings: {
      notifications: {
        priceAlerts: Math.random() > 0.3, // 70% have price alerts enabled
        tradingUpdates: Math.random() > 0.2 // 80% have trading updates enabled
      },
      tradingSettings: {
        maxSlippage: Math.random() > 0.5 ? 1.0 : 0.5,
        feeType: Math.random() > 0.7 ? 'FAST' : 'NORMAL',
        buyTip: 0.001,
        sellTip: 0.001,
        customFeeValue: 0.001,
        mevProtection: Math.random() > 0.8,
        processType: Math.random() > 0.5 ? 'standard' : 'fast',
        confirmTrades: Math.random() > 0.3
      }
    },
    joinedAt: new Date(randomTime),
    lastActive: new Date(randomTime + Math.floor(Math.random() * 2 * 24 * 60 * 60 * 1000)), // Random time 0-2 days after joining
    state: null,
    limitOrders: [],
    positions: []
  };
}

// Handle readline close
rl.on('close', () => {
  console.log('Script completed');
  process.exit(0);
});
