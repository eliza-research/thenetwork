// Regression tests for the 2026-10 engine review (synthetic v1 dataset findings): romance path,
// risk-term false positives, presence-aware retrieval, warm-path intermediaries, event and
// second-encounter generators end to end, late group acceptances, bundled unanswered messages.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { resolveConfig } from "../src/config.ts";
import { runEngine } from "../src/engine.ts";
import { candidateReason, riskTerms } from "../src/filters.ts";
import { complementaryIntents, intentToCapability, sharedIntentPooling, warmPath, type GenCtx } from "../src/generators.ts";
import { createOpportunity, dispatchInvites, respond, transition } from "../src/opportunity.ts";
import { unansweredStreak, type OutboundMessage } from "../src/outreach.ts";
import { Rng } from "../src/rng.ts";
import type { EngineInput } from "../src/types.ts";
import { baseMember, cand, emptyInput, facet, intent, mkWorld, NOW } from "./helpers.ts";

const ctx = (inp: EngineInput): GenCtx => ({ w: mkWorld(inp), memberExclusions: {}, rng: new Rng(1), unmatchedIntents: new Set() });
function people(ids: string[], f: (inp: EngineInput) => void = () => {}, city: "sf" | "nyc" = "sf"): EngineInput {
  const inp = emptyInput(NOW);
  for (const id of ids) { inp.members.push(baseMember(id, { homeCity: city })); inp.presence.push({ memberId: id, city, type: "home", areas: ["mission"] }); }
  f(inp);
  return inp;
}
const knows = (from: string, to: string, strength = 0.7) => ({ from, to, type: "knows" as const, strength, explicit: true, createdAt: NOW - 30 * DAY });

describe("risk terms: word boundaries and context (was: 404 synthetic candidates rejected)", () => {
  const cfg = resolveConfig({});
  const benign = [
    "I want to meet nearby parents with young kids who are also looking for a low-pressure coffee",
    "a slow walk after the kids are asleep", "fit dates around young kids", "before the kids' routine takes over",
    "I can help structure a simple, kid-friendly group meetup", "I can lend a hand with a small furniture move",
    "I can loan a small drum pad for one short practice", "a minor repair to my bike", "skid row walking tour",
    "parents of young children in the neighborhood", "a cashew-heavy cooking class", "therapist-approved breathing walk", // compounds
  ];
  const risky = [
    "help with childcare for my kids", "home_hosted dinner", "can someone babysit my kids friday", "quick childcare swaps",
    "short playdates or errand swaps", "I can read a short fiction chapter for little kids", "need someone to watch my kids saturday",
    "pick up the kids from school", "drive my teen to practice", "can you lend me some money", "lend me $200 until payday",
    "selling weed", "free medical advice", "tutoring for teens", "a meetup for anyone under 16", "minors welcome", "custody handoff",
  ];
  for (const t of benign) test(`benign: ${t}`, () => expect(riskTerms(cfg, t)).toEqual([]));
  for (const t of risky) test(`risky: ${t}`, () => expect(riskTerms(cfg, t).length).toBeGreaterThan(0));

  test("candidateReason: parents-with-kids intro passes, babysitting ask is high_risk", () => {
    const w = mkWorld(people(["a", "b"]));
    expect(candidateReason(w, cand(["a", "b"], { riskText: "meet other parents with young kids for park walks" }))).toBeNull();
    expect(candidateReason(w, cand(["a", "b"], { riskText: "looking for someone to babysit on Fridays" }))).toBe("high_risk");
  });

  test("structured risk flags (event riskTags) are high-risk whatever the words", () => {
    const w = mkWorld(people(["a", "b"]));
    expect(candidateReason(w, cand(["a", "b"], { riskText: "rooftop gathering", riskFlags: ["alcohol"] }))).toBe("high_risk");
  });

  test("group risk text covers only the group's own members (not every similar intent)", () => {
    const ids = ["t1", "t2", "t3", "t4"];
    const inp = people([...ids, "far"], i => {
      for (const id of [...ids, "far"]) {
        i.facets.push(facet(id, 0, "interest", "playing tennis on weekends", ["tennis"]));
        i.intents.push(intent(id, "play doubles tennis with a group on weekends", "hobby", { id: `${id}-i` }));
      }
      // "far" has a similar intent mentioning childcare but lives in NYC, so is never in the group.
      i.intents[4]!.details = "and swap childcare after";
      i.members[4]!.homeCity = "nyc";
      i.presence[4] = { memberId: "far", city: "nyc", type: "home", areas: ["les"] };
    });
    const groups = sharedIntentPooling(ctx(inp)).filter(c => c.kind === "group");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.participants).not.toContain("far");
      expect(g.riskText).not.toContain("childcare");
    }
  });
});

