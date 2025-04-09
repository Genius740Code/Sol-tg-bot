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
  walletAddress: {
    type: String,
    required: true
  },
  encryptedPrivateKey: {
    type: String,
    required: true
  },
  mnemonic: String,
  referralCode: {
    type: String,
    unique: true
  },
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
    // Generate a unique referral code
    const randomString = crypto.randomBytes(4).toString('hex');
    this.referralCode = `${this.telegramId.toString().substr(-4)}${randomString}`;
  }
  next();
});

// Create model
const User = mongoose.model('User', userSchema);

module.exports = { User }; 