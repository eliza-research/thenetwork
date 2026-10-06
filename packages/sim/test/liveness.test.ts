// Intent liveness (persona.ts / snapshot.ts / oracle.ts), dating desire implies opt-in
// (generator.ts), and the oracle's window-based presence check.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { DEFAULT_START, Oracle, generatePersonas, type Persona } from "../src/index.ts";
import { INTENT_RECONFIRM_DAYS, intentRecordTiming, withLiveDesires } from "../src/persona.ts";
import { buildSnapshot } from "../src/snapshot.ts";

function persona(over: (p: Persona) => void = () => {}): Persona {
  const p = structuredClone(generatePersonas({ n: 1, seed: 7, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 1, nyc: 0 } })[0]!);
  p.hidden.desires = [{ id: "climbing_partner", text: "find a regular climbing partner", category: "hobby", strength: 1 }];
  p.public.statedIntents = [{ desireId: "climbing_partner", text: "find a regular climbing partner", category: "hobby" }];
  over(p);
  return p;
}

function pair(over: (a: Persona, b: Persona) => void) {
  const [a, b] = generatePersonas({ n: 2, seed: 42, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 1, nyc: 0 } }).map(p => structuredClone(p));
  for (const p of [a!, b!]) { p.archetype = "regular"; p.hidden.trips = []; p.secondaryCity = undefined; p.hidden.boundaries = []; p.relationships = []; p.hidden.capacity = 0.8; }
  over(a!, b!);
  return [a!, b!] as const;
}

const T0 = DEFAULT_START;

describe("intent record timing (re-confirmation)", () => {
  test("a responsive member re-confirms a held want: the record stays live long after the first horizon", () => {
    const p = persona(x => { x.hidden.responsiveness.ignoreProb = 0; });
    const rec = intentRecordTiming(p, 0, T0 + 200 * DAY, T0)!;
    expect(rec.status).toBe("active");
    expect(rec.reconfirmations).toBe(6);
    expect(rec.createdAt).toBe(T0 + 6 * INTENT_RECONFIRM_DAYS * DAY);
    expect(rec.createdAt + 60 * DAY).toBeGreaterThan(T0 + 200 * DAY);
  });

  test("a member who never answers keeps the first statement, so the record ages out", () => {
    const p = persona(x => { x.hidden.responsiveness.ignoreProb = 1; });
    const rec = intentRecordTiming(p, 0, T0 + 200 * DAY, T0)!;
    expect(rec).toEqual({ createdAt: T0, status: "active", reconfirmations: 0 });
  });

  test("a lapsed want is withdrawn (closed) at the next answered check-in", () => {
    const p = persona(x => { x.hidden.responsiveness.ignoreProb = 0; x.hidden.desires[0]!.lapsesAt = T0 + 45 * DAY; });
    expect(intentRecordTiming(p, 0, T0 + 50 * DAY, T0)!.status).toBe("active"); // stale until the day-60 check-in
    const rec = intentRecordTiming(p, 0, T0 + 61 * DAY, T0)!;
    expect(rec.status).toBe("closed");
    expect(rec.createdAt).toBe(T0 + 30 * DAY);
  });

  test("not yet stated -> no record; statedAt overrides the join time; unresponsive members don't re-confirm", () => {
    const p = persona(x => { x.hidden.responsiveness.ignoreProb = 0; x.public.statedIntents[0]!.statedAt = T0 + 10 * DAY; });
    expect(intentRecordTiming(p, 0, T0 + 5 * DAY, T0)).toBeUndefined();
    expect(intentRecordTiming(p, 0, T0 + 45 * DAY, T0)!.createdAt).toBe(T0 + 40 * DAY);
    expect(intentRecordTiming(p, 0, T0 + 45 * DAY, T0, { unresponsive: true })!.createdAt).toBe(T0 + 10 * DAY);
  });

  test("deterministic: the same record whenever it is rebuilt", () => {
    const p = persona(x => { x.hidden.responsiveness.ignoreProb = 0.5; });
    expect(intentRecordTiming(p, 0, T0 + 300 * DAY, T0)).toEqual(intentRecordTiming(structuredClone(p), 0, T0 + 300 * DAY, T0));
  });

  test("sim snapshot at day 90: intents anchored to now (before: every record had expired)", () => {
    const ps = generatePersonas({ n: 60, seed: 3 });
    const joined = new Map(ps.map(p => [p.id, T0 + p.joinDay * DAY]));
    const snap = buildSnapshot(ps, { now: T0 + 90 * DAY, worldStart: T0, joined, optedOut: new Set(), blocks: [], unanswered: new Map(), recentProposals: [] });
    const live = snap.intents.filter(i => i.status === "active" && i.createdAt + i.horizonDays * DAY > snap.now);
    expect(live.length / snap.intents.length).toBeGreaterThan(0.85);
    expect(snap.intents.every(i => i.createdAt <= snap.now)).toBe(true);
  });
});

