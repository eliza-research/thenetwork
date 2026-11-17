import { fromLocal, HOUR, localParts, MINUTE, type MemberId } from "@thenetwork/core";
import { sha256 } from "@thenetwork/engine/src/hash.ts";
import { rescheduleDraftCurrent } from "../../core/src/generated/meetingReschedule.ts";
import { NY } from "./outreach.ts";

export type RescheduleDraft = {
  ref: string;
  revision: number;
  originalAt: number;
  proposedAt: number;
  expiresAt: number;
  roster: MemberId[];
  offered: MemberId[];
  /** Only in-process callers without a separate delivery queue use these delivery times. */
  deliveredAt?: Record<MemberId, number>;
  accepted: MemberId[];
};

export type RescheduleCommand =
  | { kind: "request"; originalAt: number; proposedAt: number }
  | { kind: "vote"; ref: string; accepted: boolean }
  | { kind: "format" };

export function localBookingStart(at: number): string {
  const { year, month, day, hour, minute } = localParts(at, NY);
  const twoDigits = (n: number) => String(n).padStart(2, "0");
  return `${year}-${twoDigits(month)}-${twoDigits(day)} ${twoDigits(hour)}:${twoDigits(minute)}`;
}

const meetingStartFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: NY, weekday: "long", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
export const describeBookingStart = (at: number): string => meetingStartFormat.format(at);

const LOCAL_START = "(\\d{4}-\\d{2}-\\d{2} (?:[01]\\d|2[0-3]):[0-5]\\d)";
const REQUEST = new RegExp(`^RESCHEDULE ${LOCAL_START} TO ${LOCAL_START}$`, "i");
const VOTE = /^RESCHEDULE (YES|NO) ([a-p]{16})$/i;

/** A repeated or nonexistent New York wall time cannot identify an exact meeting start. */
function exactLocalStart(value: string): number | undefined {
  const [year, month, day, hour, minute] = value.split(/[- :]/).map(Number) as [number, number, number, number, number];
  const at = fromLocal(year, month, day, hour, NY) + minute * MINUTE;
  return localBookingStart(at) === value && localBookingStart(at - HOUR) !== value && localBookingStart(at + HOUR) !== value ? at : undefined;
}

export function parseRescheduleCommand(raw: string): RescheduleCommand | undefined {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!/^RESCHEDULE\b/i.test(text)) return;
  const vote = VOTE.exec(text);
  if (vote) return { kind: "vote", accepted: vote[1]!.toLowerCase() === "yes", ref: vote[2]!.toLowerCase() };
  const request = REQUEST.exec(text);
  if (request) {
    const originalAt = exactLocalStart(request[1]!);
    const proposedAt = exactLocalStart(request[2]!);
    if (originalAt !== undefined && proposedAt !== undefined) return { kind: "request", originalAt, proposedAt };
  }
  return { kind: "format" };
}

export function rescheduleMemberRef(draft: RescheduleDraft, memberId: MemberId): string {
  const hex = sha256(JSON.stringify([draft.ref, memberId])).slice(0, 16);
  return [...hex].map(char => String.fromCharCode(97 + Number.parseInt(char, 16))).join("");
}

export const RESCHEDULE_QUEUE_PREFIX = "reschedule:";
export const rescheduleOfferKey = (draft: RescheduleDraft, memberId: MemberId): string => `${RESCHEDULE_QUEUE_PREFIX}offer:${draft.ref}:${memberId}`;
export const rescheduleUpdatePrefix = (oppId: string): string => `${RESCHEDULE_QUEUE_PREFIX}updated:${oppId}:r`;
export const rescheduleUpdateKey = (oppId: string, revision: number, memberId: MemberId): string => `${rescheduleUpdatePrefix(oppId)}${revision}:${memberId}`;

export function sameRescheduleRoster(left: readonly MemberId[], right: readonly MemberId[]): boolean {
  return left.length === right.length && left.every((member, index) => member === right[index]);
}

export function rescheduleNoticeCurrent(
  booking: { id: string; current: boolean; meetingAt?: number; scheduleRevision?: number; reschedule?: RescheduleDraft },
  roster: readonly MemberId[], member: MemberId, id: string, now: number,
): boolean {
  const { meetingAt, reschedule: draft } = booking;
  const revision = booking.scheduleRevision ?? 0;
  if (!booking.current || meetingAt === undefined || meetingAt <= now || !roster.includes(member)) return false;
  if (id === rescheduleUpdateKey(booking.id, revision, member)) return revision > 0;
  return !!draft && id === rescheduleOfferKey(draft, member) && draft.offered.includes(member) && !draft.accepted.includes(member)
    && rescheduleDraftCurrent(true, draft.originalAt === meetingAt, sameRescheduleRoster(draft.roster, roster),
      draft.revision === revision, true, now, draft.expiresAt);
}
