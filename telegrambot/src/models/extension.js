const mongoose = require('mongoose');

/**
 * Extension user schema
 * Stores user data for the browser extension
 */
const extensionUserSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true
  },
  username: {
    type: String,
    sparse: true
  },
  verificationCode: {
    type: String,
    required: true
  },
  verificationCodeExpires: {
    type: Date,
    default: function() {
      // Set expiration to 5 minutes from now
      return new Date(Date.now() + 5 * 60 * 1000);
    }
  },
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
        default: 1 // 1%
      },
      feeType: {
        type: String,
        enum: ['FAST', 'TURBO', 'CUSTOM'],
        default: 'FAST'
      },
      confirmTrades: {
        type: Boolean,
        default: true
      }
    }
  },
  lastLogin: {
    type: Date,
    default: null
  },
  lastLogout: {
    type: Date,
    default: null
  },
  autoLogoutDate: {
    type: Date,
    default: function() {
      // Set auto logout to 7 days from login
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  minimize: false // Prevent removing empty objects
});

// Add indices for better performance
extensionUserSchema.index({ telegramId: 1 }, { unique: true });
extensionUserSchema.index({ createdAt: 1 });
extensionUserSchema.index({ verificationCode: 1 });
extensionUserSchema.index({ autoLogoutDate: 1 }); // For auto-logout queries

// Create the model only using the extension connection
const createExtensionUserModel = (connection) => {
  return connection.model('ExtensionUser', extensionUserSchema);
};

module.exports = { createExtensionUserModel }; 