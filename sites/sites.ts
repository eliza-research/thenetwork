// The four app sites. One shared backend serves /api/*, /mcp and /oauth/* for all of them
// (deploy/router.ts forwards those paths; everything else is a static file from dist/).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { mcpUrlFor, skillsConfig } from "./skills.config.ts";
import { RUN_WORKER_FIRST } from "../deploy/router.ts";
import { stagingSiteOrigins } from "../packages/platform/src/apps.ts";

export type AppId = "ntwrk" | "slop" | "peon" | "friends";

export interface Site {
  app: AppId;
  domain: string;
  /** The Cloudflare Pages project (founder decision 8): <project>.pages.dev. */
  project: string;
  /** Local dev port for scripts/sites-dev.ts. */
  port: number;
  /** Source pages (HTML, CSS, TS). */
  src: string;
  /** Agent Skills name: sites/skills/<skill>/SKILL.md (kebab-case of the domain). */
  skill: string;
}

const here = import.meta.dir;
export const SKILLS_DIR = join(here, "skills");

/** The only third-party origin a page may load: Cloudflare Turnstile on the phone step. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Security headers for every page (Cloudflare reads dist/_headers; the dev server sends the same).
 * Everything is same-origin except the Turnstile script and frame. No site may frame a page (the
 * settings page has stop, leave and delete buttons).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": `default-src 'self'; script-src 'self' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export const SITES: Site[] = [
  { app: "ntwrk", domain: "ntwrk.party", project: "ntwrk-party", port: 5101, src: join(here, "ntwrk.party/public"), skill: "ntwrk-party" },
  { app: "slop", domain: "slop.date", project: "slop-date", port: 5102, src: join(here, "slop.date/public"), skill: "slop-date" },
  { app: "peon", domain: "peon.biz", project: "peon-biz", port: 5103, src: join(here, "peon.biz/public"), skill: "peon-biz" },
  { app: "friends", domain: "friends.help", project: "friends-help", port: 5104, src: join(here, "friends.help/public"), skill: "friends-help" },
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

/** Files under a directory, recursively, as paths relative to it (dot-folders such as .well-known included). */
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full).map((f) => join(e.name, f)));
    else if (e.isFile()) out.push(e.name);
  }
  return out.sort();
}

