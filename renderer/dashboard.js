const cardsEl = document.getElementById('cards')
const tbodyEl = document.getElementById('tbody')
const emptyEl = document.getElementById('empty')
const dataDirEl = document.getElementById('dataDir')
const refreshBtn = document.getElementById('refresh')

function fmtTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function fmtCost(n) {
  if (n >= 100) return `¥${n.toFixed(2)}`
  if (n >= 1) return `¥${n.toFixed(3)}`
  if (n > 0) return `¥${n.toFixed(4)}`
  return '¥0'
}

function fmtDate(ts) {
  if (!ts) return '—'
  const date = new Date(ts)
  const pad = (v) => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const ICONS = {
  cost: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  input: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>',
  cache: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  output: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>',
  sessions: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  turns: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  steps: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>',
}

function render(data) {
  const { sessions, totals } = data
  cardsEl.innerHTML = ''
  const totalTokens = totals.inputTokens + totals.outputTokens
  const cards = [
    {
      label: '总成本（估算）', value: fmtCost(totals.costCny), icon: ICONS.cost,
      hero: true, ratio: 1,
    },
    {
      label: '输入 Token', value: fmtTokens(totals.inputTokens), icon: ICONS.input,
      ratio: totalTokens > 0 ? totals.inputTokens / totalTokens : 0,
    },
    {
      label: '缓存命中', value: fmtTokens(totals.cacheReadTokens), icon: ICONS.cache,
      ratio: totals.inputTokens > 0 ? totals.cacheReadTokens / totals.inputTokens : 0,
    },
    {
      label: '输出 Token', value: fmtTokens(totals.outputTokens), icon: ICONS.output,
      ratio: totalTokens > 0 ? totals.outputTokens / totalTokens : 0,
    },
    { label: '会话数', value: String(sessions.length), icon: ICONS.sessions, ratio: 0 },
    { label: '对话轮次', value: String(totals.turns), icon: ICONS.turns, ratio: 0 },
    { label: '执行步骤', value: String(totals.steps), icon: ICONS.steps, ratio: 0 },
  ]
  for (const card of cards) {
    const el = document.createElement('div')
    el.className = `card stat${card.hero ? ' hero' : ''}`
    el.innerHTML = `
      <div class="label">${card.icon}<span></span></div>
      <div class="value"></div>
      <div class="bar"><i></i></div>
    `
    el.querySelector('.label span').textContent = card.label
    el.querySelector('.value').textContent = card.value
    el.querySelector('.bar i').style.width = `${Math.round(card.ratio * 100)}%`
    cardsEl.appendChild(el)
  }
  tbodyEl.innerHTML = ''
  emptyEl.style.display = sessions.length === 0 ? 'block' : 'none'
  for (const session of sessions) {
    const tr = document.createElement('tr')
    const title = session.title || session.sessionId.slice(0, 8)
    const cwd = session.cwd || session.workspaceDir || ''
    const model = session.model || '未知模型'
    tr.innerHTML = `
      <td class="title-cell">
        <div class="t">${escapeHtml(title)}</div>
        <div class="c">${escapeHtml(cwd.length > 70 ? `…${cwd.slice(-67)}` : cwd)}</div>
      </td>
      <td><span class="model-chip">${escapeHtml(model)}</span></td>
      <td class="num">${fmtDate(session.lastActivity)}</td>
      <td class="num">${fmtTokens(session.tokens.inputTokens)}</td>
      <td class="num">${fmtTokens(session.tokens.cacheReadTokens)}</td>
      <td class="num">${fmtTokens(session.tokens.outputTokens)}</td>
      <td class="num">${session.steps}</td>
      <td class="num cost">${fmtCost(session.costCny)}</td>
    `
    tbodyEl.appendChild(tr)
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ))
}

async function scan() {
  refreshBtn.disabled = true
  const state = await window.dshDesktop.getState().catch(() => null)
  if (state?.dshHome) dataDirEl.textContent = `数据目录：${state.dshHome}`
  const result = await window.dshDesktop.dashboardScan()
  refreshBtn.disabled = false
  if (result.ok) {
    render(result)
  } else {
    tbodyEl.innerHTML = ''
    emptyEl.style.display = 'block'
    emptyEl.textContent = `扫描失败：${result.error}`
  }
}

refreshBtn.addEventListener('click', () => void scan())
void scan()
