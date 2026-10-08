// The consent ledger (PRD 32.2, 36.1). Opt-out is effective immediately on that channel and address and
// is recorded with time and source. Blooio iMessage is P2P (not A2P 10DLC), and Blooio does not run a
// global suppression list for us (docs/research/blooio.md), so the Network owns this ledger for every
// channel. STOP / HELP / START are read by the platform consent ledger (packages/platform/src/consent.ts)
// on the one keyword table in packages/core/src/replies.ts.

import type { ConsentStore } from "./consent-store.ts";
import { normalizeAddress } from "./phone.ts";
import type { ChannelKind, Clock } from "./types.ts";

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
