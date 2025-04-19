const express = require('express');
const router = express.Router();
const extensionService = require('../services/extensionService');
const { logger } = require('../database');

/**
 * Verify an extension user with their verification code
 * POST /api/extension/verify
 */
router.post('/verify', async (req, res) => {
  try {
    const { verificationCode } = req.body;
    
    if (!verificationCode) {
      return res.status(400).json({ success: false, message: 'Verification code is required' });
    }
    
    const user = await extensionService.verifyExtensionUser(verificationCode);
    
    if (user) {
      // Calculate the auto-logout date to inform the user
      const autoLogoutDate = user.autoLogoutDate;
      const formattedDate = autoLogoutDate.toISOString().split('T')[0];
      
      return res.json({
        success: true,
        user: {
          telegramId: user.telegramId,
          username: user.username,
          settings: user.settings,
          autoLogoutDate: formattedDate // Send auto-logout date to client
        },
        message: `Login successful. For security reasons, you will be automatically logged out after 7 days (${formattedDate}).`
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired verification code. Please get a new code from the extension or by using /extension command in the bot.' 
      });
    }
  } catch (error) {
    logger.error(`Extension verification error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * Update extension user settings
 * POST /api/extension/settings
 */
router.post('/settings', async (req, res) => {
  try {
    const { telegramId, settings } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ success: false, message: 'Telegram ID is required' });
    }
    
    if (!settings) {
      return res.status(400).json({ success: false, message: 'Settings object is required' });
    }
    
    const user = await extensionService.updateExtensionUserSettings(telegramId, settings);
    
    if (user) {
      return res.json({
        success: true,
        settings: user.settings
      });
    } else {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
  } catch (error) {
    logger.error(`Extension settings update error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router; 