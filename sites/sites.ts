// The four app sites. One shared backend serves /api/*, /mcp and /oauth/* for all of them
// (deploy/router.ts forwards those paths and serves the update handoff). Public pages are built into dist/.
// The pages come from one React app (apps/site), prerendered per brand; this file adds what
// Cloudflare serves as it is: _headers, _worker.js, _routes.json, the skill files and static/.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { build as buildWorker, formatMessages } from "esbuild";
import { parse as parseYaml } from "yaml";
import { mcpUrlFor, skillsConfig } from "./skills.config.ts";
import { RUN_WORKER_FIRST } from "../deploy/router.ts";
import { APPS, stagingSiteOrigins } from "../packages/platform/src/apps.ts";
import { PHOTO_APPS, PHOTO_CONSENT } from "../packages/platform/src/photos.ts";
import { siteApp } from "../apps/site/prerender.ts";
import type { AppKey } from "../packages/core/src/generated/brandIdentity.ts";
import { type SitePage, siteHasPage, sitePageList, skillAllowOrigin, skillCacheSeconds, skillContentType, updateHandoffAssetPath } from "../packages/core/src/generated/sitePages.ts";
import { brandFor } from "../packages/core/src/generated/brandIdentity.ts";
import {
  type AgentSignup,
  type Event as SignupEvent,
  type Transport,
  enabled as signupEnabled,
  endReportFor,
  initial as signupStart,
  inv as signupInvariants,
  reportFor,
  skillKindFor,
  step as signupStep,
  transportFor,
} from "../packages/core/src/generated/agentSignup.ts";

import type { AppId } from "../packages/core/src/types.ts";
export type { AppId };
export { resetSiteApp } from "../apps/site/prerender.ts";

export interface Site {
  app: AppId;
  /** The app in the specs (spec/brandIdentity.md): the brand record, the page set and the landing page read it. */
  key: AppKey;
  domain: string;
  /** The Cloudflare Pages project (founder decision 8): <project>.pages.dev. */
  project: string;
  /** Local dev port for scripts/sites-dev.ts. */
  port: number;
  /** The files that Cloudflare serves as they are (robots.txt, _redirects, .well-known/...). The pages and the favicon come from apps/site. */
  src: string;
  /** Agent Skills name: sites/skills/<skill>/SKILL.md (kebab-case of the domain). */
  skill: string;
}

const here = import.meta.dirname;
export const SKILLS_DIR = join(here, "skills");

/** The only third-party origin a page may load: Cloudflare Turnstile on the phone step. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Security headers for every page (Cloudflare reads dist/_headers; the dev server sends the same).
 * Everything is same-origin except the Turnstile script and frame. No site may frame a page (the
 * signup page has consent controls).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": `default-src 'self'; script-src 'self' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export const SITES: Site[] = [
  { app: "ntwrk", key: "Ntwrk", domain: "ntwrk.party", project: "ntwrk-party", port: 5101, src: join(here, "ntwrk.party/static"), skill: "ntwrk-party" },
  { app: "slop", key: "Slop", domain: "slop.date", project: "slop-date", port: 5102, src: join(here, "slop.date/static"), skill: "slop-date" },
  { app: "peon", key: "Peon", domain: "peon.biz", project: "peon-biz", port: 5103, src: join(here, "peon.biz/static"), skill: "peon-biz" },
  { app: "friends", key: "Friends", domain: "friends.help", project: "friends-help", port: 5104, src: join(here, "friends.help/static"), skill: "friends-help" },
];

export function site(app: string): Site {
  const s = SITES.find((x) => x.app === app || x.domain === app);
  if (!s) throw new Error(`unknown site: ${app}`);
  return s;
}

/** The file that serves each page; Cloudflare Pages serves 404.html for every unknown path. */
export const PAGE_FILES: Record<SitePage, string> = {
  LandingPage: "index.html",
  PrivacyPage: "privacy.html",
  TermsPage: "terms.html",
  NotFoundPage: "404.html",
  JoinPage: "join.html",
  UpdateHandoffPage: updateHandoffAssetPath.slice(1) + ".html",
  PhonePage: "phone.html",
  HomeHelpPage: "home-help.html",
  PhotosAddPage: "photos/add.html",
  PhotosCheckPage: "photos/check.html",
  PhotosMinePage: "photos/mine.html",
  PhotosViewPage: "photos/view.html",
};

