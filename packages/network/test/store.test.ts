// State persistence (docs/network.md 11, admin-console gap 1): exportState / importState, the
// stores (MemoryStore, PgStore) and runTick. The proof: a Network that restarts from its stored
// state does exactly what an uninterrupted one does.
import { fileAt } from "../../core/src/runtime/files.ts";
import { findExecutable } from "../../core/src/runtime/process.ts";
import { afterAll, describe, expect, test } from "vitest";
import { runEngine } from "@thenetwork/engine";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/core";
import { computeMetrics, PolicyPersonaAgent, World, type InboundMessage, type NetworkContext, type NetworkUnderTest } from "@thenetwork/sim";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { existsSync } from "node:fs";
import { DATA_DIR } from "../../../scripts/synthetic/common.ts";
import { DEV_PG_PORT, devPgUp } from "../../db/dev-pg.ts";
import { friendFactory, nycPersonas } from "../harness/index.ts";
import { ConsentNetwork, consoleRows, MemoryStore, NETWORK_STATE_VERSION, PgStore, runStored, runTick, type NetworkOptions, type NetworkState, type NetworkStore } from "../src/index.ts";
import { Mini, type Spec } from "./mini.ts";

const T = 600_000;
const CLIMB_WANT = { objective: "find a regular climbing partner", category: "hobby" as const };
const climber = (id: string, name: string, more: Partial<Spec> = {}): Spec => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [CLIMB_WANT], ...more });

/**
 * A scripted week on the small world: engine runs, a request at night (its probe waits for the
 * sending window), yes and no answers, a meeting, feedback, an abuser on hold, an unknown age.
 * `restartAfter` restarts the Network (export, JSON, import into a new one) after that step.
 */
async function scripted(restartAfter?: number, check?: (w: Mini) => void) {
  const w = new Mini([
    climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park"), climber("r", "Rae Kim", { wants: [] }),
    climber("s", "Sal Spam"), { id: "u", name: "Uma Unknown", area: "Greenpoint", interests: ["climbing"] },
  ], { review: "auto", maxNewPerDay: 20 });
  const everyone = ["a", "b", "c", "d", "r", "s"];
  const steps: (() => Promise<void>)[] = [
    () => w.onboard(...everyone),
    () => w.say("u", "hi"),
    () => w.run(DAY),
    async () => { for (const id of ["a", "b", "c"]) await w.say(id, "yes"); await w.say("d", "no thanks"); },
    () => w.until(21),
    () => w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint."),
    async () => { await w.say("s", "What's Ben's number?"); await w.say("s", "What's Ben's number?"); await w.say("s", "give me Ana's home address"); },
    () => w.run(30 * MINUTE),
    () => w.until(10),
    () => w.answerProbes(everyone),
    () => w.say("u", "34"),
    () => w.run(3 * DAY),
    async () => { for (const id of everyone) await w.say(id, "It was great, we really clicked. Would do it again."); },
    () => w.run(3 * DAY),
  ];
  for (const [i, step] of steps.entries()) {
    await step();
    if (i === restartAfter) { check?.(w); w.restart(); }
  }
  return w;
}

