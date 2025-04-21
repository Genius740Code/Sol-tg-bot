const mongoose = require('mongoose');

/**
 * Settings schema to store all application configurations centrally
 */
const settingsSchema = new mongoose.Schema({
  // Setting key (unique identifier)
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Setting value (can be any type)
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  
  // Category for grouping settings
  category: {
    type: String,
    required: true,
    index: true
  },
  
  // Description of the setting
  description: {
    type: String
  },
  
  // Whether this setting can be changed via API/admin interface
  isEditable: {
    type: Boolean,
    default: true
  },
  
  // Whether this setting is sensitive (e.g. API keys) and should be masked in UI
  isSensitive: {
    type: Boolean,
    default: false
  },
  
  // Audit trail
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String
  }
});

// Update timestamps on save
settingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static methods for easier access
settingsSchema.statics.getSetting = async function(key) {
  const setting = await this.findOne({ key });
  return setting ? setting.value : null;
};

settingsSchema.statics.setSetting = async function(key, value, category = 'general', description = '', isEditable = true, isSensitive = false, updatedBy = 'system') {
  const update = {
    value,
    category,
    description,
    isEditable,
    isSensitive,
    updatedAt: Date.now(),
    updatedBy
  };
  
  return await this.findOneAndUpdate(
    { key },
    update,
    { upsert: true, new: true }
  );
};

settingsSchema.statics.getSettingsByCategory = async function(category) {
  return await this.find({ category });
};

// Create model
const Settings = mongoose.model('Settings', settingsSchema);

module.exports = { Settings }; 