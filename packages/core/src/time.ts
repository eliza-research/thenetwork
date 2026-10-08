// Local wall-clock time in an IANA zone (DST-correct via Intl). Time is always a UTC epoch
// millisecond value read from a Clock (clock.ts); these helpers only interpret it. The one home for
// local-time parts, local-to-UTC conversion and quiet hours (engine, network, sim and worlds).
import { MINUTE } from "./clock.ts";
import type { City } from "./types.ts";

export const CITY_TZ: Record<City, string> = { sf: "America/Los_Angeles", nyc: "America/New_York", la: "America/Los_Angeles" };

/** Local date and time parts. `weekday`: Monday = 0 ... Sunday = 6. */
export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }
const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function localParts(ts: number, tz: string): LocalParts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday!);
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! % 24, minute: +p.minute!, weekday: wd };
}

/** UTC timestamp of a local wall-clock time (handles DST via a two-step offset correction). */
export function fromLocal(y: number, mo: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h);
  const off = (ts: number) => { const p = localParts(ts, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ts / MINUTE) * MINUTE; };
  let ts = guess - off(guess);
  ts = guess - off(ts);
  // A wall-clock time inside a spring-forward gap does not exist: use the first instant after the
  // gap (02:30 -> 03:00), not an hour early (engine-attention-plans-17).
  const local = (t: number) => { const p = localParts(t, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute); };
  for (let i = 0; i < 12 && local(ts) < guess; i++) ts = Math.floor(ts / (15 * MINUTE)) * 15 * MINUTE + 15 * MINUTE;
  return ts;
}

/** True if `ts` falls in local quiet hours [s, e) (wrapping past midnight); s === e means none. */
export function inQuietHours(ts: number, tz: string, [s, e]: [number, number]): boolean {
  if (s === e) return false;
  const h = localParts(ts, tz).hour;
  return s < e ? h >= s && h < e : h >= s || h < e;
}
