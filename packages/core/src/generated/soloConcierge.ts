// GENERATED from spec/soloConcierge.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { minMemberAge as memberAge_minMemberAge, maxAge as memberAge_maxAge, adultAge as memberAge_adultAge, ageInRange as memberAge_ageInRange, lowerAge as memberAge_lowerAge, lawEffectiveAgeCannotRise as memberAge_lawEffectiveAgeCannotRise, joinableAge as memberAge_joinableAge, matchableAge as memberAge_matchableAge, lawJoiningNeedsUsableAge as memberAge_lawJoiningNeedsUsableAge, lawMatchingNeedsAdultAge as memberAge_lawMatchingNeedsAdultAge } from "./memberAge.ts";


/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md:33) */
export const maxSoloEventOptions: number = 3;

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md:9) */
//@ pure
export function soloEventCityAllowed(home: boolean, visiting: boolean, away: boolean): boolean {
  return !away && (home || visiting);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md:9) */
//@ pure
export function soloEventEligible(freshListed: boolean, fitsRequest: boolean, present: boolean, hasAvailability: boolean, fitsAvailability: boolean, hasTripLimit: boolean, travelMinutes: number, limit: number): boolean {
  return freshListed && fitsRequest && present && (!hasAvailability || fitsAvailability) && (!hasTripLimit || travelMinutes <= limit);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md:9) */
//@ pure
export function lawTripAwayPreventsLocalSuggestion(home: boolean, visiting: boolean): boolean {
  //@ ensures \result === true
  return !soloEventCityAllowed(home, visiting, true);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md:9) */
//@ pure
export function soloEventAgeAllowed(age: number, minimum: number, allAges: boolean): boolean {
  return memberAge_joinableAge(age) && age >= minimum && (memberAge_matchableAge(age) || allAges);
}

/** Story: Get ideas for my own time / A current request can use only listings safe for the member's age and location (spec/soloConcierge.md:9) */
//@ pure
export function lawYoungSoloListingsNeedAllAges(age: number, minimum: number): boolean {
  //@ ensures \result === true
  return !(age < memberAge_adultAge) || !soloEventAgeAllowed(age, minimum, false);
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md:33) */
//@ pure
export function soloEventPrecedes(fit: number, minutes: number, start: number, otherFit: number, otherMinutes: number, otherStart: number): boolean {
  return fit > otherFit || (fit === otherFit && (minutes < otherMinutes || (minutes === otherMinutes && start < otherStart)));
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md:33) */
//@ pure
export function soloReplyReplayAllowed(authorized: boolean, sameLiveReply: boolean): boolean {
  return authorized && sameLiveReply;
}

/** Story: Get ideas for my own time / Reply with at most three public events and a reason for each (spec/soloConcierge.md:33) */
//@ pure
export function lawChangedSoloReplyCannotReplay(authorized: boolean): boolean {
  //@ ensures \result === true
  return !soloReplyReplayAllowed(authorized, false);
}
