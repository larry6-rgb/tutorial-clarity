// Tutorial Clarity - YouTube Extension
console.log('Tutorial Clarity extension loaded');

// TEMP DEBUG — logs every key press/release so we can see whether ANY keydown reaches the page,
// whether Alt specifically is being swallowed, and whether it's cleanly releasing between taps.
// Remove once diagnosed.
document.addEventListener('keydown', (e) => {
  console.log('[TC DEBUG] KEYDOWN:', e.key, '| repeat:', e.repeat);
}, true);
document.addEventListener('keyup', (e) => {
  console.log('[TC DEBUG] KEYUP:', e.key);
}, true);

let capsPressCount = 0;
let capsPressTimer = null;
let lastCapsPressTime = null;
let currentFocusedVideo = null;
let floatingIcon = null;

// Create floating icon
function createFloatingIcon() {
  if (floatingIcon) return;
  
  floatingIcon = document.createElement('div');
  floatingIcon.id = 'tutorial-clarity-icon';
  floatingIcon.innerHTML = `
    <img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="Tutorial Clarity" />
  `;
  floatingIcon.title = 'Click to open Tutorial Clarity';
  document.body.appendChild(floatingIcon);
  
  floatingIcon.addEventListener('click', handleIconClick);
}

// Handle icon click
function handleIconClick() {
  const base = 'http://localhost:3000'; // TEMP for local testing 2026-07-09 — revert to https://tutorial-clarity-production.up.railway.app before publishing
  const videoId = getCurrentVideoId();
  const appUrl = videoId ? `${base}/watch?url=${videoId}` : base;

  // Pause and mute YouTube so it doesn't conflict with TC audio
  const video = document.querySelector('video');
  if (video) {
    video.pause();
    video.muted = true;
  }

  // Use background script to open tab (avoids popup blocker)
  chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: appUrl });
}

// Get current video ID from focused/hovered element or current page
function getCurrentVideoId() {
  // If a video is focused/hovered
  if (currentFocusedVideo) {
    const link = currentFocusedVideo.querySelector('a#thumbnail, a.yt-simple-endpoint');
    if (link) {
      const url = link.href;
      const match = url.match(/[?&]v=([^&]+)/);
      if (match) return match[1];
    }
  }
  
  // If watching a video, get current video ID
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Get video title
function getVideoTitle(videoElement) {
  const titleElement = videoElement.querySelector('#video-title, .title');
  return titleElement ? titleElement.textContent.trim() : 'Unknown Title';
}

// Track focused/hovered video
function trackVideoFocus() {
  const videoElements = document.querySelectorAll('ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer');
  
  videoElements.forEach(video => {
    video.addEventListener('mouseenter', () => {
      currentFocusedVideo = video;
    });
    
    video.addEventListener('mouseleave', () => {
      if (currentFocusedVideo === video) {
        currentFocusedVideo = null;
      }
    });
    
    video.addEventListener('focus', () => {
      currentFocusedVideo = video;
    }, true);
  });
}

// Handle Caps Lock double-tap
// Switched from Alt (2026-07-11): standalone Alt keyup is intercepted by
// Chrome/Windows for menu-bar focus, which was silently swallowing the
// second tap. Caps Lock has no such OS-level meaning, and two taps cancel
// out the caps-state toggle so there's no lasting side effect.
function handleCapsPress(e) {
  if (e.key === 'CapsLock') {
    const now = Date.now();
    const gap = lastCapsPressTime ? now - lastCapsPressTime : null;
    lastCapsPressTime = now;
    capsPressCount++;
    console.log('[TC Extension] Caps Lock press detected, count:', capsPressCount, '— gap since last press (ms):', gap);

    if (capsPressTimer) {
      clearTimeout(capsPressTimer);
    }

    if (capsPressCount === 2) {
      // Double Caps Lock press detected!
      console.log('[TC Extension] Double-tap detected, calling saveCurrentVideo()');
      saveCurrentVideo();
      capsPressCount = 0;
    } else {
      // Reset after 3000ms — generous window since a deliberate double-tap
      // gesture is often slower than it feels in the moment.
      capsPressTimer = setTimeout(() => {
        capsPressCount = 0;
      }, 3000);
    }
  }
}

// ── Keyboard shortcuts — open Tutorial Clarity to a specific section ──
// These only fire when the user is NOT typing in a text field.
const TC_SECTION_KEYS = {
  ' ': null,        // Space — open TC without jumping to a section (play/pause)
  'm': 'audio',
  ',': 'playback',
  '.': 'playback',
  's': 'saved',
  'a': 'clarify',
  'v': 'speakers',
  't': 'scroll',
  'z': 'zoom',
  'r': 'resume',
  'u': 'summary',
  'x': 'transcriptdoc',
  'k': 'shortcuts',
  '?': 'tutorial',
};

function handleTCShortcut(e) {
  // Don't intercept when user is typing
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) return;

  // Only handle if no modifier is held, to avoid firing on OS/browser accelerator combos
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  const key = e.key;
  if (!(key in TC_SECTION_KEYS)) return;

  // Only act when watching a video
  const videoId = getCurrentVideoId();
  if (!videoId) return;

  e.preventDefault();
  e.stopPropagation();

  // S key: save the video first, then open the saved section
  if (key === 's') {
    saveCurrentVideo();
  }

  const section = TC_SECTION_KEYS[key];
  const url = section
    ? `${TC_URL}/watch?url=${videoId}&open=${section}`
    : `${TC_URL}/watch?url=${videoId}`;

  // Pause and mute YouTube so it doesn't conflict with TC audio.
  // YouTube fights back against programmatic volume changes, so we pause
  // the video entirely — that guarantees silence in the background tab.
  const video = document.querySelector('video');
  if (video) {
    video.pause();
    video.muted = true;
  }

  // Focus existing TC tab if open, otherwise open a new one
  chrome.runtime.sendMessage({ type: 'openTC', url });
}

