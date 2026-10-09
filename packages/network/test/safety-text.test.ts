// Safety on the text line (PRD F23, 17.4, 32.8, 32.13, 32.14, 36.3; packages/network/src/safety.ts):
// who "block him" means, "Who do you mean?", no false "Done", urgent reports that hold the subject,
// distress replies with 911 first, the flake policy, approval re-checks for every origin, safety cue
// facets in a pack's engine input, and the friends verification tag. ConsentNetwork with The
// Network's and slop's wiring, on a hand-made world (no database, no model).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type MemberId, type SimMessage, type WorldSnapshot } from "@thenetwork/core";
import { buildWorld, localEmbed, resolveConfig } from "@thenetwork/engine";
import { friendsInfo, VERIFY_PASS } from "@thenetwork/engine/src/packs/friends/info.ts";
import { ConsentNetwork, type NetworkOptions, type NetworkState } from "../src/network.ts";
import { copy, copyFor, brandOf, styleViolations } from "../src/copy.ts";
import { safetyCues, safetyOf, SAFETY_CUE, type SafetySignal } from "../src/safety.ts";
import { classify } from "../src/classify.ts";
import { appWiring } from "../service/packs.ts";
import { APPS } from "../../platform/src/apps.ts";
import type { CapitalEvent } from "../src/capital.ts";

// Tuesday 2026-10-06, noon in New York.
const T0 = Date.UTC(2026, 9, 6, 16, 0, 0);
const PREFS = { quietHours: [22, 8], categoriesOptIn: ["social", "romance"], romanceOptIn: true, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false };

interface World {
  net: ConsentNetwork; clock: { t: number }; sent: SimMessage[]; blocks: [MemberId, MemberId][]; logs: { type: string; detail: Record<string, unknown> }[];
  signals: SafetySignal[]; ledger: CapitalEvent[]; snap: Omit<WorldSnapshot, "members"> & { members: (WorldSnapshot["members"][number] & { accountStatus?: string; safetyHold?: boolean })[] };
  say(id: MemberId, body: string): Promise<void>;
  lastTo(id: MemberId): string | undefined;
}

function world(names: Record<string, string>, o: Partial<NetworkOptions> = {}): World {
  const clock = { t: T0 };
  const sent: SimMessage[] = [], blocks: [MemberId, MemberId][] = [], logs: World["logs"] = [], signals: SafetySignal[] = [], ledger: CapitalEvent[] = [];
  const snap: World["snap"] = {
    now: T0, facets: [], intents: [], edges: [], recentProposals: [],
    members: Object.entries(names).map(([id, name]) => ({ id, name, homeCity: "nyc", state: "normal", prefs: PREFS as never, joinedAt: T0 - 30 * DAY, age: 30, unansweredProactive: 0, accountStatus: "active" })),
    presence: Object.keys(names).map(id => ({ memberId: id, city: "nyc", type: "home", areas: ["Williamsburg"] })),
  } as never;
  let seq = 0;
  const net = new ConsentNetwork({ review: "human", onSafety: s => signals.push(s), onLedger: e => ledger.push(e), ...o });
  net.init({
    clock: { now: () => clock.t },
    send: (memberId, body, opts) => { const m = { id: `m${++seq}`, ts: clock.t, direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: "delivered", meta: opts?.meta ?? {} } as SimMessage; sent.push(m); return m; },
    snapshot: () => ({ ...snap, now: clock.t, members: snap.members.map(m => ({ ...m })) }),
    recordProposal: () => {}, recordMeeting: m => m.proposalId, recordBlock: (a, b) => { blocks.push([a, b]); },
    log: (type, detail) => { logs.push({ type, detail }); },
  });
  let n = 0;
  return {
    net, clock, sent, blocks, logs, signals, ledger, snap,
    say: async (id, body) => { clock.t += 5 * 60_000; await net.onInbound({ id: `in${++n}`, memberId: id, body, ts: clock.t, channel: "imessage" }); },
    lastTo: id => [...sent].reverse().find(m => m.memberId === id)?.body,
  };
}

