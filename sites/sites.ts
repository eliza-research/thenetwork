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
import { siteApp } from "../apps/site/prerender.ts";
import type { AppKey } from "../packages/core/src/generated/brandIdentity.ts";
import { type SitePage, siteHasPage, sitePageList, skillAllowOrigin, skillCacheSeconds, skillContentType, updateHandoffAssetPath } from "../packages/core/src/generated/sitePages.ts";
import { brandFor } from "../packages/core/src/generated/brandIdentity.ts";
import {
  type AgeBand,
  type AgentSignup,
  type BrowserResult,
  type Event as SignupEvent,
  type SignupReport,
  type SiteStatus,
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
import type { Approval } from "../packages/core/src/generated/agentPhoneHandoff.ts";

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
 * The image sources of a site. Only a site with the photo pages (slop.date) allows `blob:`, because those pages show the photo
 * bytes from object URLs in memory. Every other site keeps `'self' data:`.
 */
export function imageSources(app: AppKey): string {
  return siteHasPage(app, "PhotosViewPage") ? "'self' data: blob:" : "'self' data:";
}

/**
 * Security headers for every page of a site (Cloudflare reads dist/_headers; the dev server sends the same).
 * Everything is same-origin except the Turnstile script and frame. No site may frame a page (the
 * signup page has consent controls).
 */
export const securityHeaders = (app: AppKey): Record<string, string> => ({
  "Content-Security-Policy": `default-src 'self'; script-src 'self' ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; style-src 'self'; img-src ${imageSources(app)}; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
});

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

const DIRECT_CREDENTIAL_FLOW = /\/api\/auth\/otp\/(?:start|verify)|session\.cookies/i;

export type ConnectorSetupPath = "ToolsPresent" | "ConnectorAdded" | "ConnectorNotAdded" | "ConnectorImpossible";

const SETUP_PATHS: { setup: ConnectorSetupPath; clientCanAdd: boolean | null; connectorTools: boolean }[] = [
  { setup: "ToolsPresent", clientCanAdd: null, connectorTools: true },
  { setup: "ConnectorAdded", clientCanAdd: true, connectorTools: true },
  { setup: "ConnectorNotAdded", clientCanAdd: true, connectorTools: false },
  { setup: "ConnectorImpossible", clientCanAdd: false, connectorTools: false },
];

const SETUP_EVENTS = new Set(["checkConnectorSetup", "resumeAfterConnector", "chooseTransport"]);

const valuesOf = <T extends string>(all: Record<T, true>): T[] => Object.keys(all) as T[];
const BOOLEANS = [true, false];
const AGE_BANDS = valuesOf<AgeBand>({ AgeNotStated: true, Under13: true, Teen: true, Adult: true });
const APPROVALS = valuesOf<Approval>({ ApproveExact: true, AskChanges: true, DeclineSignup: true });
const BROWSER_RESULTS = valuesOf<BrowserResult>({
  BrowserNewOpen: true, BrowserNewInvited: true, BrowserExisting: true, BrowserWaiting: true, BrowserWrongApp: true, BrowserBelowAge: true,
  BrowserNeedsInvite: true, BrowserInvalidInvite: true, BrowserHeld: true, BrowserRefused: true, BrowserChanged: true,
});
const SITE_STATUSES = valuesOf<SiteStatus>({ SiteNotJoined: true, SiteInvited: true, SiteOnboarding: true, SiteActive: true, SiteStopped: true, SiteOnHold: true });

interface PathContext { setup: ConnectorSetupPath; clientCanAdd: boolean | null; connectorTools: boolean; transport: Transport }

function successfulEvent(s: Site, event: string, path: PathContext): SignupEvent | null | undefined {
  const inviteOnly = brandFor(s.key).joinMode === "InviteOnly";
  switch (event) {
    case "checkConnectorSetup": return path.clientCanAdd === null ? null : { type: "checkConnectorSetup", clientCanAdd: path.clientCanAdd };
    case "resumeAfterConnector": return path.clientCanAdd === true ? { type: "resumeAfterConnector" } : null;
    case "chooseTransport": return { type: "chooseTransport", skillKind: skillKindFor(s.key), connectorTools: path.connectorTools };
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

function branchEvents(s: Site, event: string): SignupEvent[] {
  const inviteMode = brandFor(s.key).joinMode === "InviteOnly";
  switch (event) {
    case "readAppFacts": return BOOLEANS.map(appMatches => ({ type: "readAppFacts" as const, appMatches, inviteMode }));
    case "draftProfile": return AGE_BANDS.map(statedAge => ({ type: "draftProfile" as const, statedAge }));
    case "decideApproval": return APPROVALS.map(decision => ({ type: "decideApproval" as const, decision }));
    case "offerHandoff": return BOOLEANS.map(linkAvailable => ({ type: "offerHandoff" as const, linkAvailable }));
    case "observeBrowser": return BROWSER_RESULTS.flatMap(result => BOOLEANS.map(appWriteGrant => ({ type: "observeBrowser" as const, result, appWriteGrant })));
    case "checkSiteStatus": return BOOLEANS.flatMap(siteApp => SITE_STATUSES.map(siteStatus => ({ type: "checkSiteStatus" as const, siteApp, siteStatus })));
    case "submitProfile": return BOOLEANS.map(accepted => ({ type: "submitProfile" as const, accepted }));
    case "confirmProfile": return BOOLEANS.map(stillLive => ({ type: "confirmProfile" as const, stillLive }));
    default: return [];
  }
}

export interface SignupPath { setup: ConnectorSetupPath; transport: Transport; branch: string | null; phase: string; report: SignupReport }

const eventText = (e: SignupEvent): string => {
  const { type, ...params } = e;
  const values = Object.values(params).map(String);
  return values.length ? `${type}(${values.join(", ")})` : type;
};

function replayPath(s: Site, list: SignupMarker[], path: PathContext, branch?: { at: number; event: SignupEvent }):
  { state: AgentSignup; problem?: string } {
  const label = `(${path.transport}); path ${path.setup}${branch ? `, ${eventText(branch.event)} at line ${list[branch.at]!.line}` : ""}`;
  let state: AgentSignup = signupStart;
  let pending = branch;
  let returned = false;
  const back = (from: number): number | undefined => {
    if (!branch || pending || returned) return undefined;
    for (let k = Math.min(from, list.length - 1); k >= 0; k--) {
      const e = successfulEvent(s, list[k]!.event, path);
      if (e != null && signupEnabled(state, e)) return k;
    }
    return undefined;
  };
  let i = 0;
  for (let steps = 0; steps < list.length * 3; steps++) {
    if (i >= list.length) {
      const k = reportFor(state.phase) === "ReportWorking" ? back(i) : undefined;
      if (k === undefined) break;
      returned = true;
      i = k;
      continue;
    }
    const m = list[i]!;
    const branched = pending !== undefined && pending.at === i;
    const event = branched ? pending!.event : successfulEvent(s, m.event, path);
    if (event === undefined) return { state, problem: `${s.skill}/SKILL.md:${m.line} names "${m.event}", which is not a step of a successful signup` };
    if (event === null) { i++; continue; }
    if (!signupEnabled(state, event)) {
      const k = back(i);
      if (k === undefined) return { state, problem: `${s.skill}/SKILL.md:${m.line}: the agentSignup model does not allow "${m.event}" in phase ${state.phase} ${label}` };
      returned = true;
      i = k;
      continue;
    }
    state = signupStep(state, event);
    if (!signupInvariants(state)) return { state, problem: `${s.skill}/SKILL.md:${m.line}: "${m.event}" breaks an agentSignup rule ${label}` };
    if (branched) pending = undefined;
    i++;
    if (reportFor(state.phase) !== "ReportWorking" && (branch !== undefined || path.transport === "NoTransport")) break;
  }
  return { state };
}

export function replaySignupPaths(s: Site, text: string): { problems: string[]; paths: SignupPath[] } {
  const markers = signupMarkers(text);
  const kind = skillKindFor(s.key);
  const transports: Transport[] = BOOLEANS.map(available => transportFor(kind, available)).filter(t => t !== "NoTransport");
  const problems: string[] = [];
  const paths: SignupPath[] = [];
  if (DIRECT_CREDENTIAL_FLOW.test(text)) problems.push(`${s.skill}/SKILL.md describes a direct phone sign-in outside the browser`);
  if (markers.length === 0) return { problems: [...problems, `${s.skill}/SKILL.md has no agentSignup step markers`], paths };
  for (const m of markers) {
    if (m.transport !== null && !transports.includes(m.transport as Transport)) problems.push(`${s.skill}/SKILL.md:${m.line} marks a step for ${m.transport}, which the ${s.domain} skill does not use (${transports.join(", ")})`);
  }
  if (problems.length) return { problems, paths };
  for (const setup of SETUP_PATHS) {
    const path: PathContext = { ...setup, transport: transportFor(kind, setup.connectorTools) };
    const list = markers.filter(x => x.transport === null || x.transport === path.transport);
    const main = replayPath(s, list, path);
    if (main.problem) { problems.push(main.problem); continue; }
    const want = endReportFor(path.transport);
    const got = reportFor(main.state.phase);
    if (got !== want) { problems.push(`${s.skill}/SKILL.md: the ${path.transport} steps of path ${path.setup} end in phase ${main.state.phase} (${got}), not at ${want}`); continue; }
    paths.push({ setup: path.setup, transport: path.transport, branch: null, phase: main.state.phase, report: got });
    list.forEach((m, at) => {
      if (SETUP_EVENTS.has(m.event)) return;
      const success = successfulEvent(s, m.event, path);
      const before = list.slice(0, at).reduce<AgentSignup | null>((state, x) => {
        if (state === null) return null;
        const e = successfulEvent(s, x.event, path);
        if (e === null || e === undefined) return state;
        return signupEnabled(state, e) && reportFor(state.phase) === "ReportWorking" ? signupStep(state, e) : null;
      }, signupStart);
      if (before === null || reportFor(before.phase) !== "ReportWorking") return;
      for (const event of branchEvents(s, m.event)) {
        if (JSON.stringify(event) === JSON.stringify(success) || !signupEnabled(before, event)) continue;
        const run = replayPath(s, list, path, { at, event });
        if (run.problem) { problems.push(run.problem); continue; }
        const report = reportFor(run.state.phase);
        if (report === "ReportWorking") problems.push(`${s.skill}/SKILL.md:${m.line}: after ${eventText(event)} the ${path.transport} steps of path ${path.setup} stop in phase ${run.state.phase} with no report`);
        else paths.push({ setup: path.setup, transport: path.transport, branch: `${eventText(event)} at line ${m.line}`, phase: run.state.phase, report });
      }
    });
  }
  return { problems: [...new Set(problems)], paths };
}

export function signupStepProblems(s: Site, text: string): string[] {
  return replaySignupPaths(s, text).problems;
}

export const PLUGINS_DIR = join(here, "../plugins");

export function pluginSignupProblems(dir = PLUGINS_DIR): string[] {
  const problems: string[] = [];
  for (const plugin of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    const skills = join(dir, plugin.name, "skills");
    if (!plugin.isDirectory() || !existsSync(skills)) continue;
    for (const entry of readdirSync(skills, { withFileTypes: true })) {
      const file = join(skills, entry.name, "SKILL.md");
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const s = SITES.find(x => x.skill === entry.name);
      if (!s) { problems.push(`plugins/${plugin.name}/skills/${entry.name}/SKILL.md names no site`); continue; }
      const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
      problems.push(...signupStepProblems(s, text).map(p => `plugins/${plugin.name}/skills/${p}`));
    }
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
export function headersFile(app: AppKey): string {
  const all = Object.entries(securityHeaders(app)).map(([k, v]) => `  ${k}: ${v}`).join("\n");
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
  const problems = [
    ...listed.flatMap((x) => signupStepProblems(x, skillText(x.skill, env, dir))),
    ...(s.app === "ntwrk" ? pluginSignupProblems() : []),
  ];
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
    const iconDark = app.favicon(s.key, "DarkScheme");
    const faviconDark = `/favicon-${sha256(iconDark).slice(0, 8)}.svg`;
    write(join(outdir, faviconDark.slice(1)), iconDark);
    const cfg = skillsConfig(env);
    const stagingOrigin = stagingSiteOrigins(env)[s.app];
    const siteHost = stagingOrigin ? new URL(stagingOrigin).host : "";
    const input = {
      favicon,
      faviconDark,
      siteHost,
      skillVersion: skillVersion(skillText(s.skill, env, skillsDir)),
      textLine: cfg.TEXT_LINE,
      minJoinAge: APPS[s.app].minJoinAge,
      consentText: APPS[s.app].consent.text,
      turnstileSiteKey: turnstileKey(env),
    };
    for (const page of pages(s)) write(join(outdir, PAGE_FILES[page]), app.page(s.key, page, input));
    if (existsSync(s.src)) cpSync(s.src, outdir, { recursive: true });
    write(join(outdir, "_headers"), headersFile(s.key));
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
