// Durable storage for the consent ledger (audit P1-11): a restart must never forget a STOP.
//
// The ledger is append-only: every opt-in/opt-out is one entry, and the current state per address is the
// last entry for it. `FileConsentStore` writes one JSON line per entry with a synchronous append, so the entry
// is on disk before the STOP confirmation is queued. Production should use Postgres
// (network.consent_events with a unique (address, at, state) index); the interface is the same.

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { ConsentEntry } from "./ledger.ts";

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

/**
 * Append-only JSONL file. Only a torn FINAL line (a crash during the last append, before it returned) is skipped.
 * The torn bytes are truncated on load. A corrupt line anywhere else throws: the ledger must not start and silently forget a STOP (audit
 * plugin-prototypes-17). An operator repairs the file. Each append is fsynced before it returns.
 */
export class FileConsentStore implements ConsentStore {
  constructor(readonly path: string) {}

  load(): ConsentEntry[] {
    if (!existsSync(this.path)) return [];
    const out: ConsentEntry[] = [];
    const lines = readFileSync(this.path, "utf8").split("\n");
    let last = lines.length - 1;
    while (last >= 0 && !lines[last]!.trim()) last--;
    for (let i = 0; i <= last; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      let e: ConsentEntry | undefined;
      try { e = JSON.parse(line) as ConsentEntry; } catch { /* checked below */ }
      if (e && typeof e.address === "string" && (e.state === "opted_in" || e.state === "opted_out")) { out.push(e); continue; }
      if (i === last) {
        // Torn final write: that append never returned. Cut it off so the next append starts a clean line.
        truncateSync(this.path, Buffer.byteLength(lines.slice(0, last).join("\n")) + (last > 0 ? 1 : 0));
        continue;
      }
      throw new Error(`consent store ${this.path}: corrupt entry on line ${i + 1}; refusing to load (repair the file)`);
    }
    return out;
  }

  append(entry: ConsentEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const fd = openSync(this.path, "a", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(entry)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
