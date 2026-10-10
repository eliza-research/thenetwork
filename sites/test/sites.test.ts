// Builds the four app sites and checks what carriers, members and agents rely on: titles, legal and
// support links, the consent wording (equal to the platform's canonical text), the 10DLC sentence, the
// age rules (equal to the platform registry), STOP copy, the umbrella links, the files Cloudflare serves
// as they are (_headers, SKILL.md, robots.txt, .well-known), same-origin scripts, and the dev proxy.
//   bun test sites
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyProxyHeaders } from "../../packages/platform/src/proxy.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { SITES, buildSite, walk, type Site } from "../sites.ts";
import { serveSite } from "../../scripts/sites-dev.ts";
import { toE164 } from "../shared/api.ts";

const REPO = join(import.meta.dir, "../..");

const TENDLC = "Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing.";
const tmp = mkdtempSync(join(tmpdir(), "sites-test-"));
const out = (s: Site) => join(tmp, s.domain);
const read = (s: Site, f: string) => readFileSync(join(out(s), f), "utf8");
const htmlFiles = (s: Site) => readdirSync(out(s)).filter((f) => f.endsWith(".html"));
const OTHER_APP_DOMAINS = (s: Site) => SITES.filter((o) => o.app !== s.app && o.app !== "ntwrk").map((o) => o.domain);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const smsPage = (s: Site) => (s.app === "ntwrk" ? "terms.html" : "sms-terms.html");
const smsHref = (s: Site) => (s.app === "ntwrk" ? "/terms#sms" : "/sms-terms");

function consentWording(html: string): string {
  const m = html.match(/<span data-consent-wording[^>]*>([\s\S]*?)<\/span>/);
  return m ? text(m[1]!) : "";
}

