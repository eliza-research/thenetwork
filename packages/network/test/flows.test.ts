// Focused ConsentNetwork flows on a small hand-built world (test/mini.ts): feedback after a meeting,
// repeat messages, request retries and review, the under-13 decline, engine questions, the send-time
// budget, the Blooio queue hook, network capital ledger events and fraud review, and plans v1.1 (the
// plan lane, quorum booking, crews, organizing reach). Each test drives one flow through the real Network.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE, UNDER_MIN_AGE_DECLINE } from "@thenetwork/core";
import { OutboundQueue, type RecipientPolicy } from "../../blooio/src/outbound-queue.ts";
import { world as blooioWorld } from "../../blooio/tests/helpers.ts";
import { blooioRecipientPolicy, copy, forbiddenProvider, OUTREACH, VENUES } from "../src/index.ts";
import { capitalWiring, FLOOR_EFFORT, type CapitalEvent, type CapitalReader, type GamingFlag } from "../src/capital.ts";
import { feedbackOf as feedbackOfText } from "../src/classify.ts";
import { APPS } from "../../platform/src/apps.ts";
import { Mini, type Spec } from "./mini.ts";

const climber = (id: string, name: string, more: Partial<Spec> = {}): Spec => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing"], ...more });
const CLIMB_WANT = { objective: "find a regular climbing partner", category: "hobby" as const };

/** Two adults go through the sequential probes and get a booked plan. Returns the meeting time. */
async function meet(w: Mini, a: string, b: string): Promise<number> {
  w.propose([a, b]);
  await w.answerProbes([a, b]);
  expect(w.meetings.length).toBe(1);
  return w.meetings[0]!.at;
}

describe("feedback after a meeting", () => {
  test("a bad meeting is negative: avoid pair, no growth ask; acknowledgements and early 'it was great' are not feedback; one thanks", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito", { area: "Williamsburg" })]);
    await w.onboard("a", "b");
    const at = await meet(w, "a", "b");
    // Before the meeting: not feedback (it used to get "Thanks, that's really helpful.").
    let t = w.mark();
    await w.say("a", "It was great chatting, see you Saturday!");
    expect(w.to("a", t)).toEqual([]);
    await w.run(at + 3 * HOUR + 30 * MINUTE - w.clock.now());
    expect(w.to("a").filter(s => s.meta.type === "feedback_request").length).toBe(1);
    // "See you there." answers the reminder, not "How did it go?": no reply, the question stays open.
    t = w.mark();
    await w.say("a", "See you there.");
    expect(w.to("a", t)).toEqual([]);
    await w.run(7 * MINUTE);
    await w.say("a", "Honestly not great, not much in common.");
    // The thanks is an acknowledgement: it is folded into the next message, never sent alone.
    expect(w.to("a", t)).toEqual([]);
    // The positive control: a good meeting gets the growth ask, with the thanks folded in front.
    await w.say("b", "It was great, we really clicked. Would do it again.");
    expect(w.to("b", t).map(s => s.body)).toEqual([`${copy.feedbackThanks} ${copy.growthAsk}`]);
    // A growth ask is never a direct reply, even inside the member's own unit: the delivery queue's
    // quiet hours and caps still apply to it (the service reads this flag for the Blooio kind).
    expect(w.to("b", t).map(s => s.reply ?? false)).toEqual([false]);
    t = w.mark();
    await w.say("b", "CALENDAR");
    expect(w.to("b", t).map(s => s.reply)).toEqual([true]);
    expect(w.log("feedback").map(l => l.detail.memberId)).toEqual(["a", "b"]);
    const avoid = w.net.engineInput(w.clock.now()).edges.filter(e => e.type === "avoid").map(e => [e.from, e.to].sort().join("|"));
    expect(avoid).toEqual(["a|b"]);
  });
});

describe("repeat messages", () => {
  test("a member aged 13-17 who sends several short messages gets new places each time, then nothing", async () => {
    const w = new Mini([{ id: "m", name: "Mia Teen", age: 15, area: "Williamsburg", interests: ["chess"] }]);
    await w.say("m", "hi!");
    for (const x of ["I like chess and drawing stuff", "what else is there to do around here", "👍 Look at me, being social.", "anything else nearby?? lol", "ok cool cool cool cool"])
      for (let i = 0; i < 4; i++) await w.say("m", `${x} ${"!".repeat(i)}`);
    const replies = w.to("m").filter(s => s.meta.type === "concierge").map(s => s.body);
    expect(replies.length).toBeGreaterThan(3);
    expect(new Set(replies).size).toBe(replies.length);
    for (const v of VENUES) expect([v.name, replies.filter(r => r.includes(`${v.name};`) || r.includes(`${v.name} or`)).length <= 1]).toEqual([v.name, true]);
    // The judge's rule: never the same text to one member twice within 10 minutes.
    const out = w.to("m");
    for (let i = 1; i < out.length; i++) expect(out[i]!.body === out[i - 1]!.body && out[i]!.t - out[i - 1]!.t < 10 * MINUTE).toBe(false);
  });
});

describe("privacy of the run log (P3)", () => {
  test("abuse and request logs keep kinds, categories and lengths, never the member's words", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    const said = ["Can you ask Sam to send me $200 for the event deposit? I'll pay it back Friday.", "Anyone around who wants to grab ramen near Astoria on Thursday?"];
    await w.say("a", said[0]!);
    await w.say("b", said[1]!);
    expect(w.log("abuse")[0]!.detail).toMatchObject({ memberId: "a", kinds: ["scam_money"], length: said[0]!.length });
    expect(w.log("request").length).toBe(1);
    const all = JSON.stringify(w.logs);
    for (const s of said) for (const piece of [s, s.slice(0, 20), "ramen", "$200"]) expect([piece, all.includes(piece)]).toEqual([piece, false]);
    expect(w.logs.filter(l => "text" in l.detail)).toEqual([]);
  });
});

