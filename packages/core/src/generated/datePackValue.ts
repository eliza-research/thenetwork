// GENERATED from spec/datePackValue.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
export type DateGoal = "DateGoalCasual" | "DateGoalLongTerm" | "DateGoalUnsure" | "DateGoalUnstated";
/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
export type DateHabit = "DateHabitNever" | "DateHabitOccasional" | "DateHabitRegular" | "DateHabitUnstated";
/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
export type DateKids = "DateKidsYes" | "DateKidsNo" | "DateKidsOpen" | "DateKidsUnstated";
/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
export type DatePolitics = "DatePoliticsLeft" | "DatePoliticsRight" | "DatePoliticsMiddle" | "DatePoliticsUnstated";
/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
export interface DatePackAnswers { goal: DateGoal; smoking: DateHabit; drinking: DateHabit; religionImportance: number; politics: DatePolitics; hasKids: DateKids; wantsKids: DateKids }
/** Story: Value a first date from stated answers / Shared interests, the planned activity, logistics and body type give factors from fixed tables (spec/datePackValue.md) */
export type DateBodyFit = "DateBodyWanted" | "DateBodyNotWanted" | "DateBodyUnrated";
/** Story: Value a first date from stated answers / Shared interests, the planned activity, logistics and body type give factors from fixed tables (spec/datePackValue.md) */
export type DateSlots = "DateSlotsShared" | "DateSlotsApart" | "DateSlotsUnknown";
/** Story: Value a first date from stated answers / A measured factor counts only up to the seeker's ceiling (spec/datePackValue.md) */
export interface DatePackSeeker { answers: DatePackAnswers; statesDealbreakers: boolean; statesType: boolean; statesBodyPrefs: boolean; statesFreeSlots: boolean; tasteCeiling: number; bodyLearnedCeiling: number }
/** Story: Value a first date from stated answers / The factors multiply in a fixed order with a fixed rounding rule (spec/datePackValue.md) */
export interface DatePackFactors { goal: number; smoking: number; drinking: number; religion: number; politics: number; kids: number; unstated: number; hiddenSmoking: number; hiddenDrinking: number; hiddenHasKids: number; hiddenWantsKids: number; hiddenReligion: number; hiddenPolitics: number; interests: number; activity: number; typeFit: number; taste: number; slots: number; body: number; bodyLearned: number }
/** Story: Value a first date from stated answers / The directed pack value is the product of the factors of one pair (spec/datePackValue.md) */
export interface DatePackCheap { sharedInterests: number; typeFit: number; bodyFit: DateBodyFit; slots: DateSlots }
/** Story: Value a first date from stated answers / The directed pack value is the product of the factors of one pair (spec/datePackValue.md) */
export interface DatePackPair { cheap: DatePackCheap; activityMiss: boolean; taste: number; bodyLearned: number }
/** Story: Skip partners whose pack value cannot reach the floor / A partner class has a cap that is at least the pair bound of every partner in it (spec/datePackValue.md) */
export interface DatePackClass { goal: DateGoal; unstated: number }

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
export const datePackScale: number = 1000;
/** Story: Value a first date from stated answers / A measured factor counts only up to the seeker's ceiling (spec/datePackValue.md) */
export const datePackBoostMost: number = 3000;
/** Story: Value a first date from stated answers / A measured factor counts only up to the seeker's ceiling (spec/datePackValue.md) */
export const dateTypeCeiling: number = 1222;
/** Story: Value a first date from stated answers / The factors multiply in a fixed order with a fixed rounding rule (spec/datePackValue.md) */
export const datePackMicro: number = 1000000;
/** Story: Skip partners whose pack value cannot reach the floor / A partner class has a cap that is at least the pair bound of every partner in it (spec/datePackValue.md) */
export const datePackClassUnstatedMost: number = 3;

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
//@ pure
export function dateGoalFactor(own: DateGoal, other: DateGoal): number {
  return own === "DateGoalUnstated" || other === "DateGoalUnstated" ? 850 : ((own === "DateGoalCasual" && other === "DateGoalLongTerm") || (own === "DateGoalLongTerm" && other === "DateGoalCasual") ? 600 : (own !== other ? 850 : 1000));
}

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
//@ pure
export function dateHabitClash(own: DateHabit, other: DateHabit, clash: number): number {
  return (own === "DateHabitNever" && other === "DateHabitRegular") || (own === "DateHabitRegular" && other === "DateHabitNever") ? clash : 1000;
}

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
//@ pure
export function dateReligionClash(own: number, other: number): number {
  const local_0 = own > other ? exact_datePackValue(own - other) : exact_datePackValue(other - own);
  return own >= 0 && other >= 0 && local_0 >= 2 ? 850 : 1000;
}

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
//@ pure
export function datePoliticsClash(own: DatePolitics, other: DatePolitics): number {
  return (own === "DatePoliticsLeft" && other === "DatePoliticsRight") || (own === "DatePoliticsRight" && other === "DatePoliticsLeft") ? 750 : 1000;
}

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
//@ pure
export function dateKidsCounted(ownAnswers: DatePackAnswers): boolean {
  return ownAnswers.goal !== "DateGoalCasual";
}

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
//@ pure
export function dateKidsClash(ownAnswers: DatePackAnswers, partner: DatePackAnswers): number {
  return dateKidsCounted(ownAnswers) && ((ownAnswers.wantsKids === "DateKidsYes" && partner.wantsKids === "DateKidsNo") || (ownAnswers.wantsKids === "DateKidsNo" && partner.wantsKids === "DateKidsYes")) ? 700 : 1000;
}

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
//@ pure
export function dateUnstatedCount(ownAnswers: DatePackAnswers, partner: DatePackAnswers): number {
  return exact_datePackValue(exact_datePackValue(exact_datePackValue(exact_datePackValue((ownAnswers.smoking === "DateHabitUnstated" || partner.smoking === "DateHabitUnstated" ? 1 : 0) + (ownAnswers.drinking === "DateHabitUnstated" || partner.drinking === "DateHabitUnstated" ? 1 : 0)) + (ownAnswers.religionImportance < 0 || partner.religionImportance < 0 ? 1 : 0)) + (ownAnswers.politics === "DatePoliticsUnstated" || partner.politics === "DatePoliticsUnstated" ? 1 : 0)) + (dateKidsCounted(ownAnswers) && (ownAnswers.wantsKids === "DateKidsUnstated" || partner.wantsKids === "DateKidsUnstated") ? 1 : 0));
}

