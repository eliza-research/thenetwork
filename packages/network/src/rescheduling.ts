import { classifyYesNo, DAY, fromLocal, HOUR, localParts, MINUTE, type MemberId } from "@thenetwork/core";
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

const NATURAL_DAY_TOKEN = "sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|today|tomorrow|tmrw|tmr";
const NATURAL_TIME_TOKEN = "\\d{1,2}(?::[0-5]\\d)?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?";
const NATURAL_RESCHEDULE_WITH_ORIG = new RegExp(
  `^(?:(?:can|could)\\s+we\\s+|please\\s+|let'?s\\s+)?(?:move|push|reschedule|shift|change)\\s+(?:(?:my|our|the)\\s+(?:meeting|meetup|date|plan)\\s+(?:on|from)\\s+)?(?<origDay>${NATURAL_DAY_TOKEN})(?:\\s+(?:at\\s+)?(?<origTime>${NATURAL_TIME_TOKEN}))?\\s+to\\s+(?<propDay>${NATURAL_DAY_TOKEN})(?:\\s+(?:at\\s+)?(?<propTime>${NATURAL_TIME_TOKEN}))?\\s*[.!?]*$`,
  "i",
);
const NATURAL_RESCHEDULE_SINGLE = new RegExp(
  `^(?:(?:can|could)\\s+we\\s+|please\\s+|let'?s\\s+)?(?:move|push|reschedule|shift|change)\\s+(?:my|our|the|it)(?:\\s+(?:meeting|meetup|date|plan))?\\s+to\\s+(?<propDay>${NATURAL_DAY_TOKEN})(?:\\s+(?:at\\s+)?(?<propTime>${NATURAL_TIME_TOKEN}))?\\s*[.!?]*$`,
  "i",
);

const DAY_TO_LOCAL_WEEKDAY: Record<string, number> = {
  mon: 0, monday: 0,
  tue: 1, tues: 1, tuesday: 1,
  wed: 2, weds: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3,
  fri: 4, friday: 4,
  sat: 5, saturday: 5,
  sun: 6, sunday: 6,
};

