import type { MemberId } from "@thenetwork/core";
import { lateArrivalDeliveryPrefix } from "../../core/src/generated/groupLateArrival.ts";

export interface LateArrivalDelivery {
  app: string;
  oppId: string;
  meetingAt: number;
  revision: number;
  from: MemberId;
  to: MemberId;
}

/** Accept an explicit report, leaving named requests to the existing relay conversation. */
export function isLateArrivalReport(body: string): boolean {
  return /^(?:(?:i['’]m|i am) )?running late[.!]?$/i.test(body.trim());
}

export function lateArrivalDeliveryId(delivery: LateArrivalDelivery): string {
  const { app, oppId, meetingAt, revision, from, to } = delivery;
  return lateArrivalDeliveryPrefix + [app, oppId, meetingAt, revision, from, to].map(part => encodeURIComponent(part)).join(":");
}

/** In-memory lookup for an exact booking receipt. This key is never sent. */
export function lateArrivalBookingReceiptKey(oppId: string, memberId: MemberId, revision = 0): string {
  return `${lateArrivalDeliveryPrefix}booking-receipt:${[oppId, revision, memberId].map(encodeURIComponent).join(":")}`;
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
