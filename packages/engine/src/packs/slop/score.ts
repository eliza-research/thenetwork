// slopPack scoring: each side's estimated enjoyment of a first date with the other (directional
// value), aggregated reciprocally (harmonic mean or minimum, RECON). Stated preferences are FILTERS
// only (rules.ts); here only compatibility signals count:
//   - goals (casual vs long-term), lifestyle (smoking, drinking, kids, faith, politics), shared
//     interests, the planned activity both like, the stated "type" against the other's self-description
//     (weak by design: Eastwick & Finkel 2008);
//   - a learned / revealed component from the Network's own records: how positively a member rates
//     the dates they go on, and how the people they met rated them (both shrunk to a prior);
//   - pair logistics: a stated common free slot for the booked date.
// Unknown fields use expected factors (never zero, never a guess presented as a fact). Nothing here
// reads race or ethnicity (there is no such field) or any hidden truth.
import type { SlopPackOptions } from "./options.ts";
import type { SlopProfile } from "./profile.ts";

/** Lifestyle values that, held by the other person, someone with that dealbreaker would refuse. */
function dealbreakerHit(d: string, v: SlopProfile["values"]): boolean | undefined {
  switch (d) {
    case "smoker": return v.smoking === undefined ? undefined : v.smoking === "regular";
    case "heavy_drinker": return v.drinking === undefined ? undefined : v.drinking === "regular";
    case "has_kids": return v.hasKids === undefined ? undefined : v.hasKids === "yes";
    case "wants_kids": return v.wantsKids === undefined ? undefined : v.wantsKids === "yes";
    case "no_kids_ever": return v.wantsKids === undefined ? undefined : v.wantsKids === "no";
    case "religious": return v.religionImportance === undefined ? undefined : v.religionImportance >= 2;
    case "nonreligious": return v.religionImportance === undefined ? undefined : v.religionImportance === 0;
    case "right_politics": return v.politics === undefined ? undefined : v.politics === "right";
    case "left_politics": return v.politics === undefined ? undefined : v.politics === "left";
    default: return undefined;
  }
}
/** A stated dealbreaker of `a` that `b`'s known values hit (the hard filter). Unknown values never count. */
export function statedDealbreaker(a: SlopProfile, b: SlopProfile): string | undefined {
  return a.dealbreakers.find(d => dealbreakerHit(d, b.values) === true);
}

/**
 * Values of `b` that commonly are someone's dealbreaker, given `a`'s own values (people rarely hold
 * a dealbreaker against their own lifestyle). Used only when `a` has not stated dealbreakers.
 */
function likelyDealbreakers(a: SlopProfile, b: SlopProfile): number {
  const va = a.values, vb = b.values;
  let n = 0;
  if (vb.smoking === "regular" && va.smoking !== "regular" && va.smoking !== "sometimes") n++;
  if (vb.drinking === "regular" && va.drinking !== "regular") n += 0.4;
  if (vb.hasKids === "yes" && va.hasKids !== "yes") n += 0.3;
  if (vb.wantsKids === "yes" && va.wantsKids === "no") n++;
  if (vb.wantsKids === "no" && va.wantsKids === "yes") n++;
  if (vb.religionImportance !== undefined && va.religionImportance !== undefined) {
    if (vb.religionImportance >= 2 && va.religionImportance === 0) n += 0.4;
    if (vb.religionImportance === 0 && va.religionImportance >= 2) n++;
  }
  if (vb.politics === "right" && va.politics === "left") n++;
  if (vb.politics === "left" && va.politics === "right") n++;
  return n;
}