function parse12hClock(raw: string, preferEvening = true): { hour: number; minute: number } | undefined {
  const m = /^(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?$/i.exec(raw.trim());
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.replace(/\./g, "").toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else {
    if (hour > 23) return undefined;
    if (hour >= 1 && hour <= 7) hour += 12;
    else if (preferEvening && hour >= 8 && hour <= 10) hour += 12;
  }
  return { hour, minute };
}

function resolveNaturalDayTarget(dayToken: string, now: number, tz: string): { weekday: number; dayOffset?: number } | undefined {
  const key = dayToken.toLowerCase();
  const lp = localParts(now, tz);
  if (key === "today") return { weekday: lp.weekday, dayOffset: 0 };
  if (key === "tomorrow" || key === "tmrw" || key === "tmr") return { weekday: (lp.weekday + 1) % 7, dayOffset: 1 };
  const weekday = DAY_TO_LOCAL_WEEKDAY[key];
  return weekday === undefined ? undefined : { weekday };
}

function nextLocalOccurrence(
  dayToken: string,
  clock: { hour: number; minute: number },
  anchorMs: number,
  tz: string,
  minMs: number,
): number | undefined {
  const target = resolveNaturalDayTarget(dayToken, anchorMs, tz);
  if (!target) return undefined;
  const lp = localParts(anchorMs, tz);
  const startOffset = target.dayOffset ?? ((target.weekday - lp.weekday + 7) % 7);
  for (let step = startOffset; step <= 14; step += target.dayOffset !== undefined ? 15 : 7) {
    const day = new Date(Date.UTC(lp.year, lp.month - 1, lp.day + step));
    const two = (n: number) => String(n).padStart(2, "0");
    const stamp = `${day.getUTCFullYear()}-${two(day.getUTCMonth() + 1)}-${two(day.getUTCDate())} ${two(clock.hour)}:${two(clock.minute)}`;
    const at = exactLocalStart(stamp, tz);
    if (at !== undefined && at > minMs) return at;
  }
  return undefined;
}

/** Parse a natural 12-hour reschedule request ("move Thursday to Friday at 7", "can we push Friday to Saturday at 6:30pm"). */
export function parseNaturalRescheduleRequest(
  raw: string,
  now: number,
  tz: string = NY,
  bookings?: readonly { meetingAt?: number }[],
): Extract<RescheduleCommand, { kind: "request" }> | undefined {
  const text = raw.trim().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
  const withOrig = NATURAL_RESCHEDULE_WITH_ORIG.exec(text);
  const single = withOrig ? undefined : NATURAL_RESCHEDULE_SINGLE.exec(text);
  const match = withOrig ?? single;
  if (!match?.groups?.propDay) return undefined;

  const upcoming = (bookings ?? [])
    .map(b => b.meetingAt)
    .filter((at): at is number => typeof at === "number" && at > now);

  let originalAt: number | undefined;
  let origEvening = true;

  if (withOrig?.groups?.origDay) {
    const origTarget = resolveNaturalDayTarget(withOrig.groups.origDay, now, tz);
    if (!origTarget) return undefined;
    const origClock = withOrig.groups.origTime ? parse12hClock(withOrig.groups.origTime, true) : undefined;
    if (withOrig.groups.origTime && !origClock) return undefined;
    if (bookings) {
      const matching = upcoming.filter(at => {
        const lp = localParts(at, tz);
        if (lp.weekday !== origTarget.weekday) return false;
        if (origTarget.dayOffset !== undefined) {
          const nowLp = localParts(now, tz);
          const expected = new Date(Date.UTC(nowLp.year, nowLp.month - 1, nowLp.day + origTarget.dayOffset));
          if (lp.year !== expected.getUTCFullYear() || lp.month !== expected.getUTCMonth() + 1 || lp.day !== expected.getUTCDate()) return false;
        }
        if (origClock && (lp.hour !== origClock.hour || lp.minute !== origClock.minute)) return false;
        return true;
      });
      if (matching.length !== 1) return undefined;
      originalAt = matching[0]!;
    } else {
      const fallbackClock = origClock ?? (match.groups.propTime ? parse12hClock(match.groups.propTime, true) : undefined) ?? { hour: 19, minute: 0 };
      originalAt = nextLocalOccurrence(withOrig.groups.origDay, fallbackClock, now, tz, now);
    }
  } else {
    if (upcoming.length !== 1) return undefined;
    originalAt = upcoming[0]!;
  }

  if (originalAt === undefined) return undefined;
  const origParts = localParts(originalAt, tz);
  origEvening = origParts.hour >= 16;
  const propClock = match.groups.propTime
    ? parse12hClock(match.groups.propTime, origEvening)
    : { hour: origParts.hour, minute: origParts.minute };
  if (!propClock) return undefined;

  const proposedAt = nextLocalOccurrence(match.groups.propDay, propClock, now, tz, now);
  if (proposedAt === undefined || proposedAt === originalAt) return undefined;
  // Keep natural proposals within a reasonable 14-day horizon from originalAt/now.
  if (proposedAt > Math.max(now, originalAt) + 14 * DAY) return undefined;
  return { kind: "request", originalAt, proposedAt };
}

/** Accept a bare YES/NO reply when a member has exactly one pending reschedule offer. */
export function parseSingleOfferRescheduleVote(
  raw: string,
  pendingOfferRefs: readonly string[],
): Extract<RescheduleCommand, { kind: "vote" }> | undefined {
  if (pendingOfferRefs.length !== 1) return undefined;
  const text = raw.trim();
  if (!text || text.length > 40) return undefined;
  const answer = classifyYesNo(text);
  if (answer === "yes") return { kind: "vote", accepted: true, ref: pendingOfferRefs[0]! };
  if (answer === "no") return { kind: "vote", accepted: false, ref: pendingOfferRefs[0]! };
  return undefined;
}

/** A repeated or nonexistent local wall time cannot identify an exact meeting start. */
function exactLocalStart(value: string, tz: string = NY): number | undefined {
  const [year, month, day, hour, minute] = value.split(/[- :]/).map(Number) as [number, number, number, number, number];
  const at = fromLocal(year, month, day, hour, tz) + minute * MINUTE;
  return localBookingStart(at, tz) === value && localBookingStart(at - HOUR, tz) !== value && localBookingStart(at + HOUR, tz) !== value ? at : undefined;
}

export interface RescheduleParseContext {
  now?: number;
  bookings?: readonly { meetingAt?: number }[];
  pendingOfferRefs?: readonly string[];
}

export function parseRescheduleCommand(raw: string, tz: string = NY, ctx?: RescheduleParseContext): RescheduleCommand | undefined {
  const text = raw.trim().replace(/\s+/g, " ");
  if (/^RESCHEDULE\b/i.test(text)) {
    const vote = VOTE.exec(text);
    if (vote) return { kind: "vote", accepted: vote[1]!.toLowerCase() === "yes", ref: vote[2]!.toLowerCase() };
    const request = REQUEST.exec(text);
    if (request) {
      const originalAt = exactLocalStart(request[1]!, tz);
      const proposedAt = exactLocalStart(request[2]!, tz);
      if (originalAt !== undefined && proposedAt !== undefined) return { kind: "request", originalAt, proposedAt };
    }
    if (ctx?.now !== undefined) {
      const natural = parseNaturalRescheduleRequest(text, ctx.now, tz, ctx.bookings);
      if (natural) return natural;
    }
    return { kind: "format" };
  }
  if (ctx?.pendingOfferRefs?.length === 1) {
    const singleVote = parseSingleOfferRescheduleVote(text, ctx.pendingOfferRefs);
    if (singleVote) return singleVote;
  }
  if (ctx?.now !== undefined) {
    const natural = parseNaturalRescheduleRequest(text, ctx.now, tz, ctx.bookings);
    if (natural) return natural;
  }
  return undefined;
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