/** The SKILL.md for a skill name with the config values filled in. */
export function skillText(name: string, env: Record<string, string | undefined> = process.env): string {
  const s = SITES.find((x) => x.skill === name);
  if (!s) throw new Error(`no site for skill ${name}`);
  return fill(readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8"), env, s.domain);
}

/** The frontmatter description of a SKILL.md (one line, no YAML block scalars in our files). */
export function skillDescription(text: string): string {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const parsed = Bun.YAML.parse(fm) as { description?: unknown };
  return typeof parsed.description === "string" ? parsed.description : "";
}

/** Files that may hold placeholders. Bundled JS and CSS never do (minified JS can contain "{{" legitimately). */
const TEXT = /\.(html|md|txt|json|xml)$/;

/** Placeholders that the build fills: {{BACKEND_ORIGIN}}, {{MCP_URL}} (this site's MCP endpoint) and {{TURNSTILE_SITE_KEY}}. */
export function fill(text: string, env: Record<string, string | undefined> = process.env, domain = "ntwrk.party"): string {
  const cfg = skillsConfig(env);
  const key = (env.TURNSTILE_SITE_KEY ?? "").trim();
  if (key && !/^[0-9A-Za-z_-]{1,64}$/.test(key)) throw new Error("TURNSTILE_SITE_KEY has unexpected characters");
  let filled = text
    .replaceAll("{{BACKEND_ORIGIN}}", cfg.BACKEND_ORIGIN)
    .replaceAll("{{MCP_URL}}", mcpUrlFor(domain, env))
    .replaceAll("{{TURNSTILE_SITE_KEY}}", key);
  const staging = stagingSiteOrigins(env);
  if (Object.keys(staging).length) {
    // Rewrite exact app URL authorities only, including the encoded URLs inside agent prompts.
    // Names, emails, source directories, projects and other external links keep their identity.
    for (const site of SITES) {
      const canonical = `https://${site.domain}`;
      const stage = staging[site.app];
      if (!stage) throw new Error(`staging site builds need an origin for ${site.app}`);
      const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filled = filled.replace(new RegExp(`${escaped}(?=[/\\s"'<>?#)]|$)`, "g"), stage);
      const encoded = encodeURIComponent(canonical).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filled = filled.replace(new RegExp(`${encoded}(?=%2F|%3F|%23|%20|["'<>\\s&]|$)`, "g"), encodeURIComponent(stage));
    }
  }
  return filled;
}

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** dist/_headers: the security headers on every path, plus types, CORS and caching for the skill files. */
export function headersFile(): string {
  const all = Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  const skill = "  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300";
  return [
    `/*\n${all}`,
    `/SKILL.md\n  Content-Type: text/markdown; charset=utf-8\n${skill}`,
    `/.well-known/agent-skills/index.json\n  Content-Type: application/json\n${skill}`,
    `/.well-known/agent-skills/*/SKILL.md\n  Content-Type: text/markdown; charset=utf-8\n${skill}`,
  ].join("\n\n") + "\n";
}

/**
 * The agent skill files (docs/research/2026-10-08-skills-plugins-deploy.md 2.2): the site's own skill at
 * /SKILL.md and /.well-known/agent-skills/<name>/SKILL.md, and an index with a sha256 digest of the
 * exact bytes. ntwrk.party is the hub: its index lists every app's skill.
 */
function writeSkills(s: Site, outdir: string, env: Record<string, string | undefined>): void {
  const listed = s.app === "ntwrk" ? SITES : [s];
  const skills = listed.map((x) => {
    const text = skillText(x.skill, env);
    write(join(outdir, ".well-known/agent-skills", x.skill, "SKILL.md"), text);
    return { name: x.skill, type: "skill-md", description: skillDescription(text), url: `/.well-known/agent-skills/${x.skill}/SKILL.md`, digest: `sha256:${sha256(text)}` };
  });
  write(join(outdir, "SKILL.md"), skillText(s.skill, env));
  write(join(outdir, ".well-known/agent-skills/index.json"), JSON.stringify({ $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json", skills }, null, 2) + "\n");
}

/** The router every site runs on its backend paths (Pages advanced mode _worker.js): an entry with the default export only. */
export const ROUTER = join(here, "../deploy/pages-worker.ts");
/** dist/_routes.json for Cloudflare Pages: the Worker runs on the backend paths only (deploy/router.ts RUN_WORKER_FIRST). */
export const routesFile = (): string => JSON.stringify({ version: 1, include: RUN_WORKER_FIRST, exclude: [] }, null, 2) + "\n";

/** Words that must never ship in a production build (audit sites-infra-14). */
export const DRAFT_MARKERS = [/\bDraft\b/, /Not yet in effect/i];

/**
 * Builds one site: Bun's HTML bundler for the pages, then the files Cloudflare serves as they are:
 * sites/<domain>/static/ (robots.txt, _redirects, .well-known/...), _headers and the skill files.
 * Placeholders are filled in every text file, and a leftover "{{" fails the build.
 */
export async function buildSite(s: Site, outdir: string, env: Record<string, string | undefined> = process.env): Promise<{ ok: boolean; logs: string[] }> {
  rmSync(outdir, { recursive: true, force: true });
  const res = await Bun.build({
    entrypoints: pages(s),
    outdir,
    root: s.src,
    minify: true,
    publicPath: "/",
    target: "browser",
  });
  const logs = res.logs.map((l) => String(l));
  if (!res.success) return { ok: false, logs };
  try {
    // Bun emits an empty module for a page with no script of its own. Drop it and its <script> tag.
    const empty = readdirSync(outdir).filter((f) => f.endsWith(".js") && statSync(join(outdir, f)).size === 0);
    for (const f of empty) rmSync(join(outdir, f));
    if (empty.length) {
      for (const f of readdirSync(outdir).filter((x) => x.endsWith(".html"))) {
        const html = readFileSync(join(outdir, f), "utf8");
        const out = empty.reduce((h, js) => h.replace(new RegExp(`<script[^>]*src="/${js.replace(".", "\\.")}"[^>]*></script>`, "g"), ""), html);
        if (out !== html) writeFileSync(join(outdir, f), out);
      }
    }
    const staticDir = join(dirname(s.src), "static");
    if (existsSync(staticDir)) cpSync(staticDir, outdir, { recursive: true });
    write(join(outdir, "_headers"), headersFile());
    // Cloudflare Pages advanced mode: _worker.js is the router, and _routes.json runs it only on the
    // backend paths (every other path is a static file, served without the Worker).
    const stagingOrigin = stagingSiteOrigins(env)[s.app];
    const worker = await Bun.build({
      entrypoints: [ROUTER], target: "browser", format: "esm", minify: true,
      define: { __SITE_APP_ID__: JSON.stringify(s.app), __SITE_HOST__: JSON.stringify(stagingOrigin ? new URL(stagingOrigin).host : s.domain), __SITE_BACKEND_ORIGIN__: JSON.stringify(skillsConfig(env).BACKEND_ORIGIN) },
    });
    if (!worker.success || worker.outputs.length !== 1) return { ok: false, logs: [...logs, ...worker.logs.map(String), "the router bundle (_worker.js) failed"] };
    write(join(outdir, "_worker.js"), await worker.outputs[0]!.text());
    write(join(outdir, "_routes.json"), routesFile());
    writeSkills(s, outdir, env);
    const problems: string[] = [];
    for (const f of walk(outdir)) {
      const full = join(outdir, f);
      if (statSync(full).size === 0) problems.push(`${f} is empty`);
      if (!TEXT.test(f)) continue;
      const before = readFileSync(full, "utf8");
      const after = fill(before, env, s.domain);
      if (after !== before) writeFileSync(full, after);
      if (after.includes("{{")) problems.push(`${f} has an unfilled {{placeholder}}`);
      if (env.DEPLOY_TARGET === "production" && f.endsWith(".html")) {
        for (const m of DRAFT_MARKERS) if (m.test(after)) problems.push(`${f} says ${m} (draft legal text cannot ship to production)`);
      }
    }
    if (env.DEPLOY_TARGET === "production" && !env.TURNSTILE_SITE_KEY) logs.push(`warning: ${s.domain}: no TURNSTILE_SITE_KEY; the phone step shows no check and a production API that requires Turnstile refuses codes`);
    if (problems.length) return { ok: false, logs: [...logs, ...problems.map((p) => `${relative(here, outdir)}: ${p}`)] };
  } catch (e) {
    return { ok: false, logs: [...logs, (e as Error).message] };
  }
  return { ok: true, logs };
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
