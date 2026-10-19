import type {EngineInterface, FsReadOptions, InstructionFile, On} from 'claude-code'

import {instructionFrameOf, isMatch, nestedFrameOf} from './core/rule'
import {loadSources, sourceKey, toSource, uniqueSources, type RuleCache} from './core/sources'
import {
  alwaysKey,
  change,
  changes,
  claim,
  contextReach,
  forget,
  forgetSession,
  inherit,
  newLedger,
  record,
  scopedKey,
  sent,
  setContextReach,
  toldKey,
  type Ledger,
} from './state'
import type {ResolveRules, Rule, RuleInput, RuleRef, RuleSet, RuleSource, RuleStatus, RulesContext, RulesOptions, RulesSources} from './types'

/**
 * The matcher on every hook without a narrower one. Claude Code refuses a
 * module that registers an event twice without a matcher, and this code is
 * bundled into the consuming plugin's module, beside that plugin's own hooks:
 * with a matcher on each of ours, the plugin stays free to hook any event.
 */
const ALL = {}

/**
 * Values of an environment variable that switch it on, as Claude Code reads
 * `CLAUDE_CODE_SIMPLE` and `CLAUDE_CODE_DISABLE_ATTACHMENTS`.
 */
const SWITCHED_ON = new Set(['1', 'true', 'yes', 'on'])

/**
 * One `rules` call's state, behind the RuleSet it hands out. Hooks hand `$`
 * only to the top-level functions below, with this beside it: Claude Code
 * refuses a module that passes `$` to a closure or a method.
 */
type Loader = RuleSet & {
  resolve: ResolveRules
  options: RulesOptions
  ledger: Ledger
  /** The rules read so far, so a file is read again only once it changes. */
  cache: RuleCache
  /** What the resolver gave; undefined until first needed, and after a failure or a reload. */
  resolved?: Promise<readonly RuleSource[]>
  /** The command's name once registered. */
  command?: string
}

/** A rule set's state; RuleSet keeps it out of the consumer's view. */
const loaderOf = (set: RuleSet): Loader => set as Loader

const isRuleSet = (value: unknown): value is RuleSet =>
  typeof value === 'object' && value !== null && (value as Partial<RuleSet>).kind === 'claude-plugin-rules'

/**
 * Makes your plugin's rule set: what every session starts with, and the handle
 * `addRules`, `removeRules`, `listRules` and `reloadRules` change and read from
 * your own hooks. Call it at the top of your hooks module and hand the set to
 * `rules` in `register`; Claude Code refuses a module that keeps what a call
 * taking `on` returns, so `rules` cannot hand it back.
 *
 * @param sources the rules to start every session with: a path (relative to
 * your plugin's root), a source, a list of them, or a resolver deciding them
 * per project. Default `'rules'`, your plugin's `rules/` directory.
 *
 * @example
 * const ruleSet = defineRules('rules/core')
 *
 * export function register(on: On): void {
 *   rules(on, ruleSet)
 *
 *   on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
 *     if (e.skill === 'deploy') await addRules($, ruleSet, 'rules/deploy')
 *     return next(e)
 *   })
 * }
 */
export function defineRules(sources: RulesSources = 'rules', options: RulesOptions = {}): RuleSet {
  const resolve: ResolveRules = typeof sources === 'function' ? sources : () => sources
  const loader: Loader = { kind: 'claude-plugin-rules', resolve, options, ledger: newLedger(), cache: new Map() }
  return loader
}

