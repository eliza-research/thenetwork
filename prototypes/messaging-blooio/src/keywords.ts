// STOP / HELP / START handling and the consent ledger (PRD 32.2, 36.1; CTIA keyword conventions).
//
// Rules:
//  - Keywords match exactly after normalization ("stop", "STOP!", " Stop. " match; "stop by later?" does not).
//  - Free-text and Spanish opt-outs ("please stop texting me", "no me escribas más") are honored too (TCPA
//    "reasonable means", audit plugin-prototypes-12). The shared parser `parseOptOut` in packages/core reads them,
//    so the Network and this handler agree. The member gets one confirmation, in Spanish for a Spanish opt-out.
//  - Opt-out is effective immediately on that channel+address and is recorded with time and source keyword.
//  - "YES" is deliberately NOT an opt-in keyword: members answer "yes" to opportunities all the time.
//  - Blooio iMessage is P2P (not A2P 10DLC), and Blooio does not run a global suppression list for us
//    (docs/research/blooio.md), so the Network owns this ledger for every channel.

import type { ConsentStore } from "./consent-store.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
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

export interface KeywordCopy { optOut: string; optIn: string; help: string; /** Confirmation for a Spanish opt-out. */ optOutEs?: string }

export function defaultCopy(supportContact = "help@ntwrk.love"): KeywordCopy {
  return {
    optOut: "You're unsubscribed from The Network and won't get more messages here. Reply START to resume.",
    optOutEs: "Ya no recibirás mensajes de The Network aquí. Responde START para volver.",
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

  /**
   * Proactive consent. A START keyword only restores consent the member gave before (invite acceptance, admin):
   * a START from a number that never opted in clears nothing more than its opt-out (audit plugin-prototypes-18).
   */
  hasConsent(channel: ChannelKind, address: string): boolean {
    const key = this.#key(channel, address);
    if (this.#current.get(key)?.state !== "opted_in") return false;
    return this.history.some((e) => e.state === "opted_in" && !e.source.startsWith("keyword:") && this.#key(e.channel, e.address) === key);
  }

  get(channel: ChannelKind, address: string): ConsentEntry | undefined {
    return this.#current.get(this.#key(channel, address));
  }
}

export interface KeywordOutcome {
  action: KeywordAction;
  reply: string | null;
  /** For an opt-out: "keyword" (exact carrier keyword) or "free_text" (a request in the member's own words). */
  via?: "keyword" | "free_text";
}

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
  const word = normalizeKeyword(msg.text);
  // One confirmation per change: a repeated STOP (or START) is recorded but not answered again (plugin-prototypes-18).
  const wasOut = ledger.isOptedOut(msg.channel, msg.from);
  if (action === "opt_out") {
    ledger.record(msg.channel, msg.from, "opted_out", `keyword:${word}`);
    return { action, reply: msg.isGroup || wasOut ? null : copy.optOut, via: "keyword" };
  }
  if (!action) {
    // Spanish keywords ("PARA", "BAJA") and free-text requests ("please stop texting me").
    const r = parseOptOut(msg.text);
    if (r.match === "none") return null;
    const via = r.match === "exact" ? "keyword" : "free_text";
    ledger.record(msg.channel, msg.from, "opted_out", via === "keyword" ? `keyword:${word}` : `free_text:${r.lang}`);
    const reply = r.lang === "es" ? copy.optOutEs ?? copy.optOut : copy.optOut;
    return { action: "opt_out", reply: msg.isGroup || wasOut ? null : reply, via };
  }
  if (action === "opt_in") {
    const wasIn = ledger.get(msg.channel, msg.from)?.state === "opted_in";
    ledger.record(msg.channel, msg.from, "opted_in", `keyword:${word}`, "START keyword");
    return { action, reply: msg.isGroup || wasIn ? null : copy.optIn };
  }
  return { action, reply: msg.isGroup ? null : copy.help };
}
