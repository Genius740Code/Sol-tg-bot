const crypto = require('crypto');
require('dotenv').config();

// AES-256-GCM requires a 32 byte (256 bit) key
// We'll derive a proper length key using a hash function if needed
const getEncryptionKey = () => {
  const configKey = process.env.ENCRYPTION_KEY || 'default-encryption-key-that-needs-to-be-changed-in-prod';
  // Use SHA-256 to create a key of exactly the right length
  return crypto.createHash('sha256').update(configKey).digest();
};

// Create a buffer of exactly 32 bytes for the key
const ENCRYPTION_KEY = getEncryptionKey();

// Encryption algorithm
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt sensitive data
 * @param {string} text - Text to encrypt
 * @returns {string} Encrypted data
 */
const encrypt = (text) => {
  try {
    // Generate a random initialization vector
    const iv = crypto.randomBytes(16);
    
    // Create cipher with properly sized key
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    // Encrypt the data
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Get the authentication tag
    const authTag = cipher.getAuthTag();
    
    // Return IV + Auth Tag + Encrypted data
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

/**
 * Decrypt sensitive data
 * @param {string} encryptedData - Data to decrypt
 * @returns {string} Decrypted text
 */
const decrypt = (encryptedData) => {
  try {
    // Split the encrypted data
    const parts = encryptedData.split(':');
    
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
    // Create decipher with properly sized key
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    // Set authentication tag
    decipher.setAuthTag(authTag);
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
};

module.exports = {
  encrypt,
  decrypt
}; 