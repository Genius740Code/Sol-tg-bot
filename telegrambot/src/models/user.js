const mongoose = require('mongoose');
const { encrypt } = require('../../utils/encryption');

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    required: true,
    unique: true,
  },
  username: {
    type: String,
    sparse: true,
  },
  firstName: String,
  lastName: String,
  walletAddress: {
    type: String,
    required: true,
  },
  encryptedPrivateKey: {
    type: String,
    required: true,
  },
  mnemonic: {
    type: String,
    required: true,
  },
  referredBy: {
    type: String,
    default: null,
  },
  referrals: {
    type: [String],
    default: [],
  },
  referralCode: {
    type: String,
    unique: true,
  },
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
    type: String, // buy or sell
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
    },
  },
});

// Generate a unique referral code before saving
userSchema.pre('save', async function(next) {
  if (!this.referralCode) {
    // Create a referral code based on telegramId and a random string
    const randomStr = Math.random().toString(36).substring(2, 8);
    this.referralCode = `${this.telegramId.substring(0, 5)}_${randomStr}`;
  }
  next();
});

const User = mongoose.model('User', userSchema);

module.exports = User; 