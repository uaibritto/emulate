<div align="center">

  <img src="https://xgjzloifyvgpbmyonaya.supabase.co/storage/v1/object/public/files/fNW3ES4fLd/original" width="120" height="120" alt="Viken Icon" />

  <h3>Viken</h3>

DSL and compiler to generate VS Code snippet files (`.code-snippets` / `snippets/*.json`) from `.vk`/`.viken` files.

</div>

</br>

> Part of the [Viken monorepo](../../README.md), which also contains the [VS Code/Cursor extension](../extension).

## Installation

```bash
npm install --save-dev @vikyn/viken
```

## Quick start

Create a `.vk` (or `.viken`) file:

```viken
@Header
    scope: typescriptreact
    output: react/tsx.json

@Const fileNameBase = ${TM_FILENAME_BASE/(.*)/${1:/capitalize}/}

@Snippet
    name: "React Functional Component"
    prefix: rfc
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

Add to `package.json`:

```json
{
    "scripts": {
        "compile": "viken compile snippets"
    }
}
```

Run:

```bash
npm run compile
```

Compiles every `.vk`/`.viken` file found **recursively** inside `snippets/` (or the given path), and writes the JSON file(s) defined by each file's `output`.

## CLI

```bash
viken compile [path]
```

- `path` — directory or file. Default: `snippets`. Directories are searched recursively (`node_modules` and hidden directories are skipped), so nested files like `snippets/web/react/tsx.vk` are picked up automatically — no need to point the command at the nested folder.
- A `.vk`/`.viken` file that is empty, or contains only blank lines and/or `#` comments, is skipped silently (logged as `⏭ file.vk (vazio, ignorado)`) instead of failing the whole run — useful when placeholder files sit next to real ones while you're still writing a new batch of snippets. A file with actual (even if broken) content — a typo'd directive, a `@Snippet` missing `name`, etc. — is still reported as a real error; only files with _nothing_ recognizable are treated as empty.
- If two files resolve to the same `output`, that's an **error** (not a warning), and the second file's write is refused rather than silently overwriting the first — Node's `readdir` doesn't guarantee any particular order across platforms, so "the last one wins" could otherwise vary between machines for the exact same set of files.
- `viken --version` reads the version straight from the installed package's own `package.json` at runtime, instead of a separate hardcoded string — so it can never drift out of sync with what you actually have installed.

## Output path resolution

`output` (declared in `@Header`) is always resolved **relative to the project root** — i.e. the directory you run `viken compile` from (`process.cwd()`) — regardless of where the `.vk`/`.viken` source file itself lives. So a file at `snippets/web/react/tsx.vk` with `output: react/tsx.json` writes to `<project root>/react/tsx.json`, not `snippets/web/react/react/tsx.json`.

For safety, an `output` that would resolve outside the project root (e.g. via `../../` traversal) is rejected with an error, so a `.vk` file — including one you didn't author yourself — can't be used to overwrite arbitrary files on disk. Known, accepted limitation: this check doesn't resolve symlinks, so a project directory that is itself a symlink pointing outside the root could theoretically be used to bypass it. Treated as hardening debt rather than a blocker, since it requires an attacker to already have planted a symlink in your project — a much higher bar than just supplying a `.vk` file with a `../` path.

## Using as a library

Besides the CLI, the package exports its parser/compiler directly, with types:

```ts
import { parseViken, compileToVSCodeSnippets, isEmptyVikenSource } from "@vikyn/viken"
// or import individually: "@vikyn/viken/parser", "@vikyn/viken/ast", "@vikyn/viken/compiler"

const source = "..." // .vk/.viken file content
if (!isEmptyVikenSource(source)) {
    const ast = parseViken(source) // throws on the first syntax problem found
    const json = compileToVSCodeSnippets(ast)
}
```

`isEmptyVikenSource` is the same "nothing recognizable here" check the CLI uses to skip placeholder files; call it before `parseViken` if your use case (like linting-as-you-type) shouldn't flag a blank, just-created file as an error.

### Collecting every error at once

