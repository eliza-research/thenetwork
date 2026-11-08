// The awaiting slot points only at a live probe (SD-048). A member who is probed, sends STOP and is
// replaced by an alternate is out of that opportunity: after START, their slot does not keep the dead
// probe, so a later message is not read as an answer to it ("Just to check: is that a yes or a no?").
// The real ConsentNetwork and engine on a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opp = (w: Mini, id: string) => [...(w.net as any).opps.values()].find((o: any) => o.id === id);
const keyword = (w: Mini, id: string, k: "STOP" | "START") => w.net.onInbound({ id: `${k}-${id}-${w.clock.now()}`, memberId: id, body: k, keyword: k, ts: w.clock.now(), channel: "sms" } as never);

describe("a replaced prober", () => {
  test("keeps no awaiting slot for the probe it was replaced on", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cleo Park")]);
    await w.onboard("a", "b", "c");
    const id = w.propose(["a", "b"], { alternates: ["c"] });
    expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
    const first = w.probed("a") ? "a" : "b", second = first === "a" ? "b" : "a";
    await w.say(first, "yes, any of those times");
    expect(await w.runUntil(() => w.probed(second))).toBe(true);
    await keyword(w, second, "STOP");
    expect(opp(w, id).participants).toContain("c");
    expect(opp(w, id).participants).not.toContain(second);
    await keyword(w, second, "START");
    await w.run(5 * DAY);
    expect(w.net.memberList().find(m => m.id === second)?.awaiting).toBeUndefined();
    const from = w.mark();
    await w.say(second, "tell me more about it");
    expect(w.to(second, from).map(s => s.body)).not.toContain(copy.probeClarify);
  });
});
