import { describe, expect, test } from 'claude-code/testing'

import {
  OVERVIEW,
  OVERVIEW_FILE,
  PROJECT_FILE,
  RULES_DIR,
  START,
  TS,
  TURN_END,
  carried,
  context,
  read,
  told,
  treeOf,
  typed,
  userFile,
  world,
} from '../util/helpers'

/** A machine `prompt.context` is known to reach the plugin on. */
const REACHED = { stored: { 'prompt.context': 'seen' } }

/** A machine where `prompt.context` is known to pass the plugin over. */
const BYPASSED = { stored: { 'prompt.context': 'bypassed' } }

const bash = (agentId?: string) => ({ tool: 'Bash', command: 'ls', ...(agentId === undefined ? {} : { agentId }) }) as never

describe('rules without paths: the instructions', () => {
  test('join them as user instruction files, after the person\'s own and before the project\'s', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    const own = { path: '/home/me/.claude/CLAUDE.md', kind: 'user' as const, content: '# Mine\n' }

    const answer = await $.prompt.context({ ...context(), instructionFiles: [own, PROJECT_FILE] })

    expect(answer.instructionFiles).toEqual([own, OVERVIEW_FILE, PROJECT_FILE])
  })

  test('go before the project\'s files when the person has none', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    expect((await $.prompt.context(context())).instructionFiles).toEqual([OVERVIEW_FILE, PROJECT_FILE])
  })

  test('join in source order, a rule written in code under its rules: path', async ($, on) => {
    world(on, treeOf([{ name: 'one', content: 'First' }, { name: 'two', content: 'Second' }]))

    const answer = await $.prompt.context(context())

    expect(carried(answer)).toEqual([userFile('rules:one', 'First'), userFile('rules:two', 'Second')])
  })

  test('leave out rules with paths', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    expect(carried(await $.prompt.context(context()))).toEqual([OVERVIEW_FILE])
  })

  test('leave the instructions as they were when there are none', async ($, on) => {
    world(on, treeOf([{ name: 'scoped', content: 'X', paths: ['src/**'] }]))

    expect((await $.prompt.context(context())).instructionFiles).toEqual([PROJECT_FILE])
  })

  test('leave out a file the instructions already carry', async ($, on) => {
    world(on, treeOf([{ file: '/repo/CLAUDE.md' }]))

    expect((await $.prompt.context(context())).instructionFiles).toEqual([PROJECT_FILE])
  })

  test('leave the context alone when a hook above rewrote its instructions\' text', async ($, on) => {
    world(on, treeOf(RULES_DIR))
    const { blocks } = context()

    const answer = await $.prompt.context({ blocks })

    expect(answer.instructionFiles).toBeUndefined()
  })

  test('join instructions asked for again, as after a resume, each time', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    await $.prompt.context(context())
    const again = await $.prompt.context(context())

    expect(carried(again)).toEqual([OVERVIEW_FILE])
  })

  test('once carried, are not sent with a prompt, a tool, or a subagent\'s first tool', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)

    await $.prompt.context(context())
    const prompt = await $.prompt.submit(typed('hi'))
    const tool = await $.tool.call(bash())
    const sub = await $.tool.call(bash('a1'))

    expect(prompt.context).toBeUndefined()
    expect(tool.context).toBeUndefined()
    expect(sub.context).toBeUndefined()
  })

  test('mark the machine as reached', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.prompt.context(context())

    expect(fake.store.get('prompt.context')).toBe('seen')
  })
})

