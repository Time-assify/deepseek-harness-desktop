const statusDot = document.getElementById('tb-status')
const maxIcon = document.getElementById('win-max-icon')

const THEMES = ['light', 'dark']

function setActiveTheme(theme) {
  for (const t of THEMES) {
    document.getElementById(`theme-${t}`)?.classList.toggle('active', t === theme)
  }
}

for (const t of THEMES) {
  document.getElementById(`theme-${t}`)?.addEventListener('click', () => {
    void window.dshDesktop.setTheme(t)
    setActiveTheme(t)
  })
}

document.getElementById('win-close').addEventListener('click', () => void window.dshDesktop.closeWindow())
document.getElementById('win-min').addEventListener('click', () => void window.dshDesktop.minimize())
document.getElementById('win-max').addEventListener('click', () => void window.dshDesktop.maximizeToggle())

function setMaxIcon(maximized) {
  if (maximized) {
    maxIcon.innerHTML = '<rect x="1.5" y="3.5" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3.5" y="1.5" width="7" height="7" rx="0.5" fill="#1a1e28" stroke="currentColor" stroke-width="1.2"/>'
  } else {
    maxIcon.innerHTML = '<rect x="2.5" y="2.5" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/>'
  }
}

window.dshDesktop.onMaximized(setMaxIcon)
void window.dshDesktop.isMaximized().then(setMaxIcon).catch(() => {})

window.dshDesktop.onState((state) => {
  statusDot.classList.toggle('online', !!state.running)
  setActiveTheme(state.settings?.theme)
})
window.dshDesktop.getState().then((state) => setActiveTheme(state.settings?.theme)).catch(() => {})

document.getElementById('tb-plugins').addEventListener('click', () => void window.dshDesktop.openPlugins())
document.getElementById('tb-dash').addEventListener('click', () => void window.dshDesktop.openDashboard())
document.getElementById('tb-settings').addEventListener('click', () => void window.dshDesktop.openSettings())