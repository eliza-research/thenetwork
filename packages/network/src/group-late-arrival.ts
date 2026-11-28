import type { MemberId, OpportunityKind } from "@thenetwork/core";
import { lateArrivalDeliveryPrefix, lateArrivalIsPair } from "../../core/src/generated/groupLateArrival.ts";

export interface LateArrivalDelivery {
  app: string;
  oppId: string;
  meetingAt: number;
  revision: number;
  from: MemberId;
  to: MemberId;
}

export function isLateArrivalPairBooking(booking: { kind: OpportunityKind; participants: readonly MemberId[]; plan?: { partner: boolean } }): boolean {
  return lateArrivalIsPair(booking.kind === "group", !!booking.plan && !booking.plan.partner, new Set(booking.participants).size);
}

/** Panic exit or pair block immediately halts late-arrival notices before admission or dispatch. */
export function isLateArrivalAdmitted(opts: { panicTriggered?: boolean; blocked?: boolean }): boolean {
  return !opts.panicTriggered && !opts.blocked;
}

const LATE_ARRIVAL_REPORT_RX = /^(?:(?:sorry[,!\s]+)?(?:(?:i['’]m|i am|im)\s+)?(?:running\s+(?:(?:about|like)\s+)?(?:(?:a\s+few|\d{1,2})\s*(?:min|mins|minutes?)\s+)?late|(?:about\s+|like\s+)?\d{1,2}\s*(?:min|mins|minutes?)\s+(?:late|behind))(?:\s*[,(-]?\s*(?:about\s+|like\s+|in\s+)?(\d{1,2})\s*(?:min|mins|minutes?)\s*\)?)?)[.!]*$/i;
const LATE_ARRIVAL_ETA_RX = /\b(\d{1,2})\s*(?:min|mins|minutes?)\b/i;

/** Extract a bounded ETA in minutes from a direct late-arrival text, if present. */
export function parseLateArrivalEtaMinutes(body: string): number | undefined {
  const m = LATE_ARRIVAL_ETA_RX.exec(body.trim());
  if (!m) return undefined;
  const minutes = Number(m[1]);
  return Number.isFinite(minutes) ? Math.min(90, Math.max(1, minutes)) : undefined;
}

/** Parse a direct late-arrival report along with its optional ETA in minutes. */
export function parseLateArrivalReport(body: string): { isLate: boolean; etaMinutes?: number } {
  const trimmed = body.trim();
  if (!LATE_ARRIVAL_REPORT_RX.test(trimmed)) return { isLate: false };
  const etaMinutes = parseLateArrivalEtaMinutes(trimmed);
  return etaMinutes !== undefined ? { isLate: true, etaMinutes } : { isLate: true };
}

/** Accept an explicit report, leaving named requests to the existing relay conversation. */
export function isLateArrivalReport(body: string): boolean {
  return LATE_ARRIVAL_REPORT_RX.test(body.trim());
}

export function lateArrivalDeliveryId(delivery: LateArrivalDelivery): string {
  const { app, oppId, meetingAt, revision, from, to } = delivery;
  return lateArrivalDeliveryPrefix + [app, oppId, meetingAt, revision, from, to].map(part => encodeURIComponent(part)).join(":");
}

export function parseLateArrivalDeliveryId(id: string): LateArrivalDelivery | undefined {
  if (!id.startsWith(lateArrivalDeliveryPrefix)) return;
  const parts = id.slice(lateArrivalDeliveryPrefix.length).split(":");
  if (parts.length !== 6) return;
  try {
    const [app, oppId, time, version, from, to] = parts.map(decodeURIComponent);
    const meetingAt = Number(time), revision = Number(version);
    if (!app || !oppId || !from || !to || !Number.isSafeInteger(meetingAt) || meetingAt < 0 || !Number.isSafeInteger(revision) || revision < 0) return;
    const delivery = { app, oppId, meetingAt, revision, from, to };
    return lateArrivalDeliveryId(delivery) === id ? delivery : undefined;
  } catch {
    return;
  }
}
