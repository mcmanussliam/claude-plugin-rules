import { describe, expect, test } from 'claude-code/testing'

import { RULES_DIR, TS, context, framed, read, treeOf, world } from '../util/helpers'

/** The conversation's instructions, which every loop starts with, so file tools carry path rules alone. */
async function settled($: { prompt: { context: (e: never) => Promise<unknown> } }) {
  await $.prompt.context(context() as never)
}

/** A file named after an `@` in a prompt, by the main loop or the subagent `agentId`. */
const mention = (path: string, agentId?: string) =>
  ({ mention: `@${path}`, path, ...(agentId === undefined ? {} : { agentId }) }) as never

describe('rules with paths', () => {
  test('attach to a Read of a matching file', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    expect((await $.tool.call(read('/repo/src/app.ts'))).context).toEqual([TS])
  })

  test('attach once per loop, however often the file is read', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    await $.tool.call(read('/repo/src/app.ts'))
    const again = await $.tool.call(read('/repo/src/app.ts'))
    const other = await $.tool.call(read('/repo/src/other.ts'))

    expect(again.context).toBeUndefined()
    expect(other.context).toBeUndefined()
  })

  test('attach for a subagent apart from the main loop', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    const main = await $.tool.call(read('/repo/src/app.ts'))
    const sub = await $.tool.call(read('/repo/src/app.ts', 'a1'))
    const subAgain = await $.tool.call(read('/repo/src/app.ts', 'a1'))

    expect(main.context).toEqual([TS])
    expect(sub.context).toEqual([TS])
    expect(subAgain.context).toBeUndefined()
  })

  test('do not attach to an Edit or a Write: as with Claude Code\'s own, only reading a file loads them', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    const edit = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' } as never)
    const write = await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: '' } as never)
    const read1 = await $.tool.call(read('/repo/src/app.ts'))

    expect(edit.context).toBeUndefined()
    expect(write.context).toBeUndefined()
    expect(read1.context).toEqual([TS])
  })

  test('do not attach to a file none of their globs match', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    expect((await $.tool.call(read('/repo/README.md'))).context).toBeUndefined()
    expect((await $.tool.call(read('/repo/src/app.js'))).context).toBeUndefined()
  })

  test('attach together when several match the same file', async ($, on) => {
    world(on, treeOf([...RULES_DIR, { name: 'also', content: 'Also', paths: ['src/*.ts'] }]))
    await settled($)

    expect((await $.tool.call(read('/repo/src/app.ts'))).context).toEqual([TS, framed('rules:also', 'Also')])
  })

  test('keep context the tool result already carries', async ($, on) => {
    world(on, treeOf(RULES_DIR), { toolResult: { result: { type: 'text' }, text: 'ok', context: ['already here'] } })
    await settled($)

    expect((await $.tool.call(read('/repo/src/app.ts'))).context).toEqual(['already here', TS])
  })
})

describe('rules with paths: which paths match', () => {
  test('match a path relative to the working directory', async ($, on) => {
    world(on, treeOf(RULES_DIR), { cwd: '/repo/src' })
    await settled($)

    expect((await $.tool.call(read('app.ts'))).context).toEqual([TS])
  })

  test('match a relative path from the project root', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    expect((await $.tool.call(read('src/app.ts'))).context).toEqual([TS])
  })

  test('do not match a file outside the project', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    expect((await $.tool.call(read('/elsewhere/src/app.ts'))).context).toBeUndefined()
  })

  test('do not match a sibling directory that only shares the root\'s name as a prefix', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    expect((await $.tool.call(read('/repo-other/src/app.ts'))).context).toBeUndefined()
  })

  test('match globs against dot directories', async ($, on) => {
    world(on, treeOf([{ name: 'ci', content: 'CI', paths: ['.github/**/*.yml'] }]))
    await settled($)

    expect((await $.tool.call(read('/repo/.github/workflows/ci.yml'))).context).toEqual([framed('rules:ci', 'CI')])
  })
})

