// Builds the four app sites from the one site app (apps/site) and checks what carriers, members and
// agents rely on: titles, legal and support links, the consent wording (equal to the platform's
// canonical text), the 10DLC sentence, the age rules (equal to the platform registry), STOP copy, the
// umbrella links, the files Cloudflare serves as they are (_headers, SKILL.md, robots.txt, .well-known),
// same-origin scripts, and the dev proxy. What only the page script shows (the Copy button, a copy-only
// agent tile, the status line, the join steps after the first) is checked on the same components in the
// state that the generated machines reach.
//   pnpm run test:integration sites
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { createHash } from "node:crypto";
import { verifyProxyHeaders } from "../../packages/platform/src/proxy.ts";
import { APPS, keywordApp } from "../../packages/platform/src/apps.ts";
import { TEXT_LINE } from "../skills.config.ts";
import { SITES, SKILLS_DIR, TURNSTILE_ORIGIN, buildSite, fill, walk, skillDescription, skillVersion, type Site } from "../sites.ts";
import { serveHttp } from "../../packages/core/src/runtime/http.ts";
import { fileAt } from "../../packages/core/src/runtime/files.ts";
import { serveSite } from "../../scripts/sites-dev.ts";
import { toE164 } from "../../packages/ui/src/api/join.ts";
import { brandFor, hubTextsOnAppSurface } from "../../packages/core/src/generated/brandIdentity.ts";
import { type JoinPage, initial as joinStart, step as joinStep } from "../../packages/core/src/generated/browserJoin.ts";
import { preparedPeonTextHeader } from "../../packages/core/src/generated/textEnrollment.ts";
import {
  type AgentId,
  type DeviceKind,
  agentLinkTemplate,
  agentName,
  agentOrder,
  agentToastText,
  desktopOnlyAgent,
  deviceFor,
  initial as landingStart,
  joinKeyword,
  joinMessagePrefix,
  landingAgentOffered,
  landingHeadingsAllowed,
  landingWordsAllowed,
  messagesOpensHere,
  step as landingStep,
  tileKindFor,
} from "../../packages/core/src/generated/landingEntry.ts";
import { renderJoin, renderLanding } from "../../apps/site/test/render.tsx";
import { OPENAI_MCP_URL, PLUGINS, build as buildPlugins } from "../../plugins/build.ts";
import { defaultApps as connectorApps } from "../../packages/mcp/src/apps.ts";

const REPO = join(import.meta.dirname, "../..");

const TENDLC = "Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing.";
const tmp = mkdtempSync(join(tmpdir(), "sites-test-"));
const out = (s: Site) => join(tmp, s.domain);
const read = (s: Site, f: string) => readFileSync(join(out(s), f), "utf8");
const htmlFiles = (s: Site) => readdirSync(out(s)).filter((f) => f.endsWith(".html"));
const OTHER_APP_DOMAINS = (s: Site) => SITES.filter((o) => o.app !== s.app && o.app !== "ntwrk").map((o) => o.domain);
const decode = (html: string) => html.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const text = (html: string) => decode(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// The text messaging terms are a section of the terms page on every site.

/** The consent wording that the join page shows and sends (the page script reads it from the root element). */
function consentWording(html: string): string {
  const m = html.match(/<div id="root"[^>]*\sdata-consent-wording="([^"]*)"/);
  return m ? decode(m[1]!) : "";
}

/** The agents of every landing page, pinned (docs/research/2026-10-10-agent-deep-links.md): the generated landing spec must say the same. */
const AGENTS: { id: AgentId; name: string; href?: string; toast: string; desktopOnly?: boolean }[] = [
  { id: "ChatGpt", name: "ChatGPT", href: "https://chatgpt.com/?q={q}", toast: "Opening ChatGPT. The prompt is copied too." },
  { id: "Claude", name: "Claude", href: "https://claude.ai/new?q={q}", toast: "Opening Claude. The prompt is copied too." },
  { id: "Grok", name: "Grok", href: "https://grok.com/?q={q}", toast: "Opening Grok. The prompt is copied too." },
  { id: "Muse", name: "Muse", toast: "Copied. Paste it into Muse." },
  { id: "Gemini", name: "Gemini", href: "https://gemini.google.com/app?q={q}", toast: "Copied. Paste it into Gemini." },
  { id: "Perplexity", name: "Perplexity", href: "https://www.perplexity.ai/search?q={q}", toast: "Opening Perplexity. The prompt is copied too." },
  { id: "Cursor", name: "Cursor", href: "https://cursor.com/link/prompt?text={q}", toast: "Opening Cursor. The prompt is copied too.", desktopOnly: true },
  { id: "OpenClaw", name: "OpenClaw", href: "openclaw://agent?message={q}", toast: "Copied. If OpenClaw did not open, send it the prompt." },
  { id: "Hermes", name: "Hermes", href: "hermes://skill/install?identifier={skill}", toast: "Copied. If Hermes did not open, send it the prompt." },
];

const connectorAccepts = (s: Site, agent: AgentId) => agent !== "ChatGpt" || connectorApps()[s.app].openai;

const hubPath = (app: string) => (app === "ntwrk" ? "/mcp" : `/mcp/${app}`);

/** The first text that joins this app on the shared line (packages/platform/src/apps.ts keywordApp). */
const keywordFor = (s: Site) => (s.app === "ntwrk" ? "network" : s.app);
const joinMessageFor = (s: Site) => `join ${keywordFor(s)}`;
const skillUrlFor = (s: Site, version: string) => `https://${s.domain}/SKILL.md${s.app === "slop" ? "" : `?version=${encodeURIComponent(version)}`}`;

