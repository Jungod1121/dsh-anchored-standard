/**
 * Anchored tool bootstrap v2 — task-aware reasoning-mode anchors.
 *
 * Classifies the session's FIRST user message into one of three anchors and
 * keeps the first model request on a small, task-matched tool surface:
 *
 *   spec  (fix / maintain / debug)   → Minimal persona,  bash + read + edit
 *   react (build / create / from 0) → doer persona,     bash + read + write
 *   weak  (ambiguous)               → model self-picks; bash + read only
 *
 * After the session records its first durable `tool/call`, every later
 * request sees the full preset catalog; the chosen persona stays constant,
 * runtime contexts are cleared, and the remaining prompt sections (plan-mode
 * etc.) come back. The mode derives from durable session events, so resume
 * and reload preserve it.
 *
 * Design boundaries (measured evidence):
 *  - `glob` is a trajectory boundary for V4 Pro (xiaobright probes): a
 *    first-turn catalog with glob breaks the Minimal-like anchor. `grep` is
 *    unverified. Both stay out of the bootstrap catalogs.
 *  - `bash+edit` and `bash+write` both keep the Minimal-like anchor
 *    (xiaobright probes), so the spec/react catalogs use them.
 *  - Pro does NOT want post-anchor injected guidance (router-standard P24:
 *    anchors hurt Pro). Flash benefits from neutral persona + classify
 *    instruction (router-standard P11). Nothing is injected after turn one.
 *
 * Robustness: promotion is memoized per session; mode is memoized per
 * session; a missing bootstrap tool degrades to the full catalog instead of
 * throwing; any filter failure also degrades to the full catalog.
 */

import { appendFileSync } from 'node:fs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchored-tool-bootstrap'

/** Prompt assembly must exist before this request filter can register. */
export const inject = ['systemPrompt']

/* ── task classifier (ported from router-standard, zero dependencies) ───── */

const REACT_RE = /(开发|创建|写一个|写个|生成|从零|做一个|做个|搞一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|添加|新增|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|修改|改一下|调整|完善|润色|排版|措辞|替换|删除|删掉|移除|去掉|清理|整理|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容|edit|modify|tweak|adjust|update|polish|rename|delete|remove|cleanup)/gi

function countHits(regex, text) {
  return [...String(text || '').matchAll(regex)].length
}

/** Classify a task text: clear keyword evidence picks spec/react; ambiguous
 *  or unmatched text returns 'weak' (the model decides per task). */
export function classifyTask(text) {
  const react = countHits(REACT_RE, text)
  const spec = countHits(SPEC_RE, text)
  if (react > spec) return 'react'
  if (spec > react) return 'spec'
  return 'weak'
}

/** Unwrap the text of a durable user/message event (defensive shapes). */
export function extractText(data) {
  if (!data) return ''
  const payload = data && typeof data.message === 'object' && data.message !== null ? data.message : data
  const content = Array.isArray(payload.content) ? payload.content : []
  return content.map((c) => (typeof c === 'string' ? c : (c && c.text) || '')).join(' ')
}

/** Per-session mode derived from durable events (resume-safe). */
export function sessionMode(session) {
  if (!session || !Array.isArray(session.events)) return 'weak'
  const userMsg = session.events.find((event) => event && event.type === 'user/message')
  return classifyTask(extractText(userMsg && userMsg.data))
}

/* ── personas ────────────────────────────────────────────────────────────── */

const PERSONA_SPEC = 'You are a helpful software engineer assistant.'

const PERSONA_REACT =
  'You are a hands-on software engineer who delivers working output fast.\n'
  + 'Work directly: write or edit code, then verify it by reading and running. '
  + 'Keep the loop tight — produce, verify, fix — and do not build test '
  + 'harnesses, scaffolding, or ceremony the user did not ask for. '
  + 'Finish with a usable deliverable and a short summary.'

/** Pro optimum (router-standard P11/P24): spec sentence + classify
 *  instruction, NO anchors. */
const PERSONA_WEAK_PRO =
  'You are a helpful software engineer assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.'

/** Flash optimum (router-standard P11/P23): neutral + classify + anchors. */
const PERSONA_WEAK_FLASH =
  'You are a helpful assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.\n'
  + 'Before acting, briefly review what you have already done in this session '
  + 'and continue from where you left off; do not repeat completed steps. '
  + 'Do not run environment checks (echo, whoami, uname, node --version, date) '
  + 'or exhaustive grep/glob scans.'

function isFlashModel(modelId) {
  return typeof modelId === 'string' && /flash/i.test(modelId)
}

/** Persona for a mode; weak picks the model-specific internal-routing text. */
export function personaFor(mode, modelId) {
  if (mode === 'react') return PERSONA_REACT
  if (mode === 'spec') return PERSONA_SPEC
  return isFlashModel(modelId) ? PERSONA_WEAK_FLASH : PERSONA_WEAK_PRO
}

/* ── first-turn core tools (shell added dynamically) ─────────────────────── */

/** Bootstrap catalogs per mode. `glob`/`grep` are deliberately absent
 *  (xiaobright boundary probes); edit/write are anchor-safe. */
export function coreFor(mode, shell) {
  const common = [shell, 'read']
  if (mode === 'spec') return [...common, 'edit']
  if (mode === 'react') return [...common, 'write']
  return common // weak: conservative minimal anchor
}

/* ── prompt-section helpers ──────────────────────────────────────────────── */

/** Replace only the persona section, keeping everything else (plan-mode
 *  above all, which returns after promotion). */
