import { describe, expect, it } from 'vitest'

import {
  MAIN,
  alwaysKey,
  change,
  changes,
  claim,
  forget,
  forgetSession,
  inherit,
  newLedger,
  record,
  scopedKey,
  sent,
  toldKey,
} from '../../src/state'
import { fakeEngine } from '../util/fake-engine'

describe('ledger keys', () => {
  it('names the main loop and each subagent apart, for both kinds of rule', () => {
    expect(scopedKey()).toBe(MAIN)
    expect(scopedKey('a1')).toBe('a1')
    expect(alwaysKey()).toBe('always:main')
    expect(alwaysKey('a1')).toBe('always:a1')
    expect(toldKey()).toBe('told:main')
    expect(toldKey('a1')).toBe('told:a1')
  })
})

describe('sent', () => {
  it('answers an empty record for a session with none', async () => {
    const { $ } = fakeEngine()

    expect(await sent($)).toEqual({})
  })

  it('reads the current session record from the store', async () => {
    const { $ } = fakeEngine({ files: {} }, { 'sent:s1': { main: ['/a.md'] }, 'sent:s2': { main: ['/b.md'] } })

    expect(await sent($)).toEqual({ main: ['/a.md'] })
  })
})

describe('claim', () => {
  it('answers the candidates not yet sent under the key, and records them', async () => {
    const { $, store } = fakeEngine()
    const ledger = newLedger()

    expect(await claim($, ledger, MAIN, ['/a.md', '/b.md'])).toEqual(['/a.md', '/b.md'])
    expect(await claim($, ledger, MAIN, ['/b.md', '/c.md'])).toEqual(['/c.md'])
    expect(store.get('sent:s1')).toEqual({ main: ['/a.md', '/b.md', '/c.md'] })
  })

  it('keeps each key apart', async () => {
    const { $ } = fakeEngine()
    const ledger = newLedger()

    await claim($, ledger, MAIN, ['/a.md'])

    expect(await claim($, ledger, 'a1', ['/a.md'])).toEqual(['/a.md'])
  })

  it('writes nothing for no candidates', async () => {
    const { $, store } = fakeEngine()

    expect(await claim($, newLedger(), MAIN, [])).toEqual([])
    expect(store.size).toBe(0)
  })

  it('writes nothing when every candidate was already sent', async () => {
    const { $, store } = fakeEngine({ files: {} }, { 'sent:s1': { main: ['/a.md'] } })
    const before = store.get('sent:s1')

    expect(await claim($, newLedger(), MAIN, ['/a.md'])).toEqual([])
    expect(store.get('sent:s1')).toBe(before)
  })

  it('hands a rule to only one of several parallel claims', async () => {
    const { $ } = fakeEngine()
    const ledger = newLedger()

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => claim($, ledger, MAIN, ['/a.md'])))

    expect(results.flat()).toEqual(['/a.md'])
  })

  it('reads what an earlier module recorded, so a reload does not resend', async () => {
    const { $ } = fakeEngine({ files: {} }, { 'sent:s1': { main: ['/a.md'] } })

    expect(await claim($, newLedger(), MAIN, ['/a.md'])).toEqual([])
  })

  it('records under the current session only', async () => {
    const engine = fakeEngine()
    const ledger = newLedger()

    await claim(engine.$, ledger, MAIN, ['/a.md'])
    engine.setSession('s2')

    expect(await claim(engine.$, ledger, MAIN, ['/a.md'])).toEqual(['/a.md'])
    expect(engine.store.get('sent:s1')).toEqual({ main: ['/a.md'] })
  })

  it('keeps going after a store write fails', async () => {
    const { $ } = fakeEngine()
    const ledger = newLedger()
    const set = $.store.set
    let failing = true
    ;($.store as { set: typeof set }).set = async (key, value) => {
      if (failing) {
        failing = false
        throw new Error('disk full')
      }
      return set(key, value)
    }

    await expect(claim($, ledger, MAIN, ['/a.md'])).rejects.toThrow('disk full')
    expect(await claim($, ledger, MAIN, ['/a.md'])).toEqual(['/a.md'])
  })
})

describe('record', () => {
  it('sets exactly what was sent under a key, replacing what was there', async () => {
    const { $ } = fakeEngine({ files: {} }, { 'sent:s1': { 'always:main': ['/old.md'], main: ['/x.md'] } })

    await record($, newLedger(), alwaysKey(), ['/new.md'])

    expect(await sent($)).toEqual({ 'always:main': ['/new.md'], main: ['/x.md'] })
  })

  it('records an empty list, which still marks the key as present', async () => {
    const { $ } = fakeEngine()

    await record($, newLedger(), alwaysKey(), [])

    expect((await sent($))[alwaysKey()]).toEqual([])
  })
})

