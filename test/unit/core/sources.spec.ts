import { describe, expect, it } from 'vitest'

import { loadSource, loadSources, sourceKey, toSource, uniqueSources, type RuleCache } from '../../../src/core/sources'
import { fakeEngine } from '../../util/fake-engine'

const paths = (rules: { path: string }[]) => rules.map(rule => rule.path)

describe('loadSource: a directory', () => {
  it('loads every .md file under it, recursively, in name order, depth first', async () => {
    const { $ } = fakeEngine({
      files: {
        '/r/z/last.md': 'z',
        '/r/b.md': 'b',
        '/r/a/inner/deep.md': 'deep',
        '/r/a/first.md': 'a',
      },
    })

    expect(paths(await loadSource($, { dir: '/r' }))).toEqual([
      '/r/a/first.md',
      '/r/a/inner/deep.md',
      '/r/b.md',
      '/r/z/last.md',
    ])
  })

  it('skips files that are not .md', async () => {
    const { $ } = fakeEngine({ files: { '/r/a.md': 'a', '/r/notes.txt': 'x', '/r/data.json': '{}', '/r/b.MD': 'b' } })

    expect(paths(await loadSource($, { dir: '/r' }))).toEqual(['/r/a.md'])
  })

  it('parses each file: globs from frontmatter, the body as content', async () => {
    const { $ } = fakeEngine({ files: { '/r/ts.md': '---\npaths: src/**\n---\nTS', '/r/all.md': 'All' } })

    expect(await loadSource($, { dir: '/r' })).toEqual([
      { path: '/r/all.md', content: 'All' },
      { path: '/r/ts.md', paths: ['src/**'], content: 'TS' },
    ])
  })

  it('follows a symlinked directory, keeping the path through the link', async () => {
    const { $ } = fakeEngine({
      files: { '/r/own.md': 'own', '/shared/linked.md': 'linked' },
      links: { '/r/shared': '/shared' },
    })

    expect(paths(await loadSource($, { dir: '/r' }))).toEqual(['/r/own.md', '/r/shared/linked.md'])
  })

  it('ends a symlink loop instead of walking it forever', async () => {
    const { $ } = fakeEngine({ files: { '/r/a.md': 'a' }, links: { '/r/loop': '/r' } })

    expect(paths(await loadSource($, { dir: '/r' }))).toEqual(['/r/a.md'])
  })

  it('walks a directory reached twice through links once', async () => {
    const { $ } = fakeEngine({
      files: { '/shared/x.md': 'x' },
      links: { '/r/one': '/shared', '/r/two': '/shared' },
    })

    expect(paths(await loadSource($, { dir: '/r' }))).toEqual(['/r/one/x.md'])
  })

  it('answers no rules for a directory that does not exist', async () => {
    const { $ } = fakeEngine()

    expect(await loadSource($, { dir: '/nowhere' })).toEqual([])
  })

  it('skips a file it cannot read and loads the rest', async () => {
    const { $ } = fakeEngine({ files: { '/r/a.md': 'a' }, unreadable: ['/r/locked.md'] })

    expect(paths(await loadSource($, { dir: '/r' }))).toEqual(['/r/a.md'])
  })

  it('reads the files afresh each time, so edits apply', async () => {
    const tree = { files: { '/r/a.md': 'before' } }
    const { $ } = fakeEngine(tree)

    await loadSource($, { dir: '/r' })
    tree.files['/r/a.md'] = 'after'

    expect((await loadSource($, { dir: '/r' }))[0]?.content).toBe('after')
  })
})

describe('loadSource: a file', () => {
  it('loads the one file, frontmatter parsed', async () => {
    const { $ } = fakeEngine({ files: { '/r/a.md': '---\npaths: [src/**]\n---\nA' } })

    expect(await loadSource($, { file: '/r/a.md' })).toEqual([{ path: '/r/a.md', paths: ['src/**'], content: 'A' }])
  })

  it('loads a file whatever its extension: it was named on purpose', async () => {
    const { $ } = fakeEngine({ files: { '/r/rule.txt': 'Plain' } })

    expect(await loadSource($, { file: '/r/rule.txt' })).toEqual([{ path: '/r/rule.txt', content: 'Plain' }])
  })

  it('answers no rules for a file that does not exist', async () => {
    const { $ } = fakeEngine()

    expect(await loadSource($, { file: '/missing.md' })).toEqual([])
  })
})

