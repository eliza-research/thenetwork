// The unverified shell: storage and error reporting around the verified core.
import { type Event, type Order, enabled, parseEvent, step } from "../gen/order.ts";
import { balance, replay } from "./ledger.ts";

export class Rejected extends Error {}

/** An event-sourced order book. Only events the rules allow are ever stored. */
export class OrderBook {
  private logs = new Map<string, Event[]>();

  get(id: string): Order {
    return replay(this.logs.get(id) ?? []);
  }

  /** `input` may come straight from the network: it is parsed into an event before the rules see it. */
  dispatch(id: string, input: unknown): Order {
    const event = parseEvent(input);
    if (!event) throw new Rejected("not a well-formed event");
    const order = this.get(id);
    if (!enabled(order, event)) throw new Rejected(`${event.type} is not allowed for a ${order.status} order`);
    this.logs.set(id, [...(this.logs.get(id) ?? []), event]);
    return step(order, event); // what `replay` (src/ledger.ts) gives for the longer log
  }

  balance(id: string): number {
    return balance(this.get(id));
  }
}
