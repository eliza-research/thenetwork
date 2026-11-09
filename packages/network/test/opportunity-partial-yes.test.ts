// A member who said yes to a probe hears the end when the other member says no (SD-263, PRD F29:
// "Partial acceptances are released politely"). Without it the member waits for an answer that
// never comes. The text does not say who declined. The real ConsentNetwork and engine on a SimClock
// (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { DAY, type MemberId } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opp = (w: Mini, id: string) => [...(w.net as any).opps.values()].find((o: any) => o.id === id);

describe("a yes, then the partner says no", () => {
  test("the member who said yes is told the intro did not come together", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    expect(await w.runUntil(() => w.probed("a") || w.probed("b"), 3 * DAY)).toBe(true);
    const first: MemberId = w.probed("a") ? "a" : "b", second: MemberId = first === "a" ? "b" : "a";
    await w.say(first, "yes");
    expect(opp(w, id).status.get(first)).toBe("available");
    expect(await w.runUntil(() => w.probed(second), 3 * DAY)).toBe(true);
    const from = w.mark();
    await w.say(second, "no thanks");
    expect(opp(w, id).stage).toBe("closed");
    await w.run(2 * DAY);
    const told = w.to(first, from).filter(s => s.body.includes(copy.declinedQuiet));
    expect(told).toHaveLength(1);
    expect(told[0]!.body).not.toContain("Ben");
    expect(told[0]!.body).not.toContain("Ana");
    // The member who said no gets only the reply to their own answer.
    expect(w.to(second, from).filter(s => s.body.includes(copy.declinedQuiet))).toEqual([]);
  });
});
