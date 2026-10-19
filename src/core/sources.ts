import type { EngineInterface } from 'claude-code'

import type { Rule, RuleInput, RuleSource } from '../types'
import { parseRule, pathsOf } from './rule'

/**
 * The source an input stands for, its path made absolute against `root` (your
 * plugin's): a bare path is a file when it ends in `.md`, a directory otherwise.
 */
export function toSource(input: RuleInput, root: string): RuleSource {
  if (typeof input === 'string') {
    return input.endsWith('.md') ? { file: absolute(input, root) } : { dir: absolute(input, root) }
  }

  if ('content' in input) {
    return { name: input.name, content: input.content, ...pathsOf(input.paths) }
  }

  return 'dir' in input ? { dir: absolute(input.dir, root) } : { file: absolute(input.file, root) }
}

/** What tells sources apart: two with the same key load the same rules. */
export function sourceKey(source: RuleSource): string {
  return 'content' in source ? `rules:${source.name}` : 'dir' in source ? `dir:${source.dir}` : `file:${source.file}`
}

/** `sources` in order, a key that appeared before dropped. */
export function uniqueSources(sources: readonly RuleSource[]): RuleSource[] {
  const seen = new Set<string>()

  return sources.filter(source => !seen.has(sourceKey(source)) && seen.add(sourceKey(source)))
}

function absolute(path: string, root: string): string {
  if (path.startsWith('/')) {
    return path.replace(/\/+$/, '') || '/'
  }

  const relative = path.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
  return relative === '' || relative === '.' ? root : `${root}/${relative}`
}

/**
 * Rules already read, by path, with the stamp (modification time and size)
 * of the file they were read from: a file whose stamp is unchanged is not
 * read again.
 */
export type RuleCache = Map<string, { stamp: string; rule: Rule }>

/** A file to read, and its stamp as a listing or stat gave it. */
type Found = { path: string; stamp: string }

const stampOf = (entry: { mtimeMs: number; size: number }): string => `${entry.mtimeMs}:${entry.size}`

/** Reads every source's rules, in order, dropping a path a source before it already gave. */
export async function loadSources($: EngineInterface, sources: readonly RuleSource[], cache?: RuleCache): Promise<Rule[]> {
  const loaded = (await Promise.all(sources.map(source => loadSource($, source, cache)))).flat()
  const seen = new Set<string>()

  return loaded.filter(rule => !seen.has(rule.path) && seen.add(rule.path))
}

/**
 * Reads a source's rules from disk (or from itself, for a rule written in
 * code), each file only when it changed since `cache` last held it.
 */
export async function loadSource($: EngineInterface, source: RuleSource, cache?: RuleCache): Promise<Rule[]> {
  if ('content' in source) {
    return [{ path: `rules:${source.name}`, content: source.content, ...pathsOf(source.paths) }]
  }

  const files = 'dir' in source ? await walk($, source.dir) : await statFile($, source.file)
  const rules: Rule[] = []

  for (const found of files) {
    const rule = await readRule($, found, cache)

    if (rule !== undefined) {
      rules.push(rule)
    }
  }

  return rules
}

/** The rule in `found`, from `cache` when its stamp is unchanged. */
async function readRule($: EngineInterface, { path, stamp }: Found, cache?: RuleCache): Promise<Rule | undefined> {
  const cached = cache?.get(path)
  if (cached?.stamp === stamp) {
    return cached.rule
  }

  const text = await $.fs.read(path).catch(() => undefined)
  if (text === undefined) {
    cache?.delete(path)
    return undefined
  }

  const rule = { path, ...parseRule(text) }
  cache?.set(path, { stamp, rule })
  return rule
}

/** The one file a file source names, with its stamp, or nothing when it is missing. */
async function statFile($: EngineInterface, path: string): Promise<Found[]> {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  return stat?.kind === 'file' ? [{ path, stamp: stampOf(stat) }] : []
}

/**
 * Lists the `.md` files under `dir`, recursively and in name order, with
 * their stamps, following symlinked directories once each so a link loop ends.
 */
async function walk($: EngineInterface, dir: string, visited = new Set<string>()): Promise<Found[]> {
  const real = (await $.fs.stat(dir, { resolve: true }).catch(() => undefined))?.realPath ?? dir

  if (visited.has(real)) {
    return []
  }

  visited.add(real)
  const entries = await $.fs.list(dir).catch(() => [])
  const files: Found[] = []

  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${dir}/${entry.name}`
    const target = entry.isLink ? await $.fs.stat(path, { resolve: true }).catch(() => undefined) : entry

    if (target?.kind === 'dir') {
      files.push(...(await walk($, path, visited)))
    } else if (target?.kind === 'file' && entry.name.endsWith('.md')) {
      files.push({ path, stamp: stampOf(target) })
    }
  }

  return files
}
