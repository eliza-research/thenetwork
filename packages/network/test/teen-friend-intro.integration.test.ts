import { expect, test } from "vitest";
import { DAY, HOUR, type MemberId } from "@thenetwork/core";
import { friendsPack, plans } from "@thenetwork/engine";
import { CapitalLedger, ledgerReader } from "../src/capital.ts";
import { copy } from "../src/copy.ts";
import type { NetworkOptions } from "../src/index.ts";
import { planCatalogPlace } from "../src/network.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { describeBookingStart, localBookingStart } from "../src/rescheduling.ts";
import { Mini, START, type Spec } from "./mini.ts";
import { holdEveryItem, simulatedReviewJudge, type ReviewPacket } from "../../engine/src/reviewJudge.ts";

const climber = (id: string, name: string, age: number): Spec => ({
  id, name, age, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" }],
});

const CAST: Record<MemberId, [name: string, age: number, born?: number]> = {
  t16: ["Tess Ruiz", 16, 20100315], t17: ["Uma Park", 17, 20090601], a19: ["Vic Long", 19, 20070901], t18: ["Wes Hale", 18, 20080601],
  s18: ["Xan Moss", 18, 20071007], l18: ["Yara Bell", 18, 20071013], z17: ["Zoe Kim", 17, 20090901], v17: ["Val Ortiz", 17, 20090401],
  a30: ["Ada Stone", 30], a31: ["Bea Lowe", 31], a32: ["Cal Reyes", 32], f30: ["Fay Diaz", 30], i30: ["Ike Wolfe", 30], n31: ["Nia Cole", 31],
};

function setBirth(w: Mini, id: MemberId) {
  const born = CAST[id]![2];
  if (born !== undefined) Object.assign(w.members.find(m => m.id === id)!, { birthKey: born, birthExact: true, ageConflict: false, teenBarred: false });
}

function world(ids: MemberId[], opts: NetworkOptions = {}, spec = climber) {
  const w = new Mini(ids.map(id => spec(id, CAST[id]![0], CAST[id]![1])), { app: "friends", inlineJudge: holdEveryItem.inline, ...opts });
  for (const id of ids) setBirth(w, id);
  return w;
}

const friendSeeker = (id: string, name: string, age: number): Spec => ({
  id, name, age, area: "Greenpoint", interests: ["hiking", "board_games"], skills: ["cooking"],
  wants: [{ objective: "make a few new friends in the city", category: "social" }],
});

const itemOf = (s: Mini["sent"][number]) => s.meta.proposalId ?? s.meta.probe?.key;
const teenItems = (w: Mini, id: MemberId) => w.net.exportState().opps.filter(o => o.stage === "review" && o.participants.includes(id))
  .map(o => ({ oppId: o.id, revision: o.review?.rerolls?.length ?? 0, proposal: { participants: [...o.participants], alternates: [...o.alternates] } }));

test("teen introductions are on from the start on friends and ntwrk, one staff stop turns them off on restart too, and only a friends or ntwrk network resumes", async () => {
  const slop = new Mini([], { app: "slop" });
  expect(slop.net.teenIntrosEnabled()).toBe(false);
  expect(slop.net.resumeTeenIntros("admin-a")).toEqual({ ok: false, reason: "teen_intros_not_offered" });
  expect(new Mini([], { app: "ntwrk" }).net.teenIntrosEnabled()).toBe(true);

  const w = world(["t16", "t17"]);
  expect(w.net.teenIntrosEnabled()).toBe(true);
  expect(w.net.exportState().teenStop).toBeUndefined();
  expect(w.net.stopTeenIntros("  ")).toEqual({ ok: false, reason: "actor_required" });
  expect(w.net.stopTeenIntros("safety-s")).toEqual({ ok: true });
  expect(w.net.teenIntrosEnabled()).toBe(false);
  w.restart();
  expect(w.net.teenIntrosEnabled()).toBe(false);
  expect(w.net.teenIntrosStopped()?.by).toBe("safety-s");
  expect(w.net.resumeTeenIntros("admin-a")).toEqual({ ok: true });
  expect(w.net.teenIntrosEnabled()).toBe(true);
  w.restart();
  expect(w.net.teenIntrosEnabled()).toBe(true);
  expect(w.log("teen_intros_switch").map(l => [l.detail.on, l.detail.actor])).toEqual([[false, "safety-s"], [true, "admin-a"]]);

  const damaged = w.net.exportState();
  w.net.importState({ ...damaged, teenStop: null });
  expect(w.net.teenIntrosEnabled()).toBe(false);
});

test("after a stop and a restart a teen request reaches nobody", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  expect(w.net.stopTeenIntros("admin-a")).toEqual({ ok: true });
  w.restart();
  const from = w.mark();
  await w.say("t16", "Can you find me a regular climbing partner?");
  await w.run(24 * 3_600_000);
  expect(teenItems(w, "t16")).toEqual([]);
  expect(w.sent.slice(from).filter(s => itemOf(s) !== undefined)).toEqual([]);
});