describe('forget', () => {
  it('drops only the keys named', async () => {
    const { $ } = fakeEngine({ files: {} }, { 'sent:s1': { main: ['/a.md'], 'always:main': ['/b.md'], a1: ['/a.md'] } })

    await forget($, newLedger(), [MAIN, alwaysKey()])

    expect(await sent($)).toEqual({ a1: ['/a.md'] })
  })

  it('deletes the record when nothing is left', async () => {
    const { $, store } = fakeEngine({ files: {} }, { 'sent:s1': { main: ['/a.md'] } })

    await forget($, newLedger(), [MAIN])

    expect(store.has('sent:s1')).toBe(false)
  })

  it('is harmless for keys that were never recorded', async () => {
    const { $ } = fakeEngine()

    await forget($, newLedger(), ['nope'])

    expect(await sent($)).toEqual({})
  })
})

describe('forgetSession', () => {
  it('drops the whole record of the session named, not the current one', async () => {
    const { $, store } = fakeEngine({ files: {} }, { 'sent:old': { main: ['/a.md'] }, 'sent:s1': { main: ['/b.md'] } })

    await forgetSession($, newLedger(), 'old')

    expect(store.has('sent:old')).toBe(false)
    expect(store.get('sent:s1')).toEqual({ main: ['/b.md'] })
  })
})

describe('pruning', () => {
  it('keeps at most 50 sessions of records, dropping the oldest', async () => {
    const stored = Object.fromEntries(Array.from({ length: 55 }, (_, i) => [`sent:old${i}`, { main: ['/a.md'] }]))
    const { $, store } = fakeEngine({ files: {} }, { ...stored, unrelated: 'kept' })

    await claim($, newLedger(), MAIN, ['/a.md'])

    const records = [...store.keys()].filter(key => key.startsWith('sent:'))
    expect(records).toHaveLength(50)
    expect(records).toContain('sent:s1')
    expect(store.has('sent:old0')).toBe(false)
    expect(store.has('sent:old54')).toBe(true)
    expect(store.get('unrelated')).toBe('kept')
  })
})

describe('change', () => {
  it('answers no changes for a session with none', async () => {
    const { $ } = fakeEngine()

    expect(await changes($)).toEqual({ added: [], removed: [] })
  })

  it('records sources added, in order, a repeat replacing the first in place', async () => {
    const { $, store } = fakeEngine()
    const ledger = newLedger()

    await change($, ledger, { add: [{ name: 'a', content: '1' }, { dir: '/r' }] })
    await change($, ledger, { add: [{ name: 'a', content: '2' }, { file: '/f.md' }] })

    expect(store.get('changes:s1')).toEqual({
      added: [{ name: 'a', content: '2' }, { dir: '/r' }, { file: '/f.md' }],
      removed: [],
    })
  })

  it('records a removal, dropping the source if it was added', async () => {
    const { $ } = fakeEngine()
    const ledger = newLedger()

    await change($, ledger, { add: [{ dir: '/r' }] })
    await change($, ledger, { remove: ['dir:/r', 'rules:x'] })

    expect(await changes($)).toEqual({ added: [], removed: ['dir:/r', 'rules:x'] })
  })

  it('takes a removal back when the source is added again', async () => {
    const { $ } = fakeEngine()
    const ledger = newLedger()

    await change($, ledger, { remove: ['dir:/r'] })
    await change($, ledger, { add: [{ dir: '/r' }] })

    expect(await changes($)).toEqual({ added: [{ dir: '/r' }], removed: [] })
  })

  it('writes nothing when nothing changes', async () => {
    const { $, store } = fakeEngine()

    await change($, newLedger(), {})

    expect(store.has('changes:s1')).toBe(false)
  })

  it('keeps parallel changes, each applied on the last', async () => {
    const { $ } = fakeEngine()
    const ledger = newLedger()

    await Promise.all([change($, ledger, { add: [{ dir: '/a' }] }), change($, ledger, { add: [{ dir: '/b' }] })])

    expect((await changes($)).added).toEqual([{ dir: '/a' }, { dir: '/b' }])
  })

  it('is dropped with the session by forgetSession', async () => {
    const { $, store } = fakeEngine()
    const ledger = newLedger()

    await change($, ledger, { add: [{ dir: '/r' }] })
    await forgetSession($, ledger, 's1')

    expect(store.has('changes:s1')).toBe(false)
  })
})

describe('inherit', () => {
  it('starts a loop with what its parent was sent, under each key', async () => {
    const { $ } = fakeEngine(
      { files: {} },
      { 'sent:s1': { main: ['/ts.md'], 'told:main': ['/o.md'], 'always:main': ['/a.md'], f1: ['/own.md'] } },
    )

    await inherit($, newLedger(), undefined, 'f1')

    expect(await sent($)).toEqual({
      main: ['/ts.md'],
      'told:main': ['/o.md'],
      'always:main': ['/a.md'],
      f1: ['/own.md', '/ts.md'],
      'told:f1': ['/o.md'],
      'always:f1': ['/a.md'],
    })
  })

  it('inherits from a subagent parent by its id', async () => {
    const { $ } = fakeEngine({ files: {} }, { 'sent:s1': { a1: ['/ts.md'] } })

    await inherit($, newLedger(), 'a1', 'f1')

    expect((await sent($)).f1).toEqual(['/ts.md'])
  })

  it('writes nothing when the parent was sent nothing', async () => {
    const { $, store } = fakeEngine()

    await inherit($, newLedger(), undefined, 'f1')

    expect(store.has('sent:s1')).toBe(false)
  })
})
