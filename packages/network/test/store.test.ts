// State persistence (docs/network.md 11, admin-console gap 1): exportState / importState, the
// stores (MemoryStore, PgStore) and runTick. The proof: a Network that restarts from its stored
// state does exactly what an uninterrupted one does.
import { afterAll, describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/core";
import { computeMetrics, PolicyPersonaAgent, World, type InboundMessage, type NetworkContext, type NetworkUnderTest } from "@thenetwork/sim";
import { SQL } from "bun";
import { existsSync } from "node:fs";
import { DATA_DIR } from "../../../scripts/synthetic/common.ts";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { friendFactory, nycPersonas } from "../harness/index.ts";
import { ConsentNetwork, consoleRows, MemoryStore, NETWORK_STATE_VERSION, PgStore, runStored, runTick, type NetworkOptions, type NetworkState } from "../src/index.ts";
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
    async () => { for (const id of everyone) await w.say(id, "yes, sounds good"); },
    async () => { for (const id of everyone) await w.say(id, "yes"); },
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
    const waiting = atRestart!.opps.filter(o => o.stage === "probing" && o.participants.some(p => o.turnAt?.[p] !== undefined && !o.contacted.includes(p)));
    expect(waiting.length + atRestart!.deferred.length).toBeGreaterThan(0);
    expect(atRestart!.trust.some(r => r.level !== "ok")).toBe(true);
    expect(atRestart!.opps.some(o => o.stage !== "closed" && o.stage !== "done")).toBe(true);
    expect(plain.net.counters.scheduled).toBeGreaterThan(0);
    expect(plain.net.counters.probesSent).toBeGreaterThan(3);
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
    const again = new ConsentNetwork({ seed: 1, review: "auto" });
    again.init(w.ctx());
    again.importState(JSON.parse(JSON.stringify(s)));
    expect(again.exportState()).toEqual(s);
    expect(() => again.importState({ ...s, version: 99 })).toThrow();
    // The review mode is never stored: a human-review Network stays human after importing a simulator state.
    const human = new ConsentNetwork({ seed: 1 });
    human.importState(s);
    expect(human.reviewMode()).toBe("human");
  }, T);
});

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
  const seed = 3, opts: NetworkOptions = { seed, review: "auto" };
  const personas = await nycPersonas();
  const start = (await Bun.file(`${DATA_DIR}/manifest.json`).json()).snapshotNow as number;
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
    const fresh = new ConsentNetwork({ seed: 1, review: "auto", store });
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
    const two = () => { const n = new ConsentNetwork({ seed: 1, review: "auto", store }); n.init(w.ctx()); return n; };
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
  }, T);
});

// ------------------------------------------------------------------ Postgres (local dev cluster)
// A database of its own per test process (the packages/observatory/test/pg.ts pattern). Skipped when Postgres is absent.
const pgAvailable = ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");
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
    await setup.unsafe(await Bun.file(new URL("../../observatory/db/schema.sql", import.meta.url).pathname).text());
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
    const net = new ConsentNetwork({ seed: 1, review: "auto", store: b });
    net.init(w.ctx());
    const now = w.clock.now() + HOUR;
    w.clock.set(now);
    expect(await runTick(net, undefined, now)).toBe(true);
    expect((await a.load())!.lastTick).toBe(now);
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
});
