// Persistence for the NC ledger (audit capital-5). The ledger's state is a pure function of the
// events it accepted, so the store keeps only those events (append-only) plus the staff-read audit
// trail. On start, `new CapitalLedger(cfg, { store })` replays the log and then appends every newly
// accepted event before it changes any state. Replay is idempotent: duplicate ids are skipped.
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { dirname } from "node:path";
import type { StaffRead } from "./ledger.ts";
import type { CapitalEvent } from "./types.ts";

export interface CapitalStore {
  /** Everything appended so far, in append order. */
  load(): { events: CapitalEvent[]; reads: StaffRead[] };
  /** Called with each accepted event before the ledger applies it. Throwing leaves the ledger unchanged. */
  appendEvent(e: CapitalEvent): void;
  appendRead(r: StaffRead): void;
}

/** In-memory store (tests, simulations). */
export class MemoryCapitalStore implements CapitalStore {
  private readonly events: CapitalEvent[] = [];
  private readonly reads: StaffRead[] = [];
  load() { return { events: this.events.map(e => structuredClone(e)), reads: this.reads.map(r => ({ ...r })) }; }
  appendEvent(e: CapitalEvent) { this.events.push(structuredClone(e)); }
  appendRead(r: StaffRead) { this.reads.push({ ...r }); }
}

/**
 * Append-only JSON Lines file: one `{"event": ...}` or `{"read": ...}` per line, written with a
 * synchronous append so a line is on disk before the ledger changes. A torn last line (a crash
 * during the append) is cut off on load: that event was never applied. Any other bad line throws.
 */
export class JsonlCapitalStore implements CapitalStore {
  constructor(readonly path: string) {}

  load() {
    const events: CapitalEvent[] = [], reads: StaffRead[] = [];
    if (!existsSync(this.path)) return { events, reads };
    let text = readFileSync(this.path, "utf8");
    if (text && !text.endsWith("\n")) {
      // Torn tail: cut it off so the next append starts on a clean line.
      text = text.slice(0, text.lastIndexOf("\n") + 1);
      truncateSync(this.path, Buffer.byteLength(text));
    }
    const lines = text.split("\n");
    lines.pop();
    lines.forEach((line, i) => {
      let rec: { event?: CapitalEvent; read?: StaffRead };
      try { rec = JSON.parse(line); } catch (err) {
        throw new Error(`capital store ${this.path}: bad line ${i + 1}: ${(err as Error).message}`);
      }
      if (rec.event) events.push(rec.event);
      else if (rec.read) reads.push(rec.read);
      else throw new Error(`capital store ${this.path}: line ${i + 1} is neither an event nor a read`);
    });
    return { events, reads };
  }

  appendEvent(e: CapitalEvent) { this.append({ event: e }); }
  appendRead(r: StaffRead) { this.append({ read: r }); }

  private append(rec: object) {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(rec)}\n`);
  }
}
