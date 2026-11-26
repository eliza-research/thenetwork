import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ThemeBrandId = "network" | "slop" | "peon" | "friends";
export type MarketingBrandId = ThemeBrandId | "ntwrk" | "eliza" | "all";

export interface DesignColorPalette {
  background: string;
  foreground: string;
  card: string;
  "card-foreground": string;
  popover: string;
  "popover-foreground": string;
  primary: string;
  "primary-foreground": string;
  secondary: string;
  "secondary-foreground": string;
  muted: string;
  "muted-foreground": string;
  accent: string;
  "accent-foreground": string;
  destructive: string;
  "destructive-foreground": string;
  border: string;
  input: string;
  ring: string;
  ok: string;
  warn: string;
  info: string;
  inverse: string;
  "inverse-foreground": string;
}

export interface BrandTokenSet {
  color: {
    light: DesignColorPalette;
    dark: DesignColorPalette;
  };
  radius: string;
  font: {
    sans: string;
    mono: string;
  };
  shadow: {
    sm: string;
    md: string;
    lg: string;
  };
  motion: {
    duration: {
      fast: string;
      base: string;
      slow: string;
    };
    ease: {
      standard: string;
      out: string;
    };
  };
  breakpoint: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
}

export interface BrandMeta {
  readonly id: MarketingBrandId;
  readonly designBrand: ThemeBrandId;
  readonly domain: string;
  readonly label: string;
}

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, "../../../..");
const DESIGN_SYSTEM_BRANDS_DIR = resolve(REPO_ROOT, "packages/design-system/brands");
const HOST_GROTESK_FONT_PATH = resolve(REPO_ROOT, "apps/site/public/fonts/host-grotesk.woff2");

const FALLBACK_NETWORK_TOKENS: BrandTokenSet = {
  color: {
    light: {
      background: "oklch(0.985 0 0)",
      foreground: "oklch(0.16 0 0)",
      card: "oklch(1 0 0)",
      "card-foreground": "oklch(0.16 0 0)",
      popover: "oklch(1 0 0)",
      "popover-foreground": "oklch(0.16 0 0)",
      primary: "oklch(0.16 0 0)",
      "primary-foreground": "oklch(0.985 0 0)",
      secondary: "oklch(0.955 0 0)",
      "secondary-foreground": "oklch(0.16 0 0)",
      muted: "oklch(0.955 0 0)",
      "muted-foreground": "oklch(0.43 0 0)",
      accent: "oklch(0.93 0 0)",
      "accent-foreground": "oklch(0.16 0 0)",
      destructive: "oklch(0.5 0.18 27)",
      "destructive-foreground": "oklch(0.985 0 0)",
      border: "oklch(0.87 0 0)",
      input: "oklch(0.6 0 0)",
      ring: "oklch(0.16 0 0)",
      ok: "oklch(0.5 0.13 150)",
      warn: "oklch(0.53 0.13 55)",
      info: "oklch(0.5 0.13 255)",
      inverse: "oklch(0.16 0 0)",
      "inverse-foreground": "oklch(0.985 0 0)",
    },
    dark: {
      background: "oklch(0.15 0 0)",
      foreground: "oklch(0.96 0 0)",
      card: "oklch(0.19 0 0)",
      "card-foreground": "oklch(0.96 0 0)",
      popover: "oklch(0.19 0 0)",
      "popover-foreground": "oklch(0.96 0 0)",
      primary: "oklch(0.96 0 0)",
      "primary-foreground": "oklch(0.15 0 0)",
      secondary: "oklch(0.24 0 0)",
      "secondary-foreground": "oklch(0.96 0 0)",
      muted: "oklch(0.24 0 0)",
      "muted-foreground": "oklch(0.74 0 0)",
      accent: "oklch(0.28 0 0)",
      "accent-foreground": "oklch(0.96 0 0)",
      destructive: "oklch(0.71 0.166 22)",
      "destructive-foreground": "oklch(0.15 0 0)",
      border: "oklch(0.3 0 0)",
      input: "oklch(0.52 0 0)",
      ring: "oklch(0.96 0 0)",
      ok: "oklch(0.78 0.17 150)",
      warn: "oklch(0.82 0.15 75)",
      info: "oklch(0.82 0.09 253)",
      inverse: "oklch(0.96 0 0)",
      "inverse-foreground": "oklch(0.15 0 0)",
    },
  },
  radius: "0.75rem",
  font: {
    sans: '"Host Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  shadow: {
    sm: "0 1px 2px oklch(0 0 0 / 0.08)",
    md: "0 4px 12px oklch(0 0 0 / 0.12)",
    lg: "0 12px 32px oklch(0 0 0 / 0.18)",
  },
  motion: {
    duration: {
      fast: "160ms",
      base: "200ms",
      slow: "620ms",
    },
    ease: {
      standard: "cubic-bezier(0.22, 1, 0.36, 1)",
      out: "cubic-bezier(0.16, 1, 0.3, 1)",
    },
  },
  breakpoint: {
    sm: "30rem",
    md: "48rem",
    lg: "64rem",
    xl: "70rem",
  },
};

