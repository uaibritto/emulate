//
// Testa a lógica pura por trás de completions/hover/semantic tokens sem
// precisar do runtime real do VS Code (que não existe fora de um host de
// extensão — "vscode" não é um pacote npm instalável). As funções abaixo
// recebem `LineSource`, uma interface mínima que qualquer
// vscode.TextDocument satisfaz estruturalmente, então o comportamento em
// produção é idêntico; aqui construímos um LineSource de teste a partir
// de um array de strings.

import { describe, expect, test } from "bun:test"

import {
    collectConstNames,
    findBodyRanges,
    findConstDeclaration,
    findConstUsages,
    findEnclosingBlock,
    findHeaderScope,
    hasHeaderDirective,
    lineNumberFromParseMessage,
    lineSourceFromLines,
    rangesOverlap
} from "./extension.js"

const SAMPLE = [
    "@Header", // 0
    "    scope: typescript", // 1
    "    output: out.json", // 2
    "", // 3
    "@Const fileNameBase = MyComponent", // 4
    "", // 5
    "@Snippet", // 6
    '    name: "A"', // 7
    "    prefix: a", // 8
    "    @Body", // 9
    "        function fileNameBase() {}", // 10
    "        @Component({ selector: 'x' })" // 11 — indentado, é código, não Viken
]

describe("hasHeaderDirective (marco zero)", () => {
    test("reconhece @Header na coluna 0", () => {
        expect(hasHeaderDirective(lineSourceFromLines(SAMPLE))).toBe(true)
    })

    test("NÃO reconhece @Header indentado (dentro de um @Body, por exemplo)", () => {
        const lines = ["@Snippet", "    prefix: x", "    @Body", "        @Header"]
        expect(hasHeaderDirective(lineSourceFromLines(lines))).toBe(false)
    })
})

describe("findEnclosingBlock (marco zero)", () => {
    test("dentro das propriedades do @Snippet -> 'snippet'", () => {
        const block = findEnclosingBlock(lineSourceFromLines(SAMPLE), 8)
        expect(block).toBe("snippet")
    })

    test("dentro do @Body -> 'body'", () => {
        const block = findEnclosingBlock(lineSourceFromLines(SAMPLE), 10)
        expect(block).toBe("body")
    })

    test("dentro do @Header -> 'header'", () => {
        const block = findEnclosingBlock(lineSourceFromLines(SAMPLE), 1)
        expect(block).toBe("header")
    })

    test("um @Snippet indentado dentro de @Body não é confundido com o bloco real", () => {
        const lines = [
            "@Snippet",
            "    prefix: x",
            "    @Body",
            "        def f():",
            "            @Snippet", // indentado — é código, não deveria contar
            "                pass"
        ]
        // A posição está DENTRO do body; o @Snippet indentado na linha 4 não deve mudar isso.
        expect(findEnclosingBlock(lineSourceFromLines(lines), 5)).toBe("body")
    })
})

describe("findHeaderScope", () => {
    test("lê o scope declarado no @Header", () => {
        expect(findHeaderScope(lineSourceFromLines(SAMPLE))).toBe("typescript")
    })

    test("undefined se não houver @Header", () => {
        expect(findHeaderScope(lineSourceFromLines(["@Snippet", "    prefix: x"]))).toBeUndefined()
    })
})

describe("findConstDeclaration / collectConstNames", () => {
    test("encontra o valor de um @Const pelo nome", () => {
        expect(findConstDeclaration(lineSourceFromLines(SAMPLE), "fileNameBase")).toBe(
            "MyComponent"
        )
    })

    test("collectConstNames pega todos os nomes declarados", () => {
        const names = collectConstNames(lineSourceFromLines(SAMPLE))
        expect(names.has("fileNameBase")).toBe(true)
        expect(names.size).toBe(1)
    })

    test("um @Const indentado dentro de @Body não conta como declaração real", () => {
        const lines = ["@Snippet", "    prefix: x", "    @Body", "        @Const foo = bar"]
        expect(collectConstNames(lineSourceFromLines(lines)).size).toBe(0)
    })
})

describe("findBodyRanges", () => {
    test("identifica o intervalo do corpo, terminando no próximo @Snippet/@Header/@Const", () => {
        const ranges = findBodyRanges(lineSourceFromLines(SAMPLE))
        expect(ranges).toEqual([[10, 11]])
    })

    test("um @Const logo depois de um @Body encerra o corpo (bug regressivo)", () => {
        const lines = [
            "@Header",
            "    scope: typescript",
            "    output: out.json",
            "@Snippet",
            "    prefix: x",
            "    @Body",
            "        const a = 1",
            "@Const foo = bar"
        ]
        const ranges = findBodyRanges(lineSourceFromLines(lines))
        expect(ranges).toEqual([[6, 6]])
    })
})

describe("findConstUsages", () => {
    test("acha todas as ocorrências por palavra inteira", () => {
        const usages = findConstUsages(
            "function fileNameBase() { return fileNameBase }",
            new Set(["fileNameBase"])
        )
        expect(usages).toHaveLength(2)
    })

    test("não casa um nome que é apenas substring de outra palavra", () => {
        const usages = findConstUsages("fileNameBaseExtra", new Set(["fileNameBase"]))
        expect(usages).toHaveLength(0)
    })
})

describe("rangesOverlap", () => {
    test("intervalos que se sobrepõem", () => {
        expect(rangesOverlap(0, 5, 3, 5)).toBe(true)
    })

    test("intervalos adjacentes (não se sobrepõem)", () => {
        expect(rangesOverlap(0, 5, 5, 5)).toBe(false)
    })
})

describe("lineNumberFromParseMessage", () => {
    test("extrai o número da linha (0-based) de uma mensagem do parser", () => {
        expect(lineNumberFromParseMessage("Header duplicado na linha 5", 10)).toBe(4)
    })

    test("mensagem sem número de linha cai na linha 0", () => {
        expect(lineNumberFromParseMessage("Arquivo sem @Header", 10)).toBe(0)
    })

    test("nunca excede o tamanho real do documento", () => {
        expect(lineNumberFromParseMessage("algo na linha 999", 3)).toBe(2)
    })
})