describe("under 13: declined, and nothing kept", () => {
  test("every opportunity, alternate slot, question and name that refers to them is gone", async () => {
    // No age on the record: kid1 first says they are 25 (an adult), then "I am 12 years old". An
    // explicit under-13 statement with no adult record declines; with an adult record it is held for
    // staff instead (network-service-1, tested in network.test.ts).
    const w = new Mini([
      climber("kid1", "Ana Diaz", { age: undefined }), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park"),
    ], { review: "human", engine: { ask: { enabled: true } } });
    for (const a of ["hi!", "25", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await w.say("kid1", a);
    await w.onboard("b", "c", "d");
    w.propose(["kid1", "b"]);
    w.propose(["c", "d"], { alternates: ["kid1"], objective: "climb with Ana Diaz's crew" });
    await w.run(2 * HOUR);
    expect(w.net.reviewQueue().length).toBe(2);
    expect(w.net.engineInput(w.clock.now()).recentAsks?.some(a => a.memberId === "kid1")).toBe(true);
    // Texts kept for another member (the last message, an acknowledgement to fold in) that name them.
    const st = w.net.exportState(), other = st.members.find(m => m.id === "b")!;
    other.lastSent = { body: "Ana Diaz said yes.", at: w.clock.now() };
    other.pendingAck = { text: "Ana Diaz is in.", at: w.clock.now() };
    w.net.importState(st);
    const t = w.clock.now(), sent = w.mark();
    await w.say("kid1", "I am 12 years old");
    expect(w.net.isDeclined("kid1")).toBe(true);
    expect(w.to("kid1", sent).map(s => s.body)).toEqual([UNDER_MIN_AGE_DECLINE]);
    const opps = [...w.net.opps.values()];
    expect(opps.length).toBe(1);
    const left = JSON.stringify(opps.map(o => ({ ...o, status: [...o.status], primed: [...o.primed], contacted: [...o.contacted] })));
    for (const x of ["kid1", "Ana Diaz", "Ana D."]) expect([x, left.includes(x)]).toEqual([x, false]);
    // The stored state keeps only the id (to never message them again), and no text names them.
    const stored = JSON.stringify(w.net.exportState());
    for (const x of ["Ana Diaz", "Ana D."]) expect([x, stored.includes(x)]).toEqual([x, false]);
    expect(opps[0]!.objective).toBe("climb with someone's crew");
    const input = w.net.engineInput(w.clock.now());
    expect(JSON.stringify([input.recentAsks, input.recentProposals, input.edges, input.interactions, input.members.map(m => m.id)]).includes("kid1")).toBe(false);
    // Nothing logged after the decline names them.
    expect(w.logs.filter(l => l.t >= t && JSON.stringify(l.detail).includes("kid1"))).toEqual([]);
    await w.run(3 * DAY);
    expect(w.to("kid1", sent).length).toBe(1);
  });
});

describe("standing requests retried", () => {
  test("the requester hears nothing before review, hears once when retries come to nothing, and hears 'checking' after approval", async () => {
    const w = new Mini([climber("r", "Rae Kim", { wants: [] })], { review: "human" });
    await w.onboard("r");
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    expect(w.to("r").at(-1)!.body).toContain("I couldn't find someone");
    for (const id of ["c1", "c2", "c3"]) w.add(climber(id, `Climber ${id.toUpperCase()}`, { wants: [CLIMB_WANT] }));
    await w.onboard("c1", "c2", "c3");
    const since = w.mark();
    const decide = async (decision: "approve" | "reject") => {
      await w.until(10);
      const item = w.net.reviewQueue().find(q => q.origin === "request")!;
      expect(item.proposal.participants[0]).toBe("r");
      // Waiting for review: the requester has not been told anything.
      expect(w.to("r", since).filter(s => /Checking with them now/.test(s.body))).toEqual([]);
      expect(w.net.review(item.oppId, decision, { reason: decision === "reject" ? "weak_reason" : undefined })).toBe(true);
    };
    await decide("reject");
    expect(w.to("r", since).map(s => s.body)).toEqual([copy.declinedQuiet]);
    await decide("reject");
    expect(w.to("r", since).map(s => s.body)).toEqual([copy.declinedQuiet]); // once per request
    await decide("approve");
    expect(w.to("r", since).map(s => s.body)).toEqual([copy.declinedQuiet, copy.requestRetryFound]);
  });
});

describe("review gate rules (PRD 32.8)", () => {
  test("approve is refused when a participant is a known minor; reason 'other' needs a note", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "human" });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.run(2 * HOUR);
    const [item] = w.net.reviewQueue();
    // Staff correct b's age on the member record while the item waits.
    w.members.find(m => m.id === "b")!.age = 16;
    await w.run(30 * MINUTE);
    const t = w.mark();
    expect(w.net.reviewBlock(item!.oppId, "approve")).toBe("participant_minor");
    expect(w.net.review(item!.oppId, "approve", { reviewer: "test" })).toBe(false);
    expect(w.log("review_refused").map(l => l.detail.reason)).toEqual(["participant_minor"]);
    expect(w.net.review(item!.oppId, "reject", { reason: "other", reviewer: "test" })).toBe(false);
    expect(w.net.review(item!.oppId, "reject", { reason: "other", note: "age changed", reviewer: "test" })).toBe(true);
    await w.run(DAY);
    expect(w.sent.slice(t).filter(s => s.meta.type === "probe" || s.meta.type === "proposal")).toEqual([]);
  });
});

describe("re-engagement", () => {
  test("members aged 13-17 never get the re-engagement text (it offers people suggestions)", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), { id: "m", name: "Mia Teen", age: 15 }]);
    await w.onboard("a");
    await w.say("m", "hi!");
    // Both went quiet on "only when I ask". Nothing in today's flows asks a minor twice, so the
    // state is set directly: this checks the rule, not how a member reaches it.
    for (const m of w.net.memberList()) m.onlyWhenAsked = true;
    const t = w.mark();
    // D6: nothing after 30 days of silence unless a top-quartile item is being held for them.
    await w.run(31 * DAY);
    expect(w.to("a", t)).toEqual([]);
    for (const m of w.net.memberList()) m.heldHighAt = w.clock.now();
    await w.run(2 * DAY);
    // Unsolicited: it carries the pause path (PRD PH-003).
    expect(w.to("a", t).map(s => s.body)).toEqual([`${copy.reengage} Reply STOP anytime to opt out.`]);
    expect(w.to("m", t)).toEqual([]);
  });
});

describe("engine questions (EngineResult.asks)", () => {
  test("at most one per member per 7 days, an ask (not on the cap), in the send window, never to minors; answers go back as recentAsks", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), { id: "m", name: "Mia Teen", age: 15 }], { engine: { ask: { enabled: true } } });
    await w.onboard("a", "b");
    await w.say("m", "hi!");
    await w.run(DAY);
    const asked = (id: string) => w.to(id).filter(s => s.meta.ask);
    expect(asked("a").length).toBe(1);
    // Founder decision 3: a profiling ask is not an initial invite, so it never uses the cap.
    expect(asked("a")[0]!.meta).toMatchObject({ type: "question", proactive: false });
    expect(asked("m")).toEqual([]);
    await w.say("a", "I'd like to find a regular climbing partner.");
    const recent = w.net.engineInput(w.clock.now()).recentAsks!;
    expect(recent.find(r => r.memberId === "a")!.answeredAt).toBe(w.clock.now());
    expect(recent.find(r => r.memberId === "b")!.answeredAt).toBeUndefined();
    expect(w.log("ask_answered").map(l => l.detail.memberId)).toEqual(["a"]);
    await w.run(15 * DAY);
    for (const id of ["a", "b"]) {
      const ts = asked(id).map(s => s.t);
      for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeGreaterThanOrEqual(7 * DAY);
    }
    expect(asked("m")).toEqual([]);
  });
});

describe("interruption cap at send time (founder decision 3)", () => {
  test("only initial invites count, once per member; the booked plan, reminders, feedback and growth asks never do", async () => {
    // Normal members get 2 initial invites per 7 days. Ana is probed first for each staff intro
    // (she is the first participant), so her third probe in a week is refused at send time.
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss"), climber("d", "Dee Park")]);
    expect(OUTREACH.budget.normal).toEqual({ n: 2, days: 7 });
    await w.onboard("a", "b", "c", "d");
    const at = await meet(w, "a", "b");
    await w.run(at + 4 * HOUR - w.clock.now());
    await w.say("a", "It was great, we really clicked. Would do it again.");
    w.propose(["a", "c"]);
    await w.runUntil(() => w.probed("a"));
    await w.say("a", "no thanks, not this week");
    w.propose(["a", "d"]);
    await w.run(2 * DAY);
    const toA = w.to("a");
    // Two initial invites (one probe each), and nothing else on the cap.
    expect(toA.filter(s => s.meta.proactive).map(s => s.meta.type)).toEqual(["probe", "probe"]);
    for (const type of ["proposal", "reminder", "feedback_request", "growth_ask"]) expect([type, toA.some(s => s.meta.type === type && !s.meta.proactive)]).toEqual([type, true]);
    // At cap, Ana is not eligible for the third intro: it is skipped before review, and nobody is probed.
    expect(w.log("proposal_skipped").map(l => l.detail.reason)).toEqual(["participant unavailable"]);
    expect(w.to("d").filter(s => s.meta.type === "probe")).toEqual([]);
    // The partner's first probe counts on the partner's cap (Ben's one invite).
    expect(w.to("b").filter(s => s.meta.proactive).map(s => s.meta.type)).toEqual(["probe"]);
  });
});

