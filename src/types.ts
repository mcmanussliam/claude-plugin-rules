import type { EngineInterface } from 'claude-code'

/**
 * A directory of rules: every `.md` file under it, recursively, symlinked
 * directories followed. Frontmatter `paths` scopes a file as Claude Code's own
 * rules do.
 */
export type RuleDir = {
  /** The directory: absolute, or relative to your plugin's root. */
  dir: string
}

/** One rule file, its frontmatter read as a directory's files are. */
export type RuleFile = {
  /** The file: absolute, or relative to your plugin's root. */
  file: string
}

/** A rule written in code, with no file behind it. */
export type RuleInline = {
  /** Names the rule; it shows as `rules:<name>`. Unique among your rules. */
  name: string
  /** The rule's text, as the model reads it. */
  content: string
  /**
   * Globs relative to the project root, as a rule file's `paths` frontmatter.
   * Absent: the rule joins the instructions every conversation and subagent starts with.
   */
  paths?: string[]
}

/** Where rules come from: a directory, a file, or a rule written in code. */
export type RuleSource = RuleDir | RuleFile | RuleInline

/**
 * A source, or a path standing for one: absolute or relative to your plugin's
 * root, a file when it ends in `.md` and a directory otherwise.
 *
 * @example 'rules' // { dir: `${plugin.root}/rules` }
 * @example 'rules/react.md' // { file: `${plugin.root}/rules/react.md` }
 */
export type RuleInput = string | RuleSource

/** Names a source for `removeRules`: as it was given, or a rule written in code by its `name` alone. */
export type RuleRef = RuleInput | Pick<RuleInline, 'name'>

/**
 * What a resolver gets to decide with: a slice of `$`, same names, same
 * behaviour. Not `$` itself: Claude Code only loads a hooks module that hands
 * `$` to functions declared at the top of the file, never to a callback.
 */
export type RulesContext = {
  /** Mirror of `$.fs`. */
  fs: Pick<EngineInterface['fs'], 'read' | 'list' | 'exists' | 'stat'>
  /** The project root, which rules' `paths` globs are relative to, and the working directory. */
  session: { root: string; cwd: string }
  /** Your plugin: its manifest name and its directory, as `$.plugin` has them. */
  plugin: { name: string; root: string }
}

/**
 * Decides which rules apply: look at the project, its `package.json` or any
 * other file, and return the sources to load. Return `[]` for none.
 *
 * Runs when the session starts, whenever your module reloads, and after
 * `reloadRules`.
 */
export type ResolveRules = (context: RulesContext) => RuleInput | readonly RuleInput[] | Promise<RuleInput | readonly RuleInput[]>

/** The rules a plugin starts with: sources, or a resolver deciding them. */
export type RulesSources = RuleInput | readonly RuleInput[] | ResolveRules

export type RulesOptions = {
  /**
   * The slash command listing your rules and which have loaded, without the
   * slash. Default `<your plugin's name>-rules`; `false` registers none.
   */
  command?: string | false
}

/** One loaded rule, whatever source it came from. */
export type Rule = {
  /**
   * The file it was read from, or `rules:<name>` for a rule written in code.
   * Unique among your rules.
   */
  path: string
  /** Globs relative to the project root; absent means always loaded. */
  paths?: string[]
  /** The rule text, frontmatter removed. */
  content: string
}

/** A rule as `listRules` reports it. */
export type RuleStatus = Rule & {
  /** Whether it has reached the main conversation. */
  sent: boolean
}

/**
 * Your plugin's rules, as `defineRules` makes them. Hand it to `rules`, `addRules`,
 * `removeRules`, `listRules` and `reloadRules`; its contents are the package's own.
 */
export interface RuleSet {
  readonly kind: 'claude-plugin-rules'
}