/** a's expected compatibility with b (0..1]: goals, lifestyle, likely unstated dealbreakers, interests. */
export function compatEstimate(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  const K = o.compat;
  let c = 1;
  // Goals.
  if (!a.goal || !b.goal) c *= K.goalUnknown;
  else if ((a.goal === "casual" && b.goal === "long_term") || (a.goal === "long_term" && b.goal === "casual")) c *= K.goalClash;
  else if (a.goal !== b.goal) c *= K.goalUnsure;
  // Lifestyle: a mismatch where both are known; an expected factor where either is unknown.
  const va = a.values, vb = b.values;
  const pair = <T>(x: T | undefined, y: T | undefined, clash: (x: T, y: T) => boolean, f: number) => {
    if (x === undefined || y === undefined) c *= K.unknownField;
    else if (clash(x, y)) c *= f;
  };
  pair(va.smoking, vb.smoking, (x, y) => (x === "never" && y === "regular") || (x === "regular" && y === "never"), K.lifestyleMismatch);
  pair(va.drinking, vb.drinking, (x, y) => (x === "never" && y === "regular") || (x === "regular" && y === "never"), K.lifestyleMismatch + 0.05);
  pair(va.religionImportance, vb.religionImportance, (x, y) => Math.abs(x - y) >= 2, K.religionGap);
  pair(va.politics, vb.politics, (x, y) => (x === "left" && y === "right") || (x === "right" && y === "left"), K.politicsClash);
  if (a.goal !== "casual") pair(va.wantsKids, vb.wantsKids, (x, y) => (x === "yes" && y === "no") || (x === "no" && y === "yes"), K.kidsClash);
  // Dealbreakers a has not stated (tier without them): b's values that commonly are one.
  if (!a.dealbreakers.length) c *= Math.pow(1 - K.hiddenDealbreaker * 0.8, likelyDealbreakers(a, b));
  // Shared interests (known ones; a lower bound on the true overlap).
  const shared = a.interests.filter(t => b.interests.includes(t)).length;
  c *= K.sharedInterest[Math.min(2, shared)]!;
  return c;
}

/** Stated type (wants) against the other's self-description, both on the same 5 dimensions; 0 when unknown. */
export function typeMatch(a: SlopProfile, b: SlopProfile): number {
  if (!a.wants || !b.self) return 0;
  let s = 0;
  for (let i = 0; i < a.wants.length; i++) s += a.wants[i]! * b.self[i]!;
  return Math.max(-2, Math.min(2, s));
}

/** Shrunk mean of a feedback scale (0..1) with `n` observations. */
const shrink = (mean: number, n: number, prior: number, k: number) => (mean * n + prior * k) / (n + k);

/**
 * Learned / revealed factor for a's enjoyment of b: members who enjoy the dates they go on (rate
 * them well) tend to enjoy the next one; people whom past dates enjoyed tend to be enjoyed again.
 * 1 with no history. The learned desirability signal is used only inside the reciprocal score, never
 * to sort exposure downward (congestion control lifts low-exposure members back up).
 */
export function learnedFactor(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  const L = o.learned;
  if (!L.enabled) return 1;
  const pos = shrink(a.history.givenMean, a.history.given, L.prior, L.strength) - L.prior;
  const app = shrink(b.history.receivedMean, b.history.received, L.prior, L.strength) - L.prior;
  return Math.exp(L.positivity * pos + L.appeal * app + L.taste * revealedTaste(a, b));
}

const cos = (x: number[], y: number[]) => {
  let s = 0, nx = 0, ny = 0;
  for (let i = 0; i < x.length; i++) { s += x[i]! * y[i]!; nx += x[i]! ** 2; ny += y[i]! ** 2; }
  return nx && ny ? s / Math.sqrt(nx * ny) : 0;
};
/**
 * Revealed taste: does b resemble the people a rated well (and not the ones a rated badly)? Mean of
 * (rating - 0.5) x cosine(rated person's self-description, b's), shrunk by the number of ratings.
 * 0 with no ratings or no self-description. A member's own revealed type, never a global "type".
 */
export function revealedTaste(a: SlopProfile, b: SlopProfile): number {
  const rs = a.history.ratedSelf;
  if (!rs.length || !b.self) return 0;
  let s = 0;
  for (const r of rs) s += (r.v - 0.5) * cos(r.self, b.self);
  return s / (rs.length + 1);
}

/** The activity for a first date: one both stated, else one of either's, else coffee (public, short). */
export function dateActivity(a: SlopProfile, b: SlopProfile): string {
  const both = a.activities.filter(x => b.activities.includes(x));
  // Short, public, easy first dates first.
  const order = ["coffee", "drinks", "walk", "museum", "dinner", "live_music", "comedy", "climbing", "cooking_class", "hike"];
  const pick = (xs: string[]) => [...xs].sort((x, y) => (order.indexOf(x) - order.indexOf(y)) || (x < y ? -1 : 1))[0];
  return pick(both) ?? pick([...a.activities, ...b.activities].filter(x => order.indexOf(x) <= 3)) ?? pick([...a.activities, ...b.activities]) ?? "coffee";
}