test("a teen pair within 2 years reaches the judge with its ages and the strict rubric, and the judge approval contacts only the pair", async () => {
  const packets: ReviewPacket[] = [];
  const approve = simulatedReviewJudge({ exceptions: false });
  const w = world(["t16", "t17", "a19"], { inlineJudge: packet => { packets.push(packet); return approve(packet); } });
  await w.onboard("t16", "t17", "a19");
  await w.say("t16", "Can you find me a regular climbing partner?");
  const [item] = teenItems(w, "t16");
  expect(item).toBeDefined();
  expect(item!.proposal.participants.sort()).toEqual(["t16", "t17"]);
  expect(item!.proposal.alternates).not.toContain("a19");
  const from = w.mark();
  expect(w.net.decide(item!.oppId, "approve", { reviewer: "reviewer-r", revision: item!.revision })).toEqual({ ok: false, reason: "not_held_for_staff" });
  expect(w.sent.slice(from)).toEqual([]);
  await w.net.tick(w.clock.now());
  const packet = packets.find(p => p.oppId === item!.oppId);
  expect(packet?.rubric).toBe("minor");
  expect(packet?.ageFacts.codeChecks).toEqual(["teen_age_rule", "teen_place_all_ages", "teen_daytime_10_19", "no_adult_session_nearby"]);
  expect(packet?.roster.map(m => [m.firstName, m.teen?.age]).sort()).toEqual([["Tess", 16], ["Uma", 17]]);
  expect(w.net.exportState().opps.find(o => o.id === item!.oppId)?.review).toMatchObject({ decision: "approve", approver: "judge", reviewer: "sim_review_judge" });
  await w.run(24 * 3_600_000);
  expect(w.sent.slice(from).some(s => itemOf(s) === item!.oppId && (s.to === "t16" || s.to === "t17"))).toBe(true);
  expect(w.to("a19", from).filter(s => itemOf(s) === item!.oppId)).toEqual([]);
});

test("a teen item that the judge holds waits for a named staff member and is never approved by the judge name", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  await w.say("t16", "Can you find me a regular climbing partner?");
  const [item] = teenItems(w, "t16");
  expect(item).toBeDefined();
  await w.net.tick(w.clock.now());
  expect(w.net.reviewQueue().find(i => i.oppId === item!.oppId)?.exception?.rubric).toBe("minor");
  expect(w.net.decide(item!.oppId, "approve", { revision: item!.revision })).toEqual({ ok: false, reason: "reviewer_required" });
  expect(w.net.decide(item!.oppId, "approve", { reviewer: "sim_review_judge", revision: item!.revision })).toEqual({ ok: false, reason: "reviewer_reserved" });
  expect(w.net.reviewQueue().map(i => i.oppId)).toContain(item!.oppId);
});

test("a 16-year-old is never introduced to a 19-year-old", async () => {
  const w = world(["t16", "a19"]);
  await w.onboard("t16", "a19");
  const from = w.mark();
  await w.say("t16", "Can you find me a regular climbing partner?");
  await w.run(24 * 3_600_000);
  expect(teenItems(w, "t16")).toEqual([]);
  expect(teenItems(w, "a19")).toEqual([]);
  expect(w.to("a19", from).filter(s => itemOf(s) !== undefined)).toEqual([]);

  const control = world(["t16", "t17"]);
  await control.onboard("t16", "t17");
  await control.say("t16", "Can you find me a regular climbing partner?");
  await control.run(24 * 3_600_000);
  expect(teenItems(control, "t16").map(i => [...i.proposal.participants].sort())).toContainEqual(["t16", "t17"]);
});

test("a teen with a stored minor signal stays out of the pool until staff clear the teen doubt, and the clear refuses a barred teen", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  const st = w.net.exportState();
  for (const m of st.members) if (m.id === "t17") m.minorSignal = true;
  w.net.importState(st);
  await w.say("t16", "Can you find me a regular climbing partner?");
  expect(teenItems(w, "t16")).toEqual([]);
  expect(w.net.clearMinorSignal("t17", "", "checked the birth date")).toEqual({ ok: false, reason: "actor_required" });
  expect(w.net.clearMinorSignal("t17", "safety-s", "checked the birth date")).toEqual({ ok: true });
  expect(w.net.memberList().find(m => m.id === "t17")?.minor).toBe(true);
  await w.run(25 * HOUR);
  await w.say("t16", "Can you find me a regular climbing partner?");
  expect(teenItems(w, "t16").map(i => [...i.proposal.participants].sort())).toContainEqual(["t16", "t17"]);

  const barred = world(["t16", "t17"]);
  Object.assign(barred.members.find(m => m.id === "t17")!, { teenBarred: true });
  await barred.onboard("t16", "t17");
  const held = barred.net.exportState();
  for (const m of held.members) if (m.id === "t17") m.minorSignal = true;
  barred.net.importState(held);
  expect(barred.net.clearMinorSignal("t17", "safety-s", "checked the birth date")).toEqual({ ok: false, reason: "teen_barred" });
  expect(barred.net.clearMinorSignal("t16", "safety-s", "checked the birth date")).toEqual({ ok: false, reason: "no_signal" });
});

test("a staff stop closes an approved teen item with a notice that names nobody", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  await w.say("t16", "Can you find me a regular climbing partner?");
  const [item] = teenItems(w, "t16");
  await w.net.tick(w.clock.now());
  expect(w.net.decide(item!.oppId, "approve", { reviewer: "reviewer-r", revision: item!.revision })).toEqual({ ok: true });
  await w.run(3_600_000);
  const told = [...w.net.exportState().opps.find(o => o.id === item!.oppId)!.contacted].sort();
  expect(told.length).toBeGreaterThan(0);
  const from = w.mark();
  expect(w.net.stopTeenIntros("safety-s")).toEqual({ ok: true });
  expect(w.log("teen_item_closed").map(l => [l.detail.oppId, l.detail.reason])).toEqual([[item!.oppId, "teen_intros_off"]]);
  expect(w.net.teenItemCurrent(item!.oppId)).toBe(false);
  await w.run(48 * 3_600_000);
  const after = w.sent.slice(from).filter(s => itemOf(s) === item!.oppId);
  expect(after.map(s => s.to).sort()).toEqual(told);
  expect(after.filter(s => /Tess|Uma/.test(s.body))).toEqual([]);
  expect(after.filter(s => s.meta.type !== "cancellation" && s.meta.type !== "info")).toEqual([]);
});

test("a teen who says they are 24 loses every teen item and opens a case for the other teen", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  await w.say("t16", "Can you find me a regular climbing partner?");
  const [item] = teenItems(w, "t16");
  w.net.teenAgeContradicted("t17");
  expect(w.net.teenItemCurrent(item!.oppId)).toBe(false);
  expect(w.log("teen_age_contradicted").map(l => l.detail.minors)).toEqual([["t16"]]);
  expect(w.net.safetyCases().some(c => c.memberId === "t16" && c.events.some(e => e.kind === "adult_after_teen_contact" && e.by === "t17"))).toBe(true);
  await w.say("t16", "Can you find me a regular climbing partner?");
  expect(teenItems(w, "t16")).toEqual([]);
});