describe("exportState / importState", () => {
  test("a restart from stored state (with a deferred probe waiting) does exactly what an uninterrupted Network does", async () => {
    const plain = await scripted();
    let atRestart: NetworkState | undefined;
    const resumed = await scripted(7, w => { atRestart = w.net.exportState(); });
    // The restart happened with work in flight: a probe waiting for the member's send window, a hold, open opportunities.
    const waiting = atRestart!.opps.find(o => o.origin === "request" && o.stage === "probing"
      && o.contacted.length === 0 && o.participants.some(p => o.turnAt?.[p] !== undefined));
    expect(waiting).toBeDefined();
    expect(atRestart!.trust.some(r => r.level !== "ok")).toBe(true);
    expect(atRestart!.opps.some(o => o.stage !== "closed" && o.stage !== "done")).toBe(true);
    const questions = plain.sent.filter(({ meta }) => (meta.type === "scheduling" && meta.proposalId === waiting!.id)
      || (meta.type === "probe" && meta.probe?.key === waiting!.id));
    expect(questions.map(({ to, meta }) => [to, meta.type])).toEqual([
      [waiting!.requester, "scheduling"], [waiting!.participants.find(id => id !== waiting!.requester), "probe"],
    ]);
    expect(plain.meetings.map(meeting => meeting.proposalId)).toContain(waiting!.id);
    expect(resumed.sent).toEqual(plain.sent);
    expect(resumed.logs).toEqual(plain.logs);
    expect(resumed.meetings).toEqual(plain.meetings);
    expect(resumed.net.counters).toEqual(plain.net.counters);
    expect(resumed.net.exportState()).toEqual(plain.net.exportState());
  }, T);

  test("export -> JSON -> import -> export is the same; another version is refused", async () => {
    const w = await scripted();
    const s = w.net.exportState();
    expect(s.version).toBe(NETWORK_STATE_VERSION);
    const again = new ConsentNetwork({ seed: 1, review: "auto", engine: { cities: ["nyc"] } });
    again.init(w.ctx());
    again.importState(JSON.parse(JSON.stringify(s)));
    expect(again.exportState()).toEqual(s);
    expect(() => again.importState({ ...s, version: 99 })).toThrow();
    // The review mode is never stored: a human-review Network stays human after importing a simulator state.
    const human = new ConsentNetwork({ seed: 1, engine: { cities: ["nyc"] } });
    human.importState(s);
    expect(human.reviewMode()).toBe("human");
  }, T);
});

// spec/repeatEncounter.md, "Require two independent responses about one recent completed opportunity"
test.each([
  ["a no-show", "I couldn't make it. Would do it again.", false, false],
  ["a positive rating alone", "It was great, we clicked.", false, false],
  ["explicit requests for different meetings", "I would love to meet again.", false, true],
  ["two explicit requests", "It was great. I would love to meet again.", true, false],
  ["an explicit request after a courtesy opener", "No worries, I would meet again.", true, false],
] as const)("repeat review follows delivered feedback across restart: %s", async (_label, secondFeedback, expected, separateMeetings) => {
  const pair = ["a", "b"];
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "human" });
  await w.onboard(...pair);
  const bookAndWaitForFeedback = async () => {
    const meetings = w.meetings.length;
    const id = w.propose(pair);
    expect(await w.runUntil(() => w.net.reviewQueue().some(o => o.oppId === id))).toBe(true);
    expect(w.net.review(id, "approve")).toBe(true);
    await w.answerProbes(pair);
    expect(w.meetings).toHaveLength(meetings + 1);
    const booked = w.mark();
    expect(await w.runUntil(() => pair.every(member => w.to(member, booked).some(message =>
      message.meta.proposalId === id && message.meta.type === "reminder")), 7 * DAY)).toBe(true);
    for (const member of pair) await w.say(member, "Yes, I'll be there.");
    expect(await w.runUntil(() => pair.every(member =>
      w.net.memberList().find(m => m.id === member)?.awaiting?.kind === "feedback"), 7 * DAY)).toBe(true);
  };
  await bookAndWaitForFeedback();
  await w.say("a", "It was great. Would do it again.");
  w.restart();
  if (separateMeetings) {
    await w.say("b", "We met as planned.");
    await bookAndWaitForFeedback();
    await w.say("a", "We met as planned.");
  }
  await w.say("b", secondFeedback);
  const before = w.mark();
  await w.run(DAY);
  const repeat = () => w.net.reviewQueue().filter(o => o.origin === "second_encounter");
  expect(repeat()).toHaveLength(expected ? 1 : 0);
  if (!expected) return;
  const [item] = repeat();
  expect(w.sent.slice(before).some(s => s.meta.proposalId === item!.oppId)).toBe(false);
  expect(w.net.review(item!.oppId, "reject")).toBe(true);
  w.restart();
  await w.run(DAY);
  expect(repeat()).toHaveLength(0);
}, T);

