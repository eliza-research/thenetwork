// Matching history under id aliases (upstream PR #489, ported): a role, an acceptance or a
// no-response recorded under an alias counts for the canonical member, once, and the run proposes
// the same configurations as with canonical ids.
import { expect, test } from "vitest";
import { DAY } from "@thenetwork/core";
import { slopWorld } from "../../../scripts/sim/slop.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine } from "../src/engine.ts";
import { PEON_ENGINE_CONFIG, peonPack } from "../src/packs/peon/index.ts";
import { historyOf } from "../src/packs/peon/profile.ts";
import { peonTestWorld } from "../src/packs/peon/testkit.ts";
import { planFromInput, SLOP_ENGINE_CONFIG, slopPack, slopProfiles } from "../src/packs/slop/index.ts";
import { randomWorld } from "../src/testkit.ts";
import type { EngineInput, InteractionRecord, Role } from "../src/types.ts";
import { World } from "../src/world.ts";

const legacyAliases = (input: EngineInput): Record<string, string> =>
  ({ ...input.idAliases, ...Object.fromEntries(input.members.map(m => [`legacy:${m.id}`, m.id])) });

test("contribution history counts a role recorded under an alias", async () => {
  for (const seed of [1, 2]) {
    const input = randomWorld({ seed, members: 120, minors: false });
    const initial = await runEngine(input, { seed });
    const proposal = initial.proposals.find(p => p.participants.length >= 2);
    expect(proposal).toBeTruthy();
    const [helper, asker] = proposal!.participants;
    // Ten days ago: outside the weekly contact budget, inside the 14-day contribution window.
    const roles: Record<string, Role> = { [helper!]: "helper", [asker!]: "seeker" };
    const recentProposals = [0, 1].map(i => ({
      ...proposal!, id: `past-${i}`, participants: [helper!, asker!], roles, createdAt: input.now - 10 * DAY,
    }));
    const canonical: EngineInput = { ...input, recentProposals, idAliases: legacyAliases(input) };
    const expected = await runEngine(canonical, { seed });
    const a = new World(canonical, resolveConfig({ seed }), localEmbed);
    expect(a.get(helper!)!.recentContribution).toBe(2);
    for (const rolesOnly of [false, true]) {
      const aliased: EngineInput = {
        ...canonical, recentProposals: recentProposals.map(p => ({
          ...p,
          participants: rolesOnly ? p.participants : p.participants.map(id => `legacy:${id}`),
          roles: Object.fromEntries(Object.entries(p.roles).map(([id, role]) => [`legacy:${id}`, role])),
        })),
      };
      const z = new World(aliased, resolveConfig({ seed }), localEmbed);
      for (const id of a.ids) expect(z.get(id)!.recentContribution).toBe(a.get(id)!.recentContribution);
      expect((await runEngine(aliased, { seed })).proposals).toEqual(expected.proposals);
    }
  }
});

test("hiring history counts acceptance and no-response recorded under aliases once", async () => {
  for (const seed of [1, 2]) {
    const input = peonTestWorld({ seed, candidates: 90, jobs: 20 });
    const cfg = { ...PEON_ENGINE_CONFIG, seed };
    const initial = await runEngine(input, cfg, { pack: peonPack });
    expect(initial.proposals.length).toBeGreaterThan(3);
    const interactions: InteractionRecord[] = initial.proposals.map((p, i) => ({
      id: `history-${i}`, kind: p.kind, category: p.category, participants: p.participants, at: input.now - 7 * DAY,
      outcome: i % 3 === 0 ? "pending" : i % 3 === 1 ? "completed" : "expired",
      acceptedBy: i % 3 === 1 ? p.participants : p.participants.filter(id => id.startsWith("c")),
      noResponse: i % 3 === 2 ? p.participants.filter(id => id.startsWith("j")) : [],
    }));
    const canonical: EngineInput = { ...input, interactions, idAliases: legacyAliases(input) };
    const expected = await runEngine(canonical, cfg, { pack: peonPack });
    const a = new World(canonical, resolveConfig(cfg), localEmbed, peonPack);
    expect(a.ids.some(id => historyOf(a, id).pendingReview > 0)).toBe(true);
    for (const mixed of [false, true]) {
      const aliasIds = (ids: string[] | undefined) => ids?.flatMap(id => (mixed ? [`legacy:${id}`, id] : [`legacy:${id}`]));
      const aliased: EngineInput = {
        ...canonical, interactions: interactions.map(r => ({
          ...r, participants: aliasIds(r.participants)!, acceptedBy: aliasIds(r.acceptedBy), noResponse: aliasIds(r.noResponse),
        })),
      };
      const z = new World(aliased, resolveConfig(cfg), localEmbed, peonPack);
      for (const id of a.ids) expect(historyOf(z, id)).toEqual(historyOf(a, id));
      expect((await runEngine(aliased, cfg, { pack: peonPack })).proposals).toEqual(expected.proposals);
    }
  }
});