beforeAll(async () => {
  for (const s of SITES) {
    const r = await buildSite(s, out(s));
    if (!r.ok) throw new Error(`build failed for ${s.domain}: ${r.logs.join("\n")}`);
  }
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe.each(SITES)("$domain", (s) => {
  test("every required page is built", () => {
    const need = ["index.html", "join.html", "settings.html", "privacy.html", "terms.html", "guidelines.html", "support.html", "404.html"];
    if (s.app !== "ntwrk") need.push("sms-terms.html");
    if (s.app === "slop") need.push("safety.html");
    expect(htmlFiles(s)).toEqual(expect.arrayContaining(need));
  });

  test("every page has a title and the legal links", () => {
    for (const f of htmlFiles(s)) {
      const html = read(s, f);
      expect(html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim().length ?? 0, f).toBeGreaterThan(3);
      for (const href of ["/privacy", "/terms", smsHref(s), "/guidelines", "/settings", "/support"]) {
        expect(html.includes(`href="${href}"`), `${f} links ${href}`).toBe(true);
      }
    }
  });

  test("the join page stores the consent wording that the SMS terms quote", () => {
    const wording = consentWording(read(s, "join.html"));
    expect(wording).toContain("Reply STOP");
    expect(wording).toContain("HELP");
    expect(wording).toContain("Message and data rates may apply");
    if (s.app !== "ntwrk") expect(text(read(s, smsPage(s)))).toContain(wording);
  });

  test("privacy and SMS terms carry the 10DLC sentence", () => {
    expect(text(read(s, "privacy.html"))).toContain(TENDLC);
    expect(text(read(s, smsPage(s)))).toContain(TENDLC);
  });

  test("the join page's consent wording is the platform's canonical text for this app", () => {
    expect(consentWording(read(s, "join.html"))).toBe(APPS[s.app].consent.text);
  });

  test("ages on every page equal the platform registry: 13 to join, 18 to be matched", () => {
    const app = APPS[s.app];
    expect(app.minJoinAge).toBe(13);
    expect(app.minMatchAge).toBe(18);
    expect(read(s, "join.html")).toContain(`data-min-age="${app.minJoinAge}"`);
    for (const f of htmlFiles(s)) {
      for (const m of text(read(s, f)).matchAll(/\b(\d{1,2}) (?:or|and) older\b/g)) {
        expect([app.minJoinAge, app.minMatchAge], `${f}: "${m[0]}"`).toContain(Number(m[1]));
      }
    }
    // Plain words for minors on the join page: they can join, and they are never matched.
    expect(text(read(s, "join.html"))).toMatch(/13 or older/);
    expect(text(read(s, "join.html"))).toMatch(/18 and older/);
  });

  test("STOP stops every app; 'leave <app>' stops one (PRD 40.3). No page says STOP ALL", () => {
    for (const f of htmlFiles(s)) expect(read(s, f), f).not.toContain("STOP ALL");
    const sms = text(read(s, smsPage(s)));
    expect(sms).toMatch(/STOP to stop every text from our number/);
    expect(sms).toContain(s.app === "ntwrk" ? '"leave slop.date"' : `leave ${s.domain}`);
  });

  test("umbrella: app sites say they are powered by The Network and name no other app", () => {
    for (const f of readdirSync(out(s)).filter((f) => /\.(html|js|css)$/.test(f))) {
      const body = read(s, f).toLowerCase();
      for (const d of OTHER_APP_DOMAINS(s)) {
        if (s.app !== "ntwrk") expect(body.includes(d), `${f} mentions ${d}`).toBe(false);
      }
    }
    if (s.app === "ntwrk") {
      const home = read(s, "index.html");
      for (const d of ["slop.date", "friends.help", "peon.biz"]) expect(home, d).toContain(`href="https://${d}"`);
      expect(text(home)).toContain(APPS.ntwrk && "All of these apps are powered by The Network.");
    } else {
      for (const f of htmlFiles(s)) {
        expect(read(s, f), f).toContain('powered by <a href="https://ntwrk.party">The Network</a>');
      }
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
      expect(files, f).toContain(f);
    }
    const staticDir = join(REPO, "sites", s.domain, "static");
    for (const f of walk(staticDir)) expect(readFileSync(join(out(s), f)).equals(readFileSync(join(staticDir, f))), f).toBe(true);
    for (const f of files) expect(statSync(join(out(s), f)).size, f).toBeGreaterThan(0);
    for (const f of files.filter((f) => /\.(html|md|json|txt)$/.test(f))) expect(read(s, f), f).not.toContain("{{");
    for (const f of ["SKILL.md", `.well-known/agent-skills/${s.skill}/SKILL.md`]) {
      const skill = read(s, f);
      expect(skill).toContain(`confirm its app is ${s.app}`);
      expect(skill).toContain("never submit across apps");
      if (s.app !== "slop") expect(skill).toContain(`In ChatGPT, add https://${s.domain}/mcp/openai instead`);
    }
  });

  test("the slop.date safety notice is information, never a step that blocks joining", () => {
    const join = read(s, "join.html");
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
    for (const f of readdirSync(out(s)).filter((f) => f.endsWith(".js") && f !== "_worker.js")) {
      const js = read(s, f);
      const urls = [...js.matchAll(/https?:\/\/[^"'`\s)]+/g)].map((m) => m[0]);
      for (const u of urls) expect(u.startsWith("https://challenges.cloudflare.com"), `${f} has ${u}`).toBe(true);
      for (const m of js.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)) expect(m[1]!.startsWith("/api/")).toBe(true);
    }
  });

  test("the phone step on join and settings carries the Turnstile slot and the site key meta", () => {
    for (const f of ["join.html", "settings.html"]) {
      const html = read(s, f);
      expect(html, f).toContain('<meta name="turnstile-sitekey" content="">');
      expect(html.indexOf("data-turnstile"), f).toBeGreaterThan(html.indexOf('data-form="phone"'));
    }
  });
});

test("agent-first landing pages (founder decision 10): name, one line, the prompt, Copy, Open-in links; nothing else", () => {
  const AGENTS = ["https://chatgpt.com/?q=", "https://claude.ai/new?q=", "https://grok.com/?q=", "https://www.perplexity.ai/search?q=", "https://cursor.com/link/prompt?text="];
  for (const s of SITES) {
    const home = read(s, "index.html");
    const name = s.app === "ntwrk" ? "The Network" : s.domain;
    const prompt = `Read https://${s.domain}/SKILL.md and follow it to sign me up for ${name}.`;
    expect(text(home), s.domain).toContain("Copy this into your agent.");
    expect(home, s.domain).toContain(`<code data-prompt>${prompt}</code>`);
    expect(home, s.domain).toMatch(/<button type="button" data-copy[^>]*>Copy<\/button>/);
    for (const a of AGENTS) expect(home, `${s.domain} ${a}`).toContain(`href="${a}${encodeURIComponent(prompt)}"`);
    // No safety notice, explanations or compliance text on the landing page; legal pages in the footer.
    expect(text(home), s.domain).not.toMatch(/background check|safety notice|How it works|What you get/i);
    for (const f of ["/privacy", "/terms", "/support", "/SKILL.md"]) expect(home, `${s.domain} ${f}`).toContain(`href="${f}"`);
    // The page is short: the name, one line and the prompt box (and, on ntwrk.party, the three apps).
    expect(text(home).split(/\s+/).length, s.domain).toBeLessThan(110);
    // CSP: no inline style or script.
    expect(home, s.domain).not.toMatch(/style="|<script(?![^>]*src=)/);
  }
});

test("slop.date keeps its safety information off the landing page, and photos are for adults only", () => {
  const slop = SITES.find((s) => s.app === "slop")!;
  const notice = "slop.date does not run criminal background checks";
  expect(text(read(slop, "join.html"))).toContain(notice);
  expect(text(read(slop, "index.html"))).not.toContain(notice);
  expect(text(read(slop, "safety.html"))).toContain("slop.date does not conduct criminal background checks");
  expect(text(read(slop, "safety.html"))).toContain("You do not have to accept it to join.");
  // Members aged 13 to 17 can join slop.date but get no matching and no photos.
  for (const f of ["join.html", "privacy.html"]) {
    const t = text(read(slop, f));
    expect(t, f).toMatch(/13 to 17|under 18/);
    expect(t, f).toMatch(/never asks? (them|you) for photos/);
  }
  expect(text(read(slop, "privacy.html"))).toContain("never shown to you, to other members or to anyone else");
});

test("peon.biz says a person reviews every introduction; no compliance gate blocks joining", () => {
  const peon = SITES.find((s) => s.app === "peon")!;
  for (const f of ["index.html", "join.html"]) {
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
  expect(existsSync(join(REPO, "sites/friends.help/public/index.html"))).toBe(true);
  expect(existsSync(join(REPO, "sites/buddies.nyc"))).toBe(false);
});

test("ntwrk.party join page says joining is by invitation", () => {
  const ntwrk = SITES.find((s) => s.app === "ntwrk")!;
  const join = read(ntwrk, "join.html");
  expect(join).toContain('data-join-mode="invite"');
  // The invite explanation is the visible default, so it shows without JavaScript.
  expect(join).toMatch(/<section data-step="invite">/);
});

test("toE164 accepts US numbers only", () => {
  expect(toE164("(212) 555-0123")).toBe("+12125550123");
  expect(toE164("+1 212 555 0123")).toBe("+12125550123");
  expect(toE164("+44 20 7946 0958")).toBeNull();
  expect(toE164("012 555 0123")).toBeNull();
  expect(toE164("555-0123")).toBeNull();
});

describe("dev server", () => {
  const slop = SITES.find((s) => s.app === "slop")!;
  let seen: { host: string | null; cookie: string | null; ip?: string | null } = { host: null, cookie: null };
  let last: Request | undefined;
  const api = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      seen = { host: req.headers.get("x-forwarded-host"), cookie: req.headers.get("cookie"), ip: req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") };
      last = req;
      return Response.json({ ok: true }, { headers: { "set-cookie": "sid=abc; HttpOnly; Secure; SameSite=Lax; Domain=slop.date; Path=/" } });
    },
  });
  const up = serveSite(slop, { port: 0, apiOrigin: `http://127.0.0.1:${api.port}`, outdir: out(slop) });
  const down = serveSite(slop, { port: 0, apiOrigin: "http://127.0.0.1:9", outdir: out(slop) });
  const signed = serveSite(slop, { port: 0, apiOrigin: `http://127.0.0.1:${api.port}`, outdir: out(slop), proxySecret: "dev-secret" });
  afterAll(() => {
    api.stop(true);
    up.stop(true);
    down.stop(true);
    signed.stop(true);
  });

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

  test("serves SKILL.md as markdown and the skills index", async () => {
    const md = await fetch(`http://127.0.0.1:${up.port}/SKILL.md`);
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    const idx = await fetch(`http://127.0.0.1:${up.port}/.well-known/agent-skills/index.json`);
    expect(((await idx.json()) as { skills: { name: string }[] }).skills.map((x) => x.name)).toEqual(["slop-date"]);
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
    const page = await fetch(`http://127.0.0.1:${up.port}/safety`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await fetch(`http://127.0.0.1:${up.port}/_headers`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${up.port}/no-such-page`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${up.port}/..%2f..%2fsites.ts`)).status).toBe(404);
  });
});
