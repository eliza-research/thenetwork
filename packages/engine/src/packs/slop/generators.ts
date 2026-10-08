// slopPack retrieval and candidate generation: reciprocal candidates within geo and filters.
// For every member who can be matched this run (member rules), every other member who dates in a
// market they share is checked against the full pair filter (core blocks and minors, the pack's
// mutual preference rules, the mutual radius); survivors are scored both ways and each member keeps
// their top-K by reciprocal value. A pair is a candidate when it is in either member's top-K, so the
// assignment sees enough options for scarce pools. One generator; stated preferences only filter.
import type { City, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { memberReason, pairReason } from "../../filters.ts";
import { makeCandidate, type GenCtx } from "../../genkit.ts";
import type { GeneratorSpec } from "../../pack.ts";
import type { Candidate } from "../../types.ts";
import { mutualMarkets } from "./geo.ts";
import type { SlopPackOptions } from "./options.ts";
import { datingMarkets, slopProfiles, type SlopProfile } from "./profile.ts";
import { SLOP_LANE } from "./rules.ts";
import { aggregate, dateActivity, directional, logistics, responsiveness } from "./score.ts";

export const SLOP_GENERATOR = "slop_reciprocal";

/** The member probed first: the one with the live want (asked most recently), then the more responsive one. */
export function firstOf(a: SlopProfile, b: SlopProfile, now: number): [SlopProfile, SlopProfile] {
  const fresh = (p: SlopProfile) => (p.history.lastAskAt !== undefined && now - p.history.lastAskAt < 7 * DAY ? p.history.lastAskAt : -Infinity);
  const fa = fresh(a), fb = fresh(b);
  if (fa !== fb) return fa > fb ? [a, b] : [b, a];
  const ra = responsiveness(a), rb = responsiveness(b);
  if (ra !== rb) return ra > rb ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}

/** Reciprocal value of a pair and each side's directional value (both include the pair's logistics). */
export function pairValue(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): { value: number; va: number; vb: number; activity: string } {
  const activity = dateActivity(a, b);
  const lg = logistics(a, b, o);
  const va = directional(a, b, o, activity) * lg, vb = directional(b, a, o, activity) * lg;
  return { value: aggregate([va, vb], o.aggregate), va, vb, activity };
}

export function slopGenerators(o: SlopPackOptions): GeneratorSpec[] {
  return [{
    name: SLOP_GENERATOR,
    run(ctx: GenCtx): Candidate[] {
      const w = ctx.w;
      const P = slopProfiles(w.input, w.canonical);
      const markets = w.pack.geo.markets(w.cfg);
      // Members who can be matched at all this run.
      const ok: SlopProfile[] = [];
      for (const id of w.ids) {
        const r = memberReason(w, id, { category: SLOP_LANE, role: "peer", format: "one_to_one", timeSensitive: false });
        if (r) { ctx.memberExclusions[r] = (ctx.memberExclusions[r] ?? 0) + 1; continue; }
        ok.push(P.get(id)!);
      }
      const byMarket = new Map<City, SlopProfile[]>();
      for (const p of ok) for (const m of datingMarkets(p)) if (markets.includes(m)) { const l = byMarket.get(m) ?? []; l.push(p); byMarket.set(m, l); }
      // Score every filtered pair once.
      const seen = new Set<string>();
      const best = new Map<MemberId, { k: string; v: number }[]>();
      const pairs = new Map<string, { a: SlopProfile; b: SlopProfile; value: number; va: number; vb: number; activity: string; market: City }>();
      for (const [, list] of [...byMarket.entries()].sort(([x], [y]) => (x < y ? -1 : 1))) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!, b = list[j]!;
          const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          if (pairReason(w, a.id, b.id, SLOP_LANE)) continue;
          const mm = mutualMarkets(a, b, o, markets);
          if (!mm.length) continue;
          const pv = pairValue(a, b, o);
          pairs.set(k, { a, b, ...pv, market: mm[0]!.market });
          for (const [m, v] of [[a.id, pv.value], [b.id, pv.value]] as const) { const l = best.get(m) ?? []; l.push({ k, v }); best.set(m, l); }
        }
      }
      const keep = new Set<string>();
      for (const [, l] of best) for (const e of l.sort((x, y) => (y.v - x.v) || (x.k < y.k ? -1 : 1)).slice(0, o.congestion.topK)) keep.add(e.k);
      const out: Candidate[] = [];
      for (const k of [...keep].sort()) {
        const x = pairs.get(k)!;
        const [first, partner] = firstOf(x.a, x.b, w.now);
        const intent = w.get(first.id)!.intents.find(i => i.category === SLOP_LANE);
        const ev = (p: SlopProfile, other: SlopProfile) => p.interests.filter(t => other.interests.includes(t)).map(t => p.interestFacet.get(t)).filter((f): f is string => !!f);
        out.push(makeCandidate({
          generator: SLOP_GENERATOR, kind: "intro", category: SLOP_LANE,
          participants: [first.id, partner.id], roles: { [first.id]: "seeker", [partner.id]: "peer" }, format: "one_to_one",
          objective: `${x.activity.replace(/_/g, " ")} date`,
          ...(intent ? { anchor: { type: "intent" as const, id: intent.id } } : {}),
          preferredCity: x.market,
          channels: new Set(["geo", "prefs", "compat"]),
          evidence: { [first.id]: ev(first, partner), [partner.id]: ev(partner, first) },
          fit: x.value, benefit: { [first.id]: first.id === x.a.id ? x.va : x.vb, [partner.id]: partner.id === x.a.id ? x.va : x.vb },
          confidenceHint: 1,
        }));
      }
      return out;
    },
  }];
}
