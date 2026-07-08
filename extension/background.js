// Tutorial Clarity Background Script
console.log('Tutorial Clarity background script loaded');

const TC_BASE = 'https://tutorial-clarity-production.up.railway.app';

// Listen for extension icon clicks — on a YouTube tab, toggle the video
// indexing overlay (index-overlay.js); everywhere else, open/focus the TC web app.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.includes('youtube.com')) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_INDEX_OVERLAY' });
      return;
    } catch (e) {
      console.warn('Tutorial Clarity: could not reach content script for overlay toggle', e);
    }
  }
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