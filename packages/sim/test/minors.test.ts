// Minors policy in the simulator (PRD 17.4 as amended 2026-10-05): honest under-18 personas,
// an oracle that treats any proposal involving a minor as unsafe, the minorContacts invariant
// (must be 0), and a stub baseline that never connects a minor even when handed a proposal.
import { describe, expect, test } from "bun:test";
import { computeMetrics, type RunRecord } from "@thenetwork/judge";
import { createEngine } from "../engines/engine-v1.ts";
import { DEFAULT_START, Oracle, StubNetwork, generatePersonas, runWorld } from "../src/index.ts";
import { DEFAULT_MINOR_SHARE } from "../src/generator.ts";

describe("minor personas (generator)", () => {
  test("default share of honest minors aged 13-17 who state their real age; romance is off", () => {
    const ps = generatePersonas({ n: 200, seed: 3 });
    const minors = ps.filter(p => p.hidden.trueAge < 18 && p.hidden.adversarial !== "minor");
    expect(minors.length).toBe(Math.round(200 * DEFAULT_MINOR_SHARE));
    for (const m of minors) {
      expect(m.hidden.trueAge).toBeGreaterThanOrEqual(13);
      expect(m.hidden.trueAge).toBeLessThanOrEqual(17);
      expect(m.public.claimedAge).toBe(m.hidden.trueAge);
      expect(m.hidden.adversarial).toBeUndefined();
      expect(m.hidden.romance.optIn).toBe(false);
      expect(m.public.statedIntents.some(i => i.category === "romance")).toBe(false);
    }
  });

  test("share is configurable; 0 reproduces the pre-policy population exactly", () => {
    expect(generatePersonas({ n: 100, seed: 9, minorShare: 0.2 }).filter(p => p.public.claimedAge < 18).length).toBe(20);
    const none = generatePersonas({ n: 100, seed: 9, minorShare: 0 });
    expect(none.filter(p => p.public.claimedAge < 18).length).toBe(0);
    // Non-minor personas are identical whatever the share (minors use their own RNG forks).
    const some = generatePersonas({ n: 100, seed: 9, minorShare: 0.2 });
    for (let i = 0; i < 100; i++) if (some[i]!.public.claimedAge >= 18) expect(some[i]!.name).toBe(none[i]!.name);
  });
});

describe("oracle: any proposal involving a minor is unsafe", () => {
  const ps = generatePersonas({ n: 60, seed: 5, minorShare: 0.2, adversarialRate: 0 });
  const o = new Oracle(ps, 5, DEFAULT_START);
  const minor = ps.find(p => p.hidden.trueAge < 18)!;
  const adults = ps.filter(p => p.hidden.trueAge >= 18 && p.homeCity === minor.homeCity);
  test("pair, group and single-person asks with a minor are unsafe and never compatible", () => {
    for (const parts of [[minor.id, adults[0]!.id], [adults[0]!.id, adults[1]!.id, minor.id], [minor.id]]) {
      const v = o.evaluate({ id: `x${parts.length}`, kind: parts.length === 1 ? "network_growth" : "intro", participants: parts, city: minor.homeCity });
      expect(v.unsafe).toBe(true);
      expect(v.compatible).toBe(false);
      expect(v.flags).toContain("minor_included");
    }
  });
  test("adult-only proposals are not flagged", () => {
    const v = o.evaluate({ id: "y", kind: "intro", participants: [adults[0]!.id, adults[1]!.id], city: minor.homeCity });
    expect(v.flags).not.toContain("minor_included");
    expect(v.unsafe).toBe(false);
  });
});