describe("Blooio outbound queue hook (packages/blooio)", () => {
  test("blooioRecipientPolicy plugs into the queue's recipientPolicy and applies the Network's send-time checks", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), { id: "m", name: "Mia Teen", age: 15 }], { review: "human" });
    await w.onboard("a", "b");
    await w.say("m", "hi!");
    w.propose(["a", "b"]);
    await w.run(2 * HOUR);
    const opp = w.net.reviewQueue()[0]!.oppId;
    const phones: Record<string, string> = { "+15550100001": "a", "+15550100002": "b", "+15550100003": "m" };
    const policy: RecipientPolicy = blooioRecipientPolicy(w.net, to => phones[to]);
    const q = blooioWorld({ recipientPolicy: policy });
    expect(q.queue).toBeInstanceOf(OutboundQueue);
    const send = (key: string, to: string, kind: "reply" | "proactive" | "transactional", briefId?: string) =>
      q.queue.enqueue({ idempotencyKey: key, channel: "sim", to, text: "hello", kind, timeZone: "America/New_York", briefId }).record;
    // A reply answers something the person sent (the queue's reply window, plugin-prototypes-13).
    for (const to of ["+15550100003", "+15550100009"]) q.queue.onRecipientEngaged("sim", to);
    const recs = [
      send("adult-intro", "+15550100001", "transactional", opp),
      send("minor-intro", "+15550100003", "transactional", opp),
      send("minor-reply", "+15550100003", "reply"),
      send("stranger", "+15550100009", "reply"),
    ];
    await q.queue.drain();
    await w.say("a", "block Ben Ito");
    const blocked = send("blocked-pair", "+15550100001", "transactional", opp);
    await q.queue.drain();
    expect(recs.map(r => [r.idempotencyKey, r.status, r.history.at(-1)?.note ?? null])).toEqual([
      ["adult-intro", "sent", null],
      ["minor-intro", "suppressed_ineligible", "minor"],
      ["minor-reply", "sent", null],
      ["stranger", "suppressed_ineligible", "unknown_recipient"],
    ]);
    expect([blocked.status, blocked.history.at(-1)?.note]).toEqual(["suppressed_ineligible", "blocked_pair"]);
  });
});

describe("sequential probes with time options, then the booked plan (attention v1.2)", () => {
  test("the partner is offered only the picked times; the plan is booked at that time; a 'can't' cancels it and the other hears without the reason", async () => {
    const w = new Mini([climber("a", "Ana Diaz", { wants: [CLIMB_WANT] }), climber("b", "Ben Ito", { wants: [CLIMB_WANT] })]);
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    expect(await w.runUntil(() => w.probed("a"))).toBe(true);
    // Sequential: Ben hears nothing until Ana says yes.
    expect(w.to("b").filter(s => s.meta.type === "probe")).toEqual([]);
    const probeA = w.to("a").filter(s => s.meta.type === "probe").at(-1)!;
    const optsA = probeA.meta.timeOptions as { key: string; start: number; label: string }[];
    expect(optsA.length).toBeGreaterThanOrEqual(2);
    expect(probeA.body).toContain(optsA[0]!.label);
    expect(probeA.body).not.toMatch(/Ben|Ito/);
    await w.say("a", `${optsA[1]!.label.split(" ")[0]} works.`);
    expect(await w.runUntil(() => w.probed("b"))).toBe(true);
    const optsB = w.to("b").filter(s => s.meta.type === "probe").at(-1)!.meta.timeOptions as { start: number }[];
    expect(optsB.map(o => o.start)).toEqual([optsA[1]!.start]);
    const t = w.mark();
    await w.say("b", "yes, that works");
    // One booked-plan message each, at the time both picked; no separate "you're all set".
    expect(w.meetings.map(m => m.at)).toEqual([optsA[1]!.start]);
    await w.runUntil(() => w.to("a", t).some(s => s.meta.booked));
    const booked = w.sent.slice(t).filter(s => s.meta.booked);
    expect(booked.map(s => s.to).sort()).toEqual(["a", "b"]);
    for (const s of booked) {
      expect(s.meta).toMatchObject({ type: "proposal", proactive: false, booked: { at: optsA[1]!.start, optOutHours: 48 } });
      // Ana's "Great, thanks." for her probe yes is folded in front (acknowledgements never go alone).
      expect(s.body).toMatch(/^(Great, thanks\. )?You're both in: meet (Ana D\.|Ben I\.)/);
    }
    expect(w.sent.slice(t).filter(s => s.meta.type === "scheduling")).toEqual([]);
    // The calendar and weekly offer rides once, in each member's first booked plan.
    for (const s of booked) expect(s.body).toContain("reply CALENDAR");
    const c = w.mark();
    await w.say("b", "Sorry, I can't make it after all.");
    const toA = w.to("a", c).map(s => s.body);
    expect(toA).toEqual([copy.dropNotice("Ben", false)]);
    expect(toA.join(" ")).not.toMatch(/sorry, i can't|after all/i);
    expect(w.log("booked_cancelled").map(l => l.detail.memberId)).toEqual(["b"]);
  });

  test("'neither' keeps the yes; the partner gets other times, never one the first member turned down; silence keeps it booked", async () => {
    const w = new Mini([climber("a", "Ana Diaz", { wants: [CLIMB_WANT] }), climber("b", "Ben Ito", { wants: [CLIMB_WANT] })]);
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.runUntil(() => w.probed("a"));
    const offeredA = (w.to("a").filter(s => s.meta.type === "probe").at(-1)!.meta.timeOptions as { start: number }[]).map(o => o.start);
    await w.say("a", "I'd be up for it, but none of those times work.");
    // Ana is offered other times once (a direct reply); she turns those down too.
    const retryA = w.to("a").at(-1)!;
    expect(retryA.meta.type).toBe("scheduling");
    offeredA.push(...(retryA.meta.timeOptions as { start: number }[]).map(o => o.start));
    await w.say("a", "Hmm, none of those work this week.");
    expect(await w.runUntil(() => w.probed("b"))).toBe(true);
    const optsB = w.to("b").filter(s => s.meta.type === "probe").at(-1)!.meta.timeOptions as { start: number; label: string }[];
    expect(optsB.length).toBeGreaterThan(0);
    for (const o of optsB) expect(offeredA).not.toContain(o.start);
    // Ben picks none of his either: he is offered other times once, as a direct reply.
    const t = w.mark();
    await w.say("b", "Neither works this week, sorry.");
    const retry = w.to("b", t);
    expect(retry.map(s => s.meta.type)).toEqual(["scheduling"]);
    const optsB2 = retry[0]!.meta.timeOptions as { start: number; label: string }[];
    for (const o of optsB2) expect([...offeredA, ...optsB.map(x => x.start)]).not.toContain(o.start);
    await w.say("b", `${optsB2[0]!.label} works for me.`);
    expect(w.meetings.map(m => m.at)).toEqual([optsB2[0]!.start]);
    expect(w.log("venue").at(-1)!.detail.time).toBe("partly_picked");
    await w.run(3 * DAY);
    expect(w.log("booked_cancelled")).toEqual([]);
  });

  test("a partner who refuses is never booked: no reveal and no names, whatever time words the refusal has", async () => {
    for (const refusal of ["no, I can't make any of them", "No. Whichever, I'm not interested", "no sorry, none of those", "not this week, any time next week?"]) {
      const w = new Mini([climber("a", "Ana Diaz", { wants: [CLIMB_WANT] }), climber("b", "Ben Ito", { wants: [CLIMB_WANT] })]);
      await w.onboard("a", "b");
      w.propose(["a", "b"]);
      expect(await w.runUntil(() => w.probed("a"))).toBe(true);
      await w.say("a", "the first");
      expect(await w.runUntil(() => w.probed("b"))).toBe(true);
      const t = w.mark();
      await w.say("b", refusal);
      await w.run(2 * DAY);
      expect([refusal, w.meetings.length]).toEqual([refusal, 0]);
      expect(w.sent.slice(t).filter(s => s.meta.booked || s.meta.type === "scheduling")).toEqual([]);
      expect(w.sent.slice(t).map(s => s.body).join(" ")).not.toMatch(/Ana|Ben/);
      expect(w.log("probe_answer").at(-1)!.detail).toMatchObject({ memberId: "b", yes: false });
    }
  });

  test("a partner's 'neither' never brings back the time they turned down; with no time left in common the plan is not booked", async () => {
    const w = new Mini([climber("a", "Ana Diaz", { wants: [CLIMB_WANT] }), climber("b", "Ben Ito", { wants: [CLIMB_WANT] })]);
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.runUntil(() => w.probed("a"));
    await w.say("a", "the first");
    expect(await w.runUntil(() => w.probed("b"))).toBe(true);
    const offered = (w.to("b").filter(s => s.meta.type === "probe").at(-1)!.meta.timeOptions as { start: number }[]).map(o => o.start);
    expect(offered.length).toBe(1);
    const t = w.mark();
    await w.say("b", "Neither works this week, sorry.");
    await w.run(3 * DAY);
    // No retry with the same time, and no plan at a time Ben turned down (or one nobody picked).
    for (const s of w.sent.slice(t)) for (const o of (s.meta.timeOptions ?? []) as { start: number }[]) expect(offered).not.toContain(o.start);
    expect(w.meetings).toEqual([]);
    expect(w.sent.slice(t).filter(s => s.meta.booked)).toEqual([]);
    expect(w.log("no_common_time").map(l => l.detail.memberId)).toEqual(["b"]);
  });

  test("a member found to be under 18 after a booked plan opens a safety case naming the adults they met", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito", { area: "Williamsburg" }), climber("c", "Cy Ray")]);
    await w.onboard("a", "b", "c");
    await meet(w, "a", "b");
    await w.say("b", "my mom says i have to be home by 10 on school nights");
    expect(w.log("minor_after_contact").map(l => l.detail)).toEqual([{ memberId: "b", members: ["a"] }]);
    const c = w.net.safetyCases().find(x => x.memberId === "b")!;
    expect(c.events.map(e => [e.kind, e.by])).toEqual([["minor_after_contact", "a"]]);
    // A member with no booked plan gets no case.
    await w.say("c", "can we do something after school? i have a math test tmrw");
    expect(w.net.safetyCases().filter(x => x.memberId === "c")).toEqual([]);
  });

  test("the member record is read again: a later age under 18, a paused state, new quiet hours and a restricted account all apply", async () => {
    const w = new Mini([climber("a", "Ana Diaz", { wants: [CLIMB_WANT] }), climber("b", "Ben Ito", { wants: [CLIMB_WANT] }), climber("c", "Cy Ray")]);
    await w.onboard("a", "b", "c");
    expect(w.net.eligible("b")).toBe(true);
    w.propose(["a", "b"]);
    expect(await w.runUntil(() => w.probed("a"))).toBe(true);
    // Staff correct Ben's age to 16 after the opportunity was approved, before his probe.
    const rec = w.members.find(m => m.id === "b")!;
    rec.age = 16; rec.state = "paused"; rec.prefs.quietHours = [0, 24];
    expect(w.net.eligible("b")).toBe(false);
    expect(w.net.recipientPolicy("b", "probe")).toEqual({ ok: false, reason: "minor" });
    const b = w.net.memberList().find(m => m.id === "b")!;
    expect([b.state, b.minor, b.quietHours]).toEqual(["paused", true, [0, 24]]);
    const t = w.mark();
    await w.say("a", "the first");
    await w.run(2 * DAY);
    expect(w.to("b", t).filter(s => s.meta.type === "probe" || s.meta.booked)).toEqual([]);
    expect(w.meetings).toEqual([]);
    // A staff-restricted account is never matched or contacted, except replies and safety notices.
    (w.members.find(m => m.id === "c")! as { accountStatus?: string }).accountStatus = "restricted";
    expect(w.net.eligible("c")).toBe(false);
    expect(w.net.recipientPolicy("c", "probe")).toEqual({ ok: false, reason: "account_restricted" });
    expect(w.net.recipientPolicy("c", "reply")).toEqual({ ok: true });
    expect(w.net.recipientPolicy("a", "probe", { about: ["a", "c"] })).toEqual({ ok: false, reason: "other_not_matchable" });
  });

  test("CALENDAR and WEEKLY opt-ins; the weekly check-in goes on Sundays in the member's send window, and never to members aged 13-17", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), { id: "m", name: "Mia Teen", age: 15 }]);
    await w.onboard("a");
    await w.say("m", "hi!");
    await w.say("a", "CALENDAR");
    expect(w.to("a").at(-1)!.body).toBe(copy.calendarOptIn);
    await w.say("a", "weekly");
    expect(w.to("a").at(-1)!.body).toBe(copy.weeklyOptIn);
    await w.say("m", "weekly");
    expect(w.to("m").some(s => s.body === copy.weeklyOptIn)).toBe(false);
    await w.run(8 * DAY);
    const checkins = w.to("a").filter(s => s.body.startsWith(copy.weeklyCheckin));
    expect(checkins.length).toBe(1);
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(checkins[0]!.t);
    expect(p.find(x => x.type === "weekday")!.value).toBe("Sun");
    expect(Number(p.find(x => x.type === "hour")!.value)).toBeGreaterThanOrEqual(12);
    expect(checkins[0]!.meta.proactive).toBe(false);
    await w.say("a", "Tue and Thu evenings are good");
    expect(w.log("availability_stated").map(l => l.detail.tags)).toEqual([["evening:Tue", "evening:Thu"]]);
    expect(w.to("m").filter(s => s.body.startsWith(copy.weeklyCheckin))).toEqual([]);
  });
});

