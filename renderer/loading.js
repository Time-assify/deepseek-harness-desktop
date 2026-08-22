const logEl = document.getElementById('log')
const statusEl = document.getElementById('status')
const pulseEl = document.getElementById('pulse')
const panelEl = document.getElementById('panel')
const logLines = []

if (!window.dshDesktop) {
  statusEl.textContent = '桌面桥接加载失败，请重启应用'
  pulseEl.style.display = 'none'
  throw new Error('preload 未加载')
}

function renderLog() {
  logEl.textContent = logLines.join('\n')
  logEl.scrollTop = logEl.scrollHeight
}

window.dshDesktop.onLog((line) => {
  logLines.push(line)
  if (logLines.length > 300) logLines.shift()
  renderLog()
})

window.dshDesktop.onState((state) => {
  if (state.running) {
    pulseEl.style.display = 'none'
    statusEl.textContent = '服务已就绪，正在打开 DeepSeek Harness…'
  } else {
    pulseEl.style.display = 'inline-block'
    statusEl.textContent = '正在启动 dsh 服务…'
  }
})

document.getElementById('settings').addEventListener('click', () => {
  void window.dshDesktop.openSettings()
})

document.getElementById('plugins').addEventListener('click', () => {
  void window.dshDesktop.openPlugins()
})

document.getElementById('dashboard').addEventListener('click', () => {
  void window.dshDesktop.openDashboard()
})

document.getElementById('quit').addEventListener('click', () => {
  void window.dshDesktop.quitApp()
})

window.dshDesktop.getState().then((state) => {
  logLines.splice(0, logLines.length, ...state.logLines)
  renderLog()
  if (state.running) {
    pulseEl.style.display = 'none'
    statusEl.textContent = `服务已就绪：${state.serverUrl}`
  }
})