/** The pages of one site, including the pages that are specific to one site. */
export function pages(s: Site): SitePage[] {
  return sitePageList.filter((page) => siteHasPage(s.key, page));
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
export function skillText(name: string, env: Record<string, string | undefined> = process.env, dir = SKILLS_DIR): string {
  const s = SITES.find((x) => x.skill === name);
  if (!s) throw new Error(`no site for skill ${name}`);
  return fill(readFileSync(join(dir, name, "SKILL.md"), "utf8"), env, s.domain).replaceAll("\r\n", "\n");
}

/** The frontmatter description of a SKILL.md (one line, no YAML block scalars in our files). */
export function skillDescription(text: string): string {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const parsed = parseYaml(fm) as { description?: unknown } | null;
  return typeof parsed?.description === "string" ? parsed.description : "";
}

/** The metadata.version of a SKILL.md: the landing prompt names it. */
export function skillVersion(text: string): string {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const parsed = parseYaml(fm) as { metadata?: { version?: unknown } } | null;
  const version = parsed?.metadata?.version;
  if (typeof version !== "string" || version === "") throw new Error("the skill has no metadata.version");
  return version;
}

/** One signup step marker of a SKILL.md: `<!-- agentSignup: <event>... -->`, or `<!-- agentSignup <Transport>: <event>... -->` for the steps of one transport. */
export interface SignupMarker { line: number; transport: string | null; event: string }

const SIGNUP_MARKER = /<!--\s*agentSignup(?:\s+(\w+))?\s*:\s*([\w\s]+?)\s*-->/g;

/** The signup step markers of a SKILL.md, in document order (spec/agentSignup.md:9). */
export function signupMarkers(text: string): SignupMarker[] {
  const out: SignupMarker[] = [];
  text.split("\n").forEach((source, index) => {
    for (const m of source.matchAll(SIGNUP_MARKER)) {
      for (const event of m[2]!.split(/\s+/)) out.push({ line: index + 1, transport: m[1] ?? null, event });
    }
  });
  return out;
}

const CONNECTOR_CAPABILITIES = [true, false];

/** The transports a skill of this app reaches when the agent has the capability. */
function skillTransports(s: Site): Transport[] {
  const kind = skillKindFor(s.key);
  return CONNECTOR_CAPABILITIES.map(available => transportFor(kind, available)).filter(t => t !== "NoTransport");
}

/** Map each marked step to its successful app-specific event. */
function successfulEvent(s: Site, event: string, transport: Transport): SignupEvent | undefined {
  const kind = skillKindFor(s.key);
  const inviteOnly = brandFor(s.key).joinMode === "InviteOnly";
  switch (event) {
    case "checkConnectorSetup": return { type: "checkConnectorSetup", clientCanAdd: true };
    case "resumeAfterConnector": return { type: "resumeAfterConnector" };
    case "chooseTransport": return { type: "chooseTransport", skillKind: kind,
      connectorTools: transportFor(kind, true) === transport };
    case "readAppFacts": return { type: "readAppFacts", appMatches: true, inviteMode: inviteOnly };
    case "draftProfile": return { type: "draftProfile", statedAge: "Adult" };
    case "decideApproval": return { type: "decideApproval", decision: "ApproveExact" };
    case "offerHandoff": return { type: "offerHandoff", linkAvailable: true };
    case "observeBrowser": return { type: "observeBrowser",
      result: inviteOnly ? "BrowserNewInvited" : "BrowserNewOpen", appWriteGrant: true };
    case "checkSiteStatus": return { type: "checkSiteStatus", siteApp: true, siteStatus: "SiteActive" };
    case "submitProfile": return { type: "submitProfile", accepted: true };
    case "confirmProfile": return { type: "confirmProfile", stillLive: true };
    default: return undefined;
  }
}

const DIRECT_CREDENTIAL_FLOW = /\/api\/auth\/otp\/(?:start|verify)|session\.cookies/i;

/** Replay the marked signup steps against the generated machine for every supported transport. */
export function signupStepProblems(s: Site, text: string): string[] {
  const markers = signupMarkers(text);
  const transports = skillTransports(s);
  const problems: string[] = [];
  if (DIRECT_CREDENTIAL_FLOW.test(text)) problems.push(`${s.skill}/SKILL.md describes a direct phone sign-in outside the browser`);
  if (markers.length === 0) return [...problems, `${s.skill}/SKILL.md has no agentSignup step markers`];
  for (const m of markers) {
    if (m.transport !== null && !transports.includes(m.transport as Transport)) problems.push(`${s.skill}/SKILL.md:${m.line} marks a step for ${m.transport}, which the ${s.domain} skill does not use (${transports.join(", ")})`);
  }
  for (const transport of transports) {
    let state: AgentSignup = signupStart;
    for (const m of markers.filter(x => x.transport === null || x.transport === transport)) {
      const event = successfulEvent(s, m.event, transport);
      if (!event) { problems.push(`${s.skill}/SKILL.md:${m.line} names "${m.event}", which is not a step of a successful signup`); break; }
      if (!signupEnabled(state, event)) { problems.push(`${s.skill}/SKILL.md:${m.line}: the agentSignup model does not allow "${m.event}" in phase ${state.phase} (${transport})`); break; }
      state = signupStep(state, event);
      if (!signupInvariants(state)) { problems.push(`${s.skill}/SKILL.md:${m.line}: "${m.event}" breaks an agentSignup rule (${transport})`); break; }
    }
    if (problems.length) break;
    const want = endReportFor(transport);
    const got = reportFor(state.phase);
    if (got !== want) problems.push(`${s.skill}/SKILL.md: the ${transport} steps end in phase ${state.phase} (${got}), not at ${want}`);
  }
  if (!problems.length && transportFor(skillKindFor(s.key), false) === "NoTransport") {
    let state: AgentSignup = signupStart;
    for (const m of markers.filter(x => x.transport === null)) {
      const event = successfulEvent(s, m.event, "NoTransport");
      if (!event || !signupEnabled(state, event)) { problems.push(`${s.skill}/SKILL.md:${m.line}: the agentSignup model does not allow "${m.event}" in phase ${state.phase} (NoTransport)`); break; }
      state = signupStep(state, event);
      if (!signupInvariants(state)) { problems.push(`${s.skill}/SKILL.md:${m.line}: "${m.event}" breaks an agentSignup rule (NoTransport)`); break; }
      if (reportFor(state.phase) !== "ReportWorking") break;
    }
    const want = endReportFor("NoTransport");
    if (!problems.length && reportFor(state.phase) !== want) problems.push(`${s.skill}/SKILL.md: without connector tools the steps end in phase ${state.phase}, not at ${want}`);
  }
  return problems;
}

/** Files that may hold placeholders. Bundled JS and CSS never do (minified JS can contain "{{" legitimately). */
const TEXT = /\.(html|md|txt|json|xml)$/;

const PRODUCTION_HUB_MCP = mcpUrlFor("ntwrk.party", {});

/** Placeholders that the build fills: {{BACKEND_ORIGIN}}, {{MCP_URL}} (this site's MCP endpoint), {{TEXT_LINE}} and {{TURNSTILE_SITE_KEY}}. */
export function fill(text: string, env: Record<string, string | undefined> = process.env, domain = "ntwrk.party"): string {
  const cfg = skillsConfig(env);
  const key = turnstileKey(env);
  let filled = text
    .replaceAll("{{BACKEND_ORIGIN}}", cfg.BACKEND_ORIGIN)
    .replaceAll("{{MCP_URL}}", mcpUrlFor(domain, env))
    .replaceAll("{{TEXT_LINE}}", cfg.TEXT_LINE)
    .replaceAll("{{TURNSTILE_SITE_KEY}}", key);
  const hubMcp = mcpUrlFor("ntwrk.party", env);
  if (hubMcp !== PRODUCTION_HUB_MCP) {
    const hubBase = hubMcp.endsWith("/mcp") ? hubMcp.slice(0, -"/mcp".length) : new URL(hubMcp).origin;
    filled = filled
      .replace(/https:\/\/ntwrk\.party\/mcp(?=[/\s"'`<>?#)]|$)/g, hubMcp)
      .replace(/https:\/\/ntwrk\.party\/oauth(?=[/\s"'`<>?#)]|$)/g, `${hubBase}/oauth`);
  }
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

/** The public Turnstile site key of this build, or "" for none. */
function turnstileKey(env: Record<string, string | undefined>): string {
  const key = (env.TURNSTILE_SITE_KEY ?? "").trim();
  if (key && !/^[0-9A-Za-z_-]{1,64}$/.test(key)) throw new Error("TURNSTILE_SITE_KEY has unexpected characters");
  return key;
}

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

function write(path: string, body: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** dist/_headers: the security headers on every path, plus types, CORS and caching for the skill files. */
export function headersFile(): string {
  const all = Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  const skill = `  Access-Control-Allow-Origin: ${skillAllowOrigin}\n  Cache-Control: public, max-age=${skillCacheSeconds}`;
  return [
    `/*\n${all}`,
    `/SKILL.md\n  Content-Type: ${skillContentType("RootSkill")}\n${skill}`,
    `/.well-known/agent-skills/index.json\n  Content-Type: ${skillContentType("CatalogIndex")}\n${skill}`,
    `/.well-known/agent-skills/*/SKILL.md\n  Content-Type: ${skillContentType("CatalogSkill")}\n${skill}`,
  ].join("\n\n") + "\n";
}

/**
 * The agent skill files (docs/research/2026-10-08-skills-plugins-deploy.md 2.2): the site's own skill at
 * /SKILL.md and /.well-known/agent-skills/<name>/SKILL.md, and an index with a sha256 digest of the
 * exact bytes. ntwrk.party is the hub: its index lists every app's skill.
 */
function writeSkills(s: Site, outdir: string, env: Record<string, string | undefined>, dir: string): string[] {
  const listed = s.app === "ntwrk" ? SITES : [s];
  const problems = listed.flatMap((x) => signupStepProblems(x, skillText(x.skill, env, dir)));
  if (problems.length) return problems;
  const skills = listed.map((x) => {
    const text = skillText(x.skill, env, dir);
    write(join(outdir, ".well-known/agent-skills", x.skill, "SKILL.md"), text);
    return { name: x.skill, type: "skill-md", description: skillDescription(text), url: `/.well-known/agent-skills/${x.skill}/SKILL.md`, digest: `sha256:${sha256(text)}` };
  });
  write(join(outdir, "SKILL.md"), skillText(s.skill, env, dir));
  write(join(outdir, ".well-known/agent-skills/index.json"), JSON.stringify({ $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json", skills }, null, 2) + "\n");
  return [];
}

/** The router every site runs on its backend paths (Pages advanced mode _worker.js): an entry with the default export only. */
export const ROUTER = join(here, "../deploy/pages-worker.ts");
/** dist/_routes.json for Cloudflare Pages: the public paths that run the Worker. */
export const routesFile = (): string => JSON.stringify({ version: 1, include: RUN_WORKER_FIRST, exclude: [] }, null, 2) + "\n";

/** Words that must never ship in a production build (audit sites-infra-14). */
export const DRAFT_MARKERS = [/\bDraft\b/, /Not yet in effect/i];

/**
 * Builds one site: the site app's client files (built once per process, shared by every site), one
 * prerendered page for each page of the site, the hashed favicon drawn from the brand mark, then the files
 * Cloudflare serves as they are: sites/<domain>/static/ (robots.txt, _redirects, .well-known/...), _headers, the router and
 * the skill files. Placeholders are filled in every text file, and a leftover "{{" fails the build.
 */
export async function buildSite(s: Site, outdir: string, env: Record<string, string | undefined> = process.env, skillsDir = SKILLS_DIR): Promise<{ ok: boolean; logs: string[] }> {
  rmSync(outdir, { recursive: true, force: true });
  const logs: string[] = [];
  try {
    const app = await siteApp();
    cpSync(app.clientDir, outdir, { recursive: true, filter: (from) => relative(app.clientDir, from) !== "index.html" });
    const icon = app.favicon(s.key);
    const favicon = `/favicon-${sha256(icon).slice(0, 8)}.svg`;
    write(join(outdir, favicon.slice(1)), icon);
    const cfg = skillsConfig(env);
    const stagingOrigin = stagingSiteOrigins(env)[s.app];
    const siteHost = stagingOrigin ? new URL(stagingOrigin).host : "";
    const input = {
      favicon,
      siteHost,
      skillVersion: skillVersion(skillText(s.skill, env, skillsDir)),
      textLine: cfg.TEXT_LINE,
      minJoinAge: APPS[s.app].minJoinAge,
      consentText: APPS[s.app].consent.text,
      turnstileSiteKey: turnstileKey(env),
      photoConsentText: PHOTO_APPS.includes(s.app) ? PHOTO_CONSENT.text : "",
      photoConsentVersion: PHOTO_APPS.includes(s.app) ? PHOTO_CONSENT.version : "",
    };
    for (const page of pages(s)) write(join(outdir, PAGE_FILES[page]), app.page(s.key, page, input));
    if (existsSync(s.src)) cpSync(s.src, outdir, { recursive: true });
    write(join(outdir, "_headers"), headersFile());
    // Cloudflare Pages advanced mode: _worker.js is the router, and _routes.json lists the paths that run it.
    const worker = await buildWorker({
      entryPoints: [ROUTER], bundle: true, platform: "browser", format: "esm", minify: true,
      outfile: join(outdir, "_worker.js"), write: false, logLevel: "silent",
      define: { __SITE_APP_ID__: JSON.stringify(s.app), __SITE_HOST__: JSON.stringify(siteHost || s.domain), __SITE_BACKEND_ORIGIN__: JSON.stringify(cfg.BACKEND_ORIGIN) },
    });
    logs.push(...await formatMessages(worker.warnings, { kind: "warning" }));
    if (worker.outputFiles.length !== 1) return { ok: false, logs: [...logs, "the router bundle (_worker.js) failed"] };
    write(join(outdir, "_worker.js"), worker.outputFiles[0]!.text);
    write(join(outdir, "_routes.json"), routesFile());
    const skillProblems = writeSkills(s, outdir, env, skillsDir);
    if (skillProblems.length) return { ok: false, logs: [...logs, ...skillProblems] };
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
  // pnpm run sites:build [app...]   builds into sites/<domain>/dist
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
