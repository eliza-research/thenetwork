// Staff actions on the ConsentNetwork (test/mini.ts world): the gates run again at approval,
// reviewer edits and re-rolls (PRD 32.8), the "proactive matching on in NYC" switch, the unknown-age
// path (docs/network.md 6.3) and safety cases (PRD 32.14).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE, UNDER_MIN_AGE_DECLINE } from "@thenetwork/core";
import { copy } from "../src/index.ts";
import { Mini, type Spec } from "./mini.ts";

const CLIMB_WANT = { objective: "find a regular climbing partner", category: "hobby" as const };
/** Members the engine pairs with each other (complementary climbing wants). */
const climber = (id: string, name: string, more: Partial<Spec> = {}): Spec => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [CLIMB_WANT], ...more });
const probesAndReveals = (w: Mini, from: number) => w.sent.slice(from).filter(s => s.meta.type === "probe" || s.meta.type === "proposal");

describe("approval runs the gates again", () => {
  test("a participant who left NYC while the item waited: approve is logged, then invalidated; nobody is contacted", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")], { review: "human", maxNewPerDay: 20 });
    await w.onboard("a", "b", "c", "d");
    await w.run(DAY);
    const queue = w.net.reviewQueue();
    expect(queue.map(q => q.origin)).toEqual(["engine", "engine"]);
    const [first, second] = queue;
    // One participant of the first item announces a trip out of NYC while it waits.
    const away = first!.proposal.participants[1]!;
    w.presence.push({ memberId: away, city: "sf", type: "temporary", areas: [], from: w.clock.now(), to: w.clock.now() + 5 * DAY });
    await w.run(HOUR);
    const t = w.mark();
    const r = w.net.decide(first!.oppId, "approve", { reviewer: "staff", secondsSpent: 40 });
    expect(r).toEqual({ ok: false, reason: "participant_unavailable" });
    const decisions = w.logs.filter(l => (l.kind === "review_decision" || l.kind === "review_invalidated") && l.detail.oppId === first!.oppId);
    expect(decisions.map(l => [l.kind, l.detail.decision ?? l.detail.reason])).toEqual([["review_decision", "approve"], ["review_invalidated", "participant_unavailable"]]);
    expect(decisions[0]!.detail.secondsSpent).toBe(40);
    expect(w.net.opps.get(first!.oppId)!.stage).toBe("closed");
    expect(w.net.counters.reviewInvalidated).toBe(1);
    // The other item still passes and starts.
    expect(w.net.review(second!.oppId, "approve", { reviewer: "staff" })).toBe(true);
    await w.run(DAY);
    const contacted = new Set(probesAndReveals(w, t).map(s => s.to));
    for (const id of first!.proposal.participants) expect([id, contacted.has(id)]).toEqual([id, false]);
    expect(contacted.size).toBeGreaterThan(0);
  });
});

