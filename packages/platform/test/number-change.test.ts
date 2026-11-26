import { describe, expect, test } from "vitest";
import { APPS } from "../src/apps.ts";
import { createPublicApi } from "../src/api.ts";
import { MemoryPeopleStore } from "../src/store.ts";

const MIN = 60_000;
const host = "localhost:5102";
const jsonH = { "content-type": "application/json" };

describe("member number change (memory store)", () => {
  let tests = 0;
  function setup() {
    const store = new MemoryPeopleStore();
    const ip = `203.0.113.${++tests}`;
    let now = Date.UTC(2026, 9, 9, 15);
    const codes = new Map<string, string>();
    let n = 0;
    const api = createPublicApi({
      store, env: { PLATFORM_ENV: "dev" }, now: () => now, ipOf: () => ip, minStartMs: 0, minVerifyMs: 0, log: () => {},
      otp: { name: "fake", send: async e164 => { const code = String(100000 + ++n); codes.set(e164, code); return { code }; } },
    });
    const browser = () => {
      let cookie = "";
      const call = async (method: string, path: string, body?: unknown) => {
        const res = (await api.fetch(new Request(`http://${host}${path}`, { method, headers: { host, ...(cookie ? { cookie } : {}), ...(body ? jsonH : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })))!;
        const c = res.headers.get("set-cookie"); if (c) cookie = c.split(";")[0]!;
        return { status: res.status, body: await res.json().catch(() => null) as any };
      };
      const login = async (phone: string) => {
        expect((await call("POST", "/api/auth/otp/start", { phone })).status).toBe(200);
        expect((await call("POST", "/api/auth/otp/verify", { phone, code: codes.get(phone) })).status).toBe(200);
      };
      return { call, login };
    };
    const join = (b: ReturnType<typeof browser>) => b.call("POST", "/api/join", { firstName: "Ana", age: 31, consent: { sms: true, version: APPS.slop.consent.version } });
    return { store, api, codes, browser, join, tick: (ms: number) => { now += ms; }, now: () => now };
  }

  // spec/accountPrivacy.md, "A phone move after consent carries the recorded opt-out with the person"
  test("a recorded opt-out still holds after a move to a number with an earlier stranger opt-in", async () => {
    const t = setup();
    const [A, B] = ["+12125550301", "+12125550302"];
    const b = t.browser();
    await b.login(A);
    expect((await t.join(b)).status).toBe(200);
    await t.store.addConsent({ e164: A, app: null, state: "opted_out", source: "keyword:stop", at: t.now() });
    expect(await t.api.accounts.optedIn("slop", A)).toBe(false);
    t.tick(MIN);
    await t.store.addConsent({ e164: B, app: "slop", state: "opted_in", source: "keyword:start", at: t.now() });
    t.tick(MIN);
    expect((await b.call("POST", "/api/me/phone/start", { phone: B })).status).toBe(200);
    expect((await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(B) })).status).toBe(200);
    expect(await t.api.accounts.optedIn("slop", B)).toBe(false);
    expect((await t.store.consentEvents(B, "slop")).map(e => e.state)).toEqual(["opted_in"]);
  });

  // spec/carrierConsent.md, "A global STOP beats an older or simultaneous app opt-in"
  test("a STOP sent from the new number before the code is confirmed still holds after the move", async () => {
    const t = setup();
    const [A, B] = ["+12125550303", "+12125550304"];
    const b = t.browser();
    await b.login(A);
    expect((await t.join(b)).status).toBe(200);
    expect(await t.api.accounts.optedIn("slop", A)).toBe(true);
    expect((await b.call("POST", "/api/me/phone/start", { phone: B })).status).toBe(200);
    t.tick(MIN);
    await t.store.addConsent({ e164: B, app: null, state: "opted_out", source: "keyword:stop", at: t.now() });
    expect((await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(B) })).status).toBe(200);
    expect(await t.api.accounts.optedIn("slop", B)).toBe(false);
    expect((await t.store.consentEvents(B, "slop")).map(e => e.state)).toEqual(["opted_in"]);
  });

  // spec/accountPrivacy.md, "A phone move after consent carries the recorded opt-out with the person"
  test("an app opt-out recorded at the new number still holds after the move", async () => {
    const t = setup();
    const [A, B] = ["+12125550305", "+12125550306"];
    const b = t.browser();
    await b.login(A);
    expect((await t.join(b)).status).toBe(200);
    t.tick(MIN);
    await t.store.addConsent({ e164: B, app: "slop", state: "opted_out", source: "site:leave", at: t.now() });
    t.tick(MIN);
    expect((await b.call("POST", "/api/me/phone/start", { phone: B })).status).toBe(200);
    expect((await b.call("POST", "/api/me/phone/confirm", { code: t.codes.get(B) })).status).toBe(200);
    expect(await t.api.accounts.optedIn("slop", B)).toBe(false);
    expect((await t.store.consentEvents(B, "slop")).map(e => e.state)).toEqual(["opted_in", "opted_out"]);
  });
});
