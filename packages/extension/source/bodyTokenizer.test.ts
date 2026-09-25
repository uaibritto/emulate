import { describe, expect, test } from "bun:test"

import { SCOPE_FAMILY, tokenizeLine, type TokenizerState } from "./bodyTokenizer.js"

const INITIAL: TokenizerState = { openDelimiter: null, inBlockComment: false }

describe("tokenizeLine — keywords/strings/números (linha única)", () => {
    test("reconhece keyword do C-like", () => {
        const { tokens } = tokenizeLine("function foo() {}", SCOPE_FAMILY.typescript!, INITIAL)
        expect(tokens.find((t) => t.type === "keyword")?.start).toBe(0)
    })

    test("string de aspas simples/duplas fecha na mesma linha", () => {
        const { tokens } = tokenizeLine('const x = "hi"', SCOPE_FAMILY.typescript!, INITIAL)
        const stringToken = tokens.find((t) => t.type === "string")
        expect(stringToken).toBeDefined()
        expect(stringToken?.length).toBe(4) // "hi" com as aspas
    })

    test("comentário de linha vai até o fim", () => {
        const line = "const x = 1 // comentário"
        const { tokens } = tokenizeLine(line, SCOPE_FAMILY.typescript!, INITIAL)
        const comment = tokens.find((t) => t.type === "comment")
        expect(comment?.start).toBe(line.indexOf("//"))
        expect(comment && comment.start + comment.length).toBe(line.length)
    })

    test("placeholder do VS Code ($0, ${1:label}) não vira número nem keyword", () => {
        const { tokens } = tokenizeLine("return ${1:value}", SCOPE_FAMILY.typescript!, INITIAL)
        expect(tokens.some((t) => t.type === "number")).toBe(false)
    })
})

describe("tokenizeLine — comentário de bloco /* ... */", () => {
    test("abre e fecha na mesma linha", () => {
        const { tokens, state } = tokenizeLine(
            "const x = /* nota */ 1",
            SCOPE_FAMILY.typescript!,
            INITIAL
        )
        const comment = tokens.find((t) => t.type === "comment")
        expect(comment?.start).toBe(10)
        expect(comment?.length).toBe(11) // "/* nota */"
        expect(state.inBlockComment).toBe(false)
    })

    test("abre e NÃO fecha: estado continua aberto pra próxima linha", () => {
        const { tokens, state } = tokenizeLine(
            "/* começo do comentário",
            SCOPE_FAMILY.typescript!,
            INITIAL
        )
        expect(tokens).toEqual([{ start: 0, length: 24, type: "comment" }])
        expect(state.inBlockComment).toBe(true)
    })

    test("continua de um estado aberto e fecha no meio da linha", () => {
        const { tokens, state } = tokenizeLine(
            "ainda comentário */ const x = 1",
            SCOPE_FAMILY.typescript!,
            { openDelimiter: null, inBlockComment: true }
        )
        const comment = tokens[0]
        expect(comment?.type).toBe("comment")
        expect(comment?.start).toBe(0)
        expect(comment?.length).toBe(19) // "ainda comentário */"
        expect(state.inBlockComment).toBe(false)
        // depois do fechamento, o resto da linha volta a ser tokenizado normalmente
        expect(tokens.some((t) => t.type === "keyword")).toBe(true)
    })

    test("SQL também reconhece /* ... */", () => {
        const { state } = tokenizeLine("/* nota SQL", SCOPE_FAMILY.sql!, INITIAL)
        expect(state.inBlockComment).toBe(true)
    })

    test("Lua usa --[[ ... ]] (delimitadores diferentes de C-like)", () => {
        const { tokens, state } = tokenizeLine("--[[ comentário Lua", SCOPE_FAMILY.lua!, INITIAL)
        expect(tokens[0]?.type).toBe("comment")
        expect(state.inBlockComment).toBe(true)
    })

    test("família sem blockComment (ex: shellscript) ignora e cai no comportamento normal", () => {
        const { tokens } = tokenizeLine("echo hi # comentário", SCOPE_FAMILY.shellscript!, INITIAL)
        expect(tokens.some((t) => t.type === "comment")).toBe(true)
    })
})

describe("tokenizeLine — strings multi-linha", () => {
    test("template literal (crase) não fechado mantém estado entre chamadas", () => {
        const first = tokenizeLine("const x = `linha 1", SCOPE_FAMILY.typescript!, INITIAL)
        expect(first.state.openDelimiter).toBe("`")

        const second = tokenizeLine(
            "ainda dentro da string`",
            SCOPE_FAMILY.typescript!,
            first.state
        )
        expect(second.tokens[0]?.type).toBe("string")
        expect(second.state.openDelimiter).toBeNull()
    })

    test("docstring triplo do Python abrange várias linhas", () => {
        const first = tokenizeLine('"""docstring', SCOPE_FAMILY.python!, INITIAL)
        expect(first.state.openDelimiter).toBe('"""')

        const second = tokenizeLine("ainda dentro", SCOPE_FAMILY.python!, first.state)
        expect(second.state.openDelimiter).toBe('"""')

        const third = tokenizeLine('fim"""', SCOPE_FAMILY.python!, second.state)
        expect(third.tokens[0]?.type).toBe("string")
        expect(third.state.openDelimiter).toBeNull()
    })

    test("Ruby (mesma família hash do Python) NÃO trata aspas triplas como multi-linha", () => {
        // Ruby/Perl compartilham HASH_FAMILY, que não tem multilineStringDelimiters —
        // Python tem sua própria família derivada justamente para não vazar isso pra cá.
        const { state } = tokenizeLine('"""docstring', SCOPE_FAMILY.ruby!, INITIAL)
        expect(state.openDelimiter).toBeNull()
    })
})

describe("tokenizeLine — estado inicial padrão", () => {
    test("funciona sem passar state (usa o default)", () => {
        const { tokens } = tokenizeLine("const x = 1", SCOPE_FAMILY.typescript!)
        expect(tokens.some((t) => t.type === "keyword")).toBe(true)
    })
})
