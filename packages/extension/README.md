<div align="center">

  <img src="https://xgjzloifyvgpbmyonaya.supabase.co/storage/v1/object/public/files/KG8xaCnQ7S/original" width="120" height="120" alt="Viken Icon" />

  <h3>Viken</h3>

  <p>Syntax highlighting, IntelliSense, diagnostics, and file icon support for the <strong>Viken</strong> DSL </br>
  (<code>.vk</code> / <code>.viken</code>) — the language that compiles to VS Code snippets.</p>

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/uaibritto.viken?label=VS%20Code%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=uaibritto.viken)
[![License: MIT](https://img.shields.io/badge/license-MIT-informational)](../../LICENSE.md)

</div>

</br>

> Part of the [Viken monorepo](../../README.md), which also contains the [`@vikyn/viken` compiler](../viken) — a real (workspace) dependency of this extension since `0.3.0`, used for diagnostics.

## **What is Viken**

[Viken](https://github.com/uaibritto/viken) is a DSL that compiles `.vk`/`.viken` files into the VS Code snippet JSON format. A Viken file looks like this:

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
        import type { JSX } from "react"

        export default function fileNameBase(): JSX.Element {
            return (
                $0
            )
        }
```

A file has exactly one `@Header`, any number of `@Const` declarations, and as many `@Snippet` blocks as you want — all three only count as real directives with **zero indentation** (see [Column 0](#-syntax-highlighting) below). `@Body` may only appear inside a `@Snippet`.

This extension provides editor support for the language: it does not run `viken compile` for you (that is still the [`@vikyn/viken`](../viken) CLI's job) — it makes `.vk`/`.viken` files pleasant and safe to edit.

## **Editor compatibility**

Works in **VS Code** and **Cursor** (and any other VS Code-compatible editor) — the minimum required host version is VS Code `1.75.0` or later.

## **Features**

### 🎨 File Icon

`.vk` and `.viken` files appear with the Viken icon in the Explorer, tabs, and breadcrumbs — even when using icon themes that do not know about the language.

### ✨ Syntax Highlighting

- **Directives** (`@Header`, `@Snippet`, `@Body`, `@Const`): only the `@` receives a highlight color; the directive name retains the theme's default text color.
- **Column 0 ("marco zero")**: `@Header`, `@Const`, and `@Snippet` only highlight as real directives when they appear with zero indentation — an _indented_ one (e.g. inside a `@Body`, as a pasted code example) is colored as plain text/code, exactly matching how `@vikyn/viken` actually parses it. `@Body` is the exception: it isn't column-0-only, since it's always indented by convention inside a `@Snippet`.
- **Properties** (`scope:`, `output:`, `prefix:`, `name:`, `detail:`, `template:`): the key is highlighted, and `true`/`false` are recognized as booleans.
- **`@Const <name> = <value>`**: the constant name uses `entity.name.constant` — a scope almost every theme styles distinctly, chosen specifically so the name doesn't blend into the surrounding directive text. The `=` is punctuation, and the value reuses the same rules as any other property value.
- **Quoted string values**: `name: "React Functional Component"` (and `detail`, `@Const`, or any property) is highlighted as a proper string, with `\"` recognized as an escape sequence.
- **VS Code snippet placeholders** inside `@Body`: `$0`, `$1`, `${1:label}`, `${TM_FILENAME_BASE/.../.../}` (1 level of nesting).
- **Code inside `@Body`**, according to the actual language declared in `scope:` — see [@Body Highlighting](#body-highlighting) below.
- **Multi-line strings inside `@Body`**: a JS/TS template literal (`` ` ``) or a Python triple-quoted string (`"""`/`'''`) that spans several lines is recognized as a single continuous string across those lines, instead of resetting at each line break.
- **`@Const` usage inside `@Body`** (e.g. `fileNameBase` in `function fileNameBase()`) gets its own semantic token (`macro`), distinguishing it from a regular identifier — as long as that occurrence isn't already colored as part of a string/comment/keyword from the target language.
- Line comments using `#` outside `@Body` (same rule as the compiler).
- Highlighting is consistent across every `@Header`/`@Snippet`/`@Body` block in a file — they're independent, sibling blocks in the grammar (not nested), and a `@Const` between two snippets correctly ends whichever block came before it, matching the compiler's own parser exactly.

### 💡 IntelliSense

- Typing `@` **with no indentation** suggests only the marco-zero directives valid at that point: `@Header` (only if the file doesn't already have one — so once a `@Header` exists, it stops being offered, and only `@Const`/`@Snippet` remain at column 0), `@Snippet` (always), `@Const` (always).
- Typing an **indented** `@` only ever suggests `@Body`, and only inside a `@Snippet` that doesn't have one yet — indented `@Header`/`@Snippet`/`@Const` are never suggested, since inserting them off column 0 would produce something the compiler wouldn't actually recognize as a directive. Inside a `@Body` (or anywhere else), nothing is suggested at all.
- On an empty line inside `@Header`/`@Snippet`, valid properties for that block are suggested.
- After `scope:`, a curated list of common VS Code language IDs is suggested. After `template:`, only `true`/`false`.
- **Hover**: directives, properties, and `@Const` usages inside `@Body` all show documentation — hovering a `@Const` usage shows what it expands to.
- **Snippet to bootstrap a new file**: type `viken` and hit Tab in an empty `.vk`/`.viken` file to scaffold `@Header` + `@Snippet` + `@Body` with tabstops already in place; `const` bootstraps a single `@Const` line.

### 🩺 Diagnostics

As of `0.3.0`, the extension runs the **real** `@vikyn/viken` parser (as a workspace dependency, not a reimplementation) on every open/edit of a `.vk`/`.viken` file, using its `parseVikenCollectingErrors` API — so **every** problem in the file is reported at once, as its own squiggle, not just the first one. An empty or placeholder file (no recognizable content yet) is never flagged.

## **@Body Highlighting**

A snippet body can be written in any language — that is the purpose of `scope:`. However, the TextMate grammar used by VS Code (`syntaxes/viken.tmLanguage.json`) **cannot** dynamically choose which language to embed based on a value declared in another block of the same file. For this reason, `@Body` highlighting has two layers:

1. **Base (TextMate grammar)**: embeds the TSX grammar (`source.tsx`) as generic highlighting.
2. **Semantic (`SemanticTokensProvider`, in `source/extension.ts` + `source/bodyTokenizer.ts`)**: reads the actual `scope:` and tokenizes `@Body` according to the declared language family:

    | Family | Comment | Block comment | Languages (`scope:`)                                                                                                                                                          |
    | ------ | ------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | C-like | `//`    | `/* ... */`   | `typescript`, `typescriptreact`, `javascript`, `javascriptreact`, `tsrx`, `java`, `c`, `cpp`, `csharp`, `go`, `rust`, `kotlin`, `swift`, `php`, `dart`, `scala`, `objectivec` |
    | Python | `#`     | —             | `python` (its own family — only Python gets triple-quoted `"""`/`'''` docstring handling)                                                                                     |
    | Hash   | `#`     | —             | `ruby`, `perl`, `elixir`                                                                                                                                                      |
    | Dash   | `--`    | `--[[ ... ]]` | `lua`                                                                                                                                                                         |
    | Shell  | `#`     | —             | `shellscript`, `bash`                                                                                                                                                         |
    | SQL    | `--`    | `/* ... */`   | `sql`                                                                                                                                                                         |

    Block comments (like multi-line strings) are tracked across line breaks, so a `/* ...` that doesn't close on the same line keeps coloring as a comment until its closing `*/`, however many lines that takes. `vue`, `svelte`, `html`, `json` (and any `scope:` outside the table) only use the base TSX layer. `@Const` usage highlighting still works for these, since it doesn't depend on the target language.

**Intentional limitations, to keep things simple:**

- Not a real parser for each language — only comments (line and block), strings (including the multi-line cases above), numbers, and a curated keyword list.
- A backtick template literal is treated as multi-line-capable for **every** C-like language mapped above (not just JS/TS), since they share one family object.

## **Installation (Development)**

This package lives inside the [Viken monorepo](../../README.md). From the repo root:

```bash
bun install                          # installs every workspace from the single root lockfile
bun run --filter viken build         # builds only this package (or: cd packages/extension && bun run build)
```

Building this package now also builds `@vikyn/viken` first if needed (Turborepo picks this up automatically from the real workspace dependency). Requires **Node 22.18+** (tsdown's own requirement) to build from source — not a requirement to install the published extension.

### **Running in Dev Mode**

Open `packages/extension` in VS Code/Cursor and press `F5`. `.vscode/launch.json` is committed for this — intentionally **not** git-ignored, even though it's excluded from the packaged `.vsix` via `.vscodeignore`.

### **Packaging (`.vsix`)**

```bash
bun run package
```

Runs `vsce package --no-dependencies` (pinned `@vscode/vsce` devDependency). `--no-dependencies` skips vsce's own dependency-tree scan — not needed here since tsdown bundles everything (including `@vikyn/viken`, aside from `vscode` itself) into the single `dist/extension.cjs`.

## **Project Structure**

```text
packages/extension/
├── .vscode/launch.json           F5 dev-host config (committed)
├── icons/                        icon.png (Marketplace) + viking-helmet.svg (Explorer)
├── snippets/
│   └── viken.json                bootstrap snippets ("viken", "const") — lowercase filename,
│                                  must match the lowercase path in package.json's contributes.snippets
├── syntaxes/
│   └── viken.tmLanguage.json     TextMate grammar (base highlighting)
├── source/
│   ├── extension.ts               completions, hover, semantic tokens, diagnostics
│   ├── extension.test.ts          bun:test — pure logic, via a minimal LineSource interface
│   ├── bodyTokenizer.ts           tokenizer by language family
│   └── bodyTokenizer.test.ts      bun:test — keywords, strings, line/block comments
├── language-configuration.json   comments, auto-closing pairs
├── package.json                  extension manifest (depends on @vikyn/viken)
└── tsdown.config.ts              bundling (Rolldown) for dist/extension.cjs
```

Shared tooling (`oxlint`, `oxfmt`, base `tsconfig`, `.editorconfig`) lives at the [monorepo root](../../README.md).

## **Testing**

`packages/extension` has a `bun test` suite (`source/extension.test.ts`, `source/bodyTokenizer.test.ts`). The catch: `vscode` isn't a real installable npm package outside a running extension host, so `provideCompletionItems`/`provideHover`/etc. can't be unit-tested as-is. Instead, the pure logic behind them (the column-0 rule, `@Const` lookup, body-range detection, the tokenizer) is written against a minimal `LineSource` interface — `{ lineCount, lineAt(i) }` — that any real `vscode.TextDocument` satisfies structurally, so nothing changes in production, and tests just build a `LineSource` from a plain string array. Run it with:

```bash
bun test          # from packages/extension
bun run test      # from the repo root — runs it (and packages/viken's suite) via turbo
```

Not covered yet: the actual `vscode.CompletionItem`/`vscode.Hover`/`vscode.SemanticTokensBuilder` construction, or `activate()` itself — that would need a real (or mocked) extension host.

## **Changelog**

### 0.3.0

- Fixed: `@Header`, `@Const`, and `@Snippet` recognition (grammar, completions, hover, semantic-token body ranges) now requires column 0, matching the compiler's own rule — see [Syntax Highlighting](#-syntax-highlighting) above. Previously all of these used indentation-agnostic matching, so an indented one (e.g. inside a `@Body`) could be wrongly treated as a real directive by the editor even where the compiler treated it as literal text.
- Fixed: `findBodyRanges` (used for semantic highlighting) didn't know about `@Const` as a body-ending directive, even though the grammar and the compiler both already did.
- Fixed: the bootstrap snippets file was referenced by a different case (`viken.json`) than its actual filename (`Viken.json`) — on case-sensitive filesystems this silently failed to load, so the `viken`/`const` snippet prefixes never appeared. The file is now named to match the manifest exactly.
- Added: **multi-error diagnostics** — using `@vikyn/viken`'s new `parseVikenCollectingErrors`, every problem in a file is now reported at once instead of one squiggle at a time.
- Added: block comment recognition (`/* ... */` for C-like/SQL, `--[[ ... ]]` for Lua) in the semantic tokenizer, tracked across line breaks alongside the existing line-comment and multi-line-string handling.
- Added: a `bun test` suite for this package — see [Testing](#testing) above.
- Added: `@Const` usage inside `@Body` now gets its own semantic token (`macro`), instead of coloring like a plain identifier.
- Added: snippets to bootstrap a new file (`viken` prefix) or a single `@Const` line (`const` prefix).
- Added: multi-line string recognition inside `@Body` — a JS/TS template literal or a Python triple-quoted string spanning several lines is now tracked correctly across line breaks.
- Added: more `scope:` languages with proper semantic highlighting — `dart`, `scala`, `objectivec` (C-like family), `elixir` (hash family), and two new families: `shellscript`/`bash` and `sql`.
- Fixed: the `@Const` constant name now uses `entity.name.constant` instead of `variable.other.constant` — the latter fell back to the same color as plain text in some themes.
- Fixed: `python` no longer shares its language family with `ruby`/`perl` — it has its own now, so triple-quoted docstring handling doesn't incorrectly apply to Ruby/Perl code.

### 0.1.1

- Fixed: `@Header`, `@Snippet`, and `@Body` are now independent, sibling blocks in the TextMate grammar instead of nested inside one another (previously caused inconsistent highlight between snippets in the same file).
- Fixed: typing `@` right after a previous snippet's `@Body` now correctly suggests `@Snippet`/`@Header` again.
- Fixed: `language-configuration.json` was misnamed relative to what `package.json` expects (bracket-matching, auto-closing pairs, and `#` comment toggling silently never loaded).
- Fixed: `engines.vscode` was set to a version newer than Cursor ships, breaking install there. Lowered to `^1.75.0`.
- Added: quoted string value highlighting; `tsrx` semantic highlighting.

## **Suggested Next Steps**

- Mock or stub `vscode` well enough to also test `provideCompletionItems`/`provideHover`/`activate()` directly, not just the pure logic behind them.
- Expand `SCOPE_FAMILY`/keywords further, or add more block-comment styles (e.g. Haskell's nested `{- -}`).

## **License**

MIT — see [LICENSE.md](../../LICENSE.md) at the repo root.
EOF
echo
