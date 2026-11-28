import type { NetworkEvent } from "./types.ts";

const EXPLICIT_EVENT_MIN_AGES = [
  /\b(\d{1,3})\s*(?:(?:years?|yrs?)(?:\s+old)?\s+)?(?:\+|(?:and|or|&)\s*(?:older|up|over))/gi,
  /\b(?:minimum|min\.?)\s+age\s*:?\s*(\d{1,3})\b/gi,
];
const EVENT_AGE_RANGE = /\bages?\s*:?\s*(\d{1,3})\s*(?:[-–—]|\bto\b)\s*(\d{1,3})\b/gi;

export function listedEventMinimumAge(event: Pick<NetworkEvent, "title" | "tags">): number {
  const words = [event.title, ...event.tags].join(" ");
  const explicit = EXPLICIT_EVENT_MIN_AGES.flatMap(re => [...words.matchAll(re)].map(m => Number(m[1])));
  const ranged = [...words.matchAll(EVENT_AGE_RANGE)]
    .flatMap(m => Number(m[1]) <= Number(m[2]) ? [Number(m[1])] : []);
  return Math.max(/\b(?:adults?[ -]only|for adults)\b/i.test(words) ? 18 : 0, ...explicit, ...ranged);
}
