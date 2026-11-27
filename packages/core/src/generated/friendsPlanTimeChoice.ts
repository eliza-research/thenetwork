// GENERATED from spec/friendsPlanTimeChoice.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
export interface FriendsPlanWindow { start: number; end: number }
/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
export interface FriendsPlanWindowCheck { valid: boolean; previousStart: number }
/** Story: Choose a time privately with my activity partner / Only explicit picks from the delivered invitation count (spec/friendsPlanTimeChoice.md) */
export type FriendsPlanTimeReply = "AcceptTimeChoices" | "DeclineTimeChoices" | "ClarifyTimeChoices";

/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
export const noFriendsPlanWindow: FriendsPlanWindow = { start: -1, end: -1 };
/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
export const earlyPlanWindow: FriendsPlanWindow = { start: 10, end: 12 };
/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
export const latePlanWindow: FriendsPlanWindow = { start: 20, end: 22 };
/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
export const lastPlanWindow: FriendsPlanWindow = { start: 30, end: 31 };
/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
export const differentPlanWindow: FriendsPlanWindow = { start: 10, end: 13 };
/** Story: Choose a time privately with my activity partner / Only explicit picks from the delivered invitation count (spec/friendsPlanTimeChoice.md) */
export const friendPlanProbeDeliveryPrefix: string = "friends-plan-probe:";

/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
//@ pure
export function friendPlanWindowOrder(reviewed: FriendsPlanWindow[]): FriendsPlanWindowCheck {
  return reviewed.reduce((data: FriendsPlanWindowCheck, window: FriendsPlanWindow) => ({ valid: data.valid && data.previousStart < window.start && window.start < window.end, previousStart: window.start } as FriendsPlanWindowCheck), ({ valid: true, previousStart: -1 } as FriendsPlanWindowCheck));
}

/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
//@ pure
export function friendPlanReviewedWindowsValid(reviewed: FriendsPlanWindow[]): boolean {
  return reviewed.length >= 2 && reviewed.length <= 3 && friendPlanWindowOrder(reviewed).valid;
}

/** Story: Choose a time privately with my activity partner / Review fixes the available windows (spec/friendsPlanTimeChoice.md) */
//@ pure
export function friendPlanHasWindow(windows: FriendsPlanWindow[], startAt: number, endAt: number): boolean {
  return windows.some((window: FriendsPlanWindow) => window.start === startAt && window.end === endAt);
}

/** Story: Choose a time privately with my activity partner / Only explicit picks from the delivered invitation count (spec/friendsPlanTimeChoice.md) */
//@ pure
export function friendPlanOfferSlotAllowed(reviewedSlot: boolean, firstOffer: boolean, firstPicked: boolean, viable: boolean): boolean {
  return reviewedSlot && (firstOffer || firstPicked) && viable;
}

/** Story: Choose a time privately with my activity partner / Only explicit picks from the delivered invitation count (spec/friendsPlanTimeChoice.md) */
//@ pure
export function lawSecondFriendOfferNeedsTheFirstPick(reviewedSlot: boolean, viable: boolean): boolean {
  //@ ensures \result === true
  return !friendPlanOfferSlotAllowed(reviewedSlot, false, false, viable);
}

/** Story: Choose a time privately with my activity partner / Only explicit picks from the delivered invitation count (spec/friendsPlanTimeChoice.md) */
//@ pure
export function friendPlanReplyChoice(affirmative: boolean, negative: boolean, explicitPick: boolean, counter: boolean, pickedCount: number, singleOfferedSlot: boolean): FriendsPlanTimeReply {
  return counter ? "ClarifyTimeChoices" : (affirmative && !negative && ((explicitPick && pickedCount > 0) || (singleOfferedSlot && pickedCount === 1)) ? "AcceptTimeChoices" : (negative && !affirmative ? "DeclineTimeChoices" : "ClarifyTimeChoices"));
}

/** Story: Choose a time privately with my activity partner / Only explicit picks from the delivered invitation count (spec/friendsPlanTimeChoice.md) */
//@ pure
export function lawMultiOptionBareYesCannotPick(pickedCount: number): boolean {
  //@ ensures \result === true
  return friendPlanReplyChoice(true, false, false, false, pickedCount, false) === "ClarifyTimeChoices";
}

/** Story: Choose a time privately with my activity partner / Only explicit picks from the delivered invitation count (spec/friendsPlanTimeChoice.md) */
//@ pure
export function lawSingleOptionBareYesAccepts(explicitPick: boolean): boolean {
  //@ ensures \result === true
  return friendPlanReplyChoice(true, false, explicitPick, false, 1, true) === "AcceptTimeChoices";
}

/** Story: Choose a time privately with my activity partner / Book the earliest current window both chose (spec/friendsPlanTimeChoice.md) */
//@ pure
export function friendPlanEarliestCommon(reviewed: FriendsPlanWindow[], firstPicks: FriendsPlanWindow[], secondPicks: FriendsPlanWindow[], viableWindows: FriendsPlanWindow[]): FriendsPlanWindow {
  return secondPicks.length === 0 || !friendPlanReviewedWindowsValid(reviewed) ? noFriendsPlanWindow : reviewed.reduce((earliest: FriendsPlanWindow, window: FriendsPlanWindow) => earliest.start < 0 && friendPlanHasWindow(firstPicks, window.start, window.end) && friendPlanHasWindow(secondPicks, window.start, window.end) && friendPlanHasWindow(viableWindows, window.start, window.end) ? window : earliest, noFriendsPlanWindow);
}

/** Story: Choose a time privately with my activity partner / Book the earliest current window both chose (spec/friendsPlanTimeChoice.md) */
//@ pure
export function lawFriendPlanCannotBookWithoutSecondPick(reviewed: FriendsPlanWindow[], firstPicks: FriendsPlanWindow[], viableWindows: FriendsPlanWindow[]): boolean {
  //@ ensures \result === true
  return friendPlanEarliestCommon(reviewed, firstPicks, ([] as FriendsPlanWindow[]), viableWindows).start < 0;
}
