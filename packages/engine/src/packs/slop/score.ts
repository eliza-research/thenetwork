import {
  type DateGoal, type DateHabit, type DateKids, type DatePackAnswers, type DatePackCheap, type DatePackSeeker, type DatePolitics,
  datePackScale, datePackValue as datePackValueOf,
} from "../../../../core/src/generated/datePackValue.ts";
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

/** Stated type (wants) against the other's self-description, both on the same 5 dimensions; 0 when unknown. */
export function typeMatch(a: SlopProfile, b: SlopProfile): number {
  if (!a.wants || !b.self) return 0;
  let s = 0;
  for (let i = 0; i < a.wants.length; i++) s += a.wants[i]! * b.self[i]!;
  return Math.max(-2, Math.min(2, s));
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
function ratedBodyType(b: SlopProfile, o: SlopPackOptions): string | undefined {
  const B = o.appearance.bodyType, ap = b.appearance;
  if (!B.enabled || !ap?.bodyType) return undefined;
  return (ap.bodyTypeConfidence ?? 0) < B.minConfidence || ap.confidence < o.appearance.minConfidence ? undefined : ap.bodyType;
}
function bodyLearnedPermille(a: SlopProfile, type: string, o: SlopPackOptions): number {
  const r = revealedBodyPref(a, type, o.appearance.bodyType.revealedShrink);
  return r === undefined ? datePackScale : Math.round(datePackScale * Math.exp(r));
}

const goalOf = (g: SlopProfile["goal"]): DateGoal =>
  g === "casual" ? "DateGoalCasual" : g === "long_term" ? "DateGoalLongTerm" : g === "unsure" ? "DateGoalUnsure" : "DateGoalUnstated";
const habitOf = (h: string | undefined): DateHabit =>
  h === undefined ? "DateHabitUnstated" : h === "never" ? "DateHabitNever" : h === "regular" ? "DateHabitRegular" : "DateHabitOccasional";
const kidsOf = (k: string | undefined): DateKids =>
  k === undefined ? "DateKidsUnstated" : k === "yes" ? "DateKidsYes" : k === "no" ? "DateKidsNo" : "DateKidsOpen";
const politicsOf = (x: string | undefined): DatePolitics =>
  x === undefined ? "DatePoliticsUnstated" : x === "left" ? "DatePoliticsLeft" : x === "right" ? "DatePoliticsRight" : "DatePoliticsMiddle";

const answersMemo = new WeakMap<SlopProfile, DatePackAnswers>();
export function datePackAnswersOf(p: SlopProfile): DatePackAnswers {
  let answers = answersMemo.get(p);
  if (!answers) {
    const v = p.values;
    answers = {
      goal: goalOf(p.goal), smoking: habitOf(v.smoking), drinking: habitOf(v.drinking), religionImportance: v.religionImportance ?? -1,
      politics: politicsOf(v.politics), hasKids: kidsOf(v.hasKids), wantsKids: kidsOf(v.wantsKids),
    };
    answersMemo.set(p, answers);
  }
  return answers;
}

const seekerMemo = new WeakMap<SlopProfile, { o: SlopPackOptions; seeker: DatePackSeeker }>();
export function datePackSeekerOf(p: SlopProfile, o: SlopPackOptions): DatePackSeeker {
  const memo = seekerMemo.get(p);
  if (memo?.o === o) return memo.seeker;
  const rs = p.history.ratedSelf;
  const tasteMost = rs.reduce((s, r) => s + Math.abs(r.v - 0.5), 0) / (rs.length + 1);
  const statesBodyPrefs = o.appearance.bodyType.enabled && p.wantsBody.length > 0;
  const bodyTypes = statesBodyPrefs || !o.appearance.bodyType.enabled ? [] : [...new Set(p.history.ratedBody.map(r => r.type))];
  const seeker: DatePackSeeker = {
    answers: datePackAnswersOf(p), statesDealbreakers: p.dealbreakers.length > 0, statesType: p.wants !== undefined,
    statesBodyPrefs, statesFreeSlots: p.free.length > 0,
    tasteCeiling: o.learned.enabled && rs.length ? Math.ceil(datePackScale * Math.exp(tasteMost)) : datePackScale,
    bodyLearnedCeiling: bodyTypes.reduce((top, t) => Math.max(top, bodyLearnedPermille(p, t, o)), datePackScale),
  };
  seekerMemo.set(p, { o, seeker });
  return seeker;
}

export const DATE_TYPE_WEIGHT = 0.1;

export function datePackCheapOf(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): DatePackCheap {
  return cheapOf(a, b, ratedBodyType(b, o));
}
const expPermille = (x: number) => (x === 0 ? datePackScale : Math.round(datePackScale * Math.exp(x)));
function cheapOf(a: SlopProfile, b: SlopProfile, t: string | undefined): DatePackCheap {
  return {
    sharedInterests: a.interests.filter(x => b.interests.includes(x)).length,
    typeFit: expPermille(DATE_TYPE_WEIGHT * typeMatch(a, b)),
    bodyFit: !t || !a.wantsBody.length ? "DateBodyUnrated" : a.wantsBody.includes(t) ? "DateBodyWanted" : "DateBodyNotWanted",
    slots: !b.free.length ? "DateSlotsUnknown" : a.free.some(s => b.free.includes(s)) ? "DateSlotsShared" : "DateSlotsApart",
  };
}

export function datePackValue(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): number {
  const t = ratedBodyType(b, o);
  return datePackValueOf(datePackSeekerOf(a, o), datePackAnswersOf(b), {
    cheap: cheapOf(a, b, t),
    activityMiss: a.activities.length > 0 && !a.activities.includes(dateActivity(a, b)),
    taste: o.learned.enabled ? expPermille(revealedTaste(a, b)) : datePackScale,
    bodyLearned: t && !a.wantsBody.length ? bodyLearnedPermille(a, t, o) : datePackScale,
  });
}

/** Estimated P(this member answers a probe yes), from their own probe history (Beta-smoothed). */
export function responsiveness(p: SlopProfile): number {
  const h = p.history;
  return (h.yes + 0.45 * 2) / (h.yes + h.no + h.silent + 2);
}
