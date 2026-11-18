#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type AccentTokens, type AppKey, accentTokens, appKeys, brandFor } from "../core/src/generated/brandIdentity.ts"
import { type BrandId, brandIds } from "./src/brands.ts"

const root = dirname(fileURLToPath(import.meta.url))
const cli = join(root, "../../tools/vibestack/vibestack/design/cli.ts")
const brandDir = (brand: BrandId) => join(root, "brands", brand)
const read = (file: string) => readFileSync(file, "utf8")
const base: BrandId = "network"
const tokenImport = '@import "./tokens.css";\n'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const leaves = (value: unknown, path = ""): [string, unknown][] =>
  isRecord(value) ? Object.entries(value).flatMap(([key, each]) => leaves(each, path ? `${path}.${key}` : key)) : [[path, value]]

/** Runs the toolkit CLI in one brand directory. Returns the problem, or nothing. */
function runCli(brand: BrandId, command: "build" | "check"): string[] {
  try {
    execFileSync(process.execPath, [cli, command], { cwd: brandDir(brand), stdio: ["ignore", "inherit", "pipe"] })
    return []
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim()
    return [`${brand}: ${stderr || (error instanceof Error ? error.message : String(error))}`]
  }
}

/** The brand directories must be exactly the brand ids. */
function directoryIssues(): string[] {
  const found = readdirSync(join(root, "brands"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  return [
    ...brandIds.filter((brand) => !found.includes(brand)).map((brand) => `brands/${brand}: missing`),
    ...found.filter((name) => !(brandIds as readonly string[]).includes(name)).map((name) => `brands/${name}: not in src/brands.ts`),
  ]
}

/** Every brand has the key set of the base brand, and the same value for each token that is not a color. */
function keySetIssues(): string[] {
  const tokens = Object.fromEntries(brandIds.map((brand) => [brand, new Map(leaves(JSON.parse(read(join(brandDir(brand), "tokens.json")))))]))
  const reference = tokens[base]!
  return brandIds.filter((brand) => brand !== base).flatMap((brand) => {
    const own = tokens[brand]!
    return [
      ...[...reference.keys()].filter((path) => !own.has(path)).map((path) => `${brand}: ${path} is missing (${base} has it)`),
      ...[...own.keys()].filter((path) => !reference.has(path)).map((path) => `${brand}: ${path} is not in ${base}`),
      ...[...own].filter(([path, value]) => !path.startsWith("color.") && reference.has(path) && reference.get(path) !== value)
        .map(([path]) => `${brand}: ${path} differs from ${base}; only colors may differ`),
    ]
  })
}

/** The brand directory of each app of the brand record. It is the same map as `brandIdFor` in packages/ui/src/brand/landing.ts. */
const brandOfApp: Record<AppKey, BrandId> = { Ntwrk: "network", Slop: "slop", Peon: "peon", Friends: "friends" }

/** The token of each accent value. The site writes the accent as the browser `theme-color` (apps/site/src/entry-server.tsx). */
const accentToken: Record<keyof AccentTokens, [scheme: "light" | "dark", name: "primary" | "primary-foreground"]> = {
  light: ["light", "primary"],
  lightInk: ["light", "primary-foreground"],
  dark: ["dark", "primary"],
  darkInk: ["dark", "primary-foreground"],
}

/**
 * spec/brandIdentity.md, "Each accent has one color for light mode and one for dark mode": the accent of each app
 * (`accentTokens(brandFor(app).accent)`) has the values of the `primary` and `primary-foreground` tokens of its brand.
 */
function accentIssues(): string[] {
  return appKeys.flatMap((app) => {
    const brand = brandOfApp[app]
    const color = (JSON.parse(read(join(brandDir(brand), "tokens.json"))) as { color: Record<"light" | "dark", Record<string, string>> }).color
    const accent = accentTokens(brandFor(app).accent)
    return (Object.keys(accentToken) as (keyof AccentTokens)[]).flatMap((key) => {
      const [scheme, name] = accentToken[key]
      const token = color[scheme][name]
      return token === accent[key] ? [] : [`${brand}: color.${scheme}.${name} is ${token}, but accentTokens(${brandFor(app).accent}).${key} is ${accent[key]} (spec/brandIdentity.md)`]
    })
  })
}

/** The declarations of one top-level rule of a generated tokens.css. */
function declarations(css: string, selector: string, brand: BrandId): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`^${escaped} \\{\\n([\\s\\S]*?)\\n\\}$`, "m").exec(css)
  if (!match) throw new Error(`${brand}: generated/tokens.css has no "${selector}" rule`)
  return match[1]!.split("\n").map((line) => line.trim())
}

