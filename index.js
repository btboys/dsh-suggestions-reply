/**
 * Host half of suggestions-reply:
 * 1. After each completed turn, generate 1-3 user-voice follow-up capsules
 *    anchored to the answer (one auxiliary LLM call, cached per session/turn).
 * 2. Persist reusable message templates in a storage domain and serve CRUD
 *    over one package-private HTTP RPC route shared by the UI and the agent tool.
 */
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

// Linked workspace bundles cannot resolve dsh's own packages; resolve from the dsh entry instead.
// Must import() (not require()): host loads plugins via Promise.all, require(esm) races.
function hostResolve(spec) {
  try {
    return createRequire(import.meta.url).resolve(spec)
  } catch {}
  if (!process.argv[1]) throw new Error('suggestions-reply: cannot locate the dsh installation')
  return createRequire(realpathSync(process.argv[1])).resolve(spec)
}
const hostImport = (spec) => import(pathToFileURL(hostResolve(spec)))

const schema = await hostImport('@deepseek-ai/schemastery')
const z = schema.z ?? schema.default ?? schema
const { z: zod } = await hostImport('zod')
const { defineDomain, domainTable } = await hostImport('@deepseek-ai/dsh-storage-domain')

export const name = 'suggestions-reply'
export const inject = ['webServer', 'sessions', 'sessionProjections', 'llm', 'storageDomain', 'tools', 'connection']

export const Config = z.object({
  enabled: z.boolean().default(true),
  maxSuggestions: z.number().step(1).min(1).max(3).default(3),
  provider: z.string().default(''),
  model: z.string().default(''),
  maxOutputTokens: z.number().step(1).min(64).max(2048).default(300),
  timeoutMs: z.number().step(1).min(1000).max(120000).default(20000),
  maxInputChars: z.number().step(1).min(500).max(24000).default(6000),
  templatesEnabled: z.boolean().default(true),
  maxTemplates: z.number().step(1).min(1).max(200).default(50),
})

const ROUTE = '/api/suggestions-reply'
const MAX_BODY_BYTES = 64 * 1024
const MAX_TITLE_CHARS = 60
const MAX_TEXT_CHARS = 4000
const MAX_CAPSULE_CHARS = 160

/* ---------------- projection: latest turn's generation input ---------------- */

const EMPTY_INPUT = Object.freeze({
  turn: -1,
  userText: '',
  assistantText: '',
  ended: false,
  endKind: '',
  interrupted: false,
})

/** Join text blocks with a per-block bound so one huge block cannot dominate the fold. */
function joinText(content, cap, keepTail) {
  let text = ''
  for (const block of content ?? []) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    const chunk = block.text.length > cap * 2 ? block.text.slice(0, cap * 2) : block.text
    text += text === '' ? chunk : `\n${chunk}`
    if (text.length >= cap * 2) break
  }
  if (text.length > cap) text = keepTail ? text.slice(-cap) : text.slice(0, cap)
  return text
}

function makeProjection(maxInputChars) {
  return {
    key: 'suggestionsReplyInput',
    stateVersion: 1,
    stateSchema: zod.object({
      turn: zod.number(),
      userText: zod.string(),
      assistantText: zod.string(),
      ended: zod.boolean(),
      endKind: zod.string(),
      interrupted: zod.boolean(),
    }),
    init: () => EMPTY_INPUT,
    apply: (state, event) => {
      switch (event.type) {
        case 'turn/start': {
          if (event.data.turn <= state.turn) return state
          return { turn: event.data.turn, userText: '', assistantText: '', ended: false, endKind: '', interrupted: false }
        }
        case 'user/message': {
          if (state.ended || state.userText !== '') return state
          if (event.data.source?.kind !== 'user') return state
          const userText = joinText(event.data.content, Math.min(maxInputChars, 2000), false)
          if (userText === '') return state
          return { ...state, userText }
        }
        case 'assistant/message': {
          if (state.ended || event.data.turn !== state.turn) return state
          const assistantText = joinText(event.data.message?.content, maxInputChars, true)
          if (assistantText === '') return state
          return { ...state, assistantText, interrupted: event.data.interrupted === true }
        }
        case 'turn/end': {
          if (state.ended || event.data.turn !== state.turn) return state
          return { ...state, ended: true, endKind: event.data.reason?.kind ?? '' }
        }
        default:
          return state
      }
    },
  }
}

