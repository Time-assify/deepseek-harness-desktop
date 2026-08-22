import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

export const DEFAULT_PRICES = {
  'deepseek-chat': { input: 2, cacheRead: 0.5, output: 8 },
  'deepseek-reasoner': { input: 4, cacheRead: 1, output: 16 },
}

export function decodeSessionLog(buf) {
  const parts = []
  let pos = 0
  for (;;) {
    const start = buf.indexOf(ZSTD_MAGIC, pos)
    if (start === -1) break
    const next = buf.indexOf(ZSTD_MAGIC, start + 4)
    try {
      parts.push(zstdDecompressSync(buf.subarray(start, next === -1 ? buf.length : next)))
    } catch {
      // 帧损坏（写入中断）时跳过该帧，保留可解析部分
    }
    if (next === -1) break
    pos = next
  }
  return Buffer.concat(parts)
}

function parseLines(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // 跳过半行
    }
  }
  return events
}

export function priceForModel(model) {
  const name = String(model ?? '').toLowerCase()
  if (name.includes('deepseek-chat') || name.endsWith('/deepseek-chat')) return DEFAULT_PRICES['deepseek-chat']
  if (name.includes('deepseek-reasoner')) return DEFAULT_PRICES['deepseek-reasoner']
  return DEFAULT_PRICES['deepseek-chat']
}

export function estimateCost(model, tokens) {
  const price = priceForModel(model)
  const input = tokens.inputTokens ?? 0
  const cacheRead = Math.min(tokens.cacheReadTokens ?? 0, input)
  const output = tokens.outputTokens ?? 0
  const cny = (input - cacheRead) * price.input / 1e6
    + cacheRead * price.cacheRead / 1e6
    + output * price.output / 1e6
  return cny
}

export function parseSessionLog(buf) {
  const events = parseLines(decodeSessionLog(buf).toString('utf8'))
  const session = { tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, steps: 0, turns: 0 }
  let usageEvents = 0
  for (const event of events) {
    switch (event.type) {
      case 'session': {
        session.id = event.id
        session.createdAt = event.createdAt
        session.cwd = event.cwd
        session.agentPreset = event.agentPreset
        break
      }
      case 'session/title': {
        session.title = event.data?.title ?? event.title
        break
      }
      case 'request/header': {
        session.model = event.data?.header?.config?.model ?? session.model
        session.provider = event.data?.header?.config?.provider ?? session.provider
        break
      }
      case 'assistant/chunk': {
        const usage = event.data?.chunk?.usage
        if (usage !== undefined) {
          session.tokens.inputTokens += usage.inputTokens ?? 0
          session.tokens.outputTokens += usage.outputTokens ?? 0
          session.tokens.cacheReadTokens += usage.cacheReadTokens ?? 0
          usageEvents++
        }
        break
      }
      case 'step/end': {
        session.steps++
        break
      }
      case 'turn/end': {
        session.turns++
        break
      }
    }
    session.lastActivity = event.time ?? session.lastActivity
  }
  session.usageEvents = usageEvents
  session.costCny = estimateCost(session.model, session.tokens)
  return session
}

export async function scanSessionFiles(sessionsRoot) {
  const files = []
  let dirs
  try {
    dirs = await readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue
    const workspaceDir = path.join(sessionsRoot, entry.name)
    let sessionDirs
    try {
      sessionDirs = await readdir(workspaceDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue
      const file = path.join(workspaceDir, sessionDir.name, 'session.jsonl.zstd')
      files.push({ file, workspaceDir: entry.name, sessionId: sessionDir.name })
    }
  }
  return files
}

export async function aggregateSessions(sessionsRoot) {
  const files = await scanSessionFiles(sessionsRoot)
  const sessions = []
  for (const { file, workspaceDir, sessionId } of files) {
    try {
      const buf = await readFile(file)
      const parsed = parseSessionLog(buf)
      parsed.workspaceDir = workspaceDir
      parsed.sessionId = sessionId
      parsed.sizeBytes = buf.length
      sessions.push(parsed)
    } catch {
      // 单个文件损坏不影响汇总
    }
  }
  sessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))
  const totals = sessions.reduce(
    (acc, session) => ({
      inputTokens: acc.inputTokens + session.tokens.inputTokens,
      outputTokens: acc.outputTokens + session.tokens.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + session.tokens.cacheReadTokens,
      costCny: acc.costCny + session.costCny,
      steps: acc.steps + session.steps,
      turns: acc.turns + session.turns,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costCny: 0, steps: 0, turns: 0 },
  )
  return { sessions, totals }
}
