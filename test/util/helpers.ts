import type { On } from 'claude-code'

import type { RuleSource } from '../../src'
import { fakeFs, type FakeOptions, type Tree } from './fake-fs'

/** The test fixture plugin's name, which frames its rules and names its command. */
export const PLUGIN = 'consumer'

/** A prompt the user typed. */
export const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

/** A start of the session, or a reload of the module. */
export const START = { surface: 'terminal' as const, isInteractive: true, cwd: '/repo' }

/** The project's own CLAUDE.md, as the engine hands it to `prompt.context`. */
export const PROJECT_FILE = { path: '/repo/CLAUDE.md', kind: 'project' as const, content: '# Project\n' }

/** The engine asking for a conversation's context: its blocks, and the files behind `claudeMd`. */
export const context = () => ({
  blocks: [{ name: 'claudeMd', text: 'Contents of /repo/CLAUDE.md (project instructions, checked into the codebase):\n\n# Project\n' }],
  instructionFiles: [PROJECT_FILE],
})

/** A rule as the plugin adds it to the instructions: a `user` instruction file. */
export const userFile = (path: string, content: string) => ({ path, kind: 'user' as const, content })

/** The files the instructions carry once the plugin answered, the project's own left out. */
export const carried = (answer: { instructionFiles?: readonly { path: string; kind: string; content: string }[] }) =>
  (answer.instructionFiles ?? []).filter(file => file.path !== PROJECT_FILE.path)

/** A rule with `paths` as the model reads it: framed as the engine frames a rules file it loads. */
export const framed = (path: string, content: string) => `Contents of ${path}:\n\n${content}`

/** A rule without `paths` as a prompt or tool result carries it: framed as a `user` instruction file. */
export const told = (path: string, content: string) =>
  `Contents of ${path} (user's private global instructions for all projects):\n\n${content}`

/** The end of a main-conversation turn. */
export const TURN_END = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never

/** A compaction's summary: a compaction leaves at least one message. */
export const SUMMARY = [{ role: 'user', text: 'Summary', toolUses: [] }]

/** `overview.md` as the instructions carry it, and as a prompt or tool result does. */
export const OVERVIEW_FILE = userFile('/plugin/rules/overview.md', '# Overview\n')
export const OVERVIEW = told('/plugin/rules/overview.md', '# Overview\n')
export const TS = framed('/plugin/rules/backend/ts.md', '# TS rules\n')

/** The plugin's rules dir: `overview.md` always, `backend/ts.md` for `src/**\/*.ts`. */
export const RULES_DIR: RuleSource[] = [{ dir: '/plugin/rules' }]

/** The plugin's rules and a project to use them in; the consumer resolves `sources`. */
export function treeOf(sources: unknown, extra: Record<string, string> = {}): Tree {
  return {
    files: {
      '/sources.json': JSON.stringify(sources),
      '/plugin/rules/overview.md': '# Overview\n',
      '/plugin/rules/backend/ts.md': '---\npaths:\n  - "src/**/*.ts"\n---\n# TS rules\n',
      '/plugin/rules/notes.txt': 'not a rule\n',
      '/repo/CLAUDE.md': '# Project\n',
      '/repo/src/app.ts': 'export {}\n',
      '/repo/README.md': '# Repo\n',
      ...extra,
    },
  }
}

export type WorldOptions = FakeOptions & {
  /** What the engine answers every tool call with, or a function deciding it per call. */
  toolResult?: Record<string, unknown> | (() => Record<string, unknown>)
  /** How the engine attached a mentioned file; default `file`, null for nothing attached. */
  mentionType?: string | null
  /** The environment variables the session reads; none set by default. */
  env?: Record<string, string>
}

/**
 * The world beneath the plugins: the fake filesystem, and the engine's side of
 * every event the package hooks, answering with what it was given.
 */
export function world(on: On, tree: Tree, options: WorldOptions = {}) {
  const fake = fakeFs(on, tree, options)
  const commands: { name: string; description: string }[] = []
  const invalidated: string[] = []

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.compact', () => ({ messages: SUMMARY }) as never)
  on('command.register', ($, e) => (commands.push({ name: e.name, description: e.description }), { value: { command: e.name } }))
  on('command.run', ($, e) => ({ text: `engine ran /${e.command}` }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('prompt.attachment', ($, e) => ({ text: e.text }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))
  on('prompt.mention', () => ({ type: options.mentionType === undefined ? 'file' : options.mentionType }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('env.get', ($, e) => ({ value: options.env?.[e.name] }))
  on('agent.spawn', ($, e) => ({ model: 'model', agentId: e.resume?.agentId ?? 'spawned' }))
  on('ui.invalidate', ($, e) => (invalidated.push(e.event), { value: undefined }))
  on('tool.call', () => {
    const answer = typeof options.toolResult === 'function' ? options.toolResult() : options.toolResult
    return (answer ?? { result: { type: 'text' }, text: 'ok' }) as never
  })

  return { ...fake, commands, invalidated }
}

/** A Read of `file_path`, by the main loop or the subagent `agentId`. */
export const read = (file_path: string, agentId?: string) =>
  ({ tool: 'Read', file_path, ...(agentId === undefined ? {} : { agentId }) }) as never
