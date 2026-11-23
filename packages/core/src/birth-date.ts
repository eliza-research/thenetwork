import { HOUR } from "./clock.ts";

const ISO_BIRTH_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const keyOfParts = (year: number, month: number, day: number): number => year * 10000 + month * 100 + day;

const utcDayKeyOf = (ms: number): number => {
  const date = new Date(ms);
  return keyOfParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

export const earliestDayKeyOf = (ms: number): number => utcDayKeyOf(ms - 12 * HOUR);

export const latestDayKeyOf = (ms: number): number => utcDayKeyOf(ms + 14 * HOUR);

export function parseIsoBirthDate(text: string): number | undefined {
  const match = ISO_BIRTH_DATE.exec(text);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? keyOfParts(year, month, day) : undefined;
}

export function birthKeyText(key: number): string {
  const year = Math.trunc(key / 10000);
  const month = Math.trunc(key / 100) % 100;
  const day = key % 100;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
