import { describe, expect, test } from "bun:test";
import { DEFAULT_START, Oracle, generatePersonas, type Persona } from "../src/index.ts";

function pair(over: (a: Persona, b: Persona) => void) {
  const [a, b] = generatePersonas({ n: 2, seed: 42, adversarialRate: 0, cityWeights: { sf: 1, nyc: 0 } }).map(p => structuredClone(p));
  a!.archetype = b!.archetype = "regular";
  for (const p of [a!, b!]) { p.hidden.trips = []; p.secondaryCity = undefined; p.hidden.boundaries = []; p.relationships = []; p.hidden.capacity = 0.8; }
  over(a!, b!);
  return [a!, b!] as const;
}

describe("ground-truth oracle", () => {
  test("deterministic for (seed, proposal id)", () => {
    const ps = generatePersonas({ n: 30, seed: 1 });
    const o1 = new Oracle(ps, 1, DEFAULT_START), o2 = new Oracle(ps, 1, DEFAULT_START);
    const prop = { id: "p1", kind: "intro" as const, participants: [ps[0]!.id, ps[1]!.id], city: ps[0]!.homeCity };
    expect(o1.evaluate(prop)).toEqual(o2.evaluate(prop));
  });

  test("complementary band pair beats an unrelated pair", () => {
    const [g, d] = pair((a, b) => {
      a.hidden.interests = ["rock_music", "live_music"]; a.hidden.skills = ["guitar"];
      b.hidden.interests = ["rock_music", "hiking"]; b.hidden.skills = ["drums"];
      a.hidden.desires = b.hidden.desires = [{ id: "start_band", text: "start a rock band", category: "hobby", strength: 1 }];
    });
    const [x, y] = pair((a, b) => {
      a.hidden.interests = ["chess", "philosophy"]; a.hidden.skills = [];
      b.hidden.interests = ["dancing", "crypto"]; b.hidden.skills = [];
      a.hidden.desires = [{ id: "learn_sailing", text: "learn to sail", category: "growth", strength: 1 }];
      b.hidden.desires = [{ id: "ceramics_class", text: "try ceramics", category: "growth", strength: 1 }];
    });
    const o = new Oracle([g, d, x, y].map((p, i) => ({ ...p, id: `p${i}` })), 3, DEFAULT_START);
    const good = o.evaluate({ id: "a", kind: "intro", participants: ["p0", "p1"], city: "sf" });
    const bad = o.evaluate({ id: "b", kind: "intro", participants: ["p2", "p3"], city: "sf" });
    expect(good.quality).toBeGreaterThan(bad.quality + 0.2);
    expect(bad.compatible).toBe(false);
  });

  test("hard flags: exes, minors, adversaries, romance mismatch, travel", () => {
    const [a, b] = pair((a, b) => {
      a.relationships = [{ to: b.id, type: "ex", closeness: 0.5 }];
      b.relationships = [{ to: a.id, type: "ex", closeness: 0.5 }];
    });
    let v = new Oracle([a, b], 1, DEFAULT_START).evaluate({ id: "x", kind: "intro", participants: [a.id, b.id], city: "sf" });
    expect(v.flags).toContain("ex_partners"); expect(v.compatible).toBe(false);

    const [c, m] = pair((_, b) => { b.hidden.trueAge = 16; });
    v = new Oracle([c, m], 1, DEFAULT_START).evaluate({ id: "y", kind: "intro", participants: [c.id, m.id], city: "sf" });
    expect(v.flags).toContain("minor_included"); expect(v.compatible).toBe(false);

    const [e, h] = pair((_, b) => { b.hidden.adversarial = "harasser"; });
    v = new Oracle([e, h], 1, DEFAULT_START).evaluate({ id: "z", kind: "intro", participants: [e.id, h.id], city: "sf" });
    expect(v.flags).toContain("adversarial_participant");

    const [r1, r2] = pair((a, b) => { a.hidden.romance.optIn = true; b.hidden.romance.optIn = false; });
    v = new Oracle([r1, r2], 1, DEFAULT_START).evaluate({ id: "r", kind: "intro", participants: [r1.id, r2.id], city: "sf", category: "romance" });
    expect(v.flags).toContain("romance_mismatch");

    const [t1, t2] = pair(a => { a.hidden.trips = [{ city: "nyc", fromDay: 2, toDay: 5 }]; });
    const o = new Oracle([t1, t2], 1, DEFAULT_START);
    expect(o.presentIn(t1, "nyc", DEFAULT_START + 3 * 86_400_000)).toBe(true);
    expect(o.presentIn(t1, "sf", DEFAULT_START + 3 * 86_400_000)).toBe(false);
    v = o.evaluate({ id: "t", kind: "intro", participants: [t1.id, t2.id], city: "sf", window: { start: DEFAULT_START + 3 * 86_400_000, end: DEFAULT_START + 3 * 86_400_000 } });
    expect(v.flags).toContain("city_mismatch");
  });

  test("acceptance is not over-agreeable: random pairs accept well under half the time", () => {
    const ps = generatePersonas({ n: 120, seed: 4, adversarialRate: 0 });
    const o = new Oracle(ps, 4, DEFAULT_START);
    let acc = 0, n = 0;
    for (let i = 0; i + 1 < ps.length; i += 2) {
      const v = o.evaluate({ id: `q${i}`, kind: "intro", participants: [ps[i]!.id, ps[i + 1]!.id], city: ps[i]!.homeCity });
      for (const r of Object.values(v.participants)) { n++; if (r.wouldAccept) acc++; }
    }
    expect(acc / n).toBeGreaterThan(0.1);
    expect(acc / n).toBeLessThan(0.5);
  });

  test("latent pairs are compatible, same-city, non-adversarial strangers", () => {
    const ps = generatePersonas({ n: 60, seed: 6 });
    const o = new Oracle(ps, 6, DEFAULT_START);
    const lat = o.latentPairs(ps.map(p => p.id), DEFAULT_START);
    expect(lat.length).toBeGreaterThan(0);
    const byId = new Map(ps.map(p => [p.id, p]));
    for (const l of lat) {
      expect(byId.get(l.a)!.homeCity).toBe(byId.get(l.b)!.homeCity);
      expect(byId.get(l.a)!.hidden.adversarial).toBeUndefined();
    }
  });
});
