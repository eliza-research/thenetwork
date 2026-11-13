// The program's side of the trust boundary: who sent an event comes from the
// session it arrived on, never from the event (spec/assistant.md, "Who sends an event").
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Actor, type Assistant, type Event, enabled, initial, parseEvent, step } from "../gen/assistant.ts";

const run = (events: [Event, Actor][], from: Assistant = initial) => events.reduce((s, [e, by]) => step(s, e, by), from);

test("an event cannot say who sent it", () => {
  assert.deepEqual(parseEvent({ type: "confirm", by: "Person" }), { type: "confirm" });
});

test("only the person starts a turn and confirms a payment", () => {
  assert.equal(enabled(initial, { type: "begin" }, "Agent"), false);
  const asking = run([
    [{ type: "begin" }, "Person"],
    [{ type: "choose", choice: "Lookup" }, "Agent"],
    [{ type: "reply", request: 1, amount: 5 }, "World"],
    [{ type: "choose", choice: "Review" }, "Agent"],
    [{ type: "load", page: "Genuine" }, "World"],
    [{ type: "choose", choice: "Pay" }, "Agent"],
  ]);
  assert.equal(asking.phase, "Asking");
  assert.equal(enabled(run([[{ type: "begin" }, "Person"]]), { type: "choose", choice: "Recite" }, "Agent"), false);
  assert.equal(step(asking, { type: "confirm" }, "Agent").charged, 0);
  assert.equal(step(asking, { type: "confirm" }, "Person").charged, 1);
});
