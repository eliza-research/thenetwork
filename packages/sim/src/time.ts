// Local-time helpers for the simulated cities (DST-correct via Intl). Simulated time is always a UTC
// epoch millisecond value read from a Clock; these helpers only interpret it. The zone table and the
// local-time parts are core's (packages/core/src/time.ts); this module keys them by city.
import { CITY_TZ, DAY, HOUR, localParts as zoneParts, MINUTE, type City } from "@thenetwork/core";

export { CITY_TZ };

/** Local parts in a city. Unlike core's, `weekday` is JavaScript's: Sunday = 0 ... Saturday = 6. */
export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

export function localParts(t: number, city: City): LocalParts {
  const p = zoneParts(t, CITY_TZ[city]);
  return { ...p, weekday: (p.weekday + 1) % 7 };
}

/** Fractional local hour, e.g. 13.5 for 1:30pm. */
export function localHour(t: number, city: City): number {
  const p = localParts(t, city);
  return p.hour + p.minute / 60;
}

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

export function fmtLocal(t: number, city: City): string {
  const p = localParts(t, city);
  const d = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday];
  return `${d} ${p.month}/${p.day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