/** A meeting the Network booked between members (both told, both yes): `stage` scheduled (ahead) or done (past). */
function meeting(id: string, a: MemberId, b: MemberId, at: number, stage: "scheduled" | "done" | "probing" | "review", extra: Record<string, unknown> = {}) {
  const both = [a, b];
  return {
    id, origin: "request", kind: "intro", category: "social", objective: "coffee", detail: "a coffee", participants: both, alternates: [], primed: [],
    status: both.map(x => [x, stage === "probing" ? "probing" : "yes"]), explanations: {}, stage, deadline: at + DAY, createdAt: at - 2 * DAY, score: 0.5,
    components: {}, generator: "test", exploration: false, sameDay: false, contacted: stage === "review" ? [] : both, reminded: [], tags: [], replacements: 0, feedbackFrom: [],
    ...(stage === "scheduled" || stage === "done" ? { meetingAt: at, venue: "McCarren Park", bookedTold: both, bookedAt: Object.fromEntries(both.map(x => [x, at - DAY])), feedbackSent: stage === "done" } : {}),
    ...extra,
  };
}

/** Put opportunities (and member fields) into the Network through its stored state, as a restart would. */
function inject(w: World, opps: unknown[], members: Record<MemberId, Record<string, unknown>> = {}) {
  const st = w.net.exportState() as NetworkState & { opps: unknown[] };
  st.opps.push(...opps);
  for (const m of st.members) Object.assign(m, members[m.id] ?? {});
  w.net.importState(st);
}

const PEOPLE = { ana: "Ana Ruiz", ben: "Ben Cole", bdz: "Ben Diaz", cara: "Cara Lim", dev: "Dev Shah" };

async function joined(names: Record<string, string> = PEOPLE, o: Partial<NetworkOptions> = {}) {
  const w = world(names, o);
  for (const id of Object.keys(names)) await w.say(id, "hi");
  return w;
}

describe("block and report: who it is about", () => {
  test("'block him' is the one open counterpart; the meeting is called off and only then is it 'Done'", async () => {
    const w = await joined();
    inject(w, [meeting("o1", "ana", "ben", T0 + 2 * DAY, "scheduled")]);
    await w.say("ana", "block him");
    expect(w.blocks).toEqual([["ana", "ben"]]);
    expect(w.lastTo("ana")).toBe(copy.blocked);
    expect(w.net.opps.get("o1")!.stage).toBe("closed");
    // Ben hears it is off, never why.
    expect(w.lastTo("ben")).toBe(copy.declinedQuiet);
  });

  test("a pronoun with no open meeting is the most recent counterpart", async () => {
    const w = await joined();
    inject(w, [meeting("o1", "ana", "ben", T0 - 9 * DAY, "done"), meeting("o2", "ana", "cara", T0 - 2 * DAY, "done")]);
    await w.say("ana", "report her, she was rude to me");
    const r = w.net.safetyReports();
    expect(r.map(x => [x.reporterId, x.subjectId, x.kind])).toEqual([["ana", "cara", "harassment"]]);
  });

  test("a first name two counterparts share: 'Who do you mean?' with their names, nothing applied, then the answer applies it", async () => {
    const w = await joined();
    inject(w, [meeting("o1", "ana", "ben", T0 - 9 * DAY, "done"), meeting("o2", "ana", "bdz", T0 - 2 * DAY, "done")]);
    await w.say("ana", "report Ben, he kept messaging me after I said no");
    const ask = w.lastTo("ana")!;
    // Most recent first.
    expect(ask).toBe(copy.whoDoYouMean(["Ben D.", "Ben C."]));
    expect(styleViolations(ask)).toEqual([]);
    expect(w.net.safetyReports()).toEqual([]);
    expect(w.blocks).toEqual([]);
    expect(w.sent.some(m => m.memberId === "ana" && /^Done/.test(m.body))).toBe(false);
    await w.say("ana", "Ben D.");
    expect(w.net.safetyReports().map(x => x.subjectId)).toEqual(["bdz"]);
    expect(w.blocks).toEqual([["ana", "bdz"]]);
  });

  test("'block him' with two people ahead asks which one; 'never mind' drops it", async () => {
    const w = await joined();
    inject(w, [meeting("o1", "ana", "ben", T0 + DAY, "scheduled"), meeting("o2", "ana", "dev", T0 + 2 * DAY, "scheduled", { status: [["ana", "yes"], ["dev", "yes"]] })]);
    // Two open meetings for Ana at once only happen in a hand-made state; the question is what counts.
    await w.say("ana", "block him");
    expect(w.lastTo("ana")).toBe(copy.whoDoYouMean(["Dev", "Ben"]));
    await w.say("ana", "never mind");
    expect(w.blocks).toEqual([]);
    expect(w.net.opps.get("o1")!.stage).toBe("scheduled");
  });

  test("no false 'Done': a name that is nobody they met gets the same neutral reply as a name that is nobody", async () => {
    const w = await joined();
    await w.say("ana", "block Zed");
    const nobody = w.lastTo("ana")!;
    await w.say("ana", "block Cara Lim");
    const stranger = w.lastTo("ana")!;
    expect(nobody).toBe(copy.blockUnmatched);
    expect(stranger).toBe(nobody);
    expect(nobody.startsWith("Done")).toBe(false);
    // The stranger block still stands (a block never needs a meeting), the nobody block names no one.
    expect(w.blocks).toEqual([["ana", "cara"]]);
  });
});

