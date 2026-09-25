export interface HeaderNode {
    type: "Header"
    scope: string
    output: string
}

export interface SnippetNode {
    type: "Snippet"
    name: string
    prefix: string
    detail?: string
    template?: boolean
    body: string[]
}

export interface FileNode {
    type: "File"
    header: HeaderNode
    snippets: SnippetNode[]
}