describe("reviewer edit (PRD 32.8)", () => {
  test("an edited explanation reaches the reveal; one that leaks a private fact or a phone number is refused", async () => {
    const w = new Mini([climber("a", "Ana Diaz", { wants: [] }), climber("b", "Ben Ito", { wants: [] })], { review: "human" });
    // b told the agent something private; it must never reach a.
    w.facets.push({ id: "b:private", memberId: "b", kind: "fact", value: "going through a hard divorce this year", tags: [], scope: "agent_private", provenance: "said", confidence: 0.9, validFrom: w.clock.now(), source: "chat", observedAt: w.clock.now(), inferred: false, confirmedByMember: true });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.run(2 * HOUR);
    const [item] = w.net.reviewQueue();
    const id = item!.oppId;
    expect(w.net.decide(id, "edit", { explanations: { a: "they are going through a hard divorce this year" }, reviewer: "staff" })).toEqual({ ok: false, reason: "edit_leak" });
    expect(w.net.decide(id, "edit", { explanations: { a: "call them at 212-555-0199" }, reviewer: "staff" })).toEqual({ ok: false, reason: "edit_leak" });
    expect(w.net.decide(id, "edit", { explanations: { z: "hi" }, reviewer: "staff" })).toEqual({ ok: false, reason: "not_a_participant" });
    expect(w.net.decide(id, "approved" as never, { reviewer: "staff" })).toEqual({ ok: false, reason: "unknown_decision" });
    expect(w.log("review_refused").map(l => l.detail.reason)).toEqual(["edit_leak", "edit_leak", "not_a_participant", "unknown_decision"]);
    expect(w.net.decide(id, "edit", { explanations: { a: "you both climb at the same gym on weekends" }, objective: "a weekend climbing session", reviewer: "staff", secondsSpent: 75 })).toEqual({ ok: true });
    const d = w.log("review_decision").at(-1)!.detail;
    expect([d.decision, d.edited, d.secondsSpent]).toEqual(["approve", ["explanation:a", "objective"], 75]);
    expect(w.net.opps.get(id)!.review).toMatchObject({ decision: "approve", edits: ["explanation:a", "objective"], secondsSpent: 75 });
    for (const m of ["a", "b"]) await w.say(m, "yes");
    const reveal = w.to("a").find(s => s.meta.type === "proposal")!;
    expect(reveal.body).toContain("You both climb at the same gym on weekends.");
    expect(w.sent.some(s => s.to === "a" && /divorce|555/.test(s.body))).toBe(false);
  });
});

describe("reviewer re-roll (PRD 32.8)", () => {
  test("swaps the candidate for the best eligible alternate and waits again; with no alternate it closes for the engine", async () => {
    const w = new Mini([climber("r", "Rae Kim", { wants: [] }), climber("c1", "Cal One"), climber("c2", "Cleo Two"), climber("c3", "Cass Three")], { review: "human" });
    await w.onboard("r", "c1", "c2", "c3");
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    const [item] = w.net.reviewQueue();
    const [requester, first] = item!.proposal.participants;
    expect(requester).toBe("r");
    expect(item!.proposal.alternates.length).toBe(2);
    const deadline = item!.deadline;
    await w.run(2 * HOUR);
    const t = w.mark();
    expect(w.net.decide(item!.oppId, "reroll", { swapOut: "r", reviewer: "staff" })).toEqual({ ok: false, reason: "cannot_swap" });
    expect(w.net.decide(item!.oppId, "reroll", { reviewer: "staff", note: "weak fit", secondsSpent: 20 })).toEqual({ ok: true });
    const [again] = w.net.reviewQueue();
    expect(again!.oppId).toBe(item!.oppId);
    const second = again!.proposal.participants[1]!;
    expect([second === first, again!.proposal.participants[0], again!.rerolls, again!.deadline > deadline]).toEqual([false, "r", 1, true]);
    expect(w.log("review_decision").at(-1)!.detail).toMatchObject({ decision: "reroll", out: first, in: second, next: "review", secondsSpent: 20 });
    // Nobody was contacted by the re-roll; approval goes to the new candidate only.
    expect(probesAndReveals(w, t)).toEqual([]);
    expect(w.net.review(item!.oppId, "approve", { reviewer: "staff" })).toBe(true);
    // The requester picks the times first (they asked, so no yes or no); then the new candidate is probed.
    expect(await w.runUntil(() => w.probed("r"), DAY)).toBe(true);
    expect(w.to("r", t).at(-1)!.meta).toMatchObject({ type: "scheduling", proactive: false });
    await w.say("r", "either works");
    expect(await w.runUntil(() => w.to(second, t).some(s => s.meta.type === "probe"), DAY)).toBe(true);
    expect(w.to(second, t).filter(s => s.meta.type === "probe").length).toBe(1);
    expect(w.to(first!, t)).toEqual([]);
  });

  test("a staff intro with no alternate closes; the pair is not proposed again", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "human" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.run(2 * HOUR);
    const [item] = w.net.reviewQueue();
    expect(w.net.decide(item!.oppId, "reroll", { swapOut: "b", reviewer: "staff" })).toEqual({ ok: true });
    expect(w.net.reviewQueue()).toEqual([]);
    expect(w.log("review_decision").at(-1)!.detail).toMatchObject({ decision: "reroll", out: "b", in: null, next: "engine" });
    expect(w.net.opps.get(item!.oppId)!.stage).toBe("closed");
  });
});