/** Story: Value a first date from stated answers / Each stated answer gives a factor from a fixed table (spec/datePackValue.md) */
//@ pure
export function dateUnstatedFactor(count: number): number {
  return count <= 0 ? 1000 : (count === 1 ? 970 : (count === 2 ? 941 : (count === 3 ? 913 : (count === 4 ? 885 : 859))));
}

/** Story: Value a first date from stated answers / A partner's answer that is often a dealbreaker counts when the seeker stated no dealbreakers (spec/datePackValue.md) */
//@ pure
export function dateHiddenSmoking(ownAnswers: DatePackAnswers, partner: DatePackAnswers): number {
  return partner.smoking === "DateHabitRegular" && (ownAnswers.smoking === "DateHabitNever" || ownAnswers.smoking === "DateHabitUnstated") ? 720 : 1000;
}

/** Story: Value a first date from stated answers / A partner's answer that is often a dealbreaker counts when the seeker stated no dealbreakers (spec/datePackValue.md) */
//@ pure
export function dateHiddenDrinking(ownAnswers: DatePackAnswers, partner: DatePackAnswers): number {
  return partner.drinking === "DateHabitRegular" && ownAnswers.drinking !== "DateHabitRegular" ? 877 : 1000;
}

/** Story: Value a first date from stated answers / A partner's answer that is often a dealbreaker counts when the seeker stated no dealbreakers (spec/datePackValue.md) */
//@ pure
export function dateHiddenHasKids(ownAnswers: DatePackAnswers, partner: DatePackAnswers): number {
  return partner.hasKids === "DateKidsYes" && ownAnswers.hasKids !== "DateKidsYes" ? 906 : 1000;
}

