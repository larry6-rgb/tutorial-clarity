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
    ? `http://localhost:3000/watch?url=${videoId}`
    : `http://localhost:3000`;
  
  window.open(appUrl, '_blank');
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

// Tutorial Clarity app URL — update this if running on a different port or domain
const TC_URL = 'http://localhost:3000';

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
  
  // Listen for Alt key
  document.addEventListener('keydown', handleAltPress);
}

// Wait for YouTube to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}