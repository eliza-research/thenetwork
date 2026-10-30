import { expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

test("member-request matching uses skill evidence only during its valid interval", async () => {
  for (const seed of [1, 2, 3]) for (const state of ["expired", "future", "active", "undated", "at-end", "at-start"] as const) {
    const x = new Mini([{ id: "a", name: "Alice Able", age: 30 }, { id: "b", name: "Boris Bell", age: 32, skills: ["design"], shareable: true }], { seed, review: "human" });
    const f = x.facets.find(f => f.memberId === "b" && f.kind === "skill")!, now = x.clock.now();
    if (state === "expired") { f.validFrom = now - 2 * DAY; f.validTo = now - HOUR; }
    if (state === "future") { f.validFrom = now + DAY; f.validTo = now + 2 * DAY; }
    if (state === "active") { f.validFrom = now - DAY; f.validTo = now + DAY; }
    if (state === "undated") { delete f.validFrom; delete f.validTo; }
    if (state === "at-end") { f.validFrom = now - DAY; f.validTo = now; }
    if (state === "at-start") { f.validFrom = now; f.validTo = now + DAY; }
    await x.onboard("a", "b"); x.restart();
    await x.say("a", "I want to meet other founders.");
    expect(x.net.reviewQueue().length).toBe(state === "expired" || state === "future" ? 0 : 1);
    expect(x.sent.some(s => s.meta.type === "probe")).toBe(false);
  }
});
