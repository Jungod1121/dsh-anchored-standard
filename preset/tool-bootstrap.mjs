/**
 * Anchored tool bootstrap — keep the FIRST model request of every session on
 * a small tool surface (one native shell plus `read`), then expose the full
 * preset catalog once the session records its first durable promotion signal.
 *
 * The phase is derived from durable session events (append-only), so resume
 * and reload preserve it. By default a session promotes after the first
 * `tool/call` OR the first `assistant/message`, whichever comes first:
 * request #1 always sees the bootstrap catalog and request #2 always sees the
 * full catalog, so a text-only first reply can never trap the session in
 * bootstrap.
 *
 * Robustness:
 *  - Promotion is memoized per session id for the process lifetime.
 *  - A missing bootstrap tool degrades to the full catalog with a one-time
 *    warning instead of failing requests, so composition drift cannot brick
 *    a session.
 *  - Any filter failure also degrades to the full catalog.
 *
 * Mechanism verified on harness 0.1.0-rc.6 via wire-level `request/header`
 * snapshots: 2 tools on the first request, full catalog from request #2 on.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'anchored-tool-bootstrap'

/** Prompt assembly must exist before this request filter can register. */
export const inject = ['systemPrompt']

/** Durable session event types that count as a promotion signal. */
const DEFAULT_PROMOTE_EVENTS = ['tool/call', 'assistant/message']

function stringList(value, field, fallback) {
  if (value === undefined || value === null) return [...fallback]
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${name}: ${field} must be a non-empty array of strings`)
  }
  if (value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must contain only non-empty strings`)
  }
  return [...new Set(value)]
}

export function apply(ctx, config = {}) {
  const shellTools = stringList(config.shellTools, 'shellTools', ['bash', 'pwsh'])
  const commonTools = stringList(config.commonTools, 'commonTools', ['read'])
  const promoteEvents = new Set(stringList(config.promoteEvents, 'promoteEvents', DEFAULT_PROMOTE_EVENTS))

  /** Sessions already promoted in this process. Promotion is append-only. */
  const promoted = new Set()
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

  /** Whether the session has reached the promoted phase. */
  const isPromoted = (session) => {
    if (session === undefined) return true
    if (promoted.has(session.id)) return true
    if (!Array.isArray(session.events)) return true
    const hit = session.events.some((event) => event && promoteEvents.has(event.type))
    if (hit) promoted.add(session.id)
    return hit
  }

  /** Narrow the assembled catalog to one platform shell plus the common tools. */
  const applyBootstrap = (assembled) => {
    if (!assembled || !Array.isArray(assembled.tools)) return assembled
    const available = new Set(assembled.tools.map((tool) => tool && tool.name))
    const shell = shellTools.find((toolName) => available.has(toolName))
    const keep = []
    if (shell !== undefined) keep.push(shell)
    for (const toolName of commonTools) {
      if (available.has(toolName)) keep.push(toolName)
    }
    if (keep.length === 0) {
      warnOnce(`${name}: no bootstrap tool found among ${shellTools.join(',')} + ${commonTools.join(',')} — full catalog exposed`)
      return assembled
    }
    return {
      ...assembled,
      tools: assembled.tools.filter((tool) => tool && keep.includes(tool.name)),
    }
  }

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    // Downstream errors propagate untouched; only this filter's own logic is guarded.
    const assembled = await next()
    try {
      const agent = context && context.agent
      const session = agent ? agent.session : context && context.session
      if (isPromoted(session)) return assembled
      return applyBootstrap(assembled)
    } catch (error) {
      // A filter bug must never brick a session: degrade to the full catalog.
      warnOnce(`${name}: bootstrap filter failed, exposing the full catalog: ${String((error && error.message) || error)}`)
      return assembled
    }
  })
}
