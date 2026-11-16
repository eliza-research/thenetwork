// The sites' typed API client (packages/ui/src/api) against the real platform API (createPublicApi) in the
// same process: the join flow that peon.biz calls, and the member endpoints through the same `call`, with
// the same headers and bodies a browser sends. A fake OTP provider keeps the code in memory (nothing is
// sent). Audit SITE-01, SITE-02 and SITE-22.
//   pnpm run test:integration sites
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPS, type AppId } from "../../packages/platform/src/apps.ts";
import { createPublicApi, type PublicApi } from "../../packages/platform/src/api.ts";
import type { OtpProvider } from "../../packages/platform/src/otp.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { apiMessages, call, platformErrors } from "../../packages/ui/src/api/client.ts";
import { joinApp, readApp, readSession, startCode, verifyCode } from "../../packages/ui/src/api/join.ts";

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

describe("the member endpoints through the typed client", () => {
  const phone = "+12125550142";

  test("app info", async () => {
    const r = await call("GET", "/api/app");
    expect(r.ok && r.data.id).toBe(APP);
    expect(r.ok && r.data.minJoinAge).toBe(APPS[APP].minJoinAge);
  });

  test("sign in, join, export", async () => {
    jar = "";
    expect((await call("GET", "/api/me")).ok).toBe(false);
    expect(await startCode(phone)).toEqual({ result: "CodeSent" });
    expect(await verifyCode(phone, "000000")).toEqual({ result: "WrongCode" });
    expect(await verifyCode(phone, otp.codes.get(phone)!)).toEqual({ result: "Verified" });
    expect((await readSession()).result).toBe("MayJoin");
    const joined = await call("POST", "/api/join", { firstName: "Ana", age: 30, zip: "11201", consent: { sms: true, wording: APPS[APP].consent.text } });
    expect(joined.ok, JSON.stringify(joined)).toBe(true);
    expect((await call("GET", "/api/me/export")).ok).toBe(true);
  });

  test("stop works: it sends JSON and the API accepts it (audit sites-infra-1: it was always 415)", async () => {
    const r = await call("POST", "/api/me/stop");
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    const last = sent.at(-1)!;
    expect(last).toMatchObject({ method: "POST", path: "/api/me/stop", body: "{}" });
    expect(last.contentType).toBe("application/json");
    expect((await call("GET", "/api/me")).ok).toBe(true);
  });

  test("logout ends the session on the server before the page says so", async () => {
    const r = await call("POST", "/api/auth/logout");
    expect(r).toMatchObject({ ok: true });
    expect(sent.at(-1)).toMatchObject({ method: "POST", path: "/api/auth/logout", body: "{}", contentType: "application/json" });
    expect(await call("GET", "/api/me")).toMatchObject({ ok: false, error: "unauthorized" });
  });

  test("leave and delete-all after a new login", async () => {
    const other = "+12125550143";
    expect(await startCode(other)).toEqual({ result: "CodeSent" });
    expect(await verifyCode(other, otp.codes.get(other)!)).toEqual({ result: "Verified" });
    expect(await joinApp({ firstName: "Bo", age: 31, consent: { sms: true, wording: APPS[APP].consent.text } })).toMatchObject({ result: "JoinedOk", firstName: "Bo" });
    expect(await call("POST", "/api/me/delete", { scope: "app" })).toMatchObject({ ok: true });
    expect(await call("POST", "/api/me/delete", { scope: "all" })).toMatchObject({ ok: true });
  });
});

describe("the join page client (packages/ui/src/api) against createPublicApi", () => {
  const phone = "+12125550144";
  const platformCodes = () => {
    const src = ["api.ts", "accounts.ts"].map((f) => readFileSync(join(import.meta.dirname, "../../packages/platform/src", f), "utf8")).join("\n");
    return new Set([...src.matchAll(/error: "([a-z_]+)"/g)].map((m) => m[1]!));
  };

  test("reads the app, confirms the phone with a code, and joins with the canonical consent wording", async () => {
    jar = "";
    expect(await readApp()).toEqual({ read: true, inviteOnly: false, minJoinAge: APPS[APP].minJoinAge });
    expect((await readSession()).result).toBe("SignedOut");
    expect(await startCode(phone)).toEqual({ result: "CodeSent" });
    expect(sent.at(-1)).toMatchObject({ method: "POST", path: "/api/auth/otp/start", contentType: "application/json", body: JSON.stringify({ phone }) });
    expect(await verifyCode(phone, "000000")).toEqual({ result: "WrongCode" });
    expect(await verifyCode(phone, otp.codes.get(phone)!)).toEqual({ result: "Verified" });
    const session = await readSession();
    expect(session.result).toBe("MayJoin");
    expect(session.account).not.toBe("");
    const joined = await joinApp({ ...(session.signupView ? { signupView: session.signupView } : {}), firstName: "Cy", age: 29, consent: { sms: true, wording: APPS[APP].consent.text } });
    expect(joined, JSON.stringify(joined)).toMatchObject({ result: "JoinedOk", firstName: "Cy" });
    expect((await readSession()).result).toBe("AlreadyIn");
  });

  test("a bad phone maps to its own message", async () => {
    jar = "";
    expect(await startCode("+1555")).toEqual({ result: "StartFailed", error: "invalid_phone" });
    expect(apiMessages.invalid_phone).toBe("Enter a 10-digit US mobile number.");
  });

  test("the security check token goes in the otp/start body only when there is one", async () => {
    const bodies: string[] = [];
    const keep = globalThis.fetch;
    try {
      globalThis.fetch = (async (_p: RequestInfo | URL, init: RequestInit = {}) => {
        bodies.push(String(init.body));
        return Response.json({ ok: true });
      }) as typeof fetch;
      await startCode("+12125550142");
      await startCode("+12125550142", "tok-1");
    } finally {
      globalThis.fetch = keep;
    }
    expect(bodies.map((b) => JSON.parse(b))).toEqual([{ phone: "+12125550142" }, { phone: "+12125550142", turnstileToken: "tok-1" }]);
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
      expect(await startCode("+12125550142")).toEqual({ result: "StartCheckRejected" });
    } finally {
      globalThis.fetch = keep;
    }
  });

  test("each platform error used by the browser signup gives the join page a message", async () => {
    const codes = platformCodes();
    expect(codes.size).toBeGreaterThan(5);
    const keep = globalThis.fetch;
    try {
      for (const c of codes) {
        globalThis.fetch = (async () => Response.json({ ok: false, error: c }, { status: 400 })) as unknown as typeof fetch;
        const r = await call("POST", "/api/join", {});
        expect(r.ok, c).toBe(false);
        if (!r.ok) expect(apiMessages[r.error], c).toBeTruthy();
      }
    } finally {
      globalThis.fetch = keep;
    }
    // The browser join sends no invitation token and uses neither of the private home endpoints.
    const agentOrAccountOnly = new Set(["home_runtime_conflict", "invalid_invitation", "home_help_venue_unavailable"]);
    expect([...codes].filter((c) => !platformErrors[c] && !agentOrAccountOnly.has(c))).toEqual([]);
  });
});