test("an 18-year-old and a 17-year-old born within 2 years reach review with both ages", async () => {
  const w = world(["t17", "t18"]);
  await w.onboard("t17", "t18");
  await w.say("t17", "Can you find me a regular climbing partner?");
  await w.net.tick(w.clock.now());
  const item = w.net.reviewQueue().find(i => i.proposal.participants.includes("t17"));
  expect(item).toBeDefined();
  expect([...item!.proposal.participants].sort()).toEqual(["t17", "t18"]);
  expect(item!.teen?.members.map(m => [m.memberId, m.age, m.maxAge]).sort()).toEqual([["t17", 17, 17], ["t18", 18, 18]]);
});

test("an 18-year-old who turns 19 inside the proposal window is never proposed to a 17-year-old", async () => {
  const soon = world(["t17", "s18"]);
  await soon.onboard("t17", "s18");
  const from = soon.mark();
  await soon.say("t17", "Can you find me a regular climbing partner?");
  await soon.run(24 * 3_600_000);
  expect(teenItems(soon, "t17")).toEqual([]);
  expect(soon.to("s18", from).filter(s => itemOf(s) !== undefined)).toEqual([]);

  const later = world(["t17", "l18"]);
  await later.onboard("t17", "l18");
  await later.say("t17", "Can you find me a regular climbing partner?");
  expect(teenItems(later, "t17").map(i => [...i.proposal.participants].sort())).toEqual([["l18", "t17"]]);
});

const COMPONENTS = { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 };

function inject(w: Mini, o: { id: string; participants: MemberId[]; stage: "review" | "probing" | "scheduled"; teen: boolean; meetingAt?: number; venue?: { id: string; name: string; area: string } }) {
  const st = w.net.exportState();
  const now = w.clock.now();
  st.opps.push({
    id: o.id, origin: "engine", kind: "intro", category: "hobby", objective: "a climbing session", detail: "", participants: o.participants, alternates: [], primed: [],
    status: o.participants.map(p => [p, o.stage === "review" ? "queued" : "yes"]), explanations: {}, stage: o.stage, deadline: now + DAY, createdAt: now, score: 0.5,
    components: COMPONENTS, generator: "activity_partner", exploration: false, sameDay: false, contacted: o.stage === "review" ? [] : o.participants, reminded: [], tags: [],
    replacements: 0, feedbackFrom: [], format: "one_to_one", roles: Object.fromEntries(o.participants.map(p => [p, "peer"])),
    review: o.stage === "review" ? { queuedAt: now, deadline: now + DAY }
      : { queuedAt: now, deadline: now + DAY, decision: "approve", approver: "judge", reviewer: "sim_review_judge", decidedAt: now, judgedRosters: [[...o.participants].sort().join("|")] },
    ...(o.meetingAt !== undefined ? { meetingAt: o.meetingAt, bookedTold: o.participants } : {}),
    ...(o.venue ? { venueId: o.venue.id, venue: o.venue.name, venueArea: o.venue.area } : {}),
    ...(o.teen ? { teenRuleAt: now } : {}),
  } as never);
  w.net.importState(st);
}

const stageOf = (w: Mini, id: string) => w.net.exportState().opps.find(o => o.id === id)?.stage;

test("an invited teen newcomer is never paired with an adult host, while an adult newcomer is", async () => {
  const w = world(["i30", "a30"]);
  await w.onboard("i30", "a30");
  await w.run(8 * DAY);
  for (const id of ["t16", "n31"]) {
    w.add(climber(id, CAST[id]![0], CAST[id]![1]));
    Object.assign(w.members.find(m => m.id === id)!, { invitedBy: "i30" });
    setBirth(w, id);
  }
  await w.onboard("t16", "n31");
  await w.run(2 * DAY);
  const queued = w.log("review_queued").map(l => (l.detail.proposal as { participants: MemberId[] }).participants);
  expect(queued.filter(p => p.includes("t16"))).toEqual([]);
  expect(w.log("gate_reason").filter(l => l.detail.reason === "participant_minor" && (l.detail.members as MemberId[]).includes("t16"))).toEqual([]);
  expect(queued.some(p => p.includes("n31") && p.includes("a30"))).toBe(true);
});

test("a teen pair's relay blocks text when the classifier cannot run, passes text that the classifier cleared, refuses a number, and refuses the text after a stop", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  inject(w, { id: "teen-relay", participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: w.clock.now() + 2 * DAY });
  expect(w.net.teenItemCurrent("teen-relay")).toBe(true);
  const clean = { hook: async () => ({ flags: [], block: [] }) };
  const down = { hook: async (): Promise<never> => { throw new Error("classifier_down"); } };
  const unread = w.mark();
  const unclassified = await w.net.relayRequest({ itemId: "teen-text-0", from: "t16", kind: "text", text: "see you at the climbing gym on saturday", matchId: "teen-relay" }, down);
  expect(unclassified).toMatchObject({ decision: "refused", reason: "I didn't send that, so it didn't reach them." });
  expect(w.to("t17", unread).filter(s => s.meta.type === "relay")).toEqual([]);
  const from = w.mark();
  const text = await w.net.relayRequest({ itemId: "teen-text-1", from: "t16", kind: "text", text: "see you at the climbing gym on saturday", matchId: "teen-relay" }, clean);
  expect(text.decision).toBe("sent");
  expect(w.to("t17", from).filter(s => s.meta.type === "relay").length).toBe(1);
  const number = await w.net.relayRequest({ itemId: "teen-number-1", from: "t16", kind: "contact_share", matchId: "teen-relay" }, clean);
  expect(number.decision).toBe("refused");
  expect(w.to("t17", from).filter(s => /\d{3}[-. ]?\d{4}/.test(s.body))).toEqual([]);
  expect(w.net.stopTeenIntros("safety-s")).toEqual({ ok: true });
  const off = w.mark();
  const later = await w.net.relayRequest({ itemId: "teen-text-2", from: "t16", kind: "text", text: "see you at the climbing gym on saturday", matchId: "teen-relay" }, clean);
  expect(later).toMatchObject({ decision: "refused", reason: "That match is closed, so I can't pass anything on to them." });
  expect(w.to("t17", off).filter(s => s.meta.type === "relay")).toEqual([]);
});

