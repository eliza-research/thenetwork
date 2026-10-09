// Replies to everything an active adult says (intents.ts, asks.ts): every new kind gets one short,
// honest reply; settings by text (pause, quiet hours, cadence) change what the engine and the send
// path read; what the agent knows never includes ratings, appearance, trust or safety facts;
// corrections change slop's tags; invites never claim a link; info questions never name a venue;
// the empty-state note and "Was that worth a text?" follow their limits. ConsentNetwork with a
// MemoryStore (every unit is exported and imported again) and a small hand-made snapshot.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, SimClock, type Facet, type Intent, type Member, type NetworkContext, type SimMeta, type WorldSnapshot } from "@thenetwork/core";
import { eventOf } from "../../observatory/src/events.ts";
import { appWiring } from "../service/packs.ts";
import { classify } from "../src/classify.ts";
import { styleViolations } from "../src/copy.ts";
import { VENUES } from "../src/geo.ts";
import { MemberTextReplies, pauseEnd, withOwnSettings, type TextsHost, type TextsMember } from "../src/intents.ts";
import { ConsentNetwork, type NetworkOptions } from "../src/network.ts";
import { MemoryStore, runStored, runTick } from "../src/store.ts";
import { copy, copyFor, brandOf } from "../src/copy.ts";
import { APPS } from "../../platform/src/apps.ts";

const T = 120_000;
/** Tuesday 6 October 2026, 12:00 New York (EDT). */
const START = Date.UTC(2026, 9, 6, 16);

interface Out { to: string; body: string; meta?: SimMeta; at: number }

function world(o: { app?: "ntwrk" | "slop"; members: { id: string; name: string; age?: number }[]; facets?: Facet[]; intents?: Intent[]; net?: NetworkOptions; invite?: boolean }) {
  const clock = new SimClock(START);
  const out: Out[] = [];
  const logs: { type: string; detail: Record<string, unknown> }[] = [];
  const app = o.app ?? "ntwrk";
  const members: Member[] = o.members.map(m => ({
    id: m.id, name: m.name, homeCity: "nyc", state: "normal", joinedAt: START - 30 * DAY, age: m.age ?? 30, unansweredProactive: 0,
    prefs: { categoriesOptIn: app === "slop" ? ["romance"] : ["social", "hobby"], quietHours: [21, 9], romanceOptIn: app === "slop", formats: ["one_to_one", "small_group"], maxTravelMinutes: 45, onlyWhenAsked: false },
  }));
  const facets = o.facets ?? [];
  const intents = o.intents ?? [];
  const snapshot = (): WorldSnapshot => ({ now: clock.now(), members, facets, intents, presence: [], edges: [], recentProposals: [] });
  const ctx: NetworkContext = {
    clock,
    send: (memberId, body, opts) => { out.push({ to: memberId, body, meta: opts?.meta, at: clock.now() }); return { id: `o${out.length}`, ts: clock.now(), direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: "delivered", meta: opts?.meta }; },
    snapshot,
    recordProposal: () => {},
    recordMeeting: m => m.proposalId,
    recordBlock: () => {},
    log: (type, detail) => { logs.push({ type, detail }); },
    ...(o.invite ? { invite: () => undefined } : {}),
  };
  const w = app === "slop" ? appWiring("slop") : undefined;
  const store = new MemoryStore();
  const net = new ConsentNetwork({
    app, seed: 7, review: "human", store,
    ...(w ? { pack: w.pack, hooks: w.hooks, engine: w.engine, plans: false } : {}),
    ...o.net,
  });
  net.init(ctx);
  let n = 0;
  /** One inbound message as a stored unit; returns what the Network sent to that member in it. */
  const say = async (id: string, body: string) => {
    const before = out.length;
    await runStored(net, store, x => x.onInbound({ id: `in${++n}`, memberId: id, body, ts: clock.now(), channel: "imessage" }));
    clock.advance(20 * 60_000);
    return out.slice(before).filter(x => x.to === id);
  };
  const tick = async () => { await runTick(net, store, clock.now()); };
  const member = (id: string) => net.memberList().find(m => m.id === id)!;
  /** First message, three onboarding answers: the member is active. */
  const onboard = async (id: string, answers = ["I'm into jazz and rock music", "Weekends mostly, I live in Williamsburg", "Small groups"]) => {
    await say(id, "hi");
    for (const a of answers) await say(id, a);
    expect(member(id).stage).toBe("active");
  };
  return { clock, out, logs, net, store, say, tick, member, onboard, members, facets, intents };
}

