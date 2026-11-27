import { DAY, fromLocal, HOUR, localParts, MINUTE, type MemberId } from "@thenetwork/core";
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

export function localBookingStart(at: number, tz: string = NY): string {
  const { year, month, day, hour, minute } = localParts(at, tz);
  const twoDigits = (n: number) => String(n).padStart(2, "0");
  return `${year}-${twoDigits(month)}-${twoDigits(day)} ${twoDigits(hour)}:${twoDigits(minute)}`;
}

const meetingStartFormats = new Map<string, Intl.DateTimeFormat>();
export const describeBookingStart = (at: number, tz: string = NY): string => {
  let fmt = meetingStartFormats.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "long", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    });
    meetingStartFormats.set(tz, fmt);
  }
  return fmt.format(at);
};

const LOCAL_START = "(\\d{4}-\\d{2}-\\d{2} (?:[01]\\d|2[0-3]):[0-5]\\d)";
const REQUEST = new RegExp(`^RESCHEDULE ${LOCAL_START} TO ${LOCAL_START}$`, "i");
const VOTE = /^RESCHEDULE (YES|NO) ([a-p]{16})$/i;

/** A repeated or nonexistent local wall time cannot identify an exact meeting start. */
function exactLocalStart(value: string, tz: string = NY): number | undefined {
  const [year, month, day, hour, minute] = value.split(/[- :]/).map(Number) as [number, number, number, number, number];
  const at = fromLocal(year, month, day, hour, tz) + minute * MINUTE;
  return localBookingStart(at, tz) === value && localBookingStart(at - HOUR, tz) !== value && localBookingStart(at + HOUR, tz) !== value ? at : undefined;
}

export function parseRescheduleCommand(raw: string, tz: string = NY): RescheduleCommand | undefined {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!/^RESCHEDULE\b/i.test(text)) return;
  const vote = VOTE.exec(text);
  if (vote) return { kind: "vote", accepted: vote[1]!.toLowerCase() === "yes", ref: vote[2]!.toLowerCase() };
  const request = REQUEST.exec(text);
  if (request) {
    const originalAt = exactLocalStart(request[1]!, tz);
    const proposedAt = exactLocalStart(request[2]!, tz);
    if (originalAt !== undefined && proposedAt !== undefined) return { kind: "request", originalAt, proposedAt };
  }
  return { kind: "format" };
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const SIMPLE_VOTE_YES = /^(?:yes|yeah|yep|yup|ya|sure|sounds?\s+good|works?(?:\s+for\s+me)?|that\s+works|perfect|great|ok|okay|fine\s+by\s+me|all\s+good|👍)[.!\s]*$/i;
const SIMPLE_VOTE_NO = /^(?:no|nope|nah|can'?t(?:\s+make\s+it)?|cannot|doesn'?t\s+work|won'?t\s+work|keep\s+(?:the\s+)?original|decline|pass)[.!\s]*$/i;
const NATURAL_RESCHEDULE_CUE = /\b(?:reschedule|re-schedule|move\s+(?:it|our|the|this)|push\s+(?:it|back|our|the)|shift\s+(?:it|our|the)|bump\s+(?:it|our|the)|change\s+(?:the\s+)?(?:time|day)|can\s+we\s+do|could\s+we\s+do|how\s+about|different\s+(?:time|day))\b/i;
const RELATIVE_SHIFT_RX = /\b(?:(an?|one|\d{1,2})\s*(?:hours?|hrs?|hr)\b|(?:(\d{1,2})\s*(?:minutes?|mins?|min|m)\b))\s*(later|back|earlier)\b/i;
const CLOCK_TIME_RX = /\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)\b|\b(?:at\s+)([01]?\d|2[0-3]):([0-5]\d)\b/i;
const DAYPART_HOUR: [RegExp, number][] = [
  [/\b(?:morning|breakfast)\b/i, 10],
  [/\b(?:noon|lunch|midday)\b/i, 12],
  [/\b(?:afternoon)\b/i, 15],
  [/\b(?:evening|dinner|tonight|night)\b/i, 19],
];
const DAY_REF_RX = /\b(today|tonight|tomorrow|tmrw|tmr|(?:next\s+)?(?:sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat))\b/i;
const ISO_PROPOSED_RX = /\b(\d{4}-\d{2}-\d{2})(?:\s+(?:at\s+)?|\s+)([01]?\d|2[0-3]):([0-5]\d)\b/i;

function parseClockHourMinute(text: string): { hour: number; minute: number } | undefined {
  const m = CLOCK_TIME_RX.exec(text);
  if (m) {
    if (m[1] !== undefined && m[3] !== undefined) {
      let hour = Number(m[1]);
      const minute = m[2] ? Number(m[2]) : 0;
      const mer = m[3].toLowerCase().startsWith("p") ? "pm" : "am";
      if (hour < 1 || hour > 12) return undefined;
      if (mer === "pm" && hour < 12) hour += 12;
      if (mer === "am" && hour === 12) hour = 0;
      return { hour, minute };
    }
    if (m[4] !== undefined && m[5] !== undefined) {
      return { hour: Number(m[4]), minute: Number(m[5]) };
    }
  }
  for (const [rx, hour] of DAYPART_HOUR) {
    if (rx.test(text)) return { hour, minute: 0 };
  }
  return undefined;
}