test("the same Slop pairs have the same date plans with two-hop member aliases", async () => {
  const input = slopWorld(1, { perCity: 20, minorShare: 0 });
  const [first, second] = input.members.map(member => member.id) as [string, string];
  const alias = (id: string) => `legacy:${id}`;
  const config = { ...SLOP_ENGINE_CONFIG, seed: 1 };
  const aliased: EngineInput = {
    ...input,
    facets: input.facets.map(item => ({ ...item, memberId: alias(item.memberId) })),
    presence: input.presence.map(item => ({ ...item, memberId: alias(item.memberId) })),
    intents: input.intents.map(item => ({ ...item, memberId: alias(item.memberId) })),
    idAliases: {
      ...Object.fromEntries(input.members.flatMap(({ id }) => [[alias(id), `older:${id}`], [`older:${id}`, id]])),
      [first]: second,
      "cycle:a": "cycle:b",
      "cycle:b": "cycle:a",
    },
  };
  const expected = (await runEngine(input, config, { pack: slopPack })).proposals;
  expect(expected.length).toBeGreaterThan(0);
  const datePlans = (data: EngineInput) => expected.map(proposal =>
    planFromInput(data, proposal.participants[0]!, proposal.participants[1]!, ["sf", "nyc", "la"]));
  const canonicalPlans = datePlans(input);
  expect(canonicalPlans.every(Boolean)).toBe(true);

  const cold = { ...aliased };
  expect(datePlans(cold)).toEqual(canonicalPlans);
  expect((await runEngine(cold, config, { pack: slopPack })).proposals).toEqual(expected);

  const warm = { ...aliased };
  slopProfiles(warm, id => id);
  expect((await runEngine(warm, config, { pack: slopPack })).proposals).toEqual(expected);
  expect(datePlans(warm)).toEqual(canonicalPlans);

  const view = new World(warm, resolveConfig(config), localEmbed, slopPack);
  expect(view.canonical(alias(first))).toBe(first);
  expect(view.canonical(first)).toBe(first);
  expect(view.canonical("cycle:a")).toBe("cycle:a");
  expect(view.canonical("unknown")).toBe("unknown");
  expect(view.canonical("toString")).toBe("toString");
});

test("a direct date plan refuses current holds and blocks even when they use an old member ID", async () => {
  const input = slopWorld(13, { perCity: 24, minorShare: 0 });
  const result = await runEngine(input, { ...SLOP_ENGINE_CONFIG, seed: 13 }, { pack: slopPack });
  const [first, partner] = result.proposals[0]!.participants as [string, string];
  const plan = (extra: Partial<EngineInput> = {}) =>
    planFromInput({ ...input, ...extra, idAliases: { "old:first": first } }, first, partner, ["sf", "nyc", "la"]);
  expect(plan()?.public).toBe(true);
  expect(plan({ edges: [...input.edges, { from: partner, to: "old:first", type: "blocked", strength: 1, explicit: true, createdAt: input.now }] })).toBeNull();
  expect(plan({ safetyHolds: [{ memberId: "old:first", from: input.now - DAY }] })).toBeNull();
  expect(plan({ safetyHolds: [{ memberId: first, from: input.now - DAY, to: input.now }] })?.public).toBe(true);
  expect(plan({ safetyHolds: [{ memberId: partner, from: input.now + DAY }] })?.public).toBe(true);
  expect(plan({ members: input.members.map(member => member.id === partner ? { ...member, state: "paused" } : member) })).toBeNull();
  expect(plan({ members: input.members.map(member => member.id === first ? { ...member, age: 17 } : member) })).toBeNull();
});
