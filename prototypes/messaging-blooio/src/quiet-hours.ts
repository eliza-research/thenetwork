// Quiet hours in the recipient's local time zone (PRD 32.2, 32.9, 36.1).
// Default window 21:00-09:00 local: the PRD's "not after 9pm" example, inside Blooio's suggested 8am-8pm-ish
// sending window for new conversations. Replies to a member's own message and compliance replies are exempt.

export interface QuietWindow {
  /** Local hour (0-23) quiet hours start. */
  startHour: number;
  /** Local hour (0-23) quiet hours end (exclusive). */
  endHour: number;
}

export const DEFAULT_QUIET: QuietWindow = { startHour: 21, endHour: 9 };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Local minutes since midnight in `tz`. Throws RangeError for an invalid IANA zone. */
export function localMinutes(ms: number, tz: string): number {
  const parts = fmt(tz).formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return h * 60 + m;
}

export function isQuietAt(ms: number, tz: string, w: QuietWindow = DEFAULT_QUIET): boolean {
  if (w.startHour === w.endHour) return false;
  const mins = localMinutes(ms, tz);
  const start = w.startHour * 60, end = w.endHour * 60;
  return start < end ? mins >= start && mins < end : mins >= start || mins < end;
}

/** The first instant at or after `ms` that is outside quiet hours (minute precision, DST-safe by re-checking). */
export function nextAllowedAt(ms: number, tz: string, w: QuietWindow = DEFAULT_QUIET): number {
  if (!isQuietAt(ms, tz, w)) return ms;
  const mins = localMinutes(ms, tz);
  const end = w.endHour * 60;
  const until = mins < end ? end - mins : 24 * 60 - mins + end;
  // Align to the start of the minute, jump, then nudge across any DST hour shift.
  let t = ms - (ms % 60_000) + until * 60_000;
  for (let i = 0; i < 8 && isQuietAt(t, tz, w); i++) t += 15 * 60_000;
  while (t - 60_000 > ms && !isQuietAt(t - 60_000, tz, w)) t -= 60_000; // pull back if DST made us overshoot
  return t;
}

/** Fallback zone when a member's zone is unknown: derive from the city they joined in. */
export const CITY_TZ: Record<string, string> = { sf: "America/Los_Angeles", nyc: "America/New_York" };

/** True if `tz` is an IANA zone this runtime understands. Never throws. */
export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz || typeof tz !== "string") return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone to use for quiet hours: the member's own zone if valid, else the zone of their city, else null
 * (the caller must not send agent-initiated messages to someone whose local time it cannot compute).
 */
export function resolveTimeZone(tz: string | undefined, city?: string): string | null {
  if (isValidTimeZone(tz)) return tz;
  const byCity = city ? CITY_TZ[city.toLowerCase()] : undefined;
  return isValidTimeZone(byCity) ? byCity : null;
}