test("a teen who reports their partner as older than stated closes the partner's teen items, holds them for staff and opens a case for the minor", async () => {
  const w = world(["t16", "t17", "t18"]);
  await w.onboard("t16", "t17", "t18");
  inject(w, { id: "teen-met", participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: w.clock.now() + DAY });
  inject(w, { id: "teen-other", participants: ["t17", "t18"], stage: "review", teen: true });
  expect(w.net.teenItemCurrent("teen-other")).toBe(true);
  await w.say("t16", "report Uma, she's older than she said");
  expect(w.net.safetyReports().filter(r => r.subjectId === "t17").map(r => [r.kind, r.status])).toEqual([["older_than_stated", "open"]]);
  expect(stageOf(w, "teen-other")).toBe("closed");
  expect(w.net.teenItemCurrent("teen-other")).toBe(false);
  expect(w.net.teenPoolHolds()).toEqual(["t17"]);
  expect(w.log("teen_age_contradicted").map(l => l.detail.minors)).toEqual([["t16"]]);
  expect(w.net.safetyCases().some(c => c.memberId === "t16" && c.events.some(e => e.kind === "adult_after_teen_contact" && e.by === "t17"))).toBe(true);
  expect(w.net.safetyCases().some(c => c.memberId === "t18" && c.events.some(e => e.kind === "adult_after_teen_contact"))).toBe(false);
  await w.say("t18", "Can you find me a regular climbing partner?");
  expect(teenItems(w, "t18").filter(i => i.proposal.participants.includes("t17"))).toEqual([]);
});

test("a booked teen pair whose older member turns 19 before the meeting ends is closed by the sweep, and one who stays 18 is kept", async () => {
  const w = world(["t17", "l18"]);
  await w.onboard("t17", "l18");
  inject(w, { id: "teen-late", participants: ["t17", "l18"], stage: "scheduled", teen: true, meetingAt: Date.UTC(2026, 9, 14, 16) });
  inject(w, { id: "teen-soon", participants: ["t17", "l18"], stage: "scheduled", teen: true, meetingAt: Date.UTC(2026, 9, 8, 16) });
  const from = w.mark();
  await w.run(HOUR);
  expect(w.log("teen_item_closed").map(l => [l.detail.oppId, l.detail.reason])).toEqual([["teen-late", "age_changed"]]);
  expect(w.net.teenItemCurrent("teen-late")).toBe(false);
  expect(w.net.teenItemCurrent("teen-soon")).toBe(true);
  expect(w.sent.slice(from).filter(s => itemOf(s) === "teen-late" && /Uma|Yara/.test(s.body))).toEqual([]);
});

test("an adult who later says they are 16 opens a case for everyone they were probed with, without a meeting", async () => {
  const w = world(["a30", "a31"]);
  await w.onboard("a30", "a31");
  inject(w, { id: "adult-probe", participants: ["a30", "a31"], stage: "probing", teen: false });
  await w.say("a31", "I'm 16, is that ok?");
  expect(w.net.safetyCases().some(c => c.memberId === "a30" && c.events.some(e => e.kind === "contact_with_minor"))).toBe(true);
  expect(w.net.safetyCases().some(c => c.memberId === "a31" && c.events.some(e => e.kind === "minor_after_contact" && e.by === "a30"))).toBe(true);
});

test("feedback and interactions of a teen pair never reach the friends pack input, while an adult pair's do", async () => {
  const w = world(["t16", "t17", "a30", "a31"], { pack: friendsPack });
  await w.onboard("t16", "t17", "a30", "a31");
  const now = w.clock.now();
  const st = w.net.exportState();
  st.feedback.push({ id: "fb-teen", from: "t16", about: "t17", at: now, sentiment: "positive", wouldMeetAgain: true },
    { id: "fb-adult", from: "a30", about: "a31", at: now, sentiment: "positive", wouldMeetAgain: true });
  w.net.importState(st);
  const input = w.net.packInput(w.clock.now());
  expect(input.members.map(m => m.id)).toEqual(expect.arrayContaining(["t16", "t17"]));
  expect((input.feedback ?? []).map(f => f.id)).toEqual(["fb-adult"]);
  expect((input.interactions ?? []).filter(x => x.participants.some(id => id === "t16" || id === "t17"))).toEqual([]);
  expect(input.facets.filter(f => (f.memberId === "t16" || f.memberId === "t17") && f.kind !== "interest" && f.kind !== "boundary")).toEqual([]);
});

test("an ntwrk teen pair in the Friend lane reaches review, and the ntwrk engine input holds the teens with only interest and boundary facets and no interaction rows", async () => {
  const w = world(["t16", "t17", "a19"], { app: "ntwrk" }, friendSeeker);
  await w.onboard("t16", "t17", "a19");
  const input = w.net.packInput(w.clock.now());
  expect(input.members.map(m => m.id)).toEqual(expect.arrayContaining(["t16", "t17", "a19"]));
  expect(input.members.filter(m => m.id === "t16" || m.id === "t17").every(m => m.teenReady === true)).toBe(true);
  expect(input.facets.filter(f => (f.memberId === "t16" || f.memberId === "t17") && f.kind !== "interest" && f.kind !== "boundary")).toEqual([]);
  expect(input.facets.some(f => f.memberId === "a19" && f.kind === "skill")).toBe(true);
  expect((input.interactions ?? []).filter(x => x.participants.some(id => id === "t16" || id === "t17"))).toEqual([]);
  expect(input.teenIntros).toBe(true);
  await w.say("t16", "Can you help me make a few new friends in the city?");
  await w.net.tick(w.clock.now());
  const item = w.net.reviewQueue().find(i => i.proposal.participants.includes("t16"));
  expect(item).toBeDefined();
  expect([...item!.proposal.participants].sort()).toEqual(["t16", "t17"]);
  expect(item!.proposal.category).toBe("social");
  expect(item!.proposal.alternates).not.toContain("a19");
});

