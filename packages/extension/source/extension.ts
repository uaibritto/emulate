import { isEmptyVikenSource, parseVikenCollectingErrors } from "@vikyn/viken"
import * as vscode from "vscode"

import { SCOPE_FAMILY, tokenizeLine, type Token, type TokenizerState } from "./bodyTokenizer.js"

const DIRECTIVES = ["Header", "Snippet", "Body", "Const"] as const

/** Hover para as diretivas que não têm propriedades próprias (Body é um marcador; Const é documentado com sua sintaxe). */
const DIRECTIVE_DOCS: Partial<Record<(typeof DIRECTIVES)[number], string>> = {
    Body: "**@Body** — marca o início do corpo do snippet (código arbitrário, copiado literalmente no JSON gerado). Só é reconhecido dentro de um `@Snippet`, não é uma diretiva de marco zero como as outras três.",
    Const: "**@Const** `<nome> = <valor>` — macro de texto, de escopo global no arquivo. Todo uso de `<nome>` como palavra inteira dentro de um `@Body` declarado **depois** desta linha é substituído por `<valor>`. Não afeta `name`/`prefix`/`detail`/`scope`/`output`. Diretiva de marco zero: só é reconhecida sem NENHUMA indentação."
}

const HEADER_PROPERTIES: Record<string, string> = {
    scope: "Escopo de linguagem do VS Code onde o snippet fica disponível (ex: `typescript`, `typescriptreact`).",
    output: "Caminho do arquivo `.json` de snippets gerado pelo compilador, relativo à raiz do projeto (o diretório onde `viken compile` é executado) — não ao arquivo `.vk`."
}

const SNIPPET_PROPERTIES: Record<string, string> = {
    prefix: "Atalho digitado no editor para disparar o snippet.",
    name: 'Nome do snippet — vira a chave no JSON de snippets do VS Code. Pode vir entre aspas (ex: "React Functional Component").',
    detail: "Descrição exibida na lista de sugestões (mapeia para `description` no schema). Pode vir entre aspas.",
    template:
        "`true` | `false` — quando `true`, o snippet vira um template de arquivo (`isFileTemplate`)."
}

// Lista curada dos language ids mais comuns do VS Code para autocomplete de "scope:".
// Não é exaustiva de propósito — "scope" aceita qualquer language id válido,
// registrado pelo VS Code ou por outra extensão instalada.
const SCOPE_VALUES = [
    "typescript",
    "typescriptreact",
    "javascript",
    "javascriptreact",
    "tsrx",
    "vue",
    "svelte",
    "html",
    "json",
    "python",
    "kotlin",
    "swift",
    "rust",
    "go",
    "java",
    "c",
    "cpp",
    "csharp",
    "php",
    "ruby",
    "perl",
    "elixir",
    "lua",
    "dart",
    "scala",
    "objectivec",
    "shellscript",
    "bash",
    "sql"
] as const

const TEMPLATE_VALUES = ["true", "false"] as const

/**
 * "@Const nome = valor" — mesma regra usada pelo parser do compilador
 * (@vikyn/viken): SEM "\s*" antes do "@", de propósito. @Const é uma
 * diretiva de MARCO ZERO. As funções abaixo testam contra a linha com só
 * o lado DIREITO aparado (`trimEnd()`), nunca contra a linha totalmente
 * trimada — testar contra uma string já trimada pela esquerda anularia
 * o propósito do "^" aqui.
 */
const CONST_DIRECTIVE_RE = /^@Const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/
const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*/g

export type BlockKind = "none" | "header" | "snippet" | "body"

/**
 * Superfície mínima de `vscode.TextDocument` que a lógica abaixo
 * realmente usa. Extraída pra essas funções serem testáveis com
 * `bun:test` sem precisar do runtime real do VS Code (que não existe
 * fora de um host de extensão) — um `vscode.TextDocument` de verdade
 * satisfaz essa interface estruturalmente, então nada muda em produção,
 * e nos testes basta um objeto simples construído a partir de um array
 * de strings.
 */
export interface LineSource {
    readonly lineCount: number
    lineAt(line: number): { readonly text: string }
}

/** Constrói um LineSource de teste a partir de linhas de texto simples. */
export function lineSourceFromLines(lines: string[]): LineSource {
    return {
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] ?? "" })
    }
}

