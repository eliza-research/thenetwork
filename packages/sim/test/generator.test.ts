import { describe, expect, test } from "bun:test";
import { ADVERSARIAL_KINDS, canariesOf, generatePersonas } from "../src/index.ts";

describe("persona generator (deterministic)", () => {
  test("same seed => identical personas; different seed => different", () => {
    const a = generatePersonas({ n: 80, seed: 7 });
    const b = generatePersonas({ n: 80, seed: 7 });
    const c = generatePersonas({ n: 80, seed: 8 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  test("covers archetypes, both cities and every adversarial kind", () => {
    const ps = generatePersonas({ n: 200, seed: 3 });
    const arch = new Set(ps.map(p => p.archetype));
    for (const a of ["regular", "busy_parent", "newcomer", "connector", "introvert", "very_active", "never_replies", "traveler"])
      expect(arch.has(a as any)).toBe(true);
    expect(new Set(ps.map(p => p.homeCity))).toEqual(new Set(["sf", "nyc"]));
    const adv = new Set(ps.map(p => p.hidden.adversarial).filter(Boolean));
    for (const k of ADVERSARIAL_KINDS) expect(adv.has(k)).toBe(true);
    expect(ps.some(p => p.hidden.trips.length > 0)).toBe(true);
  });

  test("hidden vs public: minors lie about age, canaries stay private, ids unique", () => {
    const ps = generatePersonas({ n: 300, seed: 5 });
    expect(new Set(ps.map(p => p.id)).size).toBe(ps.length);
    for (const p of ps.filter(p => p.hidden.adversarial === "minor")) {
      expect(p.hidden.trueAge).toBeLessThan(18);
      expect(p.public.claimedAge).toBeGreaterThanOrEqual(18);
      expect(p.hidden.romance.optIn).toBe(false);
    }
    const canaries = canariesOf(ps);
    expect(canaries.length).toBeGreaterThan(30);
    expect(new Set(canaries.map(c => c.canary)).size).toBe(canaries.length);
    for (const p of ps) {
      const pub = JSON.stringify(p.public);
      for (const c of canaries) expect(pub.includes(c.canary)).toBe(false);
    }
  });

  test("relationships are symmetric and invites come from earlier joiners", () => {
    const ps = generatePersonas({ n: 120, seed: 9 });
    const byId = new Map(ps.map(p => [p.id, p]));
    for (const p of ps) {
      for (const r of p.relationships) expect(byId.get(r.to)!.relationships.some(x => x.to === p.id && x.type === r.type)).toBe(true);
      if (p.invitedBy) expect(byId.get(p.invitedBy)!.joinDay).toBeLessThanOrEqual(p.joinDay);
    }
  });

  test("dishonest personas misreport: stated interests differ from true ones", () => {
    const ps = generatePersonas({ n: 300, seed: 11 });
    const liars = ps.filter(p => p.hidden.honesty < 0.8);
    expect(liars.length).toBeGreaterThan(10);
    expect(liars.filter(p => p.public.statedInterests.some(t => !p.hidden.interests.includes(t))).length).toBe(liars.length);
  });
});
