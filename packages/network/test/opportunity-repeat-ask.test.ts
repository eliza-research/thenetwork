// A member who asks again for the same thing gets an answer (SD-266). The first ask found nobody and
// the member was told so. Before the fix the second ask, a few hours later, was handled with no
// reply at all (and no model call), so the member saw silence. The real ConsentNetwork and engine on
// a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const requests = (w: Mini) => (w.net as any).requests as any[];

describe("a repeat ask after none yet", () => {
  test("the second ask gets a reply", async () => {
    const w = new Mini([{ id: "a", name: "Ana Diaz", age: 30, area: "Greenpoint", interests: ["climbing"], wants: [{ objective: "find a regular climbing partner", category: "hobby" }] }]);
    await w.onboard("a");
    let from = w.mark();
    await w.say("a", "Can you find me a climbing partner?");
    const req = requests(w).find(r => r.memberId === "a" && r.kind === "people");
    expect(req?.outcome).toBe("none");
    expect(w.to("a", from)).toHaveLength(1);
    await w.run(2 * HOUR);
    from = w.mark();
    await w.say("a", "Can you find me a climbing partner?");
    // The same request, not a new one, and one reply now.
    expect(requests(w).filter(r => r.memberId === "a" && r.kind === "people")).toHaveLength(1);
    expect(w.to("a", from)).toHaveLength(1);
  });
});
