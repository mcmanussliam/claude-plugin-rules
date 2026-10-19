import { describe, expect, test } from 'claude-code/testing'

import {
  OVERVIEW,
  OVERVIEW_FILE,
  PROJECT_FILE,
  RULES_DIR,
  START,
  TS,
  carried,
  context,
  framed,
  read,
  told,
  treeOf,
  typed,
  userFile,
  world,
} from '../util/helpers'

/** Runs one of the fixture's commands, which drive the rule set from a hook. */
const run = (command: string, args: unknown = '') =>
  ({ command, args: typeof args === 'string' ? args : JSON.stringify(args) }) as never

const end = (reason: string) => ({ reason, sessionId: 's1', resume: { id: 's1' } }) as never

const bash = (agentId?: string) => ({ tool: 'Bash', command: 'ls', ...(agentId === undefined ? {} : { agentId }) }) as never

/** A machine `prompt.context` is known to reach the plugin on. */
const REACHED = { stored: { 'prompt.context': 'seen' } }

const DEPLOY = { name: 'deploy', content: 'Deploy rule' }
const SCOPED = { name: 'docs', content: 'Docs rule', paths: ['docs/**'] }

describe('addRules', () => {
  test('answers the rules the added sources load', async ($, on) => {
    world(on, treeOf([], { '/extra/a.md': '---\npaths: src/**\n---\nA' }))

    const added = await $.command.run(run('add', [DEPLOY, { dir: '/extra' }]))

    expect(JSON.parse(added.text ?? '')).toEqual([
      { path: 'rules:deploy', content: 'Deploy rule' },
      { path: '/extra/a.md', paths: ['src/**'], content: 'A' },
    ])
  })

  test('asks the engine for the instructions again', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.command.run(run('add', [DEPLOY]))

    expect(fake.invalidated).toContain('prompt.context')
  })

  test('puts a rule without paths in the instructions asked for next', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)
    await $.prompt.context(context())

    await $.command.run(run('add', [DEPLOY]))
    const again = await $.prompt.context(context())

    expect(carried(again)).toEqual([OVERVIEW_FILE, userFile('rules:deploy', 'Deploy rule')])
  })

  test('sends a rule without paths with the next prompt when it comes first, and the instructions leave it out', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)
    await $.prompt.context(context())

    await $.command.run(run('add', [DEPLOY]))
    const first = await $.prompt.submit(typed('hi'))
    const second = await $.prompt.submit(typed('again'))
    const again = await $.prompt.context(context())

    expect(first.context).toEqual([told('rules:deploy', 'Deploy rule')])
    expect(second.context).toBeUndefined()
    expect(carried(again)).toEqual([OVERVIEW_FILE])
  })

  test('sends a rule without paths added mid-turn with the next result of any tool', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)
    await $.prompt.context(context())

    await $.command.run(run('add', [DEPLOY]))
    const tool = await $.tool.call(bash())
    const prompt = await $.prompt.submit(typed('next turn'))

    expect(tool.context).toEqual([told('rules:deploy', 'Deploy rule')])
    expect(prompt.context).toBeUndefined()
  })

  test('reaches a subagent with its first tool when the instructions it started with lacked it', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)
    await $.prompt.context(context())

    await $.command.run(run('add', [DEPLOY]))
    const sub = await $.tool.call(bash('a1'))

    expect(sub.context).toEqual([told('rules:deploy', 'Deploy rule')])
  })

  test('attaches a path rule at its next matching file', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)
    await $.prompt.context(context())

    await $.command.run(run('add', [SCOPED]))
    const other = await $.tool.call(read('/repo/README.md'))
    const docs = await $.tool.call(read('/repo/docs/guide.md'))

    expect(other.context).toBeUndefined()
    expect(docs.context).toEqual([framed('rules:docs', 'Docs rule')])
  })

  test('takes a path as a directory, or as a file when it ends in .md', async ($, on) => {
    world(on, treeOf([], { '/extra/dir/a.md': 'A', '/extra/b.md': 'B' }))

    const added = await $.command.run(run('add', ['/extra/dir', '/extra/b.md']))

    expect(JSON.parse(added.text ?? '').map((rule: { path: string }) => rule.path)).toEqual(['/extra/dir/a.md', '/extra/b.md'])
  })

  test('replaces a source added before under the same name', async ($, on) => {
    world(on, treeOf([]))

    await $.command.run(run('add', [DEPLOY]))
    await $.command.run(run('add', [{ ...DEPLOY, content: 'Changed' }]))
    const listed = JSON.parse((await $.command.run(run('list'))).text ?? '')

    expect(listed).toEqual([{ path: 'rules:deploy', content: 'Changed', sent: false }])
  })

  test('survives a module reload', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.session.start(START)

    await $.command.run(run('add', [DEPLOY]))
    await $.session.start(START)
    const files = carried(await $.prompt.context(context()))

    expect(files).toContainEqual(userFile('rules:deploy', 'Deploy rule'))
  })

  test('lasts until /clear', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.command.run(run('add', [DEPLOY]))
    expect(fake.store.has('changes:s1')).toBe(true)
    await $.session.end(end('clear'))
    const files = carried(await $.prompt.context(context()))

    expect(fake.store.has('changes:s1')).toBe(false)
    expect(files).toEqual([OVERVIEW_FILE])
  })
})

