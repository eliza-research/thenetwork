// Discrete-event scheduler over a SimClock. Events are ordered by (time, insertion seq), so
// simultaneous events run in the order they were scheduled: deterministic and replayable.
import type { SimClock } from "@thenetwork/core";

export type RunMode = "discrete" | "accelerated" | "realtime";

export interface ScheduledEvent<T = unknown> { at: number; seq: number; kind: string; data: T }

/** Binary min-heap keyed by (at, seq). */
export class EventQueue {
  private heap: ScheduledEvent[] = [];
  private seq = 0;
  get size() { return this.heap.length; }
  push<T>(at: number, kind: string, data: T): ScheduledEvent<T> {
    const ev = { at, seq: this.seq++, kind, data };
    this.heap.push(ev);
    this.up(this.heap.length - 1);
    return ev;
  }
  peek(): ScheduledEvent | undefined { return this.heap[0]; }
  pop(): ScheduledEvent | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length && last) { this.heap[0] = last; this.down(0); }
    return top;
  }
  private less(a: ScheduledEvent, b: ScheduledEvent) { return a.at < b.at || (a.at === b.at && a.seq < b.seq); }
  private up(i: number) {
    const h = this.heap;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!]; i = p;
    }
  }
  private down(i: number) {
    const h = this.heap;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
      if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
      if (m === i) return;
      [h[i], h[m]] = [h[m]!, h[i]!]; i = m;
    }
  }
}

export interface SchedulerOptions {
  mode: RunMode;
  /** Sim-seconds per wall-second in accelerated mode (default 1440 = 1 sim day per wall minute). */
  speed?: number;
  /** Injected for tests; defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Drives a queue against a SimClock. The clock only moves forward; an event scheduled in
 * the past runs "now" (clamped), which keeps the clock monotonic.
 */
export class Scheduler {
  readonly queue = new EventQueue();
  private handlers = new Map<string, (ev: ScheduledEvent<any>) => void | Promise<void>>();
  processed = 0;
  constructor(readonly clock: SimClock, private opts: SchedulerOptions) {}

  on<T>(kind: string, handler: (ev: ScheduledEvent<T>) => void | Promise<void>) { this.handlers.set(kind, handler as any); }
  at<T>(t: number, kind: string, data: T) { return this.queue.push(Math.max(t, this.clock.now()), kind, data); }
  after<T>(ms: number, kind: string, data: T) { return this.at(this.clock.now() + ms, kind, data); }

  /** Run events until the queue is empty or the next event is past `until`. */
  async runUntil(until: number): Promise<void> {
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    const speed = this.opts.mode === "realtime" ? 1 : this.opts.speed ?? 1440;
    let waitedUntil = this.clock.now();
    while (this.queue.size) {
      const next = this.queue.peek()!;
      if (next.at > until) break;
      if (this.opts.mode !== "discrete") {
        const wallMs = (next.at - Math.max(this.clock.now(), waitedUntil)) / speed;
        if (wallMs > 0) {
          await sleep(wallMs);
          waitedUntil = next.at;
        }
      }
      // An earlier event may have arrived during sleep. Run the event we remove, and
      // retain the time already waited so the displaced event does not wait twice.
      const due = this.queue.pop()!;
      this.clock.set(Math.max(due.at, this.clock.now()));
      const h = this.handlers.get(due.kind);
      if (!h) throw new Error(`no handler for event kind ${due.kind}`);
      await h(due);
      this.processed++;
    }
    if (this.clock.now() < until) this.clock.set(until);
  }
}
