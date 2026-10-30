const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (json) => ipcRenderer.invoke('data:save', json),
  saveSync: (json) => ipcRenderer.sendSync('data:save-sync', json),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  exportBackup: (json) => ipcRenderer.invoke('backup:export', json),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  revealData: () => ipcRenderer.invoke('data:reveal'),
  setFullscreen: (on) => ipcRenderer.invoke('window:fullscreen', on),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen-changed', (_e, on) => cb(on)),
  exportPdf: (title, widthPx) => ipcRenderer.invoke('page:pdf', { title, widthPx }),
  openLastPdf: () => ipcRenderer.invoke('page:pdf-open'),
});
