// The network capital ledger in the production service (packages/capital, runtime.ts): what the
// Network emits during a member's life reaches the live ledger, network.capital_events stores it,
// and a restart replays it into the same ledger. Postgres in a database of its own per test process.
// Nothing is sent: dry-run adapters.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_capital_ledger_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const s = new SQL({ url: ADMIN_URL, max: 1 }); try { await s.unsafe("set lock_timeout = '5s'"); await s.unsafe(q); } finally { await s.close(); } }

const SECRET = "whsec_shared", APP_SECRET = "whsec_app";
let phoneSeq = 0;
/** Fictional numbers only (+1 212 555 01xx). */
const newPhone = () => `+121255501${String(30 + ++phoneSeq).padStart(2, "0")}`;

let sql: SQL;
const open: NetworkService[] = [];

function service(clock: SimClock) {
  const s = new NetworkService({
    url: URL_, clock, instance: "capital", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "friends:nyc" }],
    tokens: "admin:adm-tok", webhookSecret: SECRET, webhookSecrets: { friends: APP_SECRET },
    network: { seed: 1 }, adapter: () => new DryRunAdapter(() => {}),
  });
  open.push(s);
  return s;
}

let evt = 0;
async function text(s: NetworkService, clock: SimClock, from: string, body: string, app: AppId = "friends") {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_cap_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_cap_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}/${app}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(APP_SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}
const memberOf = async (app: AppId, e164: string) =>
  (await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = ${app} and ph.e164 = ${e164}`)[0]?.id as string | undefined;

describe.skipIf(!pgAvailable)("the network capital ledger in the service (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    for (const s of open) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });
  const fresh = async () => { await applySchema(URL_, { reset: true, lockTimeout: "5s" }); };

  test("SD-049 an adult member who then states a minor age stops being eligible in the ledger, live and after a restart", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const p = newPhone();
    await text(s, clock, p, "Sol 36");
    const id = (await memberOf("friends", p))!;
    const ledger = () => s.runtimeFor("friends")!.capital.ledger;
    expect(ledger().isEligible(id)).toBe(true);
    await text(s, clock, p, "actually I'm 16");
    // The Network treats the member as a minor now (never matched): the ledger must agree.
    expect(ledger().isEligible(id)).toBe(false);
    await s.close();
    const restarted = service(clock);
    await restarted.start();
    expect(restarted.runtimeFor("friends")!.capital.ledger.isEligible(id)).toBe(false);
  }, T);

  test("SD-153 a restart replays the stored ledger events in the order the ledger accepted them", async () => {
    await fresh();
    const clock = new SimClock(START);
    const s = service(clock);
    const hp = newPhone(), rp = newPhone();
    await text(s, clock, hp, "Sol 36");
    await text(s, clock, rp, "Ana 29");
    const helper = (await memberOf("friends", hp))!, recipient = (await memberOf("friends", rp))!;
    const rt = s.runtimeFor("friends")!;
    // One help round: the Network's emitter sends help_given, then help_confirmed, at one time (helpFeedback, network.ts).
    await rt.unitOfWork(n => {
      const emit = (n as unknown as { emit(e: object, key: string): void }).emit.bind(n);
      emit({ type: "help_given", helper, recipient, helpId: "o_help" }, "o_help");
      emit({ type: "help_confirmed", helpId: "o_help", recipient, useful: true }, "o_help");
    });
    expect((await sql`select type from network.capital_events where app_id = 'friends' and id like 'help_%'`).length).toBe(2);
    const live = rt.capital.ledger.balance(helper);
    expect(live).toBeGreaterThan(0);
    await s.close();
    const restarted = service(clock);
    await restarted.start();
    const replayed = restarted.runtimeFor("friends")!.capital.ledger;
    expect(replayed.balance(helper)).toBe(live);
    expect(replayed.rejected()).toEqual([]);
  }, T);

  test("SD-156 an event the live ledger refuses (the wall clock stepped back) is not stored, so a restart does not accept it", async () => {
    await fresh();
    /** A wall clock that NTP can step back. */
    class WallClock extends SimClock { back(ms: number) { (this as unknown as { t: number }).t -= ms; } }
    const clock = new WallClock(START);
    const s = service(clock);
    const ap = newPhone(), bp = newPhone(), cp = newPhone();
    await text(s, clock, ap, "Sol 36");
    clock.advance(60 * MINUTE);
    await text(s, clock, bp, "Ana 29");
    clock.back(30 * MINUTE);
    await text(s, clock, cp, "Lee 41");
    const c = (await memberOf("friends", cp))!;
    const rt = s.runtimeFor("friends")!;
    // The live ledger refuses member_joined for c: its t is before the last event's.
    expect(rt.capital.rejects().map(r => r.id)).toContain(`member_joined:${c}`);
    expect(rt.capital.ledger.isEligible(c)).toBe(false);
    const stored = (await sql`select id from network.capital_events where app_id = 'friends'`).map((r: { id: string }) => r.id);
    expect(stored).not.toContain(`member_joined:${c}`);
    // b leaves: the rows that name b go. A replay must still not know c, as the live ledger did not.
    await text(s, clock, bp, "leave friends");
    await s.close();
    const restarted = service(clock);
    await restarted.start();
    expect(restarted.runtimeFor("friends")!.capital.ledger.isEligible(c)).toBe(false);
  }, T);
});
