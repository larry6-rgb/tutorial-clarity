/**
 * Tutorial Clarity — Clipboard Watcher / Launcher
 *
 * Sits in the system tray and watches the clipboard every 1.5 seconds.
 * When a YouTube URL is detected, it opens Tutorial Clarity in the
 * default browser with that video loaded.
 *
 * Usage:
 *   cd electron-launcher
 *   npm install        (first time only)
 *   npm start
 */

const { app, clipboard, Tray, Menu, nativeImage, Notification, shell } = require('electron');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────
const TC_BASE_URL = 'http://localhost:3000';  // Tutorial Clarity dev server
const POLL_INTERVAL_MS = 1500;                // Check clipboard every 1.5s
// ────────────────────────────────────────────────────────────────────

let tray = null;
let lastClipboard = '';
let pollTimer = null;
let watchingEnabled = true;
let urlCount = 0;

/**
 * Extract a YouTube video URL from arbitrary clipboard text.
 * Returns the full watch URL or null.
 */
function extractYouTubeUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
    // Full URL patterns
    /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /https?:\/\/(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
  }
  return null;
}

/**
 * Open the detected YouTube URL in Tutorial Clarity.
 */
function openInTutorialClarity(youtubeUrl) {
  const encodedUrl = encodeURIComponent(youtubeUrl);
  const tcUrl = `${TC_BASE_URL}/watch?url=${encodedUrl}`;

  console.log(`[TC Launcher] Opening: ${tcUrl}`);
  shell.openExternal(tcUrl);
  urlCount++;

  // Show a notification
  if (Notification.isSupported()) {
    new Notification({
      title: '🎯 Tutorial Clarity',
      body: `Opening video in Tutorial Clarity...\n${youtubeUrl}`,
      silent: true,
    }).show();
  }

  updateTrayMenu();
}

/**
 * Poll the clipboard for YouTube URLs.
 */
function checkClipboard() {
  if (!watchingEnabled) return;

  try {
    const current = clipboard.readText().trim();

    // Only act if clipboard changed and contains a YouTube URL
    if (current && current !== lastClipboard) {
      lastClipboard = current;
      const ytUrl = extractYouTubeUrl(current);
      if (ytUrl) {
        openInTutorialClarity(ytUrl);
      }
    }
  } catch (err) {
    console.error('[TC Launcher] Clipboard read error:', err.message);
  }
}

/**
 * Build/rebuild the tray context menu.
 */
function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🎯 Tutorial Clarity Launcher',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: watchingEnabled ? '✅ Watching Clipboard' : '⏸ Paused',
      click: () => {
        watchingEnabled = !watchingEnabled;
        console.log(`[TC Launcher] Clipboard watching: ${watchingEnabled ? 'ON' : 'OFF'}`);
        updateTrayMenu();
      },
    },
    {
      label: `📊 URLs opened: ${urlCount}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '🌐 Open Tutorial Clarity',
      click: () => shell.openExternal(TC_BASE_URL),
    },
    { type: 'separator' },
    {
      label: '❌ Quit',
      click: () => {
        if (pollTimer) clearInterval(pollTimer);
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(watchingEnabled
    ? 'Tutorial Clarity — Watching clipboard for YouTube URLs'
    : 'Tutorial Clarity — Paused');
}

/**
 * Create a simple colored icon (no external image file needed).
 */
function createTrayIcon() {
  // 16×16 blue square icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2P8z8BQz0BAwMjAwPAfhRkZGRkYGBj+o4hhk2NgYGD4D1YAFUczCMUFDAwMDAyjYTDgYQAAlCkSEWfVJEgAAAAASUVORK5CYII='
  );
  return icon;
}

// ── App Lifecycle ───────────────────────────────────────────────────

app.whenReady().then(() => {
  // Prevent the dock icon on macOS (tray-only app)
  if (app.dock) app.dock.hide();

  // Initialize the clipboard state so we don't immediately trigger on
  // whatever was already copied before launching
  lastClipboard = clipboard.readText().trim();

  // Create system tray
  tray = new Tray(createTrayIcon());
  updateTrayMenu();

  // Start clipboard polling
  pollTimer = setInterval(checkClipboard, POLL_INTERVAL_MS);
  console.log('[TC Launcher] Started — watching clipboard for YouTube URLs');
  console.log(`[TC Launcher] Will open videos at: ${TC_BASE_URL}/watch?url=...`);

  // Show startup notification
  if (Notification.isSupported()) {
    new Notification({
      title: '🎯 Tutorial Clarity Launcher',
      body: 'Watching clipboard for YouTube URLs.\nCopy any YouTube link to auto-open it!',
      silent: true,
    }).show();
  }
});

// Keep the app running even without windows
app.on('window-all-closed', (e) => e.preventDefault());

// Cleanup on quit
app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer);
});