describe('rules with paths: tool calls that did not happen', () => {
  test('do not attach to a denied call, and stay unsent', async ($, on) => {
    world(on, treeOf(RULES_DIR), { toolResult: { deny: 'not allowed' } })
    await settled($)

    const denied = await $.tool.call(read('/repo/src/app.ts'))

    expect(denied.context).toBeUndefined()
    expect(denied.deny).toBe('not allowed')
  })

  test('do not attach to a call that failed', async ($, on) => {
    world(on, treeOf(RULES_DIR), { toolResult: { result: { type: 'text' }, text: 'boom', isError: true } })
    await settled($)

    expect((await $.tool.call(read('/repo/src/app.ts'))).context).toBeUndefined()
  })

  test('are still sent at the next successful call after a failed one', async ($, on) => {
    const outcome: { failing: boolean } = { failing: true }
    world(on, treeOf(RULES_DIR), {
      toolResult: () =>
        outcome.failing ? { result: { type: 'text' }, text: 'boom', isError: true } : { result: { type: 'text' }, text: 'ok' },
    })
    await settled($)

    const failed = await $.tool.call(read('/repo/src/app.ts'))
    outcome.failing = false
    const succeeded = await $.tool.call(read('/repo/src/app.ts'))

    expect(failed.context).toBeUndefined()
    expect(succeeded.context).toEqual([TS])
  })

  test('are not touched by tools other than Read, Edit and Write', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    const grep = await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/repo/src/app.ts' } as never)
    const bash = await $.tool.call({ tool: 'Bash', command: 'cat src/app.ts' } as never)
    const after = await $.tool.call(read('/repo/src/app.ts'))

    expect(grep.context).toBeUndefined()
    expect(bash.context).toBeUndefined()
    expect(after.context).toEqual([TS])
  })
})

describe('rules with paths: parallel calls', () => {
  test('attach to only one of several parallel matching reads', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    const results = await Promise.all([1, 2, 3, 4].map(() => $.tool.call(read('/repo/src/app.ts'))))

    expect(results.flatMap(result => result.context ?? [])).toEqual([TS])
  })
})

describe('rules with paths: mentions', () => {
  test('attach to a file mentioned with @, as to a read of it', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    const mentioned = await $.prompt.mention(mention('/repo/src/app.ts'))
    const read1 = await $.tool.call(read('/repo/src/app.ts'))

    expect(mentioned.context).toEqual([TS])
    expect(read1.context).toBeUndefined()
  })

  test('do not attach to a mention of a file none of their globs match', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await settled($)

    expect((await $.prompt.mention(mention('/repo/README.md'))).context).toBeUndefined()
  })

  test('do not attach to a mention that attached no file', async ($, on) => {
    world(on, treeOf(RULES_DIR), { mentionType: null })
    await settled($)

    const mentioned = await $.prompt.mention(mention('/repo/src/app.ts'))
    const read1 = await $.tool.call(read('/repo/src/app.ts'))

    expect(mentioned.context).toBeUndefined()
    expect(read1.context).toEqual([TS])
  })
})

describe('rules with paths: a rule file read for itself', () => {
  /** A rule file inside the project, scoped to the folder it sits in. */
  const DOCS = treeOf([{ file: '/repo/docs/rules.md' }], { '/repo/docs/rules.md': '---\npaths: docs/**\n---\nDocs rule' })

  test('read whole, attaches nothing and counts as sent', async ($, on) => {
    world(on, DOCS)
    await settled($)

    const itself = await $.tool.call(read('/repo/docs/rules.md'))
    const guide = await $.tool.call(read('/repo/docs/guide.md'))

    expect(itself.context).toBeUndefined()
    expect(guide.context).toBeUndefined()
  })

  test('read in part, attaches nothing and is still sent at the next match', async ($, on) => {
    world(on, DOCS)
    await settled($)

    const part = await $.tool.call({ tool: 'Read', file_path: '/repo/docs/rules.md', offset: 1, limit: 1 } as never)
    const guide = await $.tool.call(read('/repo/docs/guide.md'))

    expect(part.context).toBeUndefined()
    expect(guide.context).toEqual([framed('/repo/docs/rules.md', 'Docs rule')])
  })
})
