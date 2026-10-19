# Claude Plugin Rules

Claude Code plugins can ship skills, commands, agents and hooks, but not rules; a plugin's `CLAUDE.md` or `rules/` folder is never loaded. This package fills that gap for plugins built on function hooks.

## Usage

```sh
npm install claude-plugin-rules
```

Call `rules` once from your hooks module's `register`, then bundle the module as usual:

```ts
import type { On } from 'claude-code'
import { rules } from 'claude-plugin-rules'

export function register(on: On): void {
  rules(on) // every .md file under your plugin's rules/ directory
}
```

Rule files work like `.claude/rules`: one without frontmatter is always loaded, and one with `paths` frontmatter loads when Claude reads a matching file.

```md
---
paths:
  - "src/**/*.ts"
---
Prefer `type` over `interface`.
```

You can also pick rules per project, or add and remove them from your own hooks while a conversation runs. [`examples/team-conventions`](examples/team-conventions) shows each of these in a complete plugin, and every exported function is documented in its JSDoc.

## Requirements

**Tested with Claude Code 2.1.303**, which needs Node.js 22 or later. Its plugin API declarations still say they may change between releases, so pin the Claude Code version you test against.

From 2.1.303, Claude Code decides whether installed plugins' hooks modules load through a rollout switch it fetches, not a setting. If it reads off, `/plugin` still shows your plugin as enabled but its hooks do nothing; starting `claude` once with network access refreshes it.

The type declarations import from `claude-code`. Claude Code writes them beside your plugin, as `.claude-plugin/types/claude-code/index.d.ts`, each time it loads the plugin from your folder; include that folder in your `tsconfig.json`.

### On Team and Enterprise plans

On Team and Enterprise plans, and on machines with managed settings, Claude Code keeps the instructions out of reach of plugins users install themselves. Rules still load there, but as context on the first prompt and on tool results rather than beside CLAUDE.md, and they aren't sent again after a compaction.

To load them natively, publish your plugin to a marketplace and have an admin enable it in the organization's managed settings:

```json
{
  "enabledPlugins": {
    "your-plugin@your-marketplace": true
  }
}
```

## Development

```sh
npm install
npm run typecheck
npm test
npm run validate
npm run build
```

`test/unit/` holds the unit tests (Vitest); `test/consumer/` holds tests run by Claude Code's plugin runner against a fixture plugin that uses the package as a dependent plugin would.

`types/claude-code.d.ts` is the plugin API's declarations, as Claude Code writes them beside a plugin it loads. To regenerate it after a Claude Code update, start a session with the fixture plugin loaded (`claude --plugin-dir test`) and copy `test/.claude-plugin/types/claude-code/index.d.ts` over it. Don't edit it.

See [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

## License

[MIT](LICENSE)

---

This is a temporary solution and should be removed once [Rules Support for Claude Code](https://github.com/anthropics/claude-code/issues/14200) is added.
