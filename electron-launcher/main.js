/**
 * Tutorial Clarity — Two-Step Clipboard Launcher
 *
 * Sits in the system tray and watches the clipboard for YouTube URLs.
 *
 * TWO-STEP WORKFLOW:
 *   1. User copies a YouTube URL
 *   2. PINK popup: "I see that you have selected a URL" (clickable)
 *   3. User clicks pink popup
 *   4. ORANGE popup: "Pause the video then click here to view in Tutorial Clarity"
 *   5. User pauses their YouTube video
 *   6. User clicks orange popup
 *   7. Tutorial Clarity opens in default browser with that video
 *
 * This two-step flow prevents YouTube audio overlapping with AI audio.
 *
 * Usage:
 *   cd electron-launcher
 *   npm install        (first time only)
 *   npm start
 */

const { app, clipboard, Tray, Menu, nativeImage, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────
const TC_BASE_URL = 'http://localhost:3000';
const POLL_INTERVAL_MS = 1500;
// ────────────────────────────────────────────────────────────────────

let tray = null;
let lastClipboard = '';
let pollTimer = null;
let watchingEnabled = true;
let urlCount = 0;
let notificationWindow = null;
let pendingYouTubeUrl = null;

// ── YouTube URL Detection ───────────────────────────────────────────

function extractYouTubeUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
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

// ── Custom Notification Windows ─────────────────────────────────────

function createNotificationWindow(html, onClick) {
  // Close any existing notification
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.close();
  }

  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  const winW = 420;
  const winH = 120;

  notificationWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: screenW - winW - 20,
    y: screenH - winH - 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  notificationWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  notificationWindow.once('ready-to-show', () => {
    notificationWindow.show();
  });

  // Handle click from the renderer
  ipcMain.removeAllListeners('notification-clicked');
  ipcMain.once('notification-clicked', () => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.close();
    }
    notificationWindow = null;
    if (onClick) onClick();
  });

  // Handle dismiss (X button)
  ipcMain.removeAllListeners('notification-dismissed');
  ipcMain.once('notification-dismissed', () => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.close();
    }
    notificationWindow = null;
    pendingYouTubeUrl = null;
  });

  // Auto-dismiss after 15 seconds
  setTimeout(() => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.close();
      notificationWindow = null;
    }
  }, 15000);
}

function buildNotificationHtml(bgColor, borderColor, emoji, title, subtitle, buttonText) {
  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: transparent;
    overflow: hidden;
    -webkit-app-region: no-drag;
    cursor: default;
  }
  .notification {
    background: ${bgColor};
    border: 3px solid ${borderColor};
    border-radius: 14px;
    padding: 16px 20px;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.1);
    position: relative;
  }
  .dismiss {
    position: absolute;
    top: 8px;
    right: 12px;
    background: none;
    border: none;
    color: rgba(255,255,255,0.7);
    font-size: 18px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .dismiss:hover { color: white; background: rgba(255,255,255,0.15); }
  .title {
    color: white;
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 6px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.2);
  }
  .subtitle {
    color: rgba(255,255,255,0.9);
    font-size: 12px;
    margin-bottom: 10px;
  }
  .action-btn {
    background: rgba(255,255,255,0.2);
    border: 2px solid rgba(255,255,255,0.5);
    color: white;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    align-self: flex-start;
  }
  .action-btn:hover {
    background: rgba(255,255,255,0.35);
    border-color: white;
    transform: scale(1.02);
  }
</style>
</head>
<body>
  <div class="notification">
    <button class="dismiss" id="dismissBtn">✕</button>
    <div class="title">${emoji} ${title}</div>
    <div class="subtitle">${subtitle}</div>
    <button class="action-btn" id="actionBtn">${buttonText}</button>
  </div>
  <script>
    document.getElementById('actionBtn').addEventListener('click', () => {
      window.electronAPI.notificationClicked();
    });
    document.getElementById('dismissBtn').addEventListener('click', () => {
      window.electronAPI.notificationDismissed();
    });
  </script>