// spec/boundedHelp.md, "A direct home-entry request goes to staff before contacting helpers".
test("bounded help holds a home request privately and refuses an out-of-scope task", async () => {
  const w = new Mini([
    { id: "requester", name: "Ari Park", age: 30, area: "Greenpoint" },
    { id: "helper", name: "Ben Ito", age: 31, area: "Greenpoint", skills: ["moving_help"] },
  ], { review: "human" });
  await w.onboard("requester", "helper");
  const mark = w.mark();
  const address = "71 Fictional Street";
  await w.say("requester", `Find someone to help move a couch from my apartment at ${address}.`);

  const cases = () => w.net.safetyCases().filter(c => c.memberId === "requester");
  expect(cases()).toMatchObject([{ status: "open", level: "ok", events: [{ kind: "home_entry_help", points: 0 }] }]);
  expect(w.net.reviewQueue()).toEqual([]);
  expect(w.net.exportState().requests).toEqual([]);
  expect(w.sent.slice(mark).map(m => m.to)).toEqual(["requester"]);
  expect(w.sent.at(-1)?.body).toContain("team member needs to review");
  for (const records of [w.net.exportState(), w.logs, w.sent.slice(mark)]) expect(JSON.stringify(records)).not.toContain(address);

  w.restart();
  await w.say("requester", "I still need help moving a couch from my apartment.");
  expect(cases()).toMatchObject([{ events: [{ kind: "home_entry_help", points: 0 }] }]);
  for (const task of ["babysit my child", "watch my 6 y.o. Saturday", "pick my two kids up"]) {
    await w.say("requester", "Find someone to help move a couch and " + task + ".");
    expect(w.sent.at(-1)?.body).toContain("won't look for it");
  }
  expect(cases()).toMatchObject([{ events: [{ kind: "home_entry_help", points: 0 }] }]);
  expect(w.net.reviewQueue()).toEqual([]);
  expect(w.net.exportState().requests).toEqual([]);
  expect(w.sent.slice(mark).every(m => m.to === "requester")).toBe(true);
}, T);

test("bounded help rechecks an older home request when it would retry", async () => {
  const w = new Mini([
    { id: "requester", name: "Ari Park", age: 30, area: "Greenpoint" },
    { id: "helper", name: "Ben Ito", age: 31, area: "Greenpoint", skills: ["moving_help"] },
  ], { review: "human" });
  await w.onboard("requester", "helper");
  const before = structuredClone(w.net.exportState());
  before.requests.push({
    id: "old-home-request", at: w.clock.now() - DAY, kind: "people", category: "help", memberId: "requester",
    desireId: "moving_help", tags: [], outcome: "none",
  });
  w.net.importState(before);
  const mark = w.mark();
  await w.run(DAY);
  expect(w.net.exportState().requests.find(r => r.id === "old-home-request")).toMatchObject({ closed: true, outcome: "none" });
  expect(w.net.safetyCases()).toMatchObject([{ memberId: "requester", events: [{ kind: "home_entry_help", points: 0 }] }]);
  expect(w.net.reviewQueue()).toEqual([]);
  expect(w.sent.slice(mark).some(m => m.meta.type === "proposal" || m.meta.type === "probe")).toBe(false);
}, T);

