import type { NetworkEvent } from "./types.ts";

/** Parse an explicit age minimum from the listing fields the importer publishes. */
export function listedEventMinimumAge(event: Pick<NetworkEvent, "title" | "tags">): number {
  const words = [event.title, ...event.tags].join(" ");
  const explicit = [...words.matchAll(/\b(\d{1,3})\s*(?:\+|and (?:older|up|over)|or (?:older|over))/gi)].map(m => Number(m[1]));
  return Math.max(/\b(?:adults?[ -]only|for adults)\b/i.test(words) ? 18 : 0, ...explicit);
}
