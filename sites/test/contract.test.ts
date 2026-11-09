// The sites' API client (sites/shared/api.ts) against the real platform API (createPublicApi) in the
// same process: every call the pages make, with the same headers and bodies a browser sends. A fake
// OTP provider keeps the code in memory (nothing is sent). Audit SITE-01, SITE-02 and SITE-22.
//   bun test sites
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPS, type AppId } from "../../packages/platform/src/apps.ts";
import { createPublicApi, type PublicApi } from "../../packages/platform/src/api.ts";
import type { OtpProvider } from "../../packages/platform/src/otp.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { api, call, MESSAGES, PLATFORM_ERRORS, toE164 } from "../shared/api.ts";
import { normalizePhone } from "../../packages/platform/src/phone.ts";
import { turnstileWarning } from "../sites.ts";
import { skillsConfig } from "../skills.config.ts";

const HOST = "slop.date";
const APP: AppId = "slop";

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  async send(e164: string) {
    const code = "246810";
    this.codes.set(e164, code);
    return { code };
  }
}

interface Sent { method: string; path: string; contentType: string | null; body: string }

let platform: PublicApi;
const otp = new FakeOtp();
const sent: Sent[] = [];
let jar = "";
const realFetch = globalThis.fetch;

beforeAll(() => {
  platform = createPublicApi({
    store: new MemoryPeopleStore(),
    otp,
    env: { PLATFORM_ENV: "dev" },
    hostMap: { [HOST]: APP },
    minStartMs: 0,
    minVerifyMs: 0,
    log: () => {},
  });
  // A browser on https://slop.date: relative URLs, the site's cookie jar, an Origin on POST.
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    const headers = new Headers(init.headers);
    headers.set("host", HOST);
    if (jar) headers.set("cookie", jar);
    if (init.method === "POST") headers.set("origin", `https://${HOST}`);
    const req = new Request(`https://${HOST}${path}`, { ...init, headers });
    sent.push({ method: req.method, path, contentType: headers.get("content-type"), body: init.body ? String(init.body) : "" });
    const res = (await platform.fetch(req)) ?? new Response("not found", { status: 404 });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [name, value] = pair!.split("=");
      jar = value ? `${name}=${value}` : "";
    }
    return res;
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("the client against createPublicApi", () => {
  const phone = "+12125550142";

  test("app info", async () => {
    const r = await api.app();
    expect(r.ok && r.data.id).toBe(APP);
    expect(r.ok && r.data.minJoinAge).toBe(APPS[APP].minJoinAge);
  });

  test("sign in, join, export", async () => {
    expect((await api.me()).ok).toBe(false);
    expect(await api.otpStart(phone)).toMatchObject({ ok: true });
    expect(await api.otpVerify(phone, "000000")).toMatchObject({ ok: false, error: "invalid_code" });
    expect(await api.otpVerify(phone, otp.codes.get(phone)!)).toMatchObject({ ok: true });
    const me = await api.me();
    expect(me.ok && me.data.canJoin).toBe(true);
    const joined = await api.join({ firstName: "Ana", age: 30, zip: "11201", consent: { sms: true, wording: APPS[APP].consent.text } });
    expect(joined.ok, JSON.stringify(joined)).toBe(true);
    const exp = await api.exportData();
    expect(exp.ok).toBe(true);
  });

  test("stop works: it sends JSON and the API accepts it (audit sites-infra-1: it was always 415)", async () => {
    const r = await api.stop();
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const last = sent.at(-1)!;
    expect(last).toMatchObject({ method: "POST", path: "/api/me/stop", body: "{}" });
    expect(last.contentType).toBe("application/json");
    // /api/me does not report the consent state yet (open issue), so the page shows its own status text.
    expect((await api.me()).ok).toBe(true);
  });

  test("logout ends the session on the server before the page says so", async () => {
    const r = await api.logout();
    expect(r).toMatchObject({ ok: true });
    expect(sent.at(-1)).toMatchObject({ method: "POST", path: "/api/auth/logout", body: "{}", contentType: "application/json" });
    expect(await api.me()).toMatchObject({ ok: false, error: "unauthorized" });
  });

  test("leave and delete-all after a new login", async () => {
    const other = "+12125550143";
    expect(await api.otpStart(other)).toMatchObject({ ok: true });
    expect(await api.otpVerify(other, otp.codes.get(other)!)).toMatchObject({ ok: true });
    expect(await api.join({ firstName: "Bo", age: 31, consent: { sms: true, wording: APPS[APP].consent.text } })).toMatchObject({ ok: true });
    expect(await api.remove("app")).toMatchObject({ ok: true });
    expect(await api.remove("all")).toMatchObject({ ok: true });
  });

  test("a bad phone maps to its own message", async () => {
    expect(await api.otpStart("+1555")).toMatchObject({ ok: false, error: "invalid_phone" });
  });
});

describe("error parity (audit sites-infra-17)", () => {
  test("every error code the platform API can send has a message on the sites", () => {
    const src = ["api.ts", "accounts.ts"].map((f) => readFileSync(join(import.meta.dir, "../../packages/platform/src", f), "utf8")).join("\n");
    // The value of an error field, with the codes of a ternary too.
    const fields = [...src.matchAll(/\berror: ([^,}\n]*)/g)].map((m) => m[1]!);
    const codes = new Set(fields.flatMap((f) => [...f.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!)));
    expect(codes.has("not_member")).toBe(true);
    expect(codes.size).toBeGreaterThan(5);
    for (const c of codes) {
      expect(PLATFORM_ERRORS[c], `platform code ${c} has no mapping`).toBeDefined();
      expect(MESSAGES[PLATFORM_ERRORS[c]!], c).toBeTruthy();
    }
  });

  test("a JSON 500 is a server error, not 'unreachable'; a non-JSON 200 is an error", async () => {
    const answer = (res: Response) => (async () => res) as unknown as typeof fetch;
    const keep = globalThis.fetch;
    try {
      globalThis.fetch = answer(Response.json({ ok: false, error: "server" }, { status: 500 }));
      expect(await call("GET", "/api/me")).toMatchObject({ ok: false, error: "server" });
      globalThis.fetch = answer(Response.json({ ok: false, error: "join_failed" }, { status: 500 }));
      expect(await call("POST", "/api/join", {})).toMatchObject({ ok: false, error: "server" });
      globalThis.fetch = answer(new Response("<html>captive portal</html>", { status: 200 }));
      expect(await call("GET", "/api/me")).toMatchObject({ ok: false, error: "api_unreachable" });
      globalThis.fetch = answer(new Response("Bad gateway", { status: 502 }));
      expect(await call("GET", "/api/me")).toMatchObject({ ok: false, error: "api_unreachable" });
      globalThis.fetch = answer(Response.json({ ok: false, error: "turnstile" }, { status: 400 }));
      expect(await call("POST", "/api/auth/otp/start", { phone: "+12125550142" })).toMatchObject({ ok: false, error: "turnstile" });
    } finally {
      globalThis.fetch = keep;
    }
  });

  test("an error code with the name of an Object.prototype key is no platform code", async () => {
    const keep = globalThis.fetch;
    try {
      for (const code of ["constructor", "toString", "__proto__"]) {
        globalThis.fetch = (async () => Response.json({ ok: false, error: code }, { status: 400 })) as unknown as typeof fetch;
        const result = await call("GET", "/api/me");
        expect(result, code).toMatchObject({ ok: false, error: "unknown" });
      }
    } finally {
      globalThis.fetch = keep;
    }
  });

  test("the Turnstile token goes in the otp/start body only when there is one", async () => {
    const bodies: string[] = [];
    const keep = globalThis.fetch;
    try {
      globalThis.fetch = (async (_p: RequestInfo | URL, init: RequestInit = {}) => {
        bodies.push(String(init.body));
        return Response.json({ ok: true });
      }) as typeof fetch;
      await api.otpStart("+12125550142");
      await api.otpStart("+12125550142", "tok-1");
    } finally {
      globalThis.fetch = keep;
    }
    expect(bodies.map((b) => JSON.parse(b))).toEqual([{ phone: "+12125550142" }, { phone: "+12125550142", turnstileToken: "tok-1" }]);
  });
});

