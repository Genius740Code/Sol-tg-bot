// Check authentication status first
document.addEventListener('DOMContentLoaded', initExtension);

// Default configuration
const DEFAULT_CONFIG = {
  buyPresets: ['0.1', '0.5', '1.0', '2.0', '5.0'],
  sellPresets: ['25%', '50%', '75%', '90%', '100%']
};

// Bot name - should match the one in your .env file
const BOT_NAME = 'Solonatest_bot';

// Cache DOM elements for better performance
const DOM = {
  buyForms: null,
  sellForms: null,
  saveButton: null,
  quickBuyForm: null,
  statusMessage: null,
  getCodeButton: null,
  startButton: null,
  userInfoElem: null,
  quickBuyButton: null
};

// Global state management
const state = {
  userData: null,
  isRunning: false,
  statusTimeout: null,
  pendingRequests: 0,
  lastUpdateTime: 0
};

/**
 * Initialize the extension
 */
function initExtension() {
  // Check if user is authenticated
  chrome.storage.local.get(['authenticated', 'telegramId', 'username', 'settings', 'botRunning'], (result) => {
    if (result.authenticated !== true || !result.telegramId) {
      // Not authenticated, redirect to login
      window.location.href = 'login/login.html';
      return;
    }
    
    // User is authenticated, continue with popup initialization
    state.userData = result;
    state.isRunning = result.botRunning === true;
    
    // Cache DOM elements for better performance
    cacheDOMElements();
    
    // Add event listeners
    setupEventListeners();
    
    // Initialize UI components
    initializeUI();
    
    // Load settings from storage
    loadSettings();
  });
}

/**
 * Cache DOM elements for better performance
 */
