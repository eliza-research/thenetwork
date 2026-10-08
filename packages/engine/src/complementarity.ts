// Structured complementarity (needs -> offers), the ranking term the embedding similarity misses.
//
// The hashing embedding scores "how alike do these texts look". What predicts a good introduction
// is complementarity: A wants something B can give (a skill or offer), A and B want the same
// shared thing (a band, a run club, new friends), or at least B is into what A's want is about.
// This module scores that from engine-visible data only: live intents (World already drops
// expired / inactive ones), goal/desire facets, interest / skill / offer facet tags, the objective
// taxonomy (taxonomy.ts) and the romance preference tags the filters already read. It is
// reciprocal: each side gets its own benefit and the pair value is their harmonic mean, the same
// rule as mutualBenefit (scoring.ts), so a match that only serves one side scores low.
import type { Intent, MemberId } from "@thenetwork/core";
import type { ObjectiveDef } from "./pack.ts";
import type { Ontology } from "./pack.ts";
import { networkOntology } from "./packs/network/ontology.ts";
import type { MemberIndex, World } from "./world.ts";

export interface StructuredProfile {
  /** Primary tag of each interest facet. */
  interests: Set<string>;
  /** Every tag of skill / offer / resource facets (what this member can give). */
  caps: Set<string>;
  /** What this member wants, with a weight (1 for a live intent, GOAL_WEIGHT for a goal facet). */
  wants: { def: ObjectiveDef; weight: number }[];
  /** Pools this member is in (from wants). */
  pools: Set<string>;
  /** False when nothing structured is known: complementarity is then not applied (neutral). */
  known: boolean;
  /**
   * True when a live intent maps to no objective (a want outside the taxonomy). Complementarity is
   * then not applied either: the taxonomy cannot score that want, so it must not count as unmet
   * (engine-pipeline-12; the taxonomy is the simulator oracle's own vocabulary).
   */
  offTaxonomy: boolean;
}

/** Goal / desire facets are weaker evidence of a current want than a live intent. */
export const GOAL_WEIGHT = 0.8;
/** Satisfaction levels (same ordering as the shared-intent and help generators use). */
export const SAT = { need: 1, pool: 0.85, romance: 0.9, interest: 0.45 } as const;

/** Harmonic mean (0 if any side is 0), as scoring.ts `harmonic`; local to avoid an import cycle. */
const harmonicMean = (xs: number[]) => (xs.some(x => x <= 0) ? 0 : xs.length / xs.reduce((s, x) => s + 1 / x, 0));

const cache = new WeakMap<World, Map<MemberId, StructuredProfile>>();

export function profileOf(w: World, id: MemberId): StructuredProfile {
  let m = cache.get(w);
  if (!m) { m = new Map(); cache.set(w, m); }
  let p = m.get(id);
  if (!p) { p = buildProfile(w.get(id)!, w.pack.ontology); m.set(id, p); }
  return p;
}

export function buildProfile(mi: MemberIndex, O: Pick<Ontology, "objectivesFor"> = networkOntology): StructuredProfile {
  const lower = (t: string) => t.toLowerCase();
  const interests = new Set(mi.match.filter(f => f.kind === "interest" && f.tags.length).map(f => lower(f.tags[0]!)));
  const caps = new Set(mi.caps.flatMap(f => f.tags.map(lower)));
  const wants: StructuredProfile["wants"] = [];
  const add = (def: ObjectiveDef, weight: number) => {
    const cur = wants.find(x => x.def.id === def.id);
    if (!cur) wants.push({ def, weight }); else cur.weight = Math.max(cur.weight, weight);
  };
  let offTaxonomy = false;
  for (const i of mi.intents) {
    const defs = O.objectivesFor(i.objective, i.details, i.category);
    if (!defs.length) offTaxonomy = true;
    for (const def of defs) add(def, 1);
  }
  for (const f of mi.match) if (f.kind === "goal" || f.kind === "desire") for (const def of O.objectivesFor(f.value.replace(/^wants to /i, ""))) add(def, GOAL_WEIGHT);
  const pools = new Set(wants.flatMap(x => (x.def.pool ? [x.def.pool] : [])));
  return { interests, caps, wants, pools, known: interests.size + caps.size + wants.length > 0, offTaxonomy };
}