/** Story: Value a first date from stated answers / A partner's answer that is often a dealbreaker counts when the seeker stated no dealbreakers (spec/datePackValue.md) */
//@ pure
export function dateHiddenWantsKids(ownAnswers: DatePackAnswers, partner: DatePackAnswers): number {
  return (partner.wantsKids === "DateKidsYes" && ownAnswers.wantsKids === "DateKidsNo") || (partner.wantsKids === "DateKidsNo" && ownAnswers.wantsKids === "DateKidsYes") ? 720 : 1000;
}

/** Story: Value a first date from stated answers / A partner's answer that is often a dealbreaker counts when the seeker stated no dealbreakers (spec/datePackValue.md) */
//@ pure
export function dateHiddenReligion(ownAnswers: DatePackAnswers, partner: DatePackAnswers): number {
  return ownAnswers.religionImportance < 0 || partner.religionImportance < 0 ? 1000 : (partner.religionImportance >= 2 && ownAnswers.religionImportance === 0 ? 877 : (partner.religionImportance === 0 && ownAnswers.religionImportance >= 2 ? 720 : 1000));
}

/** Story: Value a first date from stated answers / A partner's answer that is often a dealbreaker counts when the seeker stated no dealbreakers (spec/datePackValue.md) */
//@ pure
export function dateHiddenPolitics(ownAnswers: DatePackAnswers, partner: DatePackAnswers): number {
  return (partner.politics === "DatePoliticsRight" && ownAnswers.politics === "DatePoliticsLeft") || (partner.politics === "DatePoliticsLeft" && ownAnswers.politics === "DatePoliticsRight") ? 720 : 1000;
}

/** Story: Value a first date from stated answers / Shared interests, the planned activity, logistics and body type give factors from fixed tables (spec/datePackValue.md) */
//@ pure
export function dateInterestFactor(shared: number): number {
  return shared <= 0 ? 880 : (shared === 1 ? 950 : 1000);
}

/** Story: Value a first date from stated answers / Shared interests, the planned activity, logistics and body type give factors from fixed tables (spec/datePackValue.md) */
//@ pure
export function dateActivityFactor(activityMiss: boolean): number {
  return activityMiss ? 920 : 1000;
}

/** Story: Value a first date from stated answers / Shared interests, the planned activity, logistics and body type give factors from fixed tables (spec/datePackValue.md) */
//@ pure
export function dateSlotsFactor(statesFreeSlots: boolean, slots: DateSlots): number {
  return !statesFreeSlots ? 900 : (slots === "DateSlotsShared" ? 1000 : (slots === "DateSlotsApart" ? 750 : 900));
}

/** Story: Value a first date from stated answers / Shared interests, the planned activity, logistics and body type give factors from fixed tables (spec/datePackValue.md) */
//@ pure
export function dateBodyFactor(statesBodyPrefs: boolean, bodyFit: DateBodyFit): number {
  return !statesBodyPrefs ? 1000 : (bodyFit === "DateBodyWanted" ? 1350 : (bodyFit === "DateBodyNotWanted" ? 741 : 1000));
}

/** Story: Value a first date from stated answers / A measured factor counts only up to the seeker's ceiling (spec/datePackValue.md) */
//@ pure
export function datePackBoostTop(ceiling: number): number {
  return ceiling < 0 ? 0 : (ceiling > datePackBoostMost ? datePackBoostMost : ceiling);
}

/** Story: Value a first date from stated answers / A measured factor counts only up to the seeker's ceiling (spec/datePackValue.md) */
//@ pure
export function datePackBoost(factor: number, ceiling: number): number {
  const local_1 = datePackBoostTop(ceiling);
  return factor < 0 ? 0 : (factor > local_1 ? local_1 : factor);
}

/** Story: Value a first date from stated answers / A measured factor counts only up to the seeker's ceiling (spec/datePackValue.md) */
//@ pure
export function dateTypeTop(seeker: DatePackSeeker): number {
  return seeker.statesType ? dateTypeCeiling : datePackScale;
}

