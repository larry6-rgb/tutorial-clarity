// Tutorial Clarity Background Script
console.log('Tutorial Clarity background script loaded');

// Listen for extension icon clicks
chrome.action.onClicked.addListener((tab) => {
  // Open Tutorial Clarity app
  chrome.tabs.create({
    url: 'http://localhost:3000'
  });
});