// Local wall-clock time in an IANA zone (DST-correct via Intl). Time is always a UTC epoch
// millisecond value read from a Clock (clock.ts); these helpers only interpret it. The one home for
// local-time parts, local-to-UTC conversion and quiet hours (engine, network, sim and worlds).
import { MINUTE } from "./clock.ts";
import { withinQuietHours } from "./generated/quietHours.ts";
import type { City } from "./types.ts";

export { withinQuietHours };

export const CITY_TZ: Record<City, string> = {
  sf: "America/Los_Angeles",
  nyc: "America/New_York",
  la: "America/Los_Angeles",
  chicago: "America/Chicago",
  miami: "America/New_York",
};

const dynamicCityTimezones = new Map<string, string>([
  ["sf", "America/Los_Angeles"],
  ["nyc", "America/New_York"],
  ["la", "America/Los_Angeles"],
  ["chicago", "America/Chicago"],
  ["miami", "America/New_York"],
]);

/** Register or update an IANA timezone for a city id (synced by registerCity). */
export function registerCityTimezone(city: string, tz: string): void {
  const key = city.trim().toLowerCase();
  const zone = tz.trim();
  if (!key || !zone) return;
  dynamicCityTimezones.set(key, zone);
}

/** Fail-closed city timezone lookup; returns undefined for unregistered cities. */
export function cityTimezone(city: string | undefined | null): string | undefined {
  if (!city) return undefined;
  return dynamicCityTimezones.get(city.trim().toLowerCase());
}

/** Local date and time parts. `weekday`: Monday = 0 ... Sunday = 6. */
export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }
const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};
const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function localParts(ts: number, tz: string): LocalParts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const parts = f.formatToParts(ts);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let weekday = -1;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    switch (part.type) {
      case "year": year = +part.value; break;
      case "month": month = +part.value; break;
      case "day": day = +part.value; break;
      case "hour": hour = +part.value % 24; break;
      case "minute": minute = +part.value; break;
      case "weekday": weekday = WEEKDAY_INDEX[part.value] ?? -1; break;
    }
  }
  return { year, month, day, hour, minute, weekday };
}

/** Resolve a local wall-clock hour to UTC. Round fractional hours to minutes before applying the zone offset. */
export function fromLocal(y: number, mo: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, 0, Math.round(h * 60));
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
  const { hour, minute } = localParts(ts, tz);
  return withinQuietHours(hour + minute / 60, s, e);
}