/** Story: Value a first date from stated answers / A measured factor counts only up to the seeker's ceiling (spec/datePackValue.md) */
//@ pure
export function dateBodyLearnedTop(seeker: DatePackSeeker): number {
  return seeker.statesBodyPrefs ? datePackScale : datePackBoostTop(seeker.bodyLearnedCeiling);
}

/** Story: Value a first date from stated answers / A measured factor counts only up to the seeker's ceiling (spec/datePackValue.md) */
//@ pure
export function dateBodyLearnedFactor(seeker: DatePackSeeker, bodyLearned: number): number {
  return seeker.statesBodyPrefs ? datePackScale : datePackBoost(bodyLearned, seeker.bodyLearnedCeiling);
}

/** Story: Value a first date from stated answers / The factors multiply in a fixed order with a fixed rounding rule (spec/datePackValue.md) */
//@ pure
export function datePackTimes(running: number, factor: number): number {
  const local_2 = factor > 0 ? factor : 0;
  return quotient_datePackValue(exact_datePackValue(running * local_2), datePackScale);
}

/** Story: Value a first date from stated answers / The factors multiply in a fixed order with a fixed rounding rule (spec/datePackValue.md) */
//@ pure
export function datePackProduct(factors: DatePackFactors): number {
  const local_3 = datePackTimes(datePackMicro, factors.goal);
  const local_4 = datePackTimes(local_3, factors.smoking);
  const local_5 = datePackTimes(local_4, factors.drinking);
  const local_6 = datePackTimes(local_5, factors.religion);
  const local_7 = datePackTimes(local_6, factors.politics);
  const local_8 = datePackTimes(local_7, factors.kids);
  const local_9 = datePackTimes(local_8, factors.unstated);
  const local_10 = datePackTimes(local_9, factors.hiddenSmoking);
  const local_11 = datePackTimes(local_10, factors.hiddenDrinking);
  const local_12 = datePackTimes(local_11, factors.hiddenHasKids);
  const local_13 = datePackTimes(local_12, factors.hiddenWantsKids);
  const local_14 = datePackTimes(local_13, factors.hiddenReligion);
  const local_15 = datePackTimes(local_14, factors.hiddenPolitics);
  const local_16 = datePackTimes(local_15, factors.interests);
  const local_17 = datePackTimes(local_16, factors.activity);
  const local_18 = datePackTimes(local_17, factors.typeFit);
  const local_19 = datePackTimes(local_18, factors.taste);
  const local_20 = local_19 > datePackMicro ? datePackMicro : local_19;
  const local_21 = datePackTimes(local_20, factors.slots);
  const local_22 = datePackTimes(local_21, factors.body);
  const local_23 = datePackTimes(local_22, factors.bodyLearned);
  const local_24 = quotient_datePackValue(exact_datePackValue(local_23 + quotient_datePackValue(datePackScale, 2)), datePackScale);
  return local_24 > datePackScale ? datePackScale : local_24;
}

/** Story: Value a first date from stated answers / The factors multiply in a fixed order with a fixed rounding rule (spec/datePackValue.md) */
//@ pure
export function datePackFactorsAtMost(lower: DatePackFactors, upper: DatePackFactors): boolean {
  return lower.goal <= upper.goal && lower.smoking <= upper.smoking && lower.drinking <= upper.drinking && lower.religion <= upper.religion && lower.politics <= upper.politics && lower.kids <= upper.kids && lower.unstated <= upper.unstated && lower.hiddenSmoking <= upper.hiddenSmoking && lower.hiddenDrinking <= upper.hiddenDrinking && lower.hiddenHasKids <= upper.hiddenHasKids && lower.hiddenWantsKids <= upper.hiddenWantsKids && lower.hiddenReligion <= upper.hiddenReligion && lower.hiddenPolitics <= upper.hiddenPolitics && lower.interests <= upper.interests && lower.activity <= upper.activity && lower.typeFit <= upper.typeFit && lower.taste <= upper.taste && lower.slots <= upper.slots && lower.body <= upper.body && lower.bodyLearned <= upper.bodyLearned;
}

