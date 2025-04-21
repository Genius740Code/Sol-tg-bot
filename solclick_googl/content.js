
// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'quickBuy') {
    console.log('Quick buy requested for amount:', message.amount);
    setTimeout(() => {
      sendResponse({ success: true });
    }, 500);
    
    return true;
  }
});
