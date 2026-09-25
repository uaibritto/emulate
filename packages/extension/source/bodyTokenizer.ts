export type TokenType = "comment" | "string" | "number" | "keyword"

export interface Token {
    start: number
    length: number
    type: TokenType
}

/**
 * Estado que atravessa a fronteira entre linhas de um mesmo @Body, para
 * strings e comentários que podem abranger várias linhas (template
 * literal com crase, docstring de aspas triplas do Python, comentário de
 * bloco /* ... *\/). `openDelimiter` é o delimitador de STRING que ainda
 * está "pendurado" da linha anterior (ou null); `inBlockComment` é
 * separado porque um comentário de bloco não tem "delimitador variável"
 * por família — cada família só tem um par fixo — e porque string e
 * comentário de bloco nunca ficam abertos ao mesmo tempo.
 *
 * Reinicia (volta ao estado inicial) no início de cada bloco @Body — uma
 * string ou comentário aberto no fim do corpo de um snippet nunca "vaza"
 * para o corpo do próximo.
 */
export interface TokenizerState {
    openDelimiter: string | null
    inBlockComment: boolean
}

const INITIAL_STATE: TokenizerState = { openDelimiter: null, inBlockComment: false }

export interface LanguageFamily {
    lineComment?: string
    /**
     * Par [abre, fecha] de comentário de bloco, que PODE abranger várias
     * linhas (ex: /* ... *\/ em C-like, --[[ ... ]] em Lua). Ao contrário
     * de multilineStringDelimiters, que usa o MESMO texto pra abrir e
     * fechar, aqui abertura e fechamento são textos diferentes.
     */
    blockComment?: [open: string, close: string]
    /** Delimitadores de string que SEMPRE terminam na mesma linha (aspas simples/duplas na maioria das linguagens). */
    stringDelimiters: string[]
    /**
     * Delimitadores que PODEM abranger várias linhas — tratados com
     * TokenizerState entre chamadas de tokenizeLine. Ex: crase (`) de
     * template literal em JS/TS, aspas triplas (""" / ''') de docstring
     * em Python. Verificados ANTES de stringDelimiters no scan, já que
     * podem ter mais de 1 caractere (""" começa com o mesmo caractere de
     * uma string comum de aspas duplas).
     */
    multilineStringDelimiters?: string[]
    keywords: string[]
}

// Famílias por estilo de comentário/keyword. Não é um parser completo de cada
// linguagem — é um tokenizer simples o bastante pra colorir comentário, string
// e um conjunto curado de palavras-chave comuns, sem tentar validar sintaxe.
const C_FAMILY: LanguageFamily = {
    lineComment: "//",
    blockComment: ["/*", "*/"],
    stringDelimiters: ['"', "'"],
    multilineStringDelimiters: ["`"], // template literal — pode abranger várias linhas
    keywords: [
        "function",
        "return",
        "const",
        "let",
        "var",
        "if",
        "else",
        "for",
        "while",
        "class",
        "interface",
        "type",
        "import",
        "export",
        "from",
        "new",
        "this",
        "extends",
        "implements",
        "public",
        "private",
        "protected",
        "static",
        "async",
        "await",
        "try",
        "catch",
        "finally",
        "switch",
        "case",
        "break",
        "continue",
        "default",
        "void",
        "null",
        "true",
        "false",
        "struct",
        "enum",
        "fn",
        "impl",
        "pub",
        "use",
        "mod",
        "package",
        "func",
        "defer",
        "chan",
        "namespace",
        "using",
        "override",
        "abstract",
        "readonly"
    ]
}

const HASH_FAMILY: LanguageFamily = {
    lineComment: "#",
    stringDelimiters: ['"', "'"],
    keywords: [
        "def",
        "return",
        "if",
        "elif",
        "else",
        "for",
        "while",
        "class",
        "import",
        "from",
        "as",
        "try",
        "except",
        "finally",
        "with",
        "lambda",
        "yield",
        "pass",
        "break",
        "continue",
        "None",
        "True",
        "False",
        "self",
        "raise",
        "global",
        "nonlocal",
        "sub",
        "my",
        "use",
        "package",
        "require",
        "end",
        "do",
        "then",
        "module",
        "begin",
        "rescue",
        "puts",
        "print"
    ]
}

