import { describe, expect, test } from 'claude-code/testing'

import { OVERVIEW_FILE, RULES_DIR, carried, context, read, treeOf, typed, world } from '../util/helpers'

/** Where the instructions pass the plugin over, so rules without `paths` would ride prompts and tool results. */
const BYPASSED = { stored: { 'prompt.context': 'bypassed' } }

const mention = (path: string) => ({ mention: `@${path}`, path }) as never

const SWITCHED_ON = [
  ['CLAUDE_CODE_DISABLE_ATTACHMENTS', '1'],
  ['CLAUDE_CODE_SIMPLE', 'true'],
] as const

for (const [name, value] of SWITCHED_ON) describe(`${name} switched on`, () => {
  test('keeps rules out of prompts, tool results and mentions', async ($, on) => {
    world(on, treeOf(RULES_DIR), { ...BYPASSED, env: { [name]: value } })

    const prompt = await $.prompt.submit(typed('hi'))
    const tool = await $.tool.call(read('/repo/src/app.ts'))
    const mentioned = await $.prompt.mention(mention('/repo/src/app.ts'))

    expect(prompt.context).toBeUndefined()
    expect(tool.context).toBeUndefined()
    expect(mentioned.context).toBeUndefined()
  })

  test('leaves the instructions carrying them', async ($, on) => {
    world(on, treeOf(RULES_DIR), { env: { [name]: value } })

    expect(carried(await $.prompt.context(context()))).toEqual([OVERVIEW_FILE])
  })
})

describe('those variables switched off', () => {
  test('leave rules flowing as usual', async ($, on) => {
    world(on, treeOf(RULES_DIR), { ...BYPASSED, env: { CLAUDE_CODE_DISABLE_ATTACHMENTS: '0', CLAUDE_CODE_SIMPLE: 'false' } })

    expect((await $.prompt.submit(typed('hi'))).context).toHaveLength(1)
  })
})