describe("urgent reports by text", () => {
  test("'report Ben, he grabbed me' holds Ben everywhere: 911 first, a case, no new probes, no approval", async () => {
    const w = await joined();
    inject(w, [meeting("o1", "ana", "ben", T0 - DAY, "done"), meeting("p1", "ben", "cara", T0 + 3 * DAY, "probing")]);
    await w.say("ana", "report Ben, he grabbed me");
    expect(w.lastTo("ana")!.startsWith("If you are in danger, call 911")).toBe(true);
    expect(w.lastTo("ana")).toBe(copy.reportedUrgent);
    expect(w.net.isSafetyHeld("ben")).toBe(true);
    expect(w.signals).toContainEqual(expect.objectContaining({ t: "hold", memberId: "ben", reason: "urgent_report" }));
    expect(w.signals).toContainEqual(expect.objectContaining({ t: "evidence", memberIds: ["ana", "ben"] }));
    const c = w.net.safetyCases().find(x => x.memberId === "ben")!;
    expect(c.urgent).toBe(true);
    expect(c.events.map(e => e.kind)).toContain("auto_hold");
    // Ben's probe with Cara stopped, and nothing about others reaches him while held.
    expect(w.net.opps.get("p1")!.stage).toBe("closed");
    expect(w.net.recipientPolicy("ben", "probe", { about: ["cara"], proactive: true })).toEqual({ ok: false, reason: "safety_hold" });
    expect(w.net.eligible("ben")).toBe(false);
    // A report from someone who never met him opens a case and holds nobody (network-consent-7).
    const v = await joined();
    await v.say("ana", "report Ben Cole, he grabbed me");
    expect(v.net.isSafetyHeld("ben")).toBe(false);
    expect(v.signals.some(s => s.t === "hold")).toBe(false);
  });

  test("the hold lasts until staff decide; a dismissed report lets them back", async () => {
    const w = await joined();
    inject(w, [meeting("o1", "ana", "ben", T0 - DAY, "done")]);
    await w.say("ana", "report Ben, he threatened me");
    const id = w.net.safetyReports()[0]!.id;
    w.clock.t += 30 * DAY;
    await w.net.tick(w.clock.t);
    expect(w.net.isSafetyHeld("ben")).toBe(true);
    expect(w.net.dismissReport(id, "safety@test", "reviewed, not supported")).toEqual({ ok: true });
    expect(w.net.isSafetyHeld("ben")).toBe(false);
  });

  test("a minor report reaches the platform (SafetySignal minor) and takes them out of matching", async () => {
    const w = await joined();
    inject(w, [meeting("o1", "ana", "ben", T0 - DAY, "done")]);
    await w.say("ana", "report Ben, he's only 16");
    expect(w.signals).toContainEqual(expect.objectContaining({ t: "minor", memberId: "ben" }));
    expect(w.net.safetyCases().find(x => x.memberId === "ben")?.kind).toBe("minor");
    expect(w.net.eligible("ben")).toBe(false);
  });
});