const rule = (selectors: string[], lines: string[], indent = "") =>
  `${indent}${selectors.join(`,\n${indent}`)} {\n${lines.map((line) => `${indent}  ${line}\n`).join("")}${indent}}\n`

/**
 * The color variables of each brand under `[data-brand]`, in the order of the toolkit's tokens.css:
 * light by default, dark on a dark system, then `.light` and `.dark`. A class on the branded element wins
 * over a class on an ancestor; a class on a descendant applies to that descendant.
 */
function brandsCss(): string {
  const parsed = brandIds.map((brand) => {
    const css = read(join(brandDir(brand), "generated/tokens.css"))
    const light = declarations(css, ".light", brand), dark = declarations(css, ".dark", brand)
    const scheme = new Set([...light, ...dark].map((line) => line.split(":")[0]))
    const fixed = declarations(css, ":root", brand).filter((line) => !scheme.has(line.split(":")[0]))
    return { brand, light, dark, fixed }
  })
  const fixed = parsed[0]!.fixed
  const at = (brand: BrandId) => `[data-brand="${brand}"]`
  return [
    rule([":root"], fixed),
    ...parsed.map(({ brand, light }) => rule([at(brand)], light)),
    `@media (prefers-color-scheme: dark) {\n${parsed.map(({ brand, dark }) => rule([`${at(brand)}:not(.light, .light *)`], dark, "  ")).join("")}}\n`,
    ...parsed.map(({ brand, light }) => rule([`:where(.light) ${at(brand)}`, `${at(brand)}.light`, `${at(brand)} .light`], light)),
    ...parsed.map(({ brand, dark }) => rule([`:where(.dark) ${at(brand)}`, `${at(brand)}.dark`, `${at(brand)} .dark`], dark)),
  ].join("")
}

/** The Tailwind v4 entry: the toolkit's theme.css of the base brand, importing brands.css. */
function themeCss(): string {
  const themes = brandIds.map((brand) => read(join(brandDir(brand), "generated/theme.css")))
  const differing = brandIds.filter((_, index) => themes[index] !== themes[0])
  if (differing.length) throw new Error(`generated/theme.css differs from ${base} in: ${differing.join(", ")}`)
  const theme = themes[0]!
  if (!theme.includes(tokenImport)) throw new Error(`${base}: generated/theme.css does not contain ${tokenImport.trim()}`)
  return theme.replace(tokenImport, '@import "./brands.css";\n')
}

function build(): string[] {
  const issues = [...directoryIssues(), ...keySetIssues(), ...accentIssues()]
  if (issues.length) return issues
  const failed = brandIds.flatMap((brand) => runCli(brand, "build"))
  if (failed.length) return failed
  mkdirSync(join(root, "generated"), { recursive: true })
  writeFileSync(join(root, "generated/brands.css"), brandsCss())
  writeFileSync(join(root, "generated/theme.css"), themeCss())
  return []
}

function check(): string[] {
  const issues = directoryIssues()
  if (issues.length) return issues
  return [...keySetIssues(), ...accentIssues(), ...brandIds.flatMap((brand) => runCli(brand, "check"))]
}

const [command = "build"] = process.argv.slice(2)
try {
  if (command !== "build" && command !== "check") throw new Error("usage: build.ts [build|check]")
  const issues = command === "build" ? build() : check()
  if (issues.length) throw new Error(issues.join("\n"))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
