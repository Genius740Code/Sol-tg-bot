/**
 * SolClick Extension - Login Script
 * Handles authentication for the extension
 */

document.addEventListener('DOMContentLoaded', () => {
  const verifyButton = document.getElementById('verify-button');
  const codeInput = document.getElementById('code');
  const statusMessage = document.getElementById('status-message');
  
  // The passcode is hardcoded as "1234"
  const PASSCODE = "1234";
  
  // Check if user is already logged in
  chrome.storage.local.get(['authenticated'], (result) => {
    if (result.authenticated === true) {
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
  
  /**
   * Verify the entered code
   */
  function verifyCode() {
    const enteredCode = codeInput.value;
    
    if (enteredCode === PASSCODE) {
      // Set authenticated flag in storage
      chrome.storage.local.set({ authenticated: true }, () => {
        showStatus('Success! Redirecting...', 'success');
        
        // Redirect to main popup
        setTimeout(() => {
          window.location.href = '../popup.html';
        }, 1000);
      });
    } else {
      showStatus('Invalid code. Please try again.', 'error');
      codeInput.value = '';
      codeInput.focus();
    }
  }
  
  /**
   * Show status message
   * @param {string} message - Message to show
   * @param {string} type - Message type (success/error)
   */
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = type;
  }
});
