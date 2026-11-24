import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { MIGRATIONS_DIR } from "../../db/migrate.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { SIGNALS_PATH, TURN_PATH, type TurnRequest, type TurnResponse } from "../../core/src/svc/contract.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

type ListedSignal = { id: string; memberId: string; kind: string; evidence?: string; minor?: boolean; at: number; caseId: string };
type PauseText = { body: string; proactive: boolean; system: boolean; status: string };

const secret = "synthetic-agent-signals-fixture-20261117";
const clock = new SimClock(Date.UTC(2026, 10, 17, 16));
const CANARY = "AGENT_SIGNAL_EVIDENCE_CANARY";
const PAUSE_TEXT = "Matching is paused on friends, as you asked. Say ‘resume matching’ when you want new introductions again.";
const PAUSE_INBOX = "Matching on friends was paused, as you asked. To undo it, text ‘resume matching’ on the friends line. If you turned texts off, reply START first.";
const OPEN_TEXT = "Tell me something about the weather";
const MINOR_OPEN_TEXT = "Weather?";
const logs: string[] = [];
let url: string;
let sql: SQL;
let service: NetworkService;
let server: HttpServer;
let phoneSeq = 0;

const signed = async (path: string, body: object, id: string) => {
  const raw = JSON.stringify(body);
  const auth = await svcSign(secret, { method: "POST", path, id, body: raw, nowS: Math.floor(clock.now() / 1000) });
  return fetch(new URL(path, server.url), { method: "POST", headers: { "content-type": "application/json", ...auth }, body: raw });
};

const turn = (messageId: string, text: string, from: string): TurnRequest =>
  ({ messageId, channel: "blooio", from, to: null, text, transport: "imessage", receivedAt: clock.now(), app: "friends" });

async function sendTurn(messageId: string, text: string, from: string): Promise<TurnResponse> {
  clock.advance(MINUTE);
  const res = await signed(TURN_PATH, turn(messageId, text, from), messageId);
  if (res.status !== 200) throw new Error(`turn ${messageId}: ${res.status} ${await res.text()}`);
  return await res.json() as TurnResponse;
}

async function openTurn(from: string, label: string, text = OPEN_TEXT): Promise<{ messageId: string; memberId: string }> {
  const messageId = `${from}-${label}`;
  const opened = await sendTurn(messageId, text, from);
  if (opened.outcome !== "open") throw new Error(`turn ${messageId} did not open: ${opened.outcome}`);
  return { messageId, memberId: opened.memberId };
}

async function joinFriends(name: string, age: number, openText = OPEN_TEXT): Promise<{ phone: string; memberId: string; opened: string }> {
  const phone = `+1212555${String(1870 + ++phoneSeq).padStart(4, "0")}`;
  const lines = ["friends.help", `${name}, ${age}`, "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"];
  for (const [index, text] of lines.entries()) await sendTurn(`${phone}-setup-${index}`, text, phone);
  const { messageId, memberId } = await openTurn(phone, "open", openText);
  return { phone, memberId, opened: messageId };
}

const signal = (messageId: string, kind: string, memberId: string) =>
  signed(SIGNALS_PATH, { channel: "blooio", messageId, app: "friends", memberId, signals: [{ kind, evidence: CANARY }] }, `${messageId}:signals`);

const recorded = async (messageId: string, kind: string, memberId: string) => await (await signal(messageId, kind, memberId)).json() as unknown;

const pauseTexts = (memberId: string) => sql<PauseText[]>`select body, proactive, system, status from network.messages
  where app_id = 'friends' and member_id = ${memberId} and type = 'agent_pause_confirmation' order by ts, id`;

const pauseSends = () => logs.filter(line => line.startsWith("[dry-run] reply agent_pause_confirmation to ")).length;

const participation = async (memberId: string) => (await sql<{ participation_state: string; participation_window: unknown; opted_out: boolean }[]>`
  select participation_state, participation_window, opted_out from network.members where app_id = 'friends' and id = ${memberId}`)[0]!;

