// The no-hidden-truth-leak guarantee: the prompt builder never includes hidden truth,
// agent_private facets, canaries, names, member ids, or labels.
import { beforeAll, describe, expect, test } from "bun:test";
import type { WorldSnapshot } from "../../core/src/index.ts";
import { canariesOf } from "../../sim/src/persona.ts";
import { buildRecDataset, type RecDataset } from "../src/recDataset.ts";
import { buildPublicView, decision, parseRecPrediction, recommenderMessages } from "../src/publicView.ts";

let ds: RecDataset;
beforeAll(async () => { ds = await buildRecDataset(); }, 120_000);

const HIDDEN_KEYS = ["trueAge", "hidden", "privateDisclosure", "canary", "flakiness", "honesty", "openness", "capacity",
  "socialEnergy", "preferredGroupSize", "responsiveness", "adversarial", "archetype", "boundaries",
  "compatible", "enjoyment", "wouldAccept", "wouldShow", "acceptProb", "showProb", "oracle", "truth", "quality", "unsafe", "hiddenRisk", "gender", "voiceSample"];

function promptText(d: RecDataset, i: RecDataset["items"][number]) {
  return JSON.stringify(recommenderMessages(buildPublicView(d.worlds.get(i.world)!.snapshot(), i.config)));
}

describe("prompt builder never leaks hidden truth", () => {
  test("no canaries, private disclosures, boundaries, names or member ids in any prompt", () => {
    for (const i of ds.items) {
      const w = ds.worlds.get(i.world)!;
      const text = promptText(ds, i);
      const people = [...i.config.participants, ...(i.config.via ? [i.config.via] : [])].map(id => w.byId.get(id)!);
      for (const c of canariesOf(w.personas)) expect(text.includes(c.canary)).toBe(false);
      for (const p of people) {
        if (p.hidden.privateDisclosure) expect(text.includes(p.hidden.privateDisclosure.fact)).toBe(false);
        for (const b of p.hidden.boundaries) expect(text.includes(b)).toBe(false);
        expect(text.includes(p.name)).toBe(false);
        expect(text.includes(p.id)).toBe(false);
      }
      expect(/\b(sf|nyc)-\d-\d{4}\b/.test(text)).toBe(false);
    }
  });
  test("no hidden-truth or label field names appear as JSON keys", () => {
    for (const i of ds.items) {
      const user = JSON.parse(recommenderMessages(buildPublicView(ds.worlds.get(i.world)!.snapshot(), i.config))[1]!.content);
      const keys = new Set<string>();
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
      };
      walk(user);
      for (const k of HIDDEN_KEYS) expect(keys.has(k)).toBe(false);
      expect(keys.has("refs")).toBe(false);
    }
  });
  test("prompt is a function of the public config only: changing labels never changes it", () => {
    for (const i of ds.items.slice(0, 40)) {
      const before = promptText(ds, i);
      const flipped = { ...i, truth: { ...i.truth, good: !i.truth.good, unsafe: !i.truth.unsafe, quality: 0.123456, participants: {} } };
      expect(promptText(ds, flipped)).toBe(before);
    }
  });
  test("agent_private and opportunity_specific facets are dropped even if present", () => {
    const now = Date.UTC(2026, 9, 8);
    const mk = (id: string) => ({ id, name: `Name ${id}`, homeCity: "sf" as const, state: "normal" as const, joinedAt: now - 86_400_000, age: 30, unansweredProactive: 0,
      prefs: { categoriesOptIn: ["social" as const], quietHours: [22, 8] as [number, number], romanceOptIn: false, formats: ["one_to_one" as const], maxTravelMinutes: 30, onlyWhenAsked: false } });
    const f = (id: string, n: number, scope: any, value: string) => ({ id: `${id}:${n}`, memberId: id, kind: "fact" as const, value, tags: [], scope, provenance: "said" as const, confidence: 1 });
    const snap: WorldSnapshot = {
      now, members: [mk("aa-1-0001"), mk("aa-1-0002")], intents: [], edges: [], recentProposals: [],
      presence: [{ memberId: "aa-1-0001", city: "sf", type: "home", areas: ["Mission"] }],
      facets: [f("aa-1-0001", 1, "agent_private", "SECRET-PRIVATE ZZ-9999-OPAL"), f("aa-1-0001", 2, "opportunity_specific", "SECRET-OPP"),
        f("aa-1-0001", 3, "shareable", "likes tea"), f("aa-1-0002", 4, "matchable", "plays chess")],
    };
    const view = buildPublicView(snap, { participants: ["aa-1-0001", "aa-1-0002"], roles: {}, kind: "intro", category: "social", objective: "Intro", city: "sf", window: { start: now, end: now + 1 } });
    const text = JSON.stringify(recommenderMessages(view));
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("ZZ-9999");
    expect(text).not.toContain("Name aa");
    expect(text).not.toContain("aa-1-000");
    expect(text).toContain("likes tea");
    expect(text).toContain("plays chess");
    expect(view.refs).toEqual({ P1: "aa-1-0001", P2: "aa-1-0002" });
  });
  test("blocked edges and minors are visible so the model CAN apply policy", () => {
    const blocked = ds.items.find(i => i.truth.unsafeReason === "blocked" && !i.group)!;
    expect(promptText(ds, blocked)).toContain("blocked");
    const minor = ds.items.find(i => i.truth.unsafeReason === "minor_connector")!;
    const user = JSON.parse(recommenderMessages(buildPublicView(ds.worlds.get(minor.world)!.snapshot(), minor.config))[1]!.content);
    expect(user.people.some((p: any) => !p.attending && p.age < 18)).toBe(true);
  });
});

describe("verdict parsing", () => {
  test("valid verdicts parse; percentages are normalised; decision needs no dealbreaker", () => {
    const v = parseRecPrediction({ good_match: true, match_probability: 72, accept_probability: { P1: 0.5, P2: "0.4" }, dealbreaker: false, why: " ok " }, ["P1", "P2"]);
    expect(v.matchProbability).toBeCloseTo(0.72);
    expect(v.acceptProbability).toEqual({ P1: 0.5, P2: 0.4 });
    expect(v.why).toBe("ok");
    expect(decision(v)).toBe(true);
    expect(decision({ ...v, dealbreaker: true })).toBe(false);
  });
  test("schema errors throw", () => {
    expect(() => parseRecPrediction({ good_match: "yes", match_probability: 0.5, accept_probability: {}, dealbreaker: false, why: "" }, ["P1"])).toThrow();
    expect(() => parseRecPrediction({ good_match: true, match_probability: 1.7e3, accept_probability: { P1: 0.2 }, dealbreaker: false, why: "" }, ["P1"])).toThrow();
    expect(() => parseRecPrediction([], ["P1"])).toThrow();
  });
});