/** Story: Value a first date from stated answers / The factors multiply in a fixed order with a fixed rounding rule (spec/datePackValue.md) */
//@ pure
export function lawDatePackProductBounded(lower: DatePackFactors): boolean {
  //@ ensures \result === true
  const local_25 = datePackProduct(lower);
  return 0 <= local_25 && local_25 <= datePackScale;
}

/** Story: Value a first date from stated answers / The factors multiply in a fixed order with a fixed rounding rule (spec/datePackValue.md) */
//@ pure
export function lawDatePackProductMonotone(lower: DatePackFactors, upper: DatePackFactors): boolean {
  //@ ensures \result === true
  return !datePackFactorsAtMost(lower, upper) || datePackProduct(lower) <= datePackProduct(upper);
}

/** Story: Value a first date from stated answers / The directed pack value is the product of the factors of one pair (spec/datePackValue.md) */
//@ pure
export function datePackAnswerFactors(seeker: DatePackSeeker, partner: DatePackAnswers, cheap: DatePackCheap): DatePackFactors {
  const local_26: DatePackAnswers = seeker.answers;
  const local_27 = !seeker.statesDealbreakers;
  return { goal: dateGoalFactor(local_26.goal, partner.goal), smoking: dateHabitClash(local_26.smoking, partner.smoking, 800), drinking: dateHabitClash(local_26.drinking, partner.drinking, 850), religion: dateReligionClash(local_26.religionImportance, partner.religionImportance), politics: datePoliticsClash(local_26.politics, partner.politics), kids: dateKidsClash(local_26, partner), unstated: dateUnstatedFactor(dateUnstatedCount(local_26, partner)), hiddenSmoking: local_27 ? dateHiddenSmoking(local_26, partner) : 1000, hiddenDrinking: local_27 ? dateHiddenDrinking(local_26, partner) : 1000, hiddenHasKids: local_27 ? dateHiddenHasKids(local_26, partner) : 1000, hiddenWantsKids: local_27 ? dateHiddenWantsKids(local_26, partner) : 1000, hiddenReligion: local_27 ? dateHiddenReligion(local_26, partner) : 1000, hiddenPolitics: local_27 ? dateHiddenPolitics(local_26, partner) : 1000, interests: dateInterestFactor(cheap.sharedInterests), activity: 1000, typeFit: datePackBoost(cheap.typeFit, dateTypeTop(seeker)), taste: datePackBoostTop(seeker.tasteCeiling), slots: dateSlotsFactor(seeker.statesFreeSlots, cheap.slots), body: dateBodyFactor(seeker.statesBodyPrefs, cheap.bodyFit), bodyLearned: dateBodyLearnedTop(seeker) };
}

/** Story: Value a first date from stated answers / The directed pack value is the product of the factors of one pair (spec/datePackValue.md) */
//@ pure
export function datePackPairFactors(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair): DatePackFactors {
  const local_28: DatePackFactors = datePackAnswerFactors(seeker, partner, pair.cheap);
  return { ...local_28, activity: dateActivityFactor(pair.activityMiss), taste: datePackBoost(pair.taste, seeker.tasteCeiling), bodyLearned: dateBodyLearnedFactor(seeker, pair.bodyLearned) };
}

/** Story: Value a first date from stated answers / The directed pack value is the product of the factors of one pair (spec/datePackValue.md) */
//@ pure
export function datePackValue(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair): number {
  return datePackProduct(datePackPairFactors(seeker, partner, pair));
}

/** Story: Value a first date from stated answers / The directed pack value is the product of the factors of one pair (spec/datePackValue.md) */
//@ pure
export function lawDatePackValueBounded(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair): boolean {
  //@ ensures \result === true
  const local_29 = datePackValue(seeker, partner, pair);
  return 0 <= local_29 && local_29 <= datePackScale;
}

/** Story: Skip partners whose pack value cannot reach the floor / The pair bound needs only the cheap pair inputs and is at least the pack value (spec/datePackValue.md) */
//@ pure
export function datePackPairBound(seeker: DatePackSeeker, partner: DatePackAnswers, cheap: DatePackCheap): number {
  return datePackProduct(datePackAnswerFactors(seeker, partner, cheap));
}