function addLocalDays(anchorMs: number, deltaDays: number, hour: number, minute: number, tz: string): number | undefined {
  const probe = localParts(anchorMs + deltaDays * DAY, tz);
  const candidate = fromLocal(probe.year, probe.month, probe.day, hour, tz) + minute * MINUTE;
  const check = localParts(candidate, tz);
  return check.year === probe.year && check.month === probe.month && check.day === probe.day
    && check.hour === hour && check.minute === minute ? candidate : undefined;
}

export interface NaturalRescheduleOptions {
  readonly nowMs: number;
  readonly tz?: string;
  readonly originalAt?: number;
  readonly openRef?: string;
}

/**
 * Natural-language reschedule parser layered cleanly over strict `parseRescheduleCommand`.
 * Deterministic (Clock-driven via `opts.nowMs`, never reads wall clock).
 */
export function parseNaturalReschedule(raw: string, opts: NaturalRescheduleOptions): RescheduleCommand | undefined {
  const tz = opts.tz ?? NY;
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return undefined;

  const strict = parseRescheduleCommand(text, tz);
  if (strict && strict.kind !== "format") return strict;

  if (opts.openRef) {
    if (SIMPLE_VOTE_YES.test(text)) return { kind: "vote", ref: opts.openRef, accepted: true };
    if (SIMPLE_VOTE_NO.test(text)) return { kind: "vote", ref: opts.openRef, accepted: false };
  }

  const hasCue = !!strict || NATURAL_RESCHEDULE_CUE.test(text);
  if (!hasCue) return undefined;
  if (opts.originalAt === undefined) return strict ? { kind: "format" } : undefined;

  const iso = ISO_PROPOSED_RX.exec(text);
  if (iso) {
    const hh = iso[2]!.padStart(2, "0");
    const proposedAt = exactLocalStart(`${iso[1]!} ${hh}:${iso[3]!}`, tz);
    if (proposedAt !== undefined && proposedAt > opts.nowMs && proposedAt !== opts.originalAt) {
      return { kind: "request", originalAt: opts.originalAt, proposedAt };
    }
  }

  const rel = RELATIVE_SHIFT_RX.exec(text);
  if (rel) {
    const dir = rel[3]!.toLowerCase() === "earlier" ? -1 : 1;
    const hours = rel[1] ? (rel[1].toLowerCase() === "a" || rel[1].toLowerCase() === "an" || rel[1].toLowerCase() === "one" ? 1 : Number(rel[1])) : 0;
    const mins = rel[2] ? Number(rel[2]) : 0;
    const deltaMs = dir * (hours * HOUR + mins * MINUTE);
    const proposedAt = opts.originalAt + deltaMs;
    if (deltaMs !== 0 && proposedAt > opts.nowMs) {
      return { kind: "request", originalAt: opts.originalAt, proposedAt };
    }
  }

  const dayMatch = DAY_REF_RX.exec(text);
  const clock = parseClockHourMinute(text);
  if (!dayMatch && !clock) return strict ? { kind: "format" } : undefined;

  const origLocal = localParts(opts.originalAt, tz);
  const nowLocal = localParts(opts.nowMs, tz);
  const hour = clock?.hour ?? origLocal.hour;
  const minute = clock?.minute ?? origLocal.minute;

  let proposedAt: number | undefined;
  if (dayMatch) {
    const token = dayMatch[1]!.toLowerCase();
    if (token === "today" || token === "tonight") {
      proposedAt = addLocalDays(opts.nowMs, 0, hour, minute, tz);
    } else if (token === "tomorrow" || token === "tmrw" || token === "tmr") {
      proposedAt = addLocalDays(opts.nowMs, 1, hour, minute, tz);
    } else {
      const explicitNext = token.startsWith("next ");
      const wdName = token.replace(/^next\s+/, "");
      const targetWd = WEEKDAY_INDEX[wdName];
      if (targetWd !== undefined) {
        let delta = (targetWd - nowLocal.weekday + 7) % 7;
        if (delta === 0) delta = 7;
        else if (explicitNext && delta < 4) delta += 7;
        proposedAt = addLocalDays(opts.nowMs, delta, hour, minute, tz);
      }
    }
  } else if (clock) {
    proposedAt = fromLocal(origLocal.year, origLocal.month, origLocal.day, hour, tz) + minute * MINUTE;
    if (proposedAt <= opts.nowMs) proposedAt = addLocalDays(opts.originalAt, 1, hour, minute, tz);
  }

  if (proposedAt !== undefined && proposedAt > opts.nowMs && proposedAt !== opts.originalAt) {
    return { kind: "request", originalAt: opts.originalAt, proposedAt };
  }
  return strict ? { kind: "format" } : undefined;
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
