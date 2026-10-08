// Regression tests for the 2026-10-08 adversarial audit (packages/sim findings).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type Proposal } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { DEFAULT_START, generatePersonas, networkStateFromRecords, Oracle, PRIMED_MODEL, runWorld, StubNetwork } from "../src/index.ts";

const T0 = DEFAULT_START + 2 * DAY;
const prop = (id: string, participants: string[]): Proposal => ({
  id, kind: "intro", participants, alternates: [], objective: "Intro", city: "sf", score: 0.5,
  components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
  exploration: false, explanations: {}, generator: "test", createdAt: T0,
});
const oracle = { compatible: true, quality: 0.7, minEnjoyment: 0.7, flags: [], participants: {} };
let seq = 0;
const out = (t: number, memberId: string, type: string, proposalId?: string): RunRecord =>
  ({ t, type: "message", msg: { id: `o${++seq}`, ts: t, direction: "outbound", memberId, body: "…", status: "delivered", meta: { type, proposalId } } });
const inbound = (t: number, memberId: string, body: string): RunRecord =>
  ({ t, type: "message", msg: { id: `i${++seq}`, ts: t, direction: "inbound", memberId, body, status: "delivered" } });
const decision = (t: number, memberId: string, d: string, intent: string, proposalId: string): RunRecord =>
  ({ t, type: "decision", memberId, messageId: "x", messageType: "proposal", intent, decision: d, proposalId, delayMs: 0 });

describe("sim-worlds-1: the Network's own state carries no hidden decisions", () => {
  test("an ignored invite is no response, not a decline; meeting enjoyment without an answered feedback request is not feedback", () => {
    const records: RunRecord[] = [
      { t: T0, type: "proposal", source: "engine", proposal: prop("p1", ["a", "b"]), oracle },
      out(T0, "a", "proposal", "p1"), out(T0, "b", "proposal", "p1"),
      // a privately declines but never replies; b says yes.
      decision(T0 + HOUR, "a", "decline", "ignore", "p1"),
      decision(T0 + HOUR, "b", "accept", "accept", "p1"),
      inbound(T0 + 2 * HOUR, "b", "Yes, I'd like that!"),
      { t: T0 + 3 * HOUR, type: "meeting_scheduled", meetingId: "m1", proposalId: "p1", participants: ["a", "b"], at: T0 + DAY, city: "sf" },
      { t: T0 + DAY, type: "outcome", meetingId: "m1", proposalId: "p1", at: T0 + DAY, attendance: { a: { showed: true, cancelledWithNotice: false, enjoyment: 0.1 }, b: { showed: true, cancelledWithNotice: false, enjoyment: 0.9 } } },
      // A feedback request a never answers.
      out(T0 + DAY + 3 * HOUR, "a", "feedback_request", "p1"),
    ];
    const s = networkStateFromRecords(records, T0 + 3 * DAY);
    const i = s.interactions.find(x => x.id === "p1")!;
    expect(i.declinedBy).toBeUndefined();
    expect(i.acceptedBy).toEqual(["b"]);
    expect(i.noResponse).toEqual(["a"]);
    expect(i.outcome).toBe("completed");
    expect(s.feedback).toEqual([]);
  });

  test("feedback comes from the member's answer, read from their words", () => {
    const records: RunRecord[] = [
      { t: T0, type: "proposal", source: "engine", proposal: prop("p1", ["a", "b"]), oracle },
      { t: T0 + 3 * HOUR, type: "meeting_scheduled", meetingId: "m1", proposalId: "p1", participants: ["a", "b"], at: T0 + DAY, city: "sf" },
      { t: T0 + DAY, type: "outcome", meetingId: "m1", proposalId: "p1", at: T0 + DAY, attendance: { a: { showed: true, cancelledWithNotice: false, enjoyment: 0.9 }, b: { showed: true, cancelledWithNotice: false, enjoyment: 0.9 } } },
      { t: T0 + DAY + 4 * HOUR, type: "feedback", memberId: "a", proposalId: "p1", text: "Honestly not great, we didn't have much to talk about." },
    ];
    const s = networkStateFromRecords(records, T0 + 3 * DAY);
    expect(s.feedback.map(f => [f.from, f.about, f.sentiment, f.wouldMeetAgain])).toEqual([["a", "b", "negative", false]]);
  });
});

describe("matching-e2e-4: a probe-primed yes still depends on who the others are", () => {
  test("with identityFit set, primed accept is PRIMED_MODEL.identity for a good fit and much lower for a poor fit", () => {
    const ps = generatePersonas({ n: 60, seed: 3, minorShare: 0 }).filter(p => !p.hidden.adversarial && p.homeCity === "sf");
    const o = new Oracle(ps, 3, DEFAULT_START);
    const a = ps[0]!;
    const at = DEFAULT_START + DAY;
    const prop = (b: string) => ({ id: `p:${b}`, kind: "intro" as const, participants: [a.id, b], city: "sf" as const, window: { start: at, end: at }, category: "social" as const });
    const others = ps.slice(1).filter(b => !a.relationships.some(r => r.to === b.id))
      .map(b => ({ b, acc: o.evaluate(prop(b.id)).participants[a.id]!.acceptProb })).sort((x, y) => x.acc - y.acc);
    PRIMED_MODEL.identityFit = 0.55;
    const poor = o.evaluatePrimed(prop(others[0]!.b.id), { [a.id]: "probe" }).participants[a.id]!.acceptProb;
    const good = o.evaluatePrimed(prop(others.at(-1)!.b.id), { [a.id]: "probe" }).participants[a.id]!.acceptProb;
    delete PRIMED_MODEL.identityFit;
    expect(good).toBeCloseTo(PRIMED_MODEL.identity, 2);
    expect(poor).toBeLessThan(0.6 * PRIMED_MODEL.identity);
  });
});

describe("sim-worlds-11: the world's oracle sees the proposal category", () => {
  test("a romance-category proposal with a neutral objective between incompatible members is flagged unsafe", async () => {
    const personas = generatePersonas({ n: 24, seed: 2, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 1, nyc: 0 }, joinSpreadDays: 1 });
    const [a, b] = personas.filter(p => !p.hidden.romance.optIn);
    let sent = false;
    const engine = {
      name: "one-romance-proposal",
      propose(snap: any, o?: { city?: string }) {
        if (sent || o?.city !== "sf") return [];
        sent = true;
        return [{ id: "r1", kind: "intro", category: "romance", participants: [a!.id, b!.id], alternates: [], objective: "coffee", city: "sf",
          score: 1, components: {} as any, exploration: false, explanations: {}, generator: "test", createdAt: snap.now }];
      },
    };
    const r = await runWorld({ seed: 2, personas, days: 2, network: new StubNetwork({ seed: 2, randomIntros: false }), engine: engine as any, writeLog: false });
    const rec = r.records.find(x => x.type === "proposal" && x.proposal.id === "r1");
    expect(rec?.type === "proposal" && rec.oracle.flags).toContain("romance_mismatch");
    expect(rec?.type === "proposal" && rec.oracle.unsafe).toBe(true);
  });
});