// Python é a ÚNICA linguagem hash-comment daqui com docstrings de aspas
// triplas — Ruby e Perl não têm esse conceito, então isso fica numa família
// separada (derivada de HASH_FAMILY) em vez de estender a família
// compartilhada, o que aplicaria a regra incorretamente a ruby/perl também.
const PYTHON_FAMILY: LanguageFamily = {
    ...HASH_FAMILY,
    multilineStringDelimiters: ['"""', "'''"]
}

const DASH_FAMILY: LanguageFamily = {
    lineComment: "--",
    blockComment: ["--[[", "]]"], // Lua: --[[ ... ]] — pode abranger várias linhas
    stringDelimiters: ['"', "'"],
    keywords: [
        "function",
        "local",
        "end",
        "if",
        "then",
        "else",
        "elseif",
        "for",
        "while",
        "do",
        "return",
        "break",
        "nil",
        "true",
        "false",
        "require"
    ]
}

const SHELL_FAMILY: LanguageFamily = {
    lineComment: "#",
    stringDelimiters: ['"', "'"],
    keywords: [
        "if",
        "then",
        "else",
        "elif",
        "fi",
        "for",
        "while",
        "until",
        "do",
        "done",
        "case",
        "esac",
        "function",
        "local",
        "export",
        "return",
        "in",
        "select",
        "break",
        "continue",
        "exit",
        "echo",
        "read",
        "shift",
        "trap",
        "unset",
        "readonly"
    ]
}

const SQL_FAMILY: LanguageFamily = {
    lineComment: "--",
    blockComment: ["/*", "*/"], // SQL padrão também suporta comentário de bloco
    stringDelimiters: ["'", '"'],
    keywords: [
        "SELECT",
        "FROM",
        "WHERE",
        "INSERT",
        "INTO",
        "VALUES",
        "UPDATE",
        "SET",
        "DELETE",
        "JOIN",
        "LEFT",
        "RIGHT",
        "INNER",
        "OUTER",
        "ON",
        "GROUP",
        "BY",
        "ORDER",
        "HAVING",
        "AS",
        "AND",
        "OR",
        "NOT",
        "NULL",
        "IS",
        "IN",
        "LIKE",
        "LIMIT",
        "OFFSET",
        "CREATE",
        "TABLE",
        "ALTER",
        "DROP",
        "INDEX",
        "PRIMARY",
        "KEY",
        "FOREIGN",
        "REFERENCES",
        "DISTINCT",
        "UNION",
        "CASE",
        "WHEN",
        "THEN",
        "END"
    ]
}

/**
 * Mapa de "scope:" (language id do VS Code) para a família de tokenizer.
 * Cobre os valores sugeridos em SCOPE_VALUES. vue/svelte/html/json ficam de
 * fora de propósito: são linguagens hospedeiras/híbridas onde um tokenizer
 * de uma família só (C-like ou hash) erraria mais do que ajudaria — nesses
 * casos o corpo fica só com o highlight genérico embutido (TSX) e os
 * placeholders.
 *
 * "tsrx" (https://tsrx.dev/) é um superset de TypeScript para componentes de
 * UI — sintaticamente próximo o bastante de TS/JSX (mesmos comentários "//",
 * mesmas palavras-chave como function/const/if/for) para reaproveitar a
 * família C-like sem introduzir uma lista de keywords própria. O mesmo vale
 * para dart/scala/objectivec (aproximação razoável, não uma gramática real
 * de cada uma — ver limitações no README). "shellscript"/"bash" e "sql" têm
 * famílias próprias porque a pontuação de comentário e o vocabulário de
 * palavras-chave são bem diferentes de C-like/hash.
 */
