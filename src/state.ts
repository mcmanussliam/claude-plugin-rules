import type { EngineInterface } from 'claude-code'

import { sourceKey } from './core/sources'
import type { RuleSource } from './types'

/** Store key prefix of a session's record of rules already sent. */
const SENT_PREFIX = 'sent:'

/** Store key prefix of a session's sources added and removed in code. */
const CHANGES_PREFIX = 'changes:'

/** How many sessions' records the store keeps before dropping the oldest. */
const MAX_SESSIONS = 50

/** The loop name of the main conversation; a subagent's is its agent id. */
export const MAIN = 'main'

/** The ledger key of a loop's rules with `paths`: the loop itself. */
export const scopedKey = (agentId?: string): string => agentId ?? MAIN

/**
 * The ledger key of the rules without `paths` a conversation's instructions
 * carry, recorded afresh each time the engine asks for them: instructions are
 * rebuilt whole, so what they carried before is not in the conversation once
 * they are. Present once they were asked for, even with none to carry.
 */
export const alwaysKey = (agentId?: string): string => `always:${agentId ?? MAIN}`

/**
 * The ledger key of the rules without `paths` a loop was sent in its messages,
 * a prompt's context or a tool result's, which stay in its conversation.
 */
export const toldKey = (agentId?: string): string => `told:${agentId ?? MAIN}`

/** Store key of whether `prompt.context` reaches this plugin on this machine. */
const CONTEXT_KEY = 'prompt.context'

/**
 * Whether `prompt.context` reaches this plugin: `seen` once it has, `bypassed`
 * once a conversation's first turn ended without it. Claude Code passes over a
 * plugin a person installs there on a machine with managed settings and for
 * Team and Enterprise organizations.
 */
export type ContextReach = 'seen' | 'bypassed'

export async function contextReach($: EngineInterface): Promise<ContextReach | undefined> {
  const value = await $.store.get(CONTEXT_KEY)
  return value === 'seen' || value === 'bypassed' ? value : undefined
}

export async function setContextReach($: EngineInterface, reach: ContextReach): Promise<void> {
  if ((await contextReach($)) !== reach) {
    await $.store.set(CONTEXT_KEY, reach)
  }
}

/** Rule paths already sent in a session, by ledger key. */
export type Sent = Record<string, string[]>

/** What `addRules` and `removeRules` changed in a session. */
export type Changes = {
  /** Sources added, in order. */
  added: RuleSource[]
  /** Keys (`sourceKey`) of sources removed, whoever gave them. */
  removed: string[]
}

/**
 * The ledger of what was sent, kept in `$.store` per session rather than in
 * memory: the module can be reloaded or its worker respawned mid-conversation.
 * `$.store` is the consuming plugin's own, so two plugins never share one.
 *
 * Every write goes through one queue, so parallel tool calls don't overwrite
 * each other's records.
 */
export type Ledger = {
  queue: Promise<unknown>
}

export function newLedger(): Ledger {
  return { queue: Promise.resolve() }
}

/** Runs `work` after every write queued before it. */
function serially<T>(ledger: Ledger, work: () => Promise<T>): Promise<T> {
  const run = ledger.queue.then(work)
  ledger.queue = run.catch(() => undefined)
  return run
}

export async function sent($: EngineInterface): Promise<Sent> {
  return ((await $.store.get(`${SENT_PREFIX}${await $.session.id()}`)) as Sent | undefined) ?? {}
}

/**
 * Returns the `candidates` not yet sent under `key` this session, and records
 * them as sent.
 */
export function claim($: EngineInterface, ledger: Ledger, key: string, candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) {
    return Promise.resolve([])
  }

  return serially(ledger, async () => {
    const record = await sent($)
    const seen = new Set(record[key] ?? [])
    const fresh = candidates.filter(path => !seen.has(path))

    if (fresh.length > 0) {
      await setSent($, { ...record, [key]: [...seen, ...fresh] })
    }

    return fresh
  })
}

/** Records `paths` as exactly what has been sent under `key`. */
export function record($: EngineInterface, ledger: Ledger, key: string, paths: string[]): Promise<void> {
  return serially(ledger, async () => setSent($, { ...(await sent($)), [key]: paths }))
}

/** Drops what was recorded under `keys`, so those rules are sent again. */
export function forget($: EngineInterface, ledger: Ledger, keys: string[]): Promise<void> {
  return serially(ledger, async () => {
    const rest = Object.fromEntries(Object.entries(await sent($)).filter(([key]) => !keys.includes(key)))
    await setSent($, rest)
  })
}

/**
 * Starts loop `to` with what loop `from` (the main one when undefined) was
 * sent: a forked agent carries its parent's conversation, rules included.
 */
export function inherit($: EngineInterface, ledger: Ledger, from: string | undefined, to: string): Promise<void> {
  return serially(ledger, async () => {
    const record = await sent($)
    const inherited: Sent = {}

    for (const key of [scopedKey, toldKey, alwaysKey]) {
      const given = record[key(from)]
      if (given !== undefined) {
        inherited[key(to)] = [...new Set([...(record[key(to)] ?? []), ...given])]
      }
    }

    if (Object.keys(inherited).length > 0) {
      await setSent($, { ...record, ...inherited })
    }
  })
}

/** Drops a session's whole record: `/clear` ended its conversation. */
export function forgetSession($: EngineInterface, ledger: Ledger, sessionId: string): Promise<void> {
  return serially(ledger, async () => {
    await $.store.delete(`${SENT_PREFIX}${sessionId}`)
    await $.store.delete(`${CHANGES_PREFIX}${sessionId}`)
  })
}

export async function changes($: EngineInterface): Promise<Changes> {
  return ((await $.store.get(`${CHANGES_PREFIX}${await $.session.id()}`)) as Changes | undefined) ?? { added: [], removed: [] }
}

/**
 * Records sources added and removed this session. Adding a source already
 * added replaces it where it stands; adding one removed earlier brings it back.
 */
export function change($: EngineInterface, ledger: Ledger, edit: { add?: RuleSource[]; remove?: string[] }): Promise<void> {
  return serially(ledger, async () => {
    const current = await changes($)
    const adding = new Map((edit.add ?? []).map(source => [sourceKey(source), source]))
    const removing = new Set(edit.remove ?? [])

    const kept = current.added.filter(source => !removing.has(sourceKey(source)))
    const keptKeys = new Set(kept.map(sourceKey))
    const added = [
      ...kept.map(source => adding.get(sourceKey(source)) ?? source),
      ...[...adding].filter(([key]) => !keptKeys.has(key)).map(([, source]) => source),
    ]
    const removed = [...new Set([...current.removed.filter(key => !adding.has(key)), ...removing])]

    await setRecord($, CHANGES_PREFIX, added.length > 0 || removed.length > 0 ? { added, removed } : undefined)
  })
}

async function setSent($: EngineInterface, record: Sent): Promise<void> {
  await setRecord($, SENT_PREFIX, Object.keys(record).length > 0 ? record : undefined)
}

/** Writes the session's record under `prefix`, or deletes it when undefined. */
async function setRecord($: EngineInterface, prefix: string, value: unknown): Promise<void> {
  const key = `${prefix}${await $.session.id()}`

  await (value === undefined ? $.store.delete(key) : $.store.set(key, value))
  await prune($, prefix)
}

/** Drops the oldest sessions' records under `prefix` past `MAX_SESSIONS`. */
async function prune($: EngineInterface, prefix: string): Promise<void> {
  const keys = (await $.store.keys()).filter(key => key.startsWith(prefix))

  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SESSIONS))) {
    await $.store.delete(key)
  }
}
