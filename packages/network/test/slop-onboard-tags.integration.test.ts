// The slop onboarding loop and the tags it persists, through NetworkService on Postgres
// (docs/research/2026-11-07-state-machines.md, module matching_engine): what the member takes back is
// also gone from the engine's input. Postgres in a database of its own; dry-run sends; fictional
// numbers (+1 212 555 01xx). Nothing is sent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_slop_onboard_tags_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_slop_onboard_tags";
const NOOR = "+12125550191";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

async function text(s: NetworkService, clock: SimClock, from: string, body: string) {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
}
const memberId = async (e164: string) =>
  ((await sql`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id where m.app_id = 'slop' and ph.e164 = ${e164}`)[0] as { id: string } | undefined)?.id;
async function stored(id: string) {
  const state = (await sql`select state from network.network_state where id = 'slop:nyc'`)[0].state;
  const st = typeof state === "string" ? JSON.parse(state) : state;
  return st.members.find((x: any) => x.id === id);
}

describe.skipIf(!pgAvailable)("slop onboarding tags (NetworkService, Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
    sql = new SQL({ url: URL_, max: 2 });
  }, T);
  afterAll(async () => {
    await svc?.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  // SD-061: "no smokers", then "smoking is fine": the dealbreaker list is empty, and so are the tags.
  test("a dealbreaker the member takes back leaves no tag and no engine facet", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "slop-onboard-tags", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "ntwrk:nyc" }, { id: "slop:nyc" }],
      tokens: "admin:adm-tok", webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    for (const body of ["slop", "Noor, 31", "I'm a woman looking for men, 27 to 38, within 5 miles of 11222", "no smokers"]) await text(s, clock, NOOR, body);
    const noor = (await memberId(NOOR))!;
    expect(noor).toBeString();
    let me = await stored(noor);
    expect(me.onboarding.dealbreakers.map((d: any) => d.value)).toEqual(["smoker"]);
    expect(me.appTags.map((t: any) => t.tag)).toContain("slop:dealbreaker:smoker");

    await text(s, clock, NOOR, "smoking is fine actually");
    me = await stored(noor);
    expect(me.onboarding.dealbreakers).toEqual([]);
    expect(me.appTags.map((t: any) => t.tag).filter((t: string) => t.startsWith("slop:dealbreaker:"))).toEqual([]);
    const input = await s.runtimeFor("slop")!.readState(n => n.packInput(clock.now()));
    expect(input.facets.filter(f => f.memberId === noor).flatMap(f => f.tags).filter(t => t.startsWith("slop:dealbreaker:"))).toEqual([]);
    await s.close(); svc = undefined;
  }, T);
});