describe("timeline logs (the judge and the Observatory)", () => {
  test("deferrals, per-proposal gate reasons and the review-mode actor are logged", async () => {
    const w = new Mini(["a", "b", "c", "d"].map(id => climber(id, `${id.toUpperCase()}na Diaz${id}`, { wants: [CLIMB_WANT], skills: ["belaying"] })), { review: "human", maxNewPerDay: 0 });
    await w.onboard("a", "b", "c", "d");
    w.net.setReviewMode("auto", "staff:ops");
    expect(w.log("review_mode").at(-1)!.detail).toEqual({ mode: "auto", actor: "staff:ops" });
    await w.until(10);
    // The engine's proposals were stopped by the daily cap of 0, each logged with its members.
    const gated = w.log("gate_reason");
    expect(gated.length).toBeGreaterThan(0);
    for (const l of gated) expect(l.detail).toMatchObject({ reason: "daily_cap", proposalKey: (l.detail.members as string[]).slice().sort().join("|") });
    // A staff intro, approved in the 09:00 batch, before the send window opens: the probe waits, and the wait is logged.
    w.propose(["a", "b"]);
    await w.run(DAY);
    const d = w.log("send_deferred").find(l => l.detail.kind === "probe");
    expect(d).toBeDefined();
    expect(await w.runUntil(() => w.sent.some(s => s.meta.type === "probe"), DAY)).toBe(true);
    const first = w.sent.find(s => s.meta.type === "probe")!;
    expect(first.t).toBeGreaterThanOrEqual(Number(d!.detail.until));
  });
});

describe("Blooio outbound queue leak lists (forbiddenProvider)", () => {
  test("other members' private facts and canaries are parked for review; the recipient's own and the Network's own words pass", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { review: "human" });
    const priv = (memberId: string, value: string) => w.facets.push({
      id: `${memberId}:p:${w.facets.length}`, memberId, kind: "fact", value, tags: [], scope: "agent_private", provenance: "said", confidence: 0.9,
      validFrom: w.clock.now(), source: "chat", observedAt: w.clock.now(), inferred: false, confirmedByMember: true,
    });
    priv("b", "going through a divorce and sleeping badly (ref QX-4821-ORCHID)");
    priv("a", "recovering from a knee surgery this spring");
    await w.onboard("a", "b", "c");
    const phones: Record<string, string> = { "+15550100001": "a", "+15550100002": "b", "+15550100003": "c" };
    // Group sends need the participant resolver, and replies a recent inbound (plugin-prototypes-13, -14).
    const q = blooioWorld({ forbiddenProvider: forbiddenProvider(w.net, to => (to.startsWith("chat:") ? ["a", "b", "c"] : phones[to])), groupParticipants: () => Object.keys(phones) });
    for (const to of [...Object.keys(phones), "chat:g1"]) q.queue.onRecipientEngaged("sim", to);
    const send = (key: string, to: string, text: string) => q.queue.enqueue({ idempotencyKey: key, channel: "sim", to, text, kind: "reply", timeZone: "America/New_York" }).record;
    const recs = [
      send("fact-to-other", "+15550100001", "Heads up: Ben is going through a divorce and sleeping badly."),
      send("canary-to-other", "+15550100003", "ref qx 4821 orchid"),
      send("own-fact", "+15550100002", "Hope you're sleeping better after the divorce stuff."),
      send("plain", "+15550100001", "Up for a climbing session near Greenpoint this weekend?"),
      send("group-own-fact", "chat:g1", "Ana is recovering from a knee surgery this spring."),
    ];
    await q.queue.drain();
    expect(recs.map(r => [r.idempotencyKey, r.status])).toEqual([
      ["fact-to-other", "parked_leak_review"], ["canary-to-other", "parked_leak_review"], ["own-fact", "sent"], ["plain", "sent"], ["group-own-fact", "parked_leak_review"],
    ]);
  });
});

