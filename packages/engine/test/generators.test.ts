import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { runEngine } from "../src/engine.ts";
import {
  complementaryIntents, eventAnchor, expansion, groupComposer, helpRequest, intentToCapability, networkGrowth,
  newcomerWelcome, secondEncounter, sharedIntentPooling, warmPath, warmPathValue, type GenCtx,
} from "../src/generators.ts";
import { Rng } from "../src/rng.ts";
import type { EngineInput } from "../src/types.ts";
import { baseMember, emptyInput, facet, intent, mkWorld, NOW, sailingPair } from "./helpers.ts";

const ctx = (inp: EngineInput): GenCtx => ({ w: mkWorld(inp), memberExclusions: {}, rng: new Rng(1), unmatchedIntents: new Set() });
const home = (inp: EngineInput, id: string, area = "mission", city: "sf" | "nyc" = "sf") => inp.presence.push({ memberId: id, city, type: "home", areas: [area] });

function people(ids: string[], f: (inp: EngineInput) => void = () => {}): EngineInput {
  const inp = emptyInput(NOW);
  for (const id of ids) { inp.members.push(baseMember(id)); home(inp, id); }
  f(inp);
  return inp;
}

describe("generators (Section 33.4)", () => {
  test("intent to capability: learner meets teacher", () => {
    const out = intentToCapability(ctx(sailingPair()));
    expect(out.length).toBe(1);
    expect(out[0]!.participants).toEqual(["a", "b"]);
    expect(out[0]!.roles).toEqual({ a: "seeker", b: "provider" });
    expect(out[0]!.channels.has("semantic")).toBe(true);
  });

  test("intent to capability: nobody fits -> unmatched intent (feeds growth + empty state)", () => {
    const inp = sailingPair();
    inp.facets = inp.facets.filter(f => f.memberId !== "b");
    inp.facets.push(facet("b", 5, "skill", "tax accounting", ["finance"]));
    const c = ctx(inp);
    expect(intentToCapability(c)).toEqual([]);
    expect(c.unmatchedIntents.size).toBe(1);
  });

  test("complementary intents: guitarist and drummer both want a band", () => {
    const inp = people(["g", "d"], i => {
      i.facets.push(facet("g", 0, "skill", "plays guitar in a rock band", ["music"]), facet("d", 0, "skill", "plays drums in a rock band", ["music"]));
      i.intents.push(intent("g", "start a rock band and find a drummer who plays drums", "hobby"), intent("d", "start a rock band and find a guitarist who plays guitar", "hobby"));
    });
    const out = complementaryIntents(ctx(inp));
    expect(out.length).toBe(1);
    expect(new Set(out[0]!.participants)).toEqual(new Set(["g", "d"]));
  });

  test("complementary intents: romance only between mutual opt-ins", () => {
    const mk = (bOpt: boolean) => people(["a", "b"], i => {
      for (const m of i.members) { m.prefs.romanceOptIn = true; m.prefs.categoriesOptIn.push("romance"); }
      i.members[1]!.prefs.romanceOptIn = bOpt;
      i.facets.push(facet("a", 0, "interest", "live jazz and cooking", ["music"]), facet("b", 0, "interest", "live jazz and cooking dinners", ["music"]));
      i.intents.push(intent("a", "open to dating someone who loves live jazz", "romance"), intent("b", "open to dating someone who loves cooking and jazz", "romance"));
    });
    expect(complementaryIntents(ctx(mk(true))).length).toBe(1);
    expect(complementaryIntents(ctx(mk(false))).length).toBe(0);
  });

  test("shared intent pooling: several tennis players -> pair and doubles group", () => {
    const inp = people(["t1", "t2", "t3", "t4"], i => {
      for (const id of ["t1", "t2", "t3", "t4"]) {
        i.facets.push(facet(id, 0, "interest", "playing tennis on weekends", ["tennis"]));
        i.intents.push(intent(id, "play doubles tennis with a group on weekends", "hobby", { id: `${id}-i` }));
      }
    });
    const out = sharedIntentPooling(ctx(inp));
    expect(out.some(c => c.kind === "intro")).toBe(true);
    const g = out.find(c => c.kind === "group");
    expect(g).toBeDefined();
    expect(g!.participants.length).toBeGreaterThanOrEqual(3);
  });

  test("event anchor: two climate founders and a demo night", () => {
    const inp = people(["a", "b", "c"], i => {
      for (const id of ["a", "b", "c"]) i.facets.push(facet(id, 0, "interest", "climate tech and clean energy", ["climate"]));
      i.events = [{ id: "e1", title: "Climate tech founder demo night", city: "sf", start: NOW + 2 * DAY, end: NOW + 2 * DAY + 3 * HOUR, tags: ["climate"], category: "events" }];
    });
    const out = eventAnchor(ctx(inp));
    expect(out.filter(c => c.participants.length === 2).length).toBe(3);
    expect(out.some(c => c.participants.length === 3)).toBe(true);
    for (const c of out) { expect(c.kind).toBe("event_coattend"); expect(c.fixedWindow).toEqual({ start: NOW + 2 * DAY, end: NOW + 2 * DAY + 3 * HOUR }); }
  });

  test("event anchor: travellers away during the event are not retrieved", () => {
    const inp = people(["a", "b"], i => {
      for (const id of ["a", "b"]) i.facets.push(facet(id, 0, "interest", "climate tech and clean energy", ["climate"]));
      i.presence.push({ memberId: "b", city: "nyc", type: "temporary", areas: [], from: NOW + DAY, to: NOW + 3 * DAY });
      i.events = [{ id: "e1", title: "Climate tech founder demo night", city: "sf", start: NOW + 2 * DAY, end: NOW + 2 * DAY + 3 * HOUR, tags: ["climate"], category: "events" }];
    });
    expect(eventAnchor(ctx(inp))).toEqual([]);
  });

  test("warm path: friend-of-a-friend with the asked-about experience, via the connector", () => {
    const inp = people(["a", "x", "b"], i => {
      i.edges.push({ from: "a", to: "x", type: "knows", strength: 0.7, explicit: true, createdAt: NOW - DAY }, { from: "x", to: "b", type: "met", strength: 0.7, explicit: true, createdAt: NOW - DAY });
      i.facets.push(facet("b", 0, "skill", "founded a climate tech startup", ["climate"]));
      i.intents.push(intent("a", "meet climate tech founders", "professional"));
    });
    const out = warmPath(ctx(inp));
    expect(out.length).toBe(1);
    expect(out[0]!.participants).toEqual(["a", "b"]);
    expect(out[0]!.via).toBe("x");
    expect(out[0]!.kind).toBe("member_intro");
  });

  test("warm-path value is an inverted U in tie strength", () => {
    expect(warmPathValue(0.5)).toBeGreaterThan(warmPathValue(0.1));
    expect(warmPathValue(0.5)).toBeGreaterThan(warmPathValue(0.95));
    expect(warmPathValue(0.5)).toBeCloseTo(1, 5);
  });

  test("help request: home move needs two helpers; load-aware ranking prefers rested helpers", () => {
    const inp = people(["r", "h1", "h2", "h3"], i => {
      for (const id of ["h1", "h2", "h3"]) i.facets.push(facet(id, 0, "offer", "happy to help friends move furniture", ["moving"]));
      i.intents.push(intent("r", "need help to move a couch to my apartment Saturday", "help"));
      i.interactions = [{ id: "old", kind: "help", category: "help", participants: ["x", "h1"], at: NOW - 3 * DAY, outcome: "completed", contributors: ["h1"] }];
    });
    const out = helpRequest(ctx(inp));
    expect(out.length).toBeGreaterThanOrEqual(1); // primary helper set first, then variants
    const c = out[0]!;
    expect(c.participants.length).toBe(3);
    expect(c.participants[0]).toBe("r");
    expect(c.participants).not.toContain("h1"); // h1 helped recently
    expect(c.alternates).toContain("h1");
    expect(c.safetyClass).toBe("medium");
  });

  test("group composer: dinner for 3-6 around a shared shareable theme", () => {
    const ids = ["g1", "g2", "g3", "g4", "g5", "g6", "g7"];
    const inp = people(ids, i => {
      for (const id of ids) i.facets.push(facet(id, 0, "interest", "independent film and cinema", ["film"]));
      i.facets.push(facet("g1", 1, "offer", "hosts small film screenings", ["film", "host"]));
      i.edges.push({ from: "g1", to: "g2", type: "knows", strength: 0.6, explicit: true, createdAt: NOW - DAY });
    });
    const out = groupComposer(ctx(inp));
    expect(out.length).toBe(1);
    const g = out[0]!;
    expect(g.participants.length).toBeGreaterThanOrEqual(3);
    expect(g.participants.length).toBeLessThanOrEqual(6);
    expect(Object.values(g.roles)).toContain("host");
    expect(g.objective).toContain("film");
    expect(g.alternates.length).toBeGreaterThan(0);
  });

  test("second encounter: mutual positive completed meeting -> event together (and completed match does not block)", () => {
    const inp = people(["a", "b"], i => {
      for (const id of ["a", "b"]) i.facets.push(facet(id, 0, "interest", "board games and strategy games", ["boardgames"]));
      i.interactions = [{ id: "h1", kind: "help", category: "help", participants: ["a", "b"], at: NOW - 5 * DAY, outcome: "completed" }];
      i.feedback = [
        { id: "f1", from: "a", about: "b", opportunityId: "h1", at: NOW - 4 * DAY, sentiment: "positive", wouldMeetAgain: true, processed: true },
        { id: "f2", from: "b", about: "a", opportunityId: "h1", at: NOW - 4 * DAY, sentiment: "positive", wouldMeetAgain: true, processed: true },
      ];
      i.events = [{ id: "e1", title: "Board game cafe night", city: "sf", start: NOW + 2 * DAY, end: NOW + 2 * DAY + 3 * HOUR, tags: ["boardgames"], category: "events" }];
    });
    const out = secondEncounter(ctx(inp));
    expect(out.length).toBe(1);
    expect(out[0]!.anchor).toMatchObject({ type: "event", id: "e1" });
    expect(out[0]!.kind).toBe("second_encounter");
  });

  test("second encounter requires both sides positive", () => {
    const inp = people(["a", "b"], i => {
      i.interactions = [{ id: "h1", kind: "intro", category: "social", participants: ["a", "b"], at: NOW - 5 * DAY, outcome: "completed" }];
      i.feedback = [{ id: "f1", from: "a", about: "b", opportunityId: "h1", at: NOW - 4 * DAY, sentiment: "positive", wouldMeetAgain: true }];
    });
    expect(secondEncounter(ctx(inp))).toEqual([]);
  });

  test("newcomer welcome: newcomer + host + friendly members", () => {
    const ids = ["n", "h", "f1", "f2", "f3"];
    const inp = people(ids, i => {
      i.members[0]!.joinedAt = NOW - 3 * DAY;
      i.facets.push(facet("h", 0, "offer", "loves hosting gatherings and dinners", ["host"]));
      for (const id of ids) i.facets.push(facet(id, 1, "interest", "cooking dinners and trying new restaurants", ["cooking"]));
      i.edges.push({ from: "f1", to: "f2", type: "knows", strength: 0.5, explicit: true, createdAt: NOW - 30 * DAY }, { from: "f1", to: "h", type: "knows", strength: 0.5, explicit: true, createdAt: NOW - 30 * DAY });
    });
    const out = newcomerWelcome(ctx(inp));
    expect(out.length).toBe(1);
    expect(out[0]!.participants).toContain("n");
    expect(out[0]!.roles.n).toBe("newcomer");
    expect(out[0]!.roles.h).toBe("host");
    expect(out[0]!.participants.length).toBeGreaterThanOrEqual(3);
    expect(out[0]!.participants.length).toBeLessThanOrEqual(4);
  });

  test("network growth: unmet intents and host-less areas ask well-connected members", () => {
    const ids = ["a", "c1", "c2", "c3"];
    const inp = people(ids, i => {
      for (const x of ["c2", "c3"]) i.edges.push({ from: "c1", to: x, type: "knows", strength: 0.6, explicit: true, createdAt: NOW - 30 * DAY });
      i.edges.push({ from: "c2", to: "c3", type: "knows", strength: 0.6, explicit: true, createdAt: NOW - 30 * DAY });
    });
    const c = ctx(inp);
    const out = networkGrowth(c);
    expect(out.length).toBeGreaterThan(0);
    for (const o of out) { expect(o.participants.length).toBe(1); expect(o.roles[o.participants[0]!]).toBe("connector"); expect(o.objective).toContain("host in mission"); }
  });

  test("expansion: a desire outside the usual cluster, marked exploration", () => {
    const inp = people(["eng", "pot"], i => {
      i.facets.push(facet("eng", 0, "interest", "machine learning and AI research", ["ai"]), facet("eng", 1, "interest", "AI agents", ["ai"]));
      i.facets.push(facet("eng", 2, "desire", "I miss making things with my hands like pottery and ceramics", ["ceramics"]));
      i.facets.push(facet("pot", 0, "skill", "ceramics teacher with a pottery wheel studio", ["ceramics"]), facet("pot", 1, "interest", "pottery and ceramics", ["ceramics"]));
    });
    const out = expansion(ctx(inp));
    expect(out.length).toBe(1);
    expect(out[0]!.exploration).toBe(true);
    expect(out[0]!.participants).toEqual(["eng", "pot"]);
  });

  test("end to end: the sailing pair produces one explained proposal", async () => {
    const { proposals, runLog } = await runEngine(sailingPair(), { seed: 1 });
    expect(proposals.length).toBe(1);
    expect(proposals[0]!.explanations.a).toContain("teaches sailing");
    expect(runLog.funnel.selected).toBe(1);
  });
});
