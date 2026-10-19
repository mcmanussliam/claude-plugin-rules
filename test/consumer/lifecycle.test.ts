import { describe, expect, test } from 'claude-code/testing'

import { OVERVIEW, OVERVIEW_FILE, RULES_DIR, SUMMARY, TS, carried, context, read, told, treeOf, typed, world } from '../util/helpers'

/** A machine `prompt.context` is known to reach the plugin on. */
const REACHED = { stored: { 'prompt.context': 'seen' } }

const compaction = (agentId?: string) =>
  ({ trigger: 'manual', messages: SUMMARY, ...(agentId === undefined ? {} : { agentId }) }) as never

const end = (reason: string) => ({ reason, sessionId: 's1', resume: { id: 's1' } }) as never

describe('compaction', () => {
  test('sends the main loop\'s path rules again at their next match', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.prompt.context(context())

    await $.tool.call(read('/repo/src/app.ts'))
    await $.session.compact(compaction())
    await $.prompt.context(context())
    const after = await $.tool.call(read('/repo/src/app.ts'))

    expect(after.context).toEqual([TS])
  })

  test('leaves rules without paths to the instructions asked for again, not the prompt before them', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)
    await $.prompt.context(context())

    await $.session.compact(compaction())
    const prompt = await $.prompt.submit(typed('after compaction'))
    const rebuilt = await $.prompt.context(context())

    expect(prompt.context).toBeUndefined()
    expect(carried(rebuilt)).toEqual([OVERVIEW_FILE])
  })

  test('puts rules a prompt had carried into the instructions asked for again', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.prompt.submit(typed('hi'))
    await $.prompt.context(context())

    await $.session.compact(compaction())
    const rebuilt = await $.prompt.context(context())

    expect(carried(rebuilt)).toEqual([OVERVIEW_FILE])
  })

  test('sends rules without paths with the next prompt where no instructions are asked for', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.prompt.submit(typed('hi'))

    await $.session.compact(compaction())
    const prompt = await $.prompt.submit(typed('after compaction'))

    expect(prompt.context).toEqual([OVERVIEW])
  })

  test('of a subagent resets that subagent\'s path rules alone', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)
    await $.prompt.context(context())
    await $.tool.call(read('/repo/src/app.ts'))
    await $.tool.call(read('/repo/src/app.ts', 'a1'))
    await $.tool.call(read('/repo/src/app.ts', 'a2'))

    await $.session.compact(compaction('a1'))
    const main = await $.tool.call(read('/repo/src/app.ts'))
    const a1 = await $.tool.call(read('/repo/src/app.ts', 'a1'))
    const a2 = await $.tool.call(read('/repo/src/app.ts', 'a2'))

    expect(main.context).toBeUndefined()
    expect(a1.context).toEqual([TS])
    expect(a2.context).toBeUndefined()
  })
})

describe('/clear', () => {
  test('sends path rules again in the conversation after it', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.prompt.context(context())
    await $.tool.call(read('/repo/src/app.ts'))

    await $.session.end(end('clear'))
    await $.prompt.context(context())
    const after = await $.tool.call(read('/repo/src/app.ts'))

    expect(after.context).toEqual([TS])
  })

  test('puts rules without paths in the instructions of the conversation after it', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)
    await $.prompt.context(context())

    await $.session.end(end('clear'))
    const prompt = await $.prompt.submit(typed('fresh start'))
    const rebuilt = await $.prompt.context(context())

    expect(prompt.context).toBeUndefined()
    expect(carried(rebuilt)).toEqual([OVERVIEW_FILE])
  })

  test('sends rules without paths with the first prompt after it where no instructions are asked for', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.prompt.submit(typed('hi'))

    await $.session.end(end('clear'))
    const prompt = await $.prompt.submit(typed('fresh start'))

    expect(prompt.context).toEqual([OVERVIEW])
  })

  test('keeps the rules the resolver gave, without asking it again', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))
    await $.prompt.context(context())

    await $.session.end(end('clear'))
    await $.prompt.context(context())

    expect(fake.reads.filter(path => path === '/sources.json')).toHaveLength(1)
  })

  test('deletes the ended conversation\'s record from the store', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))
    await $.prompt.context(context())
    expect(fake.store.has('sent:s1')).toBe(true)

    await $.session.end(end('clear'))

    expect(fake.store.has('sent:s1')).toBe(false)
  })
})

describe('other session ends', () => {
  test('leave the record alone', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))
    await $.prompt.context(context())
    await $.tool.call(read('/repo/src/app.ts'))

    await $.session.end(end('other'))

    expect(fake.store.get('sent:s1')).toEqual({
      'always:main': ['/plugin/rules/overview.md'],
      main: ['/plugin/rules/backend/ts.md'],
    })
  })
})

describe('a module reload', () => {
  test('finds what was already sent in the store, and does not send it again', async ($, on) => {
    world(on, treeOf(RULES_DIR), {
      stored: { 'sent:s1': { 'always:main': ['/plugin/rules/overview.md'], main: ['/plugin/rules/backend/ts.md'] } },
    })

    const prompt = await $.prompt.submit(typed('after a reload'))
    const read1 = await $.tool.call(read('/repo/src/app.ts'))

    expect(prompt.context).toBeUndefined()
    expect(read1.context).toBeUndefined()
  })

  test('sends only what the store does not list', async ($, on) => {
    world(on, treeOf([...RULES_DIR, { name: 'new', content: 'New' }]), {
      stored: { 'sent:s1': { 'always:main': ['/plugin/rules/overview.md'] } },
    })

    const prompt = await $.prompt.submit(typed('after a reload'))

    expect(prompt.context).toEqual([told('rules:new', 'New')])
  })
})
