import { expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { scenarioWorldOptions, type Scenario } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { World } from "../src/world.ts";

test("an ask-primed persona does not treat a peer's expired want as a shared want", async () => {
  const scenario: Scenario = {
    name: "expired-peer-want", description: "A natural ask followed by an introduction to a peer with a lapsed want.",
    seed: 1, days: 6, expectations: [],
    personas: ["requester", "peer"].map((ref, i) => ({
      ref, name: i ? "Kofi Abara" : "Ines Moreau", city: "sf", age: 30, homeArea: "Noe Valley", archetype: "regular",
      interests: i ? ["chess"] : ["film"], skills: [], desires: ["new_friends"],
      capacity: 0.95, socialEnergy: 0.8, preferredGroupSize: 2, flakiness: 0,
      responsiveness: { latencyMedianMin: 20, latencySigma: 0, ignoreProb: 0 }, join: { day: 0, hour: 9 },
    })),
    actions: [{ at: { day: 4, hour: 12 }, do: "propose", kind: "intro", participants: ["requester", "peer"], objective: "meet a new friend", city: "sf" }],
  };
  const actual = [];
  for (const seed of [1, 2, 9]) for (const mode of ["permanent", "before", "at", "after", "absent"] as const) {
    const opts = scenarioWorldOptions(scenario, { seed, network: () => new StubNetwork({ randomIntros: false }), writeLog: false });
    opts.policy = { liveAsksOnly: true };
    const scheduled = opts.actions!.find(x => x.action.do === "propose")!;
    if (scheduled.action.do !== "propose") throw new Error("missing scenario proposal");
    const proposal = scheduled.action.proposal;
    proposal.category = "social";
    const meetingAt = scheduled.at + DAY;
    proposal.window = { start: meetingAt, end: meetingAt };
    const peer = opts.personas.find(p => p.id === "peer")!;
    // Keep the public intent identical: the Network may still have a stale record.
    if (mode === "absent") peer.hidden.desires = [];
    else if (mode !== "permanent") peer.hidden.desires[0]!.lapsesAt = meetingAt + ({ before: -1, at: 0, after: 1 }[mode]);
    const result = await new World(opts).run();
    const asks = result.memories.get("requester")!.signals!.filter(s => s.source === "ask" && s.category === "social" && s.at < scheduled.at);
    expect(asks.length).toBeGreaterThan(0);
    const decisions = result.records.filter(r => r.type === "decision")
      .filter(r => r.memberId === "requester" && r.proposalId === proposal.id && r.messageType === "proposal");
    expect(decisions).toHaveLength(1);
    const decision = decisions[0]!;
    const replies = result.channel.all().filter(m => m.direction === "inbound" && m.memberId === "requester" && m.ts === decision.t + decision.delayMs);
    expect(replies).toHaveLength(1);
    actual.push({ seed, mode, intent: decision.intent, reply: replies[0]!.body });
  }
  // Check both the real decision and the text that reached the Network. Equality
  // to the no-want control catches expired wants without assuming every poor fit declines.
  for (const seed of [1, 2, 9]) {
    const rows = actual.filter(r => r.seed === seed);
    const absent = rows.find(r => r.mode === "absent")!;
    expect(absent.intent).toBe("decline");
    for (const row of rows.filter(r => r.mode === "before" || r.mode === "at")) {
      expect({ intent: row.intent, reply: row.reply }).toEqual({ intent: absent.intent, reply: absent.reply });
    }
    for (const row of rows.filter(r => r.mode === "permanent" || r.mode === "after")) expect(row.intent).toBe("accept");
  }
});
