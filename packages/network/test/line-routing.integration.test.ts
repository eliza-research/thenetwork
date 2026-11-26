import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { DAY, MINUTE, SimClock } from "@thenetwork/core";
import { earliestDayKeyOf } from "../../core/src/birth-date.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { signBlooioPayload } from "../../blooio/src/blooio/webhook.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { migrate } from "../../db/migrate.ts";
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
const COMMAND = { stop: "LineStop", stop_all: "LineStop", help: "LineHelp", start: "LineStart" } as const;
const APP_WORDS = Object.values(APPS).flatMap(a => [a.id, ...a.domain.split(".")]);
const ENROLL_ORDER = ["friends", "slop", "peon"];

const T = 600_000;
const SECRET = "whsec_shared";

let url: string;
let sql: SQL;
let phoneSeq = 0;
const newPhone = () => `+1646555${String(1000 + ++phoneSeq).padStart(4, "0")}`;
let evt = 0;
const open: NetworkService[] = [];

function service(clock: SimClock) {
  const directs: { app: string; to: string; body: string }[] = [];
  const s = new NetworkService({
    url, clock, instance: "routing", log: () => {}, env: { PLATFORM_ENV: "dev" },
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

const activeApps = async (e164: string) => (await sql<{ app_id: string }[]>`select m.app_id from platform.memberships m join platform.phone_identities ph on ph.person_id = m.person_id
  where ph.e164 = ${e164} and m.state = 'active' order by m.app_id`).map(r => r.app_id);

const memberIdOf = async (app: AppId, e164: string) => (await sql<{ id: string }[]>`select m.id from network.members m join platform.phone_identities ph on ph.person_id = m.person_id
  where m.app_id = ${app} and ph.e164 = ${e164}`)[0]!.id;

async function metInSlop(s: NetworkService, clock: SimClock) {
  const ana = newPhone(), ben = newPhone();
  expect(await text(s, clock, ben, "slop.date")).toBe("join_asked");
  expect(await text(s, clock, ben, "Ben, 32")).toBe("joined");
  expect(await text(s, clock, ana, "slop.date")).toBe("join_asked");
  expect(await text(s, clock, ana, "Ana, 30")).toBe("joined");
  const anaSlop = await memberIdOf("slop", ana), benSlop = await memberIdOf("slop", ben);
  await s.runtimeFor("slop")!.unitOfWork(n => {
    const state = n.exportState();
    state.interactions.push({ id: "routing-met", kind: "group", category: "social", at: clock.now() - DAY, outcome: "completed", participants: [anaSlop, benSlop] });
    n.importState(state);
  });
  expect(await text(s, clock, ana, "friends.help")).toBe("join_asked");
  expect(await text(s, clock, ana, "Ana, 30")).toBe("joined");
  expect(await activeApps(ana)).toEqual(["friends", "slop"]);
  return { ana, anaSlop, benSlop };
}

async function askWhoInSlop(s: NetworkService, clock: SimClock, ana: string, anaSlop: string, benSlop: string) {
  expect(await text(s, clock, ana, "report him, he was rude")).toBe("handled");
  expect(await s.runtimeFor("slop")!.readState(n => n.exportState().members.find(m => m.id === anaSlop)?.pendingSafety))
    .toMatchObject({ verb: "report", targets: [benSlop] });
  expect(await s.runtimeFor("slop")!.readState(n => n.safetyReports())).toEqual([]);
}

const compare = (misses: unknown[], text: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) misses.push({ text, got, want });
};

describe.skipIf(!pgAvailable)("shared-line routing corpus through the inbound path (Postgres)", () => {
  beforeAll(async () => {
    url = await migratedDb("line_routing");
    sql = new SQL({ url, max: 2 });
  }, T);
  beforeEach(async () => { await migrate(url, { reset: true, lockTimeout: "5s" }); }, T);
  afterEach(async () => { for (const s of open.splice(0)) await s.close(); });
  afterAll(async () => {
    await sql?.close();
    await dropDb(url);
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
      const said = parseJoinText(row.text, APP_WORDS, true, earliestDayKeyOf(clock.now()));
      const reading = { age: said.age ?? null, ...(row.reading.name !== undefined ? { name: said.name } : {}) };
      const from = newPhone();
      expect(await text(s, clock, from, "hi")).toBe("join_asked");
      const outcome = await text(s, clock, from, row.text);
      compare(misses, row.text, { reading, decision: { outcome } }, { reading: row.reading, decision: row.decision });
      if (row.decision.outcome === "under_age") expect(await activeApps(from)).toEqual([]);
    }
    expect(misses).toEqual([]);
  }, T);

  test("the line gate: STOP before the ban, a banned or held number gets only HELP, a member's app keyword joins that app too", async () => {
    const clock = new SimClock(START);
    const { s, directs } = service(clock);
    await s.start();
    const repliesTo = (to: string, from: number) => directs.slice(from).filter(d => d.to === to).map(d => d.body);

    const banned = newPhone();
    await s.people.ban({ id: "line-routing-ban", scope: "phone", personId: null, phoneHash: s.accounts.phoneHash(banned), reason: "fixture",
      reportId: null, bannedBy: "fixture", at: clock.now() });
    let mark = directs.length;
    expect(await text(s, clock, banned, "slop")).toBe("held");
    expect(await text(s, clock, banned, "hi, I'm 30")).toBe("held");
    expect(repliesTo(banned, mark)).toEqual([]);
    expect(await text(s, clock, banned, "HELP")).toBe("held");
    expect(repliesTo(banned, mark)).toHaveLength(1);
    expect(await text(s, clock, banned, "STOP")).toBe("stopped");
    expect(await activeApps(banned)).toEqual([]);

    const held = newPhone();
    expect(await text(s, clock, held, "friends")).toBe("join_asked");
    expect(await text(s, clock, held, "Cy, 34")).toBe("joined");
    await s.people.setPhoneHold(held, "recycled_number", clock.now());
    mark = directs.length;
    expect(await text(s, clock, held, "slop")).toBe("held");
    expect(await text(s, clock, held, "what's new?")).toBe("held");
    expect(repliesTo(held, mark)).toEqual([]);
    expect(await text(s, clock, held, "HELP")).toBe("held");
    expect(repliesTo(held, mark)).toHaveLength(1);

    const member = newPhone();
    expect(await text(s, clock, member, "slop.date")).toBe("join_asked");
    expect(await text(s, clock, member, "Rae, 33")).toBe("joined");
    expect(await text(s, clock, member, "friends.help")).toBe("join_asked");
    expect(await text(s, clock, member, "Rae, 33")).toBe("joined");
    expect(await activeApps(member)).toEqual(["friends", "slop"]);
    expect(await text(s, clock, member, "leave slop.date")).toBe("left");
    expect(await activeApps(member)).toEqual(["friends"]);
    expect(await text(s, clock, member, "STOP")).toBe("handled");
    for (const app of ["friends", "slop"] as const) expect(await s.accounts.optedIn(app, member)).toBe(false);
  }, T);

  test("a report on the shared line goes to the app where the member met the person, not to the app that wrote last", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const { ana, benSlop } = await metInSlop(s, clock);
    expect(await text(s, clock, ana, "report Ben, he was rude and kept texting me")).toBe("handled");
    expect(await s.runtimeFor("slop")!.readState(n => n.safetyReports())).toEqual([expect.objectContaining({ subjectId: benSlop, status: "open" })]);
    expect(await s.runtimeFor("friends")!.readState(n => n.safetyReports())).toEqual([]);
  }, T);

  test("the answer to \"Who do you mean?\" goes to the app where the question waits, and the report is filed there", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const { ana, anaSlop, benSlop } = await metInSlop(s, clock);
    await askWhoInSlop(s, clock, ana, anaSlop, benSlop);
    expect(await text(s, clock, ana, "yes")).toBe("handled");
    expect(await s.runtimeFor("slop")!.readState(n => n.safetyReports())).toEqual([expect.objectContaining({ subjectId: benSlop })]);
    expect(await s.runtimeFor("friends")!.readState(n => n.safetyReports())).toEqual([]);
  }, T);

  test("a short answer after another app's newer message goes to that app and leaves the older \"Who do you mean?\" waiting", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const { ana, anaSlop, benSlop } = await metInSlop(s, clock);
    const anaFriends = await memberIdOf("friends", ana);
    await askWhoInSlop(s, clock, ana, anaSlop, benSlop);
    const asked = clock.now();
    const written = async (app: AppId, memberId: string) => (await sql<{ n: number }[]>`select count(*)::int as n from network.messages
      where app_id = ${app} and member_id = ${memberId} and direction = 'outbound' and ts >= ${new Date(asked)}`)[0]!.n;
    expect(["handled", "open"]).toContain(await text(s, clock, ana, "friends.help"));
    expect(await written("friends", anaFriends)).toBeGreaterThan(0);
    expect(await written("slop", anaSlop)).toBe(0);
    expect(await s.runtimeFor("slop")!.readState(n => n.exportState().members.find(m => m.id === anaSlop)?.pendingSafety))
      .toMatchObject({ verb: "report", targets: [benSlop] });
    expect(await s.runtimeFor("slop")!.readState(n => n.safetyReports())).toEqual([]);
    await text(s, clock, ana, "climbing");
    expect(await s.runtimeFor("slop")!.readState(n => n.exportState().members.find(m => m.id === anaSlop)?.pendingSafety))
      .toMatchObject({ verb: "report", targets: [benSlop] });
    expect(await s.runtimeFor("slop")!.readState(n => n.safetyReports())).toEqual([]);
  }, T);

  test("a join answer with an age for a third app joins that app and leaves the waiting \"Who do you mean?\" alone", async () => {
    const clock = new SimClock(START);
    const { s } = service(clock);
    await s.start();
    const { ana, anaSlop, benSlop } = await metInSlop(s, clock);
    expect(await text(s, clock, ana, "peon.biz")).toBe("join_asked");
    await askWhoInSlop(s, clock, ana, anaSlop, benSlop);
    expect(await text(s, clock, ana, "Ana, 30")).toBe("joined");
    expect(await activeApps(ana)).toEqual(["friends", "peon", "slop"]);
    expect(await s.runtimeFor("slop")!.readState(n => n.exportState().members.find(m => m.id === anaSlop)?.pendingSafety))
      .toMatchObject({ verb: "report", targets: [benSlop] });
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
