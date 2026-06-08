// Tutorial Clarity Background Script
console.log('Tutorial Clarity background script loaded');

const TC_BASE = 'https://tutorial-clarity-production.up.railway.app';

// Listen for extension icon clicks
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: TC_BASE });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_TAB' && message.url) {
    chrome.tabs.query({ url: TC_BASE + '/*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url: message.url, active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: message.url });
      }
    });
  }
});