describe("romance (was: 0 proposals from 160 intents / 207 opted-in adults)", () => {
  const optIn = (inp: EngineInput, id: string, is: string, seeks: string, age = "25-45") => {
    const m = inp.members.find(x => x.id === id)!;
    m.prefs.romanceOptIn = true; m.prefs.categoriesOptIn.push("romance");
    inp.facets.push(facet(id, 9, "preference", `open to dating ${seeks}`, [`romance:is:${is}`, `romance:seeks:${seeks}`, `romance:age:${age}`], "agent_private"));
  };
  const world = (f: (i: EngineInput) => void = () => {}) => people(["a", "b", "c"], i => {
    for (const id of ["a", "b", "c"]) i.facets.push(facet(id, 0, "interest", "live jazz, natural wine and slow evening walks", ["music"]));
    optIn(i, "a", "woman", "man");
    optIn(i, "b", "man", "woman");
    i.intents.push(intent("a", "meet someone to date who loves live jazz and slow evening walks", "romance"));
    f(i);
  });
  const pairs = (inp: EngineInput) => complementaryIntents(ctx(inp)).filter(c => c.category === "romance").map(c => [...c.participants].sort().join(","));

  test("an intent owner is matched with an opted-in member who has no romance intent of their own", () => {
    expect(pairs(world())).toEqual(["a,b"]);
  });
  test("both opt-ins are required: c is not opted in, and b opting out removes the pair", () => {
    expect(pairs(world(i => { i.members[1]!.prefs.romanceOptIn = false; }))).toEqual([]);
    expect(pairs(world(i => { i.members[1]!.prefs.categoriesOptIn = i.members[1]!.prefs.categoriesOptIn.filter(c => c !== "romance"); }))).toEqual([]);
  });
  test("orientation and age range are respected on both sides", () => {
    expect(pairs(world(i => { i.facets.find(f => f.id === "b-f9")!.tags = ["romance:is:man", "romance:seeks:man", "romance:age:25-45"]; }))).toEqual([]);
    expect(pairs(world(i => { i.members[1]!.age = 50; }))).toEqual([]); // outside a's 25-45
  });
  test("never anyone under 18, and blocks hold", () => {
    expect(pairs(world(i => { i.members[1]!.age = 17; }))).toEqual([]);
    expect(pairs(world(i => { i.members[0]!.age = 17; }))).toEqual([]);
    expect(pairs(world(i => { i.edges.push({ from: "b", to: "a", type: "blocked", strength: 1, explicit: true, createdAt: NOW - DAY }); }))).toEqual([]);
  });
  test("an 'only when I ask' partner is only matched through their own fresh intent", () => {
    expect(pairs(world(i => { i.members[1]!.prefs.onlyWhenAsked = true; }))).toEqual([]);
    expect(pairs(world(i => {
      i.members[1]!.prefs.onlyWhenAsked = true;
      i.intents.push(intent("b", "date someone who likes jazz and evening walks", "romance"));
    }))).toEqual(["a,b"]);
  });
  test("a pair where both have romance intents is proposed once", () => {
    expect(pairs(world(i => { i.intents.push(intent("b", "date someone who likes jazz and evening walks", "romance")); }))).toEqual(["a,b"]);
  });
  test("no cross-city romance without presence overlap", () => {
    expect(pairs(world(i => { i.members[1]!.homeCity = "nyc"; i.presence[1] = { memberId: "b", city: "nyc", type: "home", areas: ["les"] }; }))).toEqual([]);
  });
  test("end to end: the engine selects the romance intro", async () => {
    const { proposals } = await runEngine(world(), { seed: 1 });
    const r = proposals.filter(p => p.category === "romance");
    expect(r.length).toBe(1);
    expect([...r[0]!.participants].sort()).toEqual(["a", "b"]);
    expect(JSON.stringify(r[0]!.explanations)).not.toContain("dating"); // private preference never shown
  });
});