// Tutorial Clarity app URL
const TC_URL = 'http://localhost:3000'; // TEMP for local testing 2026-07-09 — revert to https://tutorialclarity.com before publishing

// Save current video — POSTs to Tutorial Clarity API so it appears in section 4
function saveCurrentVideo() {
  const videoId = getCurrentVideoId();

  if (!videoId) {
    showNotification('No video selected — hover over a video first', 'error');
    return;
  }

  const title = currentFocusedVideo
    ? getVideoTitle(currentFocusedVideo)
    : document.title.replace(' - YouTube', '');

  // Routed through the background service worker, not fetched here directly —
  // a page-context fetch from https://youtube.com to http://localhost gets
  // blocked by Chrome's Private Network Access policy ("loopback address
  // space" denied). The background worker's fetch is exempt from that check.
  chrome.runtime.sendMessage({ type: 'SAVE_VIDEO', videoId, title }, (result) => {
    if (!result || !result.ok) {
      console.error('[TC Extension] Save failed:', result && result.error);
      showNotification('Could not reach Tutorial Clarity — is the app running?', 'error');
      return;
    }

    if (result.data.message === 'Already saved') {
      showNotification('Already in your saved list!', 'info');
    } else {
      showNotification('✅ Saved to Tutorial Clarity!', 'success');
    }
    console.log('[TC Extension] Saved:', videoId, title);
  });
}

// Show notification
function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `tutorial-clarity-notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Initialize
function init() {
  createFloatingIcon();
  trackVideoFocus();
  
  // Re-track videos when page content changes
  const observer = new MutationObserver(() => {
    trackVideoFocus();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Listen for Caps Lock (save) and TC shortcut keys — capture phase so we see the
  // event before YouTube's own player-level keyboard handling can intercept it.
  document.addEventListener('keydown', handleCapsPress, true);
  document.addEventListener('keydown', handleTCShortcut, true);
}

// Wait for YouTube to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}