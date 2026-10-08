// slopPack iteration 2: the revealed-preference model (learn.ts), the re-ask cap, the widen ask, and
// the human-review status of safety holds.
import { describe, expect, test } from "bun:test";
import type { Facet, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { runEngine } from "../src/engine.ts";
import { makeSlopPack, SLOP_ENGINE_CONFIG, slopProfiles } from "../src/packs/slop/index.ts";
import { attractionModel, observations } from "../src/packs/slop/learn.ts";
import { slopOptions } from "../src/packs/slop/options.ts";
import { limitMiles } from "../src/packs/slop/geo.ts";
import type { EngineInput, InteractionRecord } from "../src/types.ts";
import { slopWorld } from "./slopkit.ts";

const cfg = (seed: number) => ({ ...SLOP_ENGINE_CONFIG, seed });
const fact = (id: MemberId, tag: string): Facet => ({ id: `${id}:t:${tag}`, memberId: id, kind: "fact", value: "x", tags: [tag], scope: "agent_private", provenance: "inferred", confidence: 0.6 });

describe("revealed-preference model", () => {
  const input = slopWorld(1, { perCity: 250, extras: false });
  const P = slopProfiles(input);
  const adults = [...P.values()].filter(p => p.adult && p.self).map(p => p.id);
  const o = slopOptions({ attraction: { enabled: true } });

  test("probe answers, back-outs and ratings become observations of one member about another", () => {
    const [a, b, c] = adults as [string, string, string];
    const ix: InteractionRecord[] = [
      { id: "i1", kind: "intro", category: "romance", participants: [a, b], at: input.now - DAY, outcome: "declined", acceptedBy: [a], declinedBy: [b] },
      { id: "i2", kind: "intro", category: "romance", participants: [a, c], at: input.now - DAY, outcome: "cancelled", acceptedBy: [a, c], declinedBy: [c] },
    ];
    const obs = observations({ ...input, interactions: ix, feedback: [{ id: "f", from: a, about: b, at: input.now - DAY, sentiment: "positive", wouldMeetAgain: true }] }, x => x, o);
    expect(obs).toContainEqual({ a, b, y: 1, w: 1 });
    expect(obs).toContainEqual({ a: b, b: a, y: 0, w: 1 });
    expect(obs).toContainEqual({ a: c, b: a, y: 0, w: 2 }); // backed out at the reveal
    expect(obs).toContainEqual({ a, b: c, y: 1, w: 1 });
    expect(obs).toContainEqual({ a, b, y: 1, w: 1.5 });
  });

  test("it learns a partner effect and a member's revealed taste; no history = no information", () => {
    expect(attractionModel(input, P, x => x, o).score(adults[0]!, adults[1]!)).toBe(0);
    // Everyone says yes to `star`; `picky` says yes only to people whose first self dimension is high.
    const star = adults[0]!, picky = adults[1]!;
    const ix: InteractionRecord[] = [];
    adults.slice(2, 30).forEach((x, i) => ix.push({ id: `s${i}`, kind: "intro", category: "romance", participants: [x, star], at: input.now - DAY, outcome: "declined", acceptedBy: [x], declinedBy: [star] }));
    adults.slice(30, 60).forEach((x, i) => {
      const yes = P.get(x)!.self![0]! > 0;
      ix.push({ id: `p${i}`, kind: "intro", category: "romance", participants: [picky, x], at: input.now - DAY, outcome: yes ? "expired" : "declined", acceptedBy: yes ? [picky] : [], declinedBy: yes ? [] : [picky] });
    });
    const learned = { ...input, interactions: ix };
    const m = attractionModel(learned, slopProfiles(learned), x => x, o);
    expect(m.score(adults[61]!, star)).toBeGreaterThan(0.5);
    const hi = adults.slice(60).filter(x => P.get(x)!.self![0]! > 1), lo = adults.slice(60).filter(x => P.get(x)!.self![0]! < -1);
    expect(hi.length).toBeGreaterThan(3); expect(lo.length).toBeGreaterThan(3);
    const mean = (xs: string[]) => xs.reduce((s, x) => s + m.score(picky, x), 0) / xs.length;
    expect(mean(hi)).toBeGreaterThan(mean(lo));
  });
});

describe("asks and review (iteration 2)", () => {
  test("re-ask cap: a question already asked twice is not asked again", async () => {
    const input = slopWorld(2, { perCity: 60, extras: false });
    const pack = makeSlopPack({ maxAsksPerField: 2 });
    const r0 = await runEngine(input, cfg(2), { pack });
    const asked = r0.asks.find(a => a.reason === "slop_age_range")!;
    expect(asked).toBeDefined();
    const recentAsks = [1, 2].map(k => ({ memberId: asked.memberId, reason: "slop_age_range", at: input.now - k * 8 * DAY }));
    const r = await runEngine({ ...input, recentAsks }, cfg(2), { pack });
    expect(r.asks.some(a => a.memberId === asked.memberId && a.reason === "slop_age_range")).toBe(false);
    expect(r.proposals.some(p => p.participants.includes(asked.memberId))).toBe(false); // still never a guess
  });

  test("widen ask: members with very few eligible partners and a short radius are asked once", async () => {
    const input = slopWorld(3, { perCity: 60, extras: false });
    const pack = makeSlopPack({ widen: { enabled: true, maxDegree: 2, miles: 25 } });
    const r = await runEngine(input, cfg(3), { pack });
    const widen = r.asks.filter(a => a.reason === "slop_widen");
    expect(widen.length).toBeGreaterThan(0);
    const P = slopProfiles(input);
    for (const a of widen) expect(limitMiles(P.get(a.memberId)!, pack.options)!).toBeLessThan(25);
    const again = await runEngine({ ...input, recentAsks: widen.map(a => ({ memberId: a.memberId, reason: "slop_widen", at: input.now - DAY })) }, cfg(3), { pack });
    expect(again.asks.some(a => a.reason === "slop_widen" && widen.some(x => x.memberId === a.memberId))).toBe(false);
  });

  test("review: a cleared cue lifts the hold, a confirmed review keeps it", async () => {
    const input = slopWorld(1, { perCity: 60, extras: false });
    const pack = makeSlopPack();
    const r0 = await runEngine(input, cfg(1), { pack });
    const [x, y] = [r0.proposals[0]!.participants[0]!, r0.proposals[1]!.participants[0]!];
    const flagged: EngineInput = { ...input, facets: [...input.facets, fact(x, "safety:scam_pattern"), fact(y, "safety:hostile_language")] };
    const held = await runEngine(flagged, cfg(1), { pack });
    expect(held.proposals.some(p => p.participants.includes(x) || p.participants.includes(y))).toBe(false);
    const reviewed = await runEngine({ ...flagged, facets: [...flagged.facets, fact(x, "review:cleared"), fact(y, "review:confirmed")] }, cfg(1), { pack });
    const inAny = new Set(reviewed.proposals.flatMap(p => p.participants));
    expect(inAny.has(y)).toBe(false);
    expect(inAny.has(x)).toBe(true);
  });
});
