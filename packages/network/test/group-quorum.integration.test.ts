// A group intro of 3 or more (machine group-quorum-to-pair) on the real ConsentNetwork and the real
// engine, in the small NYC world: a member who cannot come leaves the group, and the group goes on.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe("group intro", () => {
  // SD-264: a "no" lets a group of 3 or more go on without that member (docs/network.md 4.1), but a
  // "yes, but neither of those times" closed the whole group as "no common time".
  test("one member's \"neither of those times\" does not close a group of four", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")], { review: "auto", plansConfig: { runDays: [] } });
    await w.onboard("a", "b", "c", "d");
    const id = w.propose(["a", "b", "c", "d"]);
    const o = () => (w.net as any).opps.get(id);
    for (const [x, ans] of [["a", "yes, the first one works"], ["b", "yes, that works"], ["c", "yes but neither of those work for me"], ["d", "yes, that works"]] as const) {
      expect(await w.runUntil(() => w.probed(x), 3 * DAY)).toBe(true);
      await w.say(x, ans);
      if (x === "c") {
        expect(o().stage).toBe("probing");
        expect(o().participants).toEqual(["a", "b", "d"]);
      }
    }
    await w.run(DAY);
    expect(w.meetings.map(m => [...m.participants].sort())).toEqual([["a", "b", "d"]]);
  });
});
