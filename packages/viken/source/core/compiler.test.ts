import { describe, expect, test } from "bun:test"

import type { FileNode } from "./ast.js"
import { compileToVSCodeSnippets } from "./compiler.js"

function fileWithSnippetName(name: string): FileNode {
    return {
        type: "File",
        header: { type: "Header", scope: "typescript", output: "out.json" },
        snippets: [{ type: "Snippet", name, prefix: "x", body: ["body"] }]
    }
}

describe("compileToVSCodeSnippets", () => {
    test("compila um snippet simples", () => {
        const result = compileToVSCodeSnippets(fileWithSnippetName("Simple"))
        expect(result["Simple"]?.prefix).toBe("x")
        expect(result["Simple"]?.scope).toBe("typescript")
    })

    test("description só aparece quando detail foi passado", () => {
        const file: FileNode = {
            type: "File",
            header: { type: "Header", scope: "typescript", output: "out.json" },
            snippets: [{ type: "Snippet", name: "N", prefix: "n", body: ["x"] }]
        }
        const result = compileToVSCodeSnippets(file)
        expect(result["N"]?.description).toBeUndefined()
    })

    test("um snippet chamado '__proto__' vira uma chave normal, não some no JSON", () => {
        const result = compileToVSCodeSnippets(fileWithSnippetName("__proto__"))

        // Antes da correção (result = {}), isso mudava o PROTOTYPE do
        // objeto em vez de criar uma chave — a entrada nunca aparecia em
        // Object.keys()/JSON.stringify. Com Object.create(null), é uma
        // chave comum como qualquer outra.
        expect(Object.keys(result)).toContain("__proto__")
        expect(result["__proto__"]?.prefix).toBe("x")
        expect(JSON.parse(JSON.stringify(result))).toHaveProperty("__proto__")
    })

    test("snippets chamados 'constructor'/'toString' também funcionam normalmente", () => {
        const file: FileNode = {
            type: "File",
            header: { type: "Header", scope: "typescript", output: "out.json" },
            snippets: [
                { type: "Snippet", name: "constructor", prefix: "c", body: ["x"] },
                { type: "Snippet", name: "toString", prefix: "t", body: ["y"] }
            ]
        }
        const result = compileToVSCodeSnippets(file)
        expect(result["constructor"]?.prefix).toBe("c")
        expect(result["toString"]?.prefix).toBe("t")
    })
})
