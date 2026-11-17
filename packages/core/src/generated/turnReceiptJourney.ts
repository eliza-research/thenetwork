// GENERATED from spec/turnReceiptJourney.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type ReceiptPhase as turnReceipt_ReceiptPhase, type TurnReceipt as turnReceipt_TurnReceipt, receiptReplyIdsMatch as turnReceipt_receiptReplyIdsMatch, noHistoryAllowed as turnReceipt_noHistoryAllowed, receiptAccepted as turnReceipt_receiptAccepted, checkTurn as turnReceipt_checkTurn, canCheckAuthority as turnReceipt_canCheckAuthority, checkAuthority as turnReceipt_checkAuthority, canReadPrevious as turnReceipt_canReadPrevious, readPrevious as turnReceipt_readPrevious, canCheckScope as turnReceipt_canCheckScope, checkScope as turnReceipt_checkScope, canCheckDelivery as turnReceipt_canCheckDelivery, checkDelivery as turnReceipt_checkDelivery, lawReceiptRequiresExactOrder as turnReceipt_lawReceiptRequiresExactOrder, lawAccountBoundReceiptNeedsHistory as turnReceipt_lawAccountBoundReceiptNeedsHistory, canRecordReceipt as turnReceipt_canRecordReceipt, recordReceipt as turnReceipt_recordReceipt, receiptFinal as turnReceipt_receiptFinal, receiptMessageStatus as turnReceipt_receiptMessageStatus, sometimesCanStoreReceipt as turnReceipt_sometimesCanStoreReceipt, sometimesCanReplayReceipt as turnReceipt_sometimesCanReplayReceipt, initial as turnReceipt_initial, canCheckTurn as turnReceipt_canCheckTurn, stepReceiptNeedsAdmission as turnReceipt_stepReceiptNeedsAdmission } from "./turnReceipt.ts";

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
export type ReceiptJourneyResult = "ReportStored" | "ReportReplayed" | "ReportConflict";
/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
export type DeliveryReport = "UnknownReport" | "AcceptedReport" | "AlternativeAcceptance" | "RejectedReport";
/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
export type ReceiptObservation =
  | { tag: "NoReceipt" }
  | { tag: "SavedReceipt"; report: DeliveryReport };
/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
export interface ReceiptJourney { receipt: ReceiptObservation; replyStatus: string }
/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
export interface ReceiptJourneyStep { state: ReceiptJourney; out: ReceiptJourneyResult[] }

/** One variant per transition in the spec. */
export type Event =
  | { type: "reportDelivery"; report: DeliveryReport };

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
export const initial: ReceiptJourney = { receipt: ({ tag: "NoReceipt" } as ReceiptObservation), replyStatus: "collected" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ReceiptJourney): boolean {
  return alwaysReplyStatusMatchesReceipt(current);
}

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
//@ pure
export function hasReceipt(r: ReceiptObservation): boolean {
  return r.tag === "NoReceipt" ? false : true;
}

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
//@ pure
export function receiptIs(r: ReceiptObservation, report: DeliveryReport): boolean {
  return r.tag === "SavedReceipt" ? r.report === report : false;
}

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
//@ pure
export function delivery(report: DeliveryReport): string {
  return report === "UnknownReport" ? "unknown" : (report === "RejectedReport" ? "rejected" : "accepted");
}

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
//@ pure
export function replyStatusFor(receipt: ReceiptObservation): string {
  return receipt.tag === "NoReceipt" ? "collected" : turnReceipt_receiptMessageStatus(delivery(receipt.report));
}

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
//@ pure
export function sometimesStoresAnUnknownReceipt(s: ReceiptJourney): boolean {
  return receiptIs(s.receipt, "UnknownReport");
}

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
//@ pure
export function sometimesStoresAnAcceptedReceipt(s: ReceiptJourney): boolean {
  return receiptIs(s.receipt, "AcceptedReport");
}

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
//@ pure
export function sometimesStoresARejectedReceipt(s: ReceiptJourney): boolean {
  return receiptIs(s.receipt, "RejectedReport");
}

