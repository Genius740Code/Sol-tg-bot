/**
 * Settings service
 * 
 * Service layer for managing application and user settings
 */
const settings = require('../models/settings');

/**
 * Get a global setting by key
 * @param {string} key - Setting key
 * @param {*} defaultValue - Default value if setting doesn't exist
 * @returns {*} Setting value
 */
const getSetting = (key, defaultValue = null) => {
  return settings.getSetting(key, defaultValue);
};

/**
 * Set a global setting
 * @param {string} key - Setting key
 * @param {*} value - Setting value
 * @param {string} category - Optional category
 * @returns {boolean} Success status
 */
const setSetting = (key, value, category = null) => {
  return settings.setSetting(key, value, category);
};

/**
 * Get user settings
 * @param {string} userId - User ID
 * @returns {Object} User settings
 */
const getUserSettings = (userId) => {
  return settings.getUserSettings(userId);
};

/**
 * Save user settings
 * @param {string} userId - User ID
 * @param {Object} userSettings - Settings to save
 * @returns {boolean} Success status
 */
const saveUserSettings = (userId, userSettings) => {
  return settings.saveUserSettings(userId, userSettings);
};

/**
 * Get default trading settings
 * @returns {Object} Default trading settings
 */
const getDefaultTradingSettings = () => {
  return { ...settings.DEFAULT_SETTINGS };
};

/**
 * Get default user settings
 * @returns {Object} Default user settings
 */
const getDefaultUserSettings = () => {
  return { ...settings.DEFAULT_USER_SETTINGS };
};

module.exports = {
  getSetting,
  setSetting,
  getUserSettings,
  saveUserSettings,
  getDefaultTradingSettings,
  getDefaultUserSettings
}; 