// ------------------------------------------------------------------ network capital (NC) and plans v1.1

/** A capital reader with fixed levers (and optional gaming flags), for flows that need one lever. */
const reader = (o: Partial<CapitalReader> & { flagged?: GamingFlag[] } = {}): CapitalReader => ({
  vouchCapacity: () => 3, organizingReach: () => ({ max: 8, reservedForLowExposure: 0 }), effort: () => FLOOR_EFFORT, flags: () => o.flagged ?? [], ...o,
});

describe("network capital: ledger events (docs/results/2026-10-08-network-capital.md, integration asks)", () => {
  test("a booked intro emits joined, activated, accepted, confirmed by silence, attended (mutual check-in), feedback and value, in order; the ledger credits both", async () => {
    const cw = capitalWiring();
    const events: CapitalEvent[] = [];
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito", { area: "Williamsburg" })], { onLedger: e => { events.push(e); cw.onLedger(e); }, plans: false });
    await w.onboard("a", "b");
    const at = await meet(w, "a", "b");
    await w.run(at + 3 * HOUR + 30 * MINUTE - w.clock.now());
    await w.say("a", "It was great, Ben and I really clicked. Would definitely do it again.");
    await w.say("b", "It was nice. Ana was easy to talk to, I'd hang out again.");
    await w.run(HOUR);
    const of = (id: string) => events.filter(e => ("member" in e && e.member === id)).map(e => e.type);
    for (const id of ["a", "b"]) {
      expect(of(id)).toEqual(["member_joined", "member_activated", "plan_accepted", "plan_confirmed", "value_received", "plan_attended", "feedback_given"]);
    }
    const attended = events.filter((e): e is Extract<CapitalEvent, { type: "plan_attended" }> => e.type === "plan_attended");
    expect(attended.map(e => [e.member, e.verifiedBy, e.counterparts, e.origin, e.publicVenue])).toEqual([["a", ["counterpart"], ["b"], "engine", true], ["b", ["counterpart"], ["a"], "engine", true]]);
    // Silence through the booked plan's 48-hour opt-out (or the start) is the confirmation, recorded once.
    expect(w.log("plan_confirmed").map(l => [l.detail.memberId, l.detail.how])).toEqual([["a", "silence"], ["b", "silence"]]);
    expect(new Set(events.map(e => e.id)).size).toBe(events.length);
    expect(events.every((e, i) => i === 0 || e.t >= events[i - 1]!.t)).toBe(true);
    expect(cw.rejected()).toBe(0);
    expect(cw.ledger.balance("a")).toBeGreaterThan(2);
    expect(cw.ledger.balance("b")).toBeGreaterThan(2);
  });

  test("silent after the booked plan and reported missing is ghosting; vouch capacity is read at invite time", async () => {
    const events: CapitalEvent[] = [];
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito", { area: "Williamsburg" })], { onLedger: e => events.push(e), capital: reader({ vouchCapacity: id => (id === "a" ? 0 : 3) }), plans: false });
    await w.onboard("a", "b");
    const at = await meet(w, "a", "b");
    await w.run(at + 3 * HOUR + 30 * MINUTE - w.clock.now());
    await w.say("b", "Ana never showed up, which was a bummer.");
    await w.run(4 * DAY);
    expect(events.filter(e => e.type === "plan_ghosted" || e.type === "plan_no_show" || e.type === "plan_attended").map(e => [e.type, "member" in e ? e.member : ""]))
      .toEqual([["plan_ghosted", "a"], ["plan_attended", "b"]]);
    // b came, but nobody who came confirms it: attendance without verification (the ledger gives no credit).
    expect(events.find(e => e.type === "plan_attended")).toMatchObject({ verifiedBy: [] });
    let t = w.mark();
    await w.say("a", "My friend Sam would love this.");
    expect(w.to("a", t).map(s => s.body)).toEqual(["Thanks! You're out of invites for now; I'll let you know when you have more."]);
    t = w.mark();
    await w.say("b", "My friend Sam would love this.");
    expect(w.to("b", t)[0]!.body).toBe(copy.inviteSent("Sam"));
  });
});

describe("network capital: gaming flags in the human review queue (kind 'fraud')", () => {
  test("a flag waits for a person (never the simulated reviewer); approve emits fraud_confirmed, reject emits nothing; no re-queue within 14 days", async () => {
    const events: CapitalEvent[] = [];
    const flag: GamingFlag = { kind: "reciprocal_ring", members: ["a", "b", "c"], t: 0, evidence: { confirmedCredits: 6, reciprocalShare: 0.83, ringSize: 3 } };
    let flagged = [flag];
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")], { onLedger: e => events.push(e), capital: reader({ flags: () => flagged }), plans: false });
    await w.onboard("a", "b", "c");
    await w.until(10);
    const [item] = w.net.reviewQueue();
    expect(item).toMatchObject({ kind: "fraud", origin: "fraud", fraud: { flag: "reciprocal_ring", members: ["a", "b", "c"], evidence: { ringSize: 3 } } });
    expect(item!.proposal.participants).toEqual(["a", "b", "c"]);
    // Review mode "auto" (the simulator) does not decide it, and nobody is messaged about it.
    const t = w.mark();
    expect(w.net.decide(item!.oppId, "reroll").ok).toBe(false);
    expect(w.net.decide(item!.oppId, "approve", { reviewer: "staff_1", note: "same three confirm each other" })).toEqual({ ok: true });
    expect(w.to("a", t).concat(w.to("b", t), w.to("c", t))).toEqual([]);
    expect(events.filter(e => e.type === "fraud_confirmed")).toMatchObject([{ members: ["a", "b", "c"], note: "same three confirm each other" }]);
    expect(w.net.reviewQueue()).toEqual([]);
    // The same flag is not queued again for 14 days; a new one is, and a rejection emits nothing.
    await w.run(DAY);
    expect(w.net.reviewQueue()).toEqual([]);
    flagged = [{ ...flag, kind: "staged_meetup", members: ["b", "c"], evidence: { plans: 3 } }];
    await w.run(DAY);
    const [next] = w.net.reviewQueue();
    expect(next!.fraud?.flag).toBe("staged_meetup");
    expect(w.net.decide(next!.oppId, "reject", { reviewer: "staff_1", reason: "other" }).ok).toBe(false);
    expect(w.net.decide(next!.oppId, "reject", { reviewer: "staff_1", reason: "other", note: "real friends" }).ok).toBe(true);
    expect(events.filter(e => e.type === "fraud_confirmed").length).toBe(1);
    expect(w.net.fraudItems().map(x => x.status)).toEqual(["confirmed", "dismissed"]);
  });
});

