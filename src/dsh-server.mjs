import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
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

function killTreeWindows(pid) {
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => resolve())
    killer.on('exit', () => resolve())
  })
}

export class DshServer {
  constructor({ onReady, onLog, onExit }) {
    this.child = null
    this.url = null
    this.onReady = onReady
    this.onLog = onLog
    this.onExit = onExit
    this.port = 0
    this.exitedByUs = false
    this.stdoutBuffer = ''
  }

  start({ port = 0, baseUrl = '' } = {}) {
    if (this.child !== null) throw new Error('dsh 已在运行，先 stop 再 start')
    this.url = null
    this.stdoutBuffer = ''
    const bin = path.join(appRoot(), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const args = ['web', '--no-open', '--host', '127.0.0.1', '--port', String(port)]
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    if (baseUrl.trim() !== '') env.DEEPSEEK_BASE_URL = baseUrl.trim()
    this.onLog?.(`启动 dsh: ${bin} ${args.join(' ')}\n`)
    const child = spawn(process.execPath, ['--expose-internals', bin, ...args], {
      env,
      cwd: homedir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      this.onLog?.(chunk)
      this.stdoutBuffer += chunk
      for (;;) {
        const newline = this.stdoutBuffer.indexOf('\n')
        if (newline === -1) break
        const line = this.stdoutBuffer.slice(0, newline)
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
        const match = line.match(/dsh web:\s+(https?:\/\/[^\s(]+)/)
        if (match && this.url === null) {
          this.url = match[1]
          this.onReady?.(this.url)
        }
      }
    })
    child.stderr?.on('data', (chunk) => {
      this.onLog?.(chunk)
    })
    child.on('error', (error) => {
      if (this.child === child) this.child = null
      this.onLog?.(`启动失败: ${String(error)}\n`)
    })
    child.on('exit', (code, signal) => {
      if (this.child !== child) return
      this.child = null
      if (!this.exitedByUs) {
        this.onExit?.(code, signal)
        this.onLog?.(`dsh 已退出 (code=${code}, signal=${signal})\n`)
      } else {
        this.exitedByUs = false
      }
    })
  }

  get isRunning() {
    return this.child !== null
  }

  get pid() {
    return this.child?.pid ?? null
  }

  async stop() {
    const child = this.child
    if (!child || child.pid === undefined) return
    this.exitedByUs = true
    this.onLog?.('正在关闭 dsh 服务…\n')
    const exited = new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    if (process.platform === 'win32') {
      await killTreeWindows(child.pid)
    } else {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (this.child === child) child.kill('SIGKILL')
      }, 3000)
    }
    await exited
    if (this.child === child) this.child = null
    this.exitedByUs = false
  }
}
