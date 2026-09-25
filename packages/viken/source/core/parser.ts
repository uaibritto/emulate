import type { FileNode, HeaderNode, SnippetNode } from "./ast.js"

type ParserState = "none" | "header" | "snippet-props" | "snippet-body"

/**
 * Conta caracteres de indentação (espaço OU tab, cada um contando como 1).
 * Ver normalizeBody() — a remoção usa `.slice()`, que corta caracteres,
 * não colunas visuais, então a contagem precisa ser em caracteres também.
 */
function countIndent(line: string): number {
    let count = 0
    for (const ch of line) {
        if (ch === " " || ch === "\t") {
            count++
        } else {
            break
        }
    }
    return count
}

/**
 * Comentários no Viken só existem como LINHA INTEIRA começando com "#",
 * e só são reconhecidos em @Header/@Snippet (propriedades). Dentro de
 * @Body o conteúdo é código arbitrário do usuário e nunca é tocado.
 */
function isCommentLine(trimmed: string): boolean {
    return trimmed.startsWith("#")
}

/**
 * Verdadeiro se o conteúdo não tem NADA que o parser reconheceria como
 * início de alguma diretiva — só linhas em branco e/ou comentários. Ver
 * uso em cli/index.ts e no diagnostics da extensão.
 */
export function isEmptyVikenSource(source: string): boolean {
    return source.split(/\r?\n/).every((line) => {
        const trimmed = line.trim()
        return trimmed === "" || isCommentLine(trimmed)
    })
}

/**
 * Remove linhas em branco do início/fim do corpo (sobra de formatação),
 * mas PRESERVA linhas em branco internas, que fazem parte da formatação
 * intencional do snippet. Depois, remove a indentação mínima comum.
 */
function normalizeBody(bodyLines: string[]): string[] {
    let start = 0
    let end = bodyLines.length

    while (start < end && (bodyLines[start] ?? "").trim() === "") start++
    while (end > start && (bodyLines[end - 1] ?? "").trim() === "") end--

    const trimmedEdges = bodyLines.slice(start, end)
    const nonEmpty = trimmedEdges.filter((l) => l.trim().length > 0)
    if (nonEmpty.length === 0) return []

    const minIndent = Math.min(...nonEmpty.map(countIndent))
    return trimmedEdges.map((line) => (line.trim().length === 0 ? "" : line.slice(minIndent)))
}

/**
 * Se o valor estiver entre aspas duplas ("..."), remove as aspas e
 * desfaz o escape de aspas internas (\"). Valores sem aspas continuam
 * funcionando normalmente (retrocompatível).
 */
function unquoteValue(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\"/g, '"')
    }
    return value
}

/** Faz o split de "chave: valor", preservando ":" extras dentro do valor. Lança se malformado. */
function splitKeyValue(
    trimmed: string,
    original: string,
    lineNumber: number,
    context: string
): [string, string] {
    const idx = trimmed.indexOf(":")
    if (idx === -1) {
        throw new Error(`Sintaxe inválida em ${context} na linha ${lineNumber}: "${original}"`)
    }
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (!key) {
        throw new Error(`Sintaxe inválida em ${context} na linha ${lineNumber}: "${original}"`)
    }
    return [key, unquoteValue(value)]
}

/** Mesma coisa que splitKeyValue, mas devolve null em vez de lançar — usado pelo modo de coleta. */
function trySplitKeyValue(trimmed: string): [string, string] | null {
    const idx = trimmed.indexOf(":")
    if (idx === -1) return null
    const key = trimmed.slice(0, idx).trim()
    if (!key) return null
    return [key, unquoteValue(trimmed.slice(idx + 1).trim())]
}

/**
 * "@Const nome = valor" — diretiva de LINHA ÚNICA e de MARCO ZERO: só é
 * reconhecida sem NENHUMA indentação. O regex já é ancorado com "^" sem
 * espaço; quem chama precisa testar contra uma string com só o lado
 * DIREITO aparado (`trimEnd()`), nunca contra `trim()` — testar contra
 * uma string já trimada pela esquerda anularia o propósito do "^" aqui.
 */