describe("plans v1.1: the planner, the plan lane and crews", () => {
  const runner = (id: string, name: string, more: Partial<Spec> = {}): Spec => ({ id, name, age: 30, area: "Williamsburg", interests: ["running"], ...more });
  const ADULTS = ["a", "b", "c", "d", "e"];
  async function planWorld(capital?: CapitalReader) {
    const events: CapitalEvent[] = [];
    const w = new Mini([runner("a", "Ana Diaz"), runner("b", "Ben Ito"), runner("c", "Cy Ruiz"), runner("d", "Dee Moss"), runner("e", "Eve Novak"), runner("k", "Kim Young", { age: 16 }),
      runner("f", "Fay Ochoa"), runner("g", "Gus Abara")], { onLedger: e => events.push(e), ...(capital ? { capital } : {}) });
    await w.onboard(...ADULTS, "k");
    return { w, events };
  }
  const names = ["ana", "diaz", "ben", "ito", "cy", "ruiz", "dee", "moss", "eve", "novak", "kim", "young"];
  const named = (body: string) => names.filter(n => new RegExp(`\\b${n}\\b`, "i").test(body));

  test("plans run Monday from 09:00; probes name nobody, carry the time, never reach a minor, and use the plan allowance (1 per 7 days, never the intro cap)", async () => {
    const { w } = await planWorld();
    expect(await w.runUntil(() => w.sent.some(s => s.meta.type === "plan_probe"), 2 * DAY)).toBe(true);
    const probes = w.sent.filter(s => s.meta.type === "plan_probe");
    expect(w.log("planner_run").length).toBe(1);
    // One review item per plan, approved before any probe.
    const approved = w.log("review_decision").filter(l => l.detail.decision === "approve").map(l => String(l.detail.oppId));
    for (const p of probes) expect(approved).toContain(String((p.meta.plan as { planId: string }).planId));
    for (const p of probes) {
      expect(named(p.body)).toEqual([]);
      expect(p.body).toMatch(/McCarren Park|Domino Park|Saturday|Sunday/);
      expect(p.meta.proactive).toBe(true);
      expect(p.meta.planInvite).toBe(true);
    }
    expect(new Set(probes.map(p => p.to))).toEqual(new Set(ADULTS));
    // Judge-style: no member under 18 in any plan role, ever.
    for (const q of w.log("review_queued")) expect((q.detail.proposal as { participants: string[]; alternates: string[] }).participants.concat((q.detail.proposal as { alternates: string[] }).alternates)).not.toContain("k");
    expect(w.to("k").filter(s => s.meta.type === "plan_probe")).toEqual([]);
    // Nobody answers: no second plan invite within 7 days, and the intro cap never saw one.
    await w.run(7 * DAY);
    for (const id of ADULTS) {
      const ts = w.to(id).filter(s => s.meta.planInvite).map(s => s.t);
      for (const t of ts) expect(ts.filter(x => x > t - 7 * DAY && x <= t).length).toBe(1);
      expect(w.net.memberList().find(m => m.id === id)!.proactive).toEqual([]);
    }
  });

  test("quorum books the plan and only then names the others; late yeses join; a great plan offers a crew once; opt-ins form it; reach above 8 goes to the least exposed", async () => {
    // The host's organizing reach: 10, so 2 slots above the base 8, reserved for members with the least recent participation.
    const { w, events } = await planWorld(reader({ organizingReach: () => ({ max: 10, reservedForLowExposure: 2 }) }));
    await w.runUntil(() => w.sent.some(s => s.meta.type === "plan_probe"), 2 * DAY);
    const planId = String((w.sent.find(s => s.meta.type === "plan_probe")!.meta.plan as { planId: string }).planId);
    for (const id of ADULTS) if (w.probed(id)) await w.say(id, "Yes, I'm in.");
    const booked = w.log("plan_booked");
    expect(booked.map(l => [l.detail.oppId, l.detail.going])).toEqual([[planId, 3]]);
    const reveals = w.sent.filter(s => s.meta.booked);
    expect(reveals.length).toBe(5);
    // Names only after booking: every message naming another invitee comes at or after plan_booked.
    for (const s of w.sent.filter(s => s.to !== "k" && named(s.body).some(n => !names.slice(ADULTS.indexOf(s.to) * 2, ADULTS.indexOf(s.to) * 2 + 2).includes(n)))) expect(s.t).toBeGreaterThanOrEqual(booked[0]!.t);
    for (const r of reveals) expect(r.body).toMatch(/^(Great, thanks\. )?You're in: an easy group run, .* Everyone pays their own way\. Reply if your plans change\./);
    expect(w.meetings.map(m => m.participants.length)).toEqual([3, 1, 1]);
    // After the plan: four would do it again (>= 3): a crew is offered once, to them only.
    await w.runUntil(() => w.sent.some(s => s.meta.type === "feedback_request"), 7 * DAY);
    for (const id of ["a", "b", "c", "d"]) await w.say(id, "Yes, I'd do it again!");
    await w.say("e", "Probably not, it wasn't really my thing.");
    const offers = w.sent.filter(s => s.meta.type === "crew_offer");
    expect(offers.map(s => s.to).sort()).toEqual(["a", "b", "c", "d"]);
    expect(w.log("crew_offered").length).toBe(1);
    // would_interact_again edges between the attendees who both said so.
    const again = w.net.engineInput(w.clock.now()).edges.filter(e => e.type === "would_interact_again").map(e => [e.from, e.to].sort().join("|"));
    expect(again.length).toBe(6);
    for (const id of ["a", "b", "c"]) await w.say(id, "Yes, count me in for a weekly one.");
    await w.say("d", "I'll pass on a weekly thing, thanks.");
    expect(w.log("crew_formed").map(l => l.detail.yes)).toEqual([3]);
    expect(w.net.crews.map(c => c.members)).toEqual([["a", "b", "c"]]);
    // Two runners who have never met anyone join now; e and d met people at the plan.
    await w.onboard("f", "g");
    await w.run(5 * DAY);
    expect(w.log("crew_offered").length).toBe(1);
    expect(w.log("crew_session").length).toBeGreaterThanOrEqual(1);
    expect(w.log("organizing_reach")[0]!.detail).toMatchObject({ max: 10, reserved: 2, added: 2 });
    const session = w.log("review_queued").map(l => l.detail.proposal as { generator: string; participants: string[] }).find(p => p.generator === "crew")!;
    expect(session.participants).toEqual(["a", "b", "c", "f", "g"]);
    // The extra seats get the plain plan probe, not "your crew".
    for (const id of ["f", "g"]) expect(w.to(id).filter(s => s.meta.type === "plan_probe").map(s => /crew/.test(s.body))).toEqual([false]);
    // The plan's ledger events: accepted and attended for all five (mutual check-in), confirmed by silence.
    expect(events.filter(e => e.type === "plan_accepted").length).toBe(5);
    expect(events.filter(e => e.type === "plan_attended" && e.planId === planId).length).toBe(5);
  });
});

// ---------------------------------------------------------------- audit 2026-10-08 (network)
describe("audit 2026-10-08: refusals, minors and reports (P0)", () => {
  test("NET-05: 'No. Saturday I'm at a wedding' never books, never reveals, and marks the pair declined", async () => {
    for (const refusal of ["No. Saturday I'm at a wedding", "Thursday? lol no", "absolutely not", "sure, but only with a woman"]) {
      const w = new Mini([climber("a", "Ana Diaz", { wants: [CLIMB_WANT] }), climber("b", "Ben Ito", { wants: [CLIMB_WANT] })]);
      await w.onboard("a", "b");
      w.propose(["a", "b"]);
      expect(await w.runUntil(() => w.probed("a"))).toBe(true);
      await w.say("a", "yes, any of them");
      expect(await w.runUntil(() => w.probed("b"))).toBe(true);
      const t = w.mark();
      await w.say("b", refusal);
      await w.run(2 * DAY);
      expect([refusal, w.meetings.length]).toEqual([refusal, 0]);
      expect(w.sent.slice(t).filter(s => s.meta.booked)).toEqual([]);
      expect(w.sent.slice(t).map(s => s.body).join(" ")).not.toMatch(/Ana|Ben/);
    }
  });

  test("NET-07: an explicit under-13 statement after a booked meeting keeps an id-only case on the adult that survives the delete", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito", { age: undefined })]);
    await w.onboard("a");
    for (const x of ["hi!", "25", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await w.say("b", x);
    await meet(w, "a", "b");
    await w.say("b", "I am 12 years old");
    expect(w.net.isDeclined("b")).toBe(true);
    expect(w.log("minor_after_contact").map(l => l.detail.members)).toEqual([["a"]]);
    const cases = w.net.safetyCases();
    const onA = cases.find(c => c.memberId === "a")!;
    expect(onA.events.map(e => e.kind)).toContain("contact_with_minor");
    expect(JSON.stringify(cases)).not.toMatch(/"b"|Ben/);
  });

  test("NET-08: on an 18+ app an under-age statement after a meeting opens the adult's case, and the member gets no teen copy", async () => {
    // Every app joins at 13 today (founder 2026-10-08); an app configured 18+ still must never send teen copy.
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { app: { ...APPS.slop, minJoinAge: 18 }, allowedCategories: ["hobby"] });
    await w.onboard("a", "b");
    await meet(w, "a", "b");
    const t = w.mark();
    await w.say("b", "I am 16 years old");
    expect(w.log("minor_after_contact").map(l => l.detail)).toEqual([{ memberId: "b", members: ["a"] }]);
    expect(w.net.safetyCases().find(c => c.memberId === "a")!.events.map(e => e.kind)).toContain("contact_with_minor");
    // NET-52: staff review, and no teen copy ("Since you're under 18 ...") on an 18+ app.
    expect(w.net.safetyCases().find(c => c.memberId === "b")!.events.map(e => e.kind)).toEqual(expect.arrayContaining(["minor_after_contact"]));
    expect(w.to("b", t).map(s => s.body).join(" ")).not.toMatch(/under 18/);
  });

  test("NET-09: reporters are never punished for what they report; the pair is blocked and a case opens on the target", async () => {
    for (const text of ["report Ben Ito, he asked me to venmo him $50", "block Ben Ito he keeps asking for my phone number", "report Ben Ito, he said I know where she lives"]) {
      const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
      await w.onboard("a", "b");
      await meet(w, "a", "b");
      await w.say("a", text);
      expect([text, w.net.trust.get("a").score, w.net.trust.level("a")]).toEqual([text, 0, "ok"]);
      expect(w.net.recipientPolicy("a", "reveal", { about: ["a", "b"] })).toEqual({ ok: false, reason: "blocked_pair" });
      if (text.startsWith("report")) expect(w.net.safetyCases().some(c => c.memberId === "b" && c.events.some(e => e.kind === "report_received"))).toBe(true);
    }
  });

  test("NET-11 / NET-31: one uncorroborated report opens a staff case (ids only); a stranger's report adds no points and claims nothing", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("s", "Sal Mora")]);
    await w.onboard("a", "b", "s");
    await meet(w, "a", "b");
    let t = w.mark();
    await w.say("a", "report Ben Ito, he was rude to me");
    const c = w.net.safetyCases().find(x => x.memberId === "b")!;
    expect(c.events.map(e => [e.kind, e.points, e.by])).toEqual([["report_received", 0, "a"]]);
    expect(JSON.stringify(w.log("report").map(l => l.detail))).not.toMatch(/rude/);
    expect(w.to("a", t).map(s => s.body)).toEqual([copy.reported]);
    t = w.mark();
    await w.say("s", "report Ben Ito");
    expect(w.net.trust.get("b").score).toBe(0);
    expect(w.to("s", t).map(s => s.body)).toEqual([copy.reportUnmatched]);
    expect(w.net.safetyCases().find(x => x.memberId === "b")!.events.filter(e => e.kind === "report_received").length).toBe(2);
  });

  test("NET-13: money words keep the request and never hold; no single message from a fresh member reaches hold", async () => {
    const w = new Mini([climber("r", "Rae Kim")]);
    await w.onboard("r");
    await w.say("r", "help moving a couch, I'll pay $50");
    expect(w.log("request").map(l => l.detail.desireId)).toEqual(["moving_help"]);
    expect(w.net.trust.level("r")).toBe("ok");
    const abuse = (await Bun.file(`${import.meta.dir}/fixtures/abuse.jsonl`).text()).trim().split("\n").map(l => JSON.parse(l).text as string);
    for (const text of abuse) {
      const x = new Mini([climber("x", "Xan Lee")]);
      await x.onboard("x");
      await x.say("x", text);
      expect([text, x.net.trust.level("x")]).not.toEqual([text, "hold"]);
    }
  });

  test("NET-15: 'report Ben, he's only 15' takes Ben out of matching, lists who he met, and does not touch the reporter", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito"), climber("c", "Cy Moss")]);
    await w.onboard("a", "b", "c");
    await meet(w, "a", "b");
    await w.say("c", "report Ben Ito, he's only 15");
    const ben = w.net.memberList().find(m => m.id === "b")!;
    expect(ben.minor).toBe(true);
    expect(w.net.eligible("b")).toBe(false);
    const cs = w.net.safetyCases().find(x => x.memberId === "b")!;
    expect(cs.events.filter(e => e.kind === "minor_after_contact").map(e => e.by)).toEqual(["a"]);
    expect(cs.events.some(e => e.kind === "minor_reported" && e.by === "c")).toBe(true);
    expect([w.net.trust.get("c").score, w.net.trust.level("c")]).toEqual([0, "ok"]);
  });

  test("NET-17: staff clear a minor signal only when the record and every stated age are adult, with an audit row", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("t", "Tam Ruiz", { age: 16 }), climber("s", "Sol Park")]);
    await w.onboard("a", "s");
    await w.say("a", "my mom says I have to be home by 10 on school nights");
    expect(w.net.memberList().find(m => m.id === "a")!.minor).toBe(true);
    expect(w.net.clearMinorSignal("a", "")).toEqual({ ok: false, reason: "actor_required" });
    expect(w.net.clearMinorSignal("a", "staff:jo", "she's a teacher")).toEqual({ ok: true });
    expect(w.net.memberList().find(m => m.id === "a")!.minor).toBe(false);
    expect(w.log("safety_action").at(-1)!.detail).toMatchObject({ action: "clear_minor_signal", memberId: "a", actor: "staff:jo" });
    await w.say("t", "hi!");
    expect(w.net.clearMinorSignal("t", "staff:jo")).toEqual({ ok: false, reason: "record_minor" });
    await w.say("s", "I'm 16 lol");
    expect(w.net.clearMinorSignal("s", "staff:jo")).toEqual({ ok: false, reason: "stated_minor" });
  });
});

