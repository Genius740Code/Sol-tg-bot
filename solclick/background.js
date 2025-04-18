chrome.runtime.onInstalled.addListener(() => {
  console.log('SolClick extension installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'log') {
    console.log('Log from extension:', message.data);
  }
  
  return true;
});
