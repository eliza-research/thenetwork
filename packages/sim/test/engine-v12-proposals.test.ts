// Engine v1.2 proposals for the simulator (docs/results/2026-10-07-engine-v1.2.md):
// P1 records fed to the snapshot, P4 proposal category reaches the oracle, P5 no duplicate
// acknowledgements from the stub network.
import { describe, expect, test } from "bun:test";
import { MINUTE, SimClock, type Proposal, type ScoreComponents } from "@thenetwork/core";
import type { NetworkContext, NetworkUnderTest } from "../src/network.ts";
import { StubNetwork, World, generatePersonas } from "../src/index.ts";

const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
  interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};

describe("world: engine v1.2 proposals", () => {
  test("P1: the snapshot carries the Network's own history from the run records", async () => {
    let ctx!: NetworkContext;
    const spy: NetworkUnderTest = { name: "spy", init: c => { ctx = c; }, onInbound: () => {}, tick: () => {} };
    const personas = generatePersonas({ n: 10, seed: 3, joinSpreadDays: 1 });
    const w = new World({ seed: 3, personas, days: 2, network: spy, writeLog: false });
    await w.run();
    const snap = ctx.snapshot() as unknown as Record<string, unknown>;
    for (const k of ["interactions", "feedback", "openOpportunities", "unsentProposalIds"]) expect(Array.isArray(snap[k])).toBe(true);
  });

  test("P4: a romance proposal is judged as romance (category reaches the oracle)", async () => {
    let ctx!: NetworkContext;
    const spy: NetworkUnderTest = { name: "spy", init: c => { ctx = c; }, onInbound: () => {}, tick: () => {} };
    const personas = generatePersonas({ n: 6, seed: 4, adversarialRate: 0, cityWeights: { sf: 1, nyc: 0 }, joinSpreadDays: 1 });
    const adults = personas.filter(p => p.hidden.trueAge >= 18);
    const [a, b] = adults as [typeof adults[0], typeof adults[0]];
    a.hidden.romance.optIn = false; // romance is incompatible for this pair
    const w = new World({ seed: 4, personas, days: 1, network: spy, writeLog: false });
    await w.begin();
    const base: Proposal = {
      id: "romance-1", kind: "intro", participants: [a.id, b.id], alternates: [], objective: "A low-key dinner introduction",
      city: "sf", score: 0.5, components: ZERO, exploration: false, explanations: {}, generator: "test", createdAt: w.clock.now(),
    };
    ctx.recordProposal({ ...base, category: "romance" }, "scenario");
    ctx.recordProposal({ ...base, id: "untyped-1" }, "scenario");
    const flags = (id: string) => {
      const r = w.records.find(x => x.type === "proposal" && x.proposal.id === id);
      return r?.type === "proposal" ? r.oracle.flags : [];
    };
    expect(flags("romance-1")).toContain("romance_mismatch");
    expect(flags("untyped-1")).not.toContain("romance_mismatch");
  });
});

describe("stub network: P5 acknowledgement de-duplication", () => {
  function harness() {
    const clock = new SimClock(Date.UTC(2026, 9, 5, 19)); // noon in SF
    const sent: { body: string; t: number }[] = [];
    let seq = 0;
    const snapshot = () => ({
      members: [{ id: "m1", name: "Ana Diaz", age: 30, homeCity: "sf", prefs: { quietHours: [22, 8] } }], facets: [],
    }) as any;
    const ctx = {
      clock, snapshot,
      send: (_id: string, body: string) => { sent.push({ body, t: clock.now() }); return { id: `o${++seq}`, status: "delivered" } as any; },
      recordProposal: () => {}, recordMeeting: () => "mt", recordBlock: () => {}, log: () => {},
    } as unknown as NetworkContext;
    const net = new StubNetwork({ seed: 1, randomIntros: false });
    net.init(ctx);
    let n = 0;
    const say = (body: string) => net.onInbound({ id: `i${++n}`, memberId: "m1", body, ts: clock.now(), channel: "sms" });
    return { clock, sent, say };
  }

  test("the same acknowledgement is not sent twice within 10 minutes, and is sent again after", async () => {
    const { clock, sent, say } = harness();
    await say("hi there");                                         // onboarding question
    await say("more board games and long hikes please");          // onboarding answer
    const ack = "Thanks, noted. I'll reach out if something fits.";
    await say("also into pottery classes on weekends");
    clock.advance(2 * MINUTE);
    await say("and maybe a running group in the mornings");
    expect(sent.filter(s => s.body === ack)).toHaveLength(1);
    clock.advance(11 * MINUTE);
    await say("oh and live jazz on weeknights too");
    expect(sent.filter(s => s.body === ack)).toHaveLength(2);
  });
});
