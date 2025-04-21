// Check authentication status first
document.addEventListener('DOMContentLoaded', () => {
  // Check if user is authenticated
  chrome.storage.local.get(['authenticated', 'telegramId', 'username', 'settings'], (result) => {
    if (result.authenticated !== true || !result.telegramId) {
      // Not authenticated, redirect to login
      window.location.href = 'login/login.html';
      return;
    }
    
    // User is authenticated, continue with popup initialization
    initializePopup(result);
  });
});

// Default configuration
const DEFAULT_CONFIG = {
  buyPresets: ['0.1', '0.5', '1.0', '2.0', '5.0'],
  sellPresets: ['25%', '50%', '75%', '90%', '100%']
};

// Bot name - should match the one in your .env file
const BOT_NAME = 'Solonatest_bot';

// DOM elements
let buyForms;
let sellForms;
let saveButton;
let quickBuyForm;
let statusMessage;
let getCodeButton;
let startButton;
let userData;
let isRunning = false;

function initializePopup(userInfo) {
  // Store user data
  userData = userInfo;
  
  // Get form elements
  buyForms = document.querySelectorAll('input[name^="buy-"]');
  sellForms = document.querySelectorAll('input[name^="sell-"]');
  saveButton = document.getElementById('save-button');
  quickBuyForm = document.querySelector('input[name="quick-buy-amount"]');
  getCodeButton = document.getElementById('get-code-button');
  startButton = document.getElementById('start-button');
  
  // Add status message element
  statusMessage = document.createElement('div');
  statusMessage.id = 'status-message';
  document.body.appendChild(statusMessage);
  
  // Display user info
  const userInfoElem = document.getElementById('user-info');
  if (userInfoElem && userData.username) {
    userInfoElem.textContent = `@${userData.username}`;
  }
  
  // Add event listener to Get Code button
  if (getCodeButton) {
    getCodeButton.addEventListener('click', () => {
      // Open Telegram bot in a new tab to get a new code
      chrome.tabs.create({ url: `https://t.me/${BOT_NAME}?start=ref_QT_login_extension` });
    });
  }
  
  // Add event listener to Start button
  if (startButton) {
    startButton.addEventListener('click', toggleStartOperation);
  }
  
  // Load settings from storage
  loadSettings();
  
  // Add event listeners
  saveButton.addEventListener('click', saveSettings);
  
  // Quick buy functionality
  document.getElementById('quick-buy-button').addEventListener('click', () => {
    const amount = quickBuyForm.value;
    if (!amount || isNaN(parseFloat(amount))) {
      showStatus('Please enter a valid amount', 'error');
      return;
    }
    
    sendBuyCommand(amount);
  });
  
  // Check if the bot was already running
  chrome.storage.local.get(['botRunning'], (result) => {
    if (result.botRunning === true) {
      isRunning = true;
      updateStartButtonUI();
    }
  });
}

/**
 * Toggle the start/stop operation
 */
function toggleStartOperation() {
  isRunning = !isRunning;
  
  if (isRunning) {
    startOperation();
  } else {
    stopOperation();
  }
  
  // Update UI
  updateStartButtonUI();
  
  // Save state
  chrome.storage.local.set({ botRunning: isRunning });
}

/**
 * Update the start button UI based on running state
 */
function updateStartButtonUI() {
  if (isRunning) {
    startButton.textContent = 'Stop';
    startButton.style.backgroundColor = '#f44336';
    showStatus('Bot started successfully!', 'success');
  } else {
    startButton.textContent = 'Start';
    startButton.style.backgroundColor = '#2196F3';
    showStatus('Bot stopped', 'info');
  }
}

/**
 * Start the bot operation
 */
function startOperation() {
  console.log('Starting bot operation...');
  
  // Send message to background script to start the operation
  chrome.runtime.sendMessage({ action: 'startBot', userData: userData }, (response) => {
    if (response && response.success) {
      console.log('Bot started successfully');
    } else {
      console.error('Failed to start bot:', response ? response.error : 'Unknown error');
      isRunning = false;
      updateStartButtonUI();
    }
  });
}

