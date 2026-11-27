import { LeakGuard, type LeakGuardOptions } from "./guard.ts";

export const CALENDAR_ICS_PATH_PREFIX = "/cal/";
export const CALENDAR_DEFAULT_DURATION_MS = 90 * 60_000;

const TEXT_ENCODER = new TextEncoder();
const INTERNAL_ID_RE = /\b(?:(?:mem|opp|act|rcp|grt|prp|dcr|vv|ma|rsvp|ep|plan|ntf|mcp|grant|ntwa|ntwr|ntwc|ntws|ven|ext|mm|tkt)_[a-z0-9_-]{3,}|nw-\d+-\d+)\b/i;

export interface MeetupIcsInput {
  uid: string;
  dtstampMs: number;
  startMs: number;
  endMs?: number;
  summary: string;
  location: string;
  description?: string;
  sequence?: number;
  leakOptions?: LeakGuardOptions;
}

export class MeetupIcsLeakError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(`Calendar invite blocked by leak check (${reasons.join(", ")})`);
    this.name = "MeetupIcsLeakError";
    this.reasons = [...reasons];
  }
}

export interface CalendarTokenPayload {
  app: string;
  oppId: string;
  memberId: string;
  exp: number;
  rev?: number;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function sanitizeUid(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9@._-]/g, "");
  return cleaned.length >= 4 ? cleaned : "meetup@thenetwork.invalid";
}

function formatUtcIcs(ms: number): string {
  if (!Number.isFinite(ms)) throw new RangeError("ICS timestamp must be finite");
  return new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const ch of line) {
    const width = TEXT_ENCODER.encode(ch).length;
    if (bytes + width > 75) {
      parts.push(part);
      part = " ";
      bytes = 1;
    }
    part += ch;
    bytes += width;
  }
  return [...parts, part].join("\r\n");
}

export function checkMeetupIcsLeaks(input: Pick<MeetupIcsInput, "summary" | "description" | "leakOptions">): string[] {
  const guard = new LeakGuard({
    contacts: true,
    canaryShapes: true,
    ...input.leakOptions,
  });
  const fields = [input.summary, ...(input.description ? [input.description] : [])];
  const reasons = new Set<string>();
  for (const field of fields) {
    for (const reason of guard.check(field)) reasons.add(reason);
    if (INTERNAL_ID_RE.test(field)) reasons.add("internal:id");
  }
  if (fields.length > 1) {
    for (const reason of guard.check(fields.join(" "))) reasons.add(reason);
  }
  return [...reasons];
}

export function buildMeetupIcs(input: MeetupIcsInput): string {
  const leaks = checkMeetupIcsLeaks(input);
  if (leaks.length) throw new MeetupIcsLeakError(leaks);
  const startMs = Math.floor(input.startMs);
  const endMs = input.endMs !== undefined && input.endMs > startMs
    ? Math.floor(input.endMs)
    : startMs + CALENDAR_DEFAULT_DURATION_MS;
  const dtstampMs = Math.floor(input.dtstampMs);
  const sequence = input.sequence !== undefined && Number.isSafeInteger(input.sequence) && input.sequence >= 0
    ? input.sequence
    : 0;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Network//Meetup//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${sanitizeUid(input.uid)}`,
    `DTSTAMP:${formatUtcIcs(dtstampMs)}`,
    `DTSTART:${formatUtcIcs(startMs)}`,
    `DTEND:${formatUtcIcs(endMs)}`,
    `SEQUENCE:${sequence}`,
    `SUMMARY:${escapeIcsText(input.summary.trim() || "The Network meetup")}`,
    `LOCATION:${escapeIcsText(input.location.trim())}`,
    ...(input.description?.trim() ? [`DESCRIPTION:${escapeIcsText(input.description.trim())}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ];
  return lines.map(foldIcsLine).join("\r\n");
}

export function isOwnCalendarIcsUrl(url: string, domain: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  const expected = domain.toLowerCase();
  if (host !== expected && !host.endsWith(`.${expected}`)) return false;
  if (parsed.search || parsed.hash) return false;
  return /^\/cal\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.ics$/.test(parsed.pathname);
}