export function applyPersona(sections, personaText) {
  const rest = (sections || []).filter(
    (section) => !section || (section.name !== 'persona' && !/persona/i.test(section.name)),
  )
  return [{ name: 'anchored-persona', text: personaText, order: 0 }, ...rest]
}

/* ── plugin ──────────────────────────────────────────────────────────────── */

export function apply(ctx, config = {}) {
  /** Sessions already promoted in this process. Promotion is append-only. */
  const promoted = new Set()
  /** Per-session resolved mode (append-only across the process lifetime). */
  const modes = new Map()
  /** First REAL user message text per session, captured from agent/pre-step
   *  (the in-memory session.events array may not contain the first
   *  user/message yet when the FIRST assembly runs — measured on rc.6). */
  const firstTexts = new Map()
  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message)
    } catch {
      // Logger unavailable — the guard exists only to avoid spamming.
    }
  }

  let dbgCount = 0
  const dbg = (msg) => {
    if (dbgCount >= 60) return
    dbgCount += 1
    try { appendFileSync('/tmp/anchored-v2-debug.log', new Date().toISOString() + ' ' + msg + '\n') } catch { /* ignore */ }
  }

  const messageText = (message) => {
    if (!message) return ''
    const content = Array.isArray(message.content) ? message.content : []
    return content.map((c) => (typeof c === 'string' ? c : (c && c.text) || '')).join(' ')
  }

  /** Capture the first real user message of each session from the EARLIEST
   *  durable point — agent/inbox/inserted — which fires when the message
   *  enters the inbox, strictly before any prompt assembly. (Measured on
   *  rc.6: the FIRST assembly of a fresh session runs BEFORE agent/pre-step,
   *  so pre-step is too late for the first request.) */
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    try {
      const session = agent && agent.session
      if (!session || firstTexts.has(session.id)) return
      if (!message || !message.source || message.source.kind !== 'user') return
      const text = messageText(message)
      dbg('inbox/inserted captured text=' + JSON.stringify(text.slice(0, 80)))
      if (text.trim()) firstTexts.set(session.id, text)
    } catch {
      // Observation only.
    }
  })

  /** Fallback capture point for sessions that never saw inbox/inserted. */
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      const session = payload && payload.agent && payload.agent.session
      dbg('pre-step fired; payloadKeys=' + Object.keys(payload || {}).join(',') + '; hasSession=' + (session !== undefined))
      if (!session || firstTexts.has(session.id)) return decision
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      dbg('pre-step messages=' + messages.length + '; kinds=' + messages.map((m) => (m && m.source && m.source.kind) || (m && m.role) || '?').join('|'))
      const first = messages.find((m) => m && m.source && m.source.kind === 'user')
      if (first === undefined) return decision // system reminders do not classify
      const text = messageText(first)
      dbg('pre-step captured text=' + JSON.stringify(text.slice(0, 80)))
      if (text.trim()) firstTexts.set(session.id, text)
    } catch {
      // Observation only — never disturb the step pipeline.
    }
    return decision
  })

  const resolveMode = (session) => {
    if (modes.has(session.id)) return modes.get(session.id)
    const cached = firstTexts.get(session.id)
    const mode = cached !== undefined && cached.trim() !== ''
      ? classifyTask(cached)
      : sessionMode(session)
    modes.set(session.id, mode)
    return mode
  }

  const isPromoted = (session) => {
    if (promoted.has(session.id)) return true
    if (!Array.isArray(session.events)) return true
    const hit = session.events.some((event) => event && event.type === 'tool/call')
    if (hit) promoted.add(session.id)
    return hit
  }

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const assembled = await next()
    try {
      const agent = context && context.agent
      const session = agent ? agent.session : undefined
      if (session === undefined) return assembled
      const mode = resolveMode(session)
      dbg('assemble; hasFirstText=' + firstTexts.has(session.id) + '; mode=' + mode + '; userEvents=' + (Array.isArray(session.events) ? session.events.filter((e) => e && e.type === 'user/message').length : -1) + '; promoted=' + isPromoted(session))
      const modelId = (agent.options && agent.options.model) || ''
      const persona = personaFor(mode, modelId)

      if (isPromoted(session)) {
        // Promoted: full catalog; persona stays; contexts cleared; the other
        // sections (plan-mode etc.) come back for the rest of the session.
        return {
          ...assembled,
          sections: applyPersona(assembled.sections, persona),
          contexts: [],
        }
      }

      const tools = Array.isArray(assembled.tools) ? assembled.tools : []
      const available = new Set(tools.map((tool) => tool && tool.name))
      const shell = available.has('bash') ? 'bash' : available.has('pwsh') ? 'pwsh' : undefined
      if (shell === undefined) {
        warnOnce(`${name}: no platform shell in the catalog — full catalog exposed`)
        return assembled
      }
      const core = new Set(coreFor(mode, shell))

      // First request: the cleanest possible opening (persona is the only
      // section, contexts cleared — equivalent to a complete persona) plus
      // the task-matched bootstrap catalog.
      return {
        ...assembled,
        sections: [{ name: 'anchored-persona', text: persona, order: 0 }],
        contexts: [],
        tools: tools.filter((tool) => tool && core.has(tool.name)),
      }
    } catch (error) {
      // A filter bug must never brick a session: degrade to the full catalog.
      warnOnce(`${name}: bootstrap filter failed, exposing the full catalog: ${String((error && error.message) || error)}`)
      return assembled
    }
  })
}
