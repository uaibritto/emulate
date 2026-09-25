import { describe, expect, test } from "bun:test"

import { isEmptyVikenSource, parseViken, parseVikenCollectingErrors } from "./parser.js"

function minimal(extra = ""): string {
    return `@Header\n    scope: typescript\n    output: out.json\n${extra}`
}

describe("parseViken — básico", () => {
    test("um @Header sem @Snippet nenhum é válido", () => {
        const ast = parseViken(minimal())
        expect(ast.header.scope).toBe("typescript")
        expect(ast.header.output).toBe("out.json")
        expect(ast.snippets).toHaveLength(0)
    })

    test("múltiplos @Snippet no mesmo arquivo", () => {
        const source = minimal(`
@Snippet
    name: "A"
    prefix: a
    @Body
        console.log("a")

@Snippet
    name: "B"
    prefix: b
    @Body
        console.log("b")
`)
        const ast = parseViken(source)
        expect(ast.snippets).toHaveLength(2)
        expect(ast.snippets[0]?.name).toBe("A")
        expect(ast.snippets[1]?.name).toBe("B")
    })

    test("valores entre aspas têm as aspas removidas", () => {
        const source = minimal(`
@Snippet
    name: "React Functional Component"
    prefix: rfc
    detail: "Create Functional Component"
    @Body
        x
`)
        const ast = parseViken(source)
        expect(ast.snippets[0]?.name).toBe("React Functional Component")
        expect(ast.snippets[0]?.detail).toBe("Create Functional Component")
    })
})

describe("parseViken — erros esperados", () => {
    test("arquivo sem @Header falha", () => {
        expect(() => parseViken("")).toThrow("Arquivo sem @Header")
    })

    test("@Header sem scope falha", () => {
        expect(() => parseViken("@Header\n    output: out.json")).toThrow("scope")
    })

    test("@Header sem output falha", () => {
        expect(() => parseViken("@Header\n    scope: typescript")).toThrow("output")
    })

    test("@Header duplicado falha", () => {
        expect(() => parseViken(minimal() + "\n@Header\n    scope: x\n    output: y")).toThrow(
            "Header duplicado"
        )
    })

    test("nomes de snippet duplicados falham", () => {
        const source = minimal(`
@Snippet
    name: "Dup"
    prefix: a
    @Body
        x

@Snippet
    name: "Dup"
    prefix: b
    @Body
        y
`)
        expect(() => parseViken(source)).toThrow("duplicado")
    })
})

describe("parseViken — @Const", () => {
    test("substitui o nome por palavra inteira no @Body", () => {
        const source = minimal(`
@Const fileNameBase = MyComponent

@Snippet
    name: "X"
    prefix: x
    @Body
        function fileNameBase() {}
`)
        const ast = parseViken(source)
        expect(ast.snippets[0]?.body.join("\n")).toContain("function MyComponent() {}")
    })

    test("NÃO expande recursivamente (bug regressivo)", () => {
        const source = minimal(`
@Const foo = bar
@Const bar = baz

@Snippet
    name: "X"
    prefix: x
    @Body
        foo
`)
        const ast = parseViken(source)
        expect(ast.snippets[0]?.body).toEqual(["bar"])
    })

    test("const duplicado falha", () => {
        expect(() => parseViken(minimal("@Const x = 1\n@Const x = 2\n"))).toThrow("Const duplicado")
    })
})

describe("parseViken — @Body é literal (marco zero)", () => {
    test("@Snippet indentado dentro de @Body é texto literal, não uma nova diretiva", () => {
        const source = minimal(`
@Snippet
    name: "Outer"
    prefix: outer
    @Body
        def something():
            @Snippet
                # ainda é código, não Viken
`)
        const ast = parseViken(source)
        expect(ast.snippets).toHaveLength(1)
        expect(ast.snippets[0]?.body.join("\n")).toContain("@Snippet")
    })

    test("@Header indentado dentro de @Body não dispara 'Header duplicado'", () => {
        const source = minimal(`
@Snippet
    name: "Outer"
    prefix: outer
    @Body
        @Component({ selector: "app-example" })
        @Header
`)
        expect(() => parseViken(source)).not.toThrow()
    })

    test("@Const indentado dentro de @Body é literal, não uma declaração real", () => {
        const source = minimal(`
@Snippet
    name: "Outer"
    prefix: outer
    @Body
        @Const foo = bar
`)
        const ast = parseViken(source)
        expect(ast.snippets[0]?.body).toEqual(["@Const foo = bar"])
    })

    test("@Snippet na coluna 0 encerra o @Body anterior de verdade", () => {
        const source = minimal(`
@Snippet
    name: "First"
    prefix: first
    @Body
        const x = 1

@Snippet
    name: "Second"
    prefix: second
    @Body
        const y = 2
`)
        const ast = parseViken(source)
        expect(ast.snippets).toHaveLength(2)
        expect(ast.snippets[0]?.body).toEqual(["const x = 1"])
        expect(ast.snippets[1]?.body).toEqual(["const y = 2"])
    })
})