// spec/boundedHelp.md, "An unfamiliar helper cannot be the only helper for home entry".
test("bounded help re-ranks the small-group pool when a home task needs a second helper", async () => {
  const objective = "Help move a couch from my apartment";
  // Shared, matchable Friend evidence makes the adult peers eligible for a group.
  const interests = ["volunteering"];
  const w = new Mini([
    { id: "requester", name: "Ari Park", age: 30, area: "Greenpoint", interests, wants: [{ objective, category: "help" }] },
    { id: "helper-a", name: "Ben Ito", age: 30, area: "Greenpoint", interests, skills: ["moving_help"] },
    { id: "helper-b", name: "Cy Moss", age: 30, area: "Greenpoint", interests, skills: ["moving_help"] },
    { id: "a-one-only", name: "Dee Yu", age: 30, area: "Greenpoint", interests, skills: ["moving_help"] },
  ]);
  for (const m of w.members) {
    if (m.id === "a-one-only") m.prefs.formats = ["one_to_one"];
    else if (m.id !== "requester") m.prefs.formats = ["small_group"];
  }
  for (const f of w.facets.filter(f => f.kind === "skill")) {
    f.kind = "offer";
    f.value = f.memberId === "a-one-only" ? objective : "Available to carry furniture and boxes";
  }
  // A help group is a circle of the asker's lane, so the requester and both helpers also form a
  // group_composer circle with the same pairs. With grounded evidence it scores above the help request
  // (0.539 against 0.435), and the selector uses each pair once per run (spec/selectionRun.md, "Each
  // reservation checks the city, pair, and member limits"), so the help request is not selected in the
  // same run. No fixture gives a help group without that circle. This case checks the helper ranking,
  // so that generator is off.
  const { proposals } = await runEngine(w.ctx().snapshot(), {
    cities: ["nyc"], retrieval: { minSim: 0 },
    floors: { fit: 0, mutualBenefit: 0, confidence: 0 },
    generators: { group_composer: false },
    thresholds: { byGenerator: { help_request: 0 } },
  });
  expect(proposals.find(p => p.generator === "help_request")).toMatchObject({
    participants: ["requester", "helper-a", "helper-b"], safetyClass: "medium",
  });
}, T);

test("an unavailable acquaintance cannot displace a valid two-helper home plan", async () => {
  const objective = "Help move a couch from my apartment";
  const interests = ["volunteering"];
  const w = new Mini([
    { id: "requester", name: "Ari Park", age: 30, area: "Greenpoint", interests, wants: [{ objective, category: "help" }] },
    { id: "known", name: "Ben Ito", age: 30, area: "Greenpoint", interests, skills: ["moving_help"] },
    { id: "helper-a", name: "Cy Moss", age: 30, area: "Greenpoint", interests, skills: ["moving_help"] },
    { id: "helper-b", name: "Dee Yu", age: 30, area: "Greenpoint", interests, skills: ["moving_help"] },
  ]);
  for (const m of w.members) {
    if (m.id.startsWith("helper-")) m.prefs.formats = ["small_group"];
  }
  for (const f of w.facets.filter(f => f.kind === "skill")) {
    f.kind = "offer";
    f.value = f.memberId === "known" ? objective : "Available to carry furniture and boxes";
  }
  w.edges.push({ from: "requester", to: "known", type: "knows", explicit: true, strength: 1, createdAt: w.clock.now() });
  const plan = async () => (await runEngine(w.ctx().snapshot(), {
    cities: ["nyc"], retrieval: { minSim: 0 }, floors: { fit: 0, mutualBenefit: 0, confidence: 0 },
    generators: { group_composer: false },
    thresholds: { byGenerator: { help_request: 0 } },
  })).proposals.find(p => p.generator === "help_request");
  expect(await plan()).toMatchObject({ participants: ["requester", "known"], safetyClass: "medium" });
  w.presence.push({ memberId: "known", city: "sf", type: "temporary", areas: ["Mission"],
    from: w.clock.now(), to: w.clock.now() + 24 * DAY });
  expect(await plan()).toMatchObject({ participants: ["requester", "helper-a", "helper-b"], safetyClass: "medium" });
}, T);

/** A NetworkUnderTest whose ConsentNetwork can be replaced mid-run (a process restart inside a world run). */
class Restartable implements NetworkUnderTest {
  readonly name = "consent";
  private ctx!: NetworkContext;
  constructor(public net: ConsentNetwork, private readonly opts: NetworkOptions) {}
  init(ctx: NetworkContext) { this.ctx = ctx; this.net.init(ctx); }
  onInbound(msg: InboundMessage) { return this.net.onInbound(msg); }
  tick(now: number) { return this.net.tick(now); }
  submitProposal(p: Parameters<NonNullable<NetworkUnderTest["submitProposal"]>>[0]) { return this.net.submitProposal(p); }
  async restart(store: MemoryStore) {
    await store.save(this.net.exportState());
    this.net = new ConsentNetwork(this.opts);
    this.net.init(this.ctx);
    this.net.importState((await store.load())!);
  }
}