describe('loadSource: a rule written in code', () => {
  it('answers it under rules:<name>, without touching the filesystem', async () => {
    const { $, reads } = fakeEngine()

    expect(await loadSource($, { name: 'mine', content: 'Inline' })).toEqual([{ path: 'rules:mine', content: 'Inline' }])
    expect(reads).toEqual([])
  })

  it('keeps its globs, normalised as frontmatter globs are', async () => {
    const { $ } = fakeEngine()

    expect(await loadSource($, { name: 'mine', content: 'X', paths: ['src/**', ''] })).toEqual([
      { path: 'rules:mine', content: 'X', paths: ['src/**'] },
    ])
  })

  it('treats an empty globs list as always loaded', async () => {
    const { $ } = fakeEngine()

    expect(await loadSource($, { name: 'mine', content: 'X', paths: [] })).toEqual([{ path: 'rules:mine', content: 'X' }])
  })
})

describe('loadSources', () => {
  it('loads every source, in order', async () => {
    const { $ } = fakeEngine({ files: { '/r/a.md': 'a', '/extra.md': 'e' } })

    expect(
      paths(await loadSources($, [{ dir: '/r' }, { file: '/extra.md' }, { name: 'code', content: 'c' }])),
    ).toEqual(['/r/a.md', '/extra.md', 'rules:code'])
  })

  it('loads a path two sources both give once, where it first appears', async () => {
    const { $ } = fakeEngine({ files: { '/r/a.md': 'a', '/r/b.md': 'b' } })

    expect(paths(await loadSources($, [{ file: '/r/b.md' }, { dir: '/r' }, { file: '/r/a.md' }]))).toEqual([
      '/r/b.md',
      '/r/a.md',
    ])
  })

  it('answers no rules for no sources', async () => {
    const { $ } = fakeEngine()

    expect(await loadSources($, [])).toEqual([])
  })
})

describe('toSource', () => {
  it('takes a bare path as a directory, or a file when it ends in .md', () => {
    expect(toSource('rules', '/p')).toEqual({ dir: '/p/rules' })
    expect(toSource('rules/a.md', '/p')).toEqual({ file: '/p/rules/a.md' })
  })

  it('keeps an absolute path, trailing slashes dropped', () => {
    expect(toSource('/abs/rules/', '/p')).toEqual({ dir: '/abs/rules' })
    expect(toSource({ file: '/abs/a.md' }, '/p')).toEqual({ file: '/abs/a.md' })
  })

  it('resolves a relative dir or file against the root', () => {
    expect(toSource({ dir: './rules/' }, '/p')).toEqual({ dir: '/p/rules' })
    expect(toSource({ file: 'x/a.md' }, '/p')).toEqual({ file: '/p/x/a.md' })
    expect(toSource('.', '/p')).toEqual({ dir: '/p' })
  })

  it('normalises a rule written in code, dropping empty globs', () => {
    expect(toSource({ name: 'n', content: 'c', paths: [] }, '/p')).toEqual({ name: 'n', content: 'c' })
    expect(toSource({ name: 'n', content: 'c', paths: ['a/**', ''] }, '/p')).toEqual({ name: 'n', content: 'c', paths: ['a/**'] })
  })
})

describe('sourceKey', () => {
  it('tells each kind of source apart', () => {
    expect(sourceKey({ dir: '/r' })).toBe('dir:/r')
    expect(sourceKey({ file: '/r' })).toBe('file:/r')
    expect(sourceKey({ name: 'r', content: 'x' })).toBe('rules:r')
  })
})

describe('uniqueSources', () => {
  it('keeps the first of sources with the same key', () => {
    expect(uniqueSources([{ name: 'a', content: '1' }, { dir: '/r' }, { name: 'a', content: '2' }])).toEqual([
      { name: 'a', content: '1' },
      { dir: '/r' },
    ])
  })
})

describe('loadSources: with a cache', () => {
  it('reads a file again only once it changes', async () => {
    const tree = { files: { '/r/a.md': 'before', '/extra.md': 'extra' } }
    const { $, reads } = fakeEngine(tree)
    const cache: RuleCache = new Map()
    const sources = [{ dir: '/r' }, { file: '/extra.md' }]

    await loadSources($, sources, cache)
    await loadSources($, sources, cache)
    tree.files['/r/a.md'] = 'after'
    const changed = await loadSources($, sources, cache)

    expect([...reads].sort()).toEqual(['/extra.md', '/r/a.md', '/r/a.md'])
    expect(changed[0]?.content).toBe('after')
  })

  it('forgets a file it can no longer read', async () => {
    const tree: { files: Record<string, string>; unreadable?: string[] } = { files: { '/r/a.md': 'a' } }
    const { $ } = fakeEngine(tree)
    const cache: RuleCache = new Map()

    await loadSources($, [{ dir: '/r' }], cache)
    delete tree.files['/r/a.md']
    tree.unreadable = ['/r/a.md']

    expect(await loadSources($, [{ dir: '/r' }], cache)).toEqual([])
    expect(cache.has('/r/a.md')).toBe(false)
  })
})
