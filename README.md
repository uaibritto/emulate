<div align="center">

  <img src="https://xgjzloifyvgpbmyonaya.supabase.co/storage/v1/object/public/files/fNW3ES4fLd/original" width="96" height="96" alt="Viken Icon" />

  <h1>Viken</h1>

  <p>A tiny DSL that compiles to VS Code snippets — and the editor extension that makes it pleasant to write.</p>

[![npm](https://img.shields.io/npm/v/%40vikyn%2Fviken?label=%40vikyn%2Fviken&color=blue)](https://www.npmjs.com/package/@vikyn/viken)
[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/uaibritto.viken?label=VS%20Code%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=uaibritto.viken)
[![License: MIT](https://img.shields.io/badge/license-MIT-informational)](./LICENSE.md)

</div>

<br />

```viken
@Header
    scope: typescriptreact
    output: react/tsx.json

@Const fileNameBase = ${TM_FILENAME_BASE/(.*)/${1:/capitalize}/}

@Snippet
    prefix: rfc
    name: "React Functional Component"
    detail: "Create Functional Component"
    template: true

    @Body
        export default function fileNameBase(): JSX.Element {
            return ($0)
        }
```

## Packages

This is a monorepo with two published artifacts that share one source of truth for the language:

| Package                                      | What it is                                                                                  |                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`packages/viken`](./packages/viken)         | [`@vikyn/viken`](https://www.npmjs.com/package/@vikyn/viken) — the DSL compiler and CLI     | `npm i -D @vikyn/viken`                                                            |
| [`packages/extension`](./packages/extension) | **Viken** for VS Code & Cursor — syntax highlighting, IntelliSense, diagnostics, file icons | [Marketplace](https://marketplace.visualstudio.com/items?itemName=uaibritto.viken) |

Each has its own README with usage details, DSL reference, and changelog.

## The language, in one rule

`@Header`, `@Const`, and `@Snippet` only count as directives at **column 0** (no indentation at all). `@Body` is the exception — it isn't column-0-only, it's recognized by context (only valid right after a `@Snippet`'s properties), so it's always indented by convention. This is what guarantees a `@Body`'s content is truly arbitrary and untouched: an indented `@Header`/`@Snippet`/`@Const` — say, inside a code example pasted into another snippet's body — is just literal text, not a real directive. See [`packages/viken`](./packages/viken#column-0-marco-zero) for the full rule and examples.

## Tooling

| Concern                      | Tool                                                                                                                                                                                                                                                             | Lives at                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Workspaces / package manager | [Bun](https://bun.sh/) workspaces, one lockfile                                                                                                                                                                                                                  | repo root                                                 |
| Task orchestration           | [Turborepo](https://turbo.build/repo) — cached, parallel `build`/`lint`/`test`/`format` across packages; `packages/extension` really depends on `packages/viken` (for diagnostics), so `dependsOn: ["^build"]` in `turbo.json` ensures the compiler builds first | `turbo.json`                                              |
| Build                        | [tsdown](https://tsdown.dev/) (Rolldown-based), replacing tsup                                                                                                                                                                                                   | each package's `tsdown.config.ts`                         |
| Lint                         | `oxlint`, with nested-config support if a package ever needs an override                                                                                                                                                                                         | root `oxlint.config.ts`                                   |
| Format                       | `oxfmt` (no per-package variation needed)                                                                                                                                                                                                                        | root `oxfmt.config.ts`                                    |
| Tests                        | `bun test` (built into Bun, no extra dependency) — both packages now have a suite                                                                                                                                                                                | each package's own `source/**/*.test.ts` files            |
| TypeScript                   | Shared `strict`/`noUnusedLocals`/etc. baseline; `module`/`moduleResolution`/`target` stay per-package on purpose                                                                                                                                                 | `tsconfig.base.json` + each package's own `tsconfig.json` |

Two deliberate non-choices, in case you're wondering: **Vite** doesn't fit here (neither package is a browser dev-server app), and the shared `tsconfig.base.json` intentionally does **not** unify `module`/`moduleResolution`/`target` — the compiler targets `bundler` resolution for its own build, while the extension targets `nodenext` to match how the VS Code extension host resolves modules.

Building from source requires **Node 22.18+** (tsdown's own requirement, enforced via the root `engines.node`) — this only affects contributors, not consumers of the published package/extension.

## Getting started

```bash
bun install      # installs every workspace from the single root lockfile
bun run build    # builds every package (turbo run build)
bun run test     # runs each package's test suite
bun run lint     # lints every package
bun run format   # formats every package
```

See [`packages/viken`](./packages/viken) and [`packages/extension`](./packages/extension) for usage instructions specific to each.

## License

MIT — see [LICENSE.md](./LICENSE.md). Each publishable package ships its own copy (`packages/*/LICENSE.md`), since npm/`vsce` package by folder and don't look at the monorepo root.
