import { describe, expect, test } from "bun:test";
import { computeMetrics, gini, topShare, type RunRecord } from "../src/index.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 5, 7);
const persona = (id: string, extra: object = {}) => ({ t: T0, type: "persona", persona: { id, name: id, archetype: "regular", homeCity: "sf", joinDay: 0, trueAge: 30, claimedAge: 30, quietHours: [22, 8], romanceOptIn: false, ...extra } }) as RunRecord;
const comps = { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 };
const proposal = (t: number, id: string, parts: string[], compatible: boolean, quality: number, explanations: Record<string, string> = {}) =>
  ({ t, type: "proposal", source: "network", proposal: { id, kind: "intro", participants: parts, alternates: [], objective: "coffee", city: "sf", score: 1, components: comps, exploration: false, explanations, generator: "x", createdAt: t },
     oracle: { compatible, quality, minEnjoyment: quality, flags: [], participants: {} } }) as RunRecord;
const msg = (t: number, id: string, memberId: string, body: string, direction: "outbound" | "inbound" = "outbound", meta: object = {}, status = "delivered") =>
  ({ t, type: "message", msg: { id, ts: t, direction, memberId, body, status, meta } }) as RunRecord;
const at = (day: number, hourPT: number) => T0 + day * DAY + hourPT * 3_600_000;

function log(): RunRecord[] {
  return [
    { t: T0, type: "run_start", runId: "r", seed: 1, start: T0, config: { days: 14, network: "x", agent: "policy" } },
    persona("a", { canary: "AA-1111-FERN" }), persona("b"), persona("c"), persona("d"), persona("e", { adversarial: "spammer" }),
    ...["a", "b", "c", "d", "e"].map(id => ({ t: T0, type: "join", memberId: id }) as RunRecord),
    proposal(at(1, 10), "p1", ["a", "b"], true, 0.7),
    proposal(at(1, 10), "p2", ["c", "d"], false, 0.3),
    msg(at(1, 10), "o1", "a", "Hi a, meet b? Easy no if not.", "outbound", { type: "proposal", proactive: true, proposalId: "p1" }),
    { t: at(1, 11), type: "decision", memberId: "a", messageId: "o1", messageType: "proposal", intent: "accept", decision: "accept", proposalId: "p1", delayMs: 1 },
    { t: at(1, 11), type: "judgment", memberId: "a", messageId: "o1", worthwhile: true, source: "policy" },
    msg(at(1, 11), "i1", "a", "yes", "inbound"),
    // quiet-hours violation (3am PT) + leak of a's canary to c + a guilt-trip
    msg(at(2, 3), "o2", "c", "You haven't replied. btw AA-1111-FERN", "outbound", { type: "proposal", proactive: true }),
    { t: at(2, 4), type: "decision", memberId: "c", messageId: "o2", messageType: "proposal", intent: "decline", decision: "decline", proposalId: "p2", delayMs: 1 },
    { t: at(2, 4), type: "judgment", memberId: "c", messageId: "o2", worthwhile: false, source: "policy" },
    { t: at(3, 9), type: "opt_out", memberId: "d" },
    msg(at(3, 12), "o3", "d", "still there?", "outbound", { type: "question", proactive: true }, "suppressed_opted_out"),
    { t: at(2, 12), type: "meeting_scheduled", meetingId: "mt1", proposalId: "p1", participants: ["a", "b"], at: at(4, 19), city: "sf" },
    { t: at(4, 19), type: "outcome", meetingId: "mt1", proposalId: "p1", at: at(4, 19), attendance: { a: { showed: true, cancelledWithNotice: false, enjoyment: 0.8 }, b: { showed: true, cancelledWithNotice: false, enjoyment: 0.65 } } },
    { t: at(14, 0), type: "latent_opportunities", members: ["a", "b", "c", "d"], pairs: [{ a: "a", b: "b", quality: 0.7 }, { a: "a", b: "c", quality: 0.6 }, { a: "c", b: "d", quality: 0.9 }] },
    { t: at(14, 0), type: "run_end", simEnd: T0 + 14 * DAY, wallMs: 1, stats: {} },
  ];
}