describe("parseViken — indentação", () => {
    test("corpo indentado só com tabs não perde conteúdo", () => {
        // "\t\tdef foo():"  -> indent 2 (2 tabs)
        // "\t\t\tpass"      -> indent 3 (3 tabs)
        // minIndent = 2 -> remove 2 CARACTERES de cada linha:
        //   "\t\tdef foo():".slice(2)  -> "def foo():"   (os 2 tabs somem inteiros)
        //   "\t\t\tpass".slice(2)      -> "\tpass"        (sobra 1 dos 3 tabs)
        const source = `@Header\n    scope: python\n    output: out.json\n\n@Snippet\n    name: "T"\n    prefix: t\n    @Body\n\t\tdef foo():\n\t\t\tpass\n`
        const ast = parseViken(source)
        expect(ast.snippets[0]?.body).toEqual(["def foo():", "\tpass"])
    })

    test("indentação mista (espaços no corpo, tabs na diretiva) não corrompe", () => {
        const source = `@Header\n\tscope: python\n\toutput: out.json\n\n@Snippet\n\tname: "T"\n\tprefix: t\n\t@Body\n\t\tdef foo():\n\t\t    pass\n`
        expect(() => parseViken(source)).not.toThrow()
    })
})

describe("isEmptyVikenSource", () => {
    test("string vazia é vazia", () => {
        expect(isEmptyVikenSource("")).toBe(true)
    })

    test("só linhas em branco é vazio", () => {
        expect(isEmptyVikenSource("\n\n   \n")).toBe(true)
    })

    test("só comentários é vazio", () => {
        expect(isEmptyVikenSource("# um comentário\n# outro\n")).toBe(true)
    })

    test("com @Header não é vazio", () => {
        expect(isEmptyVikenSource(minimal())).toBe(false)
    })

    test("uma diretiva mal escrita não conta como vazio (não deve mascarar erro de digitação)", () => {
        expect(isEmptyVikenSource("@Heder\n    scope: x\n")).toBe(false)
    })
})

describe("parseVikenCollectingErrors", () => {
    test("sem erros, devolve o mesmo resultado que parseViken (via file)", () => {
        const source = minimal(`
@Snippet
    name: "A"
    prefix: a
    @Body
        x
`)
        const { file, errors } = parseVikenCollectingErrors(source)
        expect(errors).toHaveLength(0)
        expect(file?.snippets).toHaveLength(1)
        expect(file?.snippets[0]?.name).toBe("A")
    })

    test("coleta MAIS DE UM erro no mesmo arquivo, em vez de parar no primeiro", () => {
        const source = minimal(`
@Snippet
    prefix: a
    @Body
        x

@Snippet
    name: "OnlyName"
    @Body
        y
`)
        // primeiro snippet: sem 'name'. segundo: sem 'prefix'. As DUAS
        // falhas devem aparecer — é exatamente o que parseViken (lança no
        // primeiro) não consegue fazer.
        const { file, errors } = parseVikenCollectingErrors(source)
        expect(errors.length).toBeGreaterThanOrEqual(2)
        expect(errors.some((e) => e.message.includes("sem 'name'"))).toBe(true)
        expect(errors.some((e) => e.message.includes("sem 'prefix'"))).toBe(true)
        // nenhum dos dois snippets problemáticos entra no resultado
        expect(file?.snippets).toHaveLength(0)
    })

    test("arquivo sem @Header: file é null e o erro aparece em errors", () => {
        const { file, errors } = parseVikenCollectingErrors("")
        expect(file).toBeNull()
        expect(errors.some((e) => e.message === "Arquivo sem @Header")).toBe(true)
    })

    test("@Header duplicado: primeiro header prevalece, segundo é descartado sem sujar o resultado", () => {
        const source = `${minimal()}\n@Header\n    scope: outraLinguagem\n    output: outro.json\n`
        const { file, errors } = parseVikenCollectingErrors(source)
        expect(errors.some((e) => e.message.includes("Header duplicado"))).toBe(true)
        expect(file?.header.scope).toBe("typescript") // o PRIMEIRO header, não o segundo
    })

    test("nome de snippet duplicado: erro coletado, só o primeiro fica no resultado", () => {
        const source = minimal(`
@Snippet
    name: "Dup"
    prefix: a
    @Body
        x

@Snippet
    name: "Dup"
    prefix: b
    @Body
        y
`)
        const { file, errors } = parseVikenCollectingErrors(source)
        expect(errors.some((e) => e.message.includes("duplicado"))).toBe(true)
        expect(file?.snippets).toHaveLength(1)
        expect(file?.snippets[0]?.prefix).toBe("a")
    })

    test("continua respeitando a regra de marco zero (diretiva indentada em @Body é literal)", () => {
        const source = minimal(`
@Snippet
    name: "Outer"
    prefix: outer
    @Body
        @Snippet
`)
        const { file, errors } = parseVikenCollectingErrors(source)
        expect(errors).toHaveLength(0)
        expect(file?.snippets[0]?.body).toEqual(["@Snippet"])
    })
})
