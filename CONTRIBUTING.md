# Contributing

Thanks for helping out. Bug reports, fixes and improvements are all welcome.

## Before you start

- **Bugs:** search the [existing issues](https://github.com/mcmanussliam/claude-plugin-rules/issues) first, then open one with the bug report template. Include your Claude Code version (`claude --version`): the plugin API changes between releases.
- **Features and larger changes:** open an issue to discuss it before writing code, so nobody spends time on something that won't be merged.

## Setup

You need Node.js 22 or later and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`). The tests run on Claude Code's own plugin test runner; no login is needed.

```sh
git clone https://github.com/mcmanussliam/claude-plugin-rules.git
cd claude-plugin-rules
npm install
```

## Checks

Run all of these before opening a pull request. CI runs the same ones.

```sh
npm run typecheck   # tsc --noEmit
npm test            # unit tests (Vitest), then consumer tests (`claude plugin test`)
npm run validate    # all tests, then `claude plugin validate` on the fixture plugin
npm run build       # dist/: the bundle and declarations that get published
```

Tests live in `test/`:

- `unit/`: Vitest unit tests (`*.spec.ts`), mirroring `src/`.
- `consumer/`: tests (`*.test.ts`) run by Claude Code's plugin runner against `plugin.ts`, a fixture plugin using the package the way a real one would.
- `util/`: shared fakes and helpers.

`test/` itself is the fixture plugin's root (`.claude-plugin/`, `hooks/`): Claude Code's runner refuses imports from outside the plugin's folder, so the consumer tests and `util/` must sit inside it. That's also why unit tests are `*.spec.ts`: the runner loads every `*.test.ts` under the folder.

## Pull requests

- Keep each pull request to one change, with tests for new behaviour and for bugs you fix.
- Match the surrounding code: no semicolons, single quotes, doc comments on exported and non-obvious functions.
- Title the pull request as a [Conventional Commit](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `docs: …`, and so on. Pull requests are squash-merged, so the title becomes the commit on `main`, and CI checks it.

## Updating the Claude Code types

`types/claude-code.d.ts` is generated: Claude Code writes it beside each plugin it loads from a folder you own. To regenerate it after a Claude Code update, start a session with the fixture plugin loaded (`claude --plugin-dir test`), then copy `test/.claude-plugin/types/claude-code/index.d.ts` over it. Don't edit it by hand. If you move to a newer Claude Code version, update the pinned version in `.github/workflows/ci.yml` and `.github/workflows/release.yml`, the placeholder in the bug report template, and the tested version in the README too.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
