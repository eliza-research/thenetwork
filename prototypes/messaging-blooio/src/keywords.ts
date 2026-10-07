// STOP / HELP / START handling and the consent ledger (PRD 32.2, 36.1; CTIA keyword conventions).
//
// Rules:
//  - Exact-match only after normalization ("stop", "STOP!", " Stop. " match; "stop by later" does not), so
//    ordinary conversation is never misread as an opt-out.
//  - Opt-out is effective immediately on that channel+address and is recorded with time and source keyword.
//  - "YES" is deliberately NOT an opt-in keyword: members answer "yes" to opportunities all the time.
//  - Blooio iMessage is P2P (not A2P 10DLC), and Blooio does not run a global suppression list for us
//    (docs/research/blooio.md), so the Network owns this ledger for every channel.

import type { ConsentStore } from "./consent-store.ts";
import { normalizeAddress } from "./phone.ts";
import type { ChannelKind, Clock } from "./types.ts";

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT", "STOP ALL"];
export const START_WORDS = ["START", "UNSTOP", "SUBSCRIBE", "RESUME"];
export const HELP_WORDS = ["HELP", "INFO"];

export type KeywordAction = "opt_out" | "opt_in" | "help";

export function normalizeKeyword(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ") // drop punctuation/emoji
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function detectKeyword(text: string): KeywordAction | null {
  const k = normalizeKeyword(text);
  if (!k) return null;
  if (STOP_WORDS.includes(k)) return "opt_out";
  if (START_WORDS.includes(k)) return "opt_in";
  if (HELP_WORDS.includes(k)) return "help";
  return null;
}

export interface KeywordCopy { optOut: string; optIn: string; help: string }

export function defaultCopy(supportContact = "help@ntwrk.love"): KeywordCopy {
  return {
    optOut: "You're unsubscribed from The Network and won't get more messages here. Reply START to resume.",
    optIn: "You're back on The Network. Reply STOP anytime to opt out, HELP for help.",
    help: `The Network: invite-only messages about people, plans, and events you asked for. Message frequency varies. Reply STOP to opt out. Help: ${supportContact}`,
  };
}

export interface ConsentEntry {
  channel: ChannelKind;
  address: string;
  state: "opted_in" | "opted_out";
  at: number;
  source: string; // keyword, "invite_acceptance", "admin", ...
  wording?: string; // the consent text shown at opt-in
}

/**
 * Consent is tracked per address across channels by default: STOP on iMessage also stops SMS fallback to that number.
 * Addresses are normalized to E.164 (phones) so formatting variants share one entry. Pass a `ConsentStore`
 * (e.g. `FileConsentStore`) to make opt-outs survive a restart; without one the ledger is memory-only.
 */
export class ConsentLedger {
  #current = new Map<string, ConsentEntry>();
  readonly history: ConsentEntry[] = [];

  constructor(private clock: Clock, private scope: "address" | "channel_address" = "address", private store?: ConsentStore) {
    for (const e of store?.load() ?? []) {
      const n = { ...e, address: normalizeAddress(e.address) };
      this.#current.set(this.#key(n.channel, n.address), n);
      this.history.push(n);
    }
  }

  #key(channel: ChannelKind, address: string) {
    const a = normalizeAddress(address);
    return this.scope === "address" ? a : `${channel}:${a}`;
  }

  record(channel: ChannelKind, address: string, state: ConsentEntry["state"], source: string, wording?: string): ConsentEntry {
    const e: ConsentEntry = { channel, address: normalizeAddress(address), state, at: this.clock.now(), source, wording };
    this.store?.append(e); // durable first: if this throws, the in-memory state is unchanged and the caller sees it
    this.#current.set(this.#key(channel, address), e);
    this.history.push(e);
    return e;
  }

  isOptedOut(channel: ChannelKind, address: string): boolean {
    return this.#current.get(this.#key(channel, address))?.state === "opted_out";
  }

  hasConsent(channel: ChannelKind, address: string): boolean {
    return this.#current.get(this.#key(channel, address))?.state === "opted_in";
  }

  get(channel: ChannelKind, address: string): ConsentEntry | undefined {
    return this.#current.get(this.#key(channel, address));
  }
}

export interface KeywordOutcome { action: KeywordAction; reply: string | null }

/**
 * Apply a keyword. Returns null for non-keyword text (pass to the agent).
 * Replies are suppressed in group chats (we must not post compliance copy into a group); the opt-out still applies
 * to the sender. A HELP from an opted-out address still gets the help text (allowed and expected by carriers).
 */
export function handleKeyword(
  ledger: ConsentLedger,
  copy: KeywordCopy,
  msg: { channel: ChannelKind; from: string; text: string; isGroup: boolean },
): KeywordOutcome | null {
  const action = detectKeyword(msg.text);
  if (!action) return null;
  const word = normalizeKeyword(msg.text);
  if (action === "opt_out") {
    ledger.record(msg.channel, msg.from, "opted_out", `keyword:${word}`);
    return { action, reply: msg.isGroup ? null : copy.optOut };
  }
  if (action === "opt_in") {
    ledger.record(msg.channel, msg.from, "opted_in", `keyword:${word}`, "START keyword");
    return { action, reply: msg.isGroup ? null : copy.optIn };
  }
  return { action, reply: msg.isGroup ? null : copy.help };
}