describe("audit 2026-10-08: facets, negation, pair history, attendance (P1-P3)", () => {
  test("NET-18: a matchable skill is never quoted to the requester; a shareable one is", async () => {
    for (const shareable of [false, true]) {
      const w = new Mini([climber("r", "Rae Kim", { wants: [] }), climber("b", "Ben Ito", { skills: ["climbing_belay"], shareable })]);
      await w.onboard("r", "b");
      const t = w.mark();
      await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
      await w.run(DAY);
      const bodies = w.sent.slice(t).map(s => s.body).join(" ");
      expect([shareable, /experienced climber/.test(bodies)]).toEqual([shareable, shareable]);
    }
  });

  test("NET-22: a negated want starts no request and sends no probe", async () => {
    const w = new Mini([climber("r", "Rae Kim"), climber("b", "Ben Ito", { interests: ["startups"], wants: [{ objective: "meet other founders", category: "professional" }] })]);
    await w.onboard("r", "b");
    const t = w.mark();
    await w.say("r", "I don't want to meet other founders");
    await w.run(DAY);
    expect(w.log("request")).toEqual([]);
    expect(w.sent.slice(t).filter(s => s.meta.type === "probe")).toEqual([]);
  });

  test("NET-26 / NET-27: after a partner's no, the same partner is never probed again for that requester; a second requester no closes the request", async () => {
    const w = new Mini([climber("r", "Rae Kim", { wants: [] }), climber("b", "Ben Ito", { wants: [CLIMB_WANT] })]);
    await w.onboard("r", "b");
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    expect(await w.runUntil(() => w.probed("r") || w.probed("b"), 2 * DAY)).toBe(true);
    if (w.probed("r")) await w.say("r", "yes, any of them");
    expect(await w.runUntil(() => w.probed("b"), 2 * DAY)).toBe(true);
    await w.say("b", "no thanks");
    for (let d = 0; d < 30; d++) { await w.run(DAY); await w.say("r", "Still hoping to find a regular climbing partner."); }
    expect(w.to("b").filter(s => s.meta.type === "probe").length).toBe(1);
  });

  test("NET-40 / NET-39: a request is fulfilled only after the requester and the other attended; reveal decisions add up", async () => {
    const w = new Mini([climber("r", "Rae Kim", { wants: [] }), climber("b", "Ben Ito", { wants: [CLIMB_WANT] })]);
    await w.onboard("r", "b");
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    await w.answerProbes(["r", "b"], () => "yes, any of them");
    expect(w.meetings.length).toBe(1);
    expect(w.net.requests[0]!.outcome).toBe("booked");
    expect(w.net.counters.requestsFulfilled).toBe(0);
    await w.run(w.meetings[0]!.at + 4 * HOUR - w.clock.now());
    await w.say("r", "It was great, we really clicked. Would do it again.");
    await w.say("b", "It was great, easy to talk to.");
    await w.run(HOUR);
    expect(w.net.requests[0]!.outcome).toBe("fulfilled");
    expect(w.net.counters.requestsFulfilled).toBe(1);
    const k = w.net.counters;
    expect(k.revealYes + k.revealNo + k.revealExpired).toBe(k.reveals);
  });

  test("NET-47: blocking a never-met member and a name that matches nobody give the same reply; 'report back when ...' is not a report", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("g", "Grace Hu")]);
    await w.onboard("a", "g");
    let t = w.mark();
    await w.say("a", "block Grace Hu");
    const one = w.to("a", t).map(s => s.body);
    await w.run(20 * MINUTE); // past the duplicate-text window
    t = w.mark();
    await w.say("a", "block Nobody Atall");
    expect(w.to("a", t).map(s => s.body)).toEqual(one);
    await w.say("a", "report back when Grace is free");
    expect(w.log("report")).toEqual([]);
  });

  test("NET-48: probes never carry another participant's name, even a two-letter one", async () => {
    const w = new Mini([climber("a", "Bo Li", { wants: [CLIMB_WANT] }), climber("b", "Al Wu", { wants: [CLIMB_WANT] })]);
    await w.onboard("a", "b");
    w.propose(["a", "b"], { objective: "climb with Bo and Al" });
    await w.answerProbes(["a", "b"], () => "yes, any of them");
    for (const s of w.sent.filter(s => s.meta.type === "probe")) {
      const other = s.to === "a" ? ["al", "wu"] : ["bo", "li"];
      expect(other.filter(n => new RegExp(`\\b${n}\\b`, "i").test(s.body))).toEqual([]);
    }
  });

  test("NET-50: one 'he never showed' penalizes nobody until the other is asked and silent; 'didn't show me her art' is not a no-show", async () => {
    expect(feedbackOfText("didn't show me her art but it was great")).toMatchObject({ otherNoShow: false, sentiment: "positive" });
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    const at = await meet(w, "a", "b");
    await w.run(at + 4 * HOUR - w.clock.now());
    await w.say("a", "he never showed up");
    expect(w.net.memberList().find(m => m.id === "b")!.noShows).toBe(0);
    await w.run(5 * DAY);
    expect(w.net.memberList().find(m => m.id === "b")!.noShows).toBe(1);
  });

  test("NET-51: a block after booking sends the other member one neutral cancellation", async () => {
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")]);
    await w.onboard("a", "b");
    await meet(w, "a", "b");
    const t = w.mark();
    await w.say("a", "block Ben Ito");
    const toB = w.to("b", t);
    expect(toB.length).toBe(1);
    expect(toB[0]!.body).not.toMatch(/block|Ana/i);
    expect(w.log("meeting_cancelled").length).toBe(1);
  });

  test("NET-60: a member on watch gets one honest reply to a request and nobody is probed", async () => {
    const w = new Mini([climber("r", "Rae Kim"), climber("b", "Ben Ito", { wants: [CLIMB_WANT] })]);
    await w.onboard("r", "b");
    w.net.trust.add("r", w.clock.now(), "sales_spam", 3);
    const t = w.mark();
    await w.say("r", "Anyone around who'd want to find a regular climbing partner?");
    await w.run(DAY);
    expect(w.to("r", t).map(s => s.body)).toEqual([copy.requestOnWatch]);
    expect(w.sent.slice(t).filter(s => s.meta.type === "probe")).toEqual([]);
  });

  test("NET-66: an agent-started send about an unknown opportunity is refused", async () => {
    const w = new Mini([climber("a", "Ana Diaz")]);
    await w.onboard("a");
    const policy = blooioRecipientPolicy(w.net, () => "a");
    expect(policy("+15550100001", { kind: "transactional", briefId: "nw-gone", agentInitiated: true })).toEqual({ ok: false, reason: "unknown_brief" });
    expect(policy("+15550100001", { kind: "reply", agentInitiated: false })).toEqual({ ok: true });
  });

  test("NET-44: exposure debt survives a restart and goes back to the engine", async () => {
    const w = new Mini([climber("a", "Ana Diaz")]);
    const st = w.net.exportState();
    st.exposureDebt = { a: 2 };
    w.net.importState(st);
    w.restart();
    expect(w.net.engineInput(w.clock.now()).exposureDebt).toEqual({ a: 2 });
  });
});

