// Check authentication status first
document.addEventListener('DOMContentLoaded', () => {
  // Check if user is authenticated
  chrome.storage.local.get(['authenticated'], (result) => {
    if (result.authenticated !== true) {
      // Not authenticated, redirect to login
      window.location.href = 'login/login.html';
      return;
    }
    
    // User is authenticated, continue with popup initialization
    initializePopup();
  });
});

// Default configuration
const DEFAULT_CONFIG = {
  buyPresets: ['0.1', '0.5', '1.0', '2.0', '5.0'],
  sellPresets: ['25%', '50%', '75%', '90%', '100%']
};

// DOM elements
let buyForms;
let sellForms;
let saveButton;
let quickBuyForm;
let statusMessage;

function initializePopup() {
  // Get form elements
  buyForms = document.querySelectorAll('input[name^="buy-"]');
  sellForms = document.querySelectorAll('input[name^="sell-"]');
  saveButton = document.getElementById('save-button');
  quickBuyForm = document.querySelector('input[name="quick-buy-amount"]');
  
  // Add status message element
  statusMessage = document.createElement('div');
  statusMessage.id = 'status-message';
  document.body.appendChild(statusMessage);
  
  // Add logout button
  const logoutButton = document.createElement('button');
  logoutButton.id = 'logout-button';
  logoutButton.textContent = 'Logout';
  logoutButton.style.marginTop = '10px';
  document.querySelector('.container').appendChild(logoutButton);
  
  // Add logout event listener
  logoutButton.addEventListener('click', () => {
    chrome.storage.local.remove(['authenticated'], () => {
      window.location.href = 'login/login.html';
    });
  });
  
  // Load saved presets
  loadSavedPresets();
  
  // Add event listeners
  saveButton.addEventListener('click', savePresets);
  
  // Setup quick buy action
  document.getElementById('quick-buy-button').addEventListener('click', handleQuickBuy);
}

/**
 * Load saved presets from storage
 */
function loadSavedPresets() {
  chrome.storage.sync.get(['buyPresets', 'sellPresets'], (result) => {
    const buyValues = result.buyPresets || DEFAULT_CONFIG.buyPresets;
    const sellValues = result.sellPresets || DEFAULT_CONFIG.sellPresets;
    
    // Set values in forms
    buyForms.forEach((input, index) => {
      input.value = buyValues[index] || '';
    });
    
    sellForms.forEach((input, index) => {
      input.value = sellValues[index] || '';
    });
  });
}

/**
 * Save presets to storage
 */
function savePresets() {
  const buyValues = Array.from(buyForms).map(input => input.value);
  const sellValues = Array.from(sellForms).map(input => input.value);
  
  chrome.storage.sync.set({
    buyPresets: buyValues,
    sellPresets: sellValues
  }, () => {
    showStatus('Presets saved successfully!', 'success');
  });
}

/**
 * Handle quick buy action
 */
function handleQuickBuy() {
  const amount = quickBuyForm.value;
  
  if (!amount || isNaN(parseFloat(amount))) {
    showStatus('Please enter a valid amount', 'error');
    return;
  }
  
  // Send message to content script for processing
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, {
      action: 'quickBuy',
      amount: amount
    }, (response) => {
      if (response && response.success) {
        showStatus('Buy order submitted!', 'success');
      } else {
        showStatus('Failed to submit buy order', 'error');
      }
    });
  });
}

/**
 * Show status message
 * @param {string} message - Message to show
 * @param {string} type - Message type (success/error)
 */
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = type;
  
  // Clear status after 3 seconds
  setTimeout(() => {
    statusMessage.textContent = '';
    statusMessage.className = '';
  }, 3000);
}
