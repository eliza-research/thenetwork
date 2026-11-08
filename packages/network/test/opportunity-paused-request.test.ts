// A request asked while matching is off is still searched when matching comes back on (SD-267).
// The member was told "I'll keep your request open and look again soon". Before the fix the daily
// retry skipped every request older than 7 days, so a request that waited longer than a week for
// the switch was dropped with no search and no word to the member. A new stored state starts with
// matching off (service.ts), so an ask before launch lands here. The real ConsentNetwork and engine
// on a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opps = (w: Mini) => [...(w.net as any).opps.values()] as any[];
const requests = (w: Mini) => (w.net as any).requests as any[];

describe("a request that waited for the matching switch", () => {
  test("is searched after matching comes back on, also after more than 7 days", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { matchingEnabled: false });
    await w.onboard("a", "b");
    await w.say("a", "Can you find me a climbing partner?");
    const req = requests(w).find(r => r.memberId === "a" && r.kind === "people");
    expect(req?.outcome).toBe("none");
    expect(req?.tries).toBeUndefined();
    await w.run(8 * DAY);
    w.net.setMatchingEnabled(true, "staff");
    expect(await w.runUntil(() => opps(w).some(x => x.requester === "a"), 2 * DAY)).toBe(true);
    expect(req.tries).toBeGreaterThan(0);
  });
});