async function nycWorld(days: number, restartAtDay?: number) {
  const seed = 3, opts: NetworkOptions = { seed, review: "auto", engine: { cities: ["nyc"] } };
  const personas = await nycPersonas();
  const start = (await fileAt(`${DATA_DIR}/manifest.json`).json()).snapshotNow as number;
  const net = new Restartable(new ConsentNetwork(opts), opts);
  const records: RunRecord[] = [];
  const w = new World({ seed, personas, days, start, writeLog: false, network: net, agent: new PolicyPersonaAgent(start), spawnFriend: friendFactory({ seed }), onRecord: r => records.push(r) });
  await w.begin();
  if (restartAtDay !== undefined) {
    // Restart right after the hourly tick that ends day `restartAtDay`.
    await w.advanceTo(start + restartAtDay * DAY);
    await net.restart(new MemoryStore());
  }
  await w.advanceTo(w.end);
  await w.complete();
  return { records, net: net.net, start };
}

describe("NYC world: 5 days, restart from stored state, 5 more days", () => {
  test("records and counters from day 5 to day 10 equal an uninterrupted 10-day run", async () => {
    const plain = await nycWorld(10);
    const resumed = await nycWorld(10, 5);
    const after = (r: { records: RunRecord[]; start: number }) => r.records.filter(x => (x.type === "message" || x.type === "network_log") && (x.type === "message" ? x.msg.ts : x.t) > r.start + 5 * DAY);
    const a = after(plain), b = after(resumed);
    expect(a.length).toBeGreaterThan(500);
    expect(b.length).toBe(a.length);
    expect(b).toEqual(a);
    expect(resumed.net.counters).toEqual(plain.net.counters);
    expect(resumed.net.exportState()).toEqual(plain.net.exportState());
    const m = computeMetrics(resumed.records, {});
    expect(m.privacy.canaryLeaks).toBe(0);
    expect(m.safety.minorContacts).toBe(0);
  }, 2 * T);
});

