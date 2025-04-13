const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../../utils/encryption');
const zlib = require('zlib');
const { logger } = require('../database');

// Fee configuration for easy changing
const FEE_CONFIG = {
  FAST: 0.001,  // 0.1%
  TURBO: 0.005  // 0.5%
};

// Helper for compression
const compressData = (data) => {
  if (!data) return null;
  return zlib.deflateSync(Buffer.from(data)).toString('base64');
};

const decompressData = (compressed) => {
  if (!compressed) return null;
  return zlib.inflateSync(Buffer.from(compressed, 'base64')).toString();
};

// Helper for encrypting sensitive data
const encryptField = (data) => {
  if (!data) return null;
  return encrypt(data);
};

const decryptField = (data) => {
  if (!data) return null;
  return decrypt(data);
};

// Wallet schema for storing multiple wallets
const walletSchema = new mongoose.Schema({
  name: {
    type: String,
    default: function() {
      return `Wallet ${(this.parent().wallets || []).length + 1}`;
    }
  },
  address: {
    type: String,
    required: true
  },
  encryptedPrivateKey: {
    type: String,
    required: true
  },
  mnemonic: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  _id: true,
  timestamps: true 
});

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    sparse: true,
  },
  walletAddress: {
    type: String, // For backward compatibility
    required: true,
  },
  wallets: [walletSchema],
  encryptedPrivateKey: {
    type: String, // For backward compatibility
    required: true,
  },
  mnemonic: {
    type: String, // For backward compatibility
    required: true,
  },
  referredBy: {
    type: String,
    default: null,
  },
  referrals: [{
    telegramId: String,
    username: String,
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  referralCode: {
    type: String,
  },
  customReferralCodes: [{
    code: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  lastActive: {
    type: Date,
    default: Date.now,
  },
  limitOrders: [{
    tokenAddress: String,
    type: String, // sell only (buy removed)
    amount: Number,
    price: Number,
    status: {
      type: String,
      enum: ['active', 'filled', 'cancelled'],
      default: 'active',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  }],
  positions: [{
    tokenAddress: String,
    amount: Number,
    entryPrice: Number,
    createdAt: {
      type: Date,
      default: Date.now,
    },
  }],
  copyTrading: {
    isActive: {
      type: Boolean,
      default: false,
    },
    followingUsers: [String], // Array of telegramIds
  },
  settings: {
    notifications: {
      priceAlerts: {
        type: Boolean,
        default: true,
      },
      tradingUpdates: {
        type: Boolean,
        default: true,
      },
    },
    tradingSettings: {
      maxSlippage: {
        type: Number,
        default: 1, // 1%
      },
      feeType: {
        type: String,
        enum: Object.keys(FEE_CONFIG),
        default: 'FAST'
      },
      buyTip: {
        type: Number,
        default: 0.001
      },
      sellTip: {
        type: Number,
        default: 0.001
      },
      customFeeValue: {
        type: Number,
        default: 0.001
      },
      mevProtection: {
        type: Boolean,
        default: false
      },
      processType: {
        type: String,
        enum: ['standard', 'fast', 'turbo'],
        default: 'standard'
      },
      confirmTrades: {
        type: Boolean,
        default: true
      }
    },
  },
  state: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  minimize: false, // Prevent removing empty objects
  strict: true
});

// Add explicit indices for better performance
userSchema.index({ telegramId: 1 }, { unique: true });
userSchema.index({ referralCode: 1 }, { unique: true, sparse: true });
userSchema.index({ 'customReferralCodes.code': 1 }, { sparse: true });
userSchema.index({ joinedAt: 1 });
userSchema.index({ lastActive: 1 });

// Generate a unique referral code before saving
userSchema.pre('save', async function(next) {
  if (!this.referralCode) {
    // Create a referral code based on telegramId and a random string
    const randomStr = Math.random().toString(36).substring(2, 8);
    this.referralCode = `${this.telegramId.substring(0, 5)}_${randomStr}`;
  }
  
  // Filter out any null or empty codes in customReferralCodes
  if (this.customReferralCodes && Array.isArray(this.customReferralCodes)) {
    this.customReferralCodes = this.customReferralCodes.filter(item => 
      item && item.code && typeof item.code === 'string' && item.code.trim() !== ''
    );
    
    // If empty after filtering, add a default code
    if (this.customReferralCodes.length === 0) {
      const defaultCode = `${this.telegramId.substring(0, 5)}_${Math.random().toString(36).substring(2, 8)}_${Date.now()}`;
      this.customReferralCodes.push({
        code: defaultCode,
        createdAt: new Date()
      });
    }
  }
  
  // For backward compatibility
  if (!this.wallets || this.wallets.length === 0) {
    this.wallets = [{
      name: 'Main Wallet',
      address: this.walletAddress,
      encryptedPrivateKey: this.encryptedPrivateKey,
      mnemonic: this.mnemonic,
      isActive: true
    }];
  }
  
  next();
});

// Pre-save hook to encrypt sensitive fields
userSchema.pre('save', function(next) {
  try {
    // Skip if not modified
    if (!this.isModified('wallets') && !this.isModified('encryptedPrivateKey') && !this.isModified('mnemonic')) {
      return next();
    }
    
    // Re-encrypt the main wallet fields if they were modified
    if (this.isModified('encryptedPrivateKey') && this.encryptedPrivateKey && 
        typeof this.encryptedPrivateKey === 'string' && !this.encryptedPrivateKey.includes(':')) {
      this.encryptedPrivateKey = encrypt(this.encryptedPrivateKey);
    }
    
    if (this.isModified('mnemonic') && this.mnemonic && 
        typeof this.mnemonic === 'string' && !this.mnemonic.includes(':')) {
      this.mnemonic = encrypt(this.mnemonic);
    }
    
    // Handle wallets array encryption
    if (this.isModified('wallets') && Array.isArray(this.wallets)) {
      this.wallets.forEach(wallet => {
        if (wallet.encryptedPrivateKey && typeof wallet.encryptedPrivateKey === 'string' && 
            !wallet.encryptedPrivateKey.includes(':')) {
          wallet.encryptedPrivateKey = encrypt(wallet.encryptedPrivateKey);
        }
        
        if (wallet.mnemonic && typeof wallet.mnemonic === 'string' && 
            !wallet.mnemonic.includes(':')) {
          wallet.mnemonic = encrypt(wallet.mnemonic);
        }
        
        // Ensure wallets have required fields
        if (!wallet.encryptedPrivateKey && this.encryptedPrivateKey) {
          wallet.encryptedPrivateKey = this.encryptedPrivateKey;
        }
        
        // If wallet still missing encryptedPrivateKey, use a placeholder
        if (!wallet.encryptedPrivateKey) {
          wallet.encryptedPrivateKey = encrypt('placeholder-key-' + wallet.address.substring(0, 8));
        }
      });
    }
    
    next();
  } catch (error) {
    logger.error(`Error in encryption pre-save hook: ${error.message}`);
    next(error);
  }
});

// Helper method to get active wallet
userSchema.methods.getActiveWallet = function() {
  if (!this.wallets || this.wallets.length === 0) {
    return { 
      name: 'Main Wallet', 
      address: this.walletAddress,
      encryptedPrivateKey: this.encryptedPrivateKey,
      mnemonic: this.mnemonic
    };
  }
  
  const activeWallet = this.wallets.find(w => w.isActive) || this.wallets[0];
  return activeWallet;
};

// Helper method to set active wallet
userSchema.methods.setActiveWallet = function(walletAddress) {
  if (!this.wallets || this.wallets.length === 0) {
    this.wallets = [{
      name: 'Main Wallet',
      address: walletAddress,
      encryptedPrivateKey: this.encryptedPrivateKey,
      mnemonic: this.mnemonic,
      isActive: true
    }];
    return;
  }
  
  // Set all wallets to inactive
  this.wallets.forEach(wallet => {
    wallet.isActive = false;
  });
  
  // Set the specified wallet to active
  const wallet = this.wallets.find(w => w.address === walletAddress);
  if (wallet) {
    wallet.isActive = true;
  } else {
    // If wallet not found but there's a default one, keep that
    if (this.wallets.length > 0) {
      this.wallets[0].isActive = true;
    }
  }
};

// Helper method to get current fee based on settings
userSchema.methods.getFeePercentage = function() {
  const feeType = this.settings?.tradingSettings?.feeType || 'FAST';
  return FEE_CONFIG[feeType] || FEE_CONFIG.FAST;
};

// Helper method to calculate referral discount
userSchema.methods.getReferralDiscount = function() {
  const hasReferral = !!this.referredBy;
  const feePercentage = this.getFeePercentage();
  if (hasReferral) {
    return feePercentage * 0.89; // 11% discount
  }
  return feePercentage;
};

// Helper method to get decrypted private key
userSchema.methods.getDecryptedPrivateKey = function() {
  try {
    const activeWallet = this.getActiveWallet();
    return decrypt(activeWallet.encryptedPrivateKey);
  } catch (error) {
    throw new Error('Failed to decrypt private key');
  }
};

// Helper method to get decrypted mnemonic
userSchema.methods.getDecryptedMnemonic = function() {
  try {
    const activeWallet = this.getActiveWallet();
    if (!activeWallet.mnemonic) return null;
    return decrypt(activeWallet.mnemonic);
  } catch (error) {
    throw new Error('Failed to decrypt mnemonic');
  }
};

const User = mongoose.model('User', userSchema);

// Export model and fee config for use elsewhere
module.exports = {
  User,
  FEE_CONFIG
}; 