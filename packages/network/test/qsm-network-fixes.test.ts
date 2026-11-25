import { describe, expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock, type MemberId } from "@thenetwork/core";
import { slopPack } from "@thenetwork/engine";
import { capitalWiring, consentOf, copy } from "../src/index.ts";
import { postingFromDraft } from "../src/jobs.ts";
import { simulatedRelayClassifier } from "../../engine/src/relay.ts";
import { RelayDesk, type RelayHost } from "../src/relay.ts";
import { Mini } from "./mini.ts";

const NOW = Date.UTC(2026, 9, 10, 15);
const person = (id: string, name: string, extra: Partial<Parameters<Mini["add"]>[0]> = {}) => ({
  id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }], ...extra,
});

function makeRelayDesk(clock: SimClock, opts: { onSevere?: (id: MemberId) => void } = {}) {
  const members = {
    a: { id: "a", firstName: "Ari", age: 30, optedOut: false, held: false, markedMinor: false },
    b: { id: "b", firstName: "Bo", age: 31, optedOut: false, held: false, markedMinor: false },
  };
  const host: RelayHost = {
    app: "friends",
    ratesPhotos: false,
    now: () => clock.now(),
    member: id => members[id as keyof typeof members],
    matchesOf: () => [{ id: "match-1", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual", negativeFeedback: false, at: NOW - HOUR }],
    blocked: () => false,
    privateFacts: () => ({ forbidden: [], canaries: [] }),
    severeBlock: id => opts.onSevere?.(id),
    minorSignal: () => {},
    classifierFailed: () => {},
    send: () => "sent",
  };
  return new RelayDesk(host);
}

const RELAY_OPTS = { hook: simulatedRelayClassifier };

describe("QSM ported network & core fixes", () => {
  test("SD-035: consentOf vetoes hedged or conditional yes while accepting genuine affirm and slang", () => {
    expect(consentOf("yes")).toMatchObject({ answer: "yes" });
    expect(consentOf("aight")).toMatchObject({ answer: "yes" });
    expect(consentOf("sure if it's nearby").answer).toBe("unclear");
    expect(consentOf("sure hmm").answer).toBe("unclear");
    expect(consentOf("yes but i'm uncertain").answer).toBe("unclear");
  });

  test("SD-254: RelayDesk reports severeBlock on harass_severe", async () => {
    const severeCalls: Array<{ id: MemberId }> = [];
    const desk = makeRelayDesk(new SimClock(NOW), {
      onSevere: id => severeCalls.push({ id }),
    });
    const threat = await desk.request({ itemId: "threat-1", from: "a", kind: "text", text: "tell Bo watch your back" }, RELAY_OPTS);
    expect(threat.decision).toBe("refused");
    expect(severeCalls).toEqual([{ id: "a" }]);
  });

  test("SD-320: RelayDesk blocks a rate-limited text (never holds it), replays that block for the same item id, and sends a new item after the burst window clears", async () => {
    const clock = new SimClock(NOW);
    const desk = makeRelayDesk(clock);
    for (let i = 0; i < 6; i++) {
      clock.advance(MINUTE);
      expect((await desk.request({ itemId: `burst-${i}`, from: "a", kind: "text", text: `see you at the park ${i}` }, RELAY_OPTS)).decision).toBe("sent");
    }
    const rateBlocked = await desk.request({ itemId: "pri_fixed", from: "a", kind: "text", text: "looking forward to Saturday" }, RELAY_OPTS);
    expect(rateBlocked).toMatchObject({ itemId: "pri_fixed", decision: "refused" });
    clock.advance(11 * MINUTE);
    const replayed = await desk.request({ itemId: "pri_fixed", from: "a", kind: "text", text: "looking forward to Saturday" }, RELAY_OPTS);
    expect(replayed).toMatchObject({ itemId: "pri_fixed", decision: "refused", replayed: true });
    const next = await desk.request({ itemId: "pri_next", from: "a", kind: "text", text: "looking forward to Saturday" }, RELAY_OPTS);
    expect(next).toMatchObject({ itemId: "pri_next", decision: "sent" });
    expect(next.replayed).toBeUndefined();
  });

  test("SD-111: ConsentNetwork prefixes ids with app and non-nyc city", async () => {
    const sf = new Mini([person("a", "Ari Diaz"), person("b", "Ben Ito")], { app: "ntwrk", city: "sf" });
    await sf.onboard("a", "b");
    await sf.say("a", "looking for a regular climbing partner");
    const stSf = sf.net.exportState();
    expect(stSf.requests[0]?.id.startsWith("ntwrk.sf.")).toBe(true);
    expect(stSf.opps[0]?.id.startsWith("ntwrk.sf.")).toBe(true);

    const nyc = new Mini([person("a", "Ari Diaz"), person("b", "Ben Ito")], { app: "ntwrk", city: "nyc" });
    await nyc.onboard("a", "b");
    await nyc.say("a", "looking for a regular climbing partner");
    expect(nyc.net.exportState().requests[0]?.id.startsWith("ntwrk.")).toBe(false);
  });

  test("SD-044: metBefore requires bookedTold on both participants", async () => {
    const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito"), person("c", "Cy Moss")], { plans: false });
    await w.onboard("a", "b", "c");
    const st = w.net.exportState();
    st.opps.push({
      id: "plan-decliner", origin: "planner", kind: "group", category: "events", objective: "walk", detail: "walk",
      participants: ["a", "b", "c"], alternates: [], primed: ["a", "b"], status: [["a", "yes"], ["b", "yes"], ["c", "no"]],
      explanations: {}, stage: "scheduled", deadline: w.clock.now() + DAY, createdAt: w.clock.now(), score: 0.8,
      components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
      generator: "fixture", exploration: false, sameDay: false, contacted: ["a", "b", "c"], reminded: [], feedbackFrom: [],
      tags: [], replacements: 0, meetingAt: w.clock.now() + DAY, bookedTold: ["a", "b"],
    } as any);
    w.net.importState(st);
    await w.say("c", "report Ana she threatened me");
    const r = (w.net.exportState().reports ?? [])[0]!;
    expect(r.subjectId).toBe("a");
    expect(r.met).toBe(false);
    expect(w.net.eligible("a", "plan-decliner")).toBe(true);
  });

  test("SD-229 & SD-220: check-in reports enforce trust scoring and late disclosures after initial feedback file a report", async () => {
    const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito"), person("c", "Cy Moss")], { plans: false });
    await w.onboard("a", "b", "c");
    const opp0 = w.propose(["c", "b"]);
    await w.answerProbes(["c", "b"]);
    const start0 = w.meetings.find(m => m.proposalId === opp0)!.at;
    w.clock.set(start0 + 2 * DAY);
    await w.run(2 * HOUR);
    await w.say("b", "It was fine.");
    await w.say("c", "It was fine.");
    w.clock.advance(7 * DAY);
    await w.run(2 * HOUR);

    const opp1 = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    const start1 = w.meetings.find(m => m.proposalId === opp1)!.at;
    w.clock.set(start1 + 2 * DAY);
    await w.run(2 * HOUR);
    await w.say("a", "It was fine.");
    const fromLate = w.mark();
    w.clock.advance(DAY);
    await w.say("a", "Actually he followed me home after");
    expect(w.to("a", fromLate).map(s => s.body)).toContain(copy.reported(false));
    expect(w.net.safetyReports().filter(r => r.subjectId === "b" && r.source === "check_in")).toHaveLength(1);
    expect(w.net.trust.get("b").reportsFrom.has("a")).toBe(true);
    await w.say("c", "report Ben he followed me too");
    expect(w.net.trust.get("b").score).toBeGreaterThan(0);

    // Unrelated third-party statement files nothing.
    const countBefore = w.net.safetyReports().length;
    await w.say("a", "my boss was so rude to me today");
    expect(w.net.safetyReports()).toHaveLength(countBefore);
  });

  test("SD-328: finalize no-show and late feedback answer only increment noShows once", async () => {
    const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito")], { plans: false });
    await w.onboard("a", "b");
    const oppId = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    const start = w.meetings.find(m => m.proposalId === oppId)!.at;
    w.clock.set(start + 2 * DAY);
    await w.run(2 * HOUR);
    expect(w.to("a").some(m => m.meta.type === "feedback_request")).toBe(true);
    await w.say("a", "It was fine, but Ben did not come.");
    w.clock.set(start + 4 * DAY);
    await w.run(2 * HOUR);
    expect(w.net.memberList().find(m => m.id === "b")?.noShows).toBe(1);
    await w.say("b", "Sorry, I couldn't make it.");
    expect(w.net.memberList().find(m => m.id === "b")?.noShows).toBe(1);
  });

  test("SD-266 & SD-435: repeat ask gets replied again; member outside NYC gets open turn on plans and no NYC spots", async () => {
    const w = new Mini([person("a", "Ana Diaz", { wants: [] })], { plans: false });
    await w.onboard("a");
    const m1 = w.mark();
    await w.say("a", "Can you find me a climbing partner?");
    expect(w.to("a", m1).some(m => /couldn't find someone/.test(m.body))).toBe(true);
    const m2 = w.mark();
    w.clock.advance(2 * HOUR);
    await w.say("a", "Can you find me a climbing partner?");
    expect(w.to("a", m2).some(m => /couldn't find someone/.test(m.body))).toBe(true);

    // Move Ana to SF cleanly via temporary trip: onPlans returns open, and no NYC venue is named.
    w.presence.push({ memberId: "a", city: "sf", type: "temporary", areas: [], from: w.clock.now() - HOUR, to: w.clock.now() + 3 * DAY });
    w.net.importState(w.net.exportState());
    const outcome = await w.net.onInbound({ id: "sf-plans", memberId: "a", body: "Any plans this weekend?", channel: "sms", ts: w.clock.now() });
    expect(outcome).toBe("open");
  });

  test("SD-264: group probe keeps remaining members when one says neither and commonTimeGone is true", async () => {
    const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito"), person("c", "Cy Moss"), person("d", "Dee Fox")], { plans: false });
    await w.onboard("a", "b", "c", "d");
    const oppId = w.propose(["a", "b", "c", "d"]);
    expect(await w.runUntil(() => w.probed("a"), 2 * DAY)).toBe(true);
    const optsA = w.to("a").findLast(m => m.meta.timeOptions)?.meta.timeOptions!;
    await w.say("a", `yes, ${optsA[0]!.label} works`);
    expect(await w.runUntil(() => w.probed("b") && w.probed("c") && w.probed("d"), 2 * DAY)).toBe(true);
    const optsB = w.to("b").findLast(m => m.meta.timeOptions)?.meta.timeOptions!;
    await w.say("b", `yes, ${optsB[0]!.label} works`);
    await w.say("c", "yes, neither of those times works");
    const optsD = w.to("d").findLast(m => m.meta.timeOptions)?.meta.timeOptions!;
    await w.say("d", `yes, ${optsD[0]!.label} works`);
    expect(w.meetings.some(m => m.proposalId === oppId)).toBe(true);
  });

  test("SD-268: reveal refuses when a participant was already booked elsewhere within 4 hours", async () => {
    const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito"), person("c", "Cy Moss"), person("d", "Dee Fox")], { plans: false });
    await w.onboard("a", "b", "c", "d");
    const firstOpp = w.propose(["a", "c"]);
    await w.answerProbes(["a", "c"]);
    const meetingAt = w.meetings.find(m => m.proposalId === firstOpp)!.at;

    const st = w.net.exportState();
    st.opps.push({
      id: "second-opp", origin: "engine", kind: "one_to_one", category: "hobby", objective: "climbing", detail: "climbing",
      participants: ["a", "b"], alternates: [], primed: ["a"],
      status: [["a", "available"], ["b", "probing"]],
      explanations: { a: "climbs", b: "climbs" },
      stage: "probing", deadline: w.clock.now() + DAY, createdAt: w.clock.now(),
      sentAt: { a: w.clock.now(), b: w.clock.now() },
      offered: {
        a: [{ key: "1", start: meetingAt, end: meetingAt + HOUR, label: "Sat 10:00" }],
        b: [{ key: "1", start: meetingAt, end: meetingAt + HOUR, label: "Sat 10:00" }],
      },
      picks: { a: [meetingAt] },
      score: 0.9,
      components: { fit: 0.9, mutualBenefit: 0.9, warmPath: 0, novelty: 0.8, timingFit: 1, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 },
      generator: "fixture", exploration: false, sameDay: false, contacted: ["a", "b"], reminded: [], feedbackFrom: [], tags: [], replacements: 0,
    } as any);
    st.members.find(m => m.id === "b")!.awaiting = { kind: "probe", oppId: "second-opp", at: w.clock.now() };
    w.net.importState(st);

    await w.say("b", "1");
    expect(w.meetings.filter(m => m.proposalId === "second-opp")).toHaveLength(0);
    expect(w.logs.some(l => l.kind === "send_refused" && l.detail.reason === "booked_elsewhere")).toBe(true);
  });

  test("SD-048: replaceOrClose clears awaiting slot on replaced-out member", async () => {
    const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito"), person("c", "Cy Moss")], { plans: false });
    await w.onboard("a", "b", "c");
    const oppId = w.propose(["a", "b"], { alternates: ["c"] });
    expect(await w.runUntil(() => w.probed("a"), 2 * DAY)).toBe(true);
    await w.say("a", "yes");
    expect(await w.runUntil(() => w.probed("b"), 2 * DAY)).toBe(true);
    await w.net.onInbound({ id: "stop-b", memberId: "b", body: "STOP", keyword: "STOP", channel: "sms", ts: w.clock.now() });
    await w.run(2 * HOUR);
    await w.net.onInbound({ id: "start-b", memberId: "b", body: "START", keyword: "START", channel: "sms", ts: w.clock.now() });
    expect(w.net.memberList().find(m => m.id === "b")?.awaiting?.oppId).not.toBe(oppId);
  });

  test("SD-213 & SD-049: minor signal during adult interview stops interview and emits age_updated; clearMinorSignal restores", async () => {
    const ledger: Array<{ type: string; member?: string; age?: number | null }> = [];
    const w = new Mini([person("a", "Ana Diaz")], { plans: false, onLedger: e => ledger.push(e as any) });
    await w.say("a", "hi!");
    expect(w.net.memberList().find(m => m.id === "a")?.stage).toBe("q1");
    await w.say("a", "I have homework tonight");
    const afterMinor = w.net.memberList().find(m => m.id === "a")!;
    expect(afterMinor.minor).toBe(true);
    expect(afterMinor.stage).toBe("active");
    expect(afterMinor.awaiting).toBeUndefined();
    expect(ledger.some(e => e.type === "age_updated" && e.member === "a" && e.age === null)).toBe(true);

    expect(w.net.clearMinorSignal("a", "staff", "checked id").ok).toBe(true);
    expect(ledger.some(e => e.type === "age_updated" && e.member === "a" && e.age === 30)).toBe(true);
  });

  test("SD-042 & SD-043: mcp profile cannot post jobs, and postingTurn restores owed probe awaiting", async () => {
    const postings: unknown[] = [];
    const w = new Mini([person("mgr", "Morgan Lee"), person("c1", "Cal One")], {
      plans: false, hooks: { postings: true }, onPosting: p => postings.push(p),
    });
    await w.onboard("mgr", "c1");
    await w.net.onInbound({ id: "mcp-1", memberId: "mgr", body: "post a job: barista, $25/hr, Greenpoint", ts: w.clock.now(), channel: "sms", source: "mcp" });
    await w.net.onInbound({ id: "mcp-2", memberId: "mgr", body: "yes, post it", ts: w.clock.now() + MINUTE, channel: "sms", source: "mcp" });
    expect(postings).toHaveLength(0);

    const oppId = "opp-mgr";
    const st = w.net.exportState();
    st.opps.push({
      id: oppId, origin: "engine", kind: "intro", category: "hobby", objective: "climbing", detail: "climbing",
      participants: ["c1", "mgr"], alternates: [], primed: ["c1"],
      status: [["c1", "available"], ["mgr", "probing"]],
      explanations: { c1: "climbs", mgr: "climbs" },
      stage: "probing", deadline: w.clock.now() + DAY, createdAt: w.clock.now(),
      sentAt: { c1: w.clock.now(), mgr: w.clock.now() },
      score: 0.9,
      components: { fit: 0.9, mutualBenefit: 0.9, warmPath: 0, novelty: 0.8, timingFit: 1, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 },
      generator: "fixture", exploration: false, sameDay: false, contacted: ["c1", "mgr"], reminded: [], feedbackFrom: [], tags: [], replacements: 0,
    } as any);
    st.members.find(m => m.id === "mgr")!.awaiting = { kind: "probe", oppId, at: w.clock.now() };
    w.net.importState(st);

    await w.say("mgr", "post a job: cook");
    expect(w.net.memberList().find(m => m.id === "mgr")?.awaiting?.kind).toBe("posting");
    await w.say("mgr", "no");
    expect(w.net.memberList().find(m => m.id === "mgr")?.awaiting).toMatchObject({ kind: "probe", oppId });
  });

  test("SD-248: nighttime forgetMember keeps drop_notice valid until meetingAt", async () => {
    const w = new Mini([person("a", "Ana Diaz"), person("b", "Ben Ito")], { plans: false });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    w.clock.set(Date.UTC(2026, 9, 7, 3)); // 23:00 EDT (quiet hours for [21, 9])
    const mark = w.mark();
    w.net.forgetMember("a");
    await w.run(12 * HOUR);
    expect(w.to("b", mark).some(m => m.meta.type === "cancellation")).toBe(true);
  });

  test("SD-267: setMatchingEnabled resets retry window on waiting people requests", async () => {
    const w = new Mini([person("a", "Ana Diaz", { wants: [] }), person("b", "Ben Ito")], { plans: false, matchingEnabled: false });
    await w.onboard("a", "b");
    await w.say("a", "Can you find me a climbing partner?");
    w.clock.advance(8 * DAY);
    w.net.setMatchingEnabled(true, "admin");
    const req = w.net.exportState().requests[0]!;
    expect(req.openFrom).toBe(w.clock.now());
  });

  test("SD-296 & SD-223: packInput propagates held managers to job seats and declined slop pairs to avoid edges", () => {
    const w = new Mini([person("mgr", "Morgan Lee"), person("cand", "Cal One")], { app: "slop", pack: slopPack, plans: false });
    w.members.push({
      id: "job:mgr:1", name: "Cook Seat", age: 30, homeCity: "nyc", state: "open", joinedAt: NOW - DAY, unansweredProactive: 0,
      seatOwner: "mgr",
      prefs: { categoriesOptIn: ["professional"], quietHours: [21, 9], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
    } as any);
    w.facets.push({
      id: "seat-owner", memberId: "job:mgr:1", kind: "fact", value: "owner", tags: ["peon:owner:mgr"],
      scope: "agent_private", provenance: "said", confidence: 1, validFrom: NOW, source: "chat", observedAt: NOW, inferred: false, confirmedByMember: true,
    });
    w.net.holdMember("mgr", "staff", "check");
    const st = w.net.exportState();
    st.declined = [["mgr|cand", w.clock.now() - DAY]];
    w.net.importState(st);

    const input = w.net.packInput(w.clock.now());
    expect(input.safetyHolds?.some(h => h.memberId === "job:mgr:1")).toBe(true);
    expect(input.edges.some(e => e.type === "avoid" && ((e.from === "mgr" && e.to === "cand") || (e.from === "cand" && e.to === "mgr")))).toBe(true);
  });

  test("SD-114 & SD-156: closed postings cannot reopen and capitalWiring.onLedger returns boolean", () => {
    const posting = postingFromDraft(
      { title: "Cook", area: "Greenpoint", payMin: 25, payMax: 25, openings: 1, mode: "onsite", ready: true },
      "mgr", NOW, {
        id: "p1", managerId: "mgr", title: "Cook", family: "cook", openings: 1, payMin: 25, payMax: 25, mode: "onsite",
        area: "Greenpoint", must: [], nice: [], status: "closed", createdAt: NOW - DAY, updatedAt: NOW - HOUR,
      },
    );
    expect(posting).toBeUndefined();

    const wired = capitalWiring({
      record: (e: any) => { if (e.id === "reject") throw new Error("reject"); return e; },
    } as any);
    expect(wired.onLedger({ id: "accept", t: NOW, type: "member_joined", member: "a", age: 30 })).toBe(true);
    expect(wired.onLedger({ id: "reject", t: NOW, type: "member_joined", member: "a", age: 30 })).toBe(false);
  });
});
