import type { TimeOption } from "@thenetwork/core";
import { attention } from "@thenetwork/engine";
import {
  friendPlanEarliestCommon, friendPlanHasWindow, friendPlanOfferSlotAllowed, friendPlanProbeDeliveryPrefix, friendPlanReplyChoice,
  friendPlanReviewedWindowsValid, type FriendsPlanWindow,
} from "../../core/src/generated/friendsPlanTimeChoice.ts";
import { parseProbeReply } from "./classify.ts";

const KEYS = ["a", "b", "c"] as const;
const exactTimes = (window: FriendsPlanWindow) => Number.isSafeInteger(window.start) && Number.isSafeInteger(window.end);

export function friendsPlanProbeDeliveryKey(oppId: string, revision: number, memberId: string): string {
  return friendPlanProbeDeliveryPrefix + [oppId, revision, memberId].map(encodeURIComponent).join(":");
}

export function validFriendsPlanTimeWindows(windows: readonly FriendsPlanWindow[]): boolean {
  return windows.every(exactTimes) && friendPlanReviewedWindowsValid([...windows]);
}

export function friendsPlanOfferedWindows(reviewed: readonly FriendsPlanWindow[], firstPicks?: readonly FriendsPlanWindow[],
  viable: (window: FriendsPlanWindow) => boolean = () => true): FriendsPlanWindow[] {
  if (!validFriendsPlanTimeWindows(reviewed)) return [];
  const picked = firstPicks?.filter(exactTimes);
  return reviewed.filter(window => friendPlanOfferSlotAllowed(true, picked === undefined,
    picked !== undefined && friendPlanHasWindow(picked, window.start, window.end), viable(window)));
}

/** Keep the reviewed letter even when some options are no longer offered. */
export function friendsPlanTimeOptions(reviewed: readonly FriendsPlanWindow[], offered: readonly FriendsPlanWindow[], tz: string): TimeOption[] {
  if (!validFriendsPlanTimeWindows(reviewed)) return [];
  const exact = offered.filter(exactTimes);
  return reviewed.flatMap((window, index) => friendPlanHasWindow(exact, window.start, window.end)
    ? [{ ...window, key: KEYS[index]!, label: attention.timeOptionsPhrase([window], tz) }] : []);
}

export function parseFriendsPlanTimeReply(body: string, offered: readonly TimeOption[]): {
  answer: "yes" | "no" | "unclear"; picks: FriendsPlanWindow[];
} {
  const validOffer = offered.length > 0 && offered.length <= KEYS.length
    && new Set(offered.map(option => option.key)).size === offered.length
    && offered.every(option => KEYS.some(key => key === option.key) && exactTimes(option) && option.start >= 0 && option.start < option.end);
  if (!validOffer) return { answer: "unclear", picks: [] };
  const parsed = parseProbeReply(body, offered, true);
  const singleOfferedSlot = offered.length === 1;
  let picks = offered.filter(option => parsed.keys.includes(option.key)).map(({ start, end }) => ({ start, end }));
  let affirmative = parsed.answer === "yes";
  const blockedBareSingleWhy = parsed.why === "slot" || parsed.why === "counter" || parsed.why === "mixed"
    || parsed.why === "conditional" || parsed.why === "hedged" || parsed.why === "refusal";
  if (singleOfferedSlot && !affirmative && parsed.answer === "unclear" && !blockedBareSingleWhy) {
    const loose = parseProbeReply(body, offered, false);
    if (loose.answer === "yes" && loose.why !== "counter" && loose.keys.length === 1 && loose.keys[0] === offered[0]!.key) {
      affirmative = true;
      picks = [{ start: offered[0]!.start, end: offered[0]!.end }];
    }
  }
  const choice = friendPlanReplyChoice(affirmative, parsed.answer === "no", parsed.explicitTimeSelection === true,
    parsed.why === "counter", picks.length, singleOfferedSlot);
  if (choice === "AcceptTimeChoices") {
    return {
      answer: "yes",
      picks: picks.length ? picks : singleOfferedSlot ? [{ start: offered[0]!.start, end: offered[0]!.end }] : [],
    };
  }
  return { answer: choice === "DeclineTimeChoices" ? "no" : "unclear", picks: [] };
}

export function chooseFriendsPlanWindow(reviewed: readonly FriendsPlanWindow[], firstPicks: readonly FriendsPlanWindow[],
  secondPicks: readonly FriendsPlanWindow[], viable: (window: FriendsPlanWindow) => boolean = () => true): FriendsPlanWindow | undefined {
  if (!validFriendsPlanTimeWindows(reviewed)) return;
  const selected = friendPlanEarliestCommon([...reviewed], firstPicks.filter(exactTimes), secondPicks.filter(exactTimes), reviewed.filter(viable));
  if (selected.start >= 0) return selected;
}
