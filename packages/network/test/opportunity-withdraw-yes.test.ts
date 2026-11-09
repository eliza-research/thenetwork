// A yes can be taken back before the reveal (PRD 28.3 independent double opt-in; AGENTS decision 11).
// A member who said yes to a probe, and then says no or cancels before the partner answered, is out:
// when the partner says yes, nothing is booked and the member's name never reaches the partner (SD-075).
// The same holds after a time retry that went unanswered: the slot is gone, the yes was kept, and a
// later "no thanks" still withdraws it (SD-076). The real ConsentNetwork and engine on a SimClock
// (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opp = (w: Mini, id: string) => [...(w.net as any).opps.values()].find((o: any) => o.id === id);

async function start() {
  const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
  await w.onboard("a", "b");
  const id = w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
  const first = w.probed("a") ? "a" : "b", second = first === "a" ? "b" : "a";
  return { w, id, first, second, name: first === "a" ? "Ana" : "Ben" };
}

/** The partner is asked (if the item is still open) and says yes; then time passes. */
async function partnerYes(w: Mini, second: string) {
  await w.runUntil(() => w.probed(second), 3 * 24 * HOUR);
  if (w.probed(second)) await w.say(second, "yes, any of those times");
  await w.run(30 * HOUR);
}

describe("taking back a yes before the reveal", () => {
  for (const takeBack of ["actually no, sorry", "I need to cancel"]) {
    test(`"${takeBack}" after a yes books nothing and reveals no name`, async () => {
      const { w, id, first, second, name } = await start();
      await w.say(first, "yes, any of those times");
      expect(opp(w, id).status.get(first)).toBe("available");
      const from = w.mark();
      await w.say(first, takeBack);
      await partnerYes(w, second);
      expect(w.meetings).toEqual([]);
      expect(opp(w, id).stage).not.toBe("scheduled");
      expect(w.to(second, from).filter(s => s.body.includes(name))).toEqual([]);
    });
  }

  test(`"no thanks" after an unanswered time retry books nothing and reveals no name`, async () => {
    const { w, id, first, second, name } = await start();
    // A yes with none of the times. A bare "neither of those" is no yes (founder decision 11, SD-041):
    // it gets other times too, but silence after it is a no (consent-transitions.integration.test.ts).
    await w.say(first, "yes, but neither of those times work");
    expect(opp(w, id).primed.has(first)).toBe(true);
    expect(opp(w, id).timeRetry).toContain(first);
    // No answer to the new times for 26 hours: the yes is kept.
    await w.run(27 * HOUR);
    expect(opp(w, id).status.get(first)).toBe("available");
    const from = w.mark();
    await w.say(first, "no thanks");
    await partnerYes(w, second);
    expect(w.meetings).toEqual([]);
    expect(opp(w, id).stage).not.toBe("scheduled");
    expect(w.to(second, from).filter(s => s.body.includes(name))).toEqual([]);
  });
});
