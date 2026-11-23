#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  type AccentTokens,
  type AppKey,
  accentTokens,
  appKeys,
  brandFor,
  colorIsClearOfAccent,
  designBrandId,
  hoverFillIsClear,
  inverseIsReadable,
  ringIsTheAccent,
  stateColors,
  stateToken,
} from "../core/src/generated/brandIdentity.ts"
import { buildTokenProject, checkTokenProject, writeTextIfChanged } from "../../tools/vibestack/vibestack/design/project.ts"
import { type BrandId, brandIds } from "./src/brands.ts"

const root = dirname(fileURLToPath(import.meta.url))
const brandDir = (brand: BrandId) => join(root, "brands", brand)
const read = (file: string) => readFileSync(file, "utf8")
const base: BrandId = "network"
const tokenImport = '@import "./tokens.css";\n'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const leaves = (value: unknown, path = ""): [string, unknown][] =>
  isRecord(value) ? Object.entries(value).flatMap(([key, each]) => leaves(each, path ? `${path}.${key}` : key)) : [[path, value]]

function runBrand(brand: BrandId, command: "build" | "check"): string[] {
  try {
    if (command === "check") {
      const issues = checkTokenProject(brandDir(brand))
      if (issues.length) return [`${brand}: ${issues.join("\n")}`]
    } else buildTokenProject(brandDir(brand))
    return []
  } catch (error) {
    return [`${brand}: ${error instanceof Error ? error.message : String(error)}`]
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

function brandIdIssues(): string[] {
  const mapped = appKeys.map(designBrandId)
  return [
    ...mapped.filter((id) => !(brandIds as readonly string[]).includes(id)).map((id) => `designBrandId gives ${id}, which is not in src/brands.ts`),
    ...brandIds.filter((brand) => !mapped.includes(brand)).map((brand) => `brands/${brand}: no app has it in designBrandId`),
  ]
}

const brandOfApp = (app: AppKey): BrandId => {
  const id = brandIds.find((brand) => brand === designBrandId(app))
  if (!id) throw new Error(`designBrandId(${app}) is ${designBrandId(app)}, which is not in src/brands.ts`)
  return id
}

type Scheme = "light" | "dark"
type SchemeColors = Record<Scheme, Record<string, string>>
const schemes: Scheme[] = ["light", "dark"]
const colorsOf = (brand: BrandId): SchemeColors => (JSON.parse(read(join(brandDir(brand), "tokens.json"))) as { color: SchemeColors }).color

const accentToken: Record<keyof AccentTokens, [scheme: Scheme, name: "primary" | "primary-foreground"]> = {
  light: ["light", "primary"],
  lightInk: ["light", "primary-foreground"],
  dark: ["dark", "primary"],
  darkInk: ["dark", "primary-foreground"],
}

function accentIssues(): string[] {
  return appKeys.flatMap((app) => {
    const brand = brandOfApp(app)
    const color = colorsOf(brand)
    const accent = accentTokens(brandFor(app).accent)
    return (Object.keys(accentToken) as (keyof AccentTokens)[]).flatMap((key) => {
      const [scheme, name] = accentToken[key]
      const token = color[scheme][name]
      return token === accent[key] ? [] : [`${brand}: color.${scheme}.${name} is ${token}, but accentTokens(${brandFor(app).accent}).${key} is ${accent[key]} (spec/brandIdentity.md)`]
    })
  })
}

const oklch = (value: string): [number, number, number] => {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value)
  if (!match) throw new Error(`${value} is not an opaque oklch color`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
const oklab = (value: string): [number, number, number] => {
  const [l, c, h] = oklch(value)
  return [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
}
const distancePermille = (one: string, other: string): number => {
  const [a, b] = [oklab(one), oklab(other)]
  return Math.floor(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 1000)
}
const luminance = (value: string): number => {
  const [l, a, b] = oklab(value)
  const [lc, mc, sc] = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ]
  const [r, g, bl] = [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}
const contrastTenths = (one: string, other: string): number => {
  const [dark, light] = [luminance(one), luminance(other)].sort((x, y) => x - y) as [number, number]
  return Math.floor(((light + 0.05) / (dark + 0.05)) * 10)
}
const sameHue = (one: string, other: string): boolean => {
  const [, c1, h1] = oklch(one), [, c2, h2] = oklch(other)
  return c1 === 0 || c2 === 0 ? c1 === c2 : h1 === h2
}

function colorRuleIssues(): string[] {
  const ruled = ["background", "primary", "ring", "accent", "inverse", "inverse-foreground", ...stateColors.map(stateToken)]
  return brandIds.flatMap((brand) => schemes.flatMap((scheme) => {
    const color = colorsOf(brand)[scheme]
    const at = `${brand}: color.${scheme}`
    const missing = ruled.filter((name) => !color[name])
    if (missing.length) return missing.map((name) => `${at}.${name} is missing`)
    const { background, primary, ring, accent, inverse } = color as Record<string, string>
    const ink = color["inverse-foreground"]!
    const accentDistance = distancePermille(accent!, primary!)
    const [text, edge] = [contrastTenths(ink, inverse!), contrastTenths(inverse!, background!)]
    return [
      ...(ringIsTheAccent(ring!, primary!) ? [] : [`${at}.ring is ${ring}, but it must equal primary ${primary}`]),
      ...(hoverFillIsClear(accentDistance, sameHue(accent!, primary!)) ? [] : [`${at}.accent ${accent} must have the hue of primary ${primary} and be clear of it: OKLab distance ${accentDistance}/1000`]),
      ...stateColors.map(stateToken).flatMap((name) => {
        const distance = distancePermille(color[name]!, primary!)
        return colorIsClearOfAccent(distance) ? [] : [`${at}.${name} ${color[name]} is too near primary ${primary}: OKLab distance ${distance}/1000`]
      }),
      ...(inverseIsReadable(text, edge) ? [] : [`${at}.inverse: inverse-foreground on inverse is ${text / 10}:1 and inverse on background is ${edge / 10}:1`]),
    ]
  }))
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
  const issues = [...directoryIssues(), ...brandIdIssues(), ...keySetIssues(), ...accentIssues(), ...colorRuleIssues()]
  if (issues.length) return issues
  const failed = brandIds.flatMap((brand) => runBrand(brand, "build"))
  if (failed.length) return failed
  mkdirSync(join(root, "generated"), { recursive: true })
  writeTextIfChanged(join(root, "generated/brands.css"), brandsCss())
  writeTextIfChanged(join(root, "generated/theme.css"), themeCss())
  return []
}

function check(): string[] {
  const issues = [...directoryIssues(), ...brandIdIssues()]
  if (issues.length) return issues
  return [...keySetIssues(), ...accentIssues(), ...colorRuleIssues(), ...brandIds.flatMap((brand) => runBrand(brand, "check"))]
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
