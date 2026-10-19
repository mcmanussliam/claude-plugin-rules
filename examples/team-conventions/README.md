# team-conventions

An example plugin that ships a team's coding conventions as rules with [claude-plugin-rules](../../README.md).

```
.claude-plugin/plugin.json   the manifest
hooks/hooks.json             points Claude Code at dist/index.js
src/index.ts                 the hooks module
rules/                       loaded in every project
stacks/<name>/               loaded in projects that depend on <name>
extra/                       loaded only when a hook adds them
```

## What it loads

| File | When |
| --- | --- |
| `rules/general.md` | Always: no frontmatter, so it joins the instructions |
| `rules/typescript.md` | When Claude reads a `.ts` or `.tsx` file |
| `rules/testing.md` | When Claude reads a test file |
| `stacks/react/components.md` | In a project depending on `react`, when Claude reads `src/**/*.tsx` |
| `stacks/prisma/schema.md` | In a project depending on `prisma`, when Claude reads `prisma/**` |
| `extra/strict.md` | After `/strict`, until `/strict off` |
| `extra/deploy.md` | After Claude uses the `deploy` skill |

## How

`src/index.ts` makes the rule set with `defineRules`. Its resolver reads the project's `package.json` and returns `rules` plus a `stacks/<name>` folder for each stack the project uses. `register` hands the set to `rules(on, ruleSet)`, then changes it from the plugin's own hooks:

- `/strict` calls `addRules($, ruleSet, 'extra/strict.md')`, and `/strict off` calls `removeRules`.
- A `tool.call` hook on the `Skill` tool calls `addRules` when the `deploy` skill runs, so the skill's result carries the deploy rules.

## Try it

```sh
npm install
npm run build
claude --plugin-dir .
```

Run `/team-conventions-rules` in the session to see which rules apply and which have loaded.
