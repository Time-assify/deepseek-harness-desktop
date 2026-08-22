const marketEl = document.getElementById('market')
const installedEl = document.getElementById('installed')
const logEl = document.getElementById('log')
const statusEl = document.getElementById('status')
const queryEl = document.getElementById('query')
const searchBtn = document.getElementById('searchBtn')
const marketCountEl = document.getElementById('marketCount')
const installedCountEl = document.getElementById('installedCount')
const logLines = []
const installedSet = new Set()
let busy = false

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ))
}

function renderLog() {
  logEl.textContent = logLines.length > 0 ? logLines.join('\n') : '（暂无）'
  logEl.scrollTop = logEl.scrollHeight
}

window.dshDesktop.onPluginsLog((line) => {
  logLines.push(line)
  if (logLines.length > 300) logLines.shift()
  renderLog()
})

function setStatus(text, isError = false) {
  statusEl.textContent = text
  statusEl.classList.toggle('error', isError)
}

function itemHtml({ name, version, description, keywords = [] }, actionButton) {
  const tags = keywords.slice(0, 4).map((kw) => `<span class="tag">${escapeHtml(kw)}</span>`).join('')
  return `
    <div class="item" data-name="${escapeHtml(name)}">
      <div class="name">${escapeHtml(name)} <span style="font-weight:400;color:var(--text-3)">v${escapeHtml(version ?? '?')}</span></div>
      <div class="desc">${escapeHtml(description ?? '')}</div>
      <div class="meta">${tags}<span class="spacer"></span>${actionButton}</div>
    </div>
  `
}

function showSkeleton(el, count = 4) {
  el.innerHTML = '<div class="skeleton"></div>'.repeat(count)
}

async function refreshInstalled() {
  const result = await window.dshDesktop.pluginsList()
  if (!result.ok) {
    installedEl.innerHTML = `<div class="empty">加载失败：${escapeHtml(result.error)}</div>`
    return
  }
  installedSet.clear()
  installedEl.innerHTML = ''
  for (const item of result.items) {
    installedSet.add(item.name)
    installedEl.innerHTML += itemHtml(
      { ...item, keywords: item.isBundle ? ['bundle'] : [] },
      `<button class="danger" data-remove="${escapeHtml(item.name)}">卸载</button>`,
    )
  }
  installedCountEl.textContent = result.items.length > 0 ? `${result.items.length} 个` : ''
  if (result.items.length === 0) {
    installedEl.innerHTML = '<div class="empty">还没有安装任何插件<br/>从左侧市场挑选一个吧</div>'
  }
  refreshMarketButtons()
}

function refreshMarketButtons() {
  for (const item of marketEl.querySelectorAll('.item')) {
    const name = item.dataset.name
    const btn = item.querySelector('button[data-install]')
    if (!btn) continue
    if (installedSet.has(name)) {
      btn.disabled = true
      btn.textContent = '已安装'
    } else {
      btn.disabled = busy
      btn.textContent = '安装'
    }
  }
}

async function search() {
  setStatus('搜索中…')
  showSkeleton(marketEl, 5)
  const result = await window.dshDesktop.pluginsSearch(queryEl.value.trim())
  if (!result.ok) {
    marketEl.innerHTML = `<div class="empty">搜索失败：${escapeHtml(result.error)}</div>`
    marketCountEl.textContent = ''
    setStatus(`搜索失败：${result.error}`, true)
    return
  }
  marketEl.innerHTML = ''
  if (result.results.length === 0) {
    marketEl.innerHTML = '<div class="empty">没有找到匹配的插件</div>'
  }
  for (const entry of result.results) {
    marketEl.innerHTML += itemHtml(
      entry,
      `<button class="primary" data-install="${escapeHtml(entry.name)}">安装</button>`,
    )
  }
  marketCountEl.textContent = result.results.length > 0 ? `${result.results.length} 个` : ''
  refreshMarketButtons()
  setStatus(`共 ${result.results.length} 个结果（npm 关键词 dsh-plugin）`)
}

async function install(name) {
  if (busy) return
  busy = true
  refreshMarketButtons()
  logLines.push(`开始安装 ${name} …`)
  renderLog()
  setStatus(`正在安装 ${name} …`)
  const result = await window.dshDesktop.pluginsInstall(name)
  busy = false
  if (result.ok) {
    setStatus(`${name} 安装完成，服务已重启`)
  } else {
    setStatus(`安装失败：${result.error}`, true)
  }
  await refreshInstalled()
}

async function remove(name) {
  if (busy) return
  busy = true
  logLines.push(`开始卸载 ${name} …`)
  renderLog()
  setStatus(`正在卸载 ${name} …`)
  const result = await window.dshDesktop.pluginsRemove(name)
  busy = false
  if (result.ok) {
    setStatus(`${name} 已卸载，服务已重启`)
  } else {
    setStatus(`卸载失败：${result.error}`, true)
  }
  await refreshInstalled()
}

marketEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-install]')
  if (btn && !btn.disabled) void install(btn.dataset.install)
})

installedEl.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-remove]')
  if (btn && !btn.disabled) void remove(btn.dataset.remove)
})

searchBtn.addEventListener('click', () => void search())
queryEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void search()
})

void refreshInstalled()
void search()