describe("distress", () => {
  test("danger without the word report: 911 first, an urgent case, and nothing else in the reply", async () => {
    const w = await joined();
    await w.say("cara", "I'm scared, he followed me home");
    expect(w.lastTo("cara")).toBe(copy.distressUrgent);
    expect(copy.distressUrgent.startsWith("If you are in danger, call 911")).toBe(true);
    const c = w.net.safetyCases().find(x => x.memberId === "cara")!;
    expect(c).toMatchObject({ kind: "distress", urgent: true });
    expect(w.logs.some(l => l.type === "safety_alert" && l.detail.level === "urgent")).toBe(true);
    expect(w.signals).toContainEqual(expect.objectContaining({ t: "evidence", memberIds: ["cara"] }));
  });

  test("harm told about someone else is a flag: a case and a short supportive reply", async () => {
    const w = await joined();
    await w.say("cara", "he kept texting me after I said no");
    expect(w.lastTo("cara")).toBe(copy.distressFlag);
    expect(w.net.safetyCases().find(x => x.memberId === "cara")).toMatchObject({ kind: "distress" });
    expect(w.net.safetyCases().find(x => x.memberId === "cara")?.urgent).toBeUndefined();
  });

  test("the classifier: urgent, flag and none", () => {
    expect(safetyOf("I'm scared, he followed me home").level).toBe("urgent");
    expect(safetyOf("I don't feel safe right now").level).toBe("urgent");
    expect(safetyOf("my date showed up at my apartment uninvited").level).toBe("urgent");
    expect(safetyOf("she asked me for money twice").level).toBe("flag");
    expect(safetyOf("he asked me to venmo him $50", classify("he asked me to venmo him $50")).level).toBe("flag");
    expect(safetyOf("he is outside my door").level).toBe("urgent");
    for (const t of ["I'm scared of heights lol", "It was awkward, not my type", "followed the recipe and it hurt my brain", "looking for a running buddy",
      "no thanks, I don't feel safe meeting strangers at night", "she followed me on instagram", "it hurt me that he never texted back", "he threatened to cancel twice",
      "that really touched me, he's sweet"]) expect(safetyOf(t).level).toBe("none");
    for (const k of ["whoDoYouMean", "whoUnresolved", "blockUnmatched", "reportedUrgent", "distressUrgent", "distressFlag", "flakedOn", "flakeForgiven", "flakeCounted"] as const) {
      const v = copy[k];
      for (const text of typeof v === "function" ? [v([]), v(["Ben", "Dev"])] : [v]) expect(styleViolations(text)).toEqual([]);
    }
  });
});

