import { readFileSync } from "node:fs"
import js from "@eslint/js"
import react from "@eslint-react/eslint-plugin"
import tailwind from "eslint-plugin-better-tailwindcss"
import reactHooks from "eslint-plugin-react-hooks"
import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"
import { designSystem } from "./tools/vibestack/vibestack/design/eslint.ts"
import { parseTokens } from "./tools/vibestack/vibestack/design/tokens.ts"

const stack = 'AGENTS.md, "The stack"'
const banned = ["redux", "react-redux", "zustand", "mobx", "jotai", "recoil", "valtio", "xstate", "vue", "svelte", "jest"]
const scopes = ["reduxjs", "angular", "xstate", "vue", "sveltejs", "jest"]
const imports = { patterns: [{ regex: `^(?:@(?:${scopes.join("|")})/|(?:${banned.join("|")})(?:[/-]|$))`, message: `Not part of the stack: ${stack}.` }] }
const ui = ["packages/ui/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"]
const design = "packages/design-system"
const theme = JSON.parse(readFileSync(`${design}/package.json`, "utf8")).exports["./theme.css"]
const tokens = designSystem({ tailwind, tokens: parseTokens(JSON.parse(readFileSync(`${design}/brands/network/tokens.json`, "utf8"))), entryPoint: `${import.meta.dirname}/${design}/${theme}` })
const consoles = { "packages/observatory": "packages/observatory/web/**/*.{ts,tsx}", "packages/mcp": "packages/mcp/src/pages/**/*.{ts,tsx}" }

export default defineConfig(
  globalIgnores(["**/node_modules/", "**/dist/", "**/generated/", "**/storybook-static/", "**/.cache/", "**/gen/"]),
  { linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" } },
  {
    files: ui,
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "no-restricted-imports": ["error", imports],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "legacy", "deprecated"], location: "anywhere" }],
    },
  },
  {
    files: ui.map((glob) => glob.replace("{ts,tsx}", "tsx")),
    extends: [react.configs["recommended-type-checked"], reactHooks.configs.flat.recommended],
    rules: Object.fromEntries(Object.keys(reactHooks.rules).filter((rule) => `@eslint-react/${rule}` in react.configs["recommended-type-checked"].rules).map((rule) => [`@eslint-react/${rule}`, "off"])),
  },
  {
    files: ui,
    extends: [tokens],
    settings: { "better-tailwindcss": { cwd: "packages/ui" } },
  },
  ...Object.entries(consoles).map(([cwd, files]) => ({
    files: [files],
    extends: [tseslint.configs.base, tokens],
    settings: { "better-tailwindcss": { cwd } },
  })),
  {
    files: ["packages/ui/src/components/AuthPhoneView.tsx"],
    rules: { "better-tailwindcss/no-unknown-classes": ["error", { ignore: ["^cf-turnstile$"] }] },
  },
  { files: ["**/.storybook/**"], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ui,
    ignores: ["packages/ui/**"],
    rules: {
      "no-restricted-globals": ["error", ...["alert", "confirm", "prompt"].map((name) => ({ name, message: "Use Dialog or Alert from @thenetwork/ui." }))],
      "no-restricted-syntax": ["error", { selector: "JSXOpeningElement[name.name=/^(input|textarea|select)$/]", message: "Use Input, Textarea, Checkbox, RadioGroup or Select from @thenetwork/ui." }],
    },
  },
)