test("an ntwrk teen and a 19-year-old are never paired, and a stop on ntwrk refuses the teen pair", async () => {
  const w = world(["t16", "a19"], { app: "ntwrk" }, friendSeeker);
  await w.onboard("t16", "a19");
  await w.say("t16", "Can you help me make a few new friends in the city?");
  expect(teenItems(w, "t16")).toEqual([]);
  expect(teenItems(w, "a19")).toEqual([]);

  const control = world(["t16", "t17"], { app: "ntwrk" }, friendSeeker);
  await control.onboard("t16", "t17");
  await control.say("t16", "Can you help me make a few new friends in the city?");
  expect(teenItems(control, "t16").map(i => [...i.proposal.participants].sort())).toContainEqual(["t16", "t17"]);

  const stopped = world(["t16", "t17"], { app: "ntwrk" }, friendSeeker);
  await stopped.onboard("t16", "t17");
  expect(stopped.net.stopTeenIntros("safety-s")).toEqual({ ok: true });
  await stopped.say("t16", "Can you help me make a few new friends in the city?");
  expect(teenItems(stopped, "t16")).toEqual([]);
});

test("a named approval of a teen pair writes it as a cross-app avoid pair", async () => {
  const pairs: [MemberId, MemberId][][] = [];
  const w = world(["t16", "t17"], { onTeenPairAvoid: p => { pairs.push(p); } });
  await w.onboard("t16", "t17");
  await w.say("t16", "Can you find me a regular climbing partner?");
  const [item] = teenItems(w, "t16");
  expect(item).toBeDefined();
  expect(pairs).toEqual([]);
  await w.net.tick(w.clock.now());
  expect(pairs).toEqual([]);
  expect(w.net.decide(item!.oppId, "approve", { reviewer: "reviewer-r", revision: item!.revision })).toEqual({ ok: true });
  expect(pairs.map(list => list.map(pair => [...pair].sort()))).toEqual([[["t16", "t17"]]]);
});

test("a teen with an open report is a teen pool hold and their booked teen item stops being current", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  inject(w, { id: "teen-held", participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: w.clock.now() + DAY });
  expect(w.net.teenPoolHolds()).toEqual([]);
  expect(w.net.teenItemCurrent("teen-held")).toBe(true);
  await w.say("t16", "report Uma, she was rude to me");
  expect(w.net.safetyReports().some(r => r.subjectId === "t17" && r.status === "open")).toBe(true);
  expect(w.net.teenPoolHolds()).toEqual(["t17"]);
  expect(w.net.teenItemCurrent("teen-held")).toBe(false);
});

test("a teen item's own shape is required: an engine item with an adult-only generator, no format or a via is never current", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  inject(w, { id: "teen-ok", participants: ["t16", "t17"], stage: "review", teen: true });
  expect(w.net.teenItemCurrent("teen-ok")).toBe(true);
  const st = w.net.exportState();
  const base = st.opps.find(o => o.id === "teen-ok")!;
  st.opps.push({ ...base, id: "teen-generator", generator: "second_encounter" }, { ...base, id: "teen-format", format: undefined },
    { ...base, id: "teen-via", via: "t17" }, { ...base, id: "teen-role", roles: { t16: "peer", t17: "host" } });
  w.net.importState(st);
  for (const id of ["teen-generator", "teen-format", "teen-via", "teen-role"]) expect(w.net.teenItemCurrent(id)).toBe(false);
});

test("a teen whose teen-pair text states an age younger than the record opens a minor signal and ends the teen item, and a text that states the age on record opens nothing", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  inject(w, { id: "teen-age-talk", participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: w.clock.now() + 2 * DAY });
  const clean = { hook: async () => ({ flags: [], block: [] }) };
  const from = w.mark();
  const same = await w.net.relayRequest({ itemId: "teen-age-same", from: "t16", kind: "text", text: "I'm 16 btw", matchId: "teen-age-talk" }, clean);
  expect(same.decision).toBe("refused");
  expect(w.log("minor_signal")).toEqual([]);
  expect(w.net.teenItemCurrent("teen-age-talk")).toBe(true);
  const younger = await w.net.relayRequest({ itemId: "teen-age-younger", from: "t16", kind: "text", text: "I'm 12", matchId: "teen-age-talk" }, clean);
  expect(younger.decision).toBe("refused");
  expect(w.log("minor_signal").map(l => l.detail.memberId)).toEqual(["t16"]);
  expect(w.net.teenItemCurrent("teen-age-talk")).toBe(false);
  expect(w.to("t17", from).filter(s => s.meta.type === "relay")).toEqual([]);
});

test("an 18-year-old's introduction to an adult keeps no minor alternate and reaches review", async () => {
  const w = world(["t18", "a30", "t17"]);
  await w.onboard("t18", "a30", "t17");
  const id = w.propose(["t18", "a30"], { alternates: ["t17"] });
  expect(await w.runUntil(() => w.net.reviewQueue().some(i => i.oppId === id), 2 * DAY)).toBe(true);
  const item = w.net.reviewQueue().find(i => i.oppId === id)!;
  expect([...item.proposal.participants].sort()).toEqual(["a30", "t18"]);
  expect(item.proposal.alternates).not.toContain("t17");
  expect(item.teen).toBeUndefined();
  expect(w.log("gate_reason").filter(l => l.detail.reason === "participant_minor")).toEqual([]);
});

