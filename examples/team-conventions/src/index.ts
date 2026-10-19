import type {On} from 'claude-code'
import {addRules, defineRules, listRules, removeRules, rules} from 'claude-plugin-rules'

/** Stacks with a folder of their own under stacks/, loaded where the project depends on them. */
const STACKS = ['react', 'prisma']

/**
 * The rules every session starts with: rules/ always, and each stack's folder
 * in projects whose package.json lists it.
 *
 * Paths are relative to this plugin.
 */
const ruleSet = defineRules(async ({ fs, session }) => {
  const pkg = JSON.parse(await fs.read(`${session.root}/package.json`).catch(() => '{}'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  return ['rules', ...STACKS.filter(name => name in deps).map(name => `stacks/${name}`)]
})

export function register(on: On): void {
  rules(on, ruleSet)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'strict', description: 'Turn strict mode on, or off with `/strict off`' })
    return started
  }).catch(($, e, next) => next(e))

  // `/strict` adds rules for the rest of the conversation; `/strict off` takes them back
  on('command.run', { command: 'strict' }, async ($, e) => {
    if (e.args.trim() === 'off') {
      await removeRules($, ruleSet, 'extra/strict.md')
      return { text: 'Strict mode is off.' }
    }

    await addRules($, ruleSet, 'extra/strict.md')
    const loaded = (await listRules($, ruleSet)).map(rule => rule.path.split('/').slice(-2).join('/'))
    return { text: `Strict mode is on. Rules now: ${loaded.join(', ')}` }
  }).catch(() => ({ text: 'Strict mode could not be changed.' }))

  // Using the deploy skill brings in the deploy rules; the skill's result carries them
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    if (e.tool === 'Skill' && e.skill === 'deploy') {
      await addRules($, ruleSet, 'extra/deploy.md')
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