describe('rules without paths: a machine known to reach the instructions', () => {
  test('are left by the first prompt to the instructions that follow it', async ($, on) => {
    world(on, treeOf(RULES_DIR), REACHED)

    const prompt = await $.prompt.submit(typed('hi'))
    const answer = await $.prompt.context(context())

    expect(prompt.context).toBeUndefined()
    expect(carried(answer)).toEqual([OVERVIEW_FILE])
  })

  test('that turn up after the instructions ride the next prompt, once', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    world(on, tree, REACHED)

    await $.prompt.context(context())
    tree.files['/sources.json'] = JSON.stringify([...RULES_DIR, { name: 'late', content: 'Late rule' }])
    await $.session.start(START)
    const first = await $.prompt.submit(typed('hi'))
    const second = await $.prompt.submit(typed('again'))

    expect(first.context).toEqual([told('rules:late', 'Late rule')])
    expect(second.context).toBeUndefined()
  })

  test('keep context another hook already added to the prompt', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    world(on, tree, REACHED)

    await $.prompt.context(context())
    tree.files['/sources.json'] = JSON.stringify([{ name: 'late', content: 'Late' }])
    await $.session.start(START)
    const prompt = await $.prompt.submit({ ...typed('hi'), context: ['from another hook'] })

    expect(prompt.context).toEqual(['from another hook', told('rules:late', 'Late')])
  })

  test('reach the first tool, and the turn\'s end marks the machine passed over, when no instructions came', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR), REACHED)

    const prompt = await $.prompt.submit(typed('hi'))
    const tool = await $.tool.call(bash())
    await $.turn.complete(TURN_END)

    expect(prompt.context).toBeUndefined()
    expect(tool.context).toEqual([OVERVIEW])
    expect(fake.store.get('prompt.context')).toBe('bypassed')
  })
})

describe('rules without paths: a machine not known to reach the instructions yet', () => {
  test('ride the first prompt, and the instructions that follow leave them out', async ($, on) => {
    world(on, treeOf(RULES_DIR))

    const prompt = await $.prompt.submit(typed('hi'))
    const answer = await $.prompt.context(context())

    expect(prompt.context).toEqual([OVERVIEW])
    expect(carried(answer)).toEqual([])
  })

  test('a turn that ended after the instructions came leaves the machine marked as reached', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.prompt.submit(typed('hi'))
    await $.prompt.context(context())
    await $.turn.complete(TURN_END)

    expect(fake.store.get('prompt.context')).toBe('seen')
  })
})

describe('rules without paths: where the instructions pass the plugin over', () => {
  // On a machine with managed settings, and for Team and Enterprise
  // organizations, `prompt.context` and `session.compact` skip a plugin a
  // person installs: only prompts and tool calls reach it

  test('a first turn that ended without instructions marks the machine', async ($, on) => {
    const fake = world(on, treeOf(RULES_DIR))

    await $.prompt.submit(typed('hi'))
    await $.turn.complete(TURN_END)

    expect(fake.store.get('prompt.context')).toBe('bypassed')
  })

  test('reach the main loop with its first prompt, once', async ($, on) => {
    world(on, treeOf(RULES_DIR), BYPASSED)

    const first = await $.prompt.submit(typed('hi'))
    const second = await $.prompt.submit(typed('again'))

    expect(first.context).toEqual([OVERVIEW])
    expect(second.context).toBeUndefined()
  })

  test('reach a subagent with its first tool, apart from the main loop', async ($, on) => {
    world(on, treeOf(RULES_DIR), BYPASSED)

    await $.prompt.submit(typed('hi'))
    const main = await $.tool.call(bash())
    const sub = await $.tool.call(read('/repo/README.md', 'a1'))
    const subAgain = await $.tool.call(read('/repo/README.md', 'a1'))

    expect(main.context).toBeUndefined()
    expect(sub.context).toEqual([OVERVIEW])
    expect(subAgain.context).toBeUndefined()
  })

  test('reach a loop with any tool, not only a file tool', async ($, on) => {
    world(on, treeOf(RULES_DIR), BYPASSED)

    expect((await $.tool.call(bash())).context).toEqual([OVERVIEW])
  })

  test('come before path rules when both arrive with the same tool', async ($, on) => {
    world(on, treeOf(RULES_DIR), BYPASSED)

    expect((await $.tool.call(read('/repo/src/app.ts'))).context).toEqual([OVERVIEW, TS])
  })

  test('that turn up later ride the next prompt', async ($, on) => {
    const tree = treeOf(RULES_DIR)
    world(on, tree, BYPASSED)

    await $.prompt.submit(typed('hi'))
    tree.files['/plugin/rules/late.md'] = 'Late'
    const next = await $.prompt.submit(typed('again'))

    expect(next.context).toEqual([told('/plugin/rules/late.md', 'Late')])
  })
})