export const SCOPE_FAMILY: Record<string, LanguageFamily> = {
    typescript: C_FAMILY,
    typescriptreact: C_FAMILY,
    javascript: C_FAMILY,
    javascriptreact: C_FAMILY,
    tsrx: C_FAMILY,
    java: C_FAMILY,
    c: C_FAMILY,
    cpp: C_FAMILY,
    csharp: C_FAMILY,
    go: C_FAMILY,
    rust: C_FAMILY,
    kotlin: C_FAMILY,
    swift: C_FAMILY,
    php: C_FAMILY,
    dart: C_FAMILY,
    scala: C_FAMILY,
    objectivec: C_FAMILY,
    python: PYTHON_FAMILY,
    ruby: HASH_FAMILY,
    perl: HASH_FAMILY,
    elixir: HASH_FAMILY,
    lua: DASH_FAMILY,
    shellscript: SHELL_FAMILY,
    bash: SHELL_FAMILY,
    sql: SQL_FAMILY
}

const NUMBER_RE = /\d+(\.\d+)?/y

// Mesmo padrão usado na gramática TextMate para $0, $1, ${1:label},
// ${TM_FILENAME_BASE/.../.../} (1 nível de aninhamento). Precisa ser
// verificado ANTES de número/keyword/multilineStringDelimiters/blockComment,
// senão o "1" de "${1:nome}" ou o "0" de "$0" seriam classificados como
// número de verdade do código.
const PLACEHOLDER_RE = /\$\{(?:[^{}]|\{[^{}]*\})*\}|\$[A-Z_][A-Z0-9_]*|\$\d+/y

// Cache do Set de keywords por família: SCOPE_FAMILY reaproveita a mesma
// instância de LanguageFamily entre várias linguagens (ex: C_FAMILY serve
// typescript, javascript, java, go, etc.), então um WeakMap por objeto de
// família evita recriar o Set a cada linha tokenizada — o que aconteceria
// centenas de vezes a cada atualização de semantic tokens, disparada a
// cada poucas teclas digitadas no arquivo.
const keywordSetCache = new WeakMap<LanguageFamily, Set<string>>()

function getKeywordSet(family: LanguageFamily): Set<string> {
    let set = keywordSetCache.get(family)
    if (!set) {
        set = new Set(family.keywords)
        keywordSetCache.set(family, set)
    }
    return set
}

/**
 * Procura a próxima ocorrência (não escapada) de `delimiter` em `line` a
 * partir de `fromIndex`. Um "\" consome o caractere seguinte junto (mesma
 * regra usada para strings de linha única), então um delimitador
 * precedido por "\" não conta como fechamento.
 */
function findClosingDelimiter(line: string, fromIndex: number, delimiter: string): number | null {
    let j = fromIndex
    while (j < line.length) {
        if (line[j] === "\\") {
            j += 2
            continue
        }
        if (line.startsWith(delimiter, j)) return j
        j++
    }
    return null
}

/**
 * Tokeniza UMA linha de código de acordo com a família da linguagem,
 * encadeando estado com a linha anterior via `state` (para strings e
 * comentários de bloco que abrangem várias linhas — ver TokenizerState).
 */
