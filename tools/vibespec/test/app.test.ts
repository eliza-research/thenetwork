import assert from "node:assert/strict";
import { test } from "node:test";
import { OrderBook, Rejected } from "../src/app.ts";

/** A book whose order A1 has been sent `events`, in order. */
function book(...events: object[]): OrderBook {
  const b = new OrderBook();
  for (const e of events) b.dispatch("A1", e);
  return b;
}
const submitted = (qty: number) => book({ type: "addItem", qty }, { type: "submit" });

// spec/order.md, "Story: Check out"
test("an order is filled, submitted and paid off in instalments", () => {
  const b = submitted(2);
  assert.equal(b.dispatch("A1", { type: "pay", amount: 4 }).status, "Pending");
  assert.equal(b.balance("A1"), 6);
  assert.equal(b.dispatch("A1", { type: "pay", amount: 6 }).status, "Paid");
  assert.equal(b.balance("A1"), 0);
});

// spec/order.md, "Only a non-empty draft can be submitted"; spec/order.md, "A payment never exceeds the balance"
test("events the rules do not allow are rejected and not stored", () => {
  assert.throws(() => book({ type: "submit" }), Rejected);
  const b = submitted(1);
  assert.throws(() => b.dispatch("A1", { type: "pay", amount: 6 }), Rejected);
  assert.deepEqual(b.get("A1"), { status: "Pending", units: 1, due: 5, paid: 0 });
});

// spec/order.md, "A pending order can be cancelled, refunding every payment"
test("cancelling refunds what was paid", () => {
  const b = submitted(1);
  b.dispatch("A1", { type: "pay", amount: 3 });
  assert.deepEqual(b.dispatch("A1", { type: "cancel" }), { status: "Cancelled", units: 1, due: 5, paid: 0 });
});

test("malformed input never reaches the verified core", () => {
  const b = book();
  assert.throws(() => b.dispatch("A1", { type: "addItem", qty: 1.5 }), Rejected);
  assert.throws(() => b.dispatch("A1", { type: "refund" }), Rejected);
  assert.deepEqual(b.get("A1"), { status: "Draft", units: 0, due: 0, paid: 0 });
});

// spec/order.md, "No more can be removed than the order holds"
test("items can be taken back out of a draft, but never more than it holds", () => {
  const b = book({ type: "addItem", qty: 3 });
  assert.equal(b.dispatch("A1", { type: "removeItem", qty: 2 }).due, 5);
  assert.throws(() => b.dispatch("A1", { type: "removeItem", qty: 2 }), Rejected);
});

// spec/order.md, "A cancelled order can be reopened as a draft"; spec/order.md, "No more can be taken back than was paid"
test("a cancelled order can be reopened, and a payment partly taken back", () => {
  const b = submitted(2);
  b.dispatch("A1", { type: "pay", amount: 6 });
  assert.equal(b.dispatch("A1", { type: "takeBack", amount: 2 }).paid, 4);
  assert.throws(() => b.dispatch("A1", { type: "takeBack", amount: 5 }), Rejected);
  b.dispatch("A1", { type: "cancel" });
  assert.deepEqual(b.dispatch("A1", { type: "reopen" }), { status: "Draft", units: 2, due: 10, paid: 0 });
});

test("an event is copied on the way in, so nothing the caller keeps can change it", () => {
  let reads = 0;
  const sly = { type: "pay", get amount() { return reads++ === 0 ? 1 : 1_000_000; }, extra: "ignored" };
  assert.deepEqual(submitted(2).dispatch("A1", sly), { status: "Pending", units: 2, due: 10, paid: 1 });
});
