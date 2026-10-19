import type { On } from 'claude-code'

import { addRules, defineRules, listRules, reloadRules, removeRules, rules, type RuleInput, type RuleRef } from '../../src'

/** What `/sources.json` holds: the sources to resolve, or a probe of the resolver's context. */
type Spec = RuleInput | RuleInput[] | { probe: { exists: string; list: string; stat: string; read: string } }

const ruleSet = defineRules(async ({ fs, session, plugin }) => {
  const spec = JSON.parse(await fs.read('/sources.json')) as Spec

  if (typeof spec === 'string' || Array.isArray(spec) || !('probe' in spec)) {
    return spec
  }

  const seen = {
    session,
    plugin,
    exists: await fs.exists(spec.probe.exists),
    list: (await fs.list(spec.probe.list)).map(entry => entry.name),
    stat: (await fs.stat(spec.probe.stat)).kind,
    read: await fs.read(spec.probe.read),
  }

  return [{ name: 'probe', content: JSON.stringify(seen) }]
})

/**
 * A plugin using the package as a dependent plugin would. Its resolver reads
 * `/sources.json`, which each test writes into its fake filesystem.
 *
 * A probe answers one rule written in code, holding what the resolver was
 * given, as JSON.
 *
 * Its commands drive the rule set from a hook, as a plugin loading rules
 * dynamically does: `/add` and `/remove` take a JSON list of sources, `/reload`
 * asks the resolver again, `/list` answers `listRules` as JSON.
 *
 * It also hooks events the package hooks, without matchers, as a plugin with
 * hooks of its own does: Claude Code would refuse the module if the package
 * registered any of those without one too.
 */
export function register(on: On): void {
  on('session.start', async ($, e, next) => next(e)).catch(($, e, next) => next(e))
  on('prompt.submit', async ($, e, next) => next(e)).catch(($, e, next) => next(e))
  on('prompt.attachment', async ($, e, next) => next(e)).catch(($, e, next) => next(e))
  on('tool.call', async ($, e, next) => next(e)).catch(($, e, next) => next(e))

  rules(on, ruleSet)

  on('command.run', { command: ['add', 'remove', 'reload', 'list'] }, async ($, e, next) => {
    if (e.command === 'add') {
      return { text: JSON.stringify(await addRules($, ruleSet, JSON.parse(e.args) as RuleInput[])) }
    }

    if (e.command === 'remove') {
      await removeRules($, ruleSet, JSON.parse(e.args) as RuleRef[])
      return { text: 'removed' }
    }

    if (e.command === 'reload') {
      reloadRules($, ruleSet)
      return { text: 'reloaded' }
    }

    if (e.command === 'list') {
      return { text: JSON.stringify(await listRules($, ruleSet)) }
    }

    return next(e)
  }).catch(($, e, next) => next(e))
}