describe("flake policy (slop wiring)", () => {
  const slop = () => { const wi = appWiring("slop"); return { app: APPS.slop, pack: wi.pack, hooks: wi.hooks, engine: wi.engine, plans: false } as Partial<NetworkOptions>; };
  const slopCopy = copyFor(brandOf(APPS.slop));

  test("a reported no-show: the Network apologises and offers to look again; no safety report", async () => {
    const w = await joined(PEOPLE, slop());
    inject(w, [meeting("o1", "ana", "ben", T0 - 5 * HOUR, "done")], { ana: { awaiting: { kind: "feedback", oppId: "o1", at: T0 - HOUR } } });
    await w.say("ana", "he never showed up");
    expect(w.lastTo("ana")).toBe(slopCopy.flakedOn);
    expect(w.net.safetyReports()).toEqual([]);
    expect(w.blocks).toEqual([]);
  });

  test("an unsafe date is still a report (911 first)", async () => {
    const w = await joined(PEOPLE, slop());
    inject(w, [meeting("o1", "ana", "ben", T0 - 5 * HOUR, "done")], { ana: { awaiting: { kind: "feedback", oppId: "o1", at: T0 - HOUR } } });
    await w.say("ana", "he never showed, and then he followed me home later");
    expect(w.lastTo("ana")).toBe(slopCopy.reportedUrgent);
    expect(w.net.safetyReports().map(r => r.kind)).toEqual(["unsafe"]);
  });

  test("the flaker: one forgiven no-show with a plain note, a second in 90 days lowers trust", async () => {
    const w = await joined(PEOPLE, slop());
    const note = () => (w.net.exportState() as NetworkState).members.find(m => m.id === "ben")?.note?.text;
    inject(w, [meeting("o1", "ana", "ben", T0 - 5 * HOUR, "done")], { ben: { awaiting: { kind: "feedback", oppId: "o1", at: T0 - HOUR } } });
    await w.say("ben", "sorry, I couldn't make it");
    // The note rides on the next message we send them (no extra text about a missed plan).
    expect(note()).toBe(slopCopy.flakeForgiven);
    expect(w.net.trust.get("ben").score).toBe(0);
    await w.say("ben", "block Zed");
    expect(w.lastTo("ben")!.startsWith(slopCopy.flakeForgiven)).toBe(true);
    w.clock.t += 20 * DAY;
    inject(w, [meeting("o2", "ben", "cara", w.clock.t - 5 * HOUR, "done")], { ben: { awaiting: { kind: "feedback", oppId: "o2", at: w.clock.t - HOUR } } });
    await w.say("ben", "I couldn't make it, sorry");
    expect(note()).toBe(slopCopy.flakeCounted);
    expect(w.net.trust.get("ben").score).toBe(2);
    // A flake is reliability, not safety: no case.
    expect(w.net.safetyCases().find(c => c.memberId === "ben")).toBeUndefined();
  });

  test("a cancel within 2 hours is a late cancel: plan_cancelled with late: true, and a flake", async () => {
    const w = await joined(PEOPLE, slop());
    inject(w, [meeting("o1", "ana", "ben", T0 + 90 * 60_000, "scheduled")], { ben: { awaiting: { kind: "booked", oppId: "o1", at: T0 - DAY } } });
    await w.say("ben", "something came up, I can't make it");
    expect(w.ledger.find(e => e.type === "plan_cancelled")).toMatchObject({ member: "ben", planId: "o1", late: true });
    expect(w.lastTo("ben")).toBe(slopCopy.flakeForgiven);
    // A day ahead it is free with notice.
    const v = await joined(PEOPLE, slop());
    inject(v, [meeting("o1", "ana", "ben", T0 + DAY, "scheduled")], { ben: { awaiting: { kind: "booked", oppId: "o1", at: T0 - DAY } } });
    await v.say("ben", "something came up, I can't make it");
    expect(v.ledger.find(e => e.type === "plan_cancelled")).not.toHaveProperty("late");
    expect(v.lastTo("ben")).toBe("No worries, thanks for the heads up.");
  });
});

describe("approval re-checks every origin (PRD 32.8)", () => {
  const review = (id: string, a: MemberId, b: MemberId) => meeting(id, a, b, T0, "review", { requester: a, review: { queuedAt: T0, deadline: T0 + 12 * HOUR }, status: [[a, "queued"], [b, "queued"]] });

  test("a member request with a held member is invalidated at approval", async () => {
    const w = await joined();
    inject(w, [review("r1", "ana", "ben")]);
    w.snap.members.find(m => m.id === "ben")!.safetyHold = true;
    expect(w.net.decide("r1", "approve", { reviewer: "rev@test" })).toEqual({ ok: false, reason: "safety_hold" });
    expect(w.net.opps.get("r1")!.stage).toBe("closed");
  });

  test("a paused member (account or participation state) is invalidated too", async () => {
    const w = await joined();
    inject(w, [review("r1", "ana", "ben"), review("r2", "cara", "dev")]);
    w.snap.members.find(m => m.id === "ben")!.accountStatus = "paused";
    w.snap.members.find(m => m.id === "dev")!.state = "paused";
    expect(w.net.decide("r1", "approve", { reviewer: "rev@test" })).toEqual({ ok: false, reason: "account_paused" });
    expect(w.net.decide("r2", "approve", { reviewer: "rev@test" })).toEqual({ ok: false, reason: "paused" });
  });

  test("away at the meeting time (presence) is invalidated; without a time, the probe checks it and swaps", async () => {
    const w = await joined();
    inject(w, [{ ...review("r1", "ana", "ben"), meetingAt: T0 + DAY }, review("r2", "cara", "dev")]);
    for (const id of ["ben", "dev"]) w.snap.presence.push({ memberId: id, city: "sf", type: "temporary", areas: [], from: T0 - DAY, to: T0 + 5 * DAY } as never);
    expect(w.net.decide("r1", "approve", { reviewer: "rev@test" })).toEqual({ ok: false, reason: "away" });
    // No time yet: every probe checks the next 6 days again (probe "away": replace or close), so approval leaves it.
    expect(w.net.decide("r2", "approve", { reviewer: "rev@test" })).toEqual({ ok: true });
  });

  test("a clean member request is still approved", async () => {
    const w = await joined();
    inject(w, [review("r1", "ana", "ben")]);
    expect(w.net.decide("r1", "approve", { reviewer: "rev@test" })).toEqual({ ok: true });
  });
});

