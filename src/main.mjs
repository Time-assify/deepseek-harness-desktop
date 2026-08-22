import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { DshServer } from './dsh-server.mjs'
import {
  applyApiKeyToEnv,
  dshHome,
  normalizePresets,
  readSettings,
  writeSettings,
} from './settings-store.mjs'
import { aggregateSessions } from './sessions.mjs'
import {
  installPlugin,
  listInstalled,
  removePlugin,
  searchPlugins,
} from './plugins.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PRELOAD = path.join(__dirname, 'preload.cjs')
const LOADING_PAGE = path.join(__dirname, '..', 'renderer', 'loading.html')
const RENDERER_DIR = path.join(__dirname, '..', 'renderer')

const exeDir = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..')
const PORTABLE = process.env.DSH_DESKTOP_PORTABLE === '1' || existsSync(path.join(exeDir, 'portable.txt'))
if (PORTABLE) {
  const dataDir = path.join(exeDir, 'data')
  process.env.DSH_HOME = path.join(dataDir, 'dsh')
  app.setPath('userData', path.join(dataDir, 'userData'))
}

const DSH_HOME = dshHome()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  runApp()
}

function runApp() {
  let mainWindow = null
  let settingsWindow = null
  let pluginsWindow = null
  let dashboardWindow = null
  let settings = { apiKey: '', baseUrl: '', port: 0, presets: [], activePreset: '' }
  let restartQueue = Promise.resolve()
  let pluginBusy = false

  const state = {
    serverUrl: null,
    running: false,
    logLines: [],
    dshHome: DSH_HOME,
    portable: PORTABLE,
    settings,
  }

  const server = new DshServer({
    onReady: (url) => {
      state.serverUrl = url
      state.running = true
      publishState()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.once('did-finish-load', () => {
          console.log(`[app] 页面加载完成: ${url}`)
        })
        mainWindow.loadURL(url).catch(() => {})
      }
    },
    onLog: (line) => {
      for (const piece of line.split(/\r?\n/)) {
        if (piece.trim() === '') continue
        state.logLines.push(piece)
        if (state.logLines.length > 500) state.logLines.shift()
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('server:log', piece)
        }
      }
      publishState()
    },
    onExit: (code, signal) => {
      state.running = false
      state.logLines.push(`服务已退出（code=${code}${signal ? `, signal=${signal}` : ''}），可通过菜单「服务器」→「重启」恢复`)
      publishState()
      showLoadingPage()
    },
  })

  function publishState() {
    state.settings = settings
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('state:changed', { ...state })
    }
  }

  function showLoadingPage() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(LOADING_PAGE).catch(() => {})
    }
  }

  function captureRendererConsole(win) {
    win.webContents.on('console-message', (_event, ...args) => {
      const details = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] }
      console.log(`[renderer:${details.level}] ${details.message}`)
    })
  }

  async function doStartServer() {
    try {
      await applyApiKeyToEnv(settings.apiKey ?? '')
      state.serverUrl = null
      state.running = false
      publishState()
      showLoadingPage()
      server.start({ port: settings.port ?? 0, baseUrl: settings.baseUrl ?? '' })
    } catch (error) {
      state.logLines.push(`启动失败: ${error?.stack ?? String(error)}`)
      publishState()
    }
  }

  function restartServer() {
    restartQueue = restartQueue.catch(() => {}).then(async () => {
      if (server.isRunning) await server.stop()
      await doStartServer()
    })
    return restartQueue
  }

  function buildMenu() {
    const template = [
      {
        label: '文件',
        submenu: [
          {
            label: '设置',
            accelerator: 'CmdOrCtrl+,',
            click: () => openSettingsWindow(),
          },
          { type: 'separator' },
          {
            label: '退出',
            role: 'quit',
          },
        ],
      },
      {
        label: '服务器',
        submenu: [
          {
            label: '重启 dsh 服务',
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => void restartServer(),
          },
          {
            label: '在浏览器中打开',
            click: () => {
              if (state.serverUrl) void shell.openExternal(state.serverUrl)
            },
          },
        ],
      },
      {
        label: '工具',
        submenu: [
          {
            label: '插件商店',
            click: () => openPluginsWindow(),
          },
          {
            label: '会话成本仪表盘',
            click: () => openDashboardWindow(),
          },
          { type: 'separator' },
          {
            label: '打开数据目录',
            click: () => {
              void shell.openPath(DSH_HOME)
            },
          },
        ],
      },
      {
        label: '视图',
        submenu: [
          {
            label: '重新加载页面',
            accelerator: 'CmdOrCtrl+R',
            click: (item, focusedWindow) => focusedWindow?.webContents.reload(),
          },
          {
            label: '开发者工具',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: (item, focusedWindow) => focusedWindow?.webContents.toggleDevTools(),
          },
          { type: 'separator' },
          {
            label: '全屏',
            accelerator: 'F11',
            click: (item, focusedWindow) => focusedWindow?.setFullScreen(!focusedWindow?.isFullScreen()),
          },
          { type: 'separator' },
          {
            label: '重置缩放',
            accelerator: 'CmdOrCtrl+0',
            role: 'resetZoom',
          },
          {
            label: '放大',
            accelerator: 'CmdOrCtrl+=',
            role: 'zoomIn',
          },
          {
            label: '缩小',
            accelerator: 'CmdOrCtrl+-',
            role: 'zoomOut',
          },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: 'DeepSeek Harness 项目主页',
            click: () => void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness'),
          },
          {
            label: `数据目录：${DSH_HOME}${PORTABLE ? '（便携模式）' : ''}`,
            enabled: false,
          },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 620,
      show: false,
      title: 'DeepSeek Harness',
      backgroundColor: '#f5f6f8',
      icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    })
    mainWindow.once('ready-to-show', () => mainWindow?.show())
    captureRendererConsole(mainWindow)
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })
    mainWindow.webContents.on('will-navigate', (event, url) => {
      const local = url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')
      if (!local) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
    mainWindow.loadFile(LOADING_PAGE).catch(() => {})
  }

  function makeWindow(options) {
    const win = new BrowserWindow({
      icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
      ...options,
    })
    captureRendererConsole(win)
    return win
  }

  function openSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus()
      return
    }
    settingsWindow = makeWindow({
      width: 760,
      height: 760,
      resizable: true,
      minimizable: false,
      maximizable: false,
      title: '设置 — DeepSeek Harness',
      parent: mainWindow ?? undefined,
    })
    settingsWindow.loadFile(path.join(RENDERER_DIR, 'settings.html')).catch(() => {})
    settingsWindow.on('closed', () => {
      settingsWindow = null
    })
  }

  function openPluginsWindow() {
    if (pluginsWindow && !pluginsWindow.isDestroyed()) {
      pluginsWindow.focus()
      return
    }
    pluginsWindow = makeWindow({
      width: 860,
      height: 680,
      minWidth: 640,
      minHeight: 480,
      title: '插件商店 — DeepSeek Harness',
      parent: mainWindow ?? undefined,
    })
    pluginsWindow.loadFile(path.join(RENDERER_DIR, 'plugins.html')).catch(() => {})
    pluginsWindow.on('closed', () => {
      pluginsWindow = null
    })
  }

  function openDashboardWindow() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.focus()
      return
    }
    dashboardWindow = makeWindow({
      width: 980,
      height: 700,
      minWidth: 720,
      minHeight: 480,
      title: '会话成本仪表盘 — DeepSeek Harness',
      parent: mainWindow ?? undefined,
    })
    dashboardWindow.loadFile(path.join(RENDERER_DIR, 'dashboard.html')).catch(() => {})
    dashboardWindow.on('closed', () => {
      dashboardWindow = null
    })
  }

  ipcMain.handle('state:get', () => ({ ...state }))

  ipcMain.handle('settings:save', async (_event, next) => {
    try {
      const clean = (value) =>
        typeof value === 'string' ? value.replace(/[\r\n]/g, '').trim() : ''
      const cleaned = {
        apiKey: clean(next?.apiKey),
        baseUrl: clean(next?.baseUrl),
        port: Number.isInteger(next?.port) && next.port >= 0 && next.port <= 65535 ? next.port : 0,
      }
      settings = { ...settings, ...cleaned, presets: normalizePresets(settings), activePreset: '' }
      await writeSettings(path.join(app.getPath('userData'), 'settings.json'), settings)
      await applyApiKeyToEnv(settings.apiKey)
      publishState()
      void restartServer()
      return { ok: true, ...state }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), ...state }
    }
  })

  ipcMain.handle('presets:save', async (_event, name) => {
    try {
      const cleanName = typeof name === 'string' ? name.replace(/[\r\n]/g, '').trim().slice(0, 40) : ''
      if (cleanName === '') return { ok: false, error: '方案名不能为空' }
      const current = {
        name: cleanName,
        apiKey: settings.apiKey ?? '',
        baseUrl: settings.baseUrl ?? '',
        port: settings.port ?? 0,
      }
      const presets = normalizePresets(settings).filter((preset) => preset.name !== cleanName)
      presets.push(current)
      settings = { ...settings, presets, activePreset: cleanName }
      await writeSettings(path.join(app.getPath('userData'), 'settings.json'), settings)
      publishState()
      return { ok: true, ...state }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), ...state }
    }
  })

  ipcMain.handle('presets:delete', async (_event, name) => {
    const presets = normalizePresets(settings).filter((preset) => preset.name !== name)
    settings = {
      ...settings,
      presets,
      activePreset: settings.activePreset === name ? '' : settings.activePreset,
    }
    await writeSettings(path.join(app.getPath('userData'), 'settings.json'), settings)
    publishState()
    return { ok: true, ...state }
  })

  ipcMain.handle('presets:apply', async (_event, name) => {
    const preset = normalizePresets(settings).find((entry) => entry.name === name)
    if (!preset) return { ok: false, error: `方案不存在：${name}` }
    settings = {
      ...settings,
      apiKey: preset.apiKey,
      baseUrl: preset.baseUrl,
      port: preset.port,
      activePreset: name,
    }
    await writeSettings(path.join(app.getPath('userData'), 'settings.json'), settings)
    await applyApiKeyToEnv(settings.apiKey)
    publishState()
    void restartServer()
    return { ok: true, ...state }
  })

  ipcMain.handle('plugins:search', async (_event, query) => {
    try {
      return { ok: true, results: await searchPlugins(String(query ?? '')) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('plugins:list', async () => {
    try {
      return { ok: true, items: await listInstalled(DSH_HOME) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('plugins:install', async (_event, packageName) => {
    if (pluginBusy) return { ok: false, error: '已有插件任务进行中' }
    pluginBusy = true
    try {
      const name = String(packageName ?? '').trim()
      if (name === '') throw new Error('包名不能为空')
      state.logLines.push(`插件安装开始: ${name}`)
      const result = await installPlugin(DSH_HOME, name, {
        onLine: (line) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('plugins:log', line)
          }
        },
      })
      state.logLines.push(`插件安装完成: ${name}`)
      void restartServer()
      return { ok: true, items: await listInstalled(DSH_HOME) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      pluginBusy = false
    }
  })

  ipcMain.handle('plugins:remove', async (_event, packageName) => {
    if (pluginBusy) return { ok: false, error: '已有插件任务进行中' }
    pluginBusy = true
    try {
      const name = String(packageName ?? '').trim()
      if (name === '') throw new Error('包名不能为空')
      state.logLines.push(`插件移除开始: ${name}`)
      await removePlugin(DSH_HOME, name, {
        onLine: (line) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('plugins:log', line)
          }
        },
      })
      state.logLines.push(`插件移除完成: ${name}`)
      void restartServer()
      return { ok: true, items: await listInstalled(DSH_HOME) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      pluginBusy = false
    }
  })

  ipcMain.handle('dashboard:scan', async () => {
    try {
      return { ok: true, ...(await aggregateSessions(path.join(DSH_HOME, 'sessions'))) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('window:open-settings', () => openSettingsWindow())
  ipcMain.handle('window:open-plugins', () => openPluginsWindow())
  ipcMain.handle('window:open-dashboard', () => openDashboardWindow())
  ipcMain.handle('app:open-data-dir', () => {
    void shell.openPath(DSH_HOME)
  })
  ipcMain.handle('app:quit', () => app.quit())

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.deepseekharness.desktop')
    buildMenu()
    const settingsPath = path.join(app.getPath('userData'), 'settings.json')
    settings = { ...settings, ...(await readSettings(settingsPath)) }
    settings.presets = normalizePresets(settings)
    createMainWindow()
    await doStartServer()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  let quitting = false
  app.on('will-quit', (event) => {
    if (quitting) return
    if (server.isRunning) {
      event.preventDefault()
      quitting = true
      void server.stop().finally(() => app.quit())
    }
  })

  process.on('uncaughtException', (error) => {
    state.logLines.push(`主进程错误: ${error?.stack ?? String(error)}`)
    publishState()
  })
}
