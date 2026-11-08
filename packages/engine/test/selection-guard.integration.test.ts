// The engine's last guards, driven through the public entry points (runEngine, planProposals, the
// World with the hard filters). No fakes and no model. Each case failed before its fix.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { DEFAULT_ATTENTION, DEFAULT_PLANS, resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine } from "../src/engine.ts";
import type { AppPack } from "../src/pack.ts";
import { networkPack } from "../src/packs/network/index.ts";
import { planProposals } from "../src/plans.ts";
import type { Selected } from "../src/policy.ts";
import { relayItemAsync, type RelayContext, type RelayItem } from "../src/relay.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { EngineInput } from "../src/types.ts";
import { World } from "../src/world.ts";

const NOW = Date.UTC(2026, 9, 5, 16);

/** Adults who all want the same thing in one city, so every pair is an eligible candidate. */
function sameWantWorld(ids: string[]): EngineInput {
  const inp = emptyInput(NOW);
  inp.members = ids.map(id => baseMember(id, { name: `Q${id}`, homeCity: "sf" }));
  inp.facets = ids.map(id => facet(id, 1, "interest", "running trails and marathons", ["running"]));
  inp.intents = ids.map(id => ({ id: `i_${id}`, memberId: id, objective: "find a running buddy for morning runs", category: "hobby", horizonDays: 30, status: "active", createdAt: NOW - DAY } as EngineInput["intents"][number]));
  inp.presence = ids.map(id => ({ memberId: id, city: "sf", type: "home", areas: ["mission"] } as EngineInput["presence"][number]));
  return inp;
}

/** A pack whose assignment returns every eligible configuration, twice, against the pack contract. */
const greedyEverything: AppPack = {
  ...networkPack,
  selection: {
    ...networkPack.selection,
    assign: (_w, scored) => {
      const all = scored.filter(s => s.eligible);
      return { selected: [...all, ...all].map((s, rank): Selected => ({ s, exploration: false, rank, probability: 1 })), budgetSkips: 0 };
    },
  },
};

describe("selection guard", () => {
  const cfg = { seed: 1, cities: ["sf" as const], budgets: { normal: { limit: 2, periodDays: 7 }, open: { limit: 2, periodDays: 7 } }, thresholds: { byState: { open: 0, normal: 0, quiet: 0, receiving: 0 }, byCategory: { romance: 0, help: 0, growth: 0 } }, floors: { fit: 0, mutualBenefit: 0, confidence: 0, maxSocialRisk: 1, judgeDimension: 0 } };
  const ids = ["a", "b", "c", "d", "e", "f"];

  test("a pack's assign hook cannot repeat a pair", async () => {
    const r = await runEngine(sameWantWorld(ids), cfg, { pack: greedyEverything });
    expect(r.proposals.length).toBeGreaterThan(0);
    expect(new Set(r.proposals.map(p => [...p.participants].sort().join(","))).size).toBe(r.proposals.length);
    expect(r.runLog.funnel.rejectedAfterSelection?.repeated_pair).toBeGreaterThan(0);
  });

  test("a pack's assign hook cannot propose a member who is in an open opportunity", async () => {
    const inp = sameWantWorld(ids);
    inp.openOpportunities = [{ id: "o1", participants: ["a"], stage: "inviting", until: NOW + DAY }];
    const r = await runEngine(inp, cfg, { pack: greedyEverything });
    expect(r.proposals.length).toBeGreaterThan(0);
    expect(r.proposals.flatMap(p => p.participants)).not.toContain("a");
  });

  test("the core greedy selection never trips the guard", async () => {
    const r = await runEngine(sameWantWorld(ids), cfg, {});
    expect(r.proposals.length).toBeGreaterThan(0);
    expect(r.runLog.funnel.rejectedAfterSelection).toBeUndefined();
  });
});

