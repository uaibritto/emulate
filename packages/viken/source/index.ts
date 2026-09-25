// source/index.ts
//
// Ponto de entrada público do pacote como BIBLIOTECA (além do CLI, exposto
// via "bin"). Criado para permitir que outros pacotes do monorepo — hoje,
// packages/extension, para diagnostics — façam
// `import { parseViken } from "@vikyn/viken"` com tipos, em vez de duplicar
// a lógica de parsing.

export type { FileNode, HeaderNode, SnippetNode } from "./core/ast.js"
export { compileToVSCodeSnippets } from "./core/compiler.js"
export type { VSCodeSnippet, VSCodeSnippetsFile } from "./core/compiler.js"
export {
    isEmptyVikenSource,
    parseViken,
    parseVikenCollectingErrors,
    type ParseCollectResult,
    type ParseIssue
} from "./core/parser.js"