const reply = (xs: Out[]) => { expect(xs.length).toBe(1); return xs[0]!.body; };

describe("classify: the member's asks about the agent", () => {
  test("each kind is read, and older kinds keep their precedence", () => {
    const k = (s: string) => classify(s).kind;
    expect(k("how does this work?")).toBe("help");
    expect(k("what do you know about me?")).toBe("know_me");
    expect(k("women 25-30 actually")).toBe("correct");
    expect(k("pause until November")).toBe("pause");
    expect(k("I'm slammed until November")).toBe("pause");
    expect(k("pause for two weeks")).toBe("pause");
    expect(k("resume")).toBe("resume");
    expect(k("not after 9pm")).toBe("quiet_hours");
    expect(k("only text me when I ask")).toBe("only_when_asked");
    expect(k("surprise me")).toBe("more_often");
    expect(k("text me less please")).toBe("less_often");
    expect(k("what are you looking for for me?")).toBe("list_intents");
    expect(k("stop looking for a climbing partner")).toBe("close_intent");
    expect(k("anyone know a good climbing gym near Dolores?")).toBe("info_question");
    expect(k("can I export my data")).toBe("export_request");
    expect(k("delete my data")).toBe("delete_request");
    // Older kinds win, and a request for a person stays one.
    expect(k("block Sam")).toBe("block");
    expect(k("I'm looking for a climbing partner")).toBe("people_request");
    expect(k("can't make it, something came up")).toBe("cancel");
    expect(k("I'm busy this week")).not.toBe("pause");
  });
});

