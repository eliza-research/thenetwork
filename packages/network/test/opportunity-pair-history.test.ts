// A pair with history is not put together again by the Network's own composition paths (SD-143):
// a no is remembered for the pair, "from any path" (network-consent-5), and a block or a bad meeting
// ends the pair. The plans buddy, the second encounter and the newcomer welcome checked none or only
// part of it. The real ConsentNetwork and engine on a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opps = (w: Mini) => [...(w.net as any).opps.values()] as any[];
const paired = (w: Mini, origin: string, a: string, b: string) => opps(w).some(o => o.origin === origin && o.participants.includes(a) && o.participants.includes(b));

/** One of the two is probed for a staff intro and says no: the pair has a recent decline. */
async function decline(w: Mini, a: string, b: string, alternates: string[] = []) {
  const id = w.propose([a, b], { alternates });
  expect(await w.runUntil(() => w.probed(a) || w.probed(b))).toBe(true);
  await w.say(w.probed(b) ? b : a, "no thanks");
  return id;
}

describe("pair history on the Network's own composition paths", () => {
  test("plans buddy: a pair with a recent no is not paired for plans", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    await decline(w, "a", "b");
    await w.run(DAY);
    await w.say("b", "Any plans ideas for this weekend?");
    await w.say("a", "Any plans ideas for this weekend?");
    expect(opps(w).some(o => o.origin === "plans")).toBe(false);
  });

  test("second encounter: a block after both said they would meet again ends it", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    const o = opps(w).find(x => x.id === id);
    expect(o.stage).toBe("scheduled");
    await w.runUntil(() => o.feedbackSent, 7 * DAY);
    await w.say("a", "It was great, would love to meet again");
    await w.say("b", "It was great, would love to meet again");
    expect((w.net as any).again.get("a|b")?.size).toBe(2);
    await w.say("a", "Please block Ben");
    expect((w.net as any).blocks.has("a|b")).toBe(true);
    await w.run(2 * DAY);
    expect(paired(w, "second_encounter", "a", "b")).toBe(false);
  });

  test("newcomer welcome: the host is not someone the newcomer said no to", async () => {
    const w = new Mini([climber("h", "Hana Lee"), climber("x", "Xavi Roy"), climber("z", "Zoe Kim")]);
    await w.onboard("h", "x", "z");
    await w.run(8 * DAY);
    w.add(climber("n", "Nia Cole"));
    w.members.find(m => m.id === "n")!.invitedBy = "x";
    await w.onboard("n");
    // n says no to an intro with h and is replaced by z: n is in no open item, and the pair has a no.
    const id = w.propose(["h", "n"], { alternates: ["z"] });
    expect(await w.runUntil(() => w.probed("h") || w.probed("n"))).toBe(true);
    if (w.probed("h")) await w.say("h", "yes, any of those times");
    expect(await w.runUntil(() => w.probed("n"))).toBe(true);
    await w.say("n", "no thanks");
    expect(opps(w).find(o => o.id === id).participants).not.toContain("n");
    await w.run(4 * DAY);
    expect(paired(w, "newcomer_welcome", "n", "h")).toBe(false);
  });
});
