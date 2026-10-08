// Regression tests for the 2026-10-08 adversarial audit (packages/sim findings).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type Proposal } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { DEFAULT_START, networkStateFromRecords } from "../src/index.ts";

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
