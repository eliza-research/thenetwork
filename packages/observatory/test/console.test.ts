// Admin-console data in game mode (docs/admin-console.md section 6): review edit and re-roll with the
// re-check, the matching switch and its history, the member perspective timeline, per-opportunity
// history, requests, health alerts, the PRD 28.2 scorecard, growth, the safety console, search and
// run diff. Everything runs the real ConsentNetwork on the NYC world.
import { afterEach, describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE } from "@thenetwork/core";
import { describe as describeEvent, eventOf } from "../src/events.ts";
import { runDiff } from "../src/runDiff.ts";
import { GameSource } from "../src/sources/game.ts";

const T = 300_000;
const live: GameSource[] = [];
async function game(opts: ConstructorParameters<typeof GameSource>[0] = {}) {
  const g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1, ...opts });
  live.push(g);
  await g.init();
  return g;
}
afterEach(async () => { for (const g of live.splice(0)) await g.dispose(); });

describe("admin console (game mode)", () => {
  test("review: edit is leak-checked then approves; re-roll swaps in an alternate and waits again; seconds add up; the reviewer is the staff id", async () => {
    const g = await game({ review: "human" });
    await g.control({ type: "step", ms: DAY });
    const queued = g.state().opportunities.filter(o => o.state === "IN_REVIEW" && o.origin === "engine");
    expect(queued.length).toBeGreaterThanOrEqual(2);
    const [a, b] = queued as [typeof queued[0], typeof queued[0]];
    // A private fact of a participant cannot go into another participant's explanation.
    const priv = g.world.snapshot().facets.find(f => f.scope === "agent_private" && f.memberId === a.participants[0] && f.value.length > 12);
    if (priv) {
      const leak = await g.control({ type: "review", oppId: a.id, decision: "edit", explanations: { [a.participants[1]!]: `They told us: ${priv.value}` } }, "token:reviewer#t1");
      expect(leak).toMatchObject({ ok: false, code: "edit_leak" });
    }
    expect(await g.control({ type: "review", oppId: a.id, decision: "edit", explanations: { [b.participants[0]!]: "x" } }, "r")).toMatchObject({ ok: false, code: "not_a_participant" });
    const ok = await g.control({ type: "review", oppId: a.id, decision: "edit", objective: "coffee and a walk", secondsSpent: 40 }, "token:reviewer#t1");
    expect(ok.ok).toBe(true);
    let s = g.state();
    const ea = s.opportunities.find(o => o.id === a.id)!;
    expect(ea.review).toMatchObject({ decision: "approve", reviewer: "token:reviewer#t1", secondsSpent: 40, edits: ["objective"] });
    expect(ea.state).not.toBe("IN_REVIEW");

    // Re-roll the second item: swap its second participant for the best alternate.
    const r1 = await g.control({ type: "review", oppId: b.id, decision: "reroll", swapOut: b.participants[1], secondsSpent: 15, note: "weak fit" }, "sso@example.org");
    expect(r1.ok).toBe(true);
    s = g.state();
    const rb = s.opportunities.find(o => o.id === b.id)!;
    expect(rb.review?.rerolls).toBe(1);
    expect(rb.review?.secondsSpent).toBe(15);
    if (rb.state === "IN_REVIEW") {
      // Swapped: the old participant is out, and nobody has been contacted.
      expect(rb.participants).not.toContain(b.participants[1]);
      expect(rb.participants).toContain(b.participants[0]);
      expect(rb.review?.deadline).toBeGreaterThan(b.review!.deadline);
      const tl = (await g.timeline(b.participants[0]!))!;
      expect(tl.entries.some(e => e.kind === "event" && e.event.type === "review_decision" && e.event.detail?.decision === "reroll")).toBe(true);
    } else {
      // No eligible alternate: it closed and goes back to the engine.
      expect([rb.state, rb.reason]).toEqual(["SKIPPED", expect.stringContaining("re-rolled")]);
    }
    // Opportunity history: every step, oldest first, no message text.
    const hist = (await g.opportunity(b.id))!.events;
    expect(hist.map(e => e.type)).toEqual(expect.arrayContaining(["review_queued", "review_decision"]));
    expect(hist.every((e, i) => i === 0 || e.t >= hist[i - 1]!.t)).toBe(true);
    expect(rb.ageHours).toBeGreaterThan(0);
  }, T);

  test("matching switch: off pauses the engine and refuses approve (matching_paused); the change is versioned with who and when", async () => {
    const g = await game({ review: "human" });
    await g.control({ type: "step", ms: DAY });
    const item = g.state().opportunities.find(o => o.state === "IN_REVIEW")!;
    const runs = g.state().engineRuns.length;
    expect((await g.control({ type: "matching", on: false }, "admin@example.org")).ok).toBe(true);
    expect(await g.control({ type: "review", oppId: item.id, decision: "approve" }, "rev")).toMatchObject({ ok: false, code: "matching_paused" });
    await g.control({ type: "step", ms: DAY });
    let s = g.state();
    expect(s.engineRuns.length).toBe(runs); // no engine run while off
    expect(s.network?.matchingEnabled).toBe(false);
    expect(s.stats.alerts!.some(a => a.key === "matching_off")).toBe(true);
    await g.control({ type: "matching", on: true }, "admin@example.org");
    await g.control({ type: "review_mode", mode: "auto" }, "admin@example.org");
    const cfg = await g.config();
    expect(cfg.history.map(h => [h.version, h.key, h.from, h.to, h.actor])).toEqual([
      [1, "matching", true, false, "admin@example.org"], [2, "matching", false, true, "admin@example.org"], [3, "review_mode", "human", "auto", "admin@example.org"],
    ]);
    expect(cfg.history.every(h => h.at >= s.clock.start)).toBe(true);
    expect(cfg).toMatchObject({ matchingEnabled: true, reviewMode: "auto", canChange: true });
    expect(cfg.outreach.maxPerWeek).toBe(4);
    expect(cfg.network.reviewSlaHours).toBe(12);
    await g.control({ type: "step", ms: DAY });
    s = g.state();
    expect(s.engineRuns.length).toBeGreaterThan(runs);
  }, T);

  test("timeline: messages and what the system did, in time order; requests, alerts, scorecard and growth; search never touches inbound text", async () => {
    const g = await game({ review: "human" });
    await g.control({ type: "step", ms: DAY });
    // Approve one item, let everything else miss the 12 h SLA.
    const first = g.state().opportunities.find(o => o.state === "IN_REVIEW" && o.origin === "engine")!;
    expect((await g.control({ type: "review", oppId: first.id, decision: "approve", secondsSpent: 60 }, "rev")).ok).toBe(true);
    await g.control({ type: "step", ms: 14 * HOUR });
    let s = g.state();
    const alerts = s.stats.alerts!;
    expect(alerts.find(a => a.key === "review_sla_missed")).toMatchObject({ level: "bad" });
    expect(alerts.map(a => a.level)).toEqual([...alerts.map(a => a.level)].sort((x, y) => ["bad", "warn", "info"].indexOf(x) - ["bad", "warn", "info"].indexOf(y)));
    await g.control({ type: "review_mode", mode: "auto" });
    await g.control({ type: "step", ms: 4 * DAY });
    s = g.state();

    // A member who was probed: their timeline has the probe event and the probe message, in order.
    const probed = first.participants[0]!;
    const tl = (await g.timeline(probed))!;
    expect(tl.entries.length).toBeGreaterThan(3);
    expect(tl.entries.every((e, i) => i === 0 || e.t >= tl.entries[i - 1]!.t)).toBe(true);
    const types = tl.entries.map(e => (e.kind === "event" ? e.event.type : `msg:${e.message.type ?? ""}`));
    expect(types).toEqual(expect.arrayContaining(["member_joined", "review_queued", "review_decision", "probe_sent"]));
    // Every agent text the consent Network sent passed the leak check (or went out as the generic version).
    const out = tl.entries.filter(e => e.kind === "message" && e.message.direction === "outbound" && !e.message.system);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(e => e.kind === "message" && (e.message.guard === "passed" || e.message.guard === "fallback"))).toBe(true);
    // Another member's own answers are not on this member's timeline.
    for (const e of tl.entries) if (e.kind === "event" && e.event.memberId) expect(e.event.memberId).toBe(probed);

    // Requests: labels from the catalogue, never the member's words.
    const inbound = g.world.channel.all().filter(m => m.direction === "inbound").map(m => m.body);
    expect(s.requests!.length).toBe(g.consent!.requests.length);
    if (s.requests!.length) {
      expect(s.requests!.every(r => r.label && r.ageHours >= 0 && ["probing", "fulfilled", "none", "answered", "open"].includes(r.outcome))).toBe(true);
      const json = JSON.stringify(s.requests);
      for (const b of inbound) if (b.length > 25) expect(json.includes(b)).toBe(false);
    }

    // Scorecard: every PRD 28.2 line, the safety counts at 0, review minutes from recorded time.
    const card = Object.fromEntries(s.stats.scorecard!.map(m => [m.key, m]));
    expect(Object.keys(card).sort()).toEqual(["attention_burden", "completion", "first_value_14d", "invite_rate", "leaks", "minors_contacted", "opt_in", "opt_outs", "repeat_edges", "reviewer_minutes", "worthwhile_interruption"]);
    expect(card.minors_contacted).toMatchObject({ value: 0, met: true });
    expect(card.leaks).toMatchObject({ value: 0, met: true });
    expect(card.opt_in!.value).toBeCloseTo(s.stats.accepts / s.stats.invites, 3);
    expect(card.worthwhile_interruption!.n).toBeGreaterThan(0);
    expect(card.reviewer_minutes!.value).toBeCloseTo(1, 3); // 60 s over the one approved item that started
    const gr = s.stats.growth!;
    expect(gr.seed.members + gr.invitees.members).toBe(s.members.filter(m => !m.declined).length);
    expect(gr.seed.joined).toBe(s.stats.joined - gr.invitees.joined);

    // Search: agent texts and events, never what members wrote.
    const said = g.world.channel.all().find(m => m.direction === "outbound" && !m.system && /\b[A-Za-z]{7,}\b/.test(m.body))!;
    const word = said.body.match(/\b[A-Za-z]{7,}\b/)![0];
    const hits = await g.search(word);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.memberId && h.memberName)).toBe(true);
    const yes = g.world.channel.all().find(m => m.direction === "inbound" && /^[a-z]{4,}/i.test(m.body) && m.body.length > 12)!;
    for (const h of await g.search(yes.body.slice(0, 12))) expect(h.snippet.includes(yes.body)).toBe(false);
    expect((await g.search("probe sent")).some(h => h.kind === "event")).toBe(true);
  }, T);

  test("safety console: cases from the Network, lift and close actions, the minor-safety view", async () => {
    const g = await game({ scenario: "spam_wave" });
    await g.control({ type: "step", ms: 4 * DAY });
    let sf = await g.safety();
    expect(sf.canAct).toBe(true);
    expect(sf.cases.length).toBeGreaterThan(0);
    expect(sf.cases.every(c => c.memberName && c.events.length > 0 && c.dueAt > c.opened)).toBe(true);
    expect(JSON.stringify(sf.cases)).not.toMatch(/"(text|body)"/);
    expect(sf.minors.inOpportunities).toEqual([]);
    const held = sf.cases.find(c => c.level === "hold");
    if (held) {
      expect(held.urgent).toBe(true);
      expect(await g.safetyAction({ action: "lift", memberId: held.memberId, note: "checked with the member" }, "safety@example.org")).toEqual({ ok: true });
      sf = await g.safety();
      expect(sf.cases.find(c => c.id === held.id)!.status).toBe("lifted");
      expect(sf.hold).not.toContain(held.memberId);
    }
    const open = sf.cases.find(c => c.status !== "closed")!;
    expect(await g.safetyAction({ action: "close", caseId: open.id, note: "no further action" }, "safety@example.org")).toEqual({ ok: true });
    expect(await g.safetyAction({ action: "close", caseId: open.id }, "safety@example.org")).toMatchObject({ ok: false, code: "already_closed" });
    expect(await g.safetyAction({ action: "lift", memberId: "nobody" }, "safety@example.org")).toMatchObject({ ok: false, code: "not_on_hold" });
    sf = await g.safety();
    expect(sf.cases.find(c => c.id === open.id)).toMatchObject({ status: "closed", closedBy: "safety@example.org" });
    // The staff action is on the member's timeline.
    const tl = (await g.timeline(open.memberId))!;
    expect(tl.entries.some(e => e.kind === "event" && e.event.type === "safety_action" && e.event.detail?.action === "close_case")).toBe(true);
  }, T);

  test("a review sent while a step runs waits for it: it lands after the step, and an item that expired in the step says so", async () => {
    const g = await game({ review: "human" });
    await g.control({ type: "step", ms: DAY });
    const now = () => g.state().clock.now;
    const q = g.state().opportunities.filter(o => o.state === "IN_REVIEW" && o.review).sort((a, b) => a.review!.deadline - b.review!.deadline);
    expect(q.length).toBeGreaterThan(2);
    const [y, x] = [q[0]!, q.at(-1)!];
    const gap = y.review!.deadline - now();
    expect(gap).toBeGreaterThan(20 * MINUTE);
    // 1. A step that stays before every deadline: the decision is applied when the step ends, not in the middle of a tick.
    const short = Math.min(HOUR, gap - 10 * MINUTE);
    const step1 = g.control({ type: "step", ms: short });
    const r1 = await g.control({ type: "review", oppId: x.id, decision: "reject", reason: "tone" }, "rev@example.org");
    expect((await step1).ok).toBe(true);
    expect(r1).toEqual({ ok: true, data: { decision: "reject" } });
    const ex = g.state().opportunities.find(o => o.id === x.id)!;
    expect(ex.review).toMatchObject({ decision: "reject", decidedAt: now() });
    // 2. A step past an item's deadline: the item expires in the step. The answer says so, and the state agrees.
    const step2 = g.control({ type: "step", ms: y.review!.deadline - now() + 2 * HOUR });
    const r2 = await g.control({ type: "review", oppId: y.id, decision: "approve" }, "rev@example.org");
    expect((await step2).ok).toBe(true);
    expect(r2).toMatchObject({ ok: false, code: "not_in_review" });
    expect(r2.error).toContain("expired");
    expect(g.state().opportunities.find(o => o.id === y.id)).toMatchObject({ state: "SKIPPED", review: { decision: "expired" } });
  }, T);

  test("time options, picks, the booked plan with its opt-out, cancellations, opt-ins, deferrals and gate reasons (time-aware world)", async () => {
    const g = await game({ timeAware: true });
    expect(g.state().env.label).toContain("time-aware");
    await g.control({ type: "step", ms: 6 * DAY });
    const s = g.state();
    // Probes offer times; the projector keeps the labels and the keys each member picked.
    const timed = s.opportunities.filter(o => o.times && Object.values(o.times).some(t => t.offered.length && t.picked));
    expect(timed.length).toBeGreaterThan(0);
    for (const o of timed) for (const t of Object.values(o.times!)) {
      expect(t.offered.every(c => /^[abc]$/.test(c.key) && c.label.length > 3 && c.start > 0)).toBe(true);
      for (const k of t.picked ?? []) expect(t.offered.some(c => c.key === k)).toBe(true);
    }
    // The booked plan reached each member who said yes, at the meeting time, with a 48 h opt-out.
    const booked = s.opportunities.filter(o => o.booked);
    expect(booked.length).toBeGreaterThan(0);
    for (const o of booked) {
      expect(o.booked!.at).toBe(o.meetingAt!);
      expect(o.booked!.optOutHours).toBe(48);
      expect(Object.keys(o.booked!.told).every(id => o.participants.includes(id))).toBe(true);
    }
    // Cancellations: on the plan, on the canceller's timeline, never with a reason.
    const cancelled = booked.filter(o => Object.keys(o.booked!.cancelled).length);
    expect(cancelled.length).toBeGreaterThan(0);
    const c = cancelled[0]!, who = Object.keys(c.booked!.cancelled)[0]!;
    const tl = (await g.timeline(who))!;
    const ev = (type: string) => tl.entries.filter(e => e.kind === "event" && e.event.type === type).map(e => (e.kind === "event" ? e.event : undefined)!);
    expect(ev("booked_cancelled").some(e => e.opportunityId === c.id && /called off the booked plan/.test(e.text))).toBe(true);
    // The member's own timeline: the booked-plan message with its time, and the probe with the times it offered.
    const msgs = tl.entries.flatMap(e => (e.kind === "message" ? [e.message] : []));
    expect(msgs.some(m => m.booked?.at === c.booked!.at && m.proposalId === c.id)).toBe(true);
    expect(msgs.some(m => m.timeOptions?.length)).toBe(true);
    // Deferrals and gate reasons are logged as events and described for staff (send window, reason, the members).
    const rows = g.world.records.map(r => eventOf(r)).filter((r): r is NonNullable<typeof r> => !!r);
    const deferred = rows.filter(r => r.type === "send_deferred");
    expect(deferred.length).toBeGreaterThan(0);
    expect(describeEvent(deferred[0]!).text).toMatch(/waits for (their send window|quiet hours to end) \(until .+ New York\)/);
    const gated = rows.find(r => r.type === "gate_reason")!;
    expect(gated).toBeDefined();
    const member = (gated.payload.members as string[])[0]!;
    const gtl = (await g.timeline(member))!;
    expect(gtl.entries.some(e => e.kind === "event" && e.event.type === "gate_reason" && e.event.text.startsWith("Engine proposal for "))).toBe(true);
    // The calendar and weekly check-in offer rides once in a first booked plan.
    expect(rows.some(r => r.type === "availability_offer")).toBe(true);
    // Opportunity history includes the probes (linked by their key).
    const hist = (await g.opportunity(timed[0]!.id))!;
    expect(hist.messages.some(m => m.type === "probe" && m.timeOptions?.length)).toBe(true);
  }, T);

  test("run diff: two engine runs side by side", async () => {
    const g = await game();
    await g.control({ type: "step", ms: 3 * DAY });
    const runs = g.state().engineRuns;
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const [a, b] = [runs[0]!, runs[runs.length - 1]!];
    const d = runDiff(a, b);
    expect(d.a.id).toBe(a.id);
    expect(d.funnel.generated).toEqual({ a: a.funnel.generated, b: b.funnel.generated, delta: b.funnel.generated - a.funnel.generated });
    expect(d.fairness.gini!.delta).toBeCloseTo(b.fairness.gini - a.fairness.gini, 6);
    expect(d.fairness.lorenz).toBeUndefined();
    expect(d.top.added.length + d.top.kept).toBe(b.top.length);
    expect(d.top.removed.length + d.top.kept).toBe(a.top.length);
    const same = runDiff(a, a);
    expect([same.top.added, same.top.removed, same.top.kept]).toEqual([[], [], a.top.length]);
  }, T);
});
