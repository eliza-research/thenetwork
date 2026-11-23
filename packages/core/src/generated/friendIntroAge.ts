// GENERATED from spec/friendIntroAge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type FractionalAgeEvidence as memberAge_FractionalAgeEvidence, type BirthReadings as memberAge_BirthReadings, minMemberAge as memberAge_minMemberAge, minLooseHeightAge as memberAge_minLooseHeightAge, minLooseTeamAge as memberAge_minLooseTeamAge, maxAge as memberAge_maxAge, dayKeyYear as memberAge_dayKeyYear, earliestBirthKey as memberAge_earliestBirthKey, adultAge as memberAge_adultAge, ageInRange as memberAge_ageInRange, ageConjunctionAllowed as memberAge_ageConjunctionAllowed, lowerAge as memberAge_lowerAge, ageOnDay as memberAge_ageOnDay, statedAgeLower as memberAge_statedAgeLower, statedAgeUpper as memberAge_statedAgeUpper, birthDateLower as memberAge_birthDateLower, laterBirthKey as memberAge_laterBirthKey, readingsConflict as memberAge_readingsConflict, recordedChatAge as memberAge_recordedChatAge, lawDeclineKeepsStatedAge as memberAge_lawDeclineKeepsStatedAge, joinableAge as memberAge_joinableAge, lawSmallSportsRecordsDoNotSupplyAge as memberAge_lawSmallSportsRecordsDoNotSupplyAge, lawSmallTeamResultsDoNotSupplyAge as memberAge_lawSmallTeamResultsDoNotSupplyAge, lawStatedBirthdaySurvivesSportsContext as memberAge_lawStatedBirthdaySurvivesSportsContext, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, birthKeyUsable as memberAge_birthKeyUsable, lawBirthdayAddsOneYear as memberAge_lawBirthdayAddsOneYear, lawLeapDayBirthdayCountsFromMarchFirst as memberAge_lawLeapDayBirthdayCountsFromMarchFirst, matchableAge as memberAge_matchableAge, legacyReading as memberAge_legacyReading, lawStatedAgeReadsBack as memberAge_lawStatedAgeReadsBack, mergeReading as memberAge_mergeReading, effectiveBirthKey as memberAge_effectiveBirthKey, birthDateExact as memberAge_birthDateExact, confirmedUnderage as memberAge_confirmedUnderage, lawOlderClaimNeverUnlocksAdult as memberAge_lawOlderClaimNeverUnlocksAdult, lawFloorTwelveRefusesAdultBirthDate as memberAge_lawFloorTwelveRefusesAdultBirthDate, fractionalAgeEvidence as memberAge_fractionalAgeEvidence, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawBirthKeyUsableIsHuman as memberAge_lawBirthKeyUsableIsHuman, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge, effectiveAge as memberAge_effectiveAge, lawLaterBirthDateWins as memberAge_lawLaterBirthDateWins, lawAgreeingAgeKeepsTheBirthDateExact as memberAge_lawAgreeingAgeKeepsTheBirthDateExact, lawConflictIsPermanent as memberAge_lawConflictIsPermanent, lawMergeKeepsYoungest as memberAge_lawMergeKeepsYoungest, lawMergeKeepsWellFormed as memberAge_lawMergeKeepsWellFormed, lawLegacyMinorKeepsMinorAge as memberAge_lawLegacyMinorKeepsMinorAge, underageCleanupRequired as memberAge_underageCleanupRequired, textUseAllowedAtAge as memberAge_textUseAllowedAtAge, lawAnUpcomingFractionalAgeSuppliesNoCurrentAge as memberAge_lawAnUpcomingFractionalAgeSuppliesNoCurrentAge, lawAFractionalAgeNeedsAgeWordsToBeExplicit as memberAge_lawAFractionalAgeNeedsAgeWordsToBeExplicit, lawPossibleHeightRequiresAgeWords as memberAge_lawPossibleHeightRequiresAgeWords, lawExplicitCurrentFractionalAgeIsAccepted as memberAge_lawExplicitCurrentFractionalAgeIsAccepted, lawUnderageMonthOrQuarterNeedsAgeWords as memberAge_lawUnderageMonthOrQuarterNeedsAgeWords, lawLowerStatedAgeWins as memberAge_lawLowerStatedAgeWins, lawUnderageCleanupNeedsAConfirmedAge as memberAge_lawUnderageCleanupNeedsAConfirmedAge, lawConfirmedUnderageCannotRestart as memberAge_lawConfirmedUnderageCannotRestart } from "./memberAge.ts";

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
export interface AgeSide { adult: boolean; ready: boolean; birthKey: number }

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor is small (spec/friendIntroAge.md) */
export const teenRosterMaximum: number = 6;
/** Story: Introduce a minor for friendship only to people close in age / A teen partner is 13 to 18 on every day of the introduction (spec/friendIntroAge.md) */
export const teenFriendMinAge: number = 13;
/** Story: Introduce a minor for friendship only to people close in age / Two teen birth dates are at most 2 calendar years apart (spec/friendIntroAge.md) */
export const teenBirthGap: number = 20000;
/** Story: Introduce a minor for friendship only to people close in age / A teen partner is 13 to 18 on every day of the introduction (spec/friendIntroAge.md) */
export const teenFriendMaxAge: number = 18;

