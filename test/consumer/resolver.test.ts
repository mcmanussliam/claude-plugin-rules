import { describe, expect, test } from 'claude-code/testing'

import { OVERVIEW_FILE, PLUGIN, RULES_DIR, START, TS, carried, context, framed, read, treeOf, userFile, world } from '../util/helpers'

const resolutions = (reads: string[]) => reads.filter(path => path === '/sources.json').length

/** The rules the instructions carry when the engine asks for them now. */
const loaded = async ($: { prompt: { context: (e: never) => Promise<{ instructionFiles?: readonly { path: string; kind: string; content: string }[] }> } }) =>
  carried(await $.prompt.context(context() as never))

describe('the resolver', () => {
  test('is asked once, however many hooks need its sources', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.prompt.context(context())
    await $.prompt.context(context())
    await $.tool.call(read('/repo/src/app.ts'))
    await $.tool.call(read('/repo/README.md', 'a1'))

    expect(resolutions(fake.reads)).toBe(1)
  })

  test('is asked when the session starts', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.session.start(START)

    expect(resolutions(fake.reads)).toBe(1)
  })

  test('is asked again when the module reloads, and its new answer applies', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    const fake = world(on, tree)
    await $.session.start(START)

    tree.files['/sources.json'] = JSON.stringify([{ name: 'only', content: 'Only' }])
    await $.session.start(START)
    const files = await loaded($)

    expect(resolutions(fake.reads)).toBe(2)
    expect(files).toEqual([userFile('rules:only', 'Only')])
  })

  test('answering no sources means no rules anywhere', async ($, on) => {
    world(on, treeOf([]))

    const files = await loaded($)
    const tool = await $.tool.call(read('/repo/src/app.ts'))

    expect(files).toEqual([])
    expect(tool.context).toBeUndefined()
  })

  test('that fails is asked again next time instead of failing for good', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    tree.files['/sources.json'] = '{ not json'
    world(on, tree)

    const failed = await loaded($)
    tree.files['/sources.json'] = JSON.stringify(RULES_DIR)
    const recovered = await loaded($)

    expect(failed).toEqual([])
    expect(recovered).toEqual([OVERVIEW_FILE])
  })

  test('that fails leaves tool results as they were', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    tree.files['/sources.json'] = '{ not json'
    world(on, tree)

    const tool = await $.tool.call(read('/repo/src/app.ts'))

    expect(tool.context).toBeUndefined()
  })
})

describe('the resolver\'s context', () => {
  /** Resolves a probe and answers what the resolver was given. */
  async function probe($: Parameters<typeof loaded>[0]) {
    return JSON.parse((await loaded($))[0]?.content ?? '{}') as Record<string, unknown>
  }

  const PROBE = { probe: { exists: '/repo/src/app.ts', list: '/repo/src', stat: '/repo/src', read: '/repo/README.md' } }

  test('holds the session\'s project root and working directory', async ($, on) => {
    world(on, treeOf(PROBE), { cwd: '/repo/src' })

    expect((await probe($)).session).toEqual({ root: '/repo', cwd: '/repo/src' })
  })

  test('holds the plugin\'s name and directory', async ($, on) => {
    world(on, treeOf(PROBE))

    const plugin = (await probe($)).plugin as { name: string; root: string }

    expect(plugin.name).toBe(PLUGIN)
    expect(plugin.root.endsWith('/test')).toBe(true)
  })

  test('gives fs reads that answer as $.fs does', async ($, on) => {
    world(on, treeOf(PROBE))

    const seen = await probe($)

    expect(seen.exists).toBe(true)
    expect(seen.list).toEqual(['app.ts'])
    expect(seen.stat).toBe('dir')
    expect(seen.read).toBe('# Repo\n')
  })

  test('fs.exists answers false for a missing path', async ($, on) => {
    world(on, treeOf({ probe: { ...PROBE.probe, exists: '/repo/nope' } }))

    expect((await probe($)).exists).toBe(false)
  })
})