test("a teen with an open minor report stays out of the pool until the staff clear of the teen doubt dismisses the report", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  const st = w.net.exportState();
  Object.assign(st.members.find(m => m.id === "t17")!, { minorReported: true });
  (st.reports ??= []).push({ id: "r-minor-t17", kind: "minor", reporterId: "t16", subjectId: "t17", at: w.clock.now(), status: "open", source: "message", met: false });
  w.net.importState(st);
  await w.say("t16", "Can you find me a regular climbing partner?");
  expect(teenItems(w, "t16")).toEqual([]);
  expect(w.net.clearMinorSignal("t17", "safety-s", "checked the birth date")).toEqual({ ok: true });
  expect(w.net.safetyReports().filter(r => r.subjectId === "t17").map(r => [r.kind, r.status])).toEqual([["minor", "dismissed"]]);
  expect(w.net.teenPoolHolds()).toEqual([]);
  await w.run(25 * HOUR);
  await w.say("t16", "Can you find me a regular climbing partner?");
  expect(teenItems(w, "t16").map(i => [...i.proposal.participants].sort())).toContainEqual(["t16", "t17"]);
});

test("after a teen pair meets, each teen gets the feedback ask with no name in it", async () => {
  const w = world(["t16", "t17"]);
  await w.onboard("t16", "t17");
  inject(w, { id: "teen-met-fb", participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: w.clock.now() + 3 * HOUR });
  const from = w.mark();
  await w.run(3 * DAY);
  for (const id of ["t16", "t17"]) {
    const asks = w.to(id, from).filter(s => s.meta.type === "feedback_request" && s.meta.proposalId === "teen-met-fb");
    expect(asks).toHaveLength(1);
    expect(asks[0]!.body).not.toMatch(/Tess|Uma/);
  }
});

test("an adult meeting at a place where a booked teen pair meets within 2 hours takes another slot", async () => {
  const book = async (teenAt?: { at: number; venueId: string }) => {
    const w = world(["a30", "a31", "t16", "t17"], { inlineJudge: simulatedReviewJudge({ exceptions: false }), plans: false });
    await w.onboard("a30", "a31", "t16", "t17");
    if (teenAt) inject(w, { id: "teen-nearby", participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: teenAt.at, venue: { id: teenAt.venueId, name: "", area: "" } });
    const id = w.propose(["a30", "a31"]);
    await w.answerProbes(["a30", "a31"]);
    return { w, venue: w.log("venue").find(l => l.detail.oppId === id)?.detail as { venueId: string; meetingAt: number } | undefined };
  };
  const first = await book();
  expect(first.venue).toBeDefined();
  const again = await book({ at: first.venue!.meetingAt, venueId: first.venue!.venueId });
  expect(again.w.net.teenItemCurrent("teen-nearby")).toBe(true);
  expect(again.venue).toBeDefined();
  expect(again.venue!.venueId).toBe(first.venue!.venueId);
  expect(Math.abs(again.venue!.meetingAt - first.venue!.meetingAt)).toBeGreaterThan(2 * HOUR);
});

test("a booked teen pair that asks to move the meeting to a day on which one of them is 19 closes for both with no new time, and a move inside the rule keeps it", async () => {
  const venue = PLAN_VENUES.find(place => place.id === "mccarren-park")!;
  const originalAt = Date.UTC(2026, 9, 8, 16);
  const run = async (proposedAt: number) => {
    const w = world(["t17", "l18"]);
    await w.onboard("t17", "l18");
    inject(w, { id: "teen-move", participants: ["t17", "l18"], stage: "scheduled", teen: true, meetingAt: originalAt, venue: { id: venue.id, name: venue.name, area: venue.area } });
    const from = w.mark();
    await w.say("t17", `RESCHEDULE ${localBookingStart(originalAt)} TO ${localBookingStart(proposedAt)}`);
    return { w, from };
  };
  const late = Date.UTC(2026, 9, 14, 17);
  const closed = await run(late);
  expect(closed.w.log("teen_item_closed").map(l => [l.detail.oppId, l.detail.reason])).toEqual([["teen-move", "age_changed"]]);
  expect(closed.w.net.teenItemCurrent("teen-move")).toBe(false);
  for (const id of ["t17", "l18"]) {
    expect(closed.w.to(id, closed.from).filter(s => s.body.includes(describeBookingStart(late)) || /RESCHEDULE YES/.test(s.body))).toEqual([]);
    expect(closed.w.to(id, closed.from).filter(s => /Uma|Yara/.test(s.body))).toEqual([]);
  }
  const kept = await run(Date.UTC(2026, 9, 9, 17));
  expect(kept.w.log("teen_item_closed")).toEqual([]);
  expect(kept.w.net.teenItemCurrent("teen-move")).toBe(true);
});

test("an ntwrk teen whose other app holds them, or who is in a teen avoid pair read from another app, is never proposed on ntwrk", async () => {
  const held = world(["t16", "t17"], { app: "ntwrk" }, friendSeeker);
  Object.assign(held.members.find(m => m.id === "t17")!, { teenHeld: true });
  await held.onboard("t16", "t17");
  await held.say("t16", "Can you help me make a few new friends in the city?");
  expect(teenItems(held, "t16")).toEqual([]);
  expect(teenItems(held, "t17")).toEqual([]);

  const avoided = world(["t16", "t17"], { app: "ntwrk" }, friendSeeker);
  avoided.edges.push({ from: "t16", to: "t17", type: "avoid", strength: 1, explicit: true, createdAt: avoided.clock.now() });
  await avoided.onboard("t16", "t17");
  await avoided.say("t16", "Can you help me make a few new friends in the city?");
  expect(teenItems(avoided, "t16").filter(i => i.proposal.participants.includes("t17"))).toEqual([]);
});

