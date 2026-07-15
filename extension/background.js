// Tutorial Clarity Background Script
console.log('Tutorial Clarity background script loaded');

const TC_BASE = 'http://localhost:3000'; // TEMP for local testing 2026-07-09 — revert to https://tutorial-clarity-production.up.railway.app before publishing

function extractYouTubeId(rawUrl) {
  if (!rawUrl) return null;
  const match = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (match) return match[1];
  const idMatch = rawUrl.match(/^([a-zA-Z0-9_-]{11})$/);
  if (idMatch) return idMatch[1];
  return rawUrl;
}

// Listen for extension icon clicks — if we're on a TC watch page, one-click back to the same
// moment on YouTube; otherwise fall back to opening TC's welcome page.
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.startsWith(TC_BASE) && tab.url.includes('/watch')) {
    try {
      const u = new URL(tab.url);
      const videoId = extractYouTubeId(u.searchParams.get('url'));
      const t = parseInt(u.searchParams.get('t') || '0', 10);
      if (videoId) {
        const dest = `https://www.youtube.com/watch?v=${videoId}${t > 0 ? `&t=${t}s` : ''}`;
        chrome.tabs.update(tab.id, { url: dest });
        return;
      }
    } catch (e) {
      console.warn('[Tutorial Clarity] Could not parse watch URL for return-to-YouTube', e);
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

  // Save-video fetch runs here (not in content.js) because a background service
  // worker fetch is exempt from Chrome's Private Network Access "loopback address
  // space" block that a page-context fetch from https://youtube.com hits when
  // targeting http://localhost — confirmed via console error 2026-07-11.
  if (message.type === 'SAVE_VIDEO') {
    fetch(`${TC_BASE}/api/save-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: message.videoId, title: message.title }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for the async sendResponse above
  }
});