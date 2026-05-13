const electron = require('electron');
const { spawn } = require('child_process');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const clipboard = electron.clipboard;
const screen = electron.screen;

let mainWindow;
let lastClipboard = '';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: true
    }
  });
  
  mainWindow.loadURL('data:text/html,<h1>Tutorial Clarity Clipboard Monitor</h1><p>Running...</p>');
  mainWindow.webContents.openDevTools();
}

function createPinkPanel(message, isPurple, onClickAction) {
  const display = screen.getPrimaryDisplay();
  
  // Second panel appears lower and in purple
  const yPosition = isPurple ? 160 : 20;
  const gradient = isPurple 
    ? 'linear-gradient(135deg, #9d4edd, #c77dff)' 
    : 'linear-gradient(135deg, #ff1493, #ff69b4)';
  
  const panel = new BrowserWindow({
    width: 420,
    height: 130,
    x: display.workAreaSize.width - 440,
    y: yPosition,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true
  });
  
  const html = '<html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0; font-family:Arial; background:transparent;">' +
    '<div id="panel" style="background: ' + gradient + '; ' +
    'padding:20px; border-radius:10px; color:white; ' +
    'box-shadow: 0 8px 20px rgba(157,78,221,0.6); cursor:pointer;">' +
    '<h2 style="margin:0 0 10px 0; font-size:18px;">YouTube URL Detected!</h2>' +
    '<p style="margin:0; font-size:14px;">' + message + '</p>' +
    '</div></body></html>';
  
  panel.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  
  panel.webContents.on('did-finish-load', function() {
    panel.webContents.executeJavaScript(
      'document.getElementById("panel").addEventListener("click", function() { window.close(); });'
    );
  });
  
  panel.on('closed', function() {
    if (onClickAction) {
      setTimeout(onClickAction, 300);
    }
  });
  
  setTimeout(function() {
    if (!panel.isDestroyed()) {
      panel.close();
    }
  }, 15000);
}

function checkClipboard() {
  const currentClipboard = clipboard.readText();
  
  console.log('Checking clipboard:', currentClipboard.substring(0, 50));
  
  if (currentClipboard !== lastClipboard && currentClipboard.includes('youtube.com/watch')) {
    lastClipboard = currentClipboard;
    const videoUrl = currentClipboard;
    console.log('YouTube URL detected!');
    
    // First panel: Pink, top position
    createPinkPanel('Click here to open in Tutorial Clarity', false, function() {
      // Second panel: Purple, lower position
      createPinkPanel('Click when you have paused the YouTube video', true, function() {
        // Open Tutorial Clarity with video URL - goes directly to watch page
        spawn('cmd', ['/c', 'start', 'http://localhost:3000/watch?url=' + encodeURIComponent(videoUrl)]);
      });
    });
  }
}

app.whenReady().then(function() {
  createWindow();
  lastClipboard = clipboard.readText();
  console.log('Electron app started');
  setInterval(checkClipboard, 1000);
});

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});