const TEEN_PLACE = (() => {
  for (const venue of PLAN_VENUES) if (venue.allAges && venue.adultPlans) for (const activityId of venue.activities) {
    const size = plans.activityById.get(activityId)!.groupSize;
    if (size[0] <= 3 && size[1] >= 5 && planCatalogPlace({ venueId: venue.id, activityId })) return { venue, activityId };
  }
  throw new Error("no all-ages plan place for a table of 3 to 5");
})();

const SATURDAY_11_NY = Date.UTC(2026, 9, 10, 15);

function tablePlan(id: string, invited: MemberId[], o: { alternates?: MemberId[]; quorum: number; max: number; hostId?: MemberId; activityId?: string; venue?: typeof TEEN_PLACE.venue }): plans.Plan {
  const venue = o.venue ?? TEEN_PLACE.venue;
  return {
    id, city: "nyc", activityId: o.activityId ?? TEEN_PLACE.activityId, venueId: venue.id, place: { name: venue.name, area: venue.area },
    window: { start: SATURDAY_11_NY, end: SATURDAY_11_NY + 2 * HOUR }, invited, alternates: o.alternates ?? [], partner: false,
    size: { min: o.quorum, target: invited.length, max: o.max }, quorum: o.quorum, probeDeadline: START + 4 * DAY,
    score: 0.6, u: {}, familiar: {}, createdAt: START, category: "social", ...(o.hostId ? { hostId: o.hostId } : {}),
  };
}

async function approvedTable(w: Mini, plan: plans.Plan): Promise<{ oppId: string; alternates: MemberId[] }> {
  (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): unknown }).submitPlan(plan, w.clock.now());
  const opp = w.net.exportState().opps.find(o => o.plan?.id === plan.id);
  expect(opp?.stage).toBe("review");
  await w.net.tick(w.clock.now());
  expect(w.net.review(opp!.id, "approve", { reviewer: "staff-r" })).toBe(true);
  expect(await w.runUntil(() => plan.invited.every(id => w.probed(id)), 3 * DAY)).toBe(true);
  return { oppId: opp!.id, alternates: [...opp!.alternates] };
}

const tableMeetings = (w: Mini, oppId: string) => w.meetings.filter(m => m.proposalId === oppId).map(m => [...m.participants].sort());

test("a teen table books with its minors seated, and a later yes from an invited teen joins the booked table", async () => {
  const ids = ["t16", "t17", "t18", "z17"];
  const w = world(ids, { plans: false });
  await w.onboard(...ids);
  const { oppId } = await approvedTable(w, tablePlan("teen_table_join", ids, { quorum: 3, max: 4 }));
  expect(w.net.teenItemCurrent(oppId)).toBe(true);
  for (const id of ["t16", "t17", "t18"]) await w.say(id, "yes");
  expect(tableMeetings(w, oppId)).toEqual([["t16", "t17", "t18"]]);
  expect(stageOf(w, oppId)).toBe("scheduled");
  expect(w.net.teenItemCurrent(oppId)).toBe(true);
  await w.say("z17", "yes");
  expect(tableMeetings(w, oppId)).toEqual([["t16", "t17", "t18"], ["z17"]]);
  expect(w.net.exportState().opps.find(o => o.id === oppId)?.status).toContainEqual(["z17", "yes"]);
});

test("a booked teen table that falls under its quorum closes and offers its reviewed teen alternate no replacement seat", async () => {
  const ids = ["t16", "t17", "t18"];
  const w = world([...ids, "v17"], { plans: false, matchingEnabled: true });
  await w.onboard(...ids, "v17");
  const { oppId, alternates } = await approvedTable(w, tablePlan("teen_table_drop", ids, { alternates: ["v17"], quorum: 3, max: 3 }));
  expect(alternates).toEqual(["v17"]);
  for (const id of ids) await w.say(id, "yes");
  expect(tableMeetings(w, oppId)).toEqual([["t16", "t17", "t18"]]);
  const mark = w.mark();
  await w.say("t18", "I can't make it.");
  await w.run(DAY);
  expect(w.net.teenItemCurrent(oppId)).toBe(false);
  expect(w.net.exportState().opps.filter(o => o.replacementFor === oppId || o.fallbackOf === oppId)).toEqual([]);
  expect(w.to("v17", mark)).toEqual([]);
  expect(tableMeetings(w, oppId)).toEqual([["t16", "t17", "t18"]]);
});

test("an adult table approved before a teen pair books the same place within 2 hours closes with no common time, and books without that pair", async () => {
  const adults = ["a30", "a31", "a32"];
  const book = async (teenNearby: boolean) => {
    const w = world([...adults, "t16", "t17"], { plans: false });
    await w.onboard(...adults, "t16", "t17");
    const plan = tablePlan(`adult_table_${teenNearby}`, adults, { quorum: 3, max: 3 });
    const { oppId } = await approvedTable(w, plan);
    if (teenNearby) inject(w, { id: "teen-near-table", participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: plan.window.start + HOUR,
      venue: { id: TEEN_PLACE.venue.id, name: TEEN_PLACE.venue.name, area: TEEN_PLACE.venue.area } });
    for (const id of adults) await w.say(id, "yes");
    return { w, oppId };
  };
  const free = await book(false);
  expect(tableMeetings(free.w, free.oppId)).toEqual([adults]);
  const near = await book(true);
  expect(near.w.net.teenItemCurrent("teen-near-table")).toBe(true);
  expect(tableMeetings(near.w, near.oppId)).toEqual([]);
  expect(stageOf(near.w, near.oppId)).toBe("closed");
});

