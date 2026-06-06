// Tutorial Clarity Background Script
console.log('Tutorial Clarity background script loaded');

// Listen for extension icon clicks
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: 'https://tutorialclarity.com' });
});

// Open TC to a specific section — reuse existing TC tab if one is already open
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'openTC') return;

  const targetUrl = message.url;

  chrome.tabs.query({ url: 'https://tutorialclarity.com/*' }, (tabs) => {
    if (tabs.length > 0) {
      // TC is already open — update its URL and bring it to the front
      chrome.tabs.update(tabs[0].id, { url: targetUrl, active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      // No TC tab — open a new one
      chrome.tabs.create({ url: targetUrl });
    }
  });
});