describe("presence-aware retrieval and pair rules before ranking", () => {
  test("out-of-town providers no longer take every top-K slot of an intent", () => {
    const far = ["n1", "n2", "n3", "n4", "n5"];
    const inp = people(["a", "local"], i => {
      i.intents.push(intent("a", "learn sailing this season", "hobby"));
      i.facets.push(facet("local", 0, "offer", "happy to take a beginner sailing", ["sailing"]));
      for (const id of far) {
        i.members.push(baseMember(id, { homeCity: "nyc" }));
        i.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["les"] });
        i.facets.push(facet(id, 0, "offer", "teaches sailing to beginners this season", ["sailing"]));
      }
    });
    const out = intentToCapability(ctx(inp));
    expect(out.map(c => c.participants[1])).toEqual(["local"]);
  });
  test("a blocked or dealbreaker provider never takes a slot", () => {
    const inp = people(["a", "b", "c"], i => {
      i.intents.push(intent("a", "learn sailing this season", "hobby"));
      i.facets.push(facet("b", 0, "offer", "teaches sailing to beginners this season", ["sailing"]), facet("c", 0, "offer", "happy to take a beginner sailing", ["sailing"]));
      i.edges.push({ from: "a", to: "b", type: "blocked", strength: 1, explicit: true, createdAt: NOW - DAY });
    });
    expect(intentToCapability(ctx(inp)).map(c => c.participants[1])).toEqual(["c"]);
  });
});

describe("warm-path intermediaries (via)", () => {
  const mk = (f: (i: EngineInput) => void = () => {}) => people(["a", "x", "y", "b"], i => {
    i.edges.push(knows("a", "x", 0.7), knows("x", "b", 0.7), knows("a", "y", 0.4), knows("y", "b", 0.4));
    i.facets.push(facet("b", 0, "skill", "founded a climate tech startup", ["climate"]));
    i.intents.push(intent("a", "meet climate tech founders", "professional"));
    f(i);
  });
  test("strongest via is used normally", () => expect(warmPath(ctx(mk()))[0]!.via).toBe("x"));
  test("a via on safety hold or paused is skipped; the next connector carries the path", () => {
    expect(warmPath(ctx(mk(i => { i.safetyHolds = [{ memberId: "x", from: NOW - DAY }]; })))[0]!.via).toBe("y");
    expect(warmPath(ctx(mk(i => { i.members[1]!.state = "paused"; })))[0]!.via).toBe("y");
  });
  test("candidateReason rejects a held, paused or blocked via", () => {
    const base = mk(i => { i.safetyHolds = [{ memberId: "y", from: NOW - DAY }]; i.members[1]!.state = "paused"; });
    base.edges.push({ from: "b", to: "k", type: "blocked", strength: 1, explicit: true, createdAt: NOW - DAY });
    base.members.push(baseMember("k")); base.presence.push({ memberId: "k", city: "sf", type: "home", areas: ["mission"] });
    const w = mkWorld(base);
    expect(candidateReason(w, cand(["a", "b"], { via: "y", kind: "member_intro" }))).toBe("safety_hold");
    expect(candidateReason(w, cand(["a", "b"], { via: "x", kind: "member_intro" }))).toBe("state_paused");
    expect(candidateReason(w, cand(["a", "b"], { via: "k", kind: "member_intro" }))).toBe("blocked");
  });
});