const CONST_DIRECTIVE_RE = /^@Const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Aplica os @Const conhecidos ATÉ O MOMENTO em que o snippet foi fechado
 * (declare-before-use). Faz UMA ÚNICA substituição sobre a linha original
 * (regex combinando todos os nomes de uma vez) — garante que a
 * substituição não seja recursiva: "foo" com @Const foo=bar e
 * @Const bar=baz vira exatamente "bar", nunca "baz".
 */
function substituteConsts(bodyLines: string[], consts: ReadonlyMap<string, string>): string[] {
    if (consts.size === 0) return bodyLines
    const names = [...consts.keys()].map(escapeRegExp)
    const pattern = new RegExp(`\\b(?:${names.join("|")})\\b`, "g")
    return bodyLines.map((line) => line.replace(pattern, (match) => consts.get(match) ?? match))
}

/**
 * Parser "estrito": lança um Error na PRIMEIRA coisa que encontrar de
 * errado. Comportamento inalterado desde sempre — quem já consome essa
 * função (o CLI) continua recebendo exatamente as mesmas mensagens e o
 * mesmo comportamento de sempre.
 *
 * REGRA DE MARCO ZERO: @Header, @Const e @Snippet só são reconhecidos
 * como diretivas na COLUNA 0 (sem nenhuma indentação) — `trimmedEnd`
 * (só apara a direita) é comparado contra o texto exato da diretiva, e
 * qualquer indentação à esquerda reprova o match. Isso garante que
 * "@Body é código arbitrário, nunca tocado" seja verdade de fato: um
 * @Snippet/@Header/@Const indentado dentro de um @Body é só texto. Já
 * @Body não é de marco zero — é reconhecido pelo ESTADO do parser (só
 * faz sentido logo após as propriedades de um @Snippet), então continua
 * tolerante à indentação (`trimmed`, não `trimmedEnd`).
 */