describe("runTick and the tick lock", () => {
  test("runTick loads stored state into a fresh Network, ticks under the lock, saves; a held lock skips the tick", async () => {
    const w = await scripted();
    const store = new MemoryStore();
    await store.save(w.net.exportState());
    const fresh = new ConsentNetwork({ seed: 1, review: "auto", store, engine: { cities: ["nyc"] } });
    fresh.init(w.ctx());
    const now = w.clock.now() + HOUR;
    w.clock.set(now);
    expect(await runTick(fresh, undefined, now)).toBe(true);
    expect((await store.load())!.lastTick).toBe(now);
    expect(fresh.counters.scheduled).toBe(w.net.counters.scheduled);
    // While another holder has the lock, the tick does not run.
    const skipped = await store.withTickLock(() => runTick(fresh, store, now + HOUR));
    expect(skipped).toBe(false);
    expect((await store.load())!.lastTick).toBe(now);
  }, T);

  test("two Networks on one store: a STOP handled by one survives the other's next tick", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
    await w.onboard("a", "b");
    const store = new MemoryStore();
    await store.save(w.net.exportState());
    const two = () => { const n = new ConsentNetwork({ seed: 1, review: "auto", store, engine: { cities: ["nyc"] } }); n.init(w.ctx()); return n; };
    const A = two(), B = two();
    const optedOut = async () => (await store.load())!.members.find(m => m.id === "a")!.optedOut;
    const at = (h: number) => { const t = w.clock.now() + h * HOUR; w.clock.set(t); return t; };
    expect(await runTick(A, undefined, at(1))).toBe(true);
    expect(await runTick(B, undefined, at(1))).toBe(true);
    await runStored(B, undefined, n => n.onInbound({ id: "stop", memberId: "a", body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" }));
    expect(await optedOut()).toBe(true);
    expect(await runTick(B, undefined, at(1))).toBe(true);
    expect(await runTick(A, undefined, at(1))).toBe(true);
    expect(await optedOut()).toBe(true);
    expect(A.exportState().members.find(m => m.id === "a")!.optedOut).toBe(true);
    // An inbound message waits for a held lock (it is never skipped); a tick skips.
    let release!: () => void;
    const held = store.withLock(() => new Promise<void>(r => (release = r)));
    const inbound = runStored(A, undefined, n => n.onInbound({ id: "start", memberId: "a", body: "START", keyword: "START", ts: w.clock.now(), channel: "sms" }));
    expect(await runTick(B, undefined, at(1))).toBe(false);
    release(); await held; await inbound;
    expect(await optedOut()).toBe(false);
  }, T);

  test("console rows: review items with time spent, requests without the member's words", async () => {
    const w = await scripted();
    const rows = consoleRows(w.net.exportState());
    expect(rows.opportunities.length).toBe(w.net.opps.size);
    expect(rows.review_items.length).toBe(w.net.opps.size);
    expect(rows.requests.map(r => r.member_id)).toContain("r");
    expect(JSON.stringify(rows.requests)).not.toContain("Anyone around");
    expect(new Set(rows.opportunities.map(r => r.state))).toContain("COMPLETED");
    const state = w.net.exportState();
    const base = state.opps.find(o => o.participants.length >= 2);
    expect(base).toBeDefined();
    const pair = base!.participants.slice(0, 2);
    const cancelled = (id: string, told: string[]) => ({
      ...base!, id, stage: "closed" as const, closedFrom: "scheduled", participants: pair, alternates: [],
      status: pair.map((p): [typeof p, "yes"] => [p, "yes"]), bookedTold: told,
    });
    const cancelledRows = consoleRows({ ...state, opps: [cancelled("cancelled-told", pair), cancelled("cancelled-untold", []), cancelled("cancelled-one-told", [pair[0]!])] });
    expect(cancelledRows.opportunities.map(o => o.state)).toEqual(["CANCELLED", "CANCELLED", "CANCELLED"]);
    expect(cancelledRows.participations.filter(p => p.opportunity_id === "cancelled-told").map(p => p.status)).toEqual(["accepted", "accepted"]);
    expect(cancelledRows.participations.filter(p => p.opportunity_id === "cancelled-untold").map(p => p.status)).toEqual(["accepted", "accepted"]);
    expect(cancelledRows.participations.filter(p => p.opportunity_id === "cancelled-told").map(p => p.booked_told)).toEqual([true, true]);
    expect(cancelledRows.participations.filter(p => p.opportunity_id === "cancelled-untold").map(p => p.booked_told)).toEqual([false, false]);
    expect(cancelledRows.participations.filter(p => p.opportunity_id === "cancelled-one-told").map(p => p.booked_told)).toEqual([true, false]);
  }, T);
});

// ------------------------------------------------------------------ Postgres (local dev cluster)
// A database of its own per test process (the apps/observatory/test/pg.ts pattern). Skipped when Postgres is absent.
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!findExecutable("pg_ctl");
const DB = `network_store_test_${process.pid}`;
const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
const TEST_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/${DB}`;
async function admin(q: string) { const sql = new SQL({ url: ADMIN_URL, max: 1 }); try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); } }

describe.skipIf(!pgAvailable)("PgStore", () => {
  const stores: PgStore[] = [];
  afterAll(async () => {
    for (const s of stores) await s.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("save/load round trip, console rows, deleted rows, and the advisory lock (a second holder gets undefined)", async () => {
    await devPgUp();
    await admin(`drop database if exists ${DB} with (force)`);
    await admin(`create database ${DB}`);
    // The observatory schema first, then the Network's migration (twice: it is idempotent).
    const setup = new SQL({ url: TEST_URL, max: 1 });
    await setup.unsafe(await fileAt(new URL("../../db/schema.sql", import.meta.url)).text());
    await setup.close();
    const a = new PgStore(TEST_URL), b = new PgStore(TEST_URL);
    stores.push(a, b);
    await a.migrate(); await a.migrate();
    expect(await a.load()).toBeUndefined();

    const w = await scripted();
    const state = w.net.exportState();
    await a.save(state);
    expect(await b.load()).toEqual(state);
    const counts = await a.sql`select (select count(*)::int from network.opportunities) as opps, (select count(*)::int from network.review_items) as items, (select count(*)::int from network.requests) as reqs`;
    expect(counts[0]).toEqual({ opps: state.opps.length, items: state.opps.filter(o => o.review).length, reqs: state.requests.length });
    const req = await a.sql`select member_id, kind, outcome from network.requests where member_id = 'r'`;
    expect(req.length).toBeGreaterThan(0);

    // An opportunity the state no longer holds (an under-13 decline deletes it) is deleted on the next save.
    const gone = state.opps[0]!.id;
    await a.save({ ...state, opps: state.opps.slice(1), requests: state.requests.filter(r => r.oppId !== gone) });
    expect((await a.sql`select id from network.opportunities where id = ${gone}`).length).toBe(0);
    expect((await a.sql`select opportunity_id from network.review_items where opportunity_id = ${gone}`).length).toBe(0);

    // The tick lock: while a holds it, b gets undefined; after release, b gets it.
    const inner = await a.withTickLock(async () => await b.withTickLock(async () => "b ran"));
    expect(inner).toBeUndefined();
    expect(await b.withTickLock(async () => "b ran")).toBe("b ran");
    // runTick against Postgres: a fresh Network loads, ticks and saves.
    const net = new ConsentNetwork({ seed: 1, review: "auto", store: b, engine: { cities: ["nyc"] } });
    net.init(w.ctx());
    const now = w.clock.now() + HOUR;
    w.clock.set(now);
    expect(await runTick(net, undefined, now)).toBe(true);
    expect((await a.load())!.lastTick).toBe(now);

    const advance = () => net.importState({ ...net.exportState(), lastTick: now + HOUR });
    const actionFailure = new Error("action failed");
    await expect(runStored(net, b, () => {
      advance();
      throw actionFailure;
    })).rejects.toBe(actionFailure);
    expect((await a.load())!.lastTick).toBe(now);

    const saveFailure = new Error("transaction failed");
    const failingStore: NetworkStore = {
      load: () => b.load(),
      save: state => b.save(state, async () => { throw saveFailure; }),
      withTickLock: fn => b.withTickLock(fn),
      withLock: fn => b.withLock(fn),
    };
    await expect(runStored(net, failingStore, advance)).rejects.toBe(saveFailure);
    expect((await a.load())!.lastTick).toBe(now);
    expect(await runStored(net, b, n => n.exportState().lastTick)).toBe(now);
  }, T);

  test("participations: written on save, rewritten after a re-roll and after an under-13 decline", async () => {
    const store = new PgStore(TEST_URL);
    stores.push(store);
    const people = [climber("r", "Rae Kim", { wants: [] }), climber("c1", "Cal One"), climber("c2", "Cleo Two"), climber("c3", "Cass Three")];
    for (const p of people) await store.sql`insert into network.members (id, name, home_city) values (${p.id}, ${p.name}, 'nyc') on conflict (id) do nothing`;
    const w = new Mini(people, { review: "human" });
    await w.onboard("r", "c1", "c2", "c3");
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    const oppId = w.net.reviewQueue()[0]!.oppId;
    const want = () => {
      const p = w.net.reviewQueue()[0]!.proposal;
      return [...p.participants.map(id => `participant:${id}`), ...p.alternates.filter(a => !p.participants.includes(a)).map(id => `alternate:${id}`)].sort();
    };
    const have = async () => (await store.sql`select role, member_id from network.participations where opportunity_id = ${oppId}`).map((r: any) => `${r.role}:${r.member_id}`).sort();
    await store.save(w.net.exportState());
    expect((await have()).length).toBe(4);
    expect(await have()).toEqual(want());
    expect(w.net.decide(oppId, "reroll", { reviewer: "staff" })).toEqual({ ok: true });
    await store.save(w.net.exportState());
    expect(await have()).toEqual(want());
    const alt = w.net.reviewQueue()[0]!.proposal.alternates[0]!;
    // The record now says 12 (the platform's lowest stated age): an under-13 record declines.
    w.members.find(m => m.id === alt)!.age = 12;
    w.net.importState(w.net.exportState());
    await w.say(alt, "I am 12 years old");
    expect(w.net.isDeclined(alt)).toBe(true);
    await store.save(w.net.exportState());
    expect(await have()).toEqual(want());
    expect((await store.sql`select 1 from network.participations where member_id = ${alt}`).length).toBe(0);
  }, T);

  test("participations: only settled attendance evidence changes the stored status", async () => {
    // spec/meetingSettlement.md, "Classify each attendee from the available reports"
    const store = new PgStore(TEST_URL);
    stores.push(store);
    const people = [climber("attendance-a", "Ana Diaz"), climber("attendance-b", "Ben Ito"), climber("attendance-c", "Cy Moss")];
    const ids = people.map(person => person.id);
    for (const p of people) await store.sql`insert into network.members (id, name, home_city) values (${p.id}, ${p.name}, 'nyc')`;
    const w = new Mini(people, { plans: false, growth: false });
    await w.onboard(...ids);
    const oppId = w.propose(ids);
    await w.answerProbes(ids);
    const start = w.meetings.find(meeting => meeting.proposalId === oppId)!.at;
    expect(await w.runUntil(() => ids.every(id => w.to(id).some(message =>
      message.meta.type === "reminder" && message.meta.proposalId === oppId)), 7 * DAY)).toBe(true);
    for (const id of ids) await w.say(id, "Yes, I'll be there.");
    expect(await w.runUntil(() => ids.every(id => w.to(id).some(message =>
      message.meta.type === "feedback_request" && message.meta.proposalId === oppId)), 7 * DAY)).toBe(true);
    const statuses = async () => (await store.sql`select status from network.participations
      where opportunity_id = ${oppId} order by member_id`).map(row => row.status);
    await store.save(w.net.exportState());
    const waiting = await statuses();
    await runStored(w.net, store, () => w.say(ids[0]!, "It was great, but Ben did not come."));
    await runStored(w.net, store, () => w.say(ids[1]!, "I couldn't make it."));
    w.restart();
    w.clock.set(start + 4 * DAY);
    expect(await runTick(w.net, store, w.clock.now())).toBe(true);
    const settled = (await store.load())!.opps.find(opp => opp.id === oppId)!;
    expect(settled.finalized).toBe(true);
    expect(settled.post?.[ids[0]!]?.came).toBe(true);
    expect(settled.post?.[ids[1]!]?.came).toBe(false);
    expect(settled.post?.[ids[2]!]).toBeUndefined();
    expect([waiting, await statuses()]).toEqual([
      ["accepted", "accepted", "accepted"],
      ["attended", "no_show", "accepted"],
    ]);
  }, T);

  test("save runs on the advisory lock connection so a terminated lock cannot overwrite the next holder (SD-110)", async () => {
    const a = new PgStore(TEST_URL);
    const b = new PgStore(TEST_URL);
    stores.push(a, b);
    const w = new Mini([climber("lock-a", "Ana Diaz")], { review: "auto" });
    await w.onboard("lock-a");
    await a.save(w.net.exportState());
    let releaseA!: () => void;
    const paused = new Promise<void>(r => { releaseA = r; });
    let lockAcquired!: () => void;
    const locked = new Promise<void>(r => { lockAcquired = r; });
    const txA = a.withLock(async () => {
      const s = await a.load();
      lockAcquired();
      await paused;
      await a.save(s!);
    });
    await locked;
    const [{ pid }] = await (a as any).lockConn`select pg_backend_pid() as pid`;
    await b.sql`select pg_terminate_backend(${pid})`;
    await b.withLock(async () => {
      const s = (await b.load())!;
      w.net.importState(s);
      await w.net.onInbound({ id: "stop-lock-a", memberId: "lock-a", body: "STOP", keyword: "STOP", ts: w.clock.now(), channel: "sms" });
      await b.save(w.net.exportState());
    });
    releaseA();
    await expect(txA).rejects.toThrow();
    const final = (await b.load())!;
    expect(final.members.find(m => m.id === "lock-a")?.optedOut).toBe(true);
  }, T);
});
