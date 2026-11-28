import {
  DAYTIME_ONLY_TOKENS,
  DRINKING_VALUE_NON_DRINKER_TOKENS,
  evaluateDateActivityAllowed,
  LOW_NOISE_TOKENS,
  LOW_WALKING_TOKENS,
  STRICT_SOBER_TOKENS,
  type MemberId,
} from "@thenetwork/core";
import {
  type DateGoal, type DateHabit, type DateKids, type DatePackAnswers, type DatePackCheap, type DatePackSeeker, type DatePolitics,
  datePackScale, datePackValue as datePackValueOf,
} from "../../../../core/src/generated/datePackValue.ts";
import { humanVectorOf, spendTierCompatible, spendTierRank } from "../../humanVector.ts";
import type { World } from "../../world.ts";
import type { SlopPackOptions } from "./options.ts";
import type { SlopProfile, SlopProfileRedLines } from "./profile.ts";

export interface DateActivityRedLines {
  anyStrictSober: boolean;
  anyNonDrinker: boolean;
  anyLowWalking: boolean;
  anyLowNoise?: boolean;
  anyDaytimeOnly: boolean;
  isAfterDark: boolean;
}

function profileRedLinesOf(p: SlopProfile): SlopProfileRedLines {
  if (p.redLines) return p.redLines;
  const drink = p.values.drinking?.trim().toLowerCase() ?? "";
  let strictSober = STRICT_SOBER_TOKENS.has(drink);
  let nonDrinker = strictSober || DRINKING_VALUE_NON_DRINKER_TOKENS.has(drink);
  let lowWalking = false;
  let lowNoise = false;
  let daytimeOnly = false;
  for (let i = 0; i < p.dealbreakers.length; i++) {
    const d = p.dealbreakers[i]!.trim().toLowerCase();
    if (!strictSober && STRICT_SOBER_TOKENS.has(d)) { strictSober = true; nonDrinker = true; }
    if (!nonDrinker && (d === "heavy_drinker" || DRINKING_VALUE_NON_DRINKER_TOKENS.has(d))) nonDrinker = true;
    if (!lowWalking && LOW_WALKING_TOKENS.has(d)) lowWalking = true;
    if (!lowNoise && (LOW_NOISE_TOKENS.has(d) || d === "sensory_quiet" || d === "no_loud_venues")) lowNoise = true;
    if (!daytimeOnly && DAYTIME_ONLY_TOKENS.has(d)) daytimeOnly = true;
  }
  return { strictSober, nonDrinker, lowWalking, lowNoise, daytimeOnly };
}

export function slopRedLinesOf(
  a: SlopProfile,
  b: SlopProfile,
  overrides: Partial<DateActivityRedLines> = {}
): DateActivityRedLines {
  const ra = profileRedLinesOf(a);
  const rb = profileRedLinesOf(b);
  return {
    anyStrictSober: Boolean(overrides.anyStrictSober) || ra.strictSober || rb.strictSober,
    anyNonDrinker: Boolean(overrides.anyNonDrinker) || ra.nonDrinker || rb.nonDrinker,
    anyLowWalking: Boolean(overrides.anyLowWalking) || ra.lowWalking || rb.lowWalking,
    anyLowNoise: Boolean(overrides.anyLowNoise) || ra.lowNoise || rb.lowNoise,
    anyDaytimeOnly: Boolean(overrides.anyDaytimeOnly) || ra.daytimeOnly || rb.daytimeOnly,
    isAfterDark: overrides.isAfterDark ?? false,
  };
}
export const datingRedLinesOf = slopRedLinesOf;

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
export function statedDealbreaker(a: SlopProfile, b: SlopProfile): string | undefined {
  return a.dealbreakers.find(d => dealbreakerHit(d, b.values) === true);
}

