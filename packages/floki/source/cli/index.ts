import { readFileSync } from "node:fs"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { Command } from "commander"

import { compileToVSCodeSnippets } from "../core/compiler.js"
import { isEmptyVikenSource, parseViken } from "../core/parser.js"

const SUPPORTED_EXTENSIONS = new Set([".vk", ".viken"])
const IGNORED_DIR_NAMES = new Set(["node_modules", ".git"])

function hasSupportedExtension(path: string): boolean {
    return SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase())
}

/**
 * Lê a versão do próprio pacote a partir do package.json publicado, em vez
 * de manter uma string duplicada e hardcoded aqui — que inevitavelmente
 * ficaria desatualizada no primeiro release em que alguém bump a versão
 * no package.json e esquece de bumpar aqui também.
 *
 * `dist/cli/index.mjs` -> sobe 2 níveis -> raiz do pacote, onde o
 * package.json sempre está presente no tarball publicado (o npm inclui
 * package.json independente do array "files").
 */
function readOwnVersion(): string {
    const here = dirname(fileURLToPath(import.meta.url))
    const packageJsonPath = join(here, "..", "..", "package.json")
    const raw = readFileSync(packageJsonPath, "utf8")
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? "0.0.0"
}

/**
 * Percorre o diretório recursivamente coletando todos os arquivos .vk/.viken.
 * Diretórios ocultos (começando com ".") e "node_modules" são ignorados,
 * para evitar varrer dependências instaladas ou metadados de VCS.
 */
async function listVikenFilesRecursive(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const results: string[] = []

    for (const entry of entries) {
        const fullPath = join(dir, entry.name)

        if (entry.isDirectory()) {
            if (IGNORED_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) {
                continue
            }
            results.push(...(await listVikenFilesRecursive(fullPath)))
            continue
        }

        if (entry.isFile() && hasSupportedExtension(entry.name)) {
            results.push(fullPath)
        }
    }

    return results
}

async function collectTargets(input: string): Promise<string[]> {
    const fullPath = resolve(process.cwd(), input)
    const stats = await stat(fullPath)

    if (stats.isDirectory()) {
        return listVikenFilesRecursive(fullPath)
    }

    if (stats.isFile()) {
        if (!hasSupportedExtension(fullPath)) {
            throw new Error(`Extensão não suportada: ${extname(fullPath)}. Use .vk ou .viken.`)
        }
        return [fullPath]
    }

    throw new Error(`Caminho não é arquivo nem diretório: ${fullPath}`)
}

async function ensureDirExists(path: string): Promise<void> {
    const dir = dirname(path)
    await mkdir(dir, { recursive: true })
}

/**
 * Resolve o `output` do @Header contra a raiz do projeto (process.cwd(),
 * ou seja, o diretório onde o comando `viken compile` foi executado),
 * e NÃO contra o diretório onde o arquivo .vk/.viken está localizado.
 *
 * Também valida que o caminho resultante não escapa da raiz do projeto
 * (proteção contra path traversal via `output: ../../../etc/cron.d/x`
 * em um arquivo .vk malicioso ou de terceiros).
 *
 * Limitação conhecida (hardening, não bloqueador): isso usa `resolve()`,
 * que não segue symlinks. Um diretório do projeto que seja, ele mesmo, um
 * symlink apontando para fora da raiz poderia, na teoria, ser usado para
 * escapar dessa checagem. Não implementamos resolução de symlink aqui
 * porque o modelo de ameaça principal (um .vk com `output: ../../etc/x`)
 * já fica coberto, e ampliar a defesa exigiria `fs.realpath` em todo
 * arquivo/diretório do caminho — round-trips de I/O extras para um risco
 * que exige o atacante já ter conseguido plantar um symlink no seu
 * projeto (um bar bem mais alto do que só fornecer um .vk malicioso).
 */
function resolveOutputPath(projectRoot: string, output: string): string {
    const outPath = resolve(projectRoot, output)
    const rel = relative(projectRoot, outPath)

    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(
            `'output' ("${output}") resolve para fora da raiz do projeto (${projectRoot})`
        )
    }

    return outPath
}

async function compileInput(input: string): Promise<void> {
    const files = await collectTargets(input)

    if (files.length === 0) {
        console.error(
            `Nenhum arquivo .vk ou .viken encontrado em: ${resolve(process.cwd(), input)}`
        )
        process.exitCode = 1
        return
    }

    const projectRoot = process.cwd()
    const writtenBy = new Map<string, string>() // outPath -> arquivo de origem
    let hadError = false

    for (const file of files) {
        const displayFile = relative(projectRoot, file)

        try {
            const content = await readFile(file, "utf8")

            // Arquivo vazio (ou só linhas em branco/comentário) não é um
            // erro — é comum ter placeholders enquanto se escreve um novo
            // conjunto de snippets. Ignora silenciosamente em vez de
            // falhar o lote inteiro por causa de "Arquivo sem @Header".
            if (isEmptyVikenSource(content)) {
                console.log(`⏭ ${displayFile} (vazio, ignorado)`)
                continue
            }

            const ast = parseViken(content)
            const json = compileToVSCodeSnippets(ast)
            const outPath = resolveOutputPath(projectRoot, ast.header.output)

            // Dois arquivos apontando pro mesmo `output` produzem um
            // resultado cuja ordem depende de como o sistema de arquivos
            // lista os diretórios (Node não garante ordem alfabética em
            // readdir) — ou seja, "o último ganha" pode variar entre
            // máquinas para o MESMO conjunto de arquivos. Para uma
            // ferramenta de geração de código, isso é ambíguo demais para
            // ser só um aviso: tratamos como erro e não escrevemos o
            // arquivo em conflito (o primeiro que reivindicou aquele
            // output continua valendo).
            const previousSource = writtenBy.get(outPath)
            if (previousSource && previousSource !== file) {
                throw new Error(
                    `'output' (${relative(projectRoot, outPath)}) já foi escrito por ${relative(projectRoot, previousSource)} nesta mesma execução — resultado ambíguo, corrija um dos dois arquivos`
                )
            }
            writtenBy.set(outPath, file)

            await ensureDirExists(outPath)
            await writeFile(outPath, JSON.stringify(json, null, 2), "utf8")

            console.log(`✔ ${displayFile} -> ${relative(projectRoot, outPath)}`)
        } catch (err) {
            hadError = true
            const message = err instanceof Error ? err.message : String(err)
            console.error(`✘ ${displayFile}: ${message}`)
        }
    }

    if (hadError) {
        process.exitCode = 1
    }
}

const program = new Command()

program
    .name("viken")
    .description("Compilador da DSL Viken para snippets do VS Code")
    .version(readOwnVersion())

program
    .command("compile")
    .argument(
        "[path]",
        "Diretório (buscado recursivamente) com arquivos .vk/.viken, ou arquivo específico",
        "snippets"
    )
    .action(async (path) => {
        await compileInput(path)
    })

program.parseAsync(process.argv).catch((err) => {
    console.error(err)
    process.exit(1)
})
