import type { Event } from "../gen/order.ts";
import { OrderBook, Rejected } from "./app.ts";

const book = new OrderBook();
const events: Event[] = [
  { type: "submit" }, // the draft is empty
  { type: "addItem", qty: 2 },
  { type: "submit" },
  { type: "pay", amount: 4 },
  { type: "pay", amount: 7 }, // more than the balance
  { type: "pay", amount: 6 },
  { type: "cancel" }, // already paid
];
for (const event of events) {
  const shown = JSON.stringify(event).padEnd(30);
  try {
    console.log("✓", shown, JSON.stringify(book.dispatch("A1", event)));
  } catch (e) {
    if (!(e instanceof Rejected)) throw e;
    console.log("✗", shown, e.message);
  }
}
console.log("balance", book.balance("A1"));