describe('rule files', () => {
  test('are read afresh, so edits apply in the running session', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    world(on, tree)

    await loaded($)
    tree.files['/plugin/rules/overview.md'] = '# Overview, edited\n'
    tree.files['/plugin/rules/backend/ts.md'] = '---\npaths: src/**\n---\n# TS, edited\n'
    const again = await loaded($)
    const tool = await $.tool.call(read('/repo/src/app.ts'))

    expect(again).toEqual([userFile('/plugin/rules/overview.md', '# Overview, edited\n')])
    expect(tool.context).toEqual([framed('/plugin/rules/backend/ts.md', '# TS, edited\n')])
  })

  test('added to a directory later are picked up without asking the resolver again', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    const fake = world(on, tree)

    await loaded($)
    tree.files['/plugin/rules/added.md'] = '# Added\n'
    const again = await loaded($)

    expect(again.map(file => file.path)).toContain('/plugin/rules/added.md')
    expect(resolutions(fake.reads)).toBe(1)
  })

  test('with frontmatter load end to end: string globs, lists, none', async ($, on) => {
    world(
      on,
      treeOf(RULES_DIR, {
        '/plugin/rules/one.md': '---\npaths: docs/**\n---\nDocs',
        '/plugin/rules/meta.md': '---\ndescription: Not scoped\n---\nMeta',
      }),
    )

    const files = await loaded($)
    const docs = await $.tool.call(read('/repo/docs/guide.md'))

    expect(files).toContainEqual(userFile('/plugin/rules/meta.md', 'Meta'))
    expect(files.map(file => file.path)).not.toContain('/plugin/rules/one.md')
    expect(docs.context).toEqual([framed('/plugin/rules/one.md', 'Docs')])
  })

  test('that are not .md are left out of a directory', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    expect((await loaded($)).map(file => file.path)).not.toContain('/plugin/rules/notes.txt')
  })

  test('under a symlinked directory load through the link', async ($, on) => {
    const tree = treeOf(RULES_DIR, { '/shared/linked.md': '# Linked\n' })
    tree.links = { '/plugin/rules/shared': '/shared' }
    world(on, tree)

    expect(await loaded($)).toContainEqual(userFile('/plugin/rules/shared/linked.md', '# Linked\n'))
  })

  test('from a directory, a file and code load together, a repeated path once', async ($, on) => {
    world(
      on,
      treeOf([...RULES_DIR, { file: '/plugin/extra.md' }, { file: '/plugin/rules/overview.md' }, { name: 'code', content: 'Code' }], {
        '/plugin/extra.md': '# Extra\n',
      }),
    )

    expect((await loaded($)).map(file => file.path)).toEqual(['/plugin/rules/overview.md', '/plugin/extra.md', 'rules:code'])
  })

  test('that are missing are skipped, and the rest load', async ($, on) => {
    world(on, treeOf([{ dir: '/nowhere' }, { file: '/missing.md' }, ...RULES_DIR]))

    const files = await loaded($)
    const tool = await $.tool.call(read('/repo/src/app.ts'))

    expect(files).toEqual([OVERVIEW_FILE])
    expect(tool.context).toEqual([TS])
  })
})

describe('rule files read', () => {
  const reads = (all: string[], path: string) => all.filter(read1 => read1 === path).length

  test('once, however many hooks need them, until they change', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    const fake = world(on, tree)

    await loaded($)
    await $.tool.call(read('/repo/src/app.ts'))
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await loaded($)
    const before = reads(fake.reads, '/plugin/rules/overview.md')

    tree.files['/plugin/rules/overview.md'] = '# Overview, edited\n'
    const after = await loaded($)

    expect(before).toBe(1)
    expect(reads(fake.reads, '/plugin/rules/overview.md')).toBe(2)
    expect(after).toEqual([{ path: '/plugin/rules/overview.md', kind: 'user', content: '# Overview, edited\n' }])
  })
})
