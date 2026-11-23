import { HOUR } from "./clock.ts";

const keyOfParts = (year: number, month: number, day: number): number => year * 10000 + month * 100 + day;

const utcDayKeyOf = (ms: number): number => {
  const date = new Date(ms);
  return keyOfParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

const EARTH_EARLIEST_OFFSET = -12 * HOUR;

const EARTH_LATEST_OFFSET = 14 * HOUR;

export const earliestDayKeyOf = (ms: number): number => utcDayKeyOf(ms + EARTH_EARLIEST_OFFSET);

export const latestDayKeyOf = (ms: number): number => utcDayKeyOf(ms + EARTH_LATEST_OFFSET);

export function birthKeyOfParts(year: number, month: number, day: number): number | undefined {
  if (![year, month, day].every(Number.isSafeInteger) || year < 0 || year > 9999) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? keyOfParts(year, month, day) : undefined;
}
