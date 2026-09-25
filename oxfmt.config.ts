import { defineConfig } from "oxfmt"

export default defineConfig({
    arrowParens: "always",
    bracketSpacing: true,
    semi: false,
    singleQuote: false,
    sortImports: true,
    sortPackageJson: true,
    trailingComma: "none",
    ignorePatterns: ["dist/**"]
})
