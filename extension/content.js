// Tutorial Clarity - YouTube Extension
console.log('Tutorial Clarity extension loaded');

let altPressCount = 0;
let altPressTimer = null;
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
  const videoId = getCurrentVideoId();
  const appUrl = videoId
    ? `${TC_URL}/watch?url=${videoId}&open=saved`
    : `${TC_URL}`;

  // Pause and mute YouTube so it doesn't conflict with TC audio
  const video = document.querySelector('video');
  if (video) {
    video.pause();
    video.muted = true;
  }

  // Reuse existing TC tab if open, otherwise open new one
  chrome.runtime.sendMessage({ type: 'openTC', url: appUrl });
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

// Handle Alt key double-tap
function handleAltPress(e) {
  if (e.key === 'Alt') {
    altPressCount++;

    if (altPressTimer) {
      clearTimeout(altPressTimer);
    }

    if (altPressCount === 2) {
      // Double Alt press detected!
      saveCurrentVideo();
      altPressCount = 0;
    } else {
      // Reset after 500ms
      altPressTimer = setTimeout(() => {
        altPressCount = 0;
      }, 500);
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

  // Only handle if Alt is NOT held (Alt combos are reserved for save)
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
const TC_URL = 'https://tutorialclarity.com';

// Save current video — POSTs to Tutorial Clarity API so it appears in section 4
async function saveCurrentVideo() {
  const videoId = getCurrentVideoId();

  if (!videoId) {
    showNotification('No video selected — hover over a video first', 'error');
    return;
  }

  const title = currentFocusedVideo
    ? getVideoTitle(currentFocusedVideo)
    : document.title.replace(' - YouTube', '');

  try {
    const response = await fetch(`${TC_URL}/api/save-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, title }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.message === 'Already saved') {
      showNotification('Already in your saved list!', 'info');
    } else {
      showNotification('✅ Saved to Tutorial Clarity!', 'success');
    }
    console.log('[TC Extension] Saved:', videoId, title);
  } catch (err) {
    console.error('[TC Extension] Save failed:', err);
    showNotification('Could not reach Tutorial Clarity — is the app running?', 'error');
  }
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
  
  // Listen for Alt key (save) and TC shortcut keys
  document.addEventListener('keydown', handleAltPress);
  document.addEventListener('keydown', handleTCShortcut, true);
}

// Wait for YouTube to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}