/**
 * Gives your plugin rules that load the way Claude Code loads `.claude/rules`.
 * Call it once from your hooks module's `register`, with the set `defineRules`
 * made, or with the sources and options to make one from when you never change
 * it from your hooks.
 *
 * A rule without `paths` joins the instructions beside CLAUDE.md, as a `user`
 * instruction file; one with `paths` attaches when Claude reads or
 * `@`-mentions a matching file. On Team and Enterprise plans and machines
 * with managed settings, Claude Code keeps the instructions out of reach of a
 * plugin the user installed, so there the first prompt (or a subagent's first
 * tool) carries those rules instead. Neither reaches the model outside the
 * instructions when `CLAUDE_CODE_SIMPLE` or `CLAUDE_CODE_DISABLE_ATTACHMENTS`
 * is set.
 *
 * Also registers `/<your plugin's name>-rules`, listing your rules and which
 * have loaded (RulesOptions `command`).
 *
 * @example
 * // Your plugin's rules/ directory
 * rules(on)
 *
 * @example
 * // Each tool's rules, only in projects that use it
 * rules(on, async ({ fs, session }) => {
 *   const pkg = JSON.parse(await fs.read(`${session.root}/package.json`).catch(() => '{}'))
 *   const deps = { ...pkg.dependencies, ...pkg.devDependencies }
 *
 *   return ['react', 'prisma', 'vitest'].filter(name => name in deps).map(name => `rules/${name}`)
 * })
 */
