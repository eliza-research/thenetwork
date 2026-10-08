// Task tokens: short references printed in a prefilled prompt ("Ask The Network for update T-7F3K9Q").
// They are references, not credentials. Access always comes from the assistant's OAuth grant: the
// caller's person id comes from that grant, never from the token. A token held by anyone else gets
// the same generic "no update" as an unknown token. A token only selects what to show; it never
// takes an action. Redeeming one tells us which surface the member used and that the link worked.

import { randomInt } from "node:crypto";
import type { Surface } from "./types.ts";

/** Crockford-style alphabet without 0/1/I/L/O/U, so tokens survive being read aloud or retyped. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TOKEN_LENGTH = 6;
export const TOKEN_TTL_MS = 7 * 24 * 3600_000;
export const TOKEN_PATTERN = /^T-[2-9A-HJKMNP-TV-Z]{6}$/;

export interface TaskToken {
  token: string;
  personId: string;
  itemIds: string[];
  issuedAt: number;
  expiresAt: number;
  redeemedAt?: number;
  redeemedOn?: Surface;
}

export function newToken(rand: (max: number) => number = randomInt): string {
  let s = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) s += ALPHABET[rand(ALPHABET.length)];
  return `T-${s}`;
}

/** Pull a token out of free text the assistant passes along ("update T-7F3K9Q please"). */
export function findToken(text: string): string | undefined {
  const m = text.toUpperCase().match(/\bT-[2-9A-HJKMNP-TV-Z]{6}\b/);
  return m?.[0];
}