describe("oracle liveness", () => {
  test("a lapsed want stops counting; a held want counts whether or not the Network knows it", () => {
    const mk = (lapse?: number) => pair((a, b) => {
      a.hidden.interests = ["climbing"]; b.hidden.interests = ["climbing"]; b.hidden.skills = ["climbing_belay"];
      a.hidden.desires = [{ id: "climbing_partner", text: "find a regular climbing partner", category: "hobby", strength: 1, ...(lapse ? { lapsesAt: lapse } : {}) }];
      b.hidden.desires = [];
    });
    const at = T0 + 10 * DAY;
    const prop = (a: Persona, b: Persona) => ({ id: "x", kind: "intro" as const, participants: [a.id, b.id], city: "sf" as const, window: { start: at, end: at } });
    const [a1, b1] = mk(), [a2, b2] = mk(T0 + 5 * DAY), [a3, b3] = mk(T0 + 20 * DAY);
    const held = new Oracle([a1, b1], 1, T0).evaluate(prop(a1, b1));
    const lapsed = new Oracle([a2, b2], 1, T0).evaluate(prop(a2, b2));
    const later = new Oracle([a3, b3], 1, T0).evaluate(prop(a3, b3));
    expect(held.participants[a1.id]!.enjoyment).toBeGreaterThan(lapsed.participants[a2.id]!.enjoyment + 0.3);
    expect(later.participants[a3.id]!.enjoyment).toBe(held.participants[a1.id]!.enjoyment);
  });

  test("withLiveDesires returns the same object when nothing lapsed", () => {
    const p = persona();
    expect(withLiveDesires(p, T0)).toBe(p);
    p.hidden.desires[0]!.lapsesAt = T0;
    expect(withLiveDesires(p, T0).hidden.desires).toHaveLength(0);
    expect(p.hidden.desires).toHaveLength(1);
  });
});

describe("oracle presence over the window", () => {
  test("away at the window start but home later in the 7-day window: no city_mismatch", () => {
    const [a, b] = pair(a => { a.hidden.trips = [{ city: "nyc", fromDay: -1, toDay: 2 }]; });
    const o = new Oracle([a, b], 1, T0);
    const v = o.evaluate({ id: "w", kind: "intro", participants: [a.id, b.id], city: "sf", window: { start: T0, end: T0 + 7 * DAY } });
    expect(v.flags).not.toContain("city_mismatch");
    // A point-in-time window during the trip is still a mismatch, and so is a window wholly inside it.
    expect(o.evaluate({ id: "p", kind: "intro", participants: [a.id, b.id], city: "sf", window: { start: T0, end: T0 } }).flags).toContain("city_mismatch");
    expect(o.evaluate({ id: "q", kind: "intro", participants: [a.id, b.id], city: "sf", window: { start: T0, end: T0 + 2 * DAY } }).flags).toContain("city_mismatch");
  });
});

describe("generator: dating desire implies romance opt-in", () => {
  test("every adult with a dating desire is a hidden romance opt-in", () => {
    let n = 0;
    for (const seed of [1, 2, 3]) for (const p of generatePersonas({ n: 150, seed })) {
      if (p.hidden.trueAge < 18 || !p.hidden.desires.some(d => d.id === "dating")) continue;
      n++;
      expect(p.hidden.romance.optIn).toBe(true);
    }
    expect(n).toBeGreaterThan(50);
  });
});