describe("one phone rule on the client and the server", () => {
  const refused = [
    // Another country code with 10 digits in all: the old client read each as a US number.
    "+65 9234 5678", "+47 42 34 56 78", "+45 3212 3456", "+44 20 7946 0958",
    // The rest of the server's rule: letters, toll-free, Caribbean, service exchange, reserved ranges.
    "212 555 0123 ext", "(800) 555-0123", "876-555-0123", "212-911-0123", "212-555-012", "290-555-0123", "375-555-0123", "965-555-0123",
    "012 555 0123", "212 155 0123", "+", "", " ".repeat(30) + "212 555 0123 " + " ".repeat(30),
  ];
  const accepted = [["(212) 555-0123", "+12125550123"], ["+1 212 555 0123", "+12125550123"], ["1.212.555.0123", "+12125550123"], ["\u00a0+1-416-555-0123 ", "+14165550123"]] as const;

  test("each input gets the same answer from toE164 and normalizePhone", () => {
    for (const input of refused) {
      expect(toE164(input), input).toBeNull();
      expect(normalizePhone(input), input).toBeUndefined();
    }
    for (const [input, e164] of accepted) {
      expect(toE164(input), input).toBe(e164);
      expect(normalizePhone(input), input).toBe(e164);
      expect(normalizePhone(e164), e164).toBe(e164);
    }
  });

  test("the bundle that a browser loads has no node dependency", async () => {
    const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../shared/join.ts")], target: "browser", format: "esm" });
    expect(built.success).toBe(true);
    const text = await built.outputs[0]!.text();
    expect(text).toContain("data-form");
    expect(text).not.toContain("node:");
  });
});

describe("build configuration", () => {
  const origins = { ntwrk: "https://hub.example.test", slop: "https://slop.example.test", peon: "https://peon.example.test", friends: "https://friends.example.test" };
  const staging = { PLATFORM_ENV: "staging", STAGING_SITE_ORIGINS: JSON.stringify(origins) };

  test("a staging build refuses each production site as its backend", () => {
    expect(skillsConfig({ ...staging, BACKEND_ORIGIN: "https://backend.example.test" }).BACKEND_ORIGIN).toBe("https://backend.example.test");
    for (const domain of Object.values(APPS).map((a) => a.domain)) {
      expect(() => skillsConfig({ ...staging, BACKEND_ORIGIN: `https://${domain}` }), domain).toThrow("isolated");
    }
  });

  test("a Turnstile key of spaces warns the same as no key", () => {
    expect(turnstileWarning("peon.biz", { DEPLOY_TARGET: "production", TURNSTILE_SITE_KEY: "   " })).toContain("no TURNSTILE_SITE_KEY");
    expect(turnstileWarning("peon.biz", { DEPLOY_TARGET: "production" })).toContain("no TURNSTILE_SITE_KEY");
    expect(turnstileWarning("peon.biz", { DEPLOY_TARGET: "production", TURNSTILE_SITE_KEY: "0x4AAA" })).toBeUndefined();
  });
});