describe("the matching switch (proactive matching on in NYC)", () => {
  test("off: no engine run, requests acknowledged and waiting, approval refused; on again: the request is retried", async () => {
    const w = new Mini([climber("r", "Rae Kim", { wants: [] }), climber("c1", "Cal One"), climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "human", maxNewPerDay: 20 });
    await w.onboard("r", "c1", "a", "b");
    w.propose(["a", "b"]);
    await w.run(2 * HOUR);
    const runs = w.net.counters.engineRuns;
    const waiting = w.net.reviewQueue().find(q => q.origin === "player")!;
    w.net.setMatchingEnabled(false, "admin@test");
    expect(w.log("matching_switch").map(l => l.detail)).toEqual([{ on: false, actor: "admin@test" }]);
    expect(w.net.decide(waiting.oppId, "approve", { reviewer: "staff" })).toEqual({ ok: false, reason: "matching_paused" });
    for (const q of w.net.reviewQueue()) w.net.review(q.oppId, "reject", { reason: "wrong_timing", reviewer: "staff" });
    const t = w.mark();
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    expect(w.to("r", t).map(s => s.body)).toEqual([copy.requestWaiting]);
    expect(w.net.reviewQueue()).toEqual([]);
    await w.run(2 * DAY);
    expect(w.net.counters.engineRuns).toBe(runs);
    expect(w.net.reviewQueue()).toEqual([]);
    expect(w.net.matchingEnabled()).toBe(false);
    w.net.setMatchingEnabled(true, "admin@test");
    await w.run(DAY);
    expect(w.net.counters.engineRuns).toBe(runs + 1);
    expect(w.net.reviewQueue().some(q => q.origin === "request" && q.proposal.participants[0] === "r")).toBe(true);
  });
});