test("organizing reach adds a fitting adult and never a fitting teen-ready 16-year-old, and a table with a minor gets no reach", async () => {
  const venue = PLAN_VENUES.find(v => v.allAges && v.adultPlans && v.activities.includes("coffee_crawl"))!;
  expect(venue).toBeDefined();
  const ledger = new CapitalLedger();
  for (const id of ["a30", "a31", "a32"]) ledger.record({ id: `join:${id}`, type: "member_joined", member: id, age: 30, t: START - 7 * DAY });
  for (const daysAgo of [6, 5, 4]) ledger.record({
    id: `organized:${daysAgo}`, type: "organized", organizer: "a30", planId: `prior:${daysAgo}`,
    publicVenue: true, recurring: true, attendees: ["a31", "a32"], label: "Coffee crawl", t: START - daysAgo * DAY,
  });
  const capital = ledgerReader(ledger);
  expect(capital.organizingReach("a30", START).reservedForLowExposure).toBeGreaterThan(0);
  const coffee = (id: string, name: string, age: number): Spec => ({ id, name, age, area: venue.area, interests: ["coffee", "climbing"] });
  const ids = ["a30", "a31", "a32", "f30", "t16", "t17"];
  const w = world(ids, { plans: false, pack: friendsPack, capital }, coffee);
  for (const id of ids) w.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 });
  await w.onboard(...ids);
  const reach = (plan: plans.Plan) => (w.net as unknown as { withReach(plan: plans.Plan, now: number): plans.Plan }).withReach(plan, w.clock.now());
  const adultPlan = tablePlan("adult_reach", ["a30", "a31", "a32"], { quorum: 3, max: 3, hostId: "a30", activityId: "coffee_crawl", venue });
  expect(reach(adultPlan).invited).toEqual(["a30", "a31", "a32", "f30"]);
  const teenPlan = tablePlan("teen_reach", ["t16", "t17"], { quorum: 2, max: 3, hostId: "t17", activityId: "coffee_crawl", venue });
  expect(reach(teenPlan)).toEqual(teenPlan);
  expect(w.log("organizing_reach").map(l => l.detail.planId)).toEqual(["adult_reach"]);
});

test("an ntwrk gathering's priority and grouping evidence hold the adults and never a teen-ready member", async () => {
  const ids = ["t16", "t17", "a30", "a31"];
  const w = world(ids, { plans: false, app: "ntwrk" }, friendSeeker);
  await w.onboard(...ids);
  const now = w.clock.now();
  expect(w.net.gatheringPriorityEvidence(now).map(e => e.memberId).sort()).toEqual(["a30", "a31"]);
  expect([...w.net.gatheringGroupingEvidence(ids, now).members].sort()).toEqual(["a30", "a31"]);
});

async function teenPairMet(w: Mini, oppId: string) {
  await w.onboard("t16", "t17");
  inject(w, { id: oppId, participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: w.clock.now() + 3 * HOUR });
  expect(await w.runUntil(() => w.net.memberList().find(m => m.id === "t16")?.awaiting?.kind === "feedback", 3 * DAY)).toBe(true);
}

test("a teen's urgent check-in answer about the other teen files the report at once and puts the other teen on the teen pool hold list", async () => {
  const w = world(["t16", "t17"], { plans: false });
  await teenPairMet(w, "teen-fb-urgent");
  const mark = w.mark();
  await w.say("t16", "She was creepy and aggressive with me.");
  expect(w.net.safetyReports().map(r => [r.kind, r.source, r.reporterId, r.subjectId, r.opportunityId])).toEqual([["harassment", "check_in", "t16", "t17", "teen-fb-urgent"]]);
  expect(w.net.exportState().blocks).toContain("t16|t17");
  expect(w.net.teenPoolHolds()).toEqual(["t17"]);
  expect(w.to("t16", mark).map(s => s.body)).toContain(copy.reported());
  expect(w.to("t16", mark).filter(s => /Uma/.test(s.body))).toEqual([]);
});

test("a teen's concern in the check-in gets one question that names nobody, and 'report' then opens the case", async () => {
  const w = world(["t16", "t17"], { plans: false });
  await teenPairMet(w, "teen-fb-concern");
  const mark = w.mark();
  await w.say("t16", "She made me really uncomfortable.");
  const asked = w.to("t16", mark).filter(s => s.body === copy.checkInSafetyAsk("them"));
  expect(asked).toHaveLength(1);
  expect(w.to("t16", mark).filter(s => /Uma/.test(s.body))).toEqual([]);
  expect(w.net.exportState().members.find(m => m.id === "t16")?.pendingSafety).toMatchObject({ verb: "check_in", targets: ["t17"], oppId: "teen-fb-concern" });
  expect(w.net.safetyReports()).toEqual([]);
  await w.say("t16", "report");
  expect(w.net.safetyReports().map(r => [r.kind, r.source, r.subjectId])).toEqual([["other", "check_in", "t17"]]);
  expect(w.net.teenPoolHolds()).toEqual(["t17"]);
});

test("a minor report about a known teen closes the teen's items, opens a case for each other minor on those rosters and writes no teen pool bar", async () => {
  const bars: [MemberId, string][] = [];
  const w = world(["t16", "t17", "t18"], { plans: false, onTeenBar: (id, reason) => { bars.push([id, reason]); } });
  await w.onboard("t16", "t17", "t18");
  inject(w, { id: "teen-q22-a", participants: ["t16", "t17"], stage: "scheduled", teen: true, meetingAt: w.clock.now() + DAY });
  inject(w, { id: "teen-q22-b", participants: ["t17", "t18"], stage: "review", teen: true });
  await w.say("t16", "report Uma, she's only 12");
  expect(w.net.safetyReports().filter(r => r.subjectId === "t17").map(r => r.kind)).toEqual(["minor"]);
  expect(w.net.teenItemCurrent("teen-q22-a")).toBe(false);
  expect(w.net.teenItemCurrent("teen-q22-b")).toBe(false);
  expect(w.net.safetyCases().some(c => c.memberId === "t16" && c.events.some(e => e.kind === "adult_after_teen_contact" && e.by === "t17"))).toBe(true);
  expect(w.net.safetyCases().some(c => c.memberId === "t18" && c.events.some(e => e.kind === "adult_after_teen_contact"))).toBe(false);
  expect(bars).toEqual([]);
});
