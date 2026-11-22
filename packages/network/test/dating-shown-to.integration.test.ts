import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { MINUTE, SimClock } from "@thenetwork/core";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

const T = 300_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const USER = process.env.USER ?? "postgres";
const DB = `network_dating_shown_to_test_${process.pid}`;
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${USER}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

const SECRET = "whsec_dating_shown_to";
const ADMIN = "adm-tok", REVIEWER = "rev-tok";
const KAI = "+12125550181", SAM = "+12125550182";

let sql: SQL;
let svc: NetworkService | undefined;
let evt = 0;

describe.skipIf(!pgAvailable)("dating: a nonbinary member's shown-to choice (NetworkService, Postgres)", () => {
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

  test("a man who seeks women is proposed to a nonbinary member shown to women seekers", async () => {
    const clock = new SimClock(START);
    const s = svc = new NetworkService({
      url: URL_, clock, instance: "dating-shown-to", log: () => {}, env: { PLATFORM_ENV: "dev" }, networks: [{ id: "slop:nyc" }],
      tokens: `admin:${ADMIN},reviewer:${REVIEWER}`, webhookSecret: SECRET, network: { seed: 1 }, photoStorage: null, notify: false,
      adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const text = async (from: string, body: string) => {
      const n = ++evt;
      const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test", data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
      const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, { method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw }));
      expect(res.status).toBe(200);
      await res.text();
      clock.advance(MINUTE);
    };
    const lastOutbound = async (e164: string): Promise<string> => {
      const [m] = await sql`select x.body from network.messages x join network.members m on m.id = x.member_id and m.app_id = x.app_id
        join platform.phone_identities p on p.person_id = m.person_id where x.app_id = 'slop' and p.e164 = ${e164}
        and x.direction = 'outbound' order by x.ts desc, x.id desc limit 1`;
      return (m?.body as string | undefined) ?? "";
    };
    const staff = async (token: string, method: string, path: string, b?: unknown) => {
      const res = await s.fetch(new Request(`http://127.0.0.1:4848/apps/slop${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(b ? { "content-type": "application/json" } : {}) }, ...(b ? { body: JSON.stringify(b) } : {}) }));
      expect(res.status).toBe(200);
      return await res.json() as any;
    };

    const memberIds: string[] = [];
    for (const [e164, lines, shownTo] of [
      [KAI, ["slop", "Kai, 30", "I'm nonbinary, looking for men. Live in Greenpoint, love climbing and live music", "I'm nonbinary looking for men, 27 to 38, within 5 miles of 11222", "Something serious, no smokers", "Weekend evenings work best"], "Women, please"],
      [SAM, ["slop", "Sam, 31", "I'm a man into women. Williamsburg, I climb and go to shows", "I'm a man looking for women, 25 to 35, within 5 miles of 11211", "A relationship, no smokers", "Weekend evenings work best"], "Neither"],
    ] as const) {
      for (const line of lines) await text(e164, line);
      const answered: string[] = [];
      for (let i = 0; i < 8; i++) {
        const q = await lastOutbound(e164);
        if (answered.includes(q) || !/\?/.test(q)) break;
        answered.push(q);
        await text(e164, /right\?/.test(q) ? "Yes, that's right." : /shown to people/.test(q) ? shownTo : /trans people/.test(q) ? "Yes" : "Coffee or a walk.");
      }
      const [row] = await sql`select m.id from network.members m join platform.phone_identities p on p.person_id = m.person_id where m.app_id = 'slop' and p.e164 = ${e164}`;
      memberIds.push(row.id as string);
    }
    const state = (await sql`select state from network.network_state where id = 'slop:nyc'`)[0].state;
    const st = typeof state === "string" ? JSON.parse(state) : state;
    const tagsOf = (id: string): string[] => st.members.find((x: any) => x.id === id).appTags.map((t: any) => t.tag);
    expect(tagsOf(memberIds[0]!)).toEqual(expect.arrayContaining(["romance:is:nonbinary", "romance:seeks:man", "romance:shown_to:woman", "romance:open_trans:open"]));
    expect(tagsOf(memberIds[0]!)).not.toContain("romance:seeks:woman");
    expect(tagsOf(memberIds[1]!)).toEqual(expect.arrayContaining(["romance:is:man", "romance:seeks:woman"]));

    await staff(ADMIN, "POST", "/matching", { on: true });
    let item: any;
    for (let i = 0; i < 12 && !item; i++) {
      for (let t = 0; t < 4; t++) { clock.advance(30 * MINUTE); await s.tick(); }
      item = (await staff(REVIEWER, "GET", "/review")).items?.[0];
    }
    expect(item).toBeDefined();
    expect((await sql`select distinct status from network.messages where direction = 'outbound'`).map((r: any) => r.status)).toEqual(["dry_run"]);
  }, T);
});
