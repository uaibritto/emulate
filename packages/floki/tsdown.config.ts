import { defineConfig } from "tsdown"

export default defineConfig([
    {
        entry: { "cli/index": "source/cli/index.ts" },
        format: ["esm"],
        dts: false,
        clean: true,
        target: "es2021",
        fixedExtension: true,
        treeshake: true,
        minify: false,
        outputOptions: { banner: "#!/usr/bin/env node" }
    },
    {
        entry: {
            index: "source/index.ts",
            "core/ast": "source/core/ast.ts",
            "core/parser": "source/core/parser.ts",
            "core/compiler": "source/core/compiler.ts"
        },
        format: ["esm"],
        dts: true,
        clean: false,
        target: "es2021",
        fixedExtension: true,
        treeshake: true,
        minify: false
    }
])