`parseViken` throws on the _first_ problem it finds — that's still its behavior, unchanged, so the CLI's error reporting stays exactly as it always was. If you want every problem in a file at once instead (e.g. to power an editor's error list), use `parseVikenCollectingErrors`:

```ts
import { parseVikenCollectingErrors } from "@vikyn/viken"

const { file, errors } = parseVikenCollectingErrors(source)
// `errors` lists every problem found, not just the first.
// `file` is a best-effort FileNode — null only if no valid @Header was found.
// A snippet missing `name`/`prefix`, or with a duplicate name, is reported
// in `errors` and left out of `file.snippets` rather than included broken.
if (errors.length === 0 && file) {
    const json = compileToVSCodeSnippets(file)
}
```

This is what the [VS Code/Cursor extension](../extension) uses for its real-time diagnostics, so every mistake in a file shows up as its own squiggle instead of one at a time.

## DSL syntax

One `@Header` and one or more `@Snippet` blocks per file, plus any number of `@Const` declarations.

### Column 0 ("marco zero")

`@Header`, `@Const`, and `@Snippet` are only recognized as directives when they appear with **zero indentation** — exactly at the start of the line. `@Body` is different: it isn't a column-0 directive, it's recognized by _context_ (it's only valid right after a `@Snippet`'s properties), so it's always indented by convention and that indentation doesn't matter for recognizing it.

This is what makes `@Body`'s "content is arbitrary and never touched" guarantee actually true: an indented `@Header`, `@Snippet`, or `@Const foo = bar` inside a `@Body` — say, a Viken example pasted inside another snippet's body — is just literal text, not a real directive:

```viken
@Snippet
    name: "Example"
    prefix: ex

    @Body
        def something():
            @Snippet
                # still just Python inside the string of your generated file,
                # not a real Viken directive — because it's indented.
```

Only an **unindented** `@Snippet` (or `@Header`/`@Const`) actually ends a `@Body`.

### `@Header`

| Key      | Required | Description                                        |
| -------- | -------- | -------------------------------------------------- |
| `scope`  | yes      | Target language(s) (VS Code `scope`)               |
| `output` | yes      | Output JSON path, relative to the **project root** |

### `@Const`

```viken
@Const <name> = <value>
```

A single-line, file-wide text macro. `<value>` (optionally wrapped in double quotes, same rule as other properties) is substituted, as a **whole word**, everywhere it appears inside any `@Body` that comes **after** the `@Const` line — so declare a const before the snippet(s) that use it. This is meant for repetitive placeholder expressions you don't want to retype in every snippet, e.g.:

```viken
@Const fileNameBase = ${TM_FILENAME_BASE/(.*)/${1:/capitalize}/}
```

Then, inside `@Body`, just write `fileNameBase` instead of the full placeholder expression.

Notes:

- `@Const` names must be valid identifiers (`[A-Za-z_][A-Za-z0-9_]*`) and can't be declared twice in the same file.
- Substitution happens in a **single pass** over the body — if `@Const foo = bar` and `@Const bar = baz`, `foo` becomes exactly `bar`, never `baz`. Consts never chain into one another even if one's value happens to be another's name.
- Substitution is purely textual (word-boundary find & replace), not scoped or hygienic — it does **not** know the difference between your placeholder and a real identifier that happens to have the same name. Pick distinctive const names to avoid accidental collisions with real code in `@Body`.
- `@Const` only affects `@Body` — it has no effect on `name`/`prefix`/`detail`/`scope`/`output`.

### `@Snippet`

| Key        | Required | Description                    |
| ---------- | -------- | ------------------------------ |
| `name`     | yes      | Snippet name/key               |
| `prefix`   | yes      | Trigger                        |
| `detail`   | no       | Description in autocomplete    |
| `template` | no       | `true`/`false` — file template |

### Quoting values

Any property value (and `@Const` value) may optionally be wrapped in double quotes, e.g. `name: "React Functional Component"`. The quotes are stripped by the parser. This is recommended for `name`/`detail` whenever the text contains a word that could be mistaken for a code keyword (`function`, `class`, `return`, etc.). Values without quotes keep working exactly as before.

### `@Body`

Content is copied literally (minimum common indentation stripped — counted in characters, so tabs and spaces both count as one unit each — then any `@Const` declared earlier in the file is substituted). Use standard VS Code placeholders (`$0`, `$1`, `${TM_FILENAME_BASE}`, etc).

### Comments

Lines starting with `#` are ignored in `@Header`/`@Snippet`. Inside `@Body` they are literal.

Multiple `@Snippet` blocks in one file share the header `scope` and any `@Const` declared before them.

## Editor support

For syntax highlighting, IntelliSense, and real-time diagnostics on `.vk`/`.viken` files in VS Code or Cursor, install the **Viken** extension from the marketplace (search for “Viken” or `@vikyn/viken`) — as of its own `0.3.0`, it uses this package directly (as a workspace dependency) to power error checking, and shares this exact column-0 rule. See its [changelog](../extension/README.md#changelog) for details.

## Testing

`packages/viken` has a `bun test` suite (`source/core/parser.test.ts`, `source/core/compiler.test.ts`) covering parsing basics, `@Const` (including a regression test for the single-pass, non-recursive substitution), the column-0 rule (directives inside `@Body` staying literal), tab indentation, the `__proto__`-as-snippet-name edge case, and `parseVikenCollectingErrors` (multiple errors in one file, best-effort partial results). Run it with:

```bash
bun test          # from packages/viken
bun run test      # from the repo root — runs it (and packages/extension's suite) via turbo
```

The CLI's file-system-touching behavior (path traversal, duplicate `output`, recursive directory search) still isn't unit-tested — that needs real I/O rather than pure-function tests. A good next addition.

## Changelog

### 0.3.0

- Fixed: `@Header`, `@Const`, and `@Snippet` are now only recognized as directives at column 0 (see [Column 0](#column-0-marco-zero) above). Previously, any of these appearing _indented_ — including inside a `@Body` — was still treated as a real directive, which could silently truncate or misparse a snippet whose body happened to contain one of these words at the start of an indented line (e.g., a code example showing Viken syntax).
- Fixed: `@Const` substitution now happens in a single pass over the body, matching what this README already claimed. `@Const foo = bar` + `@Const bar = baz` now correctly turns `foo` into `bar` (not `baz`) — the previous implementation ran one `.replace()` per const in sequence, so a later const's expansion could feed into an earlier one's output.
- Fixed: indentation stripped from `@Body` content is now counted in **characters**, matching what's actually removed. Previously a tab counted as 4 "columns" for the purpose of finding the minimum indentation, but the actual removal (`.slice()`) cuts characters — so a body indented purely with tabs could lose real content.
- Fixed: a snippet literally named `__proto__` no longer disappears from the compiled JSON. `compileToVSCodeSnippets` builds its result as a plain `{}`, and assigning to a `__proto__` key on a plain object reassigns the object's prototype instead of creating a normal property — so the snippet silently vanished from the output. Now uses a prototype-less object internally.
- Fixed: a `.vk`/`.viken` file that's empty (or only blank lines / `#` comments) no longer fails `viken compile` — it's skipped with a notice instead.
- Fixed: `viken --version` now reads from the package's own `package.json` at runtime instead of a hardcoded string that could drift out of sync on a future release.
- Changed: two files resolving to the same `output` is now an error, not a warning.
- Added: `isEmptyVikenSource(source)` — exported for anyone consuming `parseViken` directly.
- Added: `parseVikenCollectingErrors(source)` — a non-breaking, additive companion to `parseViken` that collects every problem in a file instead of throwing on the first one. `parseViken`'s own behavior is completely unchanged. See [Collecting every error at once](#collecting-every-error-at-once) above.
- Added: the package is now usable as a **library**, not just a CLI — exported from the package root (and from `./parser`, `./ast`, `./compiler` subpaths), with generated `.d.mts` files.
- Added: a `bun test` suite — see [Testing](#testing) above.

### 0.1.4

- Fixed: `viken compile <dir>` now searches directories **recursively** for `.vk`/`.viken` files instead of only the top level.
- Fixed: `output` (from `@Header`) is now resolved relative to the **project root** (where the command is run), not relative to the source file's own directory.
- Added: property values (`name`, `detail`, `prefix`, `scope`, `output`) can be wrapped in double quotes, avoiding future syntax-highlighting ambiguity when a value contains a word like `function`.
- Added: guard against `output` paths that resolve outside the project root.
- Improved: a parse/compile error in one file no longer aborts the whole batch — other files still compile, and the command exits with a non-zero status if any file failed.
- Improved: file extension matching (`.vk`/`.viken`) is now case-insensitive.

## License

MIT — see [LICENSE.md](../../LICENSE.md) at the repo root.