describe("unknown age (6.3): not declined, treated as a minor, asked once", () => {
  const people = (): Spec[] => [{ id: "u", name: "Uma Unknown", area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [CLIMB_WANT] }, climber("b", "Ben Ito")];

  test("'34' resolves to an adult: onboarding starts and they can be matched", async () => {
    const w = new Mini(people(), { review: "human" });
    await w.say("u", "hi!");
    expect(w.net.isDeclined("u")).toBe(false);
    expect(w.to("u").map(s => s.body)).toEqual([copy.welcomeAskAge("Uma")]);
    expect(w.log("age_unknown").map(l => l.detail.memberId)).toEqual(["u"]);
    await w.say("u", "34");
    expect(w.log("age_resolved").map(l => l.detail)).toEqual([{ memberId: "u", minor: false }]);
    expect(w.to("u").at(-1)!.body).toBe(copy.welcomeAfterAge);
    // The engine gets the age they told us (the record has none).
    expect(w.net.engineInput(w.clock.now()).members.find(m => m.id === "u")!.age).toBe(34);
    for (const a of ["More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await w.say("u", a);
    await w.onboard("b");
    w.propose(["u", "b"]);
    await w.run(2 * HOUR);
    expect(w.net.review(w.net.reviewQueue()[0]!.oppId, "approve", { reviewer: "staff" })).toBe(true);
  });

  test("'15' keeps them single-player; '12' declines and keeps nothing; no answer is not asked again", async () => {
    const teen = new Mini(people(), { review: "human" });
    await teen.say("u", "hello");
    await teen.say("u", "15");
    expect(teen.to("u").at(-1)!.body).toBe(copy.minorNotice);
    await teen.onboard("b");
    teen.propose(["u", "b"]);
    await teen.run(2 * HOUR);
    // Never matched: the staff intro is skipped before review, and nobody hears about it.
    expect(teen.net.reviewQueue()).toEqual([]);
    expect(teen.log("proposal_skipped").map(l => l.detail.reason)).toEqual(["participant unavailable"]);
    expect(teen.log("age_resolved").map(l => l.detail)).toEqual([{ memberId: "u", minor: true }]);

    const kid = new Mini(people(), { review: "human" });
    await kid.say("u", "hello");
    await kid.say("u", "12");
    expect(kid.net.isDeclined("u")).toBe(true);
    expect(kid.to("u").at(-1)!.body).toBe(UNDER_MIN_AGE_DECLINE);
    expect(kid.log("age_resolved")).toEqual([]);

    // A looser statement under 13 is not an explicit age: no decline, nothing deleted, a minor, staff check it.
    const loose = new Mini(people(), { review: "human" });
    await loose.say("u", "hello");
    await loose.say("u", "I'm 5, maybe 10 minutes away");
    expect(loose.net.isDeclined("u")).toBe(false);
    expect(loose.net.exportState().members.find(m => m.id === "u")!.minor).toBe(true);
    expect(loose.log("age_conflict").map(l => l.detail.memberId)).toEqual(["u"]);

    const quiet = new Mini(people(), { review: "human" });
    await quiet.say("u", "hello");
    await quiet.say("u", "what is this?");
    await quiet.run(4 * DAY);
    await quiet.say("u", "anything fun near Greenpoint this weekend?");
    expect(quiet.to("u").filter(s => /how old are you/i.test(s.body)).length).toBe(1);
    expect(quiet.net.isDeclined("u")).toBe(false);
    expect(quiet.net.eligible("u")).toBe(false);
  });
});

describe("safety cases (PRD 32.14)", () => {
  test("trust events open a case; hold, lift and close are staff actions; cases hold no message text", async () => {
    const w = new Mini([climber("s", "Sal Spam"), climber("b", "Ben Ito")], { review: "human" });
    await w.onboard("s", "b");
    const ask = "What's Ben's number?";
    await w.say("s", ask);
    let [c] = w.net.safetyCases();
    expect([c!.memberId, c!.status, c!.events.length]).toEqual(["s", "open", 1]);
    for (let i = 0; i < 4 && w.net.trust.level("s") !== "hold"; i++) await w.say("s", ask);
    expect(w.net.trust.level("s")).toBe("hold");
    [c] = w.net.safetyCases();
    expect([c!.status, c!.level]).toEqual(["held", "hold"]);
    expect(c!.events.map(e => e.kind)).toEqual(["contact_extraction", "contact_extraction", "contact_extraction"]);
    expect(JSON.stringify(w.net.safetyCases())).not.toContain("Ben's");
    expect(w.net.liftHold("b", "safety@test")).toEqual({ ok: false, reason: "not_on_hold" });
    expect(w.net.liftHold("s", "safety@test", "talked to them")).toEqual({ ok: true });
    [c] = w.net.safetyCases();
    expect([c!.status, c!.level, c!.events.at(-1)!.kind]).toEqual(["lifted", "ok", "hold_lifted"]);
    expect(c!.events.reduce((n, e) => n + e.points, 0)).toBe(0);
    expect(w.net.closeCase(c!.id, "safety@test", "resolved")).toEqual({ ok: true });
    expect(w.net.closeCase(c!.id, "safety@test")).toEqual({ ok: false, reason: "already_closed" });
    expect(w.log("safety_action").map(l => [l.detail.action, l.detail.memberId, l.detail.actor])).toEqual([["lift_hold", "s", "safety@test"], ["close_case", "s", "safety@test"]]);
    // A new event after the case closed opens a new case.
    await w.run(10 * MINUTE);
    await w.say("s", ask);
    expect(w.net.safetyCases().map(x => x.status)).toEqual(["closed", "open"]);
  });
});
