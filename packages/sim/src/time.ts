// Local-time helpers for SF and NYC (DST-correct via Intl). Simulated time is always a
// UTC epoch millisecond value read from a Clock; these helpers only interpret it.
import { DAY, HOUR, MINUTE, type City } from "@thenetwork/core";

export const CITY_TZ: Record<City, string> = { sf: "America/Los_Angeles", nyc: "America/New_York" };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(t: number, city: City): LocalParts {
  const parts = Object.fromEntries(fmt(CITY_TZ[city]).formatToParts(new Date(t)).map(p => [p.type, p.value]));
  return {
    year: +parts.year!, month: +parts.month!, day: +parts.day!,
    hour: +parts.hour! % 24, minute: +parts.minute!, weekday: WD[parts.weekday!] ?? 0,
  };
}

/** Fractional local hour, e.g. 13.5 for 1:30pm. */
export function localHour(t: number, city: City): number {
  const p = localParts(t, city);
  return p.hour + p.minute / 60;
}

export const isWeekend = (t: number, city: City) => { const w = localParts(t, city).weekday; return w === 0 || w === 6; };

/** True if local hour h is inside [start, end) with wrap-around past midnight. */
export function inHourWindow(h: number, [start, end]: readonly [number, number]): boolean {
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/**
 * The next instant >= t whose local hour in `city` is >= `hour` (minute resolution search,
 * bounded to 2 days). Used to push persona actions out of sleep and to plan daily runs.
 */
export function nextLocalHour(t: number, city: City, hour: number): number {
  const cur = localHour(t, city);
  let guess = t + (((hour - cur) + 24) % 24) * HOUR;
  // DST transitions can shift by an hour; nudge until correct.
  for (let i = 0; i < 4 && Math.abs(localHour(guess, city) - hour) > 1 / 60; i++) {
    const diff = hour - localHour(guess, city);
    guess += (diff > 12 ? diff - 24 : diff < -12 ? diff + 24 : diff) * HOUR;
  }
  // Never return an instant before t (localHour drops seconds, so flooring can step back).
  return guess < t ? guess + DAY : Math.max(t, Math.floor(guess / MINUTE) * MINUTE);
}

/** Push t forward to the end of a [start,end) local-hour window if it falls inside it. */
export function deferOutOf(t: number, city: City, window: readonly [number, number]): number {
  const h = localHour(t, city);
  return inHourWindow(h, window) ? nextLocalHour(t, city, window[1]) : t;
}

export function fmtLocal(t: number, city: City): string {
  const p = localParts(t, city);
  const d = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday];
  return `${d} ${p.month}/${p.day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
