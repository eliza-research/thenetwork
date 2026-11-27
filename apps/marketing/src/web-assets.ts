import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import tailwindcss from "@tailwindcss/postcss";
import { build, buildSync } from "esbuild";
import postcss from "postcss";

const webDir = new URL("../web/", import.meta.url);
const stylesheetPath = fileURLToPath(new URL("styles.css", webDir));
const indexHtmlPath = fileURLToPath(new URL("index.html", webDir));
const hostGroteskPath = fileURLToPath(new URL("../../../apps/site/public/fonts/host-grotesk.woff2", import.meta.url));
const fallbackBrandsCssPath = fileURLToPath(new URL("../../../packages/design-system/generated/brands.css", import.meta.url));

export interface PrecompressedMarketingAsset {
  readonly contentType: string;
  readonly raw: Buffer;
  readonly gzipped: Buffer;
  readonly etag: string;
  readonly cacheControl: string;
}

export interface MarketingWebAssets {
  readonly html: string;
  readonly css: PrecompressedMarketingAsset;
  readonly js: PrecompressedMarketingAsset;
  readonly font: PrecompressedMarketingAsset | null;
  readonly securityHeaders: (opts?: { nonce?: string }) => Record<string, string>;
}

function buildPrecompressed(
  content: string | Uint8Array,
  contentType: string,
  cacheControl: string,
): PrecompressedMarketingAsset {
  const raw = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  const gzipped = gzipSync(raw);
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return {
    contentType,
    raw,
    gzipped,
    etag: `"${hash}"`,
    cacheControl,
  };
}

export function commandCenterSecurityHeaders(opts?: { nonce?: string }): Record<string, string> {
  const noncePart = opts?.nonce ? ` 'nonce-${opts.nonce}'` : "";
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self'${noncePart}`,
      `style-src 'self' 'unsafe-inline'${noncePart}`,
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  };
}

export function loadHostGroteskFont(): Uint8Array | null {
  if (!existsSync(hostGroteskPath)) return null;
  return new Uint8Array(readFileSync(hostGroteskPath));
}

let cachedAssets: { development: boolean; value: MarketingWebAssets } | null = null;

export async function buildMarketingAssets(development = false): Promise<MarketingWebAssets> {
  if (!development && cachedAssets && !cachedAssets.development) {
    return cachedAssets.value;
  }
  const [html, fontBytes, bundleResult, cssResult] = await Promise.all([
    readFile(indexHtmlPath, "utf8"),
    existsSync(hostGroteskPath) ? readFile(hostGroteskPath) : Promise.resolve(null),
    build({
      absWorkingDir: fileURLToPath(webDir),
      entryPoints: ["main.tsx"],
      outfile: "dist/app.js",
      write: false,
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      minify: !development,
      jsx: "automatic",
    }),
    readFile(stylesheetPath, "utf8").then((source) =>
      postcss([tailwindcss({ base: fileURLToPath(webDir), optimize: !development })]).process(source, {
        from: stylesheetPath,
      }),
    ),
  ]);

  const jsFile = bundleResult.outputFiles.find((file) => file.path.endsWith(".js"));
  const jsText = jsFile ? jsFile.text : "";
  const cssText = cssResult.css;

  const assets: MarketingWebAssets = {
    html,
    css: buildPrecompressed(cssText, "text/css; charset=utf-8", "public, max-age=300, must-revalidate"),
    js: buildPrecompressed(jsText, "application/javascript; charset=utf-8", "public, max-age=300, must-revalidate"),
    font: fontBytes
      ? buildPrecompressed(fontBytes, "font/woff2", "public, max-age=86400, must-revalidate")
      : null,
    securityHeaders: commandCenterSecurityHeaders,
  };

  if (!development) {
    cachedAssets = { development, value: assets };
  }
  return assets;
}

export function renderMarketingHtml(): string {
  return cachedAssets?.value.html ?? readFileSync(indexHtmlPath, "utf8");
}

export function renderCommandCenterHtml(): string {
  return renderMarketingHtml();
}

export function renderCommandCenterCss(): string {
  if (cachedAssets) return cachedAssets.value.css.raw.toString("utf8");
  if (existsSync(fallbackBrandsCssPath)) return readFileSync(fallbackBrandsCssPath, "utf8");
  return ":root { --background: oklch(0.985 0 0); }";
}

export function renderCommandCenterJs(): string {
  if (cachedAssets) return cachedAssets.value.js.raw.toString("utf8");
  const built = buildSync({
    absWorkingDir: fileURLToPath(webDir),
    entryPoints: ["main.tsx"],
    outfile: "dist/app.js",
    write: false,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    minify: true,
    jsx: "automatic",
  });
  return built.outputFiles[0]?.text ?? "";
}
