const mongoose = require('mongoose');
const crypto = require('crypto');

// User schema
const userSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true
  },
  username: String,
  firstName: String,
  lastName: String,
  wallets: [{
    name: {
      type: String,
      default: function() {
        return `Wallet ${this.wallets.length + 1}`;
      }
    },
    address: {
      type: String,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],
  encryptedPrivateKey: {
    type: String,
    required: true
  },
  mnemonic: String,
  referralCode: {
    type: String,
    unique: true
  },
  customReferralCodes: [{
    code: {
      type: String,
      unique: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  referredBy: {
    type: String,
    default: null
  },
  referrals: [{
    telegramId: Number,
    username: String,
    firstName: String,
    joinedAt: Date
  }],
  positions: [{
    tokenAddress: String,
    amount: Number,
    entryPrice: Number,
    entryTimestamp: Date
  }],
  limitOrders: [{
    tokenAddress: String,
    type: {
      type: String,
      enum: ['buy', 'sell'],
      required: true
    },
    amount: Number,
    price: Number,
    status: {
      type: String,
      enum: ['active', 'filled', 'cancelled'],
      default: 'active'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  settings: {
    notifications: {
      priceAlerts: {
        type: Boolean,
        default: true
      },
      tradingUpdates: {
        type: Boolean,
        default: true
      }
    },
    tradingSettings: {
      maxSlippage: {
        type: Number,
        default: 1.0
      }
    }
  },
  // Fee type (can be FAST, TURBO, or CUSTOM)
  feeType: {
    type: String,
    enum: ['FAST', 'TURBO', 'CUSTOM'],
    default: 'FAST'
  },
  // Auto slippage setting
  autoSlippage: {
    type: Boolean,
    default: true
  },
  // Manual slippage value (used when autoSlippage is false)
  slippageValue: {
    type: Number,
    default: 1.0
  },
  // User state for flow control
  state: {
    type: String,
    default: null
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Generate unique referral code
userSchema.pre('save', function(next) {
  if (!this.referralCode) {
    // Generate a random 6-digit alphanumeric code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.referralCode = code;
  }
  
  // For backward compatibility
  if (!this.wallets || this.wallets.length === 0) {
    this.wallets = [{
      name: 'Main Wallet',
      address: this.walletAddress,
      isActive: true
    }];
  }
  
  next();
});

// Helper method to get active wallet
userSchema.methods.getActiveWallet = function() {
  if (!this.wallets || this.wallets.length === 0) {
    return { name: 'Main Wallet', address: this.walletAddress };
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
    // If wallet not found, add it as a new wallet
    this.wallets.push({
      name: `Wallet ${this.wallets.length + 1}`,
      address: walletAddress,
      isActive: true
    });
  }
};

// Create model
const User = mongoose.model('User', userSchema);

module.exports = { User }; 