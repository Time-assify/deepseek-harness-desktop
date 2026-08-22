const themeEl = document.documentElement

function applyTheme(theme) {
  if (!theme) return
  themeEl.setAttribute('data-theme', theme)
}

if (window.dshDesktop) {
  window.dshDesktop.onState((state) => applyTheme(state.settings?.theme))
  window.dshDesktop.getState().then((state) => applyTheme(state.settings?.theme)).catch(() => {})
}