function loadBrandTokens(brand: ThemeBrandId): BrandTokenSet {
  try {
    const raw = readFileSync(resolve(DESIGN_SYSTEM_BRANDS_DIR, brand, "tokens.json"), "utf8");
    const parsed = JSON.parse(raw) as BrandTokenSet;
    return {
      ...parsed,
      font: {
        sans: parsed.font.sans,
        mono: `"JetBrains Mono", ${parsed.font.mono}`,
      },
    };
  } catch {
    return FALLBACK_NETWORK_TOKENS;
  }
}

export const MARKETING_BRAND_TOKENS: Readonly<Record<ThemeBrandId, BrandTokenSet>> = {
  network: loadBrandTokens("network"),
  slop: loadBrandTokens("slop"),
  peon: loadBrandTokens("peon"),
  friends: loadBrandTokens("friends"),
};

export const MARKETING_BRAND_META: Readonly<Record<MarketingBrandId, BrandMeta>> = {
  network: { id: "network", designBrand: "network", domain: "ntwrk.party", label: "ntwrk.party" },
  ntwrk: { id: "ntwrk", designBrand: "network", domain: "ntwrk.party", label: "ntwrk.party" },
  slop: { id: "slop", designBrand: "slop", domain: "slop.date", label: "slop.date" },
  peon: { id: "peon", designBrand: "peon", domain: "peon.biz", label: "peon.biz" },
  friends: { id: "friends", designBrand: "friends", domain: "friends.help", label: "friends.help" },
  eliza: { id: "eliza", designBrand: "network", domain: "eliza.app", label: "eliza.app" },
  all: { id: "all", designBrand: "network", domain: "ntwrk.party", label: "All Apps" },
};

let cachedFontBytes: Buffer | null | undefined;

export function loadHostGroteskFont(): Buffer | null {
  if (cachedFontBytes !== undefined) return cachedFontBytes;
  try {
    cachedFontBytes = readFileSync(HOST_GROTESK_FONT_PATH);
  } catch {
    cachedFontBytes = null;
  }
  return cachedFontBytes;
}

function paletteVars(palette: DesignColorPalette): string {
  return (Object.entries(palette) as [keyof DesignColorPalette, string][])
    .map(([key, value]) => `  --${key}: ${value};`)
    .join("\n");
}