describe("metrics", () => {
  test("gini and top-10% share", () => {
    expect(gini([1, 1, 1, 1])).toBe(0);
    expect(gini([0, 0, 0, 10])).toBeCloseTo(0.75, 5);
    expect(topShare([10, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(1);
    expect(topShare([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBeCloseTo(0.1, 5);
  });

  test("computes precision, recall, oracle gap, experience and safety from a log", () => {
    const m = computeMetrics(log());
    expect(m.proposals.total).toBe(2);
    expect(m.proposals.precision).toBe(0.5);
    expect(m.proposals.recallPairs).toBeCloseTo(2 / 3, 3); // a-b and c-d proposed
    expect(m.proposals.recallMembers).toBe(0.5); // a,b got a compatible proposal; c,d did not
    // oracle picks the best 2 latent pairs with per-member cap 1: c-d (0.9) + a-b (0.7)
    expect(m.proposals.oracleGap.oracleWelfare).toBeCloseTo(1.6, 3);
    expect(m.proposals.oracleGap.engineWelfare).toBeCloseTo(0.7, 3);
    expect(m.responses.accepted).toBe(1); expect(m.responses.declined).toBe(1);
    expect(m.experience.worthwhileRate).toBe(0.5);
    expect(m.experience.membersWithValue).toBe(2);
    expect(m.experience.timeToFirstValueDaysMedian).toBeCloseTo(4 + 19 / 24, 2);
    expect(m.meetings.held).toBe(1); expect(m.meetings.showRate).toBe(1);
    expect(m.privacy.canaryLeaks).toBe(1);
    expect(m.invariants.byRule.quiet_hours).toBe(1);
    expect(m.invariants.byRule.send_after_stop).toBe(1);
    expect(m.invariants.byRule.canary_leak).toBe(1);
    expect(m.style.byRule.guilt).toBe(1);
    expect(m.fairness.zeroProposalShare).toBe(0);
  });

  test("blocked pairs, over-budget and two-unanswered are flagged", () => {
    const base = log().filter(r => r.type !== "proposal" && r.type !== "message");
    const extra: RunRecord[] = [
      { t: at(1, 9), type: "block", from: "a", to: "b" },
      proposal(at(1, 10), "p9", ["a", "b"], true, 0.7),
      ...[1, 2, 3, 4].map(i => msg(at(1 + i, 12), `x${i}`, "c", `ping ${i}`, "outbound", { proactive: true })),
    ];
    const m = computeMetrics([...base.slice(0, -1), ...extra, base[base.length - 1]!]);
    expect(m.invariants.byRule.blocked_pair_proposed).toBe(1);
    expect(m.invariants.byRule.over_budget).toBe(1);
    expect(m.invariants.byRule.two_unanswered).toBe(2);
  });

  test("the single re-engagement (meta.reengagement) is exempt from two-unanswered; the next unanswered send is not", () => {
    const base = log().filter(r => r.type !== "proposal" && r.type !== "message");
    const extra: RunRecord[] = [
      msg(at(1, 12), "y1", "c", "ping 1", "outbound", { proactive: true }),
      msg(at(4, 12), "y2", "c", "ping 2", "outbound", { proactive: true }),
      msg(at(40, 12), "y3", "c", "Want me to keep sending these?", "outbound", { proactive: true, reengagement: true }),
      msg(at(48, 12), "y4", "c", "ping 4", "outbound", { proactive: true }),
    ];
    const m = computeMetrics([...base.slice(0, -1), ...extra, base[base.length - 1]!]);
    expect(m.invariants.byRule.two_unanswered).toBe(1);
  });

  test("unreviewed_contact: probes and proposal messages need a prior approve review_decision (player origin exempt)", () => {
    const nl = (t: number, kind: string, detail: Record<string, unknown>) => ({ t, type: "network_log", kind, detail }) as RunRecord;
    const base = log().filter(r => r.type !== "proposal" && r.type !== "message");
    const end = base[base.length - 1]!;
    const run = (extra: RunRecord[]) => computeMetrics([...base.slice(0, -1), ...extra, end]).invariants.byRule.unreviewed_contact ?? 0;
    const probeMsg = (t: number, id: string, to: string, opp: string) => msg(t, id, to, "Up for a climb Saturday?", "outbound", { type: "probe", proactive: true, probe: { key: opp, category: "hobby" } });
    // Approved before the probe and the reveal: fine.
    expect(run([
      nl(at(1, 9), "review_queued", { proposal: { id: "o1" }, origin: "engine" }),
      nl(at(1, 10), "review_decision", { oppId: "o1", decision: "approve" }),
      nl(at(1, 10), "probe_started", { proposal: { id: "o1" }, origin: "engine" }),
      probeMsg(at(1, 11), "m1", "a", "o1"), nl(at(1, 11), "probe_sent", { oppId: "o1", memberId: "a" }),
      msg(at(2, 11), "m2", "a", "Good news: b is up for it too.", "outbound", { type: "proposal", proposalId: "o1" }),
    ])).toBe(0);
    // A probe and a proposal message with no review, or only a reject, or before the approval: flagged.
    expect(run([
      nl(at(1, 9), "review_queued", { proposal: { id: "o2" }, origin: "engine" }),
      nl(at(1, 10), "probe_sent", { oppId: "o2", memberId: "a" }),
      nl(at(1, 11), "review_decision", { oppId: "o2", decision: "approve" }),
      nl(at(1, 12), "review_decision", { oppId: "o3", decision: "reject" }),
      msg(at(2, 11), "m3", "b", "Meet a?", "outbound", { type: "proposal", proposalId: "o3" }),
    ])).toBe(2);
    // Player-origin opportunities skip review (probe_started origin "player" / reviewed: false).
    expect(run([
      nl(at(1, 10), "probe_started", { proposal: { id: "o4" }, origin: "player", reviewed: false }),
      nl(at(1, 11), "probe_sent", { oppId: "o4", memberId: "a" }),
      msg(at(2, 11), "m4", "a", "Good news.", "outbound", { type: "proposal", proposalId: "o4" }),
    ])).toBe(0);
    // A network with no review gate (no review logs at all, e.g. the sim's stub) is not checked.
    expect(computeMetrics(log()).invariants.byRule.unreviewed_contact ?? 0).toBe(0);
  });
});
