// slopPack scoring: each side's estimated enjoyment of a first date with the other (directional
// value), the Date lane's pack value (spec/matchLane.md); the match core combines both directions.
// Stated preferences are FILTERS only (rules.ts); here only compatibility signals count:
//   - goals (casual vs long-term), lifestyle (smoking, drinking, kids, faith, politics), shared
//     interests, the planned activity both like, the stated "type" against the other's self-description
//     (weak by design: Eastwick & Finkel 2008);
//   - a learned component from the Network's own records: the member's revealed taste (per pair);
//   - pair logistics: a stated common free slot for the booked date;
//   - body type against the stated or revealed body-type preference.
// The appearance rating is not here: it is the member's private lane standing (parity band).
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

function lifestyleFactor<T>(left: T | undefined, right: T | undefined, clash: (x: T, y: T) => boolean, penalty: number, unknown: number): number {
  if (left === undefined || right === undefined) return unknown;
  return clash(left, right) ? penalty : 1;
}

const regularVsNever = (x: string, y: string) => (x === "never" && y === "regular") || (x === "regular" && y === "never");
const religionGap = (x: number, y: number) => Math.abs(x - y) >= 2;
const oppositePolitics = (x: string, y: string) => (x === "left" && y === "right") || (x === "right" && y === "left");
const oppositeKids = (x: string, y: string) => (x === "yes" && y === "no") || (x === "no" && y === "yes");

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
  c *= lifestyleFactor(va.smoking, vb.smoking, regularVsNever, K.lifestyleMismatch, K.unknownField);
  c *= lifestyleFactor(va.drinking, vb.drinking, regularVsNever, K.lifestyleMismatch + 0.05, K.unknownField);
  c *= lifestyleFactor(va.religionImportance, vb.religionImportance, religionGap, K.religionGap, K.unknownField);
  c *= lifestyleFactor(va.politics, vb.politics, oppositePolitics, K.politicsClash, K.unknownField);
  if (a.goal !== "casual") c *= lifestyleFactor(va.wantsKids, vb.wantsKids, oppositeKids, K.kidsClash, K.unknownField);
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

/**
 * Learned factor for a's enjoyment of b: a's revealed taste for b only, a per-pair term. 1 with no
 * history. No property of one member alone enters the pack value: standing is the only global
 * quality signal.
 */
// spec/memberStanding.md, "Story: Estimate standing from facts, never from popularity"
export function learnedFactor(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  return o.learned.enabled ? Math.exp(o.learned.taste * revealedTaste(a, b)) : 1;
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

const activityOrder = ["coffee", "drinks", "walk", "museum", "dinner", "live_music", "comedy", "climbing", "cooking_class", "hike"];
function preferredActivity(current: string | undefined, activity: string): string {
  if (current === undefined) return activity;
  const rank = activityOrder.indexOf(activity) - activityOrder.indexOf(current);
  return rank < 0 || (rank === 0 && activity < current) ? activity : current;
}

/** The activity for a first date: one both stated, else one of either's, else coffee (public, short). */
export function dateActivity(a: SlopProfile, b: SlopProfile): string {
  let shared: string | undefined, first: string | undefined;
  for (const activity of a.activities) {
    first = preferredActivity(first, activity);
    if (b.activities.includes(activity)) shared = preferredActivity(shared, activity);
  }
  if (shared !== undefined) return shared;
  for (const activity of b.activities) first = preferredActivity(first, activity);
  return first ?? "coffee";
}

/** a's estimated enjoyment of a first date with b (0..1]: the directional value. */
export function directional(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  let v = compatEstimate(a, b, o);
  if (a.activities.length && !a.activities.includes(dateActivity(a, b))) v *= o.compat.activityMiss;
  v *= Math.exp(o.compat.typeWeight * typeMatch(a, b));
  v *= learnedFactor(a, b, o);
  return Math.max(1e-6, Math.min(1, v));
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
 * x 2 x revealed preference); otherwise 1.
 */
export function bodyTypeFactor(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  const B = o.appearance.bodyType;
  if (!B.enabled) return 1;
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

/** The Date lane's directed pack value of b for a: a whole number 0..1000. */
// spec/matchLane.md, "Each lane weighs the four utility terms"
export function datePackValue(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  const v = directional(a, b, o) * logistics(a, b, o) * bodyTypeFactor(a, b, o);
  return Math.round(1000 * Math.max(0, Math.min(1, v)));
}

/** Estimated P(this member answers a probe yes), from their own probe history (Beta-smoothed). */
export function responsiveness(p: SlopProfile): number {
  const h = p.history;
  return (h.yes + 0.45 * 2) / (h.yes + h.no + h.silent + 2);
}
