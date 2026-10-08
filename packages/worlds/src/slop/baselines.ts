// Baseline matchers for slop.date, so the slop AppPack can be compared against them:
//   random-within-filters  a uniform random partner among visible mutual-filter candidates, as a
//                          one-per-member weekly matching (the floor);
//   greedy-desirability    everyone is proposed the most desirable eligible person (hidden
//                          desirability stands in for the popularity signal a swipe app would see):
//                          the congestion failure mode (Bruch & Newman 2018; RECON 2010);
//   oracle-optimal         perfect knowledge of hidden truth except chemistry (unknowable before a
//                          date, Joel et al. 2017): a greedy maximum-weight weekly matching on
//                          P(date happens) x P(second date | date), with truly free time options.
//                          An UPPER BOUND, not something network code may do.
// Random and greedy read only the snapshot (via visible.ts) for filters and planning.
import type { MemberId } from "@thenetwork/core";
import type { Rng } from "@thenetwork/sim/src/rng.ts";
import type { SlopCity } from "./geo.ts";
import { isSafe } from "./oracle.ts";
import { SLOTS, type DateActivity } from "./persona.ts";
import { slotIndex, visibleDealbreakerHit, visibleMutualCities, type VisibleProfile } from "./visible.ts";
import type { MatcherContext, SlopMatcher, SlopProposal, SlopWorld } from "./world.ts";

/** Pairs the Network must not propose again: already met, blocked, or either on a safety hold. */
export function visibleExclusions(ctx: MatcherContext): { pairBlocked: (a: MemberId, b: MemberId) => boolean; held: Set<MemberId> } {
  const held = new Set(ctx.snapshot.safetyHolds.map(h => h.memberId));
  const pairs = new Set<string>();
  const k = (a: MemberId, b: MemberId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const e of ctx.snapshot.edges) if (e.type === "met" || e.type === "blocked") pairs.add(k(e.from, e.to));
  for (const i of ctx.snapshot.interactions) if (i.participants.length === 2) pairs.add(k(i.participants[0]!, i.participants[1]!));
  return { pairBlocked: (a, b) => pairs.has(k(a, b)), held };
}

/** Visible candidates for `a`: mutual filters, no visible dealbreaker either way, not excluded. */
export function visibleCandidates(ctx: MatcherContext, a: VisibleProfile, pool: VisibleProfile[], ex = visibleExclusions(ctx)): { b: VisibleProfile; cities: SlopCity[] }[] {
  if (ex.held.has(a.id)) return [];
  const out: { b: VisibleProfile; cities: SlopCity[] }[] = [];
  for (const b of pool) {
    if (ex.held.has(b.id) || ex.pairBlocked(a.id, b.id)) continue;
    const cities = visibleMutualCities(a, b);
    if (!cities.length || visibleDealbreakerHit(a, b) || visibleDealbreakerHit(b, a)) continue;
    out.push({ b, cities });
  }
  return out;
}

/** Plan the date from visible data: a shared activity (else drinks), 3 slots favouring both members' stated free slots. */
export function planDate(a: VisibleProfile, b: VisibleProfile, rng: Rng): { activity: DateActivity; options: number[]; sharedFact?: string } {
  const sharedAct = a.activities.filter(x => b.activities.includes(x));
  const activity: DateActivity = sharedAct.length ? rng.pick(sharedAct) : a.activities[0] ?? b.activities[0] ?? "drinks";
  const bothFree = a.usuallyFree.filter(s => b.usuallyFree.includes(s)).map(slotIndex);
  const eitherFree = Array.from(new Set([...a.usuallyFree, ...b.usuallyFree].map(slotIndex))).filter(s => !bothFree.includes(s));
  const rest = SLOTS.map((_, i) => i).filter(i => !bothFree.includes(i) && !eitherFree.includes(i));
  const options = [...rng.shuffle(bothFree), ...rng.shuffle(eitherFree), ...rng.shuffle(rest)].slice(0, 3);
  const fact = b.shareableInterests.find(t => a.interests.includes(t)) ?? b.shareableInterests[0];
  return { activity, options, ...(fact ? { sharedFact: fact } : {}) };
}

const recentlyAsked = (ctx: MatcherContext, id: MemberId) => ctx.snapshot.inboundAsks.some(x => x.memberId === id && ctx.snapshot.now - x.at < 7 * 86_400_000);

