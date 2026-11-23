import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HOUR } from "@thenetwork/core";
import { PgStore, runStored, runTick } from "../src/index.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { Mini, type Spec } from "./mini.ts";
import { heldJudge, within } from "./tick-held-judge.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

const TURN_LIMIT_MS = 8_000;
const partner = (id: string, name: string, hobby: string, skill: string): Spec => ({ id, name, age: 30, area: "Greenpoint",
  interests: [hobby], skills: [skill], wants: [{ objective: `find a regular ${hobby} partner`, category: "hobby" as const }] });
const PEOPLE: Spec[] = [
  partner("a", "Ana Diaz", "climbing", "belaying"), partner("c", "Cy Moss", "climbing", "belaying"),
  partner("b", "Ben Ito", "chess", "openings"), partner("d", "Dee Park", "chess", "openings"),
  partner("e", "Eve Lund", "pottery", "glazing"), partner("f", "Fay Roe", "pottery", "glazing"),
];


describe.skipIf(!pgAvailable)("the tick's engine run holds no lock", () => {
  let url: string;
  const stores: PgStore[] = [];
  beforeAll(async () => { url = await testDb(); }, 600_000);
  afterAll(async () => { for (const s of stores) await s.close(); await dropTestDb(); });

  test("a STOP during a long engine run answers inside the turn limit, and the run's commit contacts neither the stopped nor a changed member", async () => {
    const judge = heldJudge();
    const ids = PEOPLE.map(p => p.id);
    const w = new Mini(PEOPLE, { inlineJudge: simulatedReviewJudge({ exceptions: false }), maxNewPerDay: 20, plans: false, growth: false, selective: false, engineLLM: judge.llm });
    await w.onboard(...ids);
    const store = new PgStore(url, "ntwrk:nyc");
    stores.push(store);
    await store.migrate();
    await store.save(w.net.exportState());

    w.clock.advance(HOUR);
    const now = w.clock.now();
    const tick = runTick(w.net, store, now);
    expect((await within(judge.first, 60_000)).done).toBe(true);

    expect(await runTick(w.net, store, now)).toBe(false);

    const stopMark = w.mark();
    let started = performance.now();
    const question = await within(runStored(w.net, store, n => n.onInbound({ id: "ask-b", memberId: "b", body: "what can you do for me?", ts: now, channel: "sms" })), TURN_LIMIT_MS);
    expect(question.done && question.v).toBe("open");
    expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
    started = performance.now();
    const stop = await within(runStored(w.net, store, n => n.onInbound({ id: "stop-a", memberId: "a", body: "STOP", keyword: "STOP", ts: now, channel: "sms" })), TURN_LIMIT_MS);
    expect(stop.done && stop.v).toBe("handled");
    expect(performance.now() - started).toBeLessThan(TURN_LIMIT_MS);
    expect((await store.load())!.members.find(m => m.id === "a")!.optedOut).toBe(true);

    w.facets.push({ id: "b:interest:go", memberId: "b", kind: "interest", value: "go", tags: ["go"], scope: "matchable", provenance: "said",
      confidence: 0.9, validFrom: now, source: "chat", observedAt: now, inferred: false, confirmedByMember: true });

    const before = new Set((await store.load())!.opps.map(o => o.id));
    judge.release();
    expect(await tick).toBe(true);

    const saved = (await store.load())!;
    expect(saved.lastTick).toBe(now);
    const fromRun = saved.opps.filter(o => o.origin === "engine" && !before.has(o.id));
    expect(fromRun.map(o => o.participants)).toContainEqual(expect.arrayContaining(["e", "f"]));
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

  test("runTick runs the capture unit and the commit unit each in its own scope, and both scopes start before the tick is saved", async () => {
    const ids = PEOPLE.map(p => p.id);
    const w = new Mini(PEOPLE, { inlineJudge: simulatedReviewJudge({ exceptions: false }), maxNewPerDay: 20, plans: false, growth: false, selective: false });
    await w.onboard(...ids);
    const store = new PgStore(url, "ntwrk:nyc");
    stores.push(store);
    await store.migrate();
    await store.save(w.net.exportState());

    w.clock.advance(HOUR);
    const now = w.clock.now();
    const entries: (number | undefined)[] = [];
    const ran = await runTick(w.net, store, now, async unit => {
      entries.push((await store.load())!.lastTick);
      return unit();
    });

    expect(ran).toBe(true);
    expect(entries).toHaveLength(2);
    expect(entries[0]).not.toBe(now);
    expect(entries[1]).not.toBe(now);
    expect((await store.load())!.lastTick).toBe(now);
  }, 180_000);
});