describe("event_anchor and second_encounter end to end (idle on the synthetic snapshot: no events/history)", () => {
  test("given events, event_anchor proposals are selected with the event window", async () => {
    const inp = people(["a", "b", "c"], i => {
      for (const id of ["a", "b", "c"]) i.facets.push(facet(id, 0, "interest", "climate tech and clean energy", ["climate"]));
      i.events = [{ id: "e1", title: "Climate tech founder demo night", city: "sf", start: NOW + 2 * DAY, end: NOW + 2 * DAY + 3 * HOUR, tags: ["climate"], category: "events" }];
      for (const m of i.members) m.prefs.categoriesOptIn.push("events");
    });
    // Checks the event plumbing (window, anchor). The v1.2 per-generator bar (0.40) is covered in v12.test.ts.
    const { proposals, runLog } = await runEngine(inp, { seed: 1, thresholds: { useByGenerator: false } });
    expect(runLog.funnel.byGenerator.event_anchor).toBeGreaterThan(0);
    const ev = proposals.filter(p => p.generator === "event_anchor");
    expect(ev.length).toBeGreaterThan(0);
    for (const p of ev) { expect(p.window).toEqual({ start: NOW + 2 * DAY, end: NOW + 2 * DAY + 3 * HOUR }); expect(p.anchor?.id).toBe("e1"); }
  });
  test("given a mutually positive completed meeting, second_encounter is selected", async () => {
    const inp = people(["a", "b"], i => {
      for (const id of ["a", "b"]) i.facets.push(facet(id, 0, "interest", "board games and strategy games", ["boardgames"]));
      i.interactions = [{ id: "h1", kind: "intro", category: "social", participants: ["a", "b"], at: NOW - 5 * DAY, outcome: "completed" }];
      i.feedback = [
        { id: "f1", from: "a", about: "b", opportunityId: "h1", at: NOW - 4 * DAY, sentiment: "positive", wouldMeetAgain: true },
        { id: "f2", from: "b", about: "a", opportunityId: "h1", at: NOW - 4 * DAY, sentiment: "positive", wouldMeetAgain: true },
      ];
    });
    const { proposals } = await runEngine(inp, { seed: 1 });
    expect(proposals.map(p => p.generator)).toContain("second_encounter");
  });
});

describe("opportunity: late acceptances after quorum", () => {
  test("remaining invitees can still accept once a group is QUORUM_MET or scheduling", () => {
    const c = new SimClock(NOW);
    const o = createOpportunity({ id: "g", participants: ["a", "b", "c", "d", "e", "f"], quorum: 4 });
    for (const [to, trig, actor] of [["PROPOSED", "propose", "engine"], ["IN_REVIEW", "enqueue_review", "system"], ["APPROVED", "approve", "reviewer"]] as const) transition(o, to, trig, actor, c, `t${to}`);
    dispatchInvites(o, c, "d");
    for (const id of ["a", "b", "c", "d"]) respond(o, id, true, c, `r${id}`);
    expect(o.state).toBe("QUORUM_MET");
    respond(o, "e", true, c, "re");
    expect(o.state).toBe("QUORUM_MET");
    expect(o.participants.e).toBe("accepted");
    transition(o, "SCHEDULING", "start_scheduling", "system", c, "s");
    respond(o, "f", true, c, "rf");
    expect(o.state).toBe("SCHEDULING");
    expect(o.participants.f).toBe("accepted");
  });
});

describe("outreach: bundled messages count once for the two-unanswered rule", () => {
  const m = (id: string, at: number, over: Partial<OutboundMessage> = {}): OutboundMessage => ({ id, memberId: "a", kind: "recommendation", at, ...over });
  test("one unanswered bundle of two items is a streak of 1, not 2", () => {
    const now = NOW + 10 * DAY;
    expect(unansweredStreak([m("b1", now - 5 * DAY), m("b1", now - 5 * DAY)], now)).toBe(1);
    expect(unansweredStreak([m("b1", now - 5 * DAY), m("b1", now - 5 * DAY), m("b2", now - 4 * DAY)], now)).toBe(2);
  });
  test("a reply to any item of the bundle answers it", () => {
    const now = NOW + 10 * DAY;
    expect(unansweredStreak([m("b1", now - 5 * DAY), m("b1", now - 5 * DAY, { repliedAt: now - 5 * DAY + HOUR }), m("b2", now - 4 * DAY)], now)).toBe(1);
  });
});
