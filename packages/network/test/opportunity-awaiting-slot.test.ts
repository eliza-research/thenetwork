// The awaiting slot keeps the answer path of a pending probe (SD-043). A member with a probe waiting
// sends a job post by text (peon postings): the posting turn uses the slot for its read-back. When the
// posting turn ends, the member's next "yes" must still answer the probe, so the partner is asked.
// The real ConsentNetwork and engine on a SimClock (mini.ts), with the simulated reviewer.
import { describe, expect, test } from "bun:test";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const opp = (w: Mini, id: string) => [...(w.net as any).opps.values()].find((o: any) => o.id === id);

describe("the awaiting slot", () => {
  test("a job post during a pending probe does not lose the probe's answer", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { hooks: { postings: true } });
    await w.onboard("a", "b");
    const id = w.propose(["a", "b"]);
    expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
    const first = w.probed("a") ? "a" : "b";
    await w.say(first, "We're hiring a data analyst, 2 openings, $90k-$120k, hybrid in Brooklyn");
    await w.say(first, "no");
    expect(w.probed(first)).toBe(true);
    await w.say(first, "yes, any of those times");
    expect(opp(w, id).status.get(first)).toBe("available");
  });
});

describe("the awaiting slot of a hiring manager", () => {
  test("a second candidate's probe waits until the manager answered the first", async () => {
    const w = new Mini([climber("m", "Rowan Abbott"), climber("c1", "Cleo Park"), climber("c2", "Dev Shah")]);
    await w.onboard("m", "c1", "c2");
    const now = w.clock.now();
    // The manager's open posting (seat m-job-1, 2 openings), as the platform's snapshot rows show it.
    w.intents.push({ id: "m-job-1:intent", memberId: "m-job-1", objective: "Hire: data analyst", category: "professional", details: "peon:job openings", horizonDays: 90, status: "active", createdAt: now });
    w.facets.push({ id: "m-job-1:openings", memberId: "m-job-1", kind: "fact", value: "Openings", tags: ["peon:openings:2"], scope: "agent_private", provenance: "said", confidence: 0.9, validFrom: now, source: "chat", observedAt: now, inferred: false, confirmedByMember: true });
    const seat = (id: string, cand: string) => ({
      id, kind: "intro" as const, participants: ["m", cand], alternates: [], objective: "a data analyst role", category: "professional" as const, city: "nyc",
      window: { start: now + 24 * 3600_000, end: now + 5 * 24 * 3600_000 }, score: 0.5, exploration: false, explanations: {}, generator: "player", createdAt: now, seat: { id: "m-job-1", manager: "m" },
      components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
    });
    w.net.submitProposal(seat("s1", "c1") as never);
    w.net.submitProposal(seat("s2", "c2") as never);
    // Both candidates say yes; the manager is asked about each of them.
    expect(await w.runUntil(() => w.probed("c1") && w.probed("c2"))).toBe(true);
    await w.say("c1", "yes");
    await w.say("c2", "yes");
    expect(await w.runUntil(() => w.probed("m"))).toBe(true);
    await w.run(6 * 3600_000);
    const toM = () => w.log("probe_sent").filter(l => l.detail.memberId === "m").map(l => l.detail.oppId as string);
    // One question at a time: the second probe waits while the first one still waits for the manager's answer.
    expect(toM().length).toBe(1);
    const [firstOpp] = toM();
    await w.say("m", "yes");
    expect(opp(w, firstOpp!).stage).toBe("scheduled");
    // The answer path of the second probe is there when it goes out: the manager's yes reaches it.
    expect(await w.runUntil(() => toM().length === 2)).toBe(true);
    const second = toM()[1]!;
    expect(w.probed("m")).toBe(true);
    await w.say("m", "yes");
    expect(opp(w, second).stage).toBe("scheduled");
  });
});