export function parseViken(source: string): FileNode {
    const lines = source.split(/\r?\n/)

    let header: HeaderNode | null = null
    const snippets: SnippetNode[] = []
    const seenNames = new Set<string>()
    const consts = new Map<string, string>()

    let currentSnippet: SnippetNode | null = null
    let state: ParserState = "none"

    const closeCurrentSnippet = (): void => {
        if (currentSnippet) {
            currentSnippet.body = substituteConsts(normalizeBody(currentSnippet.body), consts)
            snippets.push(currentSnippet)
            currentSnippet = null
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const original = lines[i]
        if (original === undefined) continue

        const lineNumber = i + 1
        const trimmed = original.trim()
        const trimmedEnd = original.trimEnd()

        if (state === "snippet-body") {
            const isNewTopLevelDirective =
                trimmedEnd === "@Header" ||
                trimmedEnd === "@Snippet" ||
                CONST_DIRECTIVE_RE.test(trimmedEnd)
            if (!isNewTopLevelDirective) {
                currentSnippet!.body.push(original)
                continue
            }
        }

        if (trimmed === "") continue
        if (isCommentLine(trimmed)) continue

        const constMatch = CONST_DIRECTIVE_RE.exec(trimmedEnd)
        if (constMatch) {
            closeCurrentSnippet()
            const name = constMatch[1] as string
            const rawValue = constMatch[2] as string
            if (consts.has(name)) {
                throw new Error(`Const duplicado: "${name}" na linha ${lineNumber}`)
            }
            consts.set(name, unquoteValue(rawValue.trim()))
            state = "none"
            continue
        }

        if (trimmedEnd === "@Header") {
            if (header !== null) {
                throw new Error(`Header duplicado na linha ${lineNumber}`)
            }
            closeCurrentSnippet()
            state = "header"
            continue
        }

        if (trimmedEnd === "@Snippet") {
            closeCurrentSnippet()
            currentSnippet = { type: "Snippet", name: "", prefix: "", body: [] }
            state = "snippet-props"
            continue
        }

        if (trimmed === "@Body") {
            if (!currentSnippet || state !== "snippet-props") {
                throw new Error(`"@Body" fora de um @Snippet na linha ${lineNumber}`)
            }
            state = "snippet-body"
            continue
        }

        if (state === "header") {
            const [key, value] = splitKeyValue(trimmed, original, lineNumber, "Header")
            if (!header) header = { type: "Header", scope: "", output: "" }
            if (key === "scope") header.scope = value
            else if (key === "output") header.output = value
            continue
        }

        if (state === "snippet-props" && currentSnippet) {
            const [key, rawValue] = splitKeyValue(trimmed, original, lineNumber, "Snippet")
            if (key === "name") currentSnippet.name = rawValue
            else if (key === "prefix") currentSnippet.prefix = rawValue
            else if (key === "detail") currentSnippet.detail = rawValue
            else if (key === "template") {
                const normalized = rawValue.toLowerCase()
                if (normalized !== "true" && normalized !== "false") {
                    throw new Error(
                        `Valor inválido para 'template' na linha ${lineNumber}: "${rawValue}" (use true ou false)`
                    )
                }
                currentSnippet.template = normalized === "true"
            }
            continue
        }

        throw new Error(
            `Linha fora de @Header/@Snippet/@Body/@Const na linha ${lineNumber}: "${original}"`
        )
    }

    closeCurrentSnippet()

    if (!header) throw new Error("Arquivo sem @Header")
    if (!header.scope) throw new Error("Header sem 'scope'")
    if (!header.output) throw new Error("Header sem 'output'")

    for (const snip of snippets) {
        if (!snip.name) throw new Error("Snippet sem 'name'")
        if (!snip.prefix) throw new Error(`Snippet "${snip.name}" sem 'prefix'`)
        if (seenNames.has(snip.name)) throw new Error(`Nome de snippet duplicado: "${snip.name}"`)
        seenNames.add(snip.name)
    }

    return { type: "File", header, snippets }
}

/** Um problema encontrado pelo modo de coleta — mesmo texto de mensagem que `parseViken` lançaria. */
export interface ParseIssue {
    message: string
}

export interface ParseCollectResult {
    /**
     * Melhor esforço de FileNode dado o que deu pra interpretar.
     * `null` só quando nem um @Header válido foi encontrado — sem
     * scope/output não há nada de útil pra devolver. Quando não-null
     * mas `errors` não está vazio, snippets problemáticos (sem
     * name/prefix, ou nome duplicado) podem ter sido OMITIDOS de
     * `file.snippets` — não use `file` para compilar sem antes checar
     * `errors.length === 0`.
     */
    file: FileNode | null
    errors: ParseIssue[]
}

/**
 * Versão "modo de coleta" de parseViken: em vez de lançar na primeira
 * coisa errada, registra cada problema em `errors` e tenta continuar
 * interpretando o resto do arquivo, best-effort. Pensada para
 * consumidores como diagnostics de editor, que querem mostrar TODOS os
 * problemas de uma vez em vez de um de cada vez.
 *
 * `parseViken` continua existindo, sem NENHUMA mudança de comportamento
 * — essa função é puramente aditiva, pra não quebrar quem já depende do
 * comportamento "lança no primeiro erro" (o CLI).
 *
 * Compartilha as mesmas regras de marco zero, @Const, tabs, etc. — é a
 * mesma máquina de estados, só que cada `throw` vira "registra e tenta
 * seguir em frente" em vez de "para tudo".
 */
export function parseVikenCollectingErrors(source: string): ParseCollectResult {
    const errors: ParseIssue[] = []
    const fail = (message: string): void => {
        errors.push({ message })
    }

    const lines = source.split(/\r?\n/)

    let header: HeaderNode | null = null
    let duplicateHeaderScratch: HeaderNode | null = null // descartado — só pra não sobrescrever o header real
    const snippets: SnippetNode[] = []
    const seenNames = new Set<string>()
    const consts = new Map<string, string>()

    let currentSnippet: SnippetNode | null = null
    let currentSnippetHadStructuralError = false // ex: nome duplicado — omitida do resultado mesmo tendo name/prefix
    let state: ParserState = "none"

    const closeCurrentSnippet = (): void => {
        if (!currentSnippet) return
        currentSnippet.body = substituteConsts(normalizeBody(currentSnippet.body), consts)

        if (!currentSnippet.name) fail("Snippet sem 'name'")
        if (!currentSnippet.prefix) fail(`Snippet "${currentSnippet.name || "?"}" sem 'prefix'`)

        if (currentSnippet.name && currentSnippet.prefix && !currentSnippetHadStructuralError) {
            if (seenNames.has(currentSnippet.name)) {
                fail(`Nome de snippet duplicado: "${currentSnippet.name}"`)
            } else {
                seenNames.add(currentSnippet.name)
                snippets.push(currentSnippet)
            }
        }

        currentSnippet = null
        currentSnippetHadStructuralError = false
    }

    for (let i = 0; i < lines.length; i++) {
        const original = lines[i]
        if (original === undefined) continue

        const lineNumber = i + 1
        const trimmed = original.trim()
        const trimmedEnd = original.trimEnd()

        if (state === "snippet-body") {
            const isNewTopLevelDirective =
                trimmedEnd === "@Header" ||
                trimmedEnd === "@Snippet" ||
                CONST_DIRECTIVE_RE.test(trimmedEnd)
            if (!isNewTopLevelDirective) {
                currentSnippet!.body.push(original)
                continue
            }
        }

        if (trimmed === "") continue
        if (isCommentLine(trimmed)) continue

        const constMatch = CONST_DIRECTIVE_RE.exec(trimmedEnd)
        if (constMatch) {
            closeCurrentSnippet()
            const name = constMatch[1] as string
            const rawValue = constMatch[2] as string
            if (consts.has(name)) {
                fail(`Const duplicado: "${name}" na linha ${lineNumber}`)
            } else {
                consts.set(name, unquoteValue(rawValue.trim()))
            }
            state = "none"
            continue
        }

        if (trimmedEnd === "@Header") {
            closeCurrentSnippet()
            if (header !== null) {
                fail(`Header duplicado na linha ${lineNumber}`)
                duplicateHeaderScratch = { type: "Header", scope: "", output: "" }
            }
            state = "header"
            continue
        }

        if (trimmedEnd === "@Snippet") {
            closeCurrentSnippet()
            currentSnippet = { type: "Snippet", name: "", prefix: "", body: [] }
            state = "snippet-props"
            continue
        }

        if (trimmed === "@Body") {
            if (!currentSnippet || state !== "snippet-props") {
                fail(`"@Body" fora de um @Snippet na linha ${lineNumber}`)
                continue
            }
            state = "snippet-body"
            continue
        }

        if (state === "header") {
            const parsed = trySplitKeyValue(trimmed)
            if (!parsed) {
                fail(`Sintaxe inválida em Header na linha ${lineNumber}: "${original}"`)
                continue
            }
            const [key, value] = parsed
            if (header === null) header = { type: "Header", scope: "", output: "" }
            const target = duplicateHeaderScratch ?? header
            if (key === "scope") target.scope = value
            else if (key === "output") target.output = value
            continue
        }

        if (state === "snippet-props" && currentSnippet) {
            const parsed = trySplitKeyValue(trimmed)
            if (!parsed) {
                fail(`Sintaxe inválida em Snippet na linha ${lineNumber}: "${original}"`)
                continue
            }
            const [key, rawValue] = parsed
            if (key === "name") currentSnippet.name = rawValue
            else if (key === "prefix") currentSnippet.prefix = rawValue
            else if (key === "detail") currentSnippet.detail = rawValue
            else if (key === "template") {
                const normalized = rawValue.toLowerCase()
                if (normalized !== "true" && normalized !== "false") {
                    fail(
                        `Valor inválido para 'template' na linha ${lineNumber}: "${rawValue}" (use true ou false)`
                    )
                    currentSnippetHadStructuralError = true
                } else {
                    currentSnippet.template = normalized === "true"
                }
            }
            continue
        }

        fail(`Linha fora de @Header/@Snippet/@Body/@Const na linha ${lineNumber}: "${original}"`)
    }

    closeCurrentSnippet()

    if (!header) {
        fail("Arquivo sem @Header")
        return { file: null, errors }
    }
    if (!header.scope) fail("Header sem 'scope'")
    if (!header.output) fail("Header sem 'output'")

    return { file: { type: "File", header, snippets }, errors }
}