/** Story: Introduce a minor for friendship only to people close in age / A teen partner is 13 to 18 on every day of the introduction (spec/friendIntroAge.md) */
//@ pure
export function teenAgesOk(birthKey: number, minDay: number, maxDay: number): boolean {
  return memberAge_ageOnDay(birthKey, minDay) >= teenFriendMinAge && memberAge_ageOnDay(birthKey, maxDay) <= teenFriendMaxAge;
}

/** Story: Introduce a minor for friendship only to people close in age / A teen partner is 13 to 18 on every day of the introduction (spec/friendIntroAge.md) */
//@ pure
export function teenPartnerAge(birthKey: number, minDay: number, maxDay: number): boolean {
  return teenAgesOk(birthKey, minDay, maxDay);
}

/** Story: Introduce a minor for friendship only to people close in age / Two teen birth dates are at most 2 calendar years apart (spec/friendIntroAge.md) */
//@ pure
export function birthKeysWithinTwoYears(firstKey: number, secondKey: number): boolean {
  return firstKey >= secondKey ? exact_friendIntroAge(firstKey - secondKey) <= teenBirthGap : exact_friendIntroAge(secondKey - firstKey) <= teenBirthGap;
}

/** Story: Introduce a minor for friendship only to people close in age / Only a teen-ready person enters a teen introduction (spec/friendIntroAge.md) */
//@ pure
export function teenReady(birthExact: boolean, ageConflict: boolean, minorSignalOpen: boolean, minorReported: boolean, olderReported: boolean, barred: boolean): boolean {
  return birthExact && !ageConflict && !minorSignalOpen && !minorReported && !olderReported && !barred;
}

/** Story: Introduce a minor for friendship only to people close in age / Only a teen-ready person enters a teen introduction (spec/friendIntroAge.md) */
//@ pure
export function teenBarOnConflict(conflict: boolean, youngestMaxAge: number): boolean {
  return conflict && youngestMaxAge <= teenFriendMaxAge;
}

/** Story: Introduce a minor for friendship only to people close in age / Only a teen-ready person enters a teen introduction (spec/friendIntroAge.md) */
//@ pure
export function lawTeenReadyNeedsExactBirthDate(ageConflict: boolean, minorSignalOpen: boolean, minorReported: boolean, olderReported: boolean, barred: boolean): boolean {
  //@ ensures \result === true
  return !teenReady(false, ageConflict, minorSignalOpen, minorReported, olderReported, barred);
}

/** Story: Introduce a minor for friendship only to people close in age / Only a teen-ready person enters a teen introduction (spec/friendIntroAge.md) */
//@ pure
export function lawTeenReadyWithoutStaffStep(birthExact: boolean): boolean {
  //@ ensures \result === true
  return !birthExact || teenReady(birthExact, false, false, false, false, false);
}