/** Story: Skip partners whose pack value cannot reach the floor / The pair bound needs only the cheap pair inputs and is at least the pack value (spec/datePackValue.md) */
//@ pure
export function lawDatePackPairBound(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair): boolean {
  //@ ensures \result === true
  return datePackValue(seeker, partner, pair) <= datePackPairBound(seeker, partner, pair.cheap);
}

/** Story: Skip partners whose pack value cannot reach the floor / A partner class has a cap that is at least the pair bound of every partner in it (spec/datePackValue.md) */
//@ pure
export function datePackPartnerUnstated(partner: DatePackAnswers): number {
  return exact_datePackValue(exact_datePackValue(exact_datePackValue((partner.smoking === "DateHabitUnstated" ? 1 : 0) + (partner.drinking === "DateHabitUnstated" ? 1 : 0)) + (partner.religionImportance < 0 ? 1 : 0)) + (partner.politics === "DatePoliticsUnstated" ? 1 : 0));
}

/** Story: Skip partners whose pack value cannot reach the floor / A partner class has a cap that is at least the pair bound of every partner in it (spec/datePackValue.md) */
//@ pure
export function datePackClassOf(partner: DatePackAnswers): DatePackClass {
  const local_30 = datePackPartnerUnstated(partner);
  return { goal: partner.goal, unstated: local_30 > datePackClassUnstatedMost ? datePackClassUnstatedMost : local_30 };
}

/** Story: Skip partners whose pack value cannot reach the floor / A partner class has a cap that is at least the pair bound of every partner in it (spec/datePackValue.md) */
//@ pure
export function dateSeekerUnstated(ownAnswers: DatePackAnswers): number {
  return exact_datePackValue(exact_datePackValue(exact_datePackValue(exact_datePackValue((ownAnswers.smoking === "DateHabitUnstated" ? 1 : 0) + (ownAnswers.drinking === "DateHabitUnstated" ? 1 : 0)) + (ownAnswers.religionImportance < 0 ? 1 : 0)) + (ownAnswers.politics === "DatePoliticsUnstated" ? 1 : 0)) + (dateKidsCounted(ownAnswers) && ownAnswers.wantsKids === "DateKidsUnstated" ? 1 : 0));
}

/** Story: Skip partners whose pack value cannot reach the floor / A partner class has a cap that is at least the pair bound of every partner in it (spec/datePackValue.md) */
//@ pure
export function datePackClassCap(seeker: DatePackSeeker, partnerClass: DatePackClass, untouched: boolean): number {
  const local_31 = dateSeekerUnstated(seeker.answers);
  const local_32 = local_31 > partnerClass.unstated ? local_31 : partnerClass.unstated;
  return datePackProduct(({ goal: dateGoalFactor(seeker.answers.goal, partnerClass.goal), smoking: 1000, drinking: 1000, religion: 1000, politics: 1000, kids: 1000, unstated: dateUnstatedFactor(local_32), hiddenSmoking: 1000, hiddenDrinking: 1000, hiddenHasKids: 1000, hiddenWantsKids: 1000, hiddenReligion: 1000, hiddenPolitics: 1000, interests: untouched ? dateInterestFactor(0) : 1000, activity: 1000, typeFit: dateTypeTop(seeker), taste: datePackBoostTop(seeker.tasteCeiling), slots: untouched || !seeker.statesFreeSlots ? 900 : 1000, body: seeker.statesBodyPrefs ? 1350 : 1000, bodyLearned: dateBodyLearnedTop(seeker) } as DatePackFactors));
}

/** Story: Skip partners whose pack value cannot reach the floor / A partner class has a cap that is at least the pair bound of every partner in it (spec/datePackValue.md) */
//@ pure
export function lawDatePackClassCap(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair, untouched: boolean): boolean {
  //@ ensures \result === true
  const local_33 = datePackClassCap(seeker, datePackClassOf(partner), untouched);
  return !(!untouched || (pair.cheap.sharedInterests <= 0 && pair.cheap.slots !== "DateSlotsShared")) || (datePackPairBound(seeker, partner, pair.cheap) <= local_33 && datePackValue(seeker, partner, pair) <= local_33);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_datePackValue(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_datePackValue(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