/** Both members' romance preferences admit each other (opt-in, stated orientation, age range). */
export function romanceMutual(w: World, a: MemberId, b: MemberId): boolean {
  const A = w.get(a)!, B = w.get(b)!;
  const one = (x: MemberIndex, y: MemberIndex) => !!x.romance && x.m.prefs.romanceOptIn && !!y.romance && y.romance.is.some(g => x.romance!.seeks.includes(g))
    && (y.m.age ?? 0) >= x.romance.ageMin && (y.m.age ?? 0) <= x.romance.ageMax;
  return one(A, B) && one(B, A);
}

function satisfy(w: World, def: ObjectiveDef, a: MemberId, b: MemberId, B: StructuredProfile): number {
  if (def.romance) return w.pack.ontology.mutualPreferenceMatch(w, a, b) ? SAT.romance : 0;
  if (def.needs.some(n => B.caps.has(n))) return SAT.need;
  if (def.pool && B.pools.has(def.pool)) return SAT.pool;
  if (def.interests.some(t => B.interests.has(t))) return SAT.interest;
  return 0;
}

/** How well `b` satisfies `a`'s best want (0..1). */
export function satisfaction(w: World, a: MemberId, b: MemberId): number {
  const A = profileOf(w, a), B = profileOf(w, b);
  let best = 0;
  for (const { def, weight } of A.wants) best = Math.max(best, weight * satisfy(w, def, a, b, B));
  return best;
}

/** How well member `b` satisfies one specific intent of another member (retrieval channel). */
export function intentSatisfaction(w: World, intent: Intent, b: MemberId): number {
  const B = profileOf(w, b);
  let best = 0;
  for (const def of w.pack.ontology.objectivesFor(intent.objective, intent.details, intent.category)) best = Math.max(best, satisfy(w, def, intent.memberId, b, B));
  return best;
}

/** Interest overlap: shared primary interest tags over the smaller interest set. */
export function interestOverlap(A: StructuredProfile, B: StructuredProfile): number {
  let shared = 0;
  for (const t of A.interests) if (B.interests.has(t)) shared++;
  return shared / Math.max(1, Math.min(A.interests.size, B.interests.size));
}

/**
 * What `a` gets from meeting `b` (0..1): interest overlap, how well b meets a's wants, and a small
 * term for a meeting one of b's wants (people enjoy helping when they can). Weights from config.
 */
export function sideBenefit(w: World, a: MemberId, b: MemberId): number {
  const k = w.cfg.complementarity;
  const v = k.overlap * interestOverlap(profileOf(w, a), profileOf(w, b)) + k.need * satisfaction(w, a, b) + k.give * satisfaction(w, b, a);
  return Math.max(0, Math.min(1, v / (k.overlap + k.need + k.give)));
}

export interface Complementarity {
  /** Reciprocal pair value: harmonic mean of the two sides (mean over pairs for groups). */
  pair: number;
  /** Per participant: mean side benefit over the other participants. */
  benefit: Record<MemberId, number>;
}

/**
 * Structured complementarity of a configuration, or undefined when it does not apply (fewer than
 * two participants, a participant with no structured profile at all, or one with a live want the
 * taxonomy cannot read: unknown is neutral, so low-data members and off-taxonomy wants are not
 * pushed down for what the taxonomy does not cover).
 */
export function complementarity(w: World, ids: MemberId[]): Complementarity | undefined {
  if (ids.length < 2 || ids.some(id => !w.get(id) || !profileOf(w, id).known || profileOf(w, id).offTaxonomy)) return undefined;
  const benefit: Record<MemberId, number> = {};
  let pairSum = 0, pairs = 0;
  for (const a of ids) {
    let s = 0;
    for (const b of ids) if (b !== a) s += sideBenefit(w, a, b);
    benefit[a] = s / (ids.length - 1);
  }
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    pairSum += harmonicMean([sideBenefit(w, ids[i]!, ids[j]!), sideBenefit(w, ids[j]!, ids[i]!)]); pairs++;
  }
  return { pair: pairSum / pairs, benefit };
}
