// spec/client.md, "Story: Hear back from the server"
//@ backend dafny
// Hand-written, because Quint has no loops: apply a batch of pushes that
// arrived together (one read from the push stream can hold several) to a tab,
// in order. `npm run check` proves the `//@ ensures` lines for every tab and
// every batch, against the generated client machine.
import { type Client, type Event, canReceiveSnapshot, inv, receiveSnapshot } from "../gen/client.ts";

/**
 * The tab after every push in `inbox`, in order. Only `receiveSnapshot`
 * events are pushes; anything else in the batch is ignored, and so is a push
 * the rules do not allow (the tab is offline).
 */
export function drain(c: Client, inbox: Event[]): Client {
  //@ requires inv(c)
  //@ ensures inv(\result)
  //@ ensures \result.seen >= c.seen
  //@ ensures \result.pending === c.pending
  let tab: Client = c;
  let i = 0;
  while (i < inbox.length) {
    //@ invariant 0 <= i && i <= inbox.length
    //@ invariant inv(tab)
    //@ invariant tab.seen >= c.seen
    //@ invariant tab.pending === c.pending
    const e = inbox[i];
    if (e.type === "receiveSnapshot" && canReceiveSnapshot(tab, e.version, e.todos)) {
      tab = receiveSnapshot(tab, e.version, e.todos);
    }
    i = i + 1;
  }
  return tab;
}
