import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function appRoot() {
  const root = path.resolve(__dirname, '..')
  if (root.includes(`${path.sep}app.asar${path.sep}`) || root.endsWith(`${path.sep}app.asar`)) {
    return root.replace('app.asar', 'app.asar.unpacked')
  }
  return root
}

export const DEFAULT_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

export function profileDir(dshHome) {
  return path.join(dshHome, 'profiles', 'web')
}

export async function ensureProfile(dshHome) {
  const dir = profileDir(dshHome)
  await fs.mkdir(dir, { recursive: true })
  const manifestPath = path.join(dir, 'package.json')
  try {
    await fs.access(manifestPath)
  } catch {
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          name: 'dsh-profile-web',
          private: true,
          dependencies: {},
          dsh: { profile: { bundles: [...DEFAULT_BUNDLES] } },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )
  }
  const cordisPath = path.join(dir, 'cordis.yml')
  try {
    await fs.access(cordisPath)
  } catch {
    await fs.writeFile(cordisPath, '# dsh profile root — an empty entry list. The tree is composed as patches:\n# each bundle in package.json\'s dsh.profile.bundles, then cordis.patch.yml, then any\n# --patch overlays. Edit cordis.patch.yml, not this file.\n[]\n', 'utf8')
  }
  const patchPath = path.join(dir, 'cordis.patch.yml')
  try {
    await fs.access(patchPath)
  } catch {
    await fs.writeFile(patchPath, '# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n', 'utf8')
  }
  const workspacePath = path.join(dir, 'pnpm-workspace.yaml')
  try {
    await fs.access(workspacePath)
  } catch {
    await fs.writeFile(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n', 'utf8')
  }
  return dir
}

export async function readProfileManifest(dshHome) {
  try {
    return JSON.parse(await fs.readFile(path.join(profileDir(dshHome), 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

async function writeProfileManifest(dshHome, manifest) {
  await fs.writeFile(
    path.join(profileDir(dshHome), 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )
}

function exportsPatch(packageName, dir) {
  try {
    const require = createRequire(path.join(dir, 'package.json'))
    const manifestPath = require.resolve(`${packageName}/package.json`)
    const manifest = JSON.parse(require('node:fs').readFileSync(manifestPath, 'utf8'))
    return manifest.dsh?.bundle?.patch !== undefined
  } catch {
    return false
  }
}

export async function reconcileBundles(dshHome) {
  const manifest = await readProfileManifest(dshHome)
  if (!manifest) return
  const dir = profileDir(dshHome)
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const plugins = manifest.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    if (exportsPatch(packageName, dir) && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    if (!DEFAULT_BUNDLES.includes(packageName) && !dependencySet.has(packageName)) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (changed) {
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: plugins } }
    await writeProfileManifest(dshHome, manifest)
  }
}

export function runPnpm(dshHome, args, { onLine } = {}) {
  return new Promise((resolve) => {
    const pnpmCjs = path.join(appRoot(), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    const child = spawn(process.execPath, [pnpmCjs, ...args, '--config.confirmModulesPurge=false'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd: profileDir(dshHome),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    let buffer = ''
    const feed = (chunk) => {
      output += chunk
      buffer += chunk
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline === -1) break
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        onLine?.(line)
      }
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.on('error', (error) => {
      onLine?.(`运行 pnpm 失败: ${String(error)}`)
      resolve({ code: -1, output })
    })
    child.on('exit', (code) => {
      if (buffer.trim() !== '') onLine?.(buffer)
      resolve({ code: code ?? -1, output })
    })
  })
}

export async function autoApproveBuilds(dshHome, packageName) {
  const workspacePath = path.join(profileDir(dshHome), 'pnpm-workspace.yaml')
  let text = ''
  try {
    text = await fs.readFile(workspacePath, 'utf8')
  } catch {
    text = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n'
  }
  if (!/^\s*allowBuilds:/m.test(text)) {
    text += '\nallowBuilds:\n'
  }
  if (!text.includes(`'${packageName}':`)) {
    text += `  '${packageName}': true\n`
  }
  await fs.writeFile(workspacePath, text, 'utf8')
}

function hasInstallScript(manifest) {
  const scripts = manifest?.scripts ?? {}
  return scripts.preinstall !== undefined || scripts.install !== undefined || scripts.postinstall !== undefined
}

async function installedManifest(dshHome, packageName) {
  const dir = profileDir(dshHome)
  try {
    const require = createRequire(path.join(dir, 'package.json'))
    const manifestPath = require.resolve(`${packageName}/package.json`)
    return JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

export async function installPlugin(dshHome, packageName, { onLine } = {}) {
  await ensureProfile(dshHome)
  const result = await runPnpm(dshHome, ['add', packageName], { onLine })
  if (result.code !== 0) {
    throw new Error(`安装 ${packageName} 失败（pnpm 退出码 ${result.code}）`)
  }
  const manifest = await installedManifest(dshHome, packageName)
  if (hasInstallScript(manifest)) {
    await autoApproveBuilds(dshHome, packageName)
    await runPnpm(dshHome, ['rebuild', packageName], { onLine })
  }
  await reconcileBundles(dshHome)
  return result
}

export async function removePlugin(dshHome, packageName, { onLine } = {}) {
  await ensureProfile(dshHome)
  const result = await runPnpm(dshHome, ['remove', packageName], { onLine })
  if (result.code !== 0) {
    throw new Error(`移除 ${packageName} 失败（pnpm 退出码 ${result.code}）`)
  }
  await reconcileBundles(dshHome)
  return result
}

export async function listInstalled(dshHome) {
  const manifest = await readProfileManifest(dshHome)
  const dependencies = manifest?.dependencies ?? {}
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  const items = []
  for (const [name, spec] of Object.entries(dependencies)) {
    const installed = await installedManifest(dshHome, name)
    items.push({
      name,
      spec,
      version: installed?.version ?? '?',
      description: installed?.description ?? '',
      isBundle: bundles.includes(name),
    })
  }
  return items
}

export async function searchPlugins(query, { size = 20 } = {}) {
  const q = query.trim() === '' ? 'keywords:dsh-plugin' : `${query.trim()} keywords:dsh-plugin`
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=${size}`
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`npm 搜索失败（HTTP ${response.status}）`)
  const data = await response.json()
  return (data.objects ?? []).map((entry) => ({
    name: entry.package.name,
    version: entry.package.version,
    description: entry.package.description ?? '',
    keywords: entry.package.keywords ?? [],
    links: entry.package.links ?? {},
  }))
}