/** Story: Keep a single delivery result for a collected reply / A receipt and its reply status change together (spec/turnReceiptJourney.md) */
//@ pure
export function alwaysReplyStatusMatchesReceipt(s: ReceiptJourney): boolean {
  return s.replyStatus === replyStatusFor(s.receipt);
}

/** Story: Keep a single delivery result for a collected reply / An exact replay leaves both records unchanged (spec/turnReceiptJourney.md) */
//@ pure
export function canReportDelivery(s: ReceiptJourney, report: DeliveryReport): boolean {
  return true;
}

/** Story: Keep a single delivery result for a collected reply / An exact replay leaves both records unchanged (spec/turnReceiptJourney.md) */
//@ pure
export function stepAStoredFinalReportStays(before: ReceiptJourney, after: ReceiptJourney): boolean {
  return !(hasReceipt(before.receipt) && !receiptIs(before.receipt, "UnknownReport")) || equal_turnReceiptJourney(after, before);
}

/** Story: Keep a single delivery result for a collected reply / An exact replay leaves both records unchanged (spec/turnReceiptJourney.md) */
//@ pure
export function reportDelivery(s: ReceiptJourney, report: DeliveryReport): ReceiptJourneyStep {
  //@ ensures (inv(s) && canReportDelivery(s, report)) ==> alwaysReplyStatusMatchesReceipt(\result.state)
  //@ ensures (inv(s) && canReportDelivery(s, report)) ==> stepAStoredFinalReportStays(s, \result.state)
  const local_0: ReceiptObservation = ({ tag: "SavedReceipt", report: report } as ReceiptObservation);
  const local_1: turnReceipt_TurnReceipt = turnReceipt_readPrevious(({ phase: "CheckingPrevious" } as turnReceipt_TurnReceipt), receiptIs(s.receipt, report), hasReceipt(s.receipt), receiptIs(s.receipt, "UnknownReport"), turnReceipt_receiptFinal(delivery(report)));
  return turnReceipt_canCheckScope(local_1) ? ({ state: ({ receipt: local_0, replyStatus: replyStatusFor(local_0) } as ReceiptJourney), out: (["ReportStored"] as ReceiptJourneyResult[]) } as ReceiptJourneyStep) : ({ state: s, out: ([local_1.phase === "Replayed" ? "ReportReplayed" : "ReportConflict"] as ReceiptJourneyResult[]) } as ReceiptJourneyStep);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ReceiptJourney, event: Event): boolean {
  if (event.type === "reportDelivery") return canReportDelivery(current, event.report);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged; the result holds the state and what the event output. */
//@ pure
export function step(current: ReceiptJourney, event: Event): ReceiptJourneyStep {
  //@ requires inv(current)
  //@ ensures inv(\result.state)
  if (event.type === "reportDelivery") return canReportDelivery(current, event.report) ? reportDelivery(current, event.report) : { state: current, out: ([] as ReceiptJourneyResult[]) };
  return { state: current, out: ([] as ReceiptJourneyResult[]) };
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "reportDelivery" && (raw.report === "UnknownReport" || raw.report === "AcceptedReport" || raw.report === "AlternativeAcceptance" || raw.report === "RejectedReport")) return { type: "reportDelivery", report: raw.report };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ReceiptJourney | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.receipt === "object" && raw.receipt !== null && !Array.isArray(raw.receipt) && (raw.receipt.tag === "NoReceipt" && Object.keys(raw.receipt).length === 1 || raw.receipt.tag === "SavedReceipt" && (raw.receipt.report === "UnknownReport" || raw.receipt.report === "AcceptedReport" || raw.receipt.report === "AlternativeAcceptance" || raw.receipt.report === "RejectedReport") && Object.keys(raw.receipt).length === 2) && typeof raw.replyStatus === "string" && Object.keys(raw).length === 2)) return undefined;
  const parsed: ReceiptJourney = ({ receipt: (raw.receipt.tag === "NoReceipt" ? { tag: raw.receipt.tag } : { tag: raw.receipt.tag, report: raw.receipt.report }), replyStatus: raw.replyStatus });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ReceiptJourney {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_turnReceiptJourney(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_turnReceiptJourney((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
