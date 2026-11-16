// spec/client.md, "Story: Edit the list in the browser"; spec/client.md, "Story: Hear back from the server"
// The page's reducer is the generated client `step`; these tests drive it the
// way the page does.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Client, type Event, initial, inv, step, view, visible } from "../gen/client.ts";
import { drain } from "../src/inbox.ts";

const run = (events: Event[], from: Client = initial) => events.reduce(step, from);
const milk = { id: "x", title: "milk", done: false, deleted: false };

test("an edit shows at once and waits in the queue", () => {
  const c = run([{ type: "create", id: "x", title: "milk" }]);
  assert.deepEqual(visible(c), [milk]);
  assert.deepEqual(c.confirmed, []);
  assert.deepEqual(c.pending.map((p) => p.seq), [1]);
});

test("an acknowledgement takes the edit out of the queue and brings the server's list", () => {
  const c = run([{ type: "create", id: "x", title: "milk" }, { type: "receiveAck", seq: 1, version: 1, todos: [milk] }]);
  assert.equal(c.pending.length, 0);
  assert.equal(c.seen, 1);
  assert.deepEqual(view(c), [milk]);
});

test("an older copy of the list is ignored", () => {
  const c = run([{ type: "receiveSnapshot", version: 2, todos: [milk] }, { type: "receiveSnapshot", version: 1, todos: [] }]);
  assert.equal(c.seen, 2);
  assert.deepEqual(c.confirmed, [milk]);
});

test("a refused edit leaves the queue and is counted once", () => {
  const c = run([
    { type: "create", id: "x", title: "milk" },
    { type: "receiveRefusal", seq: 1, version: 0, todos: [] },
    { type: "receiveRefusal", seq: 1, version: 0, todos: [] },
  ]);
  assert.equal(c.pending.length, 0);
  assert.equal(c.refusals, 1);
  assert.deepEqual(visible(c), []);
});

test("edits made offline queue up, and the page hears nothing until it is back", () => {
  const c = run([
    { type: "goOffline" },
    { type: "create", id: "x", title: "milk" },
    { type: "setDone", id: "x", done: true },
    { type: "receiveSnapshot", version: 3, todos: [] },
  ]);
  assert.equal(c.pending.length, 2);
  assert.equal(c.seen, 0);
  assert.deepEqual(visible(c), [{ ...milk, done: true }]);
});

test("edits the rules do not allow change nothing", () => {
  const c = run([{ type: "create", id: "x", title: "" }, { type: "setDone", id: "nobody", done: true }]);
  assert.deepEqual(c, initial);
});

test("a confirmed copy that already holds a queued edit shows it once", () => {
  const c = run([{ type: "create", id: "x", title: "milk" }, { type: "receiveSnapshot", version: 1, todos: [milk] }]);
  assert.equal(c.pending.length, 1);
  assert.deepEqual(view(c), [milk]);
});

test("a batch of pushes is drained in order and keeps the client's rules", () => {
  const c = drain(initial, [
    { type: "receiveSnapshot", version: 1, todos: [milk] },
    { type: "receiveSnapshot", version: 3, todos: [] },
    { type: "receiveSnapshot", version: 2, todos: [milk] },
  ]);
  assert.equal(c.seen, 3);
  assert.ok(inv(c));
});
