/**
 * SolClick Extension - Login Script
 * Handles authentication for the extension
 */

document.addEventListener('DOMContentLoaded', () => {
  const verifyButton = document.getElementById('verify-button');
  const getCodeButton = document.getElementById('get-code-button');
  const codeInput = document.getElementById('code');
  const statusMessage = document.getElementById('status-message');
  
  // Bot name - should match the one in your .env file
  const BOT_NAME = 'Solonatest_bot';
  
  // Telegram bot link
  const TELEGRAM_BOT_LINK = `https://t.me/${BOT_NAME}?start=ref_QT_login_extension`;
  
  // API endpoint for verification (should be updated to your actual API endpoint)
  const API_ENDPOINT = 'https://api.yourdomain.com/api/extension/verify';
  
  // Check if user is already logged in
  chrome.storage.local.get(['authenticated', 'telegramId', 'settings'], (result) => {
    if (result.authenticated === true && result.telegramId) {
      // User is already authenticated, redirect to main popup
      window.location.href = '../popup.html';
    }
  });
  
  // Add event listener for enter key
  codeInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      verifyCode();
    }
  });
  
  // Add event listener for verify button
  verifyButton.addEventListener('click', verifyCode);
  
  // Add event listener for get code button
  getCodeButton.addEventListener('click', () => {
    // Open Telegram bot in a new tab
    chrome.tabs.create({ url: TELEGRAM_BOT_LINK });
    showStatus('Opened Telegram Bot. Please get your verification code and enter it here.', 'info');
  });
  
  /**
   * Verify the entered code
   */
  async function verifyCode() {
    const verificationCode = codeInput.value.trim();
    
    if (!verificationCode || verificationCode.length < 40) {
      showStatus('Please enter a valid verification code.', 'error');
      return;
    }
    
    try {
      showStatus('Verifying...', 'info');
      
      // For demonstration, we'll use a simulated API call
      // In production, replace with actual API call
      // Simulated API response
      const userData = {
        telegramId: 'user_' + Math.floor(Math.random() * 10000000),
        username: 'user_' + Math.floor(Math.random() * 10000),
        settings: {
          notifications: {
            priceAlerts: true,
            tradingUpdates: true
          },
          tradingSettings: {
            maxSlippage: 1,
            feeType: 'FAST',
            confirmTrades: true
          }
        }
      };
      
      // In production, use this code instead:
      /*
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ verificationCode })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Verification failed');
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.message || 'Verification failed');
      }
      
      const userData = data.user;
      */
      
      // Store user data in extension storage
      chrome.storage.local.set({
        authenticated: true,
        telegramId: userData.telegramId,
        username: userData.username,
        settings: userData.settings
      }, () => {
        showStatus('Success! Redirecting...', 'success');
        
        // Redirect to main popup
        setTimeout(() => {
          window.location.href = '../popup.html';
        }, 1000);
      });
    } catch (error) {
      showStatus(`Error: ${error.message || 'Verification failed'}`, 'error');
      codeInput.focus();
    }
  }
  
  /**
   * Show status message
   * @param {string} message - Message to show
   * @param {string} type - Message type (success/error/info)
   */
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = type;
  }
});