/**
 * Varre pra trás procurando o bloco de marco zero mais próximo.
 *
 * REGRA DA LINGUAGEM: @Header e @Snippet só contam como diretiva de
 * verdade na COLUNA 0 (sem nenhuma indentação) — daí `trimEnd()`, que
 * aceita espaço em branco à direita mas rejeita qualquer coisa à
 * esquerda. @Body é diferente: não é de marco zero, é sempre indentado
 * por convenção (fica dentro de um @Snippet), então usa `trim()`
 * (indentação irrelevante para reconhecê-lo).
 */
export function findEnclosingBlock(document: LineSource, fromLine: number): BlockKind {
    for (let i = fromLine; i >= 0; i--) {
        const text = document.lineAt(i).text
        if (text.trim() === "@Body") return "body"
        const trimmedEnd = text.trimEnd()
        if (trimmedEnd === "@Snippet") return "snippet"
        if (trimmedEnd === "@Header") return "header"
    }
    return "none"
}

function directiveCompletionItem(name: (typeof DIRECTIVES)[number]): vscode.CompletionItem {
    const item = new vscode.CompletionItem(`@${name}`, vscode.CompletionItemKind.Keyword)
    item.insertText = name === "Const" ? new vscode.SnippetString("Const ${1:name} = $0") : name
    item.detail = `Diretiva @${name}`
    item.sortText = `0-${name}`
    return item
}

/** Verifica se o arquivo já tem um @Header de marco zero — só pode existir um por arquivo. */
export function hasHeaderDirective(document: LineSource): boolean {
    for (let i = 0; i < document.lineCount; i++) {
        if (document.lineAt(i).text.trimEnd() === "@Header") return true
    }
    return false
}

/**
 * Diretivas de topo (@Header/@Snippet/@Const) sugeridas quando o "@" é
 * digitado sem NENHUMA indentação — o único jeito de essas três serem
 * reconhecidas pelo compilador de verdade. @Header desaparece se o
 * arquivo já tiver um.
 */
function topLevelDirectiveCompletions(document: LineSource): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = []
    if (!hasHeaderDirective(document)) items.push(directiveCompletionItem("Header"))
    items.push(directiveCompletionItem("Snippet"))
    items.push(directiveCompletionItem("Const"))
    return items
}

function propertyCompletionItems(properties: Record<string, string>): vscode.CompletionItem[] {
    return Object.entries(properties).map(([key, doc]) => {
        const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property)
        item.documentation = new vscode.MarkdownString(doc)
        return item
    })
}

function enumValueCompletionItems(values: readonly string[]): vscode.CompletionItem[] {
    return values.map((v) => new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember))
}

/** Lê o valor de "scope:" declarado no (único) @Header do arquivo. */
export function findHeaderScope(document: LineSource): string | undefined {
    let insideHeader = false
    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text
        const trimmedEnd = text.trimEnd()
        if (trimmedEnd === "@Header") {
            insideHeader = true
            continue
        }
        if (trimmedEnd === "@Snippet") break
        if (insideHeader) {
            const match = /^scope\s*:\s*(.+)$/.exec(text.trim())
            if (match) return match[1]?.trim()
        }
    }
    return undefined
}

/**
 * Procura uma declaração "@Const <word> = <valor>" em qualquer lugar do
 * arquivo (consts são globais, não têm um "bloco" que as delimite) e
 * retorna o valor bruto (ainda com aspas, se houver — é só para exibição
 * no hover).
 */
export function findConstDeclaration(document: LineSource, word: string): string | undefined {
    for (let i = 0; i < document.lineCount; i++) {
        const match = CONST_DIRECTIVE_RE.exec(document.lineAt(i).text.trimEnd())
        if (match && match[1] === word) return match[2]?.trim()
    }
    return undefined
}

/** Coleta os nomes de todo @Const declarado no arquivo (para o highlight de uso em @Body). */
export function collectConstNames(document: LineSource): Set<string> {
    const names = new Set<string>()
    for (let i = 0; i < document.lineCount; i++) {
        const match = CONST_DIRECTIVE_RE.exec(document.lineAt(i).text.trimEnd())
        if (match?.[1]) names.add(match[1])
    }
    return names
}

