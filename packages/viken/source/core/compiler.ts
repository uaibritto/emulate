import type { FileNode } from "./ast.js"

export interface VSCodeSnippet {
    prefix: string
    description?: string // agora é opcional
    body: string[]
    scope?: string
    isFileTemplate?: boolean
}

export type VSCodeSnippetsFile = Record<string, VSCodeSnippet>

export function compileToVSCodeSnippets(file: FileNode): VSCodeSnippetsFile {
    // `name` vem do usuário (do .vk) e vira uma chave de objeto direto.
    // Um objeto literal `{}` herda `Object.prototype`, então um snippet
    // chamado exatamente "__proto__" não criaria uma propriedade normal —
    // acionaria o setter especial de __proto__, trocando o PROTÓTIPO do
    // objeto `result` em vez de virar uma chave, e o snippet sumiria
    // silenciosamente do JSON gerado (JSON.stringify não serializa o
    // prototype). `Object.create(null)` cria um objeto sem prototype
    // nenhum, então "__proto__"/"constructor"/"toString" se comportam
    // como qualquer outra chave normal.
    const result = Object.create(null) as VSCodeSnippetsFile
    const scope = file.header.scope // cada snippet herda o scope do Header

    for (const snippet of file.snippets) {
        const name = snippet.name
        const body = snippet.body.length > 0 ? snippet.body : [""]
        const prefix = snippet.prefix

        const entry: VSCodeSnippet = {
            scope,
            prefix,
            body
        }

        // Só define description se detail tiver sido passado
        if (snippet.detail !== undefined) {
            entry.description = snippet.detail
        }

        if (snippet.template === true) {
            entry.isFileTemplate = true
        }

        result[name] = entry
    }

    return result
}
