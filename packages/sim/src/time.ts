import { CITY_TZ, DAY, HOUR, localParts as zoneParts, MINUTE, timeZoneOf, type City } from "@thenetwork/core";

export { CITY_TZ, timeZoneOf };

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

export function localParts(t: number, city: City | string): LocalParts {
  const p = zoneParts(t, timeZoneOf(city));
  return { ...p, weekday: (p.weekday + 1) % 7 };
}

export function localHour(t: number, city: City | string): number {
  const p = localParts(t, city);
  return p.hour + p.minute / 60;
}

export function inHourWindow(h: number, [start, end]: readonly [number, number]): boolean {
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

export function nextLocalHour(t: number, city: City | string, hour: number): number {
  const cur = localHour(t, city);
  let guess = t + (((hour - cur) + 24) % 24) * HOUR;
  for (let i = 0; i < 4 && Math.abs(localHour(guess, city) - hour) > 1 / 60; i++) {
    const diff = hour - localHour(guess, city);
    guess += (diff > 12 ? diff - 24 : diff < -12 ? diff + 24 : diff) * HOUR;
  }
  return guess < t ? guess + DAY : Math.max(t, Math.floor(guess / MINUTE) * MINUTE);
}

export function fmtLocal(t: number, city: City | string): string {
  const p = localParts(t, city);
  const d = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][p.weekday];
  return `${d} ${p.month}/${p.day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