/* ---------------- suggestion generation ---------------- */

function systemPrompt(maxSuggestions) {
  return [
    'You generate follow-up reply suggestions for a chat UI.',
    'Read the last user message and the assistant answer supplied as JSON.',
    `Output ONLY a JSON array of 1 to ${maxSuggestions} short strings. No markdown, no code fence, no explanation.`,
    'Each string is one message the USER would send next, written in the user\'s own voice (a first-person request or question).',
    'Use the same language as the conversation.',
    'Anchor every suggestion to specific content of the answer: a concrete next step, a clarification, an extension, or a verification of something the answer actually said.',
    'Avoid generic fillers such as "continue" or "tell me more" unless nothing specific exists.',
    `Keep each suggestion within 24 words or 40 CJK characters.`,
  ].join('\n')
}

/** Parse the model output into 1..max clean capsule strings; returns [] when unusable. */
function parseCapsules(text, max) {
  let raw = String(text ?? '').trim()
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let arr
  try {
    arr = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out = []
  for (const item of arr) {
    if (typeof item !== 'string') continue
    const s = item.trim().replace(/\s+/g, ' ')
    if (!s) continue
    out.push(s.length > MAX_CAPSULE_CHARS ? `${s.slice(0, MAX_CAPSULE_CHARS - 1)}…` : s)
    if (out.length >= max) break
  }
  return out
}

/* ---------------- templates domain ---------------- */

const templateSpec = defineDomain({
  name: 'suggestions_reply',
  version: 1,
  tables: {
    templates: domainTable(zod.object({
      title: zod.string(),
      text: zod.string(),
      order: zod.number(),
      createdAt: zod.number(),
      updatedAt: zod.number(),
      /** Click behavior: fill the composer (default) or send immediately. */
      sendMode: zod.enum(['fill', 'send']).default('fill'),
      /** Optional global hotkey that sends this template, e.g. "Ctrl+Shift+1". */
      hotkey: zod.string().default(''),
    })),
  },
})

function validateTemplateFields(title, text) {
  const t = typeof title === 'string' ? title.trim() : ''
  const x = typeof text === 'string' ? text.trim() : ''
  if (!t || t.length > MAX_TITLE_CHARS) throw new Error(`标题需为 1-${MAX_TITLE_CHARS} 个字符`)
  if (!x || x.length > MAX_TEXT_CHARS) throw new Error(`内容需为 1-${MAX_TEXT_CHARS} 个字符`)
  return { title: t, text: x }
}

/** Normalize the per-template click behavior; omission keeps the fill default. */
function normalizeMode(mode) {
  if (mode === undefined || mode === null || mode === '') return 'fill'
  if (mode !== 'fill' && mode !== 'send') throw new Error('sendMode 需为 fill 或 send')
  return mode
}

const HOTKEY_NAMED = ['Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']

/** Validate and canonicalize a hotkey string; empty means unbound. */
function normalizeHotkey(hotkey) {
  const raw = typeof hotkey === 'string' ? hotkey.trim() : ''
  if (raw === '') return ''
  if (raw.length > 32) throw new Error('快捷键过长')
  const parts = raw.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  const canonical = []
  for (const m of mods) {
    if (!['Ctrl', 'Meta', 'Alt', 'Shift'].includes(m)) throw new Error(`未知修饰键: ${m}`)
    canonical.push(m)
  }
  if (!canonical.some((m) => m !== 'Shift')) throw new Error('快捷键需包含 Ctrl、Alt 或 Meta')
  const order = ['Ctrl', 'Meta', 'Alt', 'Shift']
  canonical.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const keyOk = /^[A-Z]$/.test(key) || /^[0-9]$/.test(key) || /^F([1-9]|1[0-2])$/.test(key) || HOTKEY_NAMED.includes(key)
  if (!keyOk) throw new Error(`不支持的按键: ${key}`)
  return [...canonical, key].join('+')
}

/* ---------------- HTTP helpers ---------------- */

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/* ---------------- plugin ---------------- */

export async function apply(ctx, config) {
  const projection = await ctx.sessionProjections.register(makeProjection(config.maxInputChars))

  /** sessionId -> { turn, suggestions } ; only the latest eligible turn is kept. */
  const cache = new Map()
  /** sessionId -> { controller, timer, turn } ; one auxiliary call per session. */
  const pending = new Map()
  let disposed = false

  const abortPending = (sessionId) => {
    const p = pending.get(sessionId)
    if (p === undefined) return
    pending.delete(sessionId)
    clearTimeout(p.timer)
    p.controller.abort()
  }

  const routeFor = (session) => {
    if (config.provider && config.model) return { provider: config.provider, model: config.model }
    const header = session.requestHeader()
    const c = header?.config
    if (c?.provider && c?.model) return { provider: c.provider, model: c.model }
    return undefined
  }

  const eligible = (state) =>
    state.ended && state.endKind === 'completed' && !state.interrupted && state.assistantText !== ''

  /** Generate capsules for one exact completed turn; silent no-op when ineligible. */
  const generate = async (session, turn) => {
    if (disposed || !config.enabled) return
    // Subagent children never show capsules; skip their auxiliary calls.
    if (session.header?.origin === 'subagent') return
    const state = projection.stateOf(session)
    if (state.turn !== turn || !eligible(state)) return
    const route = routeFor(session)
    if (route === undefined) return
    abortPending(session.id)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    pending.set(session.id, { controller, timer, turn })
    try {
      const call = await ctx.llm.prepareCall(
        { ...route, maxTokens: config.maxOutputTokens },
        controller.signal,
      )
      const input = JSON.stringify({ user: state.userText, assistant: state.assistantText })
      const options = {
        ...call.config,
        messages: [{ role: 'user', content: [{ type: 'text', text: `Generate follow-up suggestions from this JSON:\n${input}` }] }],
        system: systemPrompt(config.maxSuggestions),
        sessionId: session.id,
        purpose: 'suggestions-reply',
        signal: controller.signal,
      }
      let text = ''
      for await (const chunk of call.stream(options)) {
        if (controller.signal.aborted) break
        if (chunk.type === 'text-delta') text += chunk.text
      }
      if (disposed || controller.signal.aborted) return
      // A newer turn started while generating: discard the stale result.
      const current = projection.stateOf(session)
      if (current.turn !== turn || !eligible(current)) return
      const suggestions = parseCapsules(text, config.maxSuggestions)
      if (suggestions.length === 0) return
      cache.set(session.id, { turn, suggestions })
      // Bound the cache: drop the oldest entries beyond 200 sessions.
      if (cache.size > 200) {
        const first = cache.keys().next().value
        if (first !== session.id) cache.delete(first)
      }
    } catch (error) {
      if (!controller.signal.aborted && !disposed) {
        console.warn('[suggestions-reply] generation failed:', error?.message ?? error)
      }
    } finally {
      clearTimeout(timer)
      if (pending.get(session.id)?.controller === controller) pending.delete(session.id)
    }
  }

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      cache.delete(session.id)
      abortPending(session.id)
      return
    }
    if (event.type !== 'turn/end') return
    if (!config.enabled || event.data.reason?.kind !== 'completed') return
    void generate(session, event.data.turn)
  })

  ctx.on('session/disposed', (session) => {
    cache.delete(session.id)
    abortPending(session.id)
  })

  /* ---- templates: one implementation shared by the RPC route and the agent tool ---- */

  let domainPromise
  /**
   * Open the template domain once per activation. The caller owns the handle
   * (the facility only closes leftovers on its own unmount), so a reload can
   * meet `already-open`: either a pending close from the previous activation
   * (retry until the name frees) or a handle leaked by an older version that
   * never closed it (adopt the live domain via get()). Reset the cached
   * promise on any failure so a later call can try again.
   */
  const ensureDomain = () => (domainPromise ??= (async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await ctx.storageDomain.open(templateSpec)
      } catch (error) {
        if (error?.code === 'already-open' && !disposed) {
          const existing = ctx.storageDomain.get(templateSpec.name)
          if (existing !== undefined) {
            try {
              existing.table('templates').keys()
              return existing
            } catch {}
          }
          if (attempt < 12) {
            await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
            continue
          }
        }
        throw error
      }
    }
  })().catch((error) => {
    domainPromise = undefined
    throw error
  }))

  const templateTable = async () => (await ensureDomain()).table('templates')

  const listTemplates = async () => {
    const table = await templateTable()
    return [...table.entries()]
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
  }

  const assertHotkeyFree = (table, hotkey, selfId) => {
    if (hotkey === '') return
    for (const [id, r] of table.entries()) {
      if (id !== selfId && r.hotkey === hotkey) throw new Error(`快捷键 ${hotkey} 已被模板「${r.title}」占用`)
    }
  }

  const addTemplate = async ({ title, text, sendMode, hotkey } = {}) => {
    const fields = validateTemplateFields(title, text)
    const mode = normalizeMode(sendMode)
    const key = normalizeHotkey(hotkey)
    const table = await templateTable()
    const existing = [...table.entries()]
    if (existing.length >= config.maxTemplates) throw new Error(`模板数量已达上限 ${config.maxTemplates}`)
    assertHotkeyFree(table, key, undefined)
    const id = randomUUID()
    const now = Date.now()
    const order = existing.reduce((m, [, r]) => Math.max(m, r.order), 0) + 1
    const record = { ...fields, sendMode: mode, hotkey: key, order, createdAt: now, updatedAt: now }
    await table.put(id, record)
    return { id, ...record }
  }

  const updateTemplate = async ({ id, title, text, sendMode, hotkey } = {}) => {
    if (typeof id !== 'string' || !id) throw new Error('缺少模板 id')
    const table = await templateTable()
    const current = table.get(id)
    if (current === undefined) throw new Error('模板不存在')
    const fields = validateTemplateFields(title ?? current.title, text ?? current.text)
    const key = normalizeHotkey(hotkey ?? current.hotkey)
    assertHotkeyFree(table, key, id)
    const next = { ...current, ...fields, sendMode: normalizeMode(sendMode ?? current.sendMode), hotkey: key, updatedAt: Date.now() }
    await table.update(id, () => next)
    return { id, ...next }
  }

  const removeTemplate = async ({ id } = {}) => {
    if (typeof id !== 'string' || !id) throw new Error('缺少模板 id')
    const table = await templateTable()
    const removed = await table.delete(id)
    if (!removed) throw new Error('模板不存在')
    return { removed: true }
  }

  const reorderTemplates = async ({ ids } = {}) => {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw new Error('ids 需为字符串数组')
    const table = await templateTable()
    const known = new Set(table.keys())
    if (ids.some((id) => !known.has(id))) throw new Error('包含不存在的模板 id')
    let order = 1
    for (const id of ids) {
      const current = table.get(id)
      if (current.order !== order) await table.update(id, (r) => ({ ...r, order }))
      order += 1
    }
    return { reordered: true }
  }

  const rpcMethods = {
    'templates.list': async () => ({ templates: await listTemplates() }),
    'templates.add': async (args) => ({ template: await addTemplate(args) }),
    'templates.update': async (args) => ({ template: await updateTemplate(args) }),
    'templates.remove': async (args) => removeTemplate(args),
    'templates.reorder': async (args) => reorderTemplates(args),
  }

  /* ---- live change feed: one SSE broadcast to every connected page ---- */

  /** Open SSE responses; each entry owns its heartbeat. */
  const streams = new Set()

  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'suggestions_reply') return
    for (const stream of streams) {
      try { stream.res.write('data: changed\n\n') } catch {}
    }
  })

  const openStream = (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    const heartbeat = setInterval(() => {
      try { res.write(': hb\n\n') } catch {}
    }, 30000)
    const stream = { res, heartbeat }
    streams.add(stream)
    req.on('close', () => {
      if (!streams.delete(stream)) return
      clearInterval(heartbeat)
      try { res.end() } catch {}
    })
  }

  ctx.effect(() => () => {
    for (const stream of [...streams]) {
      streams.delete(stream)
      clearInterval(stream.heartbeat)
      try { stream.res.end() } catch {}
    }
  }, 'suggestions-reply: change feed')

  /* ---- package-private HTTP route (UI caller) ---- */

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    async handler(req, res) {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', 'http://dsh.local')
      try {
        if (req.method === 'GET') {
          if (url.pathname === `${ROUTE}/events`) {
            openStream(req, res)
            return
          }
          if (url.pathname !== `${ROUTE}/suggestions`) {
            sendJson(res, 404, { ok: false, error: 'unknown route' })
            return
          }
          const sessionId = url.searchParams.get('session') ?? ''
          const turn = Number(url.searchParams.get('turn'))
          const session = ctx.sessions.get(sessionId)
          if (session === undefined || !Number.isInteger(turn)) {
            sendJson(res, 200, { ok: true, suggestions: [] })
            return
          }
          const state = projection.stateOf(session)
          if (state.turn !== turn || !eligible(state) || !config.enabled) {
            sendJson(res, 200, { ok: true, suggestions: [] })
            return
          }
          const hit = cache.get(session.id)
          if (hit !== undefined && hit.turn === turn) {
            sendJson(res, 200, { ok: true, suggestions: hit.suggestions })
            return
          }
          await generate(session, turn)
          const fresh = cache.get(session.id)
          sendJson(res, 200, { ok: true, suggestions: fresh !== undefined && fresh.turn === turn ? fresh.suggestions : [] })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        if (!config.templatesEnabled) {
          sendJson(res, 200, { ok: false, error: '模板功能已禁用' })
          return
        }
        const body = await readJsonBody(req)
        const method = typeof body?.method === 'string' ? body.method : ''
        const fn = rpcMethods[method]
        if (fn === undefined) {
          sendJson(res, 200, { ok: false, error: `unknown method: ${method}` })
          return
        }
        sendJson(res, 200, { ok: true, ...(await fn(body.args ?? {})) })
      } catch (error) {
        if (res.headersSent) {
          try { res.end() } catch {}
          return
        }
        sendJson(res, 200, { ok: false, error: error?.message ?? '请求失败' })
      }
    },
  }), 'suggestions-reply: routes')

  /* ---- agent tool (second caller of the same operations) ---- */

  try {
    const { defineTool } = await hostImport('@deepseek-ai/dsh-tools')
    const jsonRender = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    ctx.tools.register(defineTool({
      name: 'message_templates',
      description: 'Manage the user\'s reusable message templates (shown above the composer). Each template has a sendMode: "fill" (default) fills the input box on click, "send" sends it immediately as an ordinary message. action=list returns all templates; add creates one from title+text (+optional sendMode); update changes title/text/sendMode by id; remove deletes by id. Use list before update/remove to read exact ids and current content.',
      parameters: {
        action: { type: 'string', required: true, description: 'One of: list, add, update, remove.' },
        id: { type: 'string', description: 'Template id (update/remove).' },
        title: { type: 'string', description: `Short label, 1-${MAX_TITLE_CHARS} chars (add/update).` },
        text: { type: 'string', description: `Message body, 1-${MAX_TEXT_CHARS} chars (add/update).` },
        sendMode: { type: 'string', description: 'Click behavior: "fill" (default) or "send" (add/update).' },
        hotkey: { type: 'string', description: 'Optional global send hotkey, e.g. "Ctrl+Shift+1"; must include Ctrl/Alt/Meta; empty clears it (add/update).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            templates: { type: 'array', items: { type: 'object', additionalProperties: true } },
            template: { type: 'object', additionalProperties: true },
            removed: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        render: jsonRender,
      },
      execute: async (args) => {
        if (!config.templatesEnabled) return { ok: false, error: '模板功能已禁用' }
        try {
          switch (args.action) {
            case 'list': return { ok: true, templates: await listTemplates() }
            case 'add': return { ok: true, template: await addTemplate(args) }
            case 'update': return { ok: true, template: await updateTemplate(args) }
            case 'remove': return { ok: true, ...(await removeTemplate(args)) }
            default: return { ok: false, error: `unknown action: ${args.action}` }
          }
        } catch (error) {
          return { ok: false, error: error?.message ?? '操作失败' }
        }
      },
    }))
  } catch (error) {
    console.warn('[suggestions-reply] tool registration failed:', error?.message ?? error)
  }

  ctx.effect(() => () => {
    disposed = true
    for (const id of [...pending.keys()]) abortPending(id)
    cache.clear()
    const opening = domainPromise
    domainPromise = undefined
    if (opening !== undefined) opening.then((domain) => domain.close()).catch(() => {})
  }, 'suggestions-reply: generation lifecycle')
}