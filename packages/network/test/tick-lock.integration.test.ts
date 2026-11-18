// spec/runtimeUnit.md, "The engine runs on a snapshot outside the store lock"
// spec/runtimeUnit.md, "A prepared engine result commits only for members whose evidence did not change"
// A long engine run (the model judge) must not hold the Network lock: a signed turn answers inside the
// gateway's 8 s limit while the tick computes, and the tick's commit re-checks every member. The store
// is Postgres (the advisory lock the production service uses).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import type { LLM } from "@thenetwork/core";
import { PgStore, runStored, runTick } from "../src/index.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { Mini, type Spec } from "./mini.ts";

const TURN_LIMIT_MS = 8_000;
const CLIMB_WANT = { objective: "find a regular climbing partner", category: "hobby" as const };
const climber = (id: string, name: string): Spec => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [CLIMB_WANT] });

/** The engine's judge model, held until the test releases it. A held call then fails, so the engine keeps its earlier stages (fail open). */
function heldJudge() {
  let release!: () => void, called!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const first = new Promise<void>(r => (called = r));
  const llm: LLM = { chat: async () => { called(); await gate; throw new Error("judge held by the test"); } };
  return { llm, release, first };
}

const within = <T>(p: Promise<T>, ms: number) => Promise.race([p.then(v => ({ done: true as const, v })),
  new Promise<{ done: false }>(r => setTimeout(() => r({ done: false }), ms))]);

describe.skipIf(!pgAvailable)("the tick's engine run holds no lock", () => {
  let url: string;
  const stores: PgStore[] = [];
  beforeAll(async () => { url = await testDb(); }, 120_000);
  afterAll(async () => { for (const s of stores) await s.close(); await dropTestDb(); });

  test("a STOP during a long engine run answers inside the turn limit, and the run's commit contacts neither the stopped nor a changed member", async () => {
    const judge = heldJudge();
    const ids = ["a", "b", "c", "d", "e", "f"];
    const w = new Mini(ids.map((id, i) => climber(id, ["Ana Diaz", "Ben Ito", "Cy Moss", "Dee Park", "Eve Lund", "Fay Roe"][i]!)),
      { review: "auto", maxNewPerDay: 20, plans: false, growth: false, engineLLM: judge.llm });
    await w.onboard(...ids);
    const store = new PgStore(url, "ntwrk:nyc");
    stores.push(store);
    await store.migrate();
    await store.save(w.net.exportState());

    // 14:00 New York: the first daily engine run is due, and its judge call waits.
    w.clock.advance(HOUR);
    const now = w.clock.now();
    const tick = runTick(w.net, store, now);
    expect((await within(judge.first, 60_000)).done).toBe(true);

    // A second tick while the run computes does not start another run.
    expect(await runTick(w.net, store, now)).toBe(false);

    // Two signed turns while the judge is still held: a question from b gets its answer, and a STOP from a is stored.
    const stopMark = w.mark();
    let started = performance.now();
    const question = await within(runStored(w.net, store, n => n.onInbound({ id: "ask-b", memberId: "b", body: "what can you do for me?", ts: now, channel: "sms" })), TURN_LIMIT_MS);
    expect(question.done).toBe(true);
    expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
    expect(w.to("b", stopMark).filter(s => s.reply).length).toBeGreaterThan(0);
    started = performance.now();
    const stop = await within(runStored(w.net, store, n => n.onInbound({ id: "stop-a", memberId: "a", body: "STOP", keyword: "STOP", ts: now, channel: "sms" })), TURN_LIMIT_MS);
    expect(stop.done).toBe(true);
    expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
    expect((await store.load())!.members.find(m => m.id === "a")!.optedOut).toBe(true);

    // b's profile changes during the run (a new stated interest): the run read the old one.
    w.facets.push({ id: "b:interest:chess", memberId: "b", kind: "interest", value: "chess", tags: ["chess"], scope: "matchable", provenance: "said",
      confidence: 0.9, validFrom: now, source: "chat", observedAt: now, inferred: false, confirmedByMember: true });

    const before = new Set((await store.load())!.opps.map(o => o.id));
    judge.release();
    expect(await tick).toBe(true);

    const saved = (await store.load())!;
    expect(saved.lastTick).toBe(now);
    const fromRun = saved.opps.filter(o => o.origin === "engine" && !before.has(o.id));
    // The run committed work for the members who did not change.
    expect(fromRun.length).toBeGreaterThan(0);
    for (const o of fromRun) {
      expect(o.participants).not.toContain("a");
      expect(o.alternates).not.toContain("a");
      expect(o.participants).not.toContain("b");
      expect(o.alternates).not.toContain("b");
    }
    expect(w.to("a", stopMark).filter(s => s.meta.type === "probe" || s.meta.proactive)).toEqual([]);
    expect(w.to("b", stopMark).filter(s => s.meta.type === "probe")).toEqual([]);
  }, 180_000);
});
