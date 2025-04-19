/**
 * Utility for generating random strings
 * Based on the C++ implementation in telegrambot/extension/code_gen.cpp
 */

const crypto = require('crypto');

/**
 * Generate a cryptographically secure random string
 * @param {number} length - Length of string to generate
 * @returns {Promise<string>} Random string
 */
const generateRandomString = async (length) => {
  return new Promise((resolve, reject) => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charLength = characters.length;
    
    // Use crypto for better randomness
    crypto.randomBytes(length, (err, buffer) => {
      if (err) {
        reject(err);
        return;
      }
      
      let result = '';
      for (let i = 0; i < length; i++) {
        result += characters[buffer[i] % charLength];
      }
      
      resolve(result);
    });
  });
};

module.exports = {
  generateRandomString
}; 