export function rules(on: On, set?: RuleSet): void
export function rules(on: On, sources?: RulesSources, options?: RulesOptions): void
export function rules(on: On, setOrSources?: RuleSet | RulesSources, options?: RulesOptions): void {
  const loader = loaderOf(isRuleSet(setOrSources) ? setOrSources : defineRules(setOrSources, options))
  const { ledger } = loader

  // Every hook passes its event on untouched if it fails: rules never gate
  // anything, so a failure loses at most the rules it would have sent
  on('session.start', ALL, async ($, e, next) => {
    const started = await next(e)
    loader.resolved = undefined
    await sourcesOf($, loader)
    await registerCommand($, loader)
    refreshInstructions($)
    return started
  }).catch(($, e, next) => next(e))

  on('command.run', ALL, async ($, e, next) =>
    e.command === loader.command ? { text: await listing($, loader) } : next(e),
  ).catch(($, e, next) => next(e))

  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    await forgetSession($, ledger, e.sessionId)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The compacted loop is sent its rules again: the engine asks for its
  // instructions afresh, and path rules attach at their next match. Where
  // `prompt.context` passes this plugin over, so does this event.
  on('session.compact', ALL, async ($, e, next) => {
    const result = await next(e)
    await forget($, ledger, [scopedKey(e.agentId), alwaysKey(e.agentId), toldKey(e.agentId)])
    return result
  }).catch(($, e, next) => next(e))

  // Rules without `paths` load as Claude Code's own instruction files do: the
  // engine frames them beside CLAUDE.md, sends them again when they change,
  // and asks again after a compaction or /clear. Those a prompt or tool result
  // already carried stay out, so nothing is read twice.
  on('prompt.context', ALL, async ($, e, next) => {
    // A hook above rewrote the instructions' text: files added now would be lost
    if (e.instructionFiles === undefined) {
      return next(e)
    }

    const told = new Set((await sent($))[toldKey()] ?? [])
    const present = new Set(e.instructionFiles.map(file => file.path))
    const carried = (await alwaysOf($, loader)).filter(rule => !told.has(rule.path) && !present.has(rule.path))

    await record($, ledger, alwaysKey(), carried.map(rule => rule.path))
    await setContextReach($, 'seen')

    return next({ ...e, instructionFiles: withUserFiles(e.instructionFiles, carried) })
  }).catch(($, e, next) => next(e))

  // Where `prompt.context` passes this plugin over (on a machine with managed
  // settings, and for Team and Enterprise organizations), rules without `paths`
  // ride the prompt instead. Until this machine is known to reach it, the
  // first prompt carries them too, and `prompt.context` leaves them out.
  on('prompt.submit', ALL, async ($, e, next) => {
    if ((await sent($))[alwaysKey()] === undefined && (await contextReach($)) === 'seen') {
      return next(e)
    }

    if (await isAttachmentsOff($)) {
      return next(e)
    }

    const fresh = await tell($, loader, await alwaysOf($, loader))
    return next(fresh.length > 0 ? { ...e, context: [...(e.context ?? []), ...fresh.map(instructionFrameOf)] } : e)
  }).catch(($, e, next) => next(e))

  // A first turn that ended with no instructions asked for: `prompt.context`
  // passes this plugin over here
  on('turn.complete', ALL, async ($, e, next) => {
    if ((await sent($))[alwaysKey()] === undefined) {
      await setContextReach($, 'bypassed')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A file mentioned with `@` loads its path rules, as a read of it does
  on('prompt.mention', ALL, async ($, e, next) => {
    const result = await next(e)

    if (result.deny !== undefined || result.type === null || (await isAttachmentsOff($))) {
      return result
    }

    const fresh = await rulesForRead($, loader, await rulesOf($, loader), e)
    return fresh.length > 0 ? { ...result, context: [...(result.context ?? []), ...fresh.map(nestedFrameOf)] } : result
  }).catch(($, e, next) => next(e))

  // A forked agent carries its parent's conversation, and the rules in it
  on('agent.spawn', { fork: true }, async ($, e, next) => {
    const result = await next(e)

    if (e.resume === undefined && result.agentId !== undefined) {
      await inherit($, ledger, e.parentAgentId, result.agentId)
    }
    return result
  }).catch(($, e, next) => next(e))

  // A Read's result carries the path rules its file matches, framed as Claude
  // Code frames those it loads; as with Claude Code's own, editing or writing
  // a file loads none. Any tool's result also carries the rules without
  // `paths` its loop hasn't had: those added mid-turn, or all of them where
  // the instructions never carried them.
  on('tool.call', ALL, async ($, e, next) => {
    const result = await next(e)

    if (result.deny !== undefined || result.isError || (await isAttachmentsOff($))) {
      return result
    }

    const all = await rulesOf($, loader)
    const scoped =
      e.tool === 'Read' && typeof e.file_path === 'string' ? await rulesForRead($, loader, all, { ...e, path: e.file_path }) : []
    const always = await tell($, loader, all.filter(rule => rule.paths === undefined), e.agentId)
    const fresh = [...always.map(instructionFrameOf), ...scoped.map(nestedFrameOf)]

    return fresh.length > 0 ? { ...result, context: [...(result.context ?? []), ...fresh] } : result
  }).catch(($, e, next) => next(e))
}

/**
 * Adds sources to your rules for the rest of this conversation, beside those
 * `rules` started with. Rules without `paths` join the instructions (or ride
 * the next prompt or tool result, where those are out of reach); path rules
 * attach at their next matching file. Adding a source already there replaces it.
 *
 * Kept per conversation in your plugin's store, so a module reload keeps them
 * and `/clear` drops them.
 *
 * @returns the rules the added sources load now.
 *
 * @example
 * await addRules($, ruleSet, ['rules/deploy', { name: 'freeze', content: 'No deploys on Fridays.' }])
 */
export async function addRules($: EngineInterface, set: RuleSet, inputs: RuleInput | readonly RuleInput[]): Promise<Rule[]> {
  const sources = uniqueSources(([inputs].flat() as RuleInput[]).map(input => toSource(input, $.plugin.root)))
  await change($, loaderOf(set).ledger, { add: sources })
  refreshInstructions($)
  return loadSources($, sources)
}

/**
 * Stops sources loading for the rest of this conversation, whether `rules`
 * started with them or `addRules` added them: name a source as you gave it,
 * or a rule written in code by its `name` alone. A rule the instructions
 * carried leaves them; one a prompt or tool result carried stays where it was.
 *
 * @example
 * await removeRules($, ruleSet, ['rules/deploy', { name: 'freeze' }])
 */
export async function removeRules($: EngineInterface, set: RuleSet, refs: RuleRef | readonly RuleRef[]): Promise<void> {
  const keys = ([refs].flat() as RuleRef[]).map(ref =>
    typeof ref !== 'string' && 'name' in ref ? `rules:${ref.name}` : sourceKey(toSource(ref, $.plugin.root)),
  )
  await change($, loaderOf(set).ledger, { remove: keys })
  refreshInstructions($)
}

/** Every rule that applies now, each marked once it has reached the main conversation. */
export async function listRules($: EngineInterface, set: RuleSet): Promise<RuleStatus[]> {
  const record = await sent($)
  const reached = new Set([alwaysKey(), toldKey(), scopedKey()].flatMap(key => record[key] ?? []))

  return (await rulesOf($, loaderOf(set))).map(rule => ({ ...rule, sent: reached.has(rule.path) }))
}

/**
 * Asks the resolver again the next time rules are needed, as after a reload of
 * your module: call it when something it decides by has changed.
 *
 * Rule files themselves need no reload; they are read afresh each time.
 */
export function reloadRules($: EngineInterface, set: RuleSet): void {
  loaderOf(set).resolved = undefined
  refreshInstructions($)
}

/**
 * Has the engine ask `prompt.context` again, so the instructions carry the
 * rules as they now stand.
 *
 * Refused where the event passes this plugin over.
 */
function refreshInstructions($: EngineInterface): void {
  try {
    $.ui.invalidate('prompt.context')
  } catch {
    // Out of reach here: prompts and tool results carry the rules instead
  }
}

/**
 * `files` with `rules` added as `user` instruction files: after the person's
 * own, before the project's, as the engine orders its tiers.
 */
function withUserFiles(files: readonly InstructionFile[], rules: Rule[]): InstructionFile[] {
  const added = rules.map((rule): InstructionFile => ({ path: rule.path, kind: 'user', content: rule.content }))
  const lastUser = files.findLastIndex(file => file.kind === 'user')
  const firstLater = files.findIndex(file => file.kind !== 'managed' && file.kind !== 'user')
  const at = lastUser !== -1 ? lastUser + 1 : firstLater !== -1 ? firstLater : files.length

  return [...files.slice(0, at), ...added, ...files.slice(at)]
}

/**
 * Whether Claude Code was told to leave out what it attaches for the model,
 * as agents-md and Claude Code's own nested rules do: then rules reach the
 * model only through the instructions.
 */
async function isAttachmentsOff($: EngineInterface): Promise<boolean> {
  const [simple, noAttachments] = await Promise.all([$.env.get('CLAUDE_CODE_SIMPLE'), $.env.get('CLAUDE_CODE_DISABLE_ATTACHMENTS')])
  return [simple, noAttachments].some(value => value !== undefined && SWITCHED_ON.has(value.trim().toLowerCase()))
}

/** The sources the resolver gave, resolving on first need if `session.start` hasn't run. */
function sourcesOf($: EngineInterface, loader: Loader): Promise<readonly RuleSource[]> {
  if (loader.resolved === undefined) {
    // A resolver that failed is asked again next time rather than cached
    const resolved = contextOf($)
      .then(context => loader.resolve(context))
      .then(given => ([given].flat() as RuleInput[]).map(input => toSource(input, $.plugin.root)))
      .catch(error => {
        if (loader.resolved === resolved) {
          loader.resolved = undefined
        }
        throw error
      })

    loader.resolved = resolved
  }

  return loader.resolved
}

/** What the resolver decides with: a slice of `$`, each method spelled out. */
async function contextOf($: EngineInterface): Promise<RulesContext> {
  return {
    fs: {
      // Two calls, so each of the overloads stays the one `$.fs.read` resolves
      read: ((path: string, options?: FsReadOptions) =>
        options === undefined ? $.fs.read(path) : $.fs.read(path, options)) as RulesContext['fs']['read'],
      list: path => $.fs.list(path),
      exists: path => $.fs.exists(path),
      stat: (path, options) => $.fs.stat(path, options),
    },
    session: { root: await $.session.root(), cwd: await $.session.cwd() },
    plugin: { name: $.plugin.name, root: $.plugin.root },
  }
}

/**
 * Every rule that applies: the resolver's sources and those added this
 * conversation, less those removed.
 *
 * Read fresh so edits on disk apply in the running session.
 */
async function rulesOf($: EngineInterface, loader: Loader): Promise<Rule[]> {
  const [resolved, { added, removed }] = await Promise.all([sourcesOf($, loader), changes($)])
  const gone = new Set(removed)

  return loadSources($, uniqueSources([...resolved, ...added]).filter(source => !gone.has(sourceKey(source))), loader.cache)
}

async function alwaysOf($: EngineInterface, loader: Loader): Promise<Rule[]> {
  return (await rulesOf($, loader)).filter(rule => rule.paths === undefined)
}

/**
 * The path rules a read of `path` (a Read, or a mention with `@`) attaches:
 * those its file matches that the loop has not had yet, recorded as sent.
 * A rule file read for itself attaches nothing; read whole, it counts as sent.
 */
async function rulesForRead(
  $: EngineInterface,
  loader: Loader,
  all: Rule[],
  read: { path: string; agentId?: string; offset?: unknown; limit?: unknown },
): Promise<Rule[]> {
  const absolute = await absoluteOf($, read.path)
  const own = all.filter(rule => rule.path === absolute)

  if (own.length > 0 && read.offset === undefined && read.limit === undefined) {
    await claimRules($, loader.ledger, scopedKey(read.agentId), own.filter(rule => rule.paths !== undefined))
    await claimRules($, loader.ledger, toldKey(read.agentId), own.filter(rule => rule.paths === undefined))
  }

  const relative = await relativeToRoot($, absolute)
  if (relative === undefined) {
    return []
  }

  const matching = all.filter(rule => rule.path !== absolute && isMatch(rule, relative))
  return claimRules($, loader.ledger, scopedKey(read.agentId), matching)
}

/**
 * The rules without `paths` in `always` a loop has had neither in the
 * instructions nor in its messages, recorded as told.
 *
 * A subagent starts with the instructions the main conversation's last carried.
 */
async function tell($: EngineInterface, loader: Loader, always: Rule[], agentId?: string): Promise<Rule[]> {
  const record = await sent($)
  const carried = new Set(record[alwaysKey(agentId)] ?? record[alwaysKey()] ?? [])
  return claimRules($, loader.ledger, toldKey(agentId), always.filter(rule => !carried.has(rule.path)))
}

async function registerCommand($: EngineInterface, loader: Loader): Promise<void> {
  if (loader.options.command === false) {
    return
  }

  loader.command = loader.options.command ?? `${$.plugin.name}-rules`
  await $.command.register({ name: loader.command, description: `List ${$.plugin.name}'s rules and which have loaded` })
}

/** The command's output: each rule, `●` once it has reached the main conversation. */
async function listing($: EngineInterface, loader: Loader): Promise<string> {
  const all = await listRules($, loader)
  if (all.length === 0) {
    return 'No rules apply to this project.'
  }

  return all.map(rule => `${rule.sent ? '●' : '○'} ${rule.path} [${rule.paths?.join(', ') ?? 'always'}]`).join('\n')
}

async function claimRules($: EngineInterface, ledger: Ledger, key: string, candidates: Rule[]): Promise<Rule[]> {
  const fresh = new Set(await claim($, ledger, key, candidates.map(rule => rule.path)))
  return candidates.filter(rule => fresh.has(rule.path))
}

/** `path` made absolute against the working directory. */
async function absoluteOf($: EngineInterface, path: string): Promise<string> {
  return path.startsWith('/') ? path : `${await $.session.cwd()}/${path}`
}

/** The absolute `path` relative to the project root, or undefined when it is outside it. */
async function relativeToRoot($: EngineInterface, absolute: string): Promise<string | undefined> {
  const root = await $.session.root()
  return absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : undefined
}
