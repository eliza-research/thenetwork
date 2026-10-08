// Baselines for friends.help (no engine code; the pack is compared against these):
//   random-within-area  every week, eligible members (claimed 18+, not on a hold) are shuffled
//                       within their planning zone and cut into groups of 5: a stated activity, a
//                       venue in the zone, one slot. New strangers every week: the reshuffled-dinner
//                       format (Timeleft-style). Uses stated data and holds only (no verification).
//   greedy-popular      groups seeded by the most "popular" visible members (stated activities,
//                       energy, "see again" votes received), city-wide, no geography: congestion and
//                       long trips (the concentration anti-metric).
//   oracle              upper bound with hidden truth (true adults, no adversaries, true likes,
//                       chemistry, true availability and travel): keeps groups whose members all
//                       enjoyed it together weekly and builds new groups greedily by expected
//                       enjoyment. Network code may not do this.
import type { MemberId } from "@thenetwork/core";
import { activityById } from "@thenetwork/engine/src/packs/network/activities.ts";
import { daypartOf } from "@thenetwork/engine/src/plans.ts";
import { hood, transitMinutes, type Neighborhood } from "@thenetwork/engine/src/packs/friends/index.ts";
import type { Rng } from "@thenetwork/core";
import { FRIEND_ACTIVITIES, SLOTS, hoodOf, isReal } from "./persona.ts";
import { NYC_TZ, slotTime } from "./snapshot.ts";
import { visibleProfiles, type VisibleProfile } from "./visible.ts";
import { VENUES, pk, type FriendsMatcher, type FriendsProposal, type FriendsWorld } from "./world.ts";

const venuesFor = new Map<string, typeof VENUES>();
for (const v of VENUES) for (const a of v.activities) { if (!venuesFor.has(a)) venuesFor.set(a, []); venuesFor.get(a)!.push(v); }

/** Slots whose daypart the activity allows (week 0 times; dayparts do not depend on the week). */
export function slotsFor(activity: string): number[] {
  const a = activityById.get(activity);
  if (!a) return [];
  return SLOTS.map((_, k) => k).filter(k => (a.dayparts as string[]).includes(daypartOf(slotTime(0, k), NYC_TZ)));
}

function nearestVenue(activity: string, homes: Neighborhood[], rng?: Rng, zone?: string): { id: string; hood: string } | undefined {
  const vs = venuesFor.get(activity) ?? [];
  if (!vs.length) return undefined;
  if (zone && rng) {
    const inZone = vs.filter(v => hood(v.area)?.zone === zone);
    if (inZone.length) { const v = rng.pick(inZone); return { id: v.id, hood: hood(v.area)!.id }; }
  }
  let best = vs[0]!, bw = Infinity;
  for (const v of vs) { const h = hood(v.area)!; const w = Math.max(...homes.map(x => transitMinutes(x, h))); if (w < bw) { bw = w; best = v; } }
  return { id: best.id, hood: hood(best.area)!.id };
}

const eligibleVisible = (vp: Map<MemberId, VisibleProfile>) => [...vp.values()].filter(v => v.adult && !v.held && v.home && v.activities.length).sort((a, b) => (a.id < b.id ? -1 : 1));

export const randomWithinArea: FriendsMatcher = {
  name: "random-within-area",
  propose(ctx) {
    // Reshuffled strangers, the way a weekly dinner product works: members who are free at a time
    // (stated standing slots or this week's check-in) are grouped at random within their zone.
    const vp = visibleProfiles(ctx.snapshot);
    const byZone = new Map<string, VisibleProfile[]>();
    for (const v of eligibleVisible(vp)) { if (!byZone.has(v.zone!)) byZone.set(v.zone!, []); byZone.get(v.zone!)!.push(v); }
    const free = (v: VisibleProfile) => new Set([...v.free, ...(ctx.snapshot.checkIns[v.id] ?? [])]);
    const out: FriendsProposal[] = [];
    for (const zone of [...byZone.keys()].sort()) {
      const left = new Set(byZone.get(zone)!.map(v => v.id));
      for (const slot of ctx.rng.shuffle(SLOTS.map((_, k) => k))) {
        const xs = ctx.rng.shuffle(byZone.get(zone)!.filter(v => left.has(v.id) && free(v).has(SLOTS[slot]!)));
        for (let i = 0; i + 3 <= xs.length; i += 5) {
          const g = xs.slice(i, i + 5);
          const counts = new Map<string, number>();
          for (const v of g) for (const a of v.activities) if (slotsFor(a).includes(slot)) counts.set(a, (counts.get(a) ?? 0) + 1);
          if (!counts.size) continue;
          const top = Math.max(...counts.values());
          const activity = ctx.rng.pick([...counts.keys()].filter(a => counts.get(a) === top).sort());
          const venue = nearestVenue(activity, g.map(v => hood(v.home)!), ctx.rng, zone);
          if (!venue) continue;
          const other = slotsFor(activity).filter(k => k !== slot && g.filter(v => free(v).has(SLOTS[k]!)).length >= 2);
          out.push({ kind: "plan", invited: g.map(v => v.id), alternates: [], activity, venueHood: venue.hood, venueId: venue.id, options: other.length ? [slot, ctx.rng.pick(other)] : [slot], quorum: 3 });
          for (const v of g) left.delete(v.id);
        }
      }
    }
    return out;
  },
};

