const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('valorant', {
  getDashboard: () => ipcRenderer.invoke('accounts:dashboard'),
  onDashboardProgress: (callback) => {
    ipcRenderer.on('accounts:dashboard-progress', (_event, progress) => callback(progress));
  },
  onSystemResumed: (callback) => {
    ipcRenderer.on('system:resumed', (_event, payload) => callback(payload));
  },
  notifyStoreReset: (payload) => ipcRenderer.invoke('notify:store-reset', payload),
  captureCurrentAccount: (label) => ipcRenderer.invoke('accounts:capture-current', label),
  addManualAccount: (label) => ipcRenderer.invoke('accounts:add-manually', label),
  deleteAccount: (label) => ipcRenderer.invoke('accounts:delete', label),
  refreshAccountMarket: (label) => ipcRenderer.invoke('accounts:refresh-market', label),
  renameAccount: (oldLabel, newLabel) => ipcRenderer.invoke('accounts:rename', oldLabel, newLabel),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggleWindow: () => ipcRenderer.invoke('window:maximizeToggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximizedChanged: (callback) => {
    ipcRenderer.on('window:maximized-changed', (_event, maximized) => callback(maximized));
  },
  switchAccount: (label) => ipcRenderer.invoke('accounts:switch', label),
  playAccount: (label, game) => ipcRenderer.invoke('accounts:play', label, game),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: (options) => ipcRenderer.invoke('update:check', options),
  downloadUpdate: (info) => ipcRenderer.invoke('update:download', { info }),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update:progress', (_event, progress) => callback(progress));
  },
  getLocker: (label) => ipcRenderer.invoke('accounts:locker', label),
  getStats: (label, options) => ipcRenderer.invoke('accounts:stats', label, options),
  openTracker: (url) => ipcRenderer.invoke('shell:open-tracker', url),
  getBackgroundPrefs: () => ipcRenderer.invoke('app:get-background-prefs'),
  setBackgroundPrefs: (patch) => ipcRenderer.invoke('app:set-background-prefs', patch),
  onBackgroundPrefs: (callback) => {
    ipcRenderer.on('app:background-prefs', (_event, prefs) => callback(prefs));
  },
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onAccountsChanged: (callback) => {
    ipcRenderer.on('accounts:changed', () => callback());
  },
  detectTcno: () => ipcRenderer.invoke('accounts:tcno-detect'),
  importTcno: (ids) => ipcRenderer.invoke('accounts:tcno-import', ids)
});
