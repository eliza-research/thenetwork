// The shared-line routing corpus (evals/network/line-routing.jsonl) through the real inbound path:
// a signed Blooio webhook on the shared line, the service's routing, the line gate, the text join and
// the answer to "what are you looking for?". Each row checks the typed reading the shell makes and the
// decision the service takes. Postgres in a database of its own per test process; every send is dry-run.
// spec/lineRouting.md, "STOP ends the message before any other check"; "A banned number gets only HELP and app leave"; "A refused app is never enrolled, even with "all of them""
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { MINUTE, SimClock } from "@thenetwork/core";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { APPS, keywordApp, lookingForReading, type AppId } from "../../platform/src/apps.ts";
import { detectKeyword } from "../../platform/src/consent.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService, parseJoinText, WEBHOOK_PATH } from "../service/service.ts";
import { START } from "./mini.ts";

type Row =
  | { kind: "first"; text: string; reading: { command: string; app: AppId | null }; decision: { outcome: string; app: AppId } }
  | { kind: "join"; text: string; reading: { age: number | null; name?: string }; decision: { outcome: string } }
  | { kind: "lookingFor"; text: string; reading: Record<string, unknown>; decision: { apps: AppId[] } };

const REPO = resolve(import.meta.dirname, "../../..");
const ROWS: Row[] = readFileSync(`${REPO}/evals/network/line-routing.jsonl`, "utf8").trim().split("\n").map(l => JSON.parse(l) as Row);
const COMMAND = { stop: "LineStop", stop_all: "LineStopAll", help: "LineHelp", start: "LineStart" } as const;
const APP_WORDS = Object.values(APPS).flatMap(a => [a.id, ...a.domain.split(".")]);
const ENROLL_ORDER = ["friends", "slop", "peon"];

const T = 600_000;
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const DB = `network_line_routing_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const URL_ = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
const SECRET = "whsec_shared";
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

let sql: SQL;
let phoneSeq = 0;
const newPhone = () => `+1646555${String(1000 + ++phoneSeq).padStart(4, "0")}`;
let evt = 0;
const open: NetworkService[] = [];

function service(clock: SimClock) {
  const directs: { app: string; to: string; body: string }[] = [];
  const s = new NetworkService({
    url: URL_, clock, instance: "routing", log: () => {}, env: { PLATFORM_ENV: "dev" },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "slop:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }],
    tokens: "admin:adm-tok", webhookSecret: SECRET, network: { seed: 1 },
    adapter: (_net, rt) => {
      const a = new DryRunAdapter(() => {});
      a.direct = async (to, body) => { directs.push({ app: rt.app.id, to, body }); return "dry_run"; };
      return a;
    },
  });
  open.push(s);
  return { s, directs };
}

async function text(s: NetworkService, clock: SimClock, from: string, body: string): Promise<string> {
  const n = ++evt;
  const raw = JSON.stringify({ id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_test",
    data: { message_id: `msg_${n}`, sender: from, chat_id: from, text: body, protocol: "imessage" } });
  const res = await s.fetch(new Request(`http://127.0.0.1${WEBHOOK_PATH}`, {
    method: "POST", headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw,
  }));
  expect(res.status).toBe(200);
  clock.advance(MINUTE);
  return (await res.json()).result as string;
}

const activeApps = async (e164: string) => (await sql`select m.app_id from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id
  where ph.e164 = ${e164} and m.state = 'active' order by m.app_id`).map((r: any) => r.app_id as string);

const compare = (misses: unknown[], text: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) misses.push({ text, got, want });
};

describe.skipIf(!pgAvailable)("shared-line routing corpus through the inbound path (Postgres)", () => {
  beforeAll(async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    sql = new SQL({ url: URL_, max: 2 });
    await applySchema(URL_, { reset: true, lockTimeout: "5s" });
  }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close().catch(() => {}); });
  afterAll(async () => {
    for (const s of open) await s.close().catch(() => {});
    await sql?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("the corpus has at least 60 rows and every kind of reading", () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(60);
    for (const kind of ["first", "join", "lookingFor"]) expect(ROWS.filter(r => r.kind === kind).length).toBeGreaterThanOrEqual(15);
  });

  test("a first message: its keyword and command reading, then the app it joins or the command it runs", async () => {
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    await s.start();
    const misses: unknown[] = [];
    for (const row of ROWS.filter((r): r is Extract<Row, { kind: "first" }> => r.kind === "first")) {
      const kw = detectKeyword(row.text);
      const reading = { command: kw ? COMMAND[kw] : "LineNoCommand", app: keywordApp(row.text) ?? null };
      const from = newPhone();
      const before = directs.length;
      const outcome = await text(s, clock, from, row.text);
      const app = directs.slice(before).find(d => d.to === from)?.app ?? "ntwrk";
      compare(misses, row.text, { reading, decision: { outcome, app } }, { reading: row.reading, decision: row.decision });
    }
    expect(misses).toEqual([]);
  }, T);

  test("a join answer: the stated age and name, then a member, an age question or an under-13 decline", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const misses: unknown[] = [];
    for (const row of ROWS.filter((r): r is Extract<Row, { kind: "join" }> => r.kind === "join")) {
      const said = parseJoinText(row.text, APP_WORDS, true);
      const reading = { age: said.age ?? null, ...(row.reading.name !== undefined ? { name: said.name } : {}) };
      const from = newPhone();
      expect(await text(s, clock, from, "hi")).toBe("join_asked");
      const outcome = await text(s, clock, from, row.text);
      compare(misses, row.text, { reading, decision: { outcome } }, { reading: row.reading, decision: row.decision });
      // Under the join age nothing is kept.
      if (row.decision.outcome === "under_age") expect(await activeApps(from)).toEqual([]);
    }
    expect(misses).toEqual([]);
  }, T);

  test("an answer to \"what are you looking for?\": each app wanted, refused or absent, then only the apps not refused", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const misses: unknown[] = [];
    for (const row of ROWS.filter((r): r is Extract<Row, { kind: "lookingFor" }> => r.kind === "lookingFor")) {
      const from = newPhone();
      expect(await text(s, clock, from, "hey")).toBe("join_asked");
      expect(await text(s, clock, from, "Mo, 30")).toBe("joined");
      await text(s, clock, from, row.text);
      const apps = (await activeApps(from)).filter(a => a !== "ntwrk").sort((a, b) => ENROLL_ORDER.indexOf(a) - ENROLL_ORDER.indexOf(b));
      compare(misses, row.text, { reading: lookingForReading(row.text), decision: { apps } }, { reading: row.reading, decision: row.decision });
    }
    expect(misses).toEqual([]);
  }, T);
});
