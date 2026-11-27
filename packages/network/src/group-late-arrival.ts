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

/** Accept an explicit report, leaving named requests to the existing relay conversation. */
export function isLateArrivalReport(body: string): boolean {
  return /^(?:(?:i'?m|i am) )?running late[.!]?$/i.test(body.trim().replace(/[‘’ʼ`´]/g, "'"));
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