describe("safety cues in a pack's engine input", () => {
  test("a money ask becomes safety:scam_pattern on the sender, which the slop pack reads", async () => {
    const wi = appWiring("slop");
    const w = await joined(PEOPLE, { app: APPS.slop, pack: wi.pack, hooks: wi.hooks, engine: wi.engine, plans: false });
    await w.say("dev", "can you send me $200 for the train ticket first");
    const input = w.net.packInput(w.clock.t);
    expect(input.facets.filter(f => f.memberId === "dev").flatMap(f => f.tags)).toContain(SAFETY_CUE.scam);
    expect(input.facets.filter(f => f.memberId === "ana").flatMap(f => f.tags).some(t => t.startsWith("safety:"))).toBe(false);
    expect(wi.pack!.id).toBe("slop");
  });

  test("the cues: scam, contact pressure, hostile language, age signal; never a disclosure", () => {
    expect(safetyCues(classify("venmo me $50 and I'll be there"))).toEqual([SAFETY_CUE.scam]);
    expect(safetyCues(classify("what's her phone number"))).toEqual([SAFETY_CUE.scam]);
    expect(safetyCues(classify("why won't she answer, she owes me"))).toEqual([SAFETY_CUE.hostile]);
    expect(safetyCues(classify("i have a math test tomorrow"))).toEqual([SAFETY_CUE.age]);
    expect(safetyCues(classify("he asked me to venmo him $50"))).toEqual([]);
  });

  test("a held person never enters a pack's input", async () => {
    const wi = appWiring("slop");
    const w = await joined(PEOPLE, { app: APPS.slop, pack: wi.pack, hooks: wi.hooks, engine: wi.engine, plans: false });
    w.snap.members.find(m => m.id === "ben")!.safetyHold = true;
    w.clock.t += HOUR; // the next unit reads a fresh snapshot
    expect(w.net.packInput(w.clock.t).members.map(m => m.id)).not.toContain("ben");
    expect(w.net.engineInput(w.clock.t).safetyHolds?.map(h => h.memberId)).toContain("ben");
  });
});

describe("friends verification tags", () => {
  test("only verify:<check>:pass (what staff and slop write) counts as verified", () => {
    const input = (tags: string[]) => ({
      now: T0, members: [{ id: "a", name: "A", homeCity: "nyc", state: "normal", prefs: PREFS, joinedAt: T0 - DAY, age: 30, unansweredProactive: 0 }],
      facets: tags.map((t, i) => ({ id: `f${i}`, memberId: "a", kind: "fact", value: t, tags: [t], scope: "agent_private", provenance: "vouched", confidence: 0.95 })),
      intents: [], presence: [], edges: [], recentProposals: [],
    }) as never;
    const verified = (tags: string[]) => friendsInfo(buildWorld(input(tags), resolveConfig({}), localEmbed)).get("a")!.verified;
    expect(VERIFY_PASS).toBe("pass");
    expect(verified(["verify:liveness:pass", "verify:age:pass"])).toBe(true);
    expect(verified(["verify:liveness:passed", "verify:age:passed"])).toBe(false);
    expect(verified(["verify:liveness:pass", "verify:age:fail"])).toBe(false);
  });
});