describe("ConsentNetwork: every text from an active adult gets a reply", () => {
  test("each new kind gets one short reply that passes the style rules", async () => {
    const w = world({ members: [{ id: "a", name: "Ana Diaz" }] });
    await w.onboard("a");
    const texts = [
      "how does this work?", "what do you know about me?", "actually I'm into climbing", "not after 9pm", "what are you looking for for me?",
      "I'm looking for a climbing partner", "stop looking for a climbing partner", "anyone know a good climbing gym near Dolores?",
      "can I export my data?", "delete my data", "only text me when I ask", "resume", "surprise me", "text me less please",
      "pause for two weeks", "resume", "blah blah something unclear here",
    ];
    for (const t of texts) {
      const r = await w.say("a", t);
      expect(r.length).toBeGreaterThanOrEqual(1);
      for (const x of r) expect(styleViolations(x.body)).toEqual([]);
    }
    // A bare "thanks" gets nothing (a reply to an acknowledgement is noise).
    expect(await w.say("a", "thanks")).toEqual([]);
  }, T);

  test("pause until a date stops proactive sends until then; the pause ends by itself; resume restores", async () => {
    const w = world({ members: [{ id: "a", name: "Ana Diaz" }] });
    await w.onboard("a");
    expect(w.net.eligible("a")).toBe(true);
    const r = reply(await w.say("a", "pause until November 3"));
    expect(r).toMatch(/November 3/);
    expect(w.member("a").state).toBe("paused");
    expect(w.net.eligible("a")).toBe(false);
    expect(w.net.engineInput(w.clock.now()).members.find(m => m.id === "a")!.state).toBe("paused");
    // A worth-a-text that falls due while paused is never asked.
    w.member("a").texts = { ...w.member("a").texts, worth: [{ oppId: "o-1", due: w.clock.now() }] };
    await w.store.save(w.net.exportState());
    const before = w.out.length;
    for (let d = 0; d < 20; d++) { w.clock.advance(DAY); await w.tick(); }
    expect(w.out.slice(before).filter(x => /worth a text/i.test(x.body))).toEqual([]);
    // Still paused on November 2; back to normal on November 3.
    w.clock.set(Date.UTC(2026, 10, 2, 16)); await w.tick();
    expect(w.member("a").state).toBe("paused");
    w.clock.set(Date.UTC(2026, 10, 3, 16)); await w.tick();
    expect(w.member("a").state).toBe("normal");
    expect(w.net.eligible("a")).toBe(true);
    // "pause" with no end lasts until "resume".
    reply(await w.say("a", "pause please"));
    w.clock.advance(40 * DAY); await w.tick();
    expect(w.member("a").state).toBe("paused");
    expect(reply(await w.say("a", "resume"))).toMatch(/Welcome back/);
    expect(w.member("a").state).toBe("normal");
    expect(w.net.eligible("a")).toBe(true);
  }, T);

  test("quiet hours by text: the member's hours change, the engine reads them, and asks wait for them", async () => {
    const w = world({ members: [{ id: "a", name: "Ana Diaz" }] });
    await w.onboard("a");
    expect(reply(await w.say("a", "please no texts after 8pm"))).toMatch(/8pm and 9am/);
    expect(w.member("a").quietHours).toEqual([20, 9]);
    expect(w.net.engineInput(w.clock.now()).members.find(m => m.id === "a")!.prefs.quietHours).toEqual([20, 9]);
    expect(reply(await w.say("a", "and not before 11am"))).toMatch(/8pm and 11am/);
    expect(w.member("a").quietHours).toEqual([20, 11]);
    // A due "Was that worth a text?" is not asked at 8:30pm New York.
    w.member("a").texts = { ...w.member("a").texts, worth: [{ oppId: "o-9", due: w.clock.now() }] };
    await w.store.save(w.net.exportState());
    w.clock.set(Date.UTC(2026, 9, 8, 0, 30)); // 20:30 New York
    const before = w.out.length;
    await w.tick();
    expect(w.out.slice(before)).toEqual([]);
    // The member record changed on the settings page: the record wins again.
    w.members[0]!.prefs.quietHours = [22, 8];
    w.clock.advance(HOUR); await w.tick();
    expect(w.member("a").quietHours).toEqual([22, 8]);
  }, T);

  test("only when I ask stays until the member says resume; more and less often set the state", async () => {
    const w = world({ members: [{ id: "a", name: "Ana Diaz" }] });
    await w.onboard("a");
    reply(await w.say("a", "only text me when I ask"));
    await w.say("a", "what do you know about me?");
    expect(w.member("a").onlyWhenAsked).toBe(true);
    expect(w.net.eligible("a")).toBe(false);
    reply(await w.say("a", "resume"));
    expect(w.member("a").onlyWhenAsked).toBe(false);
    reply(await w.say("a", "text me less"));
    expect(w.member("a").state).toBe("quiet");
    reply(await w.say("a", "surprise me"));
    expect(w.member("a").state).toBe("open");
  }, T);

  test("what you know: you told me vs your profile, never a rating, appearance, trust or safety fact", async () => {
    const f = (id: string, tags: string[], value: string, scope: Facet["scope"], kind: Facet["kind"] = "fact"): Facet =>
      ({ id, memberId: "s", kind, value, tags, scope, provenance: "said", confidence: 0.9 });
    const w = world({
      app: "slop", members: [{ id: "s", name: "Sam Lee", age: 31 }],
      facets: [
        f("s:photo:p1", ["slop:rating:face=7", "slop:rating:body=6"], "photo rating", "agent_private", "trait"),
        f("s:safe", ["safety:scam_pattern"], "scam pattern", "agent_private"),
        f("s:verify:age", ["verify:age:pass"], "age check passed", "agent_private"),
        f("s:look", ["appearance:body_type=athletic"], "athletic", "agent_private", "trait"),
        f("s:join:jazz", ["jazz"], "jazz", "matchable", "interest"),
      ],
    });
    await w.onboard("s", ["I'm into hiking", "Weekends", "One on one"]);
    await w.say("s", "actually I'm a woman looking for men, 28-36, within 5 miles");
    const r = reply(await w.say("s", "what do you know about me?"));
    expect(r).toMatch(/You told me/);
    expect(r).toMatch(/From your profile: jazz/);
    expect(r).toMatch(/a woman looking to meet men/);
    expect(r).toMatch(/ages 28 to 36/);
    expect(r).not.toMatch(/rating|face|body|scam|safety|verif|athletic|appearance|photo/i);
    expect(styleViolations(r)).toEqual([]);
  }, T);

  test("a correction changes slop's tags (and says so); a later one replaces them", async () => {
    const w = world({ app: "slop", members: [{ id: "s", name: "Sam Lee", age: 31 }] });
    await w.onboard("s", ["I'm a man into women", "Weekends", "One on one"]);
    const tags = () => (w.member("s").appTags ?? []).map(t => t.tag).sort();
    expect(tags()).toContain("romance:seeks:woman");
    const r = reply(await w.say("s", "women 25-30 actually"));
    expect(r).toMatch(/updated/i);
    expect(tags()).toContain("romance:age:25-30");
    reply(await w.say("s", "actually men and women, 30-40"));
    expect(tags()).toContain("romance:seeks:man");
    expect(tags()).toContain("romance:seeks:woman");
    expect(tags()).toContain("romance:age:30-40");
    expect(tags()).not.toContain("romance:age:25-30");
    expect(reply(await w.say("s", "actually that's wrong"))).toMatch(/couldn't tell what to change/);
  }, T);

  test("invites never claim a link that does not exist", async () => {
    const n = world({ members: [{ id: "a", name: "Ana Diaz" }] });
    await n.onboard("a");
    const r1 = reply(await n.say("a", "My friend Maya would love this, can I invite her?"));
    expect(r1).toMatch(/Invites aren't open yet/);
    expect(r1).not.toMatch(/link/i);
    const s = world({ app: "slop", members: [{ id: "s", name: "Sam Lee" }] });
    await s.onboard("s", ["I'm a man into women", "Weekends", "One on one"]);
    const r2 = reply(await s.say("s", "My friend Maya should join, can I invite her?"));
    expect(r2).toMatch(/can't send invite links yet/);
    expect(r2).toMatch(/slop\.date/);
    // The copy for an open app's growth ask says how a friend joins; no text promises a link.
    expect(copyFor(brandOf(APPS.slop)).growthJoinHow("slop", "slop.date")).not.toMatch(/link/);
    // A request that finds nobody: no invite promised either.
    const r3 = await n.say("a", "I'm looking for a climbing partner");
    for (const x of r3) expect(x.body).not.toMatch(/send you an invite|invite link/);
    // With member invites (the simulator's world), the old flow is unchanged.
    const v = world({ members: [{ id: "a", name: "Ana Diaz" }], invite: true });
    await v.onboard("a");
    expect(reply(await v.say("a", "My friend Maya would love this, can I invite her?"))).toBe(copy.inviteSent("Maya"));
  }, T);

  test("an info question gets an honest answer and never a venue", async () => {
    const w = world({ members: [{ id: "a", name: "Ana Diaz" }] });
    await w.onboard("a");
    for (const q of ["anyone know a good climbing gym near Dolores?", "where can I find a good bakery around here?", "can you recommend a good dentist?"]) {
      const r = reply(await w.say("a", q));
      expect(r).toMatch(/can't look things like that up/);
      for (const v of VENUES) expect(r).not.toContain(v.name);
    }
  }, T);

  test("data requests point to the settings page; nothing is deleted by text", async () => {
    const w = world({ app: "slop", members: [{ id: "s", name: "Sam Lee" }] });
    await w.onboard("s", ["I'm a man into women", "Weekends", "One on one"]);
    expect(reply(await w.say("s", "export my data"))).toMatch(/slop\.date\/settings/);
    expect(reply(await w.say("s", "please delete my account"))).toMatch(/slop\.date\/settings/);
    expect(w.member("s")).toBeDefined();
    expect(w.net.isDeclined("s")).toBe(false);
  }, T);

  test("open asks are listed, closed by name, and a learned want is reconfirmed once before it lapses", async () => {
    const w = world({ members: [{ id: "a", name: "Ana Diaz" }], net: { matchingEnabled: false } });
    await w.onboard("a");
    await w.say("a", "I'm looking for a climbing partner");
    expect(reply(await w.say("a", "what are you looking for for me?"))).toMatch(/climbing partner/);
    expect(reply(await w.say("a", "stop looking for a climbing partner"))).toMatch(/stopped looking for a regular climbing partner/);
    expect(reply(await w.say("a", "what am I waiting on?"))).toMatch(/don't have anything open/);
    // A want said 54 days ago: one reconfirm in the send window, never a second for the same statement.
    const m = w.member("a");
    m.learned.desires.set("learn_sailing", w.clock.now() - 54 * DAY);
    await w.store.save(w.net.exportState());
    // The last word is the member's (an interruption waits for it: the Blooio streak).
    expect(await w.say("a", "thanks")).toEqual([]);
    w.clock.set(Date.UTC(2026, 9, 9, 16)); // Friday 12:00 New York
    const before = w.out.length;
    for (let h = 0; h < 48; h++) { await w.tick(); w.clock.advance(HOUR); }
    const asks = w.out.slice(before).filter(x => /Still want me to look for learning to sail/.test(x.body));
    expect(asks.length).toBe(1);
    expect(reply(await w.say("a", "yes"))).toMatch(/keep looking/);
    expect(w.clock.now() - w.member("a").learned.desires.get("learn_sailing")!).toBeLessThan(HOUR);
  }, T);
});

describe("empty states (33.10)", () => {
  test("an adult whose want found nothing for 10+ days hears it once in 30 days", async () => {
    const intents: Intent[] = [{ id: "a:want", memberId: "a", objective: "find a regular climbing partner", category: "hobby", horizonDays: 60, status: "active", createdAt: START - 12 * DAY }];
    const w = world({ members: [{ id: "a", name: "Ana Diaz" }], intents, net: { matchingEnabled: true } });
    await w.onboard("a");
    const notes = () => w.out.filter(x => x.to === "a" && /nothing fits what you asked for yet/.test(x.body));
    for (let h = 0; h < 4 * 24; h++) { await w.tick(); w.clock.advance(HOUR); }
    expect(notes().length).toBe(1);
    expect(notes()[0]!.body).toMatch(/One thing that could help/);
    expect(styleViolations(notes()[0]!.body)).toEqual([]);
  }, T);

  test("never to a minor, never twice in 30 days, never a private reason", () => {
    const sent: string[] = [];
    let now = START;
    const adult: TextsMember = { id: "a", first: "Ana", minor: false, minorSignal: false, stage: "active", state: "normal", quietHours: [21, 9], onlyWhenAsked: false, optedOut: false, learned: { interests: new Set(), skills: new Set(), desires: new Map() } };
    const minor: TextsMember = { ...adult, id: "k", first: "Kai", minor: true, learned: { interests: new Set(), skills: new Set(), desires: new Map() } };
    const host = fakeHost([adult, minor], (m, body) => { sent.push(`${m.id}:${body}`); }, () => now);
    const t = new MemberTextReplies(host);
    t.emptyStates([{ memberId: "a", reason: "appearance_band" }, { memberId: "k", reason: "no_candidates" }], now);
    expect(sent).toEqual([]);
    t.emptyStates([{ memberId: "a", reason: "filtered:age_range" }, { memberId: "k", reason: "no_candidates" }], now);
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatch(/^a:.*age range/);
    now += 20 * DAY;
    t.emptyStates([{ memberId: "a", reason: "no_candidates" }], now);
    expect(sent.length).toBe(1);
    now += 11 * DAY;
    t.emptyStates([{ memberId: "a", reason: "no_candidates" }], now);
    expect(sent.length).toBe(2);
  });
});

describe("Was that worth a text? (F19)", () => {
  test("sampled, asked once a day later, stored as a worth_a_text event", () => {
    const sent: { id: string; body: string }[] = [];
    const logs: { type: string; detail: Record<string, unknown> }[] = [];
    let now = START;
    const m: TextsMember = { id: "a", first: "Ana", minor: false, minorSignal: false, stage: "active", state: "normal", quietHours: [21, 9], onlyWhenAsked: false, optedOut: false, learned: { interests: new Set(), skills: new Set(), desires: new Map() } };
    const host = { ...fakeHost([m], (x, body) => { sent.push({ id: x.id, body }); }, () => now), worthSample: 1, log: (type: string, detail: Record<string, unknown>) => { logs.push({ type, detail }); } };
    const t = new MemberTextReplies(host);
    t.probeAnswered(m, "opp-1");
    t.probeAnswered(m, "opp-1");
    expect(m.texts!.worth!.length).toBe(1);
    t.tick(now + HOUR);
    expect(sent).toEqual([]);
    now += DAY + HOUR;
    t.tick(now); t.tick(now + HOUR);
    expect(sent.filter(x => x.body === copy.worthAsk).length).toBe(1);
    t.handle(m, classify("yes"), "yes");
    const ev = logs.find(l => l.type === "worth_a_text")!;
    expect(ev.detail).toMatchObject({ opportunityId: "opp-1", worth: true, memberId: "a" });
    // The event row the console and ops-monitoring read.
    const row = eventOf({ t: now, type: "network_log", kind: "worth_a_text", detail: ev.detail } as never)!;
    expect(row.type).toBe("worth_a_text");
    expect(row.payload).toMatchObject({ opportunityId: "opp-1", worth: true });
    // Never asked twice for one opportunity.
    t.probeAnswered(m, "opp-1");
    now += 3 * DAY; t.tick(now);
    expect(sent.filter(x => x.body === copy.worthAsk).length).toBe(1);
    // Never for a minor or a paused member.
    const k: TextsMember = { ...m, id: "k", minor: true, texts: undefined };
    t.probeAnswered(k, "opp-2");
    expect(k.texts).toBeUndefined();
    const p: TextsMember = { ...m, id: "p", state: "paused", texts: { worth: [{ oppId: "opp-3", due: now - HOUR }] } };
    const t2 = new MemberTextReplies({ ...host, members: () => [p] });
    t2.tick(now);
    expect(sent.filter(x => x.id === "p")).toEqual([]);
  });

  test("the default sample is about one in five, stable per opportunity and member", () => {
    const m: TextsMember = { id: "a", first: "Ana", minor: false, minorSignal: false, stage: "active", state: "normal", quietHours: [21, 9], onlyWhenAsked: false, optedOut: false, learned: { interests: new Set(), skills: new Set(), desires: new Map() } };
    const t = new MemberTextReplies({ ...fakeHost([m], () => {}, () => START), worthSample: 0.2 });
    for (let i = 0; i < 2000; i++) t.probeAnswered(m, `opp-${i}`);
    // worth keeps the last 20; count the draws instead.
    let hits = 0;
    for (let i = 0; i < 2000; i++) { const x: TextsMember = { ...m, texts: undefined }; t.probeAnswered(x, `opp-${i}`); if (x.texts?.worth?.length) hits++; }
    expect(hits / 2000).toBeGreaterThan(0.15);
    expect(hits / 2000).toBeLessThan(0.25);
  });
});

describe("settings helpers", () => {
  test("pause ends: a date at least a day away, 9-10am New York", () => {
    const now = START;
    expect(new Date(pauseEnd({ month: 11 }, now)!).toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(new Date(pauseEnd({ days: 14 }, now)!).toISOString()).toBe("2026-10-20T14:00:00.000Z");
    expect(new Date(pauseEnd({ month: 10, day: 1 }, now)!).toISOString()).toBe("2027-10-01T14:00:00.000Z");
    expect(new Date(pauseEnd({ weekday: 0 }, now)!).toISOString()).toBe("2026-10-12T14:00:00.000Z");
  });

  test("the record wins once it says the same or something new", () => {
    const m = { texts: { own: { state: "paused" as const, baseState: "normal" } } } as unknown as TextsMember;
    expect(withOwnSettings(m, { state: "normal" }, START).state).toBe("paused");
    expect(withOwnSettings(m, { state: "paused" }, START).state).toBe("paused");
    expect(m.texts!.own!.state).toBeUndefined();
    const m2 = { texts: { own: { state: "paused" as const, baseState: "normal" } } } as unknown as TextsMember;
    expect(withOwnSettings(m2, { state: "quiet" }, START).state).toBe("quiet");
  });
});

function fakeHost(members: TextsMember[], send: (m: TextsMember, body: string) => void, now: () => number): TextsHost {
  return {
    app: APPS.ntwrk, copy, allowedCategories: new Set(["social", "hobby"]), seed: 1, desireDays: 60, worthSample: 0.2,
    now, log: () => {}, send: (m, body) => { send(m, body); return "sent"; }, ack: () => {},
    members: () => members, requests: () => [], learn: () => {}, record: () => undefined, profileFacets: () => [],
    slotOpen: () => true, invitesOpen: () => false, dirty: () => {},
  };
}
