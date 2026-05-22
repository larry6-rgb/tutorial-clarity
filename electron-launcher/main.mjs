import { app, BrowserWindow, Tray, Menu, clipboard, Notification, dialog, ipcMain,screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let tray = null;
let lastClipboard = '';
let currentNotification = null;

// Get single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function isYouTubeUrl(text) {
  if (!text || typeof text !== 'string') return false;
  const patterns = [
    /youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/i,
    /youtu\.be\/[a-zA-Z0-9_-]+/i,
    /youtube\.com\/embed\/[a-zA-Z0-9_-]+/i,
    /youtube\.com\/v\/[a-zA-Z0-9_-]+/i,
    /youtube\.com\/shorts\/[a-zA-Z0-9_-]+/i
  ];
  return patterns.some(pattern => pattern.test(text));
}

function extractYouTubeUrl(text) {
  const patterns = [
    /(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=[a-zA-Z0-9_-]+(&[^\s]*)?)/i,
    /(https?:\/\/)?(www\.)?(youtu\.be\/[a-zA-Z0-9_-]+(\?[^\s]*)?)/i,
    /(https?:\/\/)?(www\.)?(youtube\.com\/embed\/[a-zA-Z0-9_-]+(\?[^\s]*)?)/i,
    /(https?:\/\/)?(www\.)?(youtube\.com\/v\/[a-zA-Z0-9_-]+(\?[^\s]*)?)/i,
    /(https?:\/\/)?(www\.)?(youtube\.com\/shorts\/[a-zA-Z0-9_-]+(\?[^\s]*)?)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let url = match[0];
      if (!url.startsWith('http')) {
        url = `https://${url}`;
      }
      return url;
    }
  }
  return null;
}