/** The agent row of a landing page, and one tile in it by its accessible name. */
const agentRow = (html: string) => html.match(/<nav\b[^>]*aria-label="Open your agent"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
const tileIn = (row: string, label: string) => row.match(new RegExp(`<(?:a|button)\\b[^>]*aria-label="${label}"[^>]*>\\s*<svg`))?.[0] ?? "";
const mounted = (device: DeviceKind) => landingStep(landingStart, { type: "mount", device });

/** The join page after it read the app and the session, as the generated join machine reaches it. */
function joinAt(view: "SignedOut" | "MayJoin", checkOn: boolean): JoinPage {
  const opened = joinStep(joinStart, { type: "openPage", viaAgent: false, fragmentName: false, ageDigitsOnly: false, ageDigitCount: 0, fragmentAge: 0 });
  const loaded = joinStep(opened, { type: "loaded", view: { result: view, account: view === "SignedOut" ? 0 : 1, reason: "NoBlock" }, appUnreachable: false, inviteOnly: false });
  return view === "SignedOut" ? joinStep(loaded, { type: "readAuthMode", lookup: "ModeOtp", checkOn }) : loaded;
}
const joinOptions = (s: Site) => ({ consentText: APPS[s.app].consent.text, minJoinAge: APPS[s.app].minJoinAge, siteKey: "test-key", homeLabel: `Back to ${s.domain}` });

beforeAll(async () => {
  for (const s of SITES) {
    const r = await buildSite(s, out(s));
    if (!r.ok) throw new Error(`build failed for ${s.domain}: ${r.logs.join("\n")}`);
  }
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe.each(SITES)("$domain", (s) => {
  test("every required page is built, and the spec's brand record is this site", () => {
    expect([brandFor(s.key).domain, brandFor(s.key).skillName]).toEqual([s.domain, s.skill]);
    const need = ["index.html", "privacy.html", "terms.html", "404.html", ...(s.app === "peon" ? ["join.html"] : [])];
    if (s.app !== "peon") expect(htmlFiles(s)).not.toContain("join.html");
    expect(htmlFiles(s)).not.toContain("sms-terms.html");

    expect(htmlFiles(s)).toEqual(expect.arrayContaining(need));
  });

  test("landing pages lead to agents without a standalone account portal", () => {
    expect(htmlFiles(s)).not.toContain("settings.html");
    for (const f of htmlFiles(s)) expect(read(s, f)).not.toContain('href="/settings"');
    expect(read(s, "index.html")).not.toContain("Sign in");
    expect(read(s, "index.html")).toContain("sms:");
  });

  test("every page has a title and the legal links", () => {
    for (const f of htmlFiles(s)) {
      const html = read(s, f);
      expect(html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim().length ?? 0, f).toBeGreaterThan(3);
      const footer = html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0] ?? "";
      expect([...footer.matchAll(/<a\b[^>]+\bhref="([^"]+)"/g)].map(match => match[1]), f).toEqual(["/privacy", "/terms"]);
    }
  });

  test("the join page stores the consent wording that the SMS terms quote", () => {
    const wording = s.app === "peon" ? consentWording(read(s, "join.html")) : APPS[s.app].consent.text;
    expect(wording).toContain("Reply STOP");
    expect(wording).toContain("HELP");
    expect(wording).toContain("Message and data rates may apply");
    if (s.app !== "ntwrk") expect(text(read(s, "terms.html"))).toContain(wording);
    // The profile step shows the same wording beside the consent box.
    if (s.app === "peon") expect(text(renderJoin(joinAt("MayJoin", true), joinOptions(s)))).toContain(wording);
  });

  test("privacy and SMS terms carry the 10DLC sentence", () => {
    expect(text(read(s, "privacy.html"))).toContain(TENDLC);
    expect(text(read(s, "terms.html"))).toContain(TENDLC);
  });

  test("the join page's consent wording is the platform's canonical text for this app", () => {
    if (s.app === "peon") expect(consentWording(read(s, "join.html"))).toBe(APPS[s.app].consent.text);
    else { expect(read(s, "SKILL.md")).toContain("consent.text"); expect(read(s, "SKILL.md")).toContain("explicit approval"); }
  });

  test("ages on every page equal the platform registry: 13 to join, 18 to be matched", () => {
    const app = APPS[s.app];
    expect(app.minJoinAge).toBe(13);
    expect(app.minMatchAge).toBe(18);
    if (s.app === "peon") expect(read(s, "join.html")).toContain(`data-min-age="${app.minJoinAge}"`);
    for (const f of htmlFiles(s)) {
      for (const m of text(read(s, f)).matchAll(/\b(\d{1,2}) (?:or|and) older\b/g)) {
        expect([app.minJoinAge, app.minMatchAge], `${f}: "${m[0]}"`).toContain(Number(m[1]));
      }
    }
    // Plain words for minors on the join page (its profile step): they can join, and they are never matched.
    const profile = joinAt("MayJoin", true);
    expect(profile.screen).toBe("Profile");
    const ageText = text(s.app === "peon" ? renderJoin(profile, joinOptions(s)) : read(s, "SKILL.md"));
    expect(ageText).toMatch(/13(?: or older|\s*\+)/);
    expect(ageText).toMatch(/18(?: and older|\s*\+)/);
  });

  test("STOP stops every app; 'leave <app>' stops one (PRD 40.3). No page says STOP ALL", () => {
    for (const f of htmlFiles(s)) expect(read(s, f), f).not.toContain("STOP ALL");
    const sms = text(read(s, "terms.html"));
    expect(sms).toMatch(/STOP to stop every text from our number/);
    expect(sms).toContain(s.app === "ntwrk" ? '"leave slop.date"' : `leave ${s.domain}`);
  });

  test("each site is its own brand: no page names another app, and an app site never names The Network", () => {
    for (const f of readdirSync(out(s)).filter((f) => /\.(html|js|css)$/.test(f))) {
      const body = read(s, f).toLowerCase();
      for (const d of OTHER_APP_DOMAINS(s)) {
        if (s.app !== "ntwrk" || f === "index.html") expect(body.includes(d), `${f} mentions ${d}`).toBe(false);
      }
      // The support inbox (help@ntwrk.party) is the one place an app site shows the hub's domain.
      if (s.app !== "ntwrk" && f.endsWith(".html")) {
        expect(body, f).not.toContain("the network");
        expect(body.replaceAll("help@ntwrk.party", ""), f).not.toContain("ntwrk.party");
      }
    }
    for (const f of ["SKILL.md", `.well-known/agent-skills/${s.skill}/SKILL.md`]) {
      const skill = read(s, f).toLowerCase();
      for (const d of OTHER_APP_DOMAINS(s)) expect(skill.includes(d), `${f} mentions ${d}`).toBe(false);
      if (s.app !== "ntwrk") expect(hubTextsOnAppSurface(s.key, "SkillSurface").reduce((t, allowed) => t.replaceAll(allowed, ""), skill), f).not.toMatch(/the network|ntwrk\.party/);
      // Direct API instructions name region codes; discovery copy remains location-neutral.
      if (["friends", "slop", "ntwrk"].includes(s.app)) expect(skillDescription(read(s, f)).toLowerCase(), f).not.toMatch(/new york|nyc|san francisco/);
      else expect(skill, f).not.toMatch(/new york|nyc|san francisco/);
    }
  });

  test("support email is the one inbox that has mail routing (help@ntwrk.party)", () => {
    for (const f of htmlFiles(s)) {
      for (const m of read(s, f).matchAll(/mailto:([^"?]+)/g)) expect(m[1], f).toBe("help@ntwrk.party");
    }
  });

  test("the build ships the files Cloudflare serves as they are, with no empty file", () => {
    const files = walk(out(s));
    for (const f of ["_headers", "robots.txt", "SKILL.md", ".well-known/agent-skills/index.json", `.well-known/agent-skills/${s.skill}/SKILL.md`]) {
      expect(files, f).toContain(normalize(f));
    }
    const staticDir = join(REPO, "sites", s.domain, "static");
    for (const f of walk(staticDir)) expect(readFileSync(join(out(s), f)).equals(readFileSync(join(staticDir, f))), f).toBe(true);
    for (const f of files) expect(statSync(join(out(s), f)).size, f).toBeGreaterThan(0);
    for (const f of files.filter((f) => /\.(html|md|json|txt)$/.test(f))) expect(read(s, f), f).not.toContain("{{");
    for (const f of ["SKILL.md", `.well-known/agent-skills/${s.skill}/SKILL.md`]) {
      const skill = read(s, f);
      expect(skill).not.toContain("\r");
      expect(skill).toContain(`confirm its app is ${s.app}`);
      expect(skill).toMatch(/never submit across apps/i);
      expect(skill).toContain(`“Connect ${s.app === "ntwrk" ? "The Network" : s.domain}” and give`);
      expect(skill).toContain("then come back to this conversation");
      expect(skill).not.toContain("RESPONSE_STYLE");
      expect(skill).toContain(`https://ntwrk.party${hubPath(s.app)}/openai`);
      if (s.app !== "ntwrk") expect(skill).not.toContain(`https://${s.domain}/mcp`);
      expect(skill).not.toContain("cannot add this app's connector");
      if (["friends", "slop", "ntwrk"].includes(s.app)) {
        expect(skill).toContain("native connector authorization");
        expect(skill).toContain(`this app's own connector endpoint, \`https://ntwrk.party${hubPath(s.app)}\``);
        expect(skill).toContain(`(in ChatGPT, \`https://ntwrk.party${hubPath(s.app)}/openai\`)`);
        expect(skill.replace(/\s+/g, " ")).toContain("Only if this client cannot add a remote connector at all, or the person cannot add it, say “Signup isn't supported in this agent yet.”");
        expect(skill).toContain("the one link");
        expect(skill).toContain("**Finish signup**");
        expect(skill).toContain("**Allow**");
        expect(skill).toContain("Call `submit_profile` once");
        expect(skill).toContain("`submitted: true` for this app and this call");
        expect(skill).not.toMatch(/\/api\/auth\/otp\/|\/api\/me\/export|session\.cookies/);
        expect(skill).not.toContain(`https://${s.domain}/join`);
      } else if (s.app === "peon") {
        expect(skill).toContain(`In ChatGPT, add https://ntwrk.party${hubPath(s.app)}/openai instead`);
        expect(skill).toContain(`this app's own connector endpoint, https://ntwrk.party${hubPath(s.app)}`);
        expect(skill).not.toContain("connects automatically");
        expect(skill).toContain("**Allow**");
        expect(skill).not.toMatch(/Never signs anyone up|Never sign anyone up|they do it, not you/);
        expect(skillDescription(skill)).toContain("helps a person sign themselves up");
        expect(skill).toContain(`\`sms:${TEXT_LINE}?&body=\``);
        expect(skill).toContain(`\`${encodeURIComponent(preparedPeonTextHeader + "\n")}\``);
        expect(skill.replace(/\s+/g, " ")).toContain(APPS.peon.consent.text);
        expect(skill).toContain("Only an `onboarding` or `active`");
        expect(skill).toContain("returns `submitted: true`");
      }
    }
  });

  test("the slop.date safety notice is information, never a step that blocks joining", () => {
    const join = read(s, s.app === "peon" ? "join.html" : "SKILL.md");
    expect(join).not.toContain("data-first-step");
    expect(join).not.toContain('data-step="safety"');
    expect(join).not.toContain("ack-safety");
  });

  test("the build carries security headers: no framing, same-origin only (Cloudflare _headers)", () => {
    const h = read(s, "_headers");
    expect(h).toContain("frame-ancestors 'none'");
    expect(h).toContain("Strict-Transport-Security: max-age=31536000");
    // Turnstile is the only third-party origin, for scripts and the frame only.
    expect(h).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(h).toContain("frame-src https://challenges.cloudflare.com;");
    expect(h).toContain("connect-src 'self';");
    expect(h).toContain("X-Frame-Options: DENY");
    expect(h).toContain("Referrer-Policy: no-referrer");
    expect(h).toContain("X-Content-Type-Options: nosniff");
    // The CSP allows no inline script or style: no page may use one.
    for (const f of htmlFiles(s)) {
      const html = read(s, f);
      expect(/<script(?![^>]*\bsrc=)[^>]*>/.test(html), `${f} has an inline script`).toBe(false);
      expect(/<style\b|\sstyle="/.test(html), `${f} has an inline style`).toBe(false);
    }
  });

  test("scripts call only same-origin /api paths (and load only the Turnstile script)", () => {
    // _worker.js is the server-side router (Cloudflare Pages advanced mode), not a page script: it names the backend.
    // A page script may name the Turnstile origin (the one script it loads), the agent links a tile opens (a
    // navigation, never a request), React's error page and the XML namespaces; connect-src 'self' holds the rest.
    const named = new Set([TURNSTILE_ORIGIN, ...AGENTS.flatMap((a) => (a.href?.startsWith("https://") ? [new URL(a.href).origin] : [])), "https://react.dev", "http://www.w3.org"].map((o) => new URL(o).host));
    const scripts = readdirSync(out(s)).filter((f) => f.endsWith(".js") && f !== "_worker.js");
    if (htmlFiles(s).some((f) => /<script\b/.test(read(s, f)))) expect(scripts.length).toBeGreaterThan(0);
    for (const f of scripts) {
      const js = read(s, f);
      const hosts = [...js.matchAll(/https?:\/\/([^"'`\s)/?#$]+)/g)].map((m) => m[1]!);
      for (const h of hosts) expect(named.has(h), `${f} names ${h}`).toBe(true);
      for (const m of js.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)) expect(m[1]!.startsWith("/api/")).toBe(true);
    }
  });

  test("the phone step on join carries the Turnstile slot and the site key meta", () => {
    for (const f of s.app === "peon" ? ["join.html"] : []) {
      const html = read(s, f);
      expect(html, f).toContain('<meta name="turnstile-sitekey" content="">');
      const phone = joinAt("SignedOut", true);
      expect([phone.screen, phone.check]).toEqual(["Phone", "CheckRunning"]);
      const form = renderJoin(phone, joinOptions(s)).match(/<form\b[\s\S]*?<\/form>/)?.[0] ?? "";
      expect(form.indexOf("Security check running"), f).toBeGreaterThan(form.indexOf('name="phone"'));
      expect(form.indexOf('name="phone"'), f).toBeGreaterThan(-1);
      // Without a site key the phone step shows no check.
      expect(renderJoin(joinAt("SignedOut", false), joinOptions(s))).not.toContain("Security check");
    }
  });
});

test("staging builds keep the served entry, skills and signed router on configured staging authorities", async () => {
  const origins = { ntwrk: "https://hub-stage.example.test", slop: "https://slop-stage.example.test", peon: "https://peon-stage.example.test", friends: "https://friends-stage.example.test" };
  const secret = "owned-stage-proxy-contract-secret";
  const received: { host: string; path: string }[] = [];
  const backend = await serveHttp({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const signed = await verifyProxyHeaders(req, secret, Math.floor(Date.now() / 1000));
    expect(signed?.host).toBe("slop-stage.example.test");
    received.push({ host: signed!.host, path: new URL(req.url).pathname });
    return Response.json({ id: "slop", staging: true });
  } });
  const env = { PLATFORM_ENV: "staging", STAGING_SITE_ORIGINS: JSON.stringify(origins), BACKEND_ORIGIN: `http://127.0.0.1:${backend.port}` };
  const slop = SITES.find(s => s.app === "slop")!, hub = SITES.find(s => s.app === "ntwrk")!;
  const directory = join(tmp, "staging-slop"), hubDirectory = join(tmp, "staging-hub");
  let server: Awaited<ReturnType<typeof serveHttp>> | undefined;
  try {
    expect((await buildSite(slop, directory, env)).ok).toBe(true);
    expect((await buildSite(hub, hubDirectory, env)).ok).toBe(true);
    const home = readFileSync(join(directory, "index.html"), "utf8");
    const prompt = `Read ${origins.slop}/SKILL.md and follow it.`;
    expect(home).toContain(`>${prompt}</code>`);
    expect(home).toContain(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`);
    for (const origin of ["https://chatgpt.com/", "https://claude.ai/new", "https://grok.com/", "https://gemini.google.com/app", "https://www.perplexity.ai/search"]) {
      const href = [...home.matchAll(/href="([^"]+)"/g)].map(m => m[1]!).find(href => href.startsWith(`${origin}?q=`));
      expect(href, origin).toBeDefined();
      expect(new URL(href!).searchParams.get("q"), origin).toBe(prompt);
    }
    expect(home).toContain("slop.date"); // Branding stays canonical.
    expect(home).not.toContain("https://slop.date");
    const worker = (await import(join(directory, "_worker.js"))).default;
    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch(req) {
      const local = new URL(req.url);
      return worker.fetch(new Request(`${origins.slop}${local.pathname}${local.search}`, req), {
        PLATFORM_PROXY_SECRET: secret,
        ASSETS: { fetch: async (r: Request) => new Response(await fileAt(join(directory, new URL(r.url).pathname.slice(1) || "index.html")).blob()) },
      });
    } });
    const base = `http://127.0.0.1:${server.port}`;
    const skill = await (await fetch(`${base}/SKILL.md`)).text();
    expect(skill).toContain(`${origins.slop}/`);
    expect(skill).toContain(`${origins.ntwrk}/mcp/slop`);
    expect(skill).not.toContain(`${origins.slop}/mcp`);
    expect(skill).toContain("native connector authorization");
    expect(skill).not.toContain("/api/auth/otp/");
    for (const path of ["privacy", "terms"]) expect(skill).toContain(`${origins.slop}/${path}`);
    expect(skill).toContain("Email: help@ntwrk.party");
    expect(skill).not.toContain("https://slop.date");
    const index = await (await fetch(`${base}/.well-known/agent-skills/index.json`)).json() as { skills: { url: string; digest: string }[] };
    expect(await (await fetch(base + index.skills[0]!.url)).text()).toBe(skill);
    expect(readFileSync(join(hubDirectory, "SKILL.md"), "utf8")).toContain(`${origins.ntwrk}/`);
    for (const path of ["/api/app", "/mcp", "/oauth/authorize", "/.well-known/oauth-protected-resource/mcp"]) {
      expect((await (await fetch(base + path)).json()).id).toBe("slop");
    }
    expect(received.map(r => r.path)).toEqual(["/api/app", "/mcp", "/oauth/authorize", "/.well-known/oauth-protected-resource/mcp"]);
    expect((await buildSite(slop, join(tmp, "staging-conflict"), { ...env, MCP_URL: "https://foreign.example/{domain}/mcp" })).ok).toBe(false);
    expect((await buildSite(slop, join(tmp, "staging-missing"), { ...env, STAGING_SITE_ORIGINS: JSON.stringify({ slop: origins.slop }) })).ok).toBe(false);
    expect((await buildSite(slop, join(tmp, "staging-production"), { ...env, DEPLOY_TARGET: "production" })).ok).toBe(false);
    expect((await buildSite(slop, join(tmp, "staging-backend"), { ...env, BACKEND_ORIGIN: "https://api.ntwrk.party" })).ok).toBe(false);
    expect((await buildSite(slop, join(tmp, "staging-backend-path"), { ...env, BACKEND_ORIGIN: "https://api.ntwrk.party/preview" })).ok).toBe(false);
    expect((await buildSite(slop, join(tmp, "staging-backend-missing"), { ...env, BACKEND_ORIGIN: "" })).ok).toBe(false);
    for (const origin of Object.values(origins)) {
      expect((await buildSite(slop, join(tmp, "staging-backend-loop"), { ...env, BACKEND_ORIGIN: origin })).ok).toBe(false);
    }
  } finally { await server?.stop(true); await backend.stop(true); }
});

test("a local or test MCP_URL moves the ntwrk.party connector endpoints that the skills name", () => {
  const env = { MCP_URL: "https://{domain}.dev.example.test/mcp", BACKEND_ORIGIN: "https://api.dev.example.test" };
  for (const site of SITES) {
    const source = readFileSync(join(SKILLS_DIR, site.skill, "SKILL.md"), "utf8");
    const path = site.app === "ntwrk" ? "/mcp" : `/mcp/${site.app}`;
    const production = fill(source, { ...env, MCP_URL: undefined, BACKEND_ORIGIN: undefined }, site.domain);
    expect(production, site.domain).toContain(`https://ntwrk.party${path}`);
    expect(production, site.domain).toContain(`https://ntwrk.party${path}/openai`);
    const local = fill(source, env, site.domain);
    expect(local, site.domain).not.toContain("https://ntwrk.party/mcp");
    expect(local, site.domain).toContain(`https://ntwrk.party.dev.example.test${path}`);
    expect(local, site.domain).toContain(`https://ntwrk.party.dev.example.test${path}/openai`);
  }
});

test("the generated landing spec keeps the pinned agents, links, names and messages", () => {
  expect(agentOrder).toEqual(AGENTS.map((a) => a.id));
  for (const a of AGENTS) {
    expect([agentName(a.id), agentLinkTemplate(a.id) || undefined, agentToastText(a.id), desktopOnlyAgent(a.id)], a.id).toEqual([a.name, a.href, a.toast, Boolean(a.desktopOnly)]);
    expect(tileKindFor(a.id) === "CopyOnly", a.id).toBe(!a.href);
  }
  for (const s of SITES) expect(`${joinMessagePrefix}${joinKeyword(s.key)}`, s.domain).toBe(joinMessageFor(s));
});

test("landing pages keep agent onboarding and the Messages entry", () => {
  for (const s of SITES) {
    const home = read(s, "index.html");
    const version = skillVersion(read(s, "SKILL.md"));
    const skillUrl = skillUrlFor(s, version);
    const prompt = `Read ${skillUrl} and follow it.`;
    const q = encodeURIComponent(prompt);
    const options = { skillVersion: version, textLine: TEXT_LINE };
    const desktop = renderLanding(s.key, mounted("OtherDesktop"), options);
    const phone = renderLanding(s.key, mounted("Phone"), options);
    // The prompt is selectable text without the page script; the Copy button shows only with it.
    expect(home, s.domain).toContain(`>${prompt}</code>`);
    expect(home, s.domain).not.toMatch(/<button\b[^>]*>Copy<\/button>/);
    expect(desktop, s.domain).toMatch(/<button\b[^>]*>Copy<\/button>/);
    expect(landingHeadingsAllowed(home.match(/<h1[\s>]/g)?.length ?? 0), s.domain).toBe(true);
    expect(landingWordsAllowed(text(desktop).split(" ").length), s.domain).toBe(true);
    // Every agent is a logo with an accessible name and no visible name; a link opens it with the prompt.
    const row = agentRow(home);
    expect(row, s.domain).not.toBe("");
    expect(text(row), s.domain).toBe("");
    for (const a of AGENTS) {
      const label = `${a.href ? "Open in" : "Copy the prompt for"} ${a.name}`;
      const still = tileIn(row, label), live = tileIn(agentRow(desktop), label), small = tileIn(agentRow(phone), label);
      expect(landingAgentOffered(s.key, a.id), `${s.domain} ${a.id}`).toBe(connectorAccepts(s, a.id));
      if (!connectorAccepts(s, a.id)) {
        expect([still, live, small], `${s.domain} ${a.id}`).toEqual(["", "", ""]);
        expect(home, `${s.domain} ${a.id}`).not.toContain(a.href?.split("{")[0] ?? label);
        continue;
      }
      if (a.href) {
        const href = `href="${a.href.replace("{q}", q).replace("{skill}", encodeURIComponent(skillUrl))}"`;
        expect(still, `${s.domain} ${a.id}`).toMatch(/^<a\b/);
        expect(still, `${s.domain} ${a.id}`).toContain(href);
        expect(live, `${s.domain} ${a.id}`).toContain(href);
      } else {
        // A copy-only tile cannot copy without the page script, so the static page has none.
        expect(still, `${s.domain} ${a.id}`).toBe("");
        expect(live, `${s.domain} ${a.id}`).toMatch(/^<button\b[^>]*type="button"/);
      }
      // A desktop-only agent is hidden on a phone, and shown on a desktop and without the page script.
      expect(small !== "", `${s.domain} ${a.id} on a phone`).toBe(!a.desktopOnly);
      if (a.href) expect(live !== "", `${s.domain} ${a.id} on a desktop`).toBe(true);
    }
    // Joining by text: the shared line with this app's keyword, which the line routes to this app.
    expect(row, s.domain).not.toContain("sms:");
    expect(home, s.domain).toContain("Use in iMessage");
    expect(home, s.domain).not.toContain("Text Eliza");
    expect(home, s.domain).toContain(`href="sms:${TEXT_LINE}?body=${encodeURIComponent(joinMessageFor(s))}"`);
    if (s.app === "slop") expect(home).not.toContain("?version=");
    expect(keywordApp(joinMessageFor(s)), s.domain).toBe(s.app);
    expect(keywordApp(keywordFor(s)), s.domain).toBe(s.app);
    // The status line is there and empty until the page script has something to say.
    expect(home, s.domain).toMatch(/<p\b[^>]*role="status"[^>]*><\/p>/);
    // No eyebrow, safety notice, explanation, city or sibling brand; legal pages in the footer.
    expect(text(home), s.domain).not.toMatch(/background check|safety notice|How it works|What you get|powered by|New York|San Francisco/i);
    const foot = home.match(/<footer[^>]*>([\s\S]*?)<\/footer>/)?.[1] ?? "";
    expect([...foot.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), s.domain).toEqual(["/privacy", "/terms"]);
    expect(home, s.domain).not.toContain("l-by");
    expect(text(home).split(/\s+/).length, s.domain).toBeLessThan(45);
    // CSP: no inline style or script, and the font is a same-origin file.
    expect(home, s.domain).not.toMatch(/style="|<script(?![^>]*src=)/);
    for (const f of readdirSync(out(s)).filter((f) => f.endsWith(".css"))) expect(read(s, f), f).not.toContain("data:font");
    expect(existsSync(join(out(s), "fonts/host-grotesk.woff2")), s.domain).toBe(true);
    // Every site has its logo in the header and as the favicon of every page, and its brand on <html>.
    expect(home, s.domain).toMatch(/<header\b[^>]*>\s*<a href="\/"[^>]*>\s*<svg\b/);
    for (const f of htmlFiles(s)) {
      const html = read(s, f);
      expect(html, `${s.domain} ${f}`).toMatch(/<link rel="icon" href="\/favicon-[a-z0-9]+\.svg" type="image\/svg\+xml">/);
      expect(html, `${s.domain} ${f}`).toContain(`<html lang="en" data-brand="${{ ntwrk: "network", slop: "slop", peon: "peon", friends: "friends" }[s.app]}">`);
    }
    // Only the landing page and the join page ship the page script.
    for (const f of htmlFiles(s)) expect(/<script\b/.test(read(s, f)), `${s.domain} ${f}`).toBe(f === "index.html" || f === "join.html");
  }
});

test("Muse copies the prompt without opening an unrelated video-hosting site", () => {
  for (const s of SITES) {
    const home = read(s, "index.html");
    const options = { skillVersion: skillVersion(read(s, "SKILL.md")), textLine: TEXT_LINE };
    const ready = mounted("OtherDesktop");
    const tile = agentRow(renderLanding(s.key, ready, options)).match(/<button\b[^>]*aria-label="Copy the prompt for Muse"[^>]*>/)?.[0];
    expect(tile, s.domain).toBeDefined();
    const chosen = landingStep(ready, { type: "chooseAgent", agent: "Muse", copied: true });
    expect(chosen.agentFollowed, s.domain).toBe(false);
    expect(chosen.statusAgent, s.domain).toBe("Muse");
    expect(renderLanding(s.key, chosen, options), s.domain).toMatch(/role="status"[^>]*>Copied\. Paste it into Muse\.<\/p>/);
    expect(home, s.domain).not.toMatch(/<a\b[^>]*aria-label="[^"]*Muse"/);
    expect(home, s.domain).not.toContain("https://muse.ai/");
    for (const f of readdirSync(out(s)).filter((f) => f.endsWith(".js"))) expect(read(s, f), f).not.toContain("https://muse.ai/");
  }
});

test("the page script tells a phone from a desktop (iPadOS reports itself as a Mac)", () => {
  // The user-agent tests of the page script (packages/ui/src/hooks/useLanding.ts), then the generated decisions.
  const ua = { iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)", android: "Mozilla/5.0 (Linux; Android 16; Pixel 10)", mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
  const device = (nav: { userAgent: string; maxTouchPoints: number }) => {
    const kind = deviceFor(/Android|iPhone|iPad|iPod/.test(nav.userAgent), /Macintosh|Mac OS X/.test(nav.userAgent), nav.maxTouchPoints);
    return { mobile: kind === "Phone", messages: messagesOpensHere(kind) };
  };
  expect(device({ userAgent: ua.iphone, maxTouchPoints: 5 })).toEqual({ mobile: true, messages: true });
  expect(device({ userAgent: ua.android, maxTouchPoints: 5 })).toEqual({ mobile: true, messages: true });
  expect(device({ userAgent: ua.mac, maxTouchPoints: 5 })).toEqual({ mobile: true, messages: true });
  expect(device({ userAgent: ua.mac, maxTouchPoints: 0 })).toEqual({ mobile: false, messages: true });
  expect(device({ userAgent: ua.windows, maxTouchPoints: 0 })).toEqual({ mobile: false, messages: false });
});

test("slop.date keeps its safety information off the landing page, and photos are for adults only", () => {
  const slop = SITES.find((s) => s.app === "slop")!;
  const notice = "slop.date does not run criminal background checks";
  expect(read(slop, "SKILL.md")).not.toContain("https://slop.date/safety");
  expect(read(slop, "SKILL.md")).toContain("does not run criminal background checks");
  expect(text(read(slop, "index.html"))).not.toContain(notice);
  for (const site of SITES) {
    for (const page of ["safety.html", "guidelines.html", "support.html"]) expect(walk(out(site))).not.toContain(page);
  }
  // Members aged 13 to 17 can join slop.date but get no matching and no photos.
  for (const f of ["privacy.html"]) {
    const t = text(read(slop, f));
    expect(t, f).toMatch(/13 to 17|under 18/);
    expect(t, f).toMatch(/never asks? (them|you) for photos/);
  }
  expect(text(read(slop, "privacy.html"))).toContain("never shown to you, to other members or to anyone else");
});

test("members aged 13 to 17 are told they are never matched on dates, and nothing promises them an introduction (founder 2026-11-22)", () => {
  for (const s of SITES) {
    for (const f of ["SKILL.md", `.well-known/agent-skills/${s.skill}/SKILL.md`]) {
      const t = read(s, f).replace(/\s+/g, " ");
      expect(t, f).toMatch(/Ask for their birthday/);
      expect(t, f).toMatch(/Never send a birthday or an age through a tool/);
      expect(t, f).toMatch(/never matche[sd] (them )?on dates/i);
      expect(t, f).toMatch(/friendship introductions (only, )?with people within 2 years of their own age/);
      expect(t, f).toContain("Never promise them an introduction.");
      expect(t, f).not.toMatch(/introductions and matching are for adults 18 and older\./);
    }
    const privacy = text(read(s, "privacy.html"));
    expect(privacy).toContain("birth date");
    expect(privacy).toContain("Today, no member under 18 is introduced to anyone.");
  }
  expect(read(SITES.find((s) => s.app === "slop")!, "SKILL.md").replace(/\s+/g, " ")).toContain("slop.date will not match them on dates");
  expect(read(SITES.find((s) => s.app === "ntwrk")!, "SKILL.md").replace(/\s+/g, " ")).toContain("For ages 13–17, draft only friends interests and their own help; never offer dates or work, and never say that these interests lead to an introduction today.");
});

test("peon.biz says a person reviews every introduction; no compliance gate blocks joining", () => {
  const peon = SITES.find((s) => s.app === "peon")!;
  for (const f of ["SKILL.md"]) {
    const t = text(read(peon, f));
    expect(t, f).toMatch(/reviews every introduction/i);
    expect(t, f).not.toContain("bias audit");
  }
});

test("the production build refuses draft legal text, and today's pages pass it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sites-prod-"));
  try {
    for (const s of SITES) {
      const r = await buildSite(s, join(dir, s.domain), { ...process.env, DEPLOY_TARGET: "production" });
      expect(r.ok, `${s.domain}: ${r.logs.join("; ")}`).toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no 'buddies' identifier remains in sites, scripts, deploy or CI (renamed friends.help)", () => {
  const roots = ["sites", "scripts", "deploy", ".github"].map((r) => join(REPO, r));
  const hits: string[] = [];
  for (const root of roots) {
    for (const f of walk(root)) {
      if (f.includes("dist/") || f.includes("node_modules/") || !/\.(ts|html|css|md|toml|yml|yaml|json|sh|txt)$/.test(f)) continue;
      const body = readFileSync(join(root, f), "utf8");
      if (/buddies/i.test(body) && !f.endsWith("sites.test.ts")) hits.push(join(root, f));
    }
  }
  expect(hits).toEqual([]);
  expect(existsSync(join(REPO, "sites/friends.help/wrangler.toml"))).toBe(true);
  expect(existsSync(join(REPO, "sites/friends.help/static/robots.txt"))).toBe(true);
  expect(existsSync(join(REPO, "sites/buddies.nyc"))).toBe(false);
});

test("a skill cannot hand off signup before explicit draft approval", async () => {
  const slop = SITES.find(s => s.app === "slop")!;
  const skills = join(tmp, "reordered-skills");
  cpSync(SKILLS_DIR, skills, { recursive: true });
  const file = join(skills, slop.skill, "SKILL.md");
  const source = readFileSync(file, "utf8");
  const reordered = source.replace(
    /<!-- agentSignup: (decideApproval|offerHandoff) -->/g,
    (_, event) => `<!-- agentSignup: ${event === "decideApproval" ? "offerHandoff" : "decideApproval"} -->`,
  );
  writeFileSync(file, reordered);
  const built = await buildSite(slop, join(tmp, "reordered-build"), process.env, skills);
  expect(built.ok).toBe(false);
  expect(built.logs.join("\n")).toContain('the agentSignup model does not allow "offerHandoff" in phase AwaitingApproval (NativeConnectorHandoff)');
});

test("a skill cannot stop an agent without the connector before it gives the connector setup step", async () => {
  const skills = join(tmp, "no-setup-skills");
  cpSync(SKILLS_DIR, skills, { recursive: true });
  for (const [app, transport] of [["slop", "NoTransport"], ["peon", "MessagesHandoff"]] as const) {
    const s = SITES.find(x => x.app === app)!;
    const file = join(skills, s.skill, "SKILL.md");
    const source = readFileSync(file, "utf8");
    expect(source).toContain("<!-- agentSignup: checkConnectorSetup resumeAfterConnector chooseTransport -->");
    writeFileSync(file, source.replace("checkConnectorSetup resumeAfterConnector chooseTransport", "chooseTransport"));
    const built = await buildSite(s, join(tmp, `no-setup-build-${app}`), process.env, skills);
    expect(built.ok).toBe(false);
    expect(built.logs.join("\n")).toContain(`the agentSignup model does not allow "chooseTransport" in phase CheckingCapability (${transport})`);
  }
});

test("each plugin skill and its MCP dependency use its own app's ntwrk.party endpoint, and the snapshots are current", () => {
  const files = buildPlugins();
  const appOf = (skill: string) => SITES.find(s => s.skill === skill)!.app;
  const otherEndpoint = (app: string) => app === "ntwrk" ? /https:\/\/ntwrk\.party\/mcp(?:\/openai)?(?![\w/])/ : new RegExp(`https://ntwrk\\.party/mcp/${app}(?![\\w])`);
  for (const skill of PLUGINS.openai.skills) {
    const url = `https://ntwrk.party${hubPath(appOf(skill))}/openai`;
    const yaml = files.get(join("openai", "skills", skill, "agents", "openai.yaml"))!;
    expect(yaml, skill).toContain(`url: ${url}\n`);
    const text = files.get(join("openai", "skills", skill, "SKILL.md"))!;
    for (const other of SITES.filter(s => s.skill !== skill)) {
      expect(text, `${skill} names ${other.domain}`).not.toMatch(otherEndpoint(other.app));
      if (other.app !== "ntwrk") expect(text, `${skill} names ${other.domain}`).not.toContain(`https://${other.domain}/mcp`);
    }
    expect(text, skill).toContain(url);
  }
  for (const skill of PLUGINS.claude.skills) expect(files.get(join("claude", "skills", skill, "SKILL.md")), skill).toContain(`https://ntwrk.party${hubPath(appOf(skill))}`);
  const manifest = JSON.parse(files.get(join("openai", "mcp.json"))!) as { mcpServers: Record<string, { url: string }> };
  expect(Object.values(manifest.mcpServers).map(x => x.url)).toEqual([OPENAI_MCP_URL]);
  expect(OPENAI_MCP_URL).toBe("https://ntwrk.party/mcp/openai");
  for (const [rel, text] of files) expect(readFileSync(join(REPO, "plugins", rel), "utf8"), `plugins/${rel} is stale: run plugins/build.ts`).toBe(text);
});

test("a skill cannot reintroduce the direct phone API", async () => {
  const friends = SITES.find(s => s.app === "friends")!;
  const skills = join(tmp, "direct-phone-skills");
  cpSync(SKILLS_DIR, skills, { recursive: true });
  const file = join(skills, friends.skill, "SKILL.md");
  writeFileSync(file, readFileSync(file, "utf8") + "\nSend a phone to /api/auth/otp/start.\n");
  const built = await buildSite(friends, join(tmp, "direct-phone-build"), process.env, skills);
  expect(built.ok).toBe(false);
  expect(built.logs.join("\n")).toContain("describes a direct phone sign-in outside the browser");
});

test("ntwrk.party join page says joining is by invitation", () => {
  const ntwrk = SITES.find((s) => s.app === "ntwrk")!;
  expect(htmlFiles(ntwrk)).not.toContain("join.html");
  expect(read(ntwrk, "SKILL.md")).toContain("invitation");
  expect(read(ntwrk, "SKILL.md")).toContain("The Network is invitation-only.");
});

test("toE164 accepts US numbers only (the join page client)", () => {
  expect(toE164("(212) 555-0123")).toBe("+12125550123");
  expect(toE164("+1 212 555 0123")).toBe("+12125550123");
  expect(toE164("+44 20 7946 0958")).toBeNull();
  expect(toE164("012 555 0123")).toBeNull();
  expect(toE164("555-0123")).toBeNull();
});

test("retired Settings URLs refuse an old static account page over HTTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "retired-settings-"));
  writeFileSync(join(dir, "settings.html"), '<html><main data-settings>Old account page</main></html>');
  const server = await serveSite(SITES[0]!, { port: 0, apiOrigin: "http://127.0.0.1:9", outdir: dir });
  try {
    for (const path of ["/settings", "/settings/", "/settings.html", "/settings?source=old-link"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, redirect: "manual" });
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.text()).not.toContain("data-settings");
      }
    }
  } finally {
    await server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("dev server", () => {
  const slop = SITES.find((s) => s.app === "slop")!;
  let seen: { host: string | null; cookie: string | null; ip?: string | null } = { host: null, cookie: null };
  let last: Request | undefined;
  let api: Awaited<ReturnType<typeof serveHttp>>;
  let up: Awaited<ReturnType<typeof serveSite>>;
  let down: Awaited<ReturnType<typeof serveSite>>;
  let signed: Awaited<ReturnType<typeof serveSite>>;
  beforeAll(async () => {
    api = await serveHttp({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen = { host: req.headers.get("x-forwarded-host"), cookie: req.headers.get("cookie"), ip: req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") };
        last = req;
        return Response.json({ ok: true }, { headers: { "set-cookie": "sid=abc; HttpOnly; Secure; SameSite=Lax; Domain=slop.date; Path=/" } });
      },
    });
    up = await serveSite(slop, { port: 0, apiOrigin: `http://127.0.0.1:${api.port}`, outdir: out(slop), proxySecret: "" });
    down = await serveSite(slop, { port: 0, apiOrigin: "http://127.0.0.1:9", outdir: out(slop), proxySecret: "" });
    signed = await serveSite(slop, { port: 0, apiOrigin: `http://127.0.0.1:${api.port}`, outdir: out(slop), proxySecret: "dev-secret" });
  });
  afterAll(() => Promise.all([api, up, down, signed].map(s => s?.stop(true))));

  test("forwards the same backend paths as the production router, and strips spoofed proxy headers", async () => {
    for (const p of ["/mcp", "/oauth/authorize", "/.well-known/oauth-protected-resource"]) {
      last = undefined;
      const res = await fetch(`http://127.0.0.1:${up.port}${p}`, { headers: { "x-ntwrk-proxy-ip": "6.6.6.6", "x-ntwrk-proxy-sig": "forged", "x-network-proxy-host": "peon.biz" } });
      expect(res.status, p).toBe(200);
      expect(last, p).toBeDefined();
      expect(last!.headers.get("x-ntwrk-proxy-ip"), p).toBeNull();
      expect(last!.headers.get("x-ntwrk-proxy-sig"), p).toBeNull();
      expect(last!.headers.get("x-network-proxy-host"), p).toBeNull();
    }
  });

  test("with a proxy secret it runs the production router: the platform contract, and the backend's verifier accepts it", async () => {
    await fetch(`http://127.0.0.1:${signed.port}/api/app?x=1`, { headers: { "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "6.6.6.7" } });
    const h = last!.headers;
    expect(h.get("x-network-proxy-host")).toBe("slop.date");
    expect(h.get("x-network-proxy-ip")).toBe("127.0.0.1");
    expect(h.get("x-forwarded-host")).toBeNull();
    expect(h.get("x-ntwrk-proxy-sig")).toBeNull();
    const ts = Number(h.get("x-network-proxy-ts"));
    expect(await verifyProxyHeaders(new Request(`https://api.example/api/app?x=1`, { headers: h }), "dev-secret", ts)).toEqual({ ip: "127.0.0.1", host: "slop.date" });
  });

  test("a trailing-slash redirect stays on this origin", async () => {
    const res = await fetch(`http://127.0.0.1:${up.port}//evil.example/`, { redirect: "manual" });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/evil.example");
  });

  test("serves unchanged skill bytes as reader-compatible plain text with matching catalog digest", async () => {
    const md = await fetch(`http://127.0.0.1:${up.port}/SKILL.md`);
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const bytes = new Uint8Array(await md.arrayBuffer());
    const versioned = await fetch(`http://127.0.0.1:${up.port}/SKILL.md?version=1.1.1`);
    expect(versioned.status).toBe(200);
    expect(Buffer.from(await versioned.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    expect(Buffer.from(bytes).equals(readFileSync(join(out(slop), "SKILL.md")))).toBe(true);
    const idx = await fetch(`http://127.0.0.1:${up.port}/.well-known/agent-skills/index.json`);
    expect(idx.headers.get("content-type")).toContain("application/json");
    const catalog = await idx.json() as { skills: { name: string; url: string; digest: string }[] };
    expect(catalog.skills.map((x) => x.name)).toEqual(["slop-date"]);
    const canonical = await fetch(`http://127.0.0.1:${up.port}${catalog.skills[0]!.url}`);
    expect(canonical.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(Buffer.from(await canonical.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    expect(catalog.skills[0]!.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    for (const s of SITES) {
      const headers = read(s, "_headers");
      expect(headers).toContain("/SKILL.md\n  Content-Type: text/plain; charset=utf-8");
      expect(headers).toContain("/.well-known/agent-skills/*/SKILL.md\n  Content-Type: text/plain; charset=utf-8");
      expect(headers).toContain("X-Content-Type-Options: nosniff");
    }
    expect((await fetch(`http://127.0.0.1:${up.port}/_redirects`)).status).toBe(404);
  });

  test("proxies /api/* with the site's domain and keeps the cookie on the dev host", async () => {
    const res = await fetch(`http://127.0.0.1:${up.port}/api/auth/otp/verify`, {
      method: "POST",
      // A browser cannot pick the backend's rate-limit bucket: client IP headers are dropped.
      headers: { "content-type": "application/json", cookie: "sid=old", "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "6.6.6.7", "x-real-ip": "6.6.6.8" },
      body: JSON.stringify({ phone: "+12125550123", code: "123456" }),
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual({ host: "slop.date", cookie: "sid=old", ip: null });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sid=abc");
    expect(cookie.toLowerCase()).not.toContain("domain=");
  });

  test("answers 502 api_unreachable when the API is down", async () => {
    const res = await fetch(`http://127.0.0.1:${down.port}/api/me`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "api_unreachable" });
  });

  test("serves pages by clean path and refuses paths outside the build", async () => {
    const page = await fetch(`http://127.0.0.1:${up.port}/privacy`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await fetch(`http://127.0.0.1:${up.port}/_headers`)).status).toBe(404);
    for (const path of ["no-such-page", "safety", "guidelines", "support"]) expect((await fetch(`http://127.0.0.1:${up.port}/${path}`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${up.port}/..%2f..%2fsites.ts`)).status).toBe(404);
  });
});


test("retired Join URLs return to the agent landing and never expose a cached form over HTTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "retired-join-"));
  writeFileSync(join(dir, "join.html"), '<html><form data-retired-signup>Old form</form></html>');
  try {
    for (const app of ["friends", "slop", "ntwrk"]) {
      const server = await serveSite(SITES.find(s => s.app === app)!, {port:0, apiOrigin:"http://127.0.0.1:9", outdir:dir});
      try {
        for (const path of ["/join", "/join/", "/join.html", "/join?via=agent"]) {
          const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {redirect:"manual"});
          expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("/");
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(await response.text()).not.toContain("data-retired-signup");
        }
      } finally {await server.stop(true);}
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