/** a's estimated enjoyment of a first date with b (0..1]: the directional value. */
export function directional(a: SlopProfile, b: SlopProfile, o: SlopPackOptions, activity = dateActivity(a, b), attraction = 0): number {
  let v = compatEstimate(a, b, o);
  if (attraction) v *= Math.exp(attraction);
  if (a.activities.length && !a.activities.includes(activity)) v *= o.compat.activityMiss;
  v *= Math.exp(o.compat.typeWeight * typeMatch(a, b));
  v *= learnedFactor(a, b, o);
  return Math.max(1e-6, Math.min(1, v));
}

/**
 * Weighted RMS gap between two ratings over face / body / overall (o.appearance.dims) when both are
 * usable (confidence >= min), else undefined. With dims = overall only it is |overall_a - overall_b|.
 */
export function appearanceGap(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number | undefined {
  const x = a.appearance, y = b.appearance, A = o.appearance;
  if (!x || !y || x.confidence < A.minConfidence || y.confidence < A.minConfidence) return undefined;
  const W = A.dims ?? { face: 0, body: 0, overall: 1 };
  const tot = W.face + W.body + W.overall;
  if (!(tot > 0)) return Math.abs(x.overall - y.overall);
  return Math.sqrt((W.face * (x.face - y.face) ** 2 + W.body * (x.body - y.body) ** 2 + W.overall * (x.overall - y.overall) ** 2) / tot);
}
/** Soft assortative term: exp(-w x gap^2), 1 when off or unusable. */
export function appearanceFactor(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  if (o.appearance.mode !== "soft") return 1;
  const d = appearanceGap(a, b, o);
  return d === undefined ? 1 : Math.exp(-o.appearance.softWeight * d * d);
}

/**
 * a's revealed preference for a body type: mean (rating - a's mean rating) over the dates a rated
 * whose partner had that (confident) body type, shrunk toward 0. undefined with no such ratings.
 */
export function revealedBodyPref(a: SlopProfile, type: string, shrinkN: number): number | undefined {
  const rs = a.history.ratedBody;
  if (!rs.length) return undefined;
  const mean = rs.reduce((s, r) => s + r.v, 0) / rs.length;
  const of = rs.filter(r => r.type === type);
  if (!of.length) return undefined;
  return of.reduce((s, r) => s + (r.v - mean), 0) / (of.length + shrinkN);
}
/**
 * Body type (categorical), directional: a's value of b x exp(+statedWeight) when b's body type is in
 * a's stated preferences, exp(-statedWeight) when not; with no stated preference, exp(revealedWeight
 * x 2 x revealed preference); otherwise 1 (the similarity term is all that applies).
 */
export function bodyTypeFactor(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  const B = o.appearance.bodyType;
  if (o.appearance.mode === "off" || !B?.enabled) return 1;
  const t = b.appearance?.bodyType;
  if (!t || (b.appearance!.bodyTypeConfidence ?? 0) < B.minConfidence || b.appearance!.confidence < o.appearance.minConfidence) return 1;
  if (a.wantsBody.length) return Math.exp(a.wantsBody.includes(t) ? B.statedWeight : -B.statedWeight);
  const r = revealedBodyPref(a, t, B.revealedShrink);
  return r === undefined ? 1 : Math.exp(B.revealedWeight * 2 * r);
}

/** Booked-date logistics: a slot both said they are usually free (else an expected factor). */
export function logistics(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  if (!a.free.length || !b.free.length) return o.logistics.unknownSlots;
  return a.free.some(s => b.free.includes(s)) ? 1 : o.logistics.noCommonSlot;
}

/** Reciprocal aggregate. */
export function aggregate(xs: number[], kind: SlopPackOptions["aggregate"]): number {
  if (!xs.length) return 0;
  if (xs.some(x => x <= 0)) return 0;
  if (xs.length === 1) return xs[0]!;
  return kind === "min" ? Math.min(...xs) : xs.length / xs.reduce((s, x) => s + 1 / x, 0);
}

/** Estimated P(this member answers a probe yes), from their own probe history (Beta-smoothed). */
export function responsiveness(p: SlopProfile): number {
  const h = p.history;
  return (h.yes + 0.45 * 2) / (h.yes + h.no + h.silent + 2);
}
