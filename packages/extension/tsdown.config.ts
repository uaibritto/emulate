import { defineConfig } from "tsdown"

export default defineConfig({
    entry: { extension: "source/extension.ts" },
    format: ["cjs"],
    external: ["vscode"],
    target: "node18",
    sourcemap: true,
    clean: true,
    dts: false
})