describe("minorContacts invariant (judge metrics)", () => {
  const T0 = DEFAULT_START;
  const persona = (id: string, name: string, age: number) => ({ t: T0, type: "persona", persona: { id, name, archetype: "regular", homeCity: "sf", joinDay: 0, trueAge: age, claimedAge: age, quietHours: [22, 8], romanceOptIn: false } }) as RunRecord;
  const comps = { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 };
  const prop = (id: string, parts: string[], source: "network" | "engine" | "scenario", alternates: string[] = []) => ({ t: T0 + 1, type: "proposal", source,
    proposal: { id, kind: "intro", participants: parts, alternates, objective: "coffee", city: "sf", score: 1, components: comps, exploration: false, explanations: {}, generator: "x", createdAt: T0 },
    oracle: { compatible: false, quality: 0.5, minEnjoyment: 0.5, flags: [], participants: {} } }) as RunRecord;
  const msg = (id: string, to: string, body: string, meta: object = {}) => ({ t: T0 + 2, type: "message", msg: { id, ts: T0 + 2, direction: "outbound", memberId: to, body, status: "delivered", meta } }) as RunRecord;
  const base = (): RunRecord[] => [
    { t: T0, type: "run_start", runId: "r", seed: 1, start: T0, config: { days: 1 } },
    persona("a", "Ada Kowalski", 30), persona("b", "Ben Achebe", 40), persona("k", "Milo Reyes", 15),
    ...["a", "b", "k"].map(id => ({ t: T0, type: "join", memberId: id }) as RunRecord),
  ];

  test("clean run: 0, and minors are excluded from fairness and counted in run.minors", () => {
    const m = computeMetrics([...base(), prop("p1", ["a", "b"], "network"), msg("o1", "a", "Meet Ben A.?", { proposalId: "p1" }), msg("o2", "k", "Here is a public climbing class near you.")]);
    expect(m.safety.minorContacts).toBe(0);
    expect(m.invariants.byRule.minor_contact).toBeUndefined();
    expect(m.run.minors).toBe(1);
    expect(m.fairness.zeroProposalShare).toBe(0);
  });

  test("counts Network/engine proposals (participant or alternate), meetings, and messages about or naming a minor", () => {
    const m = computeMetrics([...base(),
      prop("p1", ["a", "k"], "engine"),                                   // 1 proposal
      prop("p2", ["a", "b"], "network", ["k"]),                           // 1 alternate
      prop("p3", ["b", "k"], "scenario"),                                 // input only: not counted itself
      msg("o1", "b", "Want to meet them?", { proposalId: "p3" }),         // 1 message acting on it
      { t: T0 + 3, type: "meeting_scheduled", meetingId: "mt1", proposalId: "p1", participants: ["a", "k"], at: T0 + 9, city: "sf" } as RunRecord, // 1
      msg("o2", "a", "Milo R. is into climbing too."),                   // 1 names the minor to an adult
      msg("o3", "k", "Hi Milo Reyes, here's a public event."),            // to the minor themselves: fine
    ]);
    expect(m.safety.minorContacts).toBe(5);
    expect(m.invariants.byRule.minor_contact).toBe(5);
  });

  test("age-lying adversaries are reported separately (needs age verification, not matching)", () => {
    const liar = { t: T0, type: "persona", persona: { id: "l", name: "Lia Moss", archetype: "regular", adversarial: "minor", homeCity: "sf", joinDay: 0, trueAge: 16, claimedAge: 19, quietHours: [22, 8], romanceOptIn: false } } as RunRecord;
    const m = computeMetrics([...base(), liar, { t: T0, type: "join", memberId: "l" } as RunRecord, prop("p1", ["a", "l"], "engine")]);
    expect(m.safety.minorContacts).toBe(0);
    expect(m.safety.undisclosedMinorProposals).toBe(1);
  });
});

describe("worlds with minors: stub and engine never contact them", () => {
  const personas = () => generatePersonas({ n: 60, seed: 12, minorShare: 0.2, joinSpreadDays: 3 });
  test("random stub baseline: minorContacts == 0, minors still get single-player replies", async () => {
    const r = await runWorld({ seed: 12, personas: personas(), days: 10, network: new StubNetwork({ seed: 12, introRate: 0.5 }), writeLog: false, runId: "minors-stub" });
    expect(r.metrics.run.minors).toBe(12);
    expect(r.metrics.safety.minorContacts).toBe(0);
    expect(r.metrics.proposals.total).toBeGreaterThan(5);
    const minors = new Set(r.personas.filter(p => p.public.claimedAge < 18).map(p => p.id));
    const toMinors = r.records.filter(x => x.type === "message" && x.msg.direction === "outbound" && minors.has(x.msg.memberId) && x.msg.status === "delivered");
    expect(toMinors.length).toBeGreaterThan(0);
    for (const x of toMinors) if (x.type === "message") expect(["onboarding", "info", "concierge"]).toContain(String(x.msg.meta?.type));
  }, 30_000);

  test("engine v1 through the stub: minorContacts == 0", async () => {
    const r = await runWorld({ seed: 12, personas: personas(), days: 10, network: new StubNetwork({ seed: 12, randomIntros: false }), engine: createEngine(), writeLog: false, runId: "minors-engine" });
    expect(r.metrics.proposals.bySource.engine ?? 0).toBeGreaterThan(0);
    expect(r.metrics.safety.minorContacts).toBe(0);
    // Every remaining oracle 'minor' flag is an age-lying adversary the engine cannot see.
    expect(r.metrics.proposals.unsafe.minor).toBe(r.metrics.safety.undisclosedMinorProposals);
  }, 60_000);

  test("stub refuses a proposal handed to it that involves a minor (whole proposal, not trimmed)", async () => {
    const ps = generatePersonas({ n: 3, seed: 4, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 1, nyc: 0 }, joinSpreadDays: 1 });
    ps[2]!.hidden.trueAge = ps[2]!.public.claimedAge = 16;
    for (const p of ps) { p.joinDay = 0; p.hidden.responsiveness.ignoreProb = 0; }
    const stub = new StubNetwork({ seed: 4, randomIntros: false });
    const p = { id: "bad", kind: "group" as const, participants: ps.map(x => x.id), alternates: [], objective: "board games", city: "sf" as const, score: 1,
      components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 },
      exploration: false, explanations: {}, generator: "test", createdAt: 0 };
    const r = await runWorld({ seed: 4, personas: ps, days: 3, network: stub, writeLog: false, runId: "minors-refuse",
      actions: [{ at: DEFAULT_START + 36 * 3_600_000, action: { do: "propose", proposal: p } }] });
    expect(r.records.some(x => x.type === "network_log" && x.kind === "proposal_skipped" && x.detail.reason === "minors_policy")).toBe(true);
    expect(r.records.some(x => x.type === "message" && x.msg.meta?.proposalId === "bad")).toBe(false);
    expect(r.metrics.safety.minorContacts).toBe(0);
  }, 30_000);
});