describe("relay", () => {
  const ctx = (): RelayContext => ({
    now: NOW,
    sender: { id: "a", firstName: "Ari", age: 30 }, recipient: { id: "b", firstName: "Bo", age: 30 }, blocked: false,
    opportunity: { id: "o", app: "slop", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual" },
  });
  const item: RelayItem = { id: "i", kind: "text", from: "a", to: "b", at: NOW, text: "see you friday" };

  test("a Clef minor signal flags the age, as the rules' signal does", async () => {
    const res = await relayItemAsync(item, ctx(), { hook: async () => ({ flags: ["minor_signal"], source: "clef" }) });
    expect(res.decision).toBe("hold");
    expect(res.record.ageSignal).toBe(true);
  });

  test("another Clef flag holds but does not flag the age", async () => {
    const res = await relayItemAsync(item, ctx(), { hook: async () => ({ flags: ["scam"], source: "clef" }) });
    expect(res.decision).toBe("hold");
    expect(res.record.ageSignal).toBe(false);
  });
});

describe("plans of one run", () => {
  test("one member is in at most one plan, as an alternate too", () => {
    const inp = emptyInput(NOW);
    const ids = [...Array(13).keys()].map(i => `p${String(i).padStart(2, "0")}`);
    inp.members = ids.map(id => baseMember(id, { name: `Q${id}`, homeCity: "sf" }));
    inp.facets = ids.map(id => facet(id, 1, "interest", "running trails", ["running"]));
    inp.presence = ids.map(id => ({ memberId: id, city: "sf", type: "home", areas: ["mission"] } as EngineInput["presence"][number]));
    const sat = { start: Date.UTC(2026, 9, 10, 0), end: Date.UTC(2026, 9, 11, 7) };
    const sun = { start: Date.UTC(2026, 9, 11, 7), end: Date.UTC(2026, 9, 12, 7) };
    const evidence = new Map(ids.map((id, i) => [id, { memberId: id, tz: "America/Los_Angeles", stated: { windows: i < 6 ? [sat] : i < 12 ? [sun] : [sat, sun], at: NOW, until: NOW + 7 * DAY, ...(i === 12 ? { confidence: 0.5 } : {}) } }]));
    const venues = [{ id: "v1", name: "Dolores Park", city: "sf", area: "mission", public: true, activities: ["group_run"], ageMin: 18, priceTier: 0, hours: { weekday: [6, 22], weekend: [6, 22] } }];
    const w = new World(inp, resolveConfig({}), localEmbed);
    const plans = planProposals(w, { now: NOW, city: "sf", tz: "America/Los_Angeles", evidence, venues } as unknown as Parameters<typeof planProposals>[1], DEFAULT_PLANS, DEFAULT_ATTENTION);
    expect(plans.length).toBe(2);
    const count = new Map<string, number>();
    for (const p of plans) for (const id of new Set([...p.invited, ...p.alternates])) count.set(id, (count.get(id) ?? 0) + 1);
    expect([...count].filter(([, n]) => n > 1)).toEqual([]);
    expect(plans.flatMap(p => p.alternates)).toContain("p12");
  });
});

describe("the World keeps a member's own choices", () => {
  test("answers recorded under an alias count for the member", () => {
    const inp = emptyInput(NOW);
    inp.members = [baseMember("a"), baseMember("b")];
    inp.idAliases = { "phone:a": "a" };
    const row = (i: number, id: string) => ({ id: `x${i}`, kind: "intro", category: "social", participants: [id, "b"], at: NOW - i * DAY, outcome: "completed", acceptedBy: [id] });
    inp.interactions = [1, 2, 3, 4, 5].map(i => row(i, "phone:a")) as EngineInput["interactions"];
    const aliased = new World(inp, resolveConfig({}), localEmbed);
    const direct = new World({ ...inp, interactions: [1, 2, 3, 4, 5].map(i => row(i, "a")) as EngineInput["interactions"] }, resolveConfig({}), localEmbed);
    expect(aliased.get("a")!.acceptance).toBe(direct.get("a")!.acceptance);
    expect(aliased.get("a")!.acceptance).toBeGreaterThan(0.8);
  });
});

describe("the World opts a member in only on a live intent", () => {
  test("a closed or expired personal-growth intent does not add the hobby lane", () => {
    const inp = emptyInput(NOW);
    const m = baseMember("a");
    inp.members = [{ ...m, prefs: { ...m.prefs, categoriesOptIn: ["social"] } }];
    const growth = (id: string, status: string, createdAt: number) => ({ id, memberId: "a", objective: "learn to paint with watercolors", category: "growth", horizonDays: 30, status, createdAt } as EngineInput["intents"][number]);
    inp.intents = [growth("closed", "closed", NOW - DAY), growth("expired", "active", NOW - 60 * DAY)];
    expect(new World(inp, resolveConfig({}), localEmbed).get("a")!.m.prefs.categoriesOptIn).toEqual(["social"]);
    inp.intents = [growth("live", "active", NOW - DAY)];
    expect(new World(inp, resolveConfig({}), localEmbed).get("a")!.m.prefs.categoriesOptIn).toEqual(["social", "hobby"]);
  });
});
