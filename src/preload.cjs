const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  onState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
  onLog: (callback) => {
    const listener = (_event, line) => callback(line)
    ipcRenderer.on('server:log', listener)
    return () => ipcRenderer.removeListener('server:log', listener)
  },
  presetsSave: (name) => ipcRenderer.invoke('presets:save', name),
  presetsDelete: (name) => ipcRenderer.invoke('presets:delete', name),
  presetsApply: (name) => ipcRenderer.invoke('presets:apply', name),
  pluginsSearch: (query) => ipcRenderer.invoke('plugins:search', query),
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsInstall: (name) => ipcRenderer.invoke('plugins:install', name),
  pluginsRemove: (name) => ipcRenderer.invoke('plugins:remove', name),
  onPluginsLog: (callback) => {
    const listener = (_event, line) => callback(line)
    ipcRenderer.on('plugins:log', listener)
    return () => ipcRenderer.removeListener('plugins:log', listener)
  },
  dashboardScan: () => ipcRenderer.invoke('dashboard:scan'),
  openSettings: () => ipcRenderer.invoke('window:open-settings'),
  openPlugins: () => ipcRenderer.invoke('window:open-plugins'),
  openDashboard: () => ipcRenderer.invoke('window:open-dashboard'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
})
