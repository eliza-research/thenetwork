// A member's request whose booked meeting is called off is open again (SD-139). The requester asked
// for a climbing partner; the partner said yes and then cancelled the booked meeting. The request does
// not stay "booked" for good: it goes back to waiting, so the standing-request retry looks again. The
// real ConsentNetwork and engine on a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string, area = "Greenpoint") => ({ id, name, age: 30, area, interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opps = (w: Mini) => [...(w.net as any).opps.values()] as any[];
const requests = (w: Mini) => (w.net as any).requests as any[];

describe("a booked request after its meeting is called off", () => {
  test("the request waits again and is retried", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    await w.say("a", "Can you find me a climbing partner?");
    const req = requests(w).find(r => r.memberId === "a" && r.kind === "people");
    expect(req?.outcome).toBe("probing");
    const o = opps(w).find(x => x.id === req.oppId);
    await w.answerProbes(["a", "b"]);
    expect(o.stage).toBe("scheduled");
    expect(req.outcome).toBe("booked");
    await w.run(2 * HOUR);
    await w.say("b", "I need to cancel, sorry");
    expect(o.stage).toBe("closed");
    expect(req.outcome).toBe("none");
    // A new climber joins: the retry (after the 72-hour wait from the last confirm ask) finds them.
    w.add(climber("c", "Cleo Park"));
    await w.onboard("c");
    expect(await w.runUntil(() => opps(w).some(x => x.id !== o.id && x.requester === "a" && x.participants.includes("c")), 5 * DAY)).toBe(true);
  });
});