describe('removeRules', () => {
  test('stops a source the resolver gave from loading', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.prompt.context(context())

    await $.command.run(run('remove', RULES_DIR))
    const again = await $.prompt.context(context())
    const tool = await $.tool.call(read('/repo/src/app.ts'))

    expect(again.instructionFiles).toEqual([PROJECT_FILE])
    expect(tool.context).toBeUndefined()
  })

  test('asks the engine for the instructions again', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.command.run(run('remove', RULES_DIR))

    expect(fake.invalidated).toContain('prompt.context')
  })

  test('takes a rule written in code by its name alone', async ($, on) => {
    world(on, treeOf([DEPLOY]))

    await $.command.run(run('remove', [{ name: 'deploy' }]))

    expect(carried(await $.prompt.context(context()))).toEqual([])
  })

  test('drops a source addRules added', async ($, on) => {
    world(on, treeOf([]))

    await $.command.run(run('add', [DEPLOY]))
    await $.command.run(run('remove', [{ name: 'deploy' }]))

    expect(JSON.parse((await $.command.run(run('list'))).text ?? '')).toEqual([])
  })

  test('is undone by adding the source again', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    await $.command.run(run('remove', ['/plugin/rules']))
    await $.command.run(run('add', ['/plugin/rules']))

    expect(carried(await $.prompt.context(context()))).toEqual([OVERVIEW_FILE])
  })
})

describe('reloadRules', () => {
  test('asks the resolver again, and its new answer applies', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    const fake = world(on, tree, REACHED)
    await $.prompt.context(context())

    tree.files['/sources.json'] = JSON.stringify([DEPLOY])
    await $.command.run(run('reload'))
    const prompt = await $.prompt.submit(typed('hi'))

    expect(fake.reads.filter(path => path === '/sources.json')).toHaveLength(2)
    expect(fake.invalidated).toContain('prompt.context')
    expect(prompt.context).toEqual([told('rules:deploy', 'Deploy rule')])
  })
})

describe('listRules', () => {
  test('answers every rule, marked once it has reached the main conversation', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    await $.prompt.context(context())
    const listed = JSON.parse((await $.command.run(run('list'))).text ?? '')

    expect(listed).toEqual([
      { path: '/plugin/rules/backend/ts.md', paths: ['src/**/*.ts'], content: '# TS rules\n', sent: false },
      { path: '/plugin/rules/overview.md', content: '# Overview\n', sent: true },
    ])
  })

  test('counts a rule a prompt carried as reached', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    await $.prompt.submit(typed('hi'))
    const listed = JSON.parse((await $.command.run(run('list'))).text ?? '')

    expect(listed.find((rule: { path: string }) => rule.path === '/plugin/rules/overview.md').sent).toBe(true)
  })
})

describe('a resolver answering paths', () => {
  test('loads a lone path as its directory', async ($, on) => {
    world(on, treeOf('/plugin/rules'))

    const files = carried(await $.prompt.context(context()))
    const tool = await $.tool.call(read('/repo/src/app.ts'))

    expect(files).toEqual([OVERVIEW_FILE])
    expect(tool.context).toEqual([TS])
  })
})

describe('rules without paths sent outside the instructions', () => {
  test('are framed as the user instruction files they would have been', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    expect((await $.prompt.submit(typed('hi'))).context).toEqual([OVERVIEW])
  })
})