function createWindow(videoUrl) {
  // Close existing window if it exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    mainWindow = null;
  }
  
  // Create new window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });
  mainWindow.maximize();
  
  const url = `http://localhost:3000/watch?url=${encodeURIComponent(videoUrl)}`
  mainWindow.loadURL(url);
  
  mainWindow.on('close', (e) => {
    // Stop the YouTube player before closing
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        if (window.playerRef && window.playerRef.current) {
          window.playerRef.current.stopVideo();
          window.playerRef.current.destroy();
        }
      `).catch(err => console.log('[Window] Error stopping player:', err));
    }
  });
  
  mainWindow.on('closed', () => {
    console.log('[Window] Closed');
    mainWindow = null;
  });
}

function createCustomNotification(videoUrl) {
  
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  const notificationWindow = new BrowserWindow({
    width: 400,
    height: 120,
    x: width - 420,
    y: height - 140,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          padding: 20px;
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #FF1493 0%, #FF69B4 100%);
          border: 4px solid #FFD700;
          border-radius: 10px;
          box-shadow: 0 8px 30px rgba(255, 20, 147, 0.6);
          cursor: pointer;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        h2 {
          margin: 0 0 8px 0;
          color: #FFFFFF;
          font-size: 18px;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
          
      </style>
    </head>
    <body onclick="window.close()">
      <h2>🎬 YouTube URL Detected!</h2>
      <p>Click here to open in Tutorial Clarity</p>
      <script>
        const { ipcRenderer } = require('electron');
        document.body.addEventListener('click', () => {
          ipcRenderer.send('notification-clicked', '${videoUrl}');
        });
      </script>
    </body>
    </html>
  `;

  notificationWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
  
  return notificationWindow;
}
function showCustomDialog(videoUrl) {
  const centerX = Math.floor((screen.getPrimaryDisplay().workAreaSize.width - 600) / 2);
  const centerY = Math.floor((screen.getPrimaryDisplay().workAreaSize.height - 550) / 2);
  const dialogWindow = new BrowserWindow({
    width: 600,
    height: 550,
    x: centerX,
y: centerY,
    alwaysOnTop: true,
    frame: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          padding: 40px;
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          color: white;
        }
        .arrow {
          font-size: 80px;
          margin-bottom: 20px;
          animation: bounce 1s infinite;
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
        h1 {
          font-size: 32px;
          margin: 20px 0;
          text-align: center;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        p {
          font-size: 20px;
          text-align: center;
          margin: 20px 0;
          line-height: 1.6;
        }
        button {
          background: #FF1493;
          color: white;
          border: none;
          padding: 20px 60px;
          font-size: 24px;
          font-weight: bold;
          border-radius: 50px;
          cursor: pointer;
          margin-top: 30px;
          box-shadow: 0 8px 20px rgba(255, 20, 147, 0.4);
          transition: all 0.3s;
        }
        button:hover {
          background: #FF69B4;
          transform: scale(1.05);
          box-shadow: 0 12px 30px rgba(255, 20, 147, 0.6);
        }
      </style>
    </head>
    <body>
      <h1>PAUSE YOUR YOUTUBE VIDEO FIRST!</h1>
<p>For best experience, maximize your YouTube window.<br>If necessary, grab the title bar and move this window so that you can see the YouTube controls.<br><br>Hover over the video to show controls,<br>then click the pause button.<br>Click OK below when paused.</p>
<div class="arrow" style="position: absolute; bottom: 20px; left: 20px;">↙️</div>
      <button onclick="window.close()">OK - I Paused It!</button>
      <script>
        const { ipcRenderer } = require('electron');
        document.querySelector('button').addEventListener('click', () => {
          ipcRenderer.send('dialog-ok', '${videoUrl}');
        });
      </script>
    </body>
    </html>
  `;

  dialogWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
  
  return dialogWindow;
}
function showNotification(videoUrl) {
  if (currentNotification && !currentNotification.isDestroyed()) {
    currentNotification.close();
  }
  
  currentNotification = createCustomNotification(videoUrl);
}
function createTray() {
  const iconPath = path.join(__dirname, 'icons', 'icon-48.png');
  tray = new Tray(iconPath);  
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Tutorial Clarity',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
        } else {
         mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
  icon: path.join(__dirname, 'icons', 'icon.ico'),
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    webSecurity: false
  }
});

          mainWindow.maximize();
          mainWindow.loadURL('http://localhost:3000');
        }
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

function startClipboardMonitoring() {
  setInterval(() => {
    try {
      const currentClipboard = clipboard.readText();
      
      if (currentClipboard && currentClipboard !== lastClipboard) {
        lastClipboard = currentClipboard;
        
        if (isYouTubeUrl(currentClipboard)) {
          const youtubeUrl = extractYouTubeUrl(currentClipboard);
          if (youtubeUrl) {
            showNotification(youtubeUrl);
          }
        }
      }
    } catch (error) {
      console.error('[Clipboard] Error:', error);
    }
  }, 500);
}

// Handle dialog OK button click
ipcMain.on('dialog-ok', (event, videoUrl) => {
  const dialogWindow = BrowserWindow.fromWebContents(event.sender);
  if (dialogWindow) {
    dialogWindow.close();
  }
  createWindow(videoUrl);
});

// Handle notification click
ipcMain.on('notification-clicked', (event, videoUrl) => {
  const notificationWindow = BrowserWindow.fromWebContents(event.sender);
  if (notificationWindow) {
    notificationWindow.close();
  }
  // Clear clipboard to prevent repeated notifications
  clipboard.writeText('');
  lastClipboard = '';
  // Show custom dialog
  showCustomDialog(videoUrl);
});
app.whenReady().then(() => {
  createTray();
  startClipboardMonitoring();
});

app.on('window-all-closed', () => {
  // Keep running in background with tray
  console.log('[App] Windows closed - running in tray');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      icon: path.join(__dirname, 'icons', 'icon.ico'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false
      }
    });
    mainWindow.loadURL('http://localhost:3000');
  }
});