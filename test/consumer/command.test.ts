import { describe, expect, test } from 'claude-code/testing'

import { PLUGIN, RULES_DIR, START, context, read, treeOf, world } from '../util/helpers'

const run = (command: string) => ({ command }) as never

describe('the command', () => {
  test('is registered when the session starts, named after the plugin', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.session.start(START)

    expect(fake.commands).toEqual([{ name: `${PLUGIN}-rules`, description: `List ${PLUGIN}'s rules and which have loaded` }])
  })

  test('is registered again when the module reloads', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.session.start(START)
    await $.session.start(START)

    expect(fake.commands.map(command => command.name)).toEqual([`${PLUGIN}-rules`, `${PLUGIN}-rules`])
  })

  test('lists every rule, marked ○ until it reaches the main conversation', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.session.start(START)

    const listed = await $.command.run(run(`${PLUGIN}-rules`))

    expect(listed.text).toBe(['○ /plugin/rules/backend/ts.md [src/**/*.ts]', '○ /plugin/rules/overview.md [always]'].join('\n'))
  })

  test('marks a rule ● once it has reached the main conversation', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.session.start(START)

    await $.prompt.context(context())
    const afterInstructions = await $.command.run(run(`${PLUGIN}-rules`))
    await $.tool.call(read('/repo/src/app.ts'))
    const afterRead = await $.command.run(run(`${PLUGIN}-rules`))

    expect(afterInstructions.text).toBe(
      ['○ /plugin/rules/backend/ts.md [src/**/*.ts]', '● /plugin/rules/overview.md [always]'].join('\n'),
    )
    expect(afterRead.text).toBe(['● /plugin/rules/backend/ts.md [src/**/*.ts]', '● /plugin/rules/overview.md [always]'].join('\n'))
  })

  test('does not count a rule only a subagent has read', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.session.start(START)

    await $.tool.call(read('/repo/src/app.ts', 'a1'))
    const listed = await $.command.run(run(`${PLUGIN}-rules`))

    expect(listed.text).toBe(['○ /plugin/rules/backend/ts.md [src/**/*.ts]', '○ /plugin/rules/overview.md [always]'].join('\n'))
  })

  test('lists every glob of a rule with several', async ($, on) => {
    world(on, treeOf([{ name: 'multi', content: 'M', paths: ['src/**', 'lib/**'] }]))
    await $.session.start(START)

    expect((await $.command.run(run(`${PLUGIN}-rules`))).text).toBe('○ rules:multi [src/**, lib/**]')
  })

  test('says so when no rules apply', async ($, on) => {
    world(on, treeOf([]))
    await $.session.start(START)

    expect((await $.command.run(run(`${PLUGIN}-rules`))).text).toBe('No rules apply to this project.')
  })

  test('leaves every other command to the engine', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    await $.session.start(START)

    expect((await $.command.run(run('help'))).text).toBe('engine ran /help')
  })

  test('is not answered before it was registered', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    expect((await $.command.run(run(`${PLUGIN}-rules`))).text).toBe(`engine ran /${PLUGIN}-rules`)
  })
})
