const apiKeyEl = document.getElementById('apiKey')
const baseUrlEl = document.getElementById('baseUrl')
const portEl = document.getElementById('port')
const envPathEl = document.getElementById('envPath')
const logEl = document.getElementById('log')
const statusEl = document.getElementById('status')
const saveBtn = document.getElementById('save')
const presetNameEl = document.getElementById('presetName')
const presetSaveBtn = document.getElementById('presetSaveBtn')
const presetListEl = document.getElementById('presetList')
const logLines = []
let presets = []
let activePreset = ''
let busy = false

function renderLog() {
  logEl.textContent = logLines.length > 0 ? logLines.join('\n') : '（暂无）'
  logEl.scrollTop = logEl.scrollHeight
}

window.dshDesktop.onLog((line) => {
  logLines.push(line)
  if (logLines.length > 200) logLines.shift()
  renderLog()
})

window.dshDesktop.onState((state) => {
  presets = state.settings?.presets ?? []
  activePreset = state.settings?.activePreset ?? ''
  renderPresets()
})

function renderPresets() {
  presetListEl.innerHTML = ''
  if (presets.length === 0) {
    presetListEl.innerHTML = '<div class="preset-empty">还没有保存的方案。填好上面的配置后，起个名字保存即可。</div>'
    return
  }
  for (const preset of presets) {
    const item = document.createElement('div')
    item.className = `preset-item${preset.name === activePreset ? ' active' : ''}`
    const active = preset.name === activePreset
    const keyMask = preset.apiKey ? `${preset.apiKey.slice(0, 6)}…${preset.apiKey.slice(-4)}` : '（无 Key）'
    item.innerHTML = `
      <div class="info">
        <div class="pname">${escapeHtml(preset.name)}${active ? ' <span class="pactive">使用中</span>' : ''}</div>
        <div class="pdetail">Key: ${keyMask} · ${escapeHtml(preset.baseUrl || '官方接口')} · 端口 ${preset.port === 0 ? '自动' : preset.port}</div>
      </div>
      <button data-apply="${escapeHtml(preset.name)}" ${active || busy ? 'disabled' : ''}>应用</button>
      <button class="danger" data-delete="${escapeHtml(preset.name)}" ${busy ? 'disabled' : ''}>删除</button>
    `
    presetListEl.appendChild(item)
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ))
}

function setStatus(text, isError = false) {
  statusEl.textContent = text
  statusEl.classList.toggle('error', isError)
}

window.dshDesktop.getState().then((state) => {
  apiKeyEl.value = state.settings.apiKey ?? ''
  baseUrlEl.value = state.settings.baseUrl ?? ''
  portEl.value = String(state.settings.port ?? 0)
  envPathEl.textContent = `${state.dshHome}\\.env`
  logLines.splice(0, logLines.length, ...state.logLines.slice(-200))
  renderLog()
  presets = state.settings?.presets ?? []
  activePreset = state.settings?.activePreset ?? ''
  renderPresets()
})

saveBtn.addEventListener('click', async () => {
  const port = Number.parseInt(portEl.value, 10)
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    setStatus('端口必须是 0–65535 的整数', true)
    return
  }
  saveBtn.disabled = true
  setStatus('正在保存并重启服务…')
  try {
    const result = await window.dshDesktop.saveSettings({
      apiKey: apiKeyEl.value.trim(),
      baseUrl: baseUrlEl.value.trim(),
      port,
    })
    if (result.ok) {
      setStatus('已保存，服务重启中')
    } else {
      setStatus(`保存失败：${result.error}`, true)
    }
  } catch (error) {
    setStatus(`保存失败：${String(error)}`, true)
  }
  saveBtn.disabled = false
})

presetSaveBtn.addEventListener('click', async () => {
  const name = presetNameEl.value.trim()
  if (name === '') {
    setStatus('先给方案起个名字', true)
    return
  }
  presetSaveBtn.disabled = true
  setStatus('正在保存方案…')
  try {
    const result = await window.dshDesktop.presetsSave(name)
    if (result.ok) {
      setStatus(`方案「${name}」已保存`)
      presetNameEl.value = ''
      presets = result.settings.presets
      activePreset = result.settings.activePreset
      renderPresets()
    } else {
      setStatus(`保存失败：${result.error}`, true)
    }
  } catch (error) {
    setStatus(`保存失败：${String(error)}`, true)
  }
  presetSaveBtn.disabled = false
})

presetListEl.addEventListener('click', async (event) => {
  const applyBtn = event.target.closest('button[data-apply]')
  const deleteBtn = event.target.closest('button[data-delete]')
  if (applyBtn && !applyBtn.disabled) {
    busy = true
    setStatus(`正在应用方案「${applyBtn.dataset.apply}」…`)
    const result = await window.dshDesktop.presetsApply(applyBtn.dataset.apply)
    busy = false
    if (result.ok) {
      apiKeyEl.value = result.settings.apiKey ?? ''
      baseUrlEl.value = result.settings.baseUrl ?? ''
      portEl.value = String(result.settings.port ?? 0)
      presets = result.settings.presets
      activePreset = result.settings.activePreset
      renderPresets()
      setStatus('方案已应用，服务重启中')
    } else {
      setStatus(`应用失败：${result.error}`, true)
    }
  }
  if (deleteBtn && !deleteBtn.disabled) {
    busy = true
    setStatus(`正在删除方案「${deleteBtn.dataset.delete}」…`)
    const result = await window.dshDesktop.presetsDelete(deleteBtn.dataset.delete)
    busy = false
    if (result.ok) {
      presets = result.settings.presets
      activePreset = result.settings.activePreset
      renderPresets()
      setStatus('方案已删除')
    } else {
      setStatus(`删除失败：${result.error}`, true)
    }
  }
})

document.getElementById('cancel').addEventListener('click', () => {
  window.close()
})