function typeMatch(a: SlopProfile, b: SlopProfile): number {
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
function revealedTaste(a: SlopProfile, b: SlopProfile): number {
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

export function isNonDrinkerProfile(p: SlopProfile): boolean {
  if (p.redLines) return p.redLines.nonDrinker;
  const drink = p.values.drinking?.trim().toLowerCase() ?? "";
  return DRINKING_VALUE_NON_DRINKER_TOKENS.has(drink);
}

export function slopHorizontalCompatibility(w: World, a: MemberId, b: MemberId): number {
  const va = humanVectorOf(w, a);
  const vb = humanVectorOf(w, b);
  if (!va || !vb) return 1;
  const ea = va.explicitSignals;
  const eb = vb.explicitSignals;
  let mult = 1;
  if (ea.spendTier || eb.spendTier) {
    const tierA = va.horizontal.lifestyle.spendComfortTier;
    const tierB = vb.horizontal.lifestyle.spendComfortTier;
    if (!spendTierCompatible(tierA, tierB, false)) mult *= 0.85;
    else if (ea.spendTier && eb.spendTier && Math.abs(spendTierRank(tierA) - spendTierRank(tierB)) === 0) mult *= 1.04;
  }
  if (ea.lifeStage && eb.lifeStage && va.horizontal.lifeStage === vb.horizontal.lifeStage) mult *= 1.04;
  if (ea.depth && eb.depth) {
    const diff = Math.abs(va.horizontal.communication.depthPreference.value - vb.horizontal.communication.depthPreference.value);
    mult *= 0.96 + 0.08 * (1 - diff);
  }
  if (ea.humor && eb.humor && va.horizontal.communication.humorRegister.some(h => vb.horizontal.communication.humorRegister.includes(h))) {
    mult *= 1.04;
  }
  if (ea.reliabilityPenalty || eb.reliabilityPenalty) {
    const minShow = Math.min(va.behavioral.showUpRate, vb.behavioral.showUpRate);
    if (minShow < 0.75) mult *= Math.max(0.75, 1 - 0.5 * (0.75 - minShow));
  }
  if (ea.hypeOrExtraction || eb.hypeOrExtraction) {
    const maxExt = Math.max(va.behavioral.extractionRiskScore, vb.behavioral.extractionRiskScore);
    if (maxExt > 0.3) mult *= Math.max(0.7, 1 - 0.6 * (maxExt - 0.3));
  }
  return Math.max(0.65, Math.min(1.15, mult));
}
export const datingHorizontalCompatibility = slopHorizontalCompatibility;

export function dateActivity(a: SlopProfile, b: SlopProfile, overrides?: boolean | Partial<DateActivityRedLines>): string {
  const normalizedOverrides = typeof overrides === "boolean" ? { anyNonDrinker: overrides } : overrides;
  const rl = slopRedLinesOf(a, b, normalizedOverrides);
  const allowed = (act: string, afterDark = rl.isAfterDark) =>
    evaluateDateActivityAllowed(act, rl.anyStrictSober, rl.anyNonDrinker, rl.anyLowWalking, rl.anyLowNoise ?? false, rl.anyDaytimeOnly, afterDark);

  const pickWith = (afterDark: boolean): string | undefined => {
    let shared: string | undefined, first: string | undefined;
    for (const activity of a.activities) {
      if (!allowed(activity, afterDark)) continue;
      first = preferredActivity(first, activity);
      if (b.activities.includes(activity)) shared = preferredActivity(shared, activity);
    }
    if (shared !== undefined) return shared;
    for (const activity of b.activities) {
      if (!allowed(activity, afterDark)) continue;
      first = preferredActivity(first, activity);
    }
    return first;
  };

  return pickWith(rl.isAfterDark) ?? (rl.isAfterDark && rl.anyDaytimeOnly ? pickWith(false) : undefined) ?? "coffee";
}

function revealedBodyPref(a: SlopProfile, type: string, shrinkN: number): number | undefined {
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

export function responsiveness(p: SlopProfile): number {
  const h = p.history;
  return (h.yes + 0.45 * 2) / (h.yes + h.no + h.silent + 2);
}
