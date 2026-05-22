const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onYoutubeUrl: (callback) => {
    ipcRenderer.on('youtube-url', (event, url) => callback(url));
  },
  notificationClicked: (url) => {
    ipcRenderer.send('notification-clicked', url);
  },
  closeNotification: () => {
    ipcRenderer.send('notification-close');
  }
});