export function randomMatcher(): SlopMatcher {
  return {
    name: "random-within-filters",
    propose(ctx) {
      const pool = [...ctx.profiles.values()].filter(v => v.matchable && !v.paused);
      const used = new Set<MemberId>();
      const out: SlopProposal[] = [];
      const ex = visibleExclusions(ctx);
      for (const a of ctx.rng.shuffle(pool)) {
        if (used.has(a.id)) continue;
        const cands = visibleCandidates(ctx, a, pool, ex).filter(c => !used.has(c.b.id));
        if (!cands.length) continue;
        const { b, cities } = ctx.rng.pick(cands);
        used.add(a.id); used.add(b.id);
        // The member with the live want (asked this week) is probed first.
        const [first, partner] = recentlyAsked(ctx, b.id) && !recentlyAsked(ctx, a.id) ? [b, a] : [a, b];
        out.push({ first: first.id, partner: partner.id, city: ctx.rng.pick(cities), ...planDate(first, partner, ctx.rng) });
      }
      return out;
    },
  };
}

export function greedyDesirabilityMatcher(w: SlopWorld): SlopMatcher {
  const D = (id: MemberId) => w.oracle.p(id).hidden.desirability;
  return {
    name: "greedy-desirability",
    propose(ctx) {
      const pool = [...ctx.profiles.values()].filter(v => v.matchable && !v.paused);
      const out: SlopProposal[] = [];
      const ex = visibleExclusions(ctx);
      for (const a of ctx.rng.shuffle(pool)) {
        const cands = visibleCandidates(ctx, a, pool, ex);
        if (!cands.length) continue;
        const best = cands.reduce((x, y) => (D(y.b.id) > D(x.b.id) ? y : x));
        out.push({ first: a.id, partner: best.b.id, city: ctx.rng.pick(best.cities), ...planDate(a, best.b, ctx.rng) });
      }
      return out;
    },
  };
}

/** Oracle-optimal upper bound (hidden truth). Soft labels are cached per pair across weeks. */
export function oracleOptimalMatcher(w: SlopWorld, opts: { draws?: number } = {}): SlopMatcher {
  const O = w.oracle;
  const soft = new Map<string, number>();
  return {
    name: "oracle-optimal",
    propose(ctx) {
      const ex = visibleExclusions(ctx);
      const pool = w.personas.filter(p => isSafe(p) && !ctx.profiles.get(p.id)?.paused);
      const asked = new Set(ctx.snapshot.inboundAsks.filter(x => ctx.snapshot.now - x.at < 7 * 86_400_000).map(x => x.memberId));
      const edges: { a: MemberId; b: MemberId; w: number; prop: SlopProposal }[] = [];
      for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i]!, b = pool[j]!;
        if (ex.pairBlocked(a.id, b.id) || !O.trueEligible(a, b, ctx.week)) continue;
        const city = (["sf", "nyc", "la"] as SlopCity[]).find(c => O.presentIn(a, c, ctx.week) && O.presentIn(b, c, ctx.week));
        if (!city) continue;
        const acts = a.hidden.activities.filter(x => b.hidden.activities.includes(x));
        const activity: DateActivity = acts[0] ?? a.hidden.activities[0]!;
        const key = a.id < b.id ? `${a.id}|${b.id}|${activity}` : `${b.id}|${a.id}|${activity}`;
        // Laplace-smoothed so a pair whose 32 draws all missed still counts (its true P is not 0).
        const K = opts.draws ?? 32;
        if (!soft.has(key)) soft.set(key, (O.softLabel(a.id, b.id, activity, K).pSecond * K + 0.5) / (K + 1));
        const pSecond = soft.get(key)!;
        const free = SLOTS.map((_, s) => s).filter(s => O.free(a.id, ctx.week, s) && O.free(b.id, ctx.week, s));
        const options = [...free, ...SLOTS.map((_, s) => s).filter(s => !free.includes(s))].slice(0, 3);
        const c = (id: MemberId) => ({ week: ctx.week, city, activity, asked: asked.has(id) });
        const ya = O.probeYesProb(a.id, c(a.id)), yb = O.probeYesProb(b.id, c(b.id));
        const pDate = O.pDateHappens(a.id, b.id, c(a.id), options, c(b.id));
        const [first, partner] = ya >= yb ? [a.id, b.id] : [b.id, a.id];
        edges.push({ a: a.id, b: b.id, w: pDate * pSecond, prop: { first, partner, city, activity, options } });
      }
      edges.sort((x, y) => y.w - x.w || (x.a + x.b < y.a + y.b ? -1 : 1));
      const used = new Set<MemberId>();
      const out: SlopProposal[] = [];
      for (const e of edges) {
        if (used.has(e.a) || used.has(e.b)) continue;
        used.add(e.a); used.add(e.b);
        out.push(e.prop);
      }
      return out;
    },
  };
}

export const BASELINES = {
  random: () => randomMatcher(),
  greedy: (w: SlopWorld) => greedyDesirabilityMatcher(w),
  oracle: (w: SlopWorld) => oracleOptimalMatcher(w),
} as const;
