// A counter-offer is not a yes (AGENTS decision 11: only answer "yes" is consent). A member who answers
// a probe with only "how about next week instead?" and then stays silent never agreed to meet: when the
// partner says yes, nothing is booked and nobody's name goes out (SD-041). The real ConsentNetwork and
// engine on a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe("a counter-offer to a probe", () => {
  test("a bare counter-offer followed by silence books nothing and reveals no name", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
    const first = w.probed("a") ? "a" : "b", second = first === "a" ? "b" : "a";
    const from = w.mark();
    await w.say(first, "how about next week instead?");
    // The member says nothing more; the partner is asked and says yes.
    await w.runUntil(() => w.probed(second) || w.net.memberList().every(m => m.awaiting?.kind !== "probe"), 3 * 24 * HOUR);
    if (w.probed(second)) await w.say(second, "yes");
    await w.run(30 * HOUR);
    expect(w.meetings).toEqual([]);
    const names = w.to(second, from).map(s => s.body).filter(b => b.includes("Ana") || b.includes("Ben"));
    expect(names).toEqual([]);
    expect(w.to(first, from).map(s => s.body).filter(b => b.includes("Ana") || b.includes("Ben"))).toEqual([]);
    expect([...(w.net as any).opps.values()].find((o: any) => o.id === id)?.stage).not.toBe("scheduled");
  });
});
