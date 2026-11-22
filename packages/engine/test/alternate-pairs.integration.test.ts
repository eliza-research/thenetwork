// Alternates are backfill: any of them can take a seat beside the participants and beside each other,
// so every pair among a proposal's participants and alternates that its lane pairs has a pair value
// from the one pair gate (spec/models/candidate_pool.md, noAltPairBlockedEngine; blocks win).
import { expect, test } from "vitest";
import { DAY, type Facet, type Member, type MemberId } from "@thenetwork/core";
import { laneSidesCompatible } from "../../core/src/generated/matchLane.ts";
import { runEngine } from "../src/engine.ts";
import { composeGroup, type ComposeOptions } from "../src/group.ts";
import { randomWorld } from "../src/testkit.ts";
import type { EngineInput, EngineProposal } from "../src/types.ts";
import { World } from "../src/world.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";

/** Pairs of a proposal's seats (participants and alternates) that its lane pairs and that have no pair value. */
function unvaluedPairs(w: World, p: EngineProposal): string[] {
  const lane = p.lane;
  if (!lane) return [];
  const seats = [...p.participants, ...p.alternates], out: string[] = [];
  const profile = (id: MemberId) => (p.entities?.[id] === undefined ? w.match.profileIn(id, lane) : w.match.profile(p.entities[id]!));
  for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
    const a = profile(seats[i]!), b = profile(seats[j]!);
    if (a && b && !laneSidesCompatible(lane, a.side, b.side)) continue;
    if (!a || !b || w.match.value(a, b) < 0) out.push(`${p.id}:${seats[i]}+${seats[j]}`);
  }
  return out;
}

test("two alternates of a proposal who blocked each other are never both kept", async () => {
  let checked = 0;
  for (const seed of [1, 2, 3]) {
    const input = randomWorld({ seed, members: 160, minors: false });
    const first = await runEngine(input, { seed });
    const target = first.proposals.find(p => p.participants.length >= 2 && p.alternates.length >= 2);
    if (!target) continue;
    const [x, y] = target.alternates as [MemberId, MemberId];
    const blocked: EngineInput = { ...input, edges: [...input.edges, { from: x, to: y, type: "blocked", strength: 1, explicit: true, createdAt: input.now - DAY }] };
    const after = await runEngine(blocked, { seed });
    const w = new World(blocked, resolveConfig({ seed }), localEmbed);
    expect(after.proposals.filter(p => [...p.participants, ...p.alternates].includes(x) && [...p.participants, ...p.alternates].includes(y)).map(p => p.id)).toEqual([]);
    expect(after.proposals.flatMap(p => unvaluedPairs(w, p))).toEqual([]);
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

test("a composed group keeps only alternates with a pair value with each other", () => {
  // spec/groupFormation.md, "An alternate can join the primary group in its city", with the pair gate
  // across alternates: the group's own alternates must not need the service to repair them.
  let checked = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const input = randomWorld({ seed, members: 160, minors: false });
    const compose = (edges: EngineInput["edges"]) => {
      const w = new World({ ...input, edges }, resolveConfig({ seed }), localEmbed);
      const opts: ComposeOptions = {
        pool: w.ids.map(id => ({ id, affinity: 0.5 })), category: "social", minSize: 3, maxSize: 6,
        window: { start: input.now, end: input.now + 14 * DAY }, needHost: false, alternates: 6,
      };
      return { w, group: composeGroup(w, opts) };
    };
    const first = compose(input.edges).group;
    if (!first) continue;
    // Each pair of the first group's alternates blocks each other in turn.
    for (let i = 0; i < first.alternates.length; i++) for (let j = i + 1; j < first.alternates.length; j++) {
      const x = first.alternates[i]!, y = first.alternates[j]!;
      const { w, group } = compose([...input.edges, { from: x, to: y, type: "blocked", strength: 1, explicit: true, createdAt: input.now - DAY }]);
      if (!group) continue;
      const seats = [...group.primary, ...group.alternates];
      expect(seats.includes(x) && seats.includes(y), `seed ${seed}: ${x} and ${y}`).toBe(false);
      const profiles = seats.map(id => w.match.profileIn(id, group.lane)!);
      for (let a = 0; a < profiles.length; a++) for (let b = a + 1; b < profiles.length; b++) expect(w.match.value(profiles[a]!, profiles[b]!)).toBeGreaterThanOrEqual(0);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
});

test("a host-required circle counts only hosts eligible for that role", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const members: Member[] = ["guest-one", "guest-two", "nominal-host", "eligible-host"].map(id => ({
    id, name: id, homeCity: "nyc", age: 30, joinedAt: now - 30 * DAY, unansweredProactive: 0,
    state: id === "nominal-host" ? "receiving" : "normal",
    prefs: { categoriesOptIn: ["social"], formats: ["small_group", "one_to_one"], quietHours: [22, 8], romanceOptIn: false },
  }));
  const facet = (memberId: string, kind: Facet["kind"], value: string, tags: string[]): Facet => ({
    id: `${memberId}:${kind}`, memberId, kind, value, tags, scope: "shareable", provenance: "said", confidence: 1,
  });
  const facets = members.flatMap(({ id }) => [
    facet(id, "interest", "board games and film", ["boardgames", "film"]),
    ...(id.endsWith("-host") ? [facet(id, "skill", "hosting gatherings", ["host"])] : []),
  ]);
  const input: EngineInput = {
    now, members, facets, intents: [], edges: [],
    presence: members.map(({ id }) => ({ memberId: id, city: "nyc", type: "home", areas: ["williamsburg"] })),
  };
  const world = new World(input, resolveConfig(), localEmbed);
  expect(world.get("nominal-host")?.isHost).toBe(true);
  const pool = members.map(({ id }) => ({ id, affinity: id === "eligible-host" ? 0.6 : 0.9 }));
  const opts: ComposeOptions = {
    pool, category: "social", minSize: 3, maxSize: 3, alternates: 0, needHost: true,
    window: { start: now, end: now + 7 * DAY }, preferredCity: "nyc", requireCity: true,
  };
  expect(composeGroup(world, { ...opts, pool: pool.slice(0, 3), needHost: false })?.primary).toHaveLength(3);
  expect(composeGroup(world, { ...opts, pool: pool.slice(0, 3) })).toBeNull();
  expect(composeGroup(world, opts)?.roles["eligible-host"]).toBe("host");
  expect(composeGroup(world, { ...opts, forced: ["eligible-host"], forcedRole: "guest" })).toBeNull();
  expect(composeGroup(world, { ...opts, forced: ["nominal-host"], forcedRole: "host" })).toBeNull();
});
