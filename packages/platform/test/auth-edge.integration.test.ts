// The auth edge machines (quint/auth_edge.qnt) through the real public API on Postgres: the web OTP
// challenge, the web session and the rate buckets of a code send. Each case is a trace from the model
// findings (docs/research/quint-findings/auth_edge.md) that failed before its fix.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPublicApi, type PublicApi } from "../src/api.ts";
import type { AppId } from "../src/apps.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const HOST: Record<AppId, string> = { ntwrk: "localhost:5101", slop: "localhost:5102", peon: "localhost:5103", friends: "localhost:5104" };
let seq = 0;
const newPhone = () => { seq++; return `+1646555${String(1000 + seq)}`; };

function make(store: PgPeopleStore, opts: { globalPerHour?: number } = {}) {
  const clock = { t: Date.UTC(2026, 10, 7, 15) };
  const codes = new Map<string, string>();
  const sent: string[] = [];
  const api: PublicApi = createPublicApi({
    store, env: { PLATFORM_ENV: "dev" }, now: () => clock.t, minStartMs: 0, minVerifyMs: 0, log: () => {},
    ipOf: req => req.headers.get("x-real-ip") ?? "198.51.100.10",
    otpLimits: opts.globalPerHour !== undefined ? { globalPerHour: opts.globalPerHour } : undefined,
    otp: { name: "fake", send: async e164 => { sent.push(e164); const code = String(100000 + sent.length * 7919 % 900000); codes.set(e164, code); return { code }; } },
  });
  const call = async (app: AppId, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = (await api.fetch(new Request(`http://${HOST[app]}${path}`, {
      method, headers: { host: HOST[app], ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })))!;
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };
  return { api, clock, call, codes, sent };
}

const urls: string[] = [];
afterAll(async () => { for (const u of urls) await dropDb(u); });

describe.skipIf(!pgAvailable)("auth edge (Postgres)", () => {
  let store: PgPeopleStore;
  beforeAll(async () => { const u = await migratedDb("authedge"); urls.push(u); store = new PgPeopleStore(u); }, 120_000);
  afterAll(async () => { await store?.close(); });

  test("SD-013 a banned number gets no code and no session from web OTP", async () => {
    const c = make(store), phone = newPhone();
    const ban = () => store.ban({ id: `ban_ae_${process.pid}_${phone}`, scope: "phone", personId: null, phoneHash: c.api.accounts.phoneHash(phone), reason: "test", reportId: null, bannedBy: "staff", at: c.clock.t });
    // A code sent before the ban: the ban lands, then the code is entered. No session.
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    expect(c.sent).toEqual([phone]);
    await ban();
    const late = await c.call("slop", "POST", "/api/auth/otp/verify", { phone, code: c.codes.get(phone) });
    expect(late.status).toBe(400);
    expect(late.cookie).toBeUndefined();
    // A new start for the banned number: the same answer as for any number, and no SMS goes out.
    c.clock.t += 31_000;
    expect((await c.call("slop", "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
    expect(c.sent).toEqual([phone]);
  });
});