function brandAccentVars(mode: "light" | "dark"): string {
  const n = MARKETING_BRAND_TOKENS.network.color[mode];
  const s = MARKETING_BRAND_TOKENS.slop.color[mode];
  const p = MARKETING_BRAND_TOKENS.peon.color[mode];
  const f = MARKETING_BRAND_TOKENS.friends.color[mode];
  return [
    `  --brand-network: ${n.primary};`,
    `  --brand-network-fg: ${n["primary-foreground"]};`,
    `  --brand-slop: ${s.primary};`,
    `  --brand-slop-fg: ${s["primary-foreground"]};`,
    `  --brand-slop-accent: ${s.accent};`,
    `  --brand-peon: ${p.primary};`,
    `  --brand-peon-fg: ${p["primary-foreground"]};`,
    `  --brand-peon-accent: ${p.accent};`,
    `  --brand-friends: ${f.primary};`,
    `  --brand-friends-fg: ${f["primary-foreground"]};`,
    `  --brand-friends-accent: ${f.accent};`,
    `  --brand-eliza: ${n.primary};`,
    `  --brand-eliza-fg: ${n["primary-foreground"]};`,
  ].join("\n");
}

export function renderTokensCss(): string {
  const base = MARKETING_BRAND_TOKENS.network;
  const brandOverrides = (["slop", "peon", "friends", "network"] as const)
    .map((brand) => {
      const t = MARKETING_BRAND_TOKENS[brand];
      return [
        `[data-brand="${brand}"] {`,
        `  --primary: ${t.color.light.primary};`,
        `  --primary-foreground: ${t.color.light["primary-foreground"]};`,
        `  --accent: ${t.color.light.accent};`,
        `  --accent-foreground: ${t.color.light["accent-foreground"]};`,
        `  --ring: ${t.color.light.ring};`,
        `}`,
        `[data-theme="dark"] [data-brand="${brand}"] {`,
        `  --primary: ${t.color.dark.primary};`,
        `  --primary-foreground: ${t.color.dark["primary-foreground"]};`,
        `  --accent: ${t.color.dark.accent};`,
        `  --accent-foreground: ${t.color.dark["accent-foreground"]};`,
        `  --ring: ${t.color.dark.ring};`,
        `}`,
      ].join("\n");
    })
    .join("\n");

  return [
    `@font-face {`,
    `  font-family: "Host Grotesk";`,
    `  src: url("/fonts/host-grotesk.woff2") format("woff2");`,
    `  font-weight: 300 800;`,
    `  font-display: swap;`,
    `}`,
    `:root, [data-theme="light"] {`,
    `  color-scheme: light;`,
    paletteVars(base.color.light),
    brandAccentVars("light"),
    `  --radius: ${base.radius};`,
    `  --radius-sm: calc(${base.radius} - 0.375rem);`,
    `  --radius-md: calc(${base.radius} - 0.25rem);`,
    `  --radius-lg: ${base.radius};`,
    `  --radius-xl: calc(${base.radius} + 0.25rem);`,
    `  --font-sans: ${base.font.sans};`,
    `  --font-mono: ${base.font.mono};`,
    `  --shadow-sm: ${base.shadow.sm};`,
    `  --shadow-md: ${base.shadow.md};`,
    `  --shadow-lg: ${base.shadow.lg};`,
    `  --duration-fast: ${base.motion.duration.fast};`,
    `  --duration-base: ${base.motion.duration.base};`,
    `  --duration-slow: ${base.motion.duration.slow};`,
    `  --ease-standard: ${base.motion.ease.standard};`,
    `  --ease-out: ${base.motion.ease.out};`,
    `  --space-1: 0.25rem;`,
    `  --space-2: 0.5rem;`,
    `  --space-3: 0.75rem;`,
    `  --space-4: 1rem;`,
    `  --space-5: 1.25rem;`,
    `  --space-6: 1.5rem;`,
    `}`,
    `[data-theme="dark"] {`,
    `  color-scheme: dark;`,
    paletteVars(base.color.dark),
    brandAccentVars("dark"),
    `}`,
    `@media (prefers-color-scheme: dark) {`,
    `  :root:not([data-theme="light"]) {`,
    `    color-scheme: dark;`,
    paletteVars(base.color.dark),
    brandAccentVars("dark"),
    `  }`,
    `}`,
    brandOverrides,
  ].join("\n");
}
