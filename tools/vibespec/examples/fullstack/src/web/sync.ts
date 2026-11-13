// spec/system.md, "Only a tab's oldest queued edit can be on its way unanswered"; spec/client.md, "Story: Hear back from the server"
// The frontend's network code, with no framework in it: the React page
// (app.ts) and the end-to-end test use the same functions. Everything the
// server says is turned into an event of the generated client machine and
// handed to its `step`; nothing here changes a tab's state directly.
import { type Client, type Event, type Pending, initial, parseEvent, step } from "../../gen/client.ts";
import type { Op } from "../../gen/todo.ts";
import { drain } from "../inbox.ts";
import { toRequest } from "../protocol.ts";

/** Send one queued edit. Returns the answer as a client event, or undefined if the network failed. */
export async function sendEdit(base: string, name: string, p: Pending): Promise<Event | undefined> {
  const request = toRequest(name, p.seq, p.op);
  if (!request) return undefined;
  try {
    const res = await fetch(`${base}/api/events`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
    });
    if (!res.ok) return undefined;
    const a: unknown = await res.json();
    if (typeof a !== "object" || a === null || !("ok" in a) || typeof a.ok !== "boolean") return undefined;
    const event = parseEvent({ ...a, type: a.ok ? "receiveAck" : "receiveRefusal" });
    return event && (event.type === "receiveAck" || event.type === "receiveRefusal") && event.seq === p.seq ? event : undefined;
  } catch {
    return undefined;
  }
}

/** The list as the server has it now, as a client event. */
export async function fetchSnapshot(base: string): Promise<Event> {
  const res = await fetch(`${base}/api/snapshot`);
  const s: unknown = await res.json();
  const event = res.ok && typeof s === "object" && s !== null
    ? parseEvent({ ...s, type: "receiveSnapshot" }) : undefined;
  if (!event) throw new Error("not a well-formed snapshot");
  return event;
}

/** Read the push stream until `signal` aborts, handing each batch of pushes to `onBatch`. */
export async function listen(base: string, onBatch: (events: Event[]) => void, signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`${base}/api/stream`, { signal });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffered += decoder.decode(value, { stream: true });
      const frames = buffered.split("\n\n");
      buffered = frames.pop() ?? "";
      const events = frames.filter((f) => f.startsWith("data: ")).flatMap((f): Event[] => {
        const s: unknown = JSON.parse(f.slice("data: ".length));
        const event = typeof s === "object" && s !== null ? parseEvent({ ...s, type: "receiveSnapshot" }) : undefined;
        return event ? [event] : [];
      });
      if (events.length) onBatch(events);
    }
  } catch {
    // aborted, or the server went away
  }
}

/** A fresh id for a to-do this tab creates: unique, because the tab's name is. */
export function newId(name: string, c: Client): string {
  return `${name}-${c.made + 1}`;
}

/**
 * A tab without a page: the same machine and the same network code as the
 * React page, driven by method calls. The end-to-end test uses it.
 */
export class Tab {
  state: Client = initial;
  private stop = new AbortController();
  readonly base: string;
  readonly name: string;

  constructor(base: string, name: string) {
    this.base = base;
    this.name = name;
  }

  dispatch(e: Event): void {
    this.state = step(this.state, e);
  }

  /** A user edit: queued at once, and sent if the tab is online and has nothing else queued. */
  async edit(op: Op): Promise<void> {
    const e: Event | undefined =
      op.kind === "create" ? { type: "create", id: op.id, title: op.title }
      : op.kind === "done" ? { type: "setDone", id: op.id, done: op.done }
      : op.kind === "rename" ? { type: "rename", id: op.id, title: op.title }
      : op.kind === "remove" ? { type: "remove", id: op.id }
      : undefined;
    if (e) this.dispatch(e);
    if (this.state.pending.length === 1) await this.flush();
  }

  /** Send one queued edit and take in the answer. Returns false if the network failed. */
  async send(p: Pending): Promise<boolean> {
    const answer = await sendEdit(this.base, this.name, p);
    if (answer) this.dispatch(answer);
    return answer !== undefined;
  }

  /** Send the queue oldest first, one request at a time, as the page does. */
  async flush(): Promise<void> {
    for (let p = this.state.pending[0]; this.state.online && p; p = this.state.pending[0]) {
      if (!(await this.send(p))) return;
    }
  }

  goOffline(): void {
    this.dispatch({ type: "goOffline" });
  }

  /** Back online: send the queue, oldest first, and catch up. */
  async goOnline(): Promise<void> {
    this.dispatch({ type: "goOnline" });
    await this.flush();
    this.dispatch(await fetchSnapshot(this.base));
  }

  listen(): Promise<void> {
    return listen(this.base, (events) => { this.state = drain(this.state, events); }, this.stop.signal);
  }

  close(): void {
    this.stop.abort();
  }
}
