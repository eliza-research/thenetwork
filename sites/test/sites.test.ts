// Builds the four app sites and checks what carriers, counsel and members rely on:
// titles, legal links, the exact consent wording, the 10DLC sentence, no other app's domain,
// same-origin API calls only, and the dev proxy's behavior when the API is up or down.
//   bun test sites
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SITES, buildSite, type Site } from "../sites.ts";
import { serveSite } from "../../scripts/sites-dev.ts";
import { toE164 } from "../shared/api.ts";

const TENDLC = "Mobile numbers and opt-in data are not shared with third parties or affiliates for marketing.";
const tmp = mkdtempSync(join(tmpdir(), "sites-test-"));
const out = (s: Site) => join(tmp, s.domain);
const read = (s: Site, f: string) => readFileSync(join(out(s), f), "utf8");
const htmlFiles = (s: Site) => readdirSync(out(s)).filter((f) => f.endsWith(".html"));
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
    const need = ["index.html", "join.html", "settings.html", "privacy.html", "terms.html", "guidelines.html", "404.html"];
    if (s.app !== "ntwrk") need.push("sms-terms.html");
    if (s.app === "slop") need.push("safety.html");
    expect(htmlFiles(s)).toEqual(expect.arrayContaining(need));
  });

  test("every page has a title and the legal links", () => {
    for (const f of htmlFiles(s)) {
      const html = read(s, f);
      expect(html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim().length ?? 0, f).toBeGreaterThan(3);
      for (const href of ["/privacy", "/terms", smsHref(s), "/guidelines", "/settings"]) {
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

  test("no page or script names another app's domain", () => {
    const others = SITES.filter((o) => o.app !== s.app).map((o) => o.domain);
    for (const f of readdirSync(out(s)).filter((f) => /\.(html|js|css)$/.test(f))) {
      const body = read(s, f).toLowerCase();
      for (const d of others) expect(body.includes(d), `${f} mentions ${d}`).toBe(false);
    }
  });

  test("the build carries security headers: no framing, same-origin only (Cloudflare _headers)", () => {
    const h = read(s, "_headers");
    expect(h).toContain("frame-ancestors 'none'");
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

  test("scripts call only same-origin /api paths", () => {
    for (const f of readdirSync(out(s)).filter((f) => f.endsWith(".js"))) {
      const js = read(s, f);
      expect(/https?:\/\//.test(js), `${f} has an absolute URL`).toBe(false);
      for (const m of js.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)) expect(m[1]!.startsWith("/api/")).toBe(true);
    }
  });
});

test("slop.date shows the dating safety notice before the phone step", () => {
  const slop = SITES.find((s) => s.app === "slop")!;
  const join = read(slop, "join.html");
  expect(join).toContain('data-first-step="safety"');
  expect(join.indexOf('data-step="safety"')).toBeLessThan(join.indexOf('data-step="phone"'));
  const notice = "slop.date does not run criminal background checks";
  expect(text(join)).toContain(notice);
  expect(text(read(slop, "index.html"))).toContain(notice);
  expect(text(read(slop, "safety.html"))).toContain("slop.date does not conduct criminal background checks");
});

test("peon.biz says automated ranking waits for a bias audit and a person reviews every introduction", () => {
  const peon = SITES.find((s) => s.app === "peon")!;
  for (const f of ["index.html", "join.html"]) {
    const t = text(read(peon, f));
    expect(t, f).toContain("independent bias audit");
    expect(t, f).toMatch(/reviews every introduction/);
  }
});

test("ntwrk.love join page says joining is by invitation", () => {
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
  const api = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      seen = { host: req.headers.get("x-forwarded-host"), cookie: req.headers.get("cookie"), ip: req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") };
      return Response.json({ ok: true }, { headers: { "set-cookie": "sid=abc; HttpOnly; Secure; SameSite=Lax; Domain=slop.date; Path=/" } });
    },
  });
  const up = serveSite(slop, { port: 0, apiOrigin: `http://127.0.0.1:${api.port}`, outdir: out(slop) });
  const down = serveSite(slop, { port: 0, apiOrigin: "http://127.0.0.1:9", outdir: out(slop) });
  afterAll(() => {
    api.stop(true);
    up.stop(true);
    down.stop(true);
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
