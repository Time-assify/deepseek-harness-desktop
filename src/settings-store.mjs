import { promises as fs } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

export function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
}

const DEFAULTS = Object.freeze({
  apiKey: '',
  baseUrl: '',
  port: 0,
  presets: [],
  activePreset: '',
})

export async function readSettings(settingsPath) {
  try {
    const raw = await fs.readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...(typeof parsed === 'object' && parsed !== null ? parsed : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeSettings(settingsPath, settings) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

export function envFilePath(home = dshHome()) {
  return path.join(home, '.env')
}

export async function applyApiKeyToEnv(apiKey, home = dshHome()) {
  const envPath = envFilePath(home)
  let content = ''
  let existed = true
  try {
    content = await fs.readFile(envPath, 'utf8')
  } catch {
    existed = false
    content = ''
  }
  const lines = content.split(/\r?\n/)
  const kept = lines.filter((line) => !/^\s*DEEPSEEK_API_KEY\s*=/.test(line))
  if (apiKey.trim() !== '') {
    const escaped = /[\s"'#]/.test(apiKey) ? `"${apiKey.replace(/"/g, '\\"')}"` : apiKey
    kept.push(`DEEPSEEK_API_KEY=${escaped}`)
  }
  const next = kept.join('\n').trimEnd() + (kept.length > 0 ? '\n' : '')
  if (next === '' && !existed) return envPath
  await fs.mkdir(path.dirname(envPath), { recursive: true })
  await fs.writeFile(envPath, next, 'utf8')
  return envPath
}

export function normalizePresets(settings) {
  const presets = Array.isArray(settings.presets) ? settings.presets : []
  return presets
    .filter((preset) => preset && typeof preset.name === 'string' && preset.name.trim() !== '')
    .map((preset) => ({
      name: preset.name.trim().slice(0, 40),
      apiKey: typeof preset.apiKey === 'string' ? preset.apiKey : '',
      baseUrl: typeof preset.baseUrl === 'string' ? preset.baseUrl : '',
      port: Number.isInteger(preset.port) && preset.port >= 0 && preset.port <= 65535 ? preset.port : 0,
    }))
}
