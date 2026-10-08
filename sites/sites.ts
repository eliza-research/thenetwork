// The four app sites. One shared backend serves /api/* for all of them.
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type AppId = "ntwrk" | "slop" | "peon" | "buddies";

export interface Site {
  app: AppId;
  domain: string;
  /** Local dev port for scripts/sites-dev.ts. */
  port: number;
  /** Source pages (HTML, CSS, TS). */
  src: string;
}

const here = import.meta.dir;

/**
 * Security headers for every page (Cloudflare reads dist/_headers; the dev server sends the same).
 * Everything is same-origin: no third-party script, style, font or request. No site may frame a page
 * (the settings page has stop, leave and delete buttons).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export const SITES: Site[] = [
  { app: "ntwrk", domain: "ntwrk.love", port: 5101, src: join(here, "ntwrk.love/public") },
  { app: "slop", domain: "slop.date", port: 5102, src: join(here, "slop.date/public") },
  { app: "peon", domain: "peon.biz", port: 5103, src: join(here, "peon.biz/public") },
  { app: "buddies", domain: "buddies.nyc", port: 5104, src: join(here, "buddies.nyc/public") },
];

export function site(app: string): Site {
  const s = SITES.find((x) => x.app === app || x.domain === app);
  if (!s) throw new Error(`unknown site: ${app}`);
  return s;
}

export function pages(s: Site): string[] {
  return readdirSync(s.src)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((f) => join(s.src, f));
}

/** Builds one site's pages with Bun's HTML bundler. Output: one .html per page plus hashed JS and CSS. */
export async function buildSite(s: Site, outdir: string): Promise<{ ok: boolean; logs: string[] }> {
  rmSync(outdir, { recursive: true, force: true });
  const res = await Bun.build({
    entrypoints: pages(s),
    outdir,
    root: s.src,
    minify: true,
    publicPath: "/",
    target: "browser",
  });
  if (res.success) writeFileSync(join(outdir, "_headers"), `/*\n${Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`).join("\n")}\n`);
  return { ok: res.success, logs: res.logs.map((l) => String(l)) };
}

if (import.meta.main) {
  // bun run sites/sites.ts [app...]   builds into sites/<domain>/dist
  const wanted = process.argv.slice(2);
  let failed = false;
  for (const s of wanted.length ? wanted.map(site) : SITES) {
    const out = join(here, s.domain, "dist");
    const r = await buildSite(s, out);
    console.log(`${r.ok ? "built" : "FAILED"} ${s.domain} -> ${out}`);
    for (const l of r.logs) console.log("  " + l);
    failed ||= !r.ok;
  }
  process.exit(failed ? 1 : 0);
}