/** Story: Introduce a minor for friendship only to people close in age / Only a teen-ready person enters a teen introduction (spec/friendIntroAge.md) */
//@ pure
export function lawAnyDoubtMakesUnready(birthExact: boolean, ageConflict: boolean, minorSignalOpen: boolean, minorReported: boolean, olderReported: boolean, barred: boolean): boolean {
  //@ ensures \result === true
  return !teenReady(birthExact, ageConflict, minorSignalOpen, minorReported, olderReported, barred) || !(ageConflict || minorSignalOpen || minorReported || olderReported || barred);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function teenPairAllowed(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstReady: boolean, firstKey: number, secondReady: boolean, secondKey: number): boolean {
  return teenIntros && friendshipLane && firstReady && secondReady && teenAgesOk(firstKey, minDay, maxDay) && teenAgesOk(secondKey, minDay, maxDay) && (memberAge_ageOnDay(firstKey, minDay) < memberAge_adultAge || memberAge_ageOnDay(secondKey, minDay) < memberAge_adultAge) && birthKeysWithinTwoYears(firstKey, secondKey);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function pairAgeAllowed(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  return (firstAdult && secondAdult) || teenPairAllowed(teenIntros, friendshipLane, minDay, maxDay, firstReady, firstKey, secondReady, secondKey);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawTeenPairWitness(teenIntros: boolean): boolean {
  //@ ensures \result === true
  return !teenIntros || teenPairAllowed(teenIntros, true, 20261122, 20261122, true, 20100315, true, 20120315);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawNineteenEdgeRefused(friendshipLane: boolean): boolean {
  //@ ensures \result === true
  return !teenPairAllowed(true, friendshipLane, 20261121, 20261122, true, 20071122, true, 20091122);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function sidesAllowed(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, first: AgeSide, second: AgeSide): boolean {
  return pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, first.adult, first.ready, first.birthKey, second.adult, second.ready, second.birthKey);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawAdultPairUnchanged(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  //@ ensures \result === true
  return !(firstAdult && secondAdult) || pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawSwitchOffIsTheAdultRule(friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  //@ ensures \result === true
  return pairAgeAllowed(false, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey) === (firstAdult && secondAdult);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawMinorPairOnlyInFriendshipLanes(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  //@ ensures \result === true
  return !(pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey) && !(firstAdult && secondAdult)) || (teenIntros && friendshipLane);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawMinorPartnerIsThirteenToEighteen(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  //@ ensures \result === true
  return !(pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey) && !(firstAdult && secondAdult)) || (memberAge_ageOnDay(firstKey, minDay) >= 13 && memberAge_ageOnDay(secondKey, minDay) >= 13 && memberAge_ageOnDay(firstKey, maxDay) <= 18 && memberAge_ageOnDay(secondKey, maxDay) <= 18);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawNineteenNeverWithAMinor(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  //@ ensures \result === true
  return !(memberAge_ageOnDay(firstKey, maxDay) >= 19 && !secondAdult) || !pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawMinorPairWithinTwoYears(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  //@ ensures \result === true
  return !(pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey) && !(firstAdult && secondAdult)) || birthKeysWithinTwoYears(firstKey, secondKey);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawMinorPairNeedsReadySides(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  //@ ensures \result === true
  return !(pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey) && !(firstAdult && secondAdult)) || (firstReady && secondReady);
}

/** Story: Introduce a minor for friendship only to people close in age / A pair with a minor needs the switch, a friendship lane and the age rule (spec/friendIntroAge.md) */
//@ pure
export function lawPairAgeSymmetric(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, firstAdult: boolean, firstReady: boolean, firstKey: number, secondAdult: boolean, secondReady: boolean, secondKey: number): boolean {
  //@ ensures \result === true
  return pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey) === pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, secondAdult, secondReady, secondKey, firstAdult, firstReady, firstKey);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds only people who pass the pair rule with every member (spec/friendIntroAge.md) */
//@ pure
export function rosterHasMinor(members: AgeSide[]): boolean {
  return members.some((side: AgeSide) => !side.adult);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds only people who pass the pair rule with every member (spec/friendIntroAge.md) */
//@ pure
export function viaAllowedForRoster(members: AgeSide[]): boolean {
  return !rosterHasMinor(members);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds only people who pass the pair rule with every member (spec/friendIntroAge.md) */
//@ pure
export function lawViaNeverWithAMinor(roster: AgeSide[]): boolean {
  //@ ensures \result === true
  return !rosterHasMinor(roster) || !viaAllowedForRoster(roster);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds only people who pass the pair rule with every member (spec/friendIntroAge.md) */
//@ pure
export function sideAllowedWithAll(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, first: AgeSide, members: AgeSide[]): boolean {
  return !members.some((second: AgeSide) => !sidesAllowed(teenIntros, friendshipLane, minDay, maxDay, first, second));
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds only people who pass the pair rule with every member (spec/friendIntroAge.md) */
//@ pure
export function groupAgeAllowed(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, members: AgeSide[]): boolean {
  return !members.some((first: AgeSide) => !sideAllowedWithAll(teenIntros, friendshipLane, minDay, maxDay, first, members));
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds only people who pass the pair rule with every member (spec/friendIntroAge.md) */
//@ pure
export function lawGroupWithMinorHoldsOnlyTeenAges(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, roster: AgeSide[]): boolean {
  //@ ensures \result === true
  return !(groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) && rosterHasMinor(roster)) || !roster.some((side: AgeSide) => !(side.ready && teenAgesOk(side.birthKey, minDay, maxDay)));
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds only people who pass the pair rule with every member (spec/friendIntroAge.md) */
//@ pure
export function lawGroupSwitchOffAdultsOnly(friendshipLane: boolean, minDay: number, maxDay: number, roster: AgeSide[]): boolean {
  //@ ensures \result === true
  return groupAgeAllowed(false, friendshipLane, minDay, maxDay, roster) === !roster.some((side: AgeSide) => !side.adult);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds nobody aged 19 or more and keeps every minor within 2 years of everyone (spec/friendIntroAge.md) */
//@ pure
export function teenSideFits(side: AgeSide, minDay: number, maxDay: number): boolean {
  return side.ready && teenAgesOk(side.birthKey, minDay, maxDay);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds nobody aged 19 or more and keeps every minor within 2 years of everyone (spec/friendIntroAge.md) */
//@ pure
export function lawGroupNineteenNeverWithAMinor(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, roster: AgeSide[]): boolean {
  //@ ensures \result === true
  return !(groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) && rosterHasMinor(roster)) || !roster.some((side: AgeSide) => !(memberAge_ageOnDay(side.birthKey, maxDay) <= teenFriendMaxAge));
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds nobody aged 19 or more and keeps every minor within 2 years of everyone (spec/friendIntroAge.md) */
//@ pure
export function lawGroupMinorWithinTwoYearsOfEveryone(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, roster: AgeSide[]): boolean {
  //@ ensures \result === true
  return !(groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) && rosterHasMinor(roster)) || !roster.some((first: AgeSide) => !(first.adult || !roster.some((second: AgeSide) => !birthKeysWithinTwoYears(first.birthKey, second.birthKey))));
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor holds nobody aged 19 or more and keeps every minor within 2 years of everyone (spec/friendIntroAge.md) */
//@ pure
export function lawGroupWithMinorEverySideFits(teenIntros: boolean, friendshipLane: boolean, minDay: number, maxDay: number, roster: AgeSide[]): boolean {
  //@ ensures \result === true
  return !(groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) && rosterHasMinor(roster)) || !roster.some((side: AgeSide) => !teenSideFits(side, minDay, maxDay));
}

/** Story: Introduce a minor for friendship only to people close in age / A teen introduction has the shape of a friendship meeting (spec/friendIntroAge.md) */
//@ pure
export function teenFriendRole(role: string): boolean {
  return role === "peer" || role === "guest";
}

/** Story: Introduce a minor for friendship only to people close in age / A teen introduction has the shape of a friendship meeting (spec/friendIntroAge.md) */
//@ pure
export function teenFriendFormat(format: string): boolean {
  return format === "one_to_one" || format === "small_group";
}

/** Story: Introduce a minor for friendship only to people close in age / A teen introduction has the shape of a friendship meeting (spec/friendIntroAge.md) */
//@ pure
export function teenIntroShape(friendshipLane: boolean, format: string, everyRoleTeen: boolean, hasVia: boolean, eventAnchored: boolean): boolean {
  return friendshipLane && teenFriendFormat(format) && everyRoleTeen && !hasVia && !eventAnchored;
}

/** Story: Introduce a minor for friendship only to people close in age / A teen introduction has the shape of a friendship meeting (spec/friendIntroAge.md) */
//@ pure
export function lawContributorRolesAreNotTeenRoles(role: string): boolean {
  //@ ensures \result === true
  return !(role === "host" || role === "helper" || role === "provider" || role === "connector" || role === "newcomer" || role === "attendee" || role === "seeker" || role === "initiator") || !teenFriendRole(role);
}

/** Story: Introduce a minor for friendship only to people close in age / A teen introduction has the shape of a friendship meeting (spec/friendIntroAge.md) */
//@ pure
export function lawTeenShapeNeedsFriendshipLane(format: string, everyRoleTeen: boolean, hasVia: boolean, eventAnchored: boolean): boolean {
  //@ ensures \result === true
  return !teenIntroShape(false, format, everyRoleTeen, hasVia, eventAnchored);
}

/** Story: Introduce a minor for friendship only to people close in age / A teen introduction has the shape of a friendship meeting (spec/friendIntroAge.md) */
//@ pure
export function lawTeenShapeNeverAnEvent(friendshipLane: boolean, everyRoleTeen: boolean, hasVia: boolean, eventAnchored: boolean): boolean {
  //@ ensures \result === true
  return !teenIntroShape(friendshipLane, "event", everyRoleTeen, hasVia, eventAnchored) && !teenIntroShape(friendshipLane, "small_group", everyRoleTeen, hasVia, true);
}

/** Story: Introduce a minor for friendship only to people close in age / A teen introduction has the shape of a friendship meeting (spec/friendIntroAge.md) */
//@ pure
export function lawTeenShapeNeverVia(friendshipLane: boolean, format: string, everyRoleTeen: boolean, eventAnchored: boolean): boolean {
  //@ ensures \result === true
  return !teenIntroShape(friendshipLane, format, everyRoleTeen, true, eventAnchored);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor is small (spec/friendIntroAge.md) */
//@ pure
export function teenRosterSizeAllowed(hasMinor: boolean, rosterSize: number): boolean {
  return !hasMinor || (rosterSize >= 2 && rosterSize <= teenRosterMaximum);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor is small (spec/friendIntroAge.md) */
//@ pure
export function lawTeenRosterIsSmall(rosterSize: number): boolean {
  //@ ensures \result === true
  return !teenRosterSizeAllowed(true, rosterSize) || (rosterSize >= 2 && rosterSize <= teenRosterMaximum);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor is small (spec/friendIntroAge.md) */
//@ pure
export function lawAdultRosterSizeUnchanged(rosterSize: number): boolean {
  //@ ensures \result === true
  return teenRosterSizeAllowed(false, rosterSize);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function teenPlaceAllowed(hasMinor: boolean, hasActivity: boolean, activityAllAges: boolean, venueAllAges: boolean): boolean {
  return !hasMinor || (venueAllAges && (!hasActivity || activityAllAges));
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function allAgesMarkValid(allAges: boolean, ageMin: number, riskLow: boolean, adultPlace: boolean): boolean {
  return !allAges || (ageMin <= teenFriendMinAge && riskLow && !adultPlace);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function teenActivityOffered(hasMinor: boolean, allAges: boolean, adultPlans: boolean): boolean {
  return hasMinor ? allAges : adultPlans;
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function lawTeenPlaceIsAllAges(hasActivity: boolean, activityAllAges: boolean, venueAllAges: boolean): boolean {
  //@ ensures \result === true
  return !teenPlaceAllowed(true, hasActivity, activityAllAges, venueAllAges) || (venueAllAges && (!hasActivity || activityAllAges));
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function lawAdultPlaceUnchanged(hasActivity: boolean, activityAllAges: boolean, venueAllAges: boolean): boolean {
  //@ ensures \result === true
  return teenPlaceAllowed(false, hasActivity, activityAllAges, venueAllAges);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function lawAllAgesNeverABarOrHome(ageMin: number, riskLow: boolean): boolean {
  //@ ensures \result === true
  return !allAgesMarkValid(true, ageMin, riskLow, true);
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function lawAllAgesOpensAtThirteen(ageMin: number, riskLow: boolean, adultPlace: boolean): boolean {
  //@ ensures \result === true
  return !allAgesMarkValid(true, ageMin, riskLow, adultPlace) || ageMin <= teenFriendMinAge;
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function lawAdultPlansKeepTheirCatalog(allAges: boolean, adultPlans: boolean): boolean {
  //@ ensures \result === true
  return teenActivityOffered(false, allAges, adultPlans) === adultPlans;
}

/** Story: Introduce a minor for friendship only to people close in age / A group with a minor meets at an all-ages place (spec/friendIntroAge.md) */
//@ pure
export function lawTeenGroupsGetOnlyAllAges(allAges: boolean, adultPlans: boolean): boolean {
  //@ ensures \result === true
  return teenActivityOffered(true, allAges, adultPlans) === allAges;
}

/** Story: Introduce a minor for friendship only to people close in age / A minor gets moderated text relay only (spec/friendIntroAge.md) */
//@ pure
export function relayKindAllowed(textItem: boolean, bothAdults: boolean, teenPair: boolean): boolean {
  return bothAdults || (textItem && teenPair);
}

/** Story: Introduce a minor for friendship only to people close in age / A minor gets moderated text relay only (spec/friendIntroAge.md) */
//@ pure
export function lawNoNumberOrPhotoWithAMinor(teenPair: boolean): boolean {
  //@ ensures \result === true
  return !relayKindAllowed(false, false, teenPair);
}

/** Story: Introduce a minor for friendship only to people close in age / A minor gets moderated text relay only (spec/friendIntroAge.md) */
//@ pure
export function lawAdultRelayUnchanged(textItem: boolean, teenPair: boolean): boolean {
  //@ ensures \result === true
  return relayKindAllowed(textItem, true, teenPair);
}

/** Story: Introduce a minor for friendship only to people close in age / A minor stays single-player unless a teen introduction is open to them (spec/friendIntroAge.md) */
//@ pure
export function singlePlayerMember(adult: boolean, teenCandidate: boolean): boolean {
  return !adult && !teenCandidate;
}

/** Story: Introduce a minor for friendship only to people close in age / A minor stays single-player unless a teen introduction is open to them (spec/friendIntroAge.md) */
//@ pure
export function lawAdultIsNeverSinglePlayerByAge(teenCandidate: boolean): boolean {
  //@ ensures \result === true
  return !singlePlayerMember(true, teenCandidate);
}

/** Story: Introduce a minor for friendship only to people close in age / A minor stays single-player unless a teen introduction is open to them (spec/friendIntroAge.md) */
//@ pure
export function teenFriendCandidate(adult: boolean, ready: boolean, birthKey: number, minDay: number, maxDay: number, teenIntros: boolean, teenApp: boolean): boolean {
  return !adult && teenIntros && teenApp && ready && teenAgesOk(birthKey, minDay, maxDay) && memberAge_ageOnDay(birthKey, minDay) < memberAge_adultAge;
}

/** Story: Introduce a minor for friendship only to people close in age / A minor stays single-player unless a teen introduction is open to them (spec/friendIntroAge.md) */
//@ pure
export function lawSwitchOffMinorIsSinglePlayer(adult: boolean, ready: boolean, birthKey: number, minDay: number, maxDay: number, teenApp: boolean): boolean {
  //@ ensures \result === true
  return !(!adult) || singlePlayerMember(adult, teenFriendCandidate(adult, ready, birthKey, minDay, maxDay, false, teenApp));
}

/** Story: Introduce a minor for friendship only to people close in age / A minor stays single-player unless a teen introduction is open to them (spec/friendIntroAge.md) */
//@ pure
export function lawUnreadyMinorIsSinglePlayer(adult: boolean, birthKey: number, minDay: number, maxDay: number, teenIntros: boolean, teenApp: boolean): boolean {
  //@ ensures \result === true
  return !(!adult) || singlePlayerMember(adult, teenFriendCandidate(adult, false, birthKey, minDay, maxDay, teenIntros, teenApp));
}

/** Story: Introduce a minor for friendship only to people close in age / A statement opens a minor signal only on new evidence (spec/friendIntroAge.md) */
//@ pure
export function minorSignalOpens(recordKnownMinor: boolean, saysYounger: boolean): boolean {
  return !recordKnownMinor || saysYounger;
}

/** Story: Introduce a minor for friendship only to people close in age / A statement opens a minor signal only on new evidence (spec/friendIntroAge.md) */
//@ pure
export function lawAdultRecordOpensOnEvidence(saysYounger: boolean): boolean {
  //@ ensures \result === true
  return minorSignalOpens(false, saysYounger);
}

/** Story: Introduce a minor for friendship only to people close in age / A statement opens a minor signal only on new evidence (spec/friendIntroAge.md) */
//@ pure
export function lawAgreeingMinorStatementOpensNothing(recordKnownMinor: boolean): boolean {
  //@ ensures \result === true
  return !recordKnownMinor || !minorSignalOpens(recordKnownMinor, false);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_friendIntroAge(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
