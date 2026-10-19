import { minimatch } from 'minimatch'
import { parse } from 'yaml'

import type { Rule } from '../types'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Splits a rule file into its `paths` globs (a string or a list of strings)
 * and its body.
 *
 * Frontmatter that is not valid YAML is treated as absent.
 */
export function parseRule(text: string): { paths?: string[]; content: string } {
  const match = FRONTMATTER.exec(text)
  if (!match) {
    return { content: text }
  }

  const content = text.slice(match[0].length)
  let data: unknown
  try {
    data = parse(match[1] ?? '')
  } catch {
    return { content }
  }

  return { ...pathsOf((data as { paths?: unknown } | null)?.paths), content }
}

/** Normalises a `paths` value to a non-empty list of globs, or nothing. */
export function pathsOf(raw: unknown): { paths?: string[] } {
  const paths = [raw].flat().filter((p): p is string => typeof p === 'string' && p !== '')

  return paths.length > 0 ? { paths } : {}
}

/** Whether `relative` matches one of the rule's globs. */
export function isMatch(rule: Rule, relative: string): boolean {
  return rule.paths?.some(glob => minimatch(relative, glob, { dot: true })) ?? false
}

/** How the engine frames a `user` instruction file; rules without `paths` are loaded as those. */
export const USER_KIND = " (user's private global instructions for all projects)"

/**
 * A rule without `paths` as the model reads it outside the instructions,
 * framed as the engine frames the `user` instruction file it would have been.
 */
export function instructionFrameOf(rule: Rule): string {
  return `Contents of ${rule.path}${USER_KIND}:\n\n${rule.content}`
}

/**
 * A rule with `paths` as the model reads it, framed as the engine frames a
 * rules file it loads for a file Claude reads: `Contents of <path>:`.
 */
export function nestedFrameOf(rule: Rule): string {
  return `Contents of ${rule.path}:\n\n${rule.content}`
}