/**
 * Stop the bot operation
 */
function stopOperation() {
  console.log('Stopping bot operation...');
  
  // Send message to background script to stop the operation
  chrome.runtime.sendMessage({ action: 'stopBot' }, (response) => {
    if (response && response.success) {
      console.log('Bot stopped successfully');
    } else {
      console.error('Failed to stop bot:', response ? response.error : 'Unknown error');
    }
  });
}

/**
 * Load settings from storage
 */
function loadSettings() {
  try {
    // First check for settings in user data
    if (userData && userData.settings) {
      applySettings(userData.settings);
    } else {
      // If not available, load from sync storage
      chrome.storage.sync.get(['settings', 'buyPresets', 'sellPresets'], (result) => {
        if (result.settings) {
          applySettings(result.settings);
        } else {
          // For backward compatibility, load old format
          const buyValues = result.buyPresets || DEFAULT_CONFIG.buyPresets;
          const sellValues = result.sellPresets || DEFAULT_CONFIG.sellPresets;
          
          // Set values in forms
          buyForms.forEach((input, index) => {
            input.value = buyValues[index] || '';
          });
          
          sellForms.forEach((input, index) => {
            input.value = sellValues[index] || '';
          });
        }
      });
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Failed to load settings', 'error');
  }
}

/**
 * Apply settings to the UI
 * @param {Object} settings - User settings
 */
function applySettings(settings) {
  try {
    // Extract presets from settings or use defaults
    const buyValues = 
      (settings.tradingSettings && settings.tradingSettings.buyPresets) || 
      DEFAULT_CONFIG.buyPresets;
    
    const sellValues = 
      (settings.tradingSettings && settings.tradingSettings.sellPresets) || 
      DEFAULT_CONFIG.sellPresets;
    
    // Set values in forms
    buyForms.forEach((input, index) => {
      input.value = buyValues[index] || '';
    });
    
    sellForms.forEach((input, index) => {
      input.value = sellValues[index] || '';
    });
  } catch (error) {
    console.error('Error applying settings:', error);
  }
}

/**
 * Save settings to storage
 */
function saveSettings() {
  try {
    const buyValues = Array.from(buyForms).map(input => input.value);
    const sellValues = Array.from(sellForms).map(input => input.value);
    
    // Create settings object
    const settings = {
      tradingSettings: {
        buyPresets: buyValues,
        sellPresets: sellValues
      }
    };
    
    // Update local storage
    chrome.storage.local.set({
      settings: settings
    });
    
    // Update sync storage for cross-device sync
    chrome.storage.sync.set({
      settings: settings
    }, () => {
      showStatus('Settings saved successfully!', 'success');
    });
    
    // If API endpoint is available, sync with server
    syncSettingsWithServer(settings);
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Failed to save settings', 'error');
  }
}

/**
 * Sync settings with server
 * @param {Object} settings - Settings to sync
 */
function syncSettingsWithServer(settings) {
  // Skip if no telegram ID available
  if (!userData || !userData.telegramId) return;
  
  // In a real implementation, you would call your API here
  // For demonstration, we'll just log to console
  console.log('Syncing settings with server for user:', userData.telegramId);
  
  // Example API call (commented out):
  /*
  fetch('https://api.yourdomain.com/api/extension/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      telegramId: userData.telegramId,
      settings: settings
    })
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      console.log('Settings synced successfully');
    } else {
      console.error('Settings sync failed:', data.message);
    }
  })
  .catch(error => {
    console.error('Error syncing settings:', error);
  });
  */
}

/**
 * Send buy command
 * @param {string} amount - Amount to buy
 */
function sendBuyCommand(amount) {
  // In a real implementation, this would execute the buy command
  // For demonstration, we'll just show a success message
  showStatus(`Buy order for ${amount} SOL submitted!`, 'success');
}

/**
 * Show status message
 * @param {string} message - Message to show
 * @param {string} type - Message type (success/error/info)
 */
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = type;
  
  // Clear status after a delay
  setTimeout(() => {
    statusMessage.textContent = '';
    statusMessage.className = '';
  }, 3000);
}
