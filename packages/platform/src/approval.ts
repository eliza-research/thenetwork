// Soft approval at join (PRD 28.3, 8.1: "automatic with soft approval; only flagged cases queued").
// Every join is let in. A join that a rule flags still onboards, but its member is never matched
// until staff clear the flag (GET /flags, POST /flags/:id on the service). The rules:
//  - a burst from one place: 5 or more joins from one IPv4 /24 (or one IPv6 /64) in 10 minutes;
//  - a burst from one block of numbers: 3 or more joins from numbers in one 1000-block (+1 212 555 0xxx) in an hour;
//  - risk words in what the person wrote at join (payment apps, crypto, promotion, links).
// A VoIP-looking number is not a rule yet: the number alone does not show it (it needs the carrier
// lookup, which is not built). Counters are keyed hashes, never a raw IP or number.
import { MINUTE, HOUR } from "../../core/src/clock.ts";
import { ipBucket } from "./otp.ts";
import { keyedHash } from "./phone.ts";
import type { PeopleStore } from "./store.ts";

export const FLAG_RULES = { perPlace: 5, placeWindowMs: 10 * MINUTE, perBlock: 3, blockWindowMs: HOUR };

export type FlagReason = "ip_burst" | "number_block_burst" | "risk_words";

/** Words that, at join, read like a scam, a sales pitch or a bot (never a reason on their own to refuse). */
const RISK = /\b(?:cash ?app|venmo|zelle|paypal|crypto|bitcoin|btc|usdt|forex|investments?|investing|onlyfans|telegram|whats ?app|sugar ?(?:daddy|baby|mommy)|escort|promo(?:tion)?|followers|dm me|link in bio|giveaway)\b|https?:\/\/|\bwww\./i;
export const riskWords = (text: string | undefined) => !!text && RISK.test(text.normalize("NFKC"));

/** The place of a client address: an IPv4 /24 ("203.0.113") or an IPv6 /64. */
export function placeOf(ip: string): string {
  const b = ipBucket(ip);
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(b) ? b.split(".").slice(0, 3).join(".") : b;
}

/**
 * Count this join against the rules and return the reasons it is flagged (empty: not flagged).
 * Call it once per join that is about to be stored.
 */
export async function joinFlags(store: PeopleStore, hashKey: string, j: { e164: string; ip?: string; text?: string }, at: number): Promise<FlagReason[]> {
  const out: FlagReason[] = [];
  if (j.ip && j.ip !== "unknown") {
    const r = await store.hit(`join:place:${keyedHash(hashKey, `place:${placeOf(j.ip)}`)}`, FLAG_RULES.placeWindowMs, at);
    if (r.count >= FLAG_RULES.perPlace) out.push("ip_burst");
  }
  const block = await store.hit(`join:block:${keyedHash(hashKey, `block:${j.e164.slice(0, -3)}`)}`, FLAG_RULES.blockWindowMs, at);
  if (block.count >= FLAG_RULES.perBlock) out.push("number_block_burst");
  if (riskWords(j.text)) out.push("risk_words");
  return out;
}
