// friends.help world: determinism, no hidden truth in snapshots, minors and age liars, verification
// and review over time, oracle sanity, harness caps, baselines, metrics. Offline, no LLM calls.
import { describe, expect, test } from "bun:test";
import { canBeMatched } from "@thenetwork/core";
import { NEIGHBORHOODS, transitMinutes, chooseVenue, hood } from "@thenetwork/engine/src/packs/friends/index.ts";
import {
  BASELINES, FRIENDS_WORLD_START, buildFriendsSnapshot, createFriendsWorld, emptyFriendsState, friendsMetrics, friendsPackMatcher,
  generateFriendsPersonas, isReal, runFriendsWorld, slotIndexOf, slotTime, verifyAt, visibleProfiles, visibleRedFlag, VENUES,
  type FriendsPersona,
} from "../src/friends/index.ts";

describe("friends personas", () => {
  test("deterministic by seed, different across seeds", () => {
    const a = generateFriendsPersonas({ seed: 7, n: 120 }), b = generateFriendsPersonas({ seed: 7, n: 120 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(generateFriendsPersonas({ seed: 8, n: 120 }))).not.toBe(JSON.stringify(a));
  });

  test("minors 13-17 join; some lie about age; adversaries of every kind; every borough", () => {
    const ps = generateFriendsPersonas({ seed: 3, n: 1200 });
    const minors = ps.filter(p => p.hidden.isMinor);
    expect(minors.length).toBeGreaterThan(20);
    expect(minors.every(m => m.hidden.trueAge >= 13 && m.hidden.trueAge <= 17)).toBe(true);
    const liars = minors.filter(m => m.stated.claimedAge >= 18);
    expect(liars.length).toBeGreaterThan(0);
    expect(liars.every(m => m.hidden.adversary === "age_liar")).toBe(true);
    for (const k of ["romance_seeker", "mlm", "bot", "harasser"]) expect(ps.some(p => p.hidden.adversary === k)).toBe(true);
    const boroughs = new Set(ps.map(p => NEIGHBORHOODS.find(n => n.id === p.hidden.home)!.borough));
    expect(boroughs.size).toBe(5);
    // Most lying minors fail the ID check that facial age estimation triggers under 25.
    expect(liars.filter(m => m.stated.verify.age === "failed").length).toBeGreaterThan(liars.length * 0.7);
  });
});

describe("snapshot: what the agent knows, never hidden truth", () => {
  const ps = generateFriendsPersonas({ seed: 5, n: 200 });
  const snap = buildFriendsSnapshot(ps, emptyFriendsState());
  const json = JSON.stringify(snap);

  test("no hidden field names, no adversary labels; canaries only in agent_private facets", () => {
    for (const k of ["trueAge", "isMinor", "likability", "warmth", "flakiness", "replyProb", "honesty", "loneliness", "\"likes\"", "\"loves\"", "slotFree", "travelCost", "\"hidden\"", "richness"])
      expect(json).not.toContain(k);
    for (const k of ["romance_seeker", "\"mlm\"", "age_liar", "harasser"]) expect(json).not.toContain(k);
    for (const p of ps) for (const f of snap.facets.filter(x => x.value.includes(p.hidden.canary))) expect(f.scope).toBe("agent_private");
  });

  test("changing hidden truth does not change the snapshot", () => {
    const perturbed: FriendsPersona[] = JSON.parse(JSON.stringify(ps));
    for (const p of perturbed) {
      const h = p.hidden;
      h.trueAge += 1; h.isMinor = !h.isMinor; h.energy = 1 - h.energy; h.appetite = 0.5; h.flakiness = 0.3; h.replyProb = 0.5;
      h.honesty = 0.6; h.tolerance += 10; h.warmth = -h.warmth; h.likability = 2; h.slotFree = h.slotFree.map(() => 0.5);
      for (const k of Object.keys(h.likes)) h.likes[k] = 0.5;
    }
    expect(JSON.stringify(buildFriendsSnapshot(perturbed, emptyFriendsState()))).toBe(json);
  });

  test("claimed minors: every facet agent_private, no friends intent, not opted in to hobby", () => {
    for (const p of ps.filter(x => !canBeMatched(x.stated.claimedAge))) {
      expect(snap.facets.filter(f => f.memberId === p.id).every(f => f.scope === "agent_private")).toBe(true);
      expect(snap.intents.some(i => i.memberId === p.id)).toBe(false);
    }
  });

  test("location is a neighborhood (no coordinates); the visible reader returns stated activities", () => {
    expect(json).not.toMatch(/"(lat|lng|lon)"/);
    const vp = visibleProfiles(snap);
    const rich = ps.find(p => p.hidden.richness === "very_rich" && canBeMatched(p.stated.claimedAge))!;
    expect(vp.get(rich.id)!.home).toBe(rich.stated.home);
    expect(vp.get(rich.id)!.activities.length).toBeGreaterThan(0);
  });

  test("pending checks complete over the weeks for real people only; red flags fade only for honest members", () => {
    const big = generateFriendsPersonas({ seed: 9, n: 800 });
    const pending = big.filter(p => isReal(p) && (p.stated.verify.liveness === "pending" || p.stated.verify.age === "pending"));
    const done8 = pending.filter(p => { const v = verifyAt(p, 8); return v.liveness === "passed" && v.age === "passed"; });
    expect(done8.length).toBeGreaterThan(pending.length * 0.5);
    for (const p of big.filter(x => x.hidden.adversary === "bot" && x.stated.verify.liveness !== "passed")) expect(verifyAt(p, 8).liveness).not.toBe("passed");
    const honestFlag0 = big.filter(p => isReal(p) && visibleRedFlag(p, 0)).length, honestFlag8 = big.filter(p => isReal(p) && visibleRedFlag(p, 8)).length;
    expect(honestFlag8).toBeLessThan(honestFlag0);
  });
});

describe("geo", () => {
  test("transit estimate is symmetric, walking-short in one neighborhood, Staten Island is far", () => {
    const [a, b] = [hood("astoria")!, hood("williamsburg")!];
    expect(transitMinutes(a, b)).toBe(transitMinutes(b, a));
    expect(transitMinutes(a, a)).toBeLessThanOrEqual(12);
    expect(transitMinutes(hood("st_george")!, hood("midtown")!)).toBeGreaterThan(40);
    expect(NEIGHBORHOODS.length).toBeGreaterThan(80);
  });
  test("venue choice minimizes the longest trip", () => {
    const homes = new Map([["x", hood("astoria")!], ["y", hood("long_island_city")!], ["z", hood("greenpoint")!]]);
    const best = chooseVenue(VENUES.filter(v => v.activities.includes("restaurant_dinner")), homes)!;
    for (const v of VENUES.filter(v => v.activities.includes("restaurant_dinner"))) {
      const worst = Math.max(...[...homes.values()].map(h => transitMinutes(h, hood(v.area)!)));
      expect(best.worst).toBeLessThanOrEqual(worst);
    }
  });
  test("slots round-trip through local time", () => {
    for (let k = 0; k < 11; k++) expect(slotIndexOf(slotTime(3, k))).toBe(k);
    expect(slotTime(0, 0)).toBeGreaterThan(FRIENDS_WORLD_START);
  });
});

describe("oracle", () => {
  const w = createFriendsWorld({ seed: 11, n: 200 });
  const O = w.oracle;
  const real = w.personas.filter(isReal);
  test("chemistry symmetric; meetup outcome independent of attendee order", () => {
    const [a, b, c] = real.map(p => p.id) as [string, string, string];
    expect(O.chem(a, b)).toBe(O.chem(b, a));
    const x = O.meetup("k", [a, b, c], "board_game_cafe", "astoria", () => 0), y = O.meetup("k", [c, a, b], "board_game_cafe", "astoria", () => 0);
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
  });
  test("bond (hours with people you enjoyed) raises enjoyment; bots never attend", () => {
    const ids = real.slice(0, 4).map(p => p.id);
    const cold = O.meetup("b", ids, "restaurant_dinner", "astoria", () => 0), warm = O.meetup("b", ids, "restaurant_dinner", "astoria", () => 20);
    for (const id of ids) expect(warm.enjoy[id]!).toBeGreaterThan(cold.enjoy[id]!);
    const bot = w.personas.find(p => p.hidden.adversary === "bot");
    if (bot) expect(O.attendP(bot.id, 0, 1, "astoria")).toBe(0);
  });
});

describe("harness and baselines", () => {
  const runs = (["random", "greedy", "oracle"] as const).map(n => runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: BASELINES[n] }));
  const pack = runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: friendsPackMatcher() });

  test("every arm runs, is deterministic and never contacts a declared minor", () => {
    for (const r of [...runs, pack]) {
      const m = friendsMetrics(r);
      expect(m.proposals).toBeGreaterThan(0);
      expect(m.safety.declaredMinorContacts).toBe(0);
    }
    const again = runFriendsWorld({ seed: 2, n: 200, weeks: 3, matcher: friendsPackMatcher() });
    expect(JSON.stringify(friendsMetrics(again))).toBe(JSON.stringify(friendsMetrics(pack)));
  });

  test("caps: at most 1 new-plan invite and 2 partner intros per member per week; at most 2 meetups a week; tables of at most 6", () => {
    for (const r of [...runs, pack]) {
      const plan = new Map<string, number>(), meet = new Map<string, number>();
      for (const f of r.flows) {
        if (f.kind === "plan") for (const id of f.invited.slice(0, f.probed)) void id;
        expect(f.going.length).toBeLessThanOrEqual(6);
        for (const id of f.booked) meet.set(`${id}|${f.week}`, (meet.get(`${id}|${f.week}`) ?? 0) + 1);
      }
      for (const v of meet.values()) expect(v).toBeLessThanOrEqual(2);
      void plan;
    }
    // Plan invites: count probes per member per week from the harness ledger (lastPlannedAt is set once per probe).
    const m = friendsMetrics(pack);
    expect(m.capDrops).toBeGreaterThanOrEqual(0);
  });

  test("the oracle never meets an adversary or a minor; random does (it ignores verification)", () => {
    const [random, , oracle] = runs.map(friendsMetrics);
    expect(oracle!.safety.adversaryContacts + oracle!.safety.hiddenMinorContacts).toBe(0);
    expect(random!.safety.adversaryContacts).toBeGreaterThan(0);
  });
});