export function tokenizeLine(
    line: string,
    family: LanguageFamily,
    state: TokenizerState = INITIAL_STATE
): { tokens: Token[]; state: TokenizerState } {
    const tokens: Token[] = []
    const keywordSet = getKeywordSet(family)
    const multilineDelims = family.multilineStringDelimiters ?? []
    let i = 0

    // Continuando um comentário de bloco aberto na linha anterior: só
    // procura o fechamento — é comentário até lá, sem checar mais nada.
    if (state.inBlockComment && family.blockComment) {
        const [, close] = family.blockComment
        const closeIndex = line.indexOf(close)
        if (closeIndex === -1) {
            return {
                tokens: [{ start: 0, length: line.length, type: "comment" }],
                state: { openDelimiter: null, inBlockComment: true }
            }
        }
        tokens.push({ start: 0, length: closeIndex + close.length, type: "comment" })
        i = closeIndex + close.length
    } else if (state.openDelimiter) {
        // Continuando uma string multi-linha aberta na linha anterior: só
        // procura o delimitador de fechamento — é conteúdo literal de
        // string até fechar, sem checar comentário/placeholder/keyword.
        const delimiter = state.openDelimiter
        const closeIndex = findClosingDelimiter(line, 0, delimiter)
        if (closeIndex === null) {
            return {
                tokens: [{ start: 0, length: line.length, type: "string" }],
                state: { openDelimiter: delimiter, inBlockComment: false }
            }
        }
        tokens.push({ start: 0, length: closeIndex + delimiter.length, type: "string" })
        i = closeIndex + delimiter.length
    }

    while (i < line.length) {
        // Comentário de bloco: pode abrir e fechar na mesma linha, ou continuar na próxima.
        if (family.blockComment && line.startsWith(family.blockComment[0], i)) {
            const [open, close] = family.blockComment
            const closeIndex = line.indexOf(close, i + open.length)
            if (closeIndex === -1) {
                tokens.push({ start: i, length: line.length - i, type: "comment" })
                return { tokens, state: { openDelimiter: null, inBlockComment: true } }
            }
            const end = closeIndex + close.length
            tokens.push({ start: i, length: end - i, type: "comment" })
            i = end
            continue
        }

        const rest = line.slice(i)

        // Comentário de linha: tudo até o fim da linha
        if (family.lineComment && rest.startsWith(family.lineComment)) {
            tokens.push({ start: i, length: line.length - i, type: "comment" })
            return { tokens, state: { openDelimiter: null, inBlockComment: false } }
        }

        const ch = line[i]

        // Placeholder de snippet do VS Code ($0, ${1:label}, ...): pula sem
        // emitir token — quem colore isso é a gramática TextMate, não aqui.
        PLACEHOLDER_RE.lastIndex = i
        const placeholderMatch = PLACEHOLDER_RE.exec(line)
        if (placeholderMatch && placeholderMatch.index === i) {
            i += placeholderMatch[0].length
            continue
        }

        // Delimitador que pode abranger várias linhas (crase, aspas triplas):
        // checado ANTES de stringDelimiters, já que pode ter mais de 1
        // caractere (""" começa com o mesmo caractere de uma string comum).
        const multilineMatch = multilineDelims.find((d) => line.startsWith(d, i))
        if (multilineMatch !== undefined) {
            const closeIndex = findClosingDelimiter(line, i + multilineMatch.length, multilineMatch)
            if (closeIndex === null) {
                tokens.push({ start: i, length: line.length - i, type: "string" })
                return { tokens, state: { openDelimiter: multilineMatch, inBlockComment: false } }
            }
            const end = closeIndex + multilineMatch.length
            tokens.push({ start: i, length: end - i, type: "string" })
            i = end
            continue
        }

        // String de linha única: consome até achar o delimitador de fechamento (ou fim da linha)
        if (ch !== undefined && family.stringDelimiters.includes(ch)) {
            const quote = ch
            let j = i + 1
            while (j < line.length && line[j] !== quote) {
                if (line[j] === "\\") j++ // pula caractere escapado
                j++
            }
            const end = Math.min(j + 1, line.length)
            tokens.push({ start: i, length: end - i, type: "string" })
            i = end
            continue
        }

        // Número
        NUMBER_RE.lastIndex = i
        const numberMatch = NUMBER_RE.exec(line)
        if (numberMatch && numberMatch.index === i) {
            tokens.push({ start: i, length: numberMatch[0].length, type: "number" })
            i += numberMatch[0].length
            continue
        }

        // Palavra (possível keyword)
        if (ch !== undefined && /[A-Za-z_]/.test(ch)) {
            let j = i + 1
            while (j < line.length && /[A-Za-z0-9_]/.test(line[j] ?? "")) j++
            const word = line.slice(i, j)
            if (keywordSet.has(word)) {
                tokens.push({ start: i, length: word.length, type: "keyword" })
            }
            i = j
            continue
        }

        i++
    }

    return { tokens, state: { openDelimiter: null, inBlockComment: false } }
}
