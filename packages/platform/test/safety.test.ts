// Dev shortcuts refuse production, the Twilio Verify adapter (fake fetch: nothing leaves the
// process), and the recycled-number hold.
import { describe, expect, test } from "bun:test";
import { Accounts } from "../src/accounts.ts";
import { createPublicApi } from "../src/api.ts";
import { APPS } from "../src/apps.ts";
import { DevConsoleProvider, TwilioVerifyProvider } from "../src/otp.ts";
import { MemoryPeopleStore } from "../src/store.ts";
import { DevTurnstileBypass } from "../src/turnstile.ts";
import { requirePlatformEnv } from "../src/env.ts";

const PROD = { NODE_ENV: "production" };

describe("production guards", () => {
  test("the dev OTP console, the Turnstile bypass and the dev hash key are refused in production", () => {
    expect(() => new DevConsoleProvider(PROD)).toThrow("refused in production");
    expect(() => new DevConsoleProvider({ PLATFORM_ENV: "production" })).toThrow("refused in production");
    expect(() => new DevTurnstileBypass(PROD)).toThrow("refused in production");
    expect(() => createPublicApi({ store: new MemoryPeopleStore(), otp: { name: "x", send: async () => ({}) }, env: PROD })).toThrow("PLATFORM_HASH_KEY");
  });

  test("detection fails closed: an environment that is not declared dev gets no dev shortcut and Secure cookies", async () => {
    // Bun does not set NODE_ENV. Before the fix an empty environment counted as dev.
    for (const env of [{}, { PLATFORM_ENV: "staging" }, { PLATFORM_ENV: "prod" }]) {
      expect(() => new DevConsoleProvider(env)).toThrow("refused");
      expect(() => new DevTurnstileBypass(env)).toThrow("refused");
      expect(() => createPublicApi({ store: new MemoryPeopleStore(), otp: { name: "x", send: async () => ({}) }, env })).toThrow("PLATFORM_HASH_KEY");
    }
    expect(() => requirePlatformEnv({})).toThrow("PLATFORM_ENV");
    expect(requirePlatformEnv({ PLATFORM_ENV: "staging" })).toBe("staging");
    expect(() => createPublicApi({ store: new MemoryPeopleStore(), otp: { name: "x", send: async () => ({}) }, env: { PLATFORM_ENV: "staging" }, hashKey: "k", trustForwardedHost: true })).toThrow("dev");
    const api = createPublicApi({ store: new MemoryPeopleStore(), otp: { name: "x", send: async () => ({ code: "123456" }) }, env: { PLATFORM_ENV: "staging" }, hashKey: "k", minStartMs: 0, minVerifyMs: 0, log: () => {} });
    const req = (path: string, body: unknown) => new Request(`http://slop.date${path}`, { method: "POST", headers: { host: "slop.date", "content-type": "application/json" }, body: JSON.stringify(body) });
    await api.fetch(req("/api/auth/otp/start", { phone: "+12125550188" }));
    const v = (await api.fetch(req("/api/auth/otp/verify", { phone: "+12125550188", code: "123456" })))!;
    expect(v.headers.get("set-cookie")).toStartWith("__Host-sid=");
    expect(v.headers.get("set-cookie")).toContain("; Secure");
  });

  test("Twilio Verify runs only with OTP_PROVIDER=twilio and its three credentials; it posts to Verify v2 and trusts only 'approved'", async () => {
    expect(() => new TwilioVerifyProvider({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_VERIFY_SERVICE_SID: "VA1" })).toThrow("OTP_PROVIDER=twilio");
    expect(() => new TwilioVerifyProvider({ OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1" })).toThrow("TWILIO_AUTH_TOKEN");
    const calls: { url: string; body: string; auth: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).authorization! });
      const approved = String(init.body).includes("Code=123456");
      return new Response(JSON.stringify({ status: url.endsWith("VerificationCheck") ? (approved ? "approved" : "pending") : "pending" }));
    }) as unknown as typeof fetch;
    const t = new TwilioVerifyProvider({ OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_VERIFY_SERVICE_SID: "VA1" }, fake);
    expect(await t.send("+12125550101")).toEqual({});
    expect(await t.check("+12125550101", "000000")).toBe(false);
    expect(await t.check("+12125550101", "123456")).toBe(true);
    expect(calls[0]).toEqual({ url: "https://verify.twilio.com/v2/Services/VA1/Verifications", body: "To=%2B12125550101&Channel=sms", auth: `Basic ${btoa("AC1:t")}` });
    expect(calls[1]!.url).toBe("https://verify.twilio.com/v2/Services/VA1/VerificationCheck");
  });
});

describe("recycled numbers", () => {
  test("a phone not seen for more than 12 months is put on hold: no join, no person, until staff decide", async () => {
    const store = new MemoryPeopleStore();
    let t = Date.UTC(2025, 0, 1);
    const acc = new Accounts(store, { hashKey: "k", now: () => t, apps: id => APPS[id] });
    const phone = "+12125550142";
    const consent = { sms: true as const, wording: "ok" };
    expect((await acc.join(APPS.buddies, { e164: phone, personId: null }, { firstName: "Old", age: 40, consent })).ok).toBe(true);
    t = Date.UTC(2026, 3, 1); // 15 months later
    const r = await acc.join(APPS.peon, { e164: phone, personId: null }, { firstName: "New", age: 30, consent });
    expect(r).toEqual({ ok: false, error: "review" });
    expect(await acc.personFor(phone)).toBeUndefined();
    expect(await acc.clearHold(phone, "same_owner")).toBe(true);
    expect((await acc.join(APPS.peon, { e164: phone, personId: null }, { firstName: "Old", age: 40, consent })).ok).toBe(true);
  });
});