function cacheDOMElements() {
  // Forms and buttons
  DOM.buyForms = document.querySelectorAll('input[name^="buy-"]');
  DOM.sellForms = document.querySelectorAll('input[name^="sell-"]');
  DOM.saveButton = document.getElementById('save-button');
  DOM.quickBuyForm = document.querySelector('input[name="quick-buy-amount"]');
  DOM.getCodeButton = document.getElementById('get-code-button');
  DOM.startButton = document.getElementById('start-button');
  DOM.userInfoElem = document.getElementById('user-info');
  DOM.quickBuyButton = document.getElementById('quick-buy-button');
  
  // Create status message element if it doesn't exist
  DOM.statusMessage = document.getElementById('status-message');
  if (!DOM.statusMessage) {
    DOM.statusMessage = document.createElement('div');
    DOM.statusMessage.id = 'status-message';
    document.body.appendChild(DOM.statusMessage);
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Add debounced event listeners using event delegation where possible
  if (DOM.saveButton) {
    DOM.saveButton.addEventListener('click', debounce(saveSettings, 300));
  }
  
  if (DOM.getCodeButton) {
    DOM.getCodeButton.addEventListener('click', debounce(() => {
      chrome.tabs.create({ url: `https://t.me/${BOT_NAME}?start=ref_QT_login_extension` });
    }, 300));
  }
  
  if (DOM.startButton) {
    DOM.startButton.addEventListener('click', debounce(toggleStartOperation, 500));
  }
  
  if (DOM.quickBuyButton) {
    DOM.quickBuyButton.addEventListener('click', debounce(() => {
      const amount = DOM.quickBuyForm.value;
      if (!amount || isNaN(parseFloat(amount))) {
        showStatus('Please enter a valid amount', 'error');
        return;
      }
      
      sendBuyCommand(amount);
    }, 300));
  }
  
  // Add unload event to properly clean up resources
  window.addEventListener('unload', cleanup);
}

/**
 * Initialize UI components based on state
 */
function initializeUI() {
  // Display user info
  if (DOM.userInfoElem && state.userData.username) {
    DOM.userInfoElem.textContent = `@${state.userData.username}`;
  }
  
  // Set initial button state
  updateStartButtonUI();
}

/**
 * Toggle the start/stop operation with debouncing
 */
function toggleStartOperation() {
  // Prevent multiple rapid clicks
  if (state.pendingRequests > 0) {
    showStatus('Please wait...', 'info');
    return;
  }
  
  state.pendingRequests++;
  state.isRunning = !state.isRunning;
  
  try {
    if (state.isRunning) {
      startOperation();
    } else {
      stopOperation();
    }
    
    // Update UI
    updateStartButtonUI();
    
    // Save state
    chrome.storage.local.set({ botRunning: state.isRunning });
  } finally {
    state.pendingRequests--;
  }
}

/**
 * Update the start button UI based on running state
 */
function updateStartButtonUI() {
  if (!DOM.startButton) return;
  
  if (state.isRunning) {
    DOM.startButton.textContent = 'Stop';
    DOM.startButton.style.backgroundColor = '#f44336';
    showStatus('Bot started successfully!', 'success');
  } else {
    DOM.startButton.textContent = 'Start';
    DOM.startButton.style.backgroundColor = '#2196F3';
    showStatus('Bot stopped', 'info');
  }
}

/**
 * Start the bot operation
 */
function startOperation() {
  console.log('Starting bot operation...');
  
  // Send message to background script to start the operation
  chrome.runtime.sendMessage({ 
    action: 'startBot', 
    userData: state.userData 
  }, (response) => {
    if (response && response.success) {
      console.log('Bot started successfully');
    } else {
      console.error('Failed to start bot:', response ? response.error : 'Unknown error');
      state.isRunning = false;
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
 * Load settings from storage with caching
 */
function loadSettings() {
  try {
    // First check for settings in user data
    if (state.userData && state.userData.settings) {
      applySettings(state.userData.settings);
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
          DOM.buyForms.forEach((input, index) => {
            input.value = buyValues[index] || '';
          });
          
          DOM.sellForms.forEach((input, index) => {
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
 * Apply settings to the form fields
 * @param {Object} settings - Settings object
 */
function applySettings(settings) {
  if (!settings) return;
  
  try {
    // Apply buy presets
    if (settings.buyPresets && DOM.buyForms) {
      DOM.buyForms.forEach((input, index) => {
        input.value = index < settings.buyPresets.length ? settings.buyPresets[index] : '';
      });
    }
    
    // Apply sell presets
    if (settings.sellPresets && DOM.sellForms) {
      DOM.sellForms.forEach((input, index) => {
        input.value = index < settings.sellPresets.length ? settings.sellPresets[index] : '';
      });
    }
    
    // Apply quick buy amount if it exists
    if (settings.quickBuyAmount && DOM.quickBuyForm) {
      DOM.quickBuyForm.value = settings.quickBuyAmount;
    }
  } catch (error) {
    console.error('Error applying settings:', error);
  }
}

/**
 * Save settings with validation and debouncing
 */
function saveSettings() {
  try {
    if (state.pendingRequests > 0) {
      showStatus('Please wait...', 'info');
      return;
    }
    
    state.pendingRequests++;
    
    // Collect buy presets
    const buyPresets = Array.from(DOM.buyForms)
      .map(input => input.value.trim())
      .filter(value => value !== '');
    
    // Collect sell presets
    const sellPresets = Array.from(DOM.sellForms)
      .map(input => input.value.trim())
      .filter(value => value !== '');
    
    // Get quick buy amount
    const quickBuyAmount = DOM.quickBuyForm ? DOM.quickBuyForm.value.trim() : '';
    
    // Create settings object
    const settings = {
      buyPresets,
      sellPresets,
      quickBuyAmount
    };
    
    // Save settings to sync and local storage
    chrome.storage.sync.set({ settings }, () => {
      // Save to local storage as well
      chrome.storage.local.set({ settings }, () => {
        // Sync with server
        syncSettingsWithServer(settings);
      });
    });
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
  } finally {
    state.pendingRequests--;
  }
}

/**
 * Sync settings with the server
 * @param {Object} settings - Settings object
 */
function syncSettingsWithServer(settings) {
  try {
    // Only continue if we have user ID
    if (!state.userData || !state.userData.telegramId) {
      console.error('User data not available for settings sync');
      return;
    }
    
    // Send settings to background script for server sync
    chrome.runtime.sendMessage({
      action: 'syncSettings',
      settings: settings,
      telegramId: state.userData.telegramId
    }, response => {
      if (response && response.success) {
        showStatus('Settings saved successfully!', 'success');
      } else {
        // Still show success if local save worked but server sync failed
        showStatus('Settings saved locally', 'success');
        console.warn('Server sync failed:', response ? response.error : 'Unknown error');
      }
    });
  } catch (error) {
    console.error('Error syncing settings with server:', error);
  }
}

/**
 * Send buy command
 * @param {string} amount - Amount to buy
 */
function sendBuyCommand(amount) {
  chrome.runtime.sendMessage({
    action: 'quickBuy',
    amount: amount,
    telegramId: state.userData.telegramId
  }, response => {
    if (response && response.success) {
      showStatus(`Buy order for ${amount} SOL sent!`, 'success');
    } else {
      showStatus('Failed to send buy order', 'error');
    }
  });
}

/**
 * Show status message with type styling
 * @param {string} message - Message to show
 * @param {string} type - Message type (success, error, info)
 */
function showStatus(message, type = 'info') {
  if (!DOM.statusMessage) return;
  
  // Clear any existing timeout
  if (state.statusTimeout) {
    clearTimeout(state.statusTimeout);
  }
  
  // Set message and style
  DOM.statusMessage.textContent = message;
  DOM.statusMessage.className = `status-message ${type}`;
  DOM.statusMessage.style.display = 'block';
  
  // Auto-hide after 3 seconds
  state.statusTimeout = setTimeout(() => {
    DOM.statusMessage.style.display = 'none';
  }, 3000);
}

/**
 * Cleanup function to prevent memory leaks
 */
function cleanup() {
  // Clear any timeouts
  if (state.statusTimeout) {
    clearTimeout(state.statusTimeout);
  }
  
  // Null out references
  state.userData = null;
}

/**
 * Debounce function to limit rapid function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} - Debounced function
 */
function debounce(func, wait) {
  let timeout;
  
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