const staff = (token: string, method: string, path: string, body?: unknown) => service.fetch(new Request(`http://127.0.0.1/apps/friends${path}`,
  { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));

const listedSignals = async (token: string) => (await (await staff(token, "GET", "/signals")).json() as { ok: boolean; signals: ListedSignal[] });

describe.skipIf(!pgAvailable)("agent signals through the signed service path (Postgres)", () => {
  beforeAll(async () => {
    url = await migratedDb("agent_signals");
    sql = new SQL({ url, max: 4 });
    service = new NetworkService({
      url, clock, photoStorage: null, instance: "agent-signals-integration", env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret },
      networks: [{ id: "friends:nyc", matchingEnabled: false }], network: { seed: 1 }, log: line => { logs.push(line); },
      tokens: "safety@friends:saf-tok,reviewer@friends:rev-tok", adapter: () => new DryRunAdapter(line => { logs.push(line); }),
    });
    await service.start();
    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req) });
  }, 120_000);

  afterAll(async () => {
    await server?.stop(true);
    await service?.close();
    await sql?.close();
    await dropDb(url);
  });

  test("a safety concern opens the member's case and waits until safety staff decide it once, with audits and no evidence outside the signal", async () => {
    const { memberId, opened } = await joinFriends("Ari", 29);
    expect(await listedSignals("rev-tok")).toEqual({ ok: true, signals: [] });
    const first = await signal(opened, "safety_concern", memberId);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ recorded: 1 });
    expect(await recorded(opened, "safety_concern", memberId)).toEqual({ recorded: 1 });
    const cases = await service.runtimeFor("friends")!.readState(n => n.safetyCases().filter(c => c.memberId === memberId));
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ status: "open" });
    expect(cases[0]!.events.filter(e => e.kind === "agent_safety_concern")).toHaveLength(1);
    expect(JSON.stringify(cases)).not.toContain(CANARY);
    const listed = await listedSignals("rev-tok");
    expect(listed.signals).toEqual([{ id: expect.any(String), memberId, kind: "safety_concern", evidence: CANARY, at: clock.now(), caseId: cases[0]!.id }]);
    const id = encodeURIComponent(listed.signals[0]!.id);
    expect((await staff("rev-tok", "POST", `/signals/${id}`, { decision: "reviewed", reason: "Checked the case notes" })).status).toBe(403);
    expect((await staff("saf-tok", "POST", `/signals/${id}`, { decision: "reviewed", reason: "ok" })).status).toBe(400);
    expect((await staff("saf-tok", "POST", "/signals/service-signal%3Aunknown%3A0", { decision: "dismissed", reason: "No such signal here" })).status).toBe(404);
    const decided = await staff("saf-tok", "POST", `/signals/${id}`, { decision: "reviewed", reason: "Checked the case notes" });
    expect(decided.status).toBe(200);
    expect(await decided.json()).toEqual({ ok: true });
    expect((await staff("saf-tok", "POST", `/signals/${id}`, { decision: "dismissed", reason: "A second decision" })).status).toBe(409);
    expect(await listedSignals("rev-tok")).toEqual({ ok: true, signals: [] });
    expect((await sql<{ status: string }[]>`select status from network.facets where app_id = 'friends' and member_id = ${memberId} and value = ${CANARY}`)
      .map(r => r.status)).toEqual(["confirmed"]);
    const audits = await sql<{ ok: boolean; target_id: string | null; detail: { phase: string; refused?: string } }[]>`
      select ok, target_id, detail from network.staff_audit where app_id = 'friends' and action = 'decide_agent_signal' order by id`;
    expect(audits.map(a => [a.ok, a.detail.phase, a.detail.refused ?? null])).toEqual([
      [true, "requested", null], [false, "refused", "unknown_signal"], [true, "requested", null], [true, "requested", null], [false, "refused", "already_decided"]]);
    expect(audits[2]!.target_id).toBe(memberId);
    expect(JSON.stringify(await sql`select detail, reason from network.staff_audit`)).not.toContain(CANARY);
    expect(JSON.stringify(await sql`select payload from network.events where app_id = 'friends'`)).not.toContain(CANARY);
    expect((await service.runtimeFor("friends")!.readState(n => n.safetyCases().filter(c => c.memberId === memberId)))[0]).toMatchObject({ status: "open" });
  }, 120_000);

  test("an opt-out pauses matching in that app only, once, confirms it once by a reply text, and leaves carrier consent to STOP", async () => {
    const { phone, memberId, opened } = await joinFriends("Bo", 31);
    expect((await participation(memberId)).participation_state).not.toBe("paused");
    expect(await pauseTexts(memberId)).toEqual([]);
    const sends = pauseSends();
    const first = await signal(opened, "opt_out", memberId);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ recorded: 1 });
    expect(await recorded(opened, "opt_out", memberId)).toEqual({ recorded: 1 });
    expect(await participation(memberId)).toMatchObject({ participation_state: "paused", participation_window: null });
    const events = await sql<{ actor_type: string; payload: { state: string; source: string } }[]>`select actor_type, payload from network.events
      where app_id = 'friends' and type = 'member_state_requested' and object_id = ${memberId}`;
    expect(events.map(e => [e.actor_type, e.payload.state, e.payload.source])).toEqual([["agent", "paused", "agent_signal"]]);
    expect(await pauseTexts(memberId)).toEqual([{ body: PAUSE_TEXT, proactive: false, system: true, status: "dry_run" }]);
    expect(pauseSends()).toBe(sends + 1);
    const person = (await service.accounts.personFor(phone))!;
    expect(await sql`select id from notify.inbox_items where person_id = ${person.id} and event_type = 'agent_pause_confirmation'`).toEqual([]);
    expect(await listedSignals("rev-tok")).toEqual({ ok: true, signals: [] });
    const after = await openTurn(phone, "after-opt-out");
    expect(await recorded(after.messageId, "opt_out", memberId)).toEqual({ recorded: 1 });
    expect(await pauseTexts(memberId)).toHaveLength(1);
    expect(pauseSends()).toBe(sends + 1);
    expect(await sql`select id from network.events where app_id = 'friends' and type = 'member_state_requested' and object_id = ${memberId}`).toHaveLength(1);
  }, 120_000);

  test("an opt-out that an older version stored as waiting is applied once by the 0080 migration and is never listed as waiting", async () => {
    const { memberId } = await joinFriends("Cy", 33);
    const signalled = new Date(clock.now() + HOUR);
    const storedWaitingOptOutId = `service-signal:stored-waiting-opt-out-${memberId}:0`;
    await sql`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, status, valid_from)
      values ('friends', ${storedWaitingOptOutId}, ${memberId}, 'fact', ${CANARY}, ${sql.array(["signal:opt_out"], "TEXT")}, 'agent_private', 'inferred', 'chat', 'proposed', ${signalled})`;
    expect(await listedSignals("rev-tok")).toEqual({ ok: true, signals: [] });
    expect((await staff("saf-tok", "POST", `/signals/${encodeURIComponent(storedWaitingOptOutId)}`, { decision: "reviewed", reason: "Checked the old opt-out" })).status).toBe(404);
    const migration = readFileSync(join(MIGRATIONS_DIR, "0080_agent_opt_out_signals_applied.sql"), "utf8");
    const agentPauses = async () => (await sql<{ actor_type: string; payload: { state: string; source: string } }[]>`select actor_type, payload from network.events
      where app_id = 'friends' and type = 'member_state_requested' and object_id = ${memberId} order by id`).map(e => [e.actor_type, e.payload.state, e.payload.source]);
    const status = async () => (await sql<{ status: string }[]>`select status from network.facets where app_id = 'friends' and id = ${storedWaitingOptOutId}`).map(r => r.status);
    await sql.unsafe(migration);
    expect(await participation(memberId)).toMatchObject({ participation_state: "paused", participation_window: null });
    expect(await status()).toEqual(["confirmed"]);
    expect(await agentPauses()).toEqual([["agent", "paused", "agent_signal"]]);
    await sql.unsafe(migration);
    expect(await agentPauses()).toEqual([["agent", "paused", "agent_signal"]]);
    await sql`update network.members set participation_state = 'normal' where app_id = 'friends' and id = ${memberId}`;
    await sql`delete from network.events where app_id = 'friends' and type = 'member_state_requested' and object_type = 'member' and object_id = ${memberId} and at >= ${signalled}`;
    expect(await sql<{ n: number }[]>`select count(*)::int as n from network.events
      where app_id = 'friends' and type = 'member_state_requested' and object_id = ${memberId} and at >= ${signalled}`).toEqual([{ n: 0 }]);
    await sql`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
      values ('friends', ${new Date(signalled.getTime() + MINUTE)}, 'member', ${memberId}, 'member_state_requested', 'member', ${memberId}, ${{ state: "normal", from: null, until: null }}::jsonb)`;
    await sql`update network.facets set status = 'proposed' where app_id = 'friends' and id = ${storedWaitingOptOutId}`;
    await sql.unsafe(migration);
    expect((await participation(memberId)).participation_state).toBe("normal");
    expect(await status()).toEqual(["confirmed"]);
  }, 120_000);

  test("a waiting signal of a member under 18 is listed to reviewer staff without its evidence, and safety staff read it", async () => {
    const { memberId, opened } = await joinFriends("Sam", 16, MINOR_OPEN_TEXT);
    expect((await signal(opened, "safety_concern", memberId)).status).toBe(200);
    const listed = async (token: string) => (await listedSignals(token)).signals.filter(s => s.memberId === memberId);
    expect(await listed("rev-tok")).toEqual([{ id: expect.any(String), memberId, kind: "safety_concern", minor: true, at: clock.now(), caseId: expect.any(String) }]);
    expect(await listed("saf-tok")).toEqual([{ id: expect.any(String), memberId, kind: "safety_concern", evidence: CANARY, at: clock.now(), caseId: expect.any(String) }]);
    expect(JSON.stringify(await listedSignals("rev-tok"))).not.toContain(CANARY);
  }, 120_000);

  test("a safety concern whose work fails stays unresolved and raises an alert that names the app and the member", async () => {
    const { memberId, opened } = await joinFriends("Dee", 35);
    const runtime = service.runtimeFor("friends")!, original = runtime.unitOfWork;
    runtime.unitOfWork = async () => { throw new Error("synthetic safety unit fault"); };
    const mark = logs.length;
    try {
      const failed = await signal(opened, "safety_concern", memberId);
      expect(failed.status).toBe(409);
      expect(await failed.json()).toEqual({ error: "action_unresolved", retryable: false });
    } finally { runtime.unitOfWork = original; }
    expect(logs.slice(mark).filter(line => line.startsWith("[alert] friends:") && line.includes(memberId) && line.includes("ended unresolved"))).toHaveLength(1);
    expect(await recorded(opened, "safety_concern", memberId)).toEqual({ error: "action_unresolved", retryable: false });
    expect(logs.slice(mark).filter(line => line.includes("ended unresolved"))).toHaveLength(1);
  }, 120_000);

  test("an opt-out of a member whose texts are off confirms the pause once as an inbox update and never as a text", async () => {
    const { phone, memberId, opened } = await joinFriends("Eli", 28);
    expect((await participation(memberId)).participation_state).not.toBe("paused");
    const sends = pauseSends();
    await sql`update network.members set opted_out = true where app_id = 'friends' and id = ${memberId}`;
    try {
      expect(await recorded(opened, "opt_out", memberId)).toEqual({ recorded: 1 });
      expect(await recorded(opened, "opt_out", memberId)).toEqual({ recorded: 1 });
    } finally { await sql`update network.members set opted_out = false where app_id = 'friends' and id = ${memberId}`; }
    expect((await participation(memberId)).participation_state).toBe("paused");
    expect(await pauseTexts(memberId)).toEqual([]);
    expect(pauseSends()).toBe(sends);
    const person = (await service.accounts.personFor(phone))!;
    expect(await sql`select person_id, app_id, urgency, summary from notify.inbox_items where person_id = ${person.id} and event_type = 'agent_pause_confirmation'`)
      .toEqual([{ person_id: person.id, app_id: "friends", urgency: "requested", summary: PAUSE_INBOX }]);
    const read = async () => (await service.updatesFor(person.id, "friends", "claude", undefined, () => true)).filter(update => update.kind === "agent_pause_confirmation");
    expect(await read()).toEqual([{ summary: PAUSE_INBOX, at: expect.any(String), kind: "agent_pause_confirmation" }]);
    expect(await read()).toEqual([]);
  }, 120_000);

  test("resume matching undoes an agent pause, and the next applied pause is confirmed again", async () => {
    const { phone, memberId, opened } = await joinFriends("Fay", 30);
    expect(await recorded(opened, "opt_out", memberId)).toEqual({ recorded: 1 });
    expect((await participation(memberId)).participation_state).toBe("paused");
    const resumed = await sendTurn(`${phone}-resume`, "Resume matching", phone);
    expect(resumed).toMatchObject({ outcome: "handled", reason: "participation_controls", replies: [expect.stringContaining("Matching is no longer paused")] });
    expect(await participation(memberId)).toMatchObject({ participation_state: "normal", participation_window: null });
    const texts = (await pauseTexts(memberId)).length, sends = pauseSends();
    const again = await openTurn(phone, "opt-out-after-resume");
    expect(await recorded(again.messageId, "opt_out", memberId)).toEqual({ recorded: 1 });
    expect((await participation(memberId)).participation_state).toBe("paused");
    expect((await pauseTexts(memberId)).slice(texts)).toEqual([{ body: PAUSE_TEXT, proactive: false, system: true, status: "dry_run" }]);
    expect(pauseSends()).toBe(sends + 1);
  }, 120_000);

  test("a STOP that only the ledger holds when the pause applies gets the inbox update, and the digest after START texts words that are still true", async () => {
    const { phone, memberId, opened } = await joinFriends("Gil", 34);
    expect((await participation(memberId)).participation_state).toBe("normal");
    const sends = pauseSends();
    const accounts = service.accounts, activeMembership = accounts.activeMembership;
    let calls = 0;
    accounts.activeMembership = async (...args) => {
      const found = await activeMembership.apply(accounts, args);
      if (++calls === 3) await accounts.recordConsent({ e164: phone, app: null, state: "opted_out", source: "keyword:stop", ref: "stop-race", at: clock.now() });
      return found;
    };
    try {
      expect(await recorded(opened, "opt_out", memberId)).toEqual({ recorded: 1 });
    } finally { accounts.activeMembership = activeMembership; }
    expect(calls).toBe(3);
    expect(await participation(memberId)).toMatchObject({ opted_out: false, participation_state: "paused" });
    expect(await pauseTexts(memberId)).toEqual([]);
    expect(pauseSends()).toBe(sends);
    const person = (await service.accounts.personFor(phone))!;
    expect(await sql`select summary, notified_at from notify.inbox_items where person_id = ${person.id} and event_type = 'agent_pause_confirmation' and seen_at is null`)
      .toEqual([{ summary: PAUSE_INBOX, notified_at: null }]);
    expect((await sendTurn(`${phone}-start`, "START", phone)).outcome).toBe("handled");
    const digests = (await sql`select id from network.messages where app_id = 'friends' and member_id = ${memberId} and type = 'notify'`).length;
    await service.notifyTick();
    const sent = (await sql<{ body: string; status: string }[]>`select body, status from network.messages
      where app_id = 'friends' and member_id = ${memberId} and type = 'notify' order by ts, id`).slice(digests);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.split("\n")).toContain(PAUSE_INBOX);
    expect(sent[0]!.status).toBe("dry_run");
    expect(JSON.stringify(await sql`select body from network.messages where app_id = 'friends' and member_id = ${memberId}`)).not.toContain("Texts are off");
  }, 120_000);
});