</body>
</html>`;
}

// ── Step 1: Pink Notification ───────────────────────────────────────

function showStep1Notification(youtubeUrl) {
  pendingYouTubeUrl = youtubeUrl;

  const html = buildNotificationHtml(
    'linear-gradient(135deg, #ec4899, #db2777)',  // Pink gradient
    '#f472b6',                                     // Pink border
    '🔗',                                          // Emoji
    'I see that you have selected a URL',          // Title
    youtubeUrl,                                     // Subtitle (show the URL)
    '👆 Click here to continue'                    // Button text
  );

  createNotificationWindow(html, () => {
    // Step 1 clicked → show Step 2
    showStep2Notification(youtubeUrl);
  });

  console.log(`[TC Launcher] Step 1: Detected YouTube URL → ${youtubeUrl}`);
}

// ── Step 2: Orange Notification ─────────────────────────────────────

function showStep2Notification(youtubeUrl) {
  const html = buildNotificationHtml(
    'linear-gradient(135deg, #f59e0b, #d97706)',  // Orange/amber gradient
    '#fbbf24',                                     // Yellow border
    '⏸️',                                          // Emoji
    'Pause the video, then click here',            // Title
    'to view in Tutorial Clarity',                 // Subtitle
    '🎯 Open in Tutorial Clarity'                  // Button text
  );

  createNotificationWindow(html, () => {
    // Step 2 clicked → open Tutorial Clarity
    openInTutorialClarity(youtubeUrl);
  });

  console.log(`[TC Launcher] Step 2: Waiting for user to pause video and click...`);
}

// ── Open Tutorial Clarity ───────────────────────────────────────────

function openInTutorialClarity(youtubeUrl) {
  const encodedUrl = encodeURIComponent(youtubeUrl);
  const tcUrl = `${TC_BASE_URL}/watch?url=${encodedUrl}`;

  console.log(`[TC Launcher] Opening Tutorial Clarity: ${tcUrl}`);
  shell.openExternal(tcUrl);
  urlCount++;
  pendingYouTubeUrl = null;
  updateTrayMenu();
}

// ── Clipboard Polling ───────────────────────────────────────────────

function checkClipboard() {
  if (!watchingEnabled) return;

  try {
    const current = clipboard.readText().trim();
    if (current && current !== lastClipboard) {
      lastClipboard = current;
      const ytUrl = extractYouTubeUrl(current);
      if (ytUrl) {
        showStep1Notification(ytUrl);
      }
    }
  } catch (err) {
    console.error('[TC Launcher] Clipboard read error:', err.message);
  }
}

// ── Tray Menu ───────────────────────────────────────────────────────

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: '🎯 Tutorial Clarity Launcher', enabled: false },
    { type: 'separator' },
    {
      label: watchingEnabled ? '✅ Watching Clipboard' : '⏸ Paused',
      click: () => {
        watchingEnabled = !watchingEnabled;
        console.log(`[TC Launcher] Watching: ${watchingEnabled ? 'ON' : 'OFF'}`);
        updateTrayMenu();
      },
    },
    { label: `📊 URLs opened: ${urlCount}`, enabled: false },
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

function createTrayIcon() {
  // 16×16 blue square icon
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2P8z8BQz0BAwMjAwPAfhRkZGRkYGBj+o4hhk2NgYGD4D1YAFUczCMUFDAwMDAyjYTDgYQAAlCkSEWfVJEgAAAAASUVORK5CYII='
  );
}

// ── App Lifecycle ───────────────────────────────────────────────────

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();

  // Capture current clipboard so we don't trigger on pre-existing content
  lastClipboard = clipboard.readText().trim();

  tray = new Tray(createTrayIcon());
  updateTrayMenu();

  pollTimer = setInterval(checkClipboard, POLL_INTERVAL_MS);

  console.log('[TC Launcher] ✅ Started — watching clipboard for YouTube URLs');
  console.log('[TC Launcher] Two-step flow: Pink notification → Orange notification → Open TC');
  console.log(`[TC Launcher] Target: ${TC_BASE_URL}/watch?url=...`);
});

app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  if (pollTimer) clearInterval(pollTimer);
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.close();
  }
});