export const greedyPopular: FriendsMatcher = {
  name: "greedy-popular",
  propose(ctx) {
    // Popularity from visible data (stated activities, social energy, "see again" votes received);
    // groups of the most popular members who share an activity, city-wide (no geography), so the same
    // popular members are planned every week and votes compound (rich get richer).
    const vp = visibleProfiles(ctx.snapshot);
    const el = eligibleVisible(vp);
    const pop = (v: VisibleProfile) => v.activities.length + (v.energy === "high" ? 2 : v.energy === "mid" ? 1 : 0) + 2 * v.liked;
    const ranked = [...el].sort((a, b) => (pop(b) - pop(a)) || (a.id < b.id ? -1 : 1));
    const used = new Set<MemberId>();
    const out: FriendsProposal[] = [];
    for (const seed of ranked) {
      if (used.has(seed.id)) continue;
      const activity = seed.activities.find(a => ranked.filter(v => !used.has(v.id) && v.id !== seed.id && v.activities.includes(a)).length >= 2);
      if (!activity) continue;
      const g = [seed, ...ranked.filter(v => !used.has(v.id) && v.id !== seed.id && v.activities.includes(activity)).slice(0, 4)];
      const venue = nearestVenue(activity, [hood(seed.home)!]);
      const allowed = slotsFor(activity);
      if (!venue || !allowed.length) continue;
      const opts = allowed.filter(k => seed.free.includes(SLOTS[k]!)).slice(0, 2);
      out.push({ kind: "plan", invited: g.map(v => v.id), alternates: [], activity, venueHood: venue.hood, venueId: venue.id, options: opts.length ? opts : [allowed[0]!], quorum: 3 });
      for (const v of g) used.add(v.id);
    }
    return out;
  },
};

/** Upper bound: hidden truth (see header). */
export function oracleMatcher(w: FriendsWorld): FriendsMatcher {
  const O = w.oracle;
  return {
    name: "oracle",
    propose(ctx) {
      const week = ctx.week;
      const held = new Set(ctx.snapshot.safetyHolds.map(h => h.memberId));
      const ok = (id: MemberId) => isReal(O.p(id)) && !held.has(id);
      const used = new Set<MemberId>();
      const out: FriendsProposal[] = [];
      const freeSlots = (ids: MemberId[], activity: string) => slotsFor(activity).map(k => ({ k, n: ids.filter(id => O.free(id, week, k)).length })).sort((a, b) => (b.n - a.n) || (a.k - b.k));
      // 1. Keep groups that all enjoyed it (last two weeks), same people again.
      const lastWeek = w.state.outcomes.filter(o => ctx.snapshot.now - o.at < 10 * 86400000);
      for (const o of lastWeek) {
        const ids = o.attended.filter(id => ok(id) && !used.has(id) && (w.lastEnjoy.get(id) ?? 0) >= O.P.positive);
        if (ids.length < 2) continue;
        const slots = freeSlots(ids, o.activityId).filter(s => s.n >= Math.min(3, ids.length));
        if (!slots.length) continue;
        const vh = o.venueId ? VENUES.find(v => v.id === o.venueId) : undefined;
        const venueHood = vh ? hood(vh.area)!.id : O.p(ids[0]!).hidden.home;
        out.push({ kind: "repeat", invited: ids.slice(0, 6), alternates: [], activity: o.activityId, venueHood, ...(vh ? { venueId: vh.id } : {}), options: slots.slice(0, 2).map(s => s.k), quorum: Math.min(3, ids.length) });
        for (const id of ids) used.add(id);
      }
      // 2. New tables: the seed's best-loved activity at a slot the seed is truly free, with up to 8
      // near neighbours truly free then who like it, ranked by like + chemistry + similarity.
      const pool = w.personas.filter(p => ok(p.id) && !used.has(p.id)).map(p => p.id).sort((a, b) => (O.appetite(b, week) - O.appetite(a, week)) || (a < b ? -1 : 1));
      for (const seed of pool) {
        if (used.has(seed)) continue;
        const S = O.p(seed).hidden;
        const near = pool.filter(id => id !== seed && !used.has(id) && transitMinutes(hoodOf(S.home), hoodOf(O.p(id).hidden.home)) <= Math.min(S.tolerance, O.p(id).hidden.tolerance));
        let best: { activity: string; slot: number; g: MemberId[]; s: number } | undefined;
        for (const activity of [...S.loves].sort((a, b) => S.likes[b]! - S.likes[a]!).slice(0, 3)) {
          for (const slot of slotsFor(activity)) {
            if (!O.free(seed, week, slot)) continue;
            const cands = near.filter(id => O.free(id, week, slot) && (O.p(id).hidden.likes[activity] ?? 0) >= 0.55);
            const g = [seed];
            const score = (id: MemberId) => (O.p(id).hidden.likes[activity] ?? 0) + g.reduce((sum, x) => sum + O.chem(x, id) + O.sim(x, id), 0) / g.length;
            while (g.length < 8) {
              const c = cands.filter(id => !g.includes(id)).map(id => ({ id, s: score(id) })).sort((x, y) => (y.s - x.s) || (x.id < y.id ? -1 : 1))[0];
              if (!c || c.s < 0.6) break;
              g.push(c.id);
            }
            const sc = g.length >= 3 ? g.reduce((sum, id) => sum + (O.p(id).hidden.likes[activity] ?? 0), 0) : 0;
            if (g.length >= 3 && (!best || sc > best.s)) best = { activity, slot, g, s: sc };
          }
        }
        if (!best) continue;
        const venue = nearestVenue(best.activity, best.g.map(id => hoodOf(O.p(id).hidden.home)));
        if (!venue) continue;
        out.push({ kind: "plan", invited: best.g, alternates: [], activity: best.activity, venueHood: venue.hood, venueId: venue.id, options: [best.slot], quorum: 3, maxSeats: 6, split: true });
        for (const id of best.g) used.add(id);
      }
      void pk;
      return out;
    },
  };
}

export const BASELINES = { random: randomWithinArea, greedy: greedyPopular, oracle: oracleMatcher } as const;
export const ACTIVITY_COUNT = FRIEND_ACTIVITIES.length;
