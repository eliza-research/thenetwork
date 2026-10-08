// PLAT-26: a session rotates after a day with a 60 s grace for requests in flight, a rotation chain
// ends 90 days after the OTP login, the store holds only a keyed hash, and delete-everything needs a
// fresh login (step-up).
import { describe, expect, test } from "bun:test";
import { APPS } from "../src/apps.ts";
import { createPublicApi } from "../src/api.ts";
import { SESSION_MAX_MS, SessionService, tokenHash } from "../src/sessions.ts";
import { MemoryPeopleStore } from "../src/store.ts";

const DAY = 24 * 3_600_000;

describe("sessions", () => {
  test("a rotation chain ends at its absolute lifetime; the stored hash is keyed", async () => {
    const store = new MemoryPeopleStore();
    let t = Date.UTC(2026, 9, 8);
    const sessions = new SessionService(store, { secret: "k".repeat(40), now: () => t });
    let { token, session } = await sessions.create("slop", "+12125550101", null);
    expect(session.tokenHash).toBe(tokenHash(token, "k".repeat(40)));
    expect(store.sessions.has(tokenHash(token, "other"))).toBe(false);
    const start = t;
    let alive = true;
    while (alive && t - start < SESSION_MAX_MS + 3 * DAY) {
      t += DAY + 1000;
      const a = await sessions.authenticate("slop", token);
      if (!a) alive = false; else token = a.token;
    }
    expect(alive).toBe(false);
    expect(t - start).toBeGreaterThan(SESSION_MAX_MS - 2 * DAY);
    expect(t - start).toBeLessThanOrEqual(SESSION_MAX_MS + 2 * DAY);
  });

  test("delete everything needs a login in the last 10 minutes", async () => {
    let t = Date.UTC(2026, 9, 8, 15);
    let code = "";
    const api = createPublicApi({ store: new MemoryPeopleStore(), otp: { name: "f", send: async () => { code = String(100000 + (t % 900000)); return { code }; } }, env: { PLATFORM_ENV: "dev" }, now: () => t, minStartMs: 0, minVerifyMs: 0, log: () => {} });
    const host = "localhost:5102", phone = "+12125550133";
    const call = async (path: string, body: unknown, cookie?: string) => {
      const r = (await api.fetch(new Request(`http://${host}${path}`, { method: "POST", headers: { host, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })))!;
      return { status: r.status, body: await r.json(), cookie: r.headers.get("set-cookie")?.split(";")[0] };
    };
    const login = async () => { await call("/api/auth/otp/start", { phone }); const v = await call("/api/auth/otp/verify", { phone, code }); t += 31_000; return v.cookie!; };
    const cookie = await login();
    expect((await call("/api/join", { firstName: "Ana", age: 30, consent: { sms: true, version: APPS.slop.consent.version } }, cookie)).status).toBe(200);
    t += 11 * 60_000;
    expect((await call("/api/me/delete", { scope: "all" }, cookie)).body).toMatchObject({ ok: false, error: "reauth" });
    const again = await login();
    expect((await call("/api/me/delete", { scope: "all" }, again)).status).toBe(200);
  });
});
