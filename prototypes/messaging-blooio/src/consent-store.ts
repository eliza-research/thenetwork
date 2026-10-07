// Durable storage for the consent ledger (audit P1-11): a restart must never forget a STOP.
//
// The ledger is append-only: every opt-in/opt-out is one entry, and the current state per address is the
// last entry for it. `FileConsentStore` writes one JSON line per entry with a synchronous append, so the entry
// is on disk before the STOP confirmation is queued. Production should use Postgres
// (network.consent_events with a unique (address, at, state) index); the interface is the same.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConsentEntry } from "./keywords.ts";

export interface ConsentStore {
  /** Every entry ever recorded, oldest first. Called once when the ledger starts. */
  load(): ConsentEntry[];
  /** Persist one entry. Must be durable before it returns (throw on failure). */
  append(entry: ConsentEntry): void;
}

export class InMemoryConsentStore implements ConsentStore {
  readonly entries: ConsentEntry[] = [];
  load(): ConsentEntry[] { return [...this.entries]; }
  append(entry: ConsentEntry): void { this.entries.push({ ...entry }); }
}

/** Append-only JSONL file. Corrupt lines (e.g. a torn final write) are skipped, never fatal. */
export class FileConsentStore implements ConsentStore {
  constructor(readonly path: string) {}

  load(): ConsentEntry[] {
    if (!existsSync(this.path)) return [];
    const out: ConsentEntry[] = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as ConsentEntry;
        if (e && typeof e.address === "string" && (e.state === "opted_in" || e.state === "opted_out")) out.push(e);
      } catch { /* torn write; skip */ }
    }
    return out;
  }

  append(entry: ConsentEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
