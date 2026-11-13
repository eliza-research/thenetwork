// A member who asked to swap numbers and then writes a no ("I don't want to swap numbers anymore") is
// never shared when the match asks afterwards; a yes that only uses an idiom ("I dont mind, send them
// my number") keeps the request, and the match's ask completes the swap (review on #170).
import { describe, expect, test } from "bun:test";
import { MINUTE } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const PHONES: Record<string, string> = { a: "+15555550101", b: "+15555550102" };
const o = { contactOf: (id: string) => PHONES[id] };
const shared = (w: Mini) => w.sent.filter(s => Object.values(PHONES).some(p => s.body.includes(p) || JSON.stringify(s.meta).includes(p)));

async function swapAfter(text: string) {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto" });
  await w.onboard("a", "b");
  w.propose(["a", "b"]);
  await w.answerProbes(["a", "b"]);
  expect(w.meetings.length).toBe(1);
  expect((await w.net.relayRequest({ itemId: "swap-a", from: "a" as never, kind: "contact_share" }, o)).decision).toBe("held");
  w.clock.advance(MINUTE);
  await w.say("a", text);
  w.clock.advance(MINUTE);
  const res = await w.net.relayRequest({ itemId: "swap-b", from: "b" as never, kind: "contact_share" }, o);
  return { w, res };
}

describe("a number swap after the asker writes again", () => {
  for (const text of ["I don't want to swap numbers anymore", "I changed my mind about sharing my number", "I don't want you to send my number", "don't send my number"]) {
    test(`"${text}" withdraws: no number is shared`, async () => {
      const { w, res } = await swapAfter(text);
      // Held (A's request is gone, B waits) or refused (the booked plan closed); never sent.
      expect(res.decision).not.toBe("sent");
      expect(shared(w)).toEqual([]);
    });
  }

  test(`"I dont mind, send them my number" keeps the request: the match's ask shares both`, async () => {
    const { w, res } = await swapAfter("I dont mind, send them my number");
    expect(res.decision).toBe("sent");
    expect(shared(w).map(s => s.to).sort()).toEqual(["a", "b"]);
  });
});
