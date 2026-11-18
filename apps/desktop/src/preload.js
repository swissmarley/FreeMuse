// Only the local setup page uses this bridge: it lets you enter your Free Muse server address.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freemuseDesktop', {
  connect: (url) => ipcRenderer.invoke('freemuse:connect', String(url)),
  platform: process.platform,
});
