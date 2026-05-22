/**
 * Preload script — exposes safe IPC channels to the notification window.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  notificationClicked: () => ipcRenderer.send('notification-clicked'),
  notificationDismissed: () => ipcRenderer.send('notification-dismissed'),
});
