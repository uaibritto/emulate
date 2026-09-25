import { defineConfig } from "oxlint"

export default defineConfig({
    plugins: ["typescript", "unicorn", "oxc"],
    categories: {
        correctness: "error",
        suspicious: "warn",
        perf: "warn",
        style: "off"
    },
    rules: {
        "no-console": "off",
        "typescript/no-explicit-any": "error",
        "typescript/consistent-type-imports": "error",
        "unicorn/prefer-node-protocol": "error",
        eqeqeq: "error",
        "no-unused-vars": "off"
    },
    ignorePatterns: ["dist", "node_modules"]
})
