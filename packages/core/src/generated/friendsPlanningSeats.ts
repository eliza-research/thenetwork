// GENERATED from spec/friendsPlanningSeats.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Use a seat only for a plan it can serve / Check the final format and meeting availability (spec/friendsPlanningSeats.md) */
//@ pure
export function friendsSeatFitsFormat(startsAsGroup: boolean, finalPair: boolean, pairEligible: boolean): boolean {
  return !(startsAsGroup && finalPair) || pairEligible;
}

/** Story: Use a seat only for a plan it can serve / Check the final format and meeting availability (spec/friendsPlanningSeats.md) */
//@ pure
export function friendsCandidateCanMeet(compatible: boolean, sharesTime: boolean): boolean {
  return compatible && sharesTime;
}

/** Story: Use a seat only for a plan it can serve / Check the final format and meeting availability (spec/friendsPlanningSeats.md) */
//@ pure
export function lawFriendsTwoSeatsNeedPairEligibility(pairEligible: boolean): boolean {
  //@ ensures \result === true
  return friendsSeatFitsFormat(true, true, pairEligible) === pairEligible;
}

/** Story: Use a seat only for a plan it can serve / Check the final format and meeting availability (spec/friendsPlanningSeats.md) */
//@ pure
export function lawFriendsCandidateNeedsCommonMeeting(compatible: boolean): boolean {
  //@ ensures \result === true
  return !friendsCandidateCanMeet(compatible, false);
}
