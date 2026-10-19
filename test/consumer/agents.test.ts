import { describe, expect, test } from 'claude-code/testing'

import { OVERVIEW, RULES_DIR, TS, context, read, treeOf, typed, world } from '../util/helpers'

/** Where the instructions pass the plugin over, so rules without `paths` ride prompts and tool results. */
const BYPASSED = { stored: { 'prompt.context': 'bypassed' } }

/** A subagent spawned by the main loop: forked from its conversation or not, new or resumed. */
const spawn = (fork: boolean, resume?: string) =>
  ({
    tool_use_id: 'tu1',
    prompt: 'go',
    description: 'a subagent',
    subagentType: 'general-purpose',
    parentModel: 'model',
    background: false,
    fork,
    ...(resume === undefined ? {} : { resume: { agentId: resume } }),
  }) as never

describe('a forked agent', () => {
  test('starts with the path rules its parent was sent', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.prompt.context(context())
    await $.tool.call(read('/repo/src/app.ts'))

    await $.agent.spawn(spawn(true))
    const forked = await $.tool.call(read('/repo/src/app.ts', 'spawned'))

    expect(forked.context).toBeUndefined()
  })

  test('starts with the rules without paths its parent\'s prompts carried', async ($, on) => {
    world(on, treeOf(RULES_DIR), BYPASSED)
    await $.prompt.submit(typed('hi'))

    await $.agent.spawn(spawn(true))
    const forked = await $.tool.call(read('/repo/README.md', 'spawned'))

    expect(forked.context).toBeUndefined()
  })
})

describe('an agent that is not forked', () => {
  test('starts with none of its parent\'s path rules', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.prompt.context(context())
    await $.tool.call(read('/repo/src/app.ts'))

    await $.agent.spawn(spawn(false))
    const fresh = await $.tool.call(read('/repo/src/app.ts', 'spawned'))

    expect(fresh.context).toEqual([TS])
  })

  test('resumed, keeps its own record rather than its parent\'s', async ($, on) => {
    world(on, treeOf(RULES_DIR), BYPASSED)
    await $.prompt.submit(typed('hi'))

    await $.agent.spawn(spawn(true, 'old'))
    const resumed = await $.tool.call(read('/repo/README.md', 'old'))

    expect(resumed.context).toEqual([OVERVIEW])
  })
})
