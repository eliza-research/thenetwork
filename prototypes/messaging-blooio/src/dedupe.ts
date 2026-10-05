// Inbound dedupe with claim/commit/release semantics.
// claim() marks keys in-flight; commit() makes them durable for the TTL; release() frees them when processing
// failed so the provider's retry (Blooio retries 5x over ~15.5 min) is processed instead of dropped.
// Production: back this with a Postgres table (unique key, expires_at) instead of a Map.

import type { Clock } from "./types.ts";

export interface DedupeStore {
  /** Returns true when none of the keys were seen or are in flight; marks them in flight. */
  claim(keys: string[]): boolean;
  commit(keys: string[]): void;
  release(keys: string[]): void;
}

export const DEFAULT_DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class InMemoryDedupeStore implements DedupeStore {
  #seen = new Map<string, number>(); // key -> expiresAt
  #inFlight = new Set<string>();

  constructor(private clock: Clock, private ttlMs = DEFAULT_DEDUPE_TTL_MS) {}

  claim(keys: string[]): boolean {
    const now = this.clock.now();
    for (const k of keys) {
      const exp = this.#seen.get(k);
      if (exp !== undefined && exp > now) return false;
      if (this.#inFlight.has(k)) return false;
    }
    for (const k of keys) this.#inFlight.add(k);
    return true;
  }

  commit(keys: string[]): void {
    const exp = this.clock.now() + this.ttlMs;
    for (const k of keys) { this.#inFlight.delete(k); this.#seen.set(k, exp); }
    if (this.#seen.size > 50_000) this.sweep();
  }

  release(keys: string[]): void { for (const k of keys) this.#inFlight.delete(k); }

  sweep(): void {
    const now = this.clock.now();
    for (const [k, exp] of this.#seen) if (exp <= now) this.#seen.delete(k);
  }

  get size(): number { return this.#seen.size; }
}