describe("audit 2026-10-08: app category scope and romance (matching-e2e-2, -M2)", () => {
  test("NET-24: a Network for an app never starts an opportunity outside its categories (property over 60 random proposals)", async () => {
    const cats = ["social", "professional", "romance", "hobby", "help", "events", "growth"] as const;
    for (const app of ["peon", "slop"] as const) {
      const w = new Mini(["a", "b", "c", "d"].map(id => climber(id, `${id.toUpperCase()}x Y${id}`)), { app, allowedCategories: undefined });
      await w.onboard("a", "b", "c", "d");
      const allowed = new Set(w.net.allowedCategories);
      let seed = 7;
      for (let i = 0; i < 30; i++) { seed = (seed * 48271) % 2147483647; w.propose(i % 2 ? ["a", "b"] : ["c", "d"], { category: cats[seed % cats.length]! }); }
      await w.run(2 * DAY);
      for (const l of w.log("probe_started")) expect([app, allowed.has((l.detail.proposal as { category: never }).category)]).toEqual([app, true]);
      for (const l of w.log("review_queued")) expect([app, allowed.has((l.detail.proposal as { category: never }).category)]).toEqual([app, true]);
    }
  });

  test("NET-25: the judge is on only when an engine LLM is wired, and the config says so", () => {
    const off = new Mini([]).net.effectiveEngineConfig();
    expect(off.judge?.enabled).toBe(false);
    const on = new Mini([], { engineLLM: { chat: async () => "{}" } }).net.effectiveEngineConfig();
    expect(on.judge?.enabled).toBe(true);
  });

  test("NET-23: on slop, two opted-in adults with matching stated preferences are probed; a mismatch or a non-opted member never is", async () => {
    const date = { objective: "meet someone to date", category: "romance" as const };
    const w = new Mini([
      climber("a", "Ana Diaz", { wants: [date], romance: { is: "woman", seeks: ["man"] } }),
      climber("b", "Ben Ito", { wants: [date], romance: { is: "man", seeks: ["woman"] } }),
      climber("c", "Cy Moss", { wants: [date], romance: { is: "man", seeks: ["man"] } }),
      climber("d", "Dee Park", { wants: [date] }),
    ], { app: "slop", maxNewPerDay: 5 });
    await w.onboard("a", "b", "c", "d");
    await w.run(2 * DAY);
    const started = w.log("probe_started").map(l => (l.detail.proposal as { participants: string[]; category: string }));
    expect(started.some(p => p.category === "romance" && [...p.participants].sort().join() === "a,b")).toBe(true);
    for (const p of started) { expect(p.participants).not.toContain("d"); expect(p.participants.length).toBe(2); }
    expect(started.some(p => p.participants.includes("c") && p.participants.includes("a"))).toBe(false);
  });
});