/**
 * Encontra os intervalos de linha [inicio, fim] de cada bloco @Body do
 * arquivo. O fim de um corpo é sempre uma diretiva de marco zero
 * (@Header, @Snippet ou @Const).
 */
export function findBodyRanges(document: LineSource): Array<[number, number]> {
    const ranges: Array<[number, number]> = []
    let bodyStart: number | null = null

    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text
        if (text.trim() === "@Body") {
            bodyStart = i + 1
            continue
        }
        const trimmedEnd = text.trimEnd()
        const isTopLevelDirective =
            trimmedEnd === "@Snippet" ||
            trimmedEnd === "@Header" ||
            CONST_DIRECTIVE_RE.test(trimmedEnd)
        if (isTopLevelDirective && bodyStart !== null) {
            ranges.push([bodyStart, i - 1])
            bodyStart = null
        }
    }
    if (bodyStart !== null) {
        ranges.push([bodyStart, document.lineCount - 1])
    }
    return ranges
}

/** Todas as ocorrências, por palavra inteira, de qualquer nome em `constNames` na linha. */
export function findConstUsages(
    line: string,
    constNames: ReadonlySet<string>
): Array<{ start: number; length: number }> {
    const usages: Array<{ start: number; length: number }> = []
    IDENTIFIER_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = IDENTIFIER_RE.exec(line))) {
        if (constNames.has(match[0])) usages.push({ start: match.index, length: match[0].length })
    }
    return usages
}

export function rangesOverlap(
    aStart: number,
    aLength: number,
    bStart: number,
    bLength: number
): boolean {
    return aStart < bStart + bLength && bStart < aStart + aLength
}

const SEMANTIC_TOKEN_TYPES = ["comment", "string", "number", "keyword", "macro"] as const
const semanticTokensLegend = new vscode.SemanticTokensLegend([...SEMANTIC_TOKEN_TYPES])

const semanticTokensProvider: vscode.DocumentSemanticTokensProvider = {
    provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend)

        const scope = findHeaderScope(document)
        const family = scope ? SCOPE_FAMILY[scope] : undefined
        const constNames = collectConstNames(document)

        for (const [start, end] of findBodyRanges(document)) {
            let state: TokenizerState = { openDelimiter: null, inBlockComment: false }

            for (let line = start; line <= end && line < document.lineCount; line++) {
                const text = document.lineAt(line).text
                let familyTokens: Token[] = []

                if (family) {
                    const result = tokenizeLine(text, family, state)
                    state = result.state
                    familyTokens = result.tokens
                    for (const token of familyTokens) {
                        builder.push(
                            line,
                            token.start,
                            token.length,
                            SEMANTIC_TOKEN_TYPES.indexOf(token.type)
                        )
                    }
                }

                if (constNames.size > 0) {
                    for (const usage of findConstUsages(text, constNames)) {
                        const overlapping = familyTokens.some((t) =>
                            rangesOverlap(usage.start, usage.length, t.start, t.length)
                        )
                        if (!overlapping) {
                            builder.push(
                                line,
                                usage.start,
                                usage.length,
                                SEMANTIC_TOKEN_TYPES.indexOf("macro")
                            )
                        }
                    }
                }
            }
        }

        return builder.build()
    }
}

/**
 * Extrai, de uma mensagem de erro do parser ("... na linha N: ..."), o
 * número de linha (0-based, e limitado ao tamanho real do documento).
 * Mensagens sem número de linha (ex: "Arquivo sem @Header") caem na
 * linha 0.
 */
export function lineNumberFromParseMessage(message: string, lineCount: number): number {
    const lineMatch = /\slinha (\d+)/.exec(message)
    const lineNumber = lineMatch?.[1] ? Math.max(0, Number(lineMatch[1]) - 1) : 0
    return Math.min(lineNumber, Math.max(lineCount - 1, 0))
}

/**
 * Diagnostics via o parser REAL do compilador, em modo de COLETA
 * (`parseVikenCollectingErrors`, disponível desde @vikyn/viken 0.3.0) —
 * mostra TODOS os problemas do arquivo de uma vez, não só o primeiro.
 */
const diagnosticCollection = vscode.languages.createDiagnosticCollection("viken")

function updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId !== "viken") return

    const text = document.getText()

    // Arquivo vazio (ou só comentários) não é um erro — é normal ter um
    // .vk em branco recém-criado, ou um placeholder.
    if (isEmptyVikenSource(text)) {
        diagnosticCollection.set(document.uri, [])
        return
    }

    const { errors } = parseVikenCollectingErrors(text)
    const diagnostics = errors.map((issue) => {
        const line = lineNumberFromParseMessage(issue.message, document.lineCount)
        return new vscode.Diagnostic(
            document.lineAt(line).range,
            issue.message,
            vscode.DiagnosticSeverity.Error
        )
    })
    diagnosticCollection.set(document.uri, diagnostics)
}

export function activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = { language: "viken" }

    const completionProvider = vscode.languages.registerCompletionItemProvider(
        selector,
        {
            provideCompletionItems(document, position) {
                const lineText = document.lineAt(position.line).text
                const beforeCursor = lineText.slice(0, position.character)
                const trimmedBefore = beforeCursor.trim()

                if (trimmedBefore === "@") {
                    if (beforeCursor === "@") {
                        return topLevelDirectiveCompletions(document)
                    }
                    const block = findEnclosingBlock(document, position.line - 1)
                    return block === "snippet" ? [directiveCompletionItem("Body")] : []
                }

                if (/^\s*scope\s*:\s*\S*$/.test(beforeCursor)) {
                    return enumValueCompletionItems(SCOPE_VALUES)
                }
                if (/^\s*template\s*:\s*\S*$/.test(beforeCursor)) {
                    return enumValueCompletionItems(TEMPLATE_VALUES)
                }

                if (beforeCursor.includes(":")) {
                    return undefined
                }

                if (trimmedBefore === "") {
                    const block = findEnclosingBlock(document, position.line - 1)
                    if (block === "header") return propertyCompletionItems(HEADER_PROPERTIES)
                    if (block === "snippet") return propertyCompletionItems(SNIPPET_PROPERTIES)
                }

                return undefined
            }
        },
        "@",
        ":"
    )

    const hoverProvider = vscode.languages.registerHoverProvider(selector, {
        provideHover(document, position) {
            const range = document.getWordRangeAtPosition(position, /[@A-Za-z_][A-Za-z0-9_]*/)
            if (!range) return undefined

            const word = document.getText(range)

            if (word.startsWith("@")) {
                const name = word.slice(1)
                if ((DIRECTIVES as readonly string[]).includes(name)) {
                    const doc = DIRECTIVE_DOCS[name as (typeof DIRECTIVES)[number]]
                    return new vscode.Hover(
                        new vscode.MarkdownString(doc ?? `**@${name}** — diretiva Viken.`)
                    )
                }
                return undefined
            }

            const block = findEnclosingBlock(document, position.line)
            const propertyDoc =
                block === "header"
                    ? HEADER_PROPERTIES[word]
                    : block === "snippet"
                      ? SNIPPET_PROPERTIES[word]
                      : undefined
            if (propertyDoc) return new vscode.Hover(new vscode.MarkdownString(propertyDoc))

            const constValue = findConstDeclaration(document, word)
            if (constValue !== undefined) {
                return new vscode.Hover(
                    new vscode.MarkdownString(
                        `**@Const** \`${word}\` → \`${constValue || "(vazio)"}\``
                    )
                )
            }

            return undefined
        }
    })

    context.subscriptions.push(completionProvider, hoverProvider, diagnosticCollection)

    const semanticProvider = vscode.languages.registerDocumentSemanticTokensProvider(
        selector,
        semanticTokensProvider,
        semanticTokensLegend
    )
    context.subscriptions.push(semanticProvider)

    vscode.workspace.onDidOpenTextDocument(updateDiagnostics, null, context.subscriptions)
    vscode.workspace.onDidChangeTextDocument(
        (e) => updateDiagnostics(e.document),
        null,
        context.subscriptions
    )
    vscode.workspace.onDidCloseTextDocument(
        (doc) => diagnosticCollection.delete(doc.uri),
        null,
        context.subscriptions
    )
    for (const editor of vscode.window.visibleTextEditors) {
        updateDiagnostics(editor.document)
    }
}

export function deactivate(): void {}
