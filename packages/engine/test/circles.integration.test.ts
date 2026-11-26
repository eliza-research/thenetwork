import { expect, test } from "vitest";
import type { MemberId } from "@thenetwork/core";
import { laneLimits } from "../../core/src/generated/matchLane.ts";
import { plantedEngineInput } from "../../sim/src/planted.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { canonicalInput } from "../src/engine.ts";
import { poolCircles, poolGraph } from "../src/group.ts";
import { buildCircles, repeatTables, type Circle, type CircleOptions } from "../src/match/circles.ts";
import type { MatchProfile } from "../src/match/profile.ts";
import { friendsPack } from "../src/packs/friends/index.ts";
import type { EngineInput } from "../src/types.ts";
import { World } from "../src/world.ts";

const plantedWorld = (seed: number, n = 200): { input: EngineInput; w: World } => {
  const input = canonicalInput(plantedEngineInput({ seed: `circles-${seed}`, n, lanes: ["Friend"], app: "friends" }).input);
  return { input, w: new World(input, resolveConfig({ seed }), localEmbed, friendsPack) };
};

const friends = laneLimits("Friend");

test("the run's circles value every pair at the floor and stay within the circle maximum", () => {
  for (const seed of [1, 2, 3]) {
    const { w } = plantedWorld(seed);
    const circles = w.match.circles("Friend");
    expect(circles.length).toBeGreaterThan(0);
    for (const circle of circles) {
      const members = circle.members.map(id => w.match.profile(id)!);
      expect(members.length).toBeLessThanOrEqual(friends.circleMaximum);
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        expect(w.match.value(members[i]!, members[j]!)).toBeGreaterThanOrEqual(friends.circlePairFloor);
      }
    }
  }
});

test("a past table whose members would meet again is kept together as a circle", () => {
  let kept = 0;
  for (const seed of [1, 2, 3, 4]) {
    const { input, w } = plantedWorld(seed);
    const together = (ids: readonly MemberId[], world: World) => {
      const own = world.match.profiles.filter(p => p.lane === "Friend").map(p => p.memberId);
      const graph = poolGraph(world, "Friend", own, (x, y) => { const v = world.match.value(x, y); return v >= 0 ? v : undefined; });
      return poolCircles(graph, [], friends.circleMinimum, friends.circleMaximum).some(c => ids.every(id => c.members.includes(id)));
    };
    const own = w.match.profiles.filter(p => p.lane === "Friend").sort((x, y) => x.ordinal - y.ordinal);
    const fits = (x: (typeof own)[number], y: (typeof own)[number]) => w.match.value(x, y) >= friends.circlePairFloor;
    let table: MemberId[] | undefined;
    for (let i = 0; i < own.length && !table; i++) {
      const group = [own[i]!];
      for (const p of own) if (group.length < 4 && !group.includes(p) && group.every(g => fits(g, p))) group.push(p);
      const ids = group.map(p => p.memberId);
      if (group.length === 4 && !together(ids, w)) table = ids;
    }
    if (!table) continue;
    const at = input.now - 3 * 86_400_000;
    const met: EngineInput = {
      ...input,
      interactions: [...(input.interactions ?? []), { id: `table-${seed}`, kind: "group", category: "social", participants: table, at, outcome: "completed" }],
      feedback: [...(input.feedback ?? []), ...table.flatMap(from => table!.filter(about => about !== from).map(about => ({
        id: `f-${seed}-${from}-${about}`, from, about, opportunityId: `table-${seed}`, at, sentiment: "positive" as const, wouldMeetAgain: true,
      })))],
    };
    const after = new World(met, resolveConfig({ seed }), localEmbed, friendsPack);
    const tables = repeatTables(after, id => after.match.profileIn(id, "Friend"));
    expect(tables).toHaveLength(1);
    const members = table.map(id => after.match.profileIn(id, "Friend")!);
    if (!members.every((x, i) => members.slice(i + 1).every(y => after.match.value(x, y) >= friends.circlePairFloor))) continue;
    expect(together(table, after)).toBe(true);
    kept++;
  }
  expect(kept).toBeGreaterThan(0);
});

const closeProfiles = (count: number): { w: World; profiles: MatchProfile[] } => {
  const { w } = plantedWorld(1);
  const own = w.match.profiles.filter(p => p.lane === "Friend" && p.capacity > 0).sort((x, y) => x.standing - y.standing || x.ordinal - y.ordinal);
  for (let i = 0; i + count <= own.length; i++) {
    const group = own.slice(i, i + count);
    const low = group[0]!, high = group[count - 1]!;
    if (new Set(group.map(p => p.memberId)).size === count && high.standing - low.standing <= friends.rules.parityBand + low.uncertainty + high.uncertainty) return { w, profiles: group };
  }
  throw new Error(`no ${count} Friend profiles within the standing band`);
};

const nameOf = (profiles: readonly MatchProfile[]) => (id: string) => String.fromCharCode(65 + profiles.findIndex(p => p.id === id || p.memberId === id));
const edgesOf = (profiles: readonly MatchProfile[], values: Readonly<Record<string, number>>) => Object.entries(values).map(([pair, value]) => {
  const [a, b] = [profiles[pair.charCodeAt(0) - 65]!.id, profiles[pair.charCodeAt(1) - 65]!.id];
  return { a, b, value, key: [a, b].sort().join("|") };
});
const buildWith = (
  profiles: readonly MatchProfile[], values: Readonly<Record<string, number>>, options: CircleOptions,
): readonly { readonly members: readonly string[]; readonly evidence: Circle["evidence"] }[] =>
  buildCircles(edgesOf(profiles, values), new Map(profiles.map(p => [p.id, p] as const)), friends, () => 1, options)
    .map(c => ({ ...c, members: c.members.map(nameOf(profiles)).sort() }));

const everyPair = (names: string, value: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) out[names[i]! + names[j]!] = value;
  return out;
};

test("the swap round moves a member to the circle where the lower of the two lowest pair values rises", () => {
  const { profiles } = closeProfiles(7);
  const values = { ...everyPair("ABC", 900), AD: 200, BD: 200, CD: 200, ...everyPair("EFG", 500), DE: 600, DF: 600, DG: 600 };
  const circles = buildWith(profiles, values, {});
  expect(circles.map(c => c.members.join("")).sort()).toEqual(["ABC", "DEFG"]);
  expect(circles.map(c => c.evidence.lowestPairValue).sort((x, y) => x - y)).toEqual([500, 900]);
  for (const c of circles) expect(c.evidence.pairCount).toBe((c.members.length * (c.members.length - 1)) / 2);
});

test("the swap round refuses a swap that raises the lower lowest pair value but lowers their sum", () => {
  const { profiles } = closeProfiles(6);
  const values = { ...everyPair("ABC", 900), DE: 300, DF: 600, EF: 600, AD: 400, BD: 400, CE: 350, CF: 350 };
  const circles = buildWith(profiles, values, {});
  expect(circles.map(c => c.members.join("")).sort()).toEqual(["ABC", "DEF"]);
  expect(circles.map(c => c.evidence.lowestPairValue).sort((x, y) => x - y)).toEqual([300, 900]);
});

test("a ranked build keeps the circle its plan ranked best: no swap replaces it", () => {
  const { profiles } = closeProfiles(7);
  const values = { ...everyPair("ABC", 900), AD: 200, BD: 200, CD: 200, ...everyPair("EFG", 500), DE: 600, DF: 600, DG: 600 };
  const name = nameOf(profiles);
  const rankCircle = (c: Circle) => (c.members.map(name).includes("A") && c.members.map(name).includes("D") ? 10 : 1);
  expect(buildWith(profiles, values, { rankCircle }).map(c => c.members.join("")).sort()).toEqual(["ABCD", "EFG"]);
});

test("a pool build with forced members keeps the greedy circle that holds them all: no swap splits them", () => {
  const { w, profiles } = closeProfiles(7);
  const values = {
    AB: 300, ...everyPair("ACD", 900), BC: 900, BD: 900, ...everyPair("EFG", 400), BE: 500, BF: 500, BG: 500, AE: 100, AF: 100, AG: 100,
  };
  const name = nameOf(profiles);
  const scored = new Map(edgesOf(profiles, values).map(e => [e.key, e.value] as const));
  const graph = poolGraph(w, "Friend", profiles.map(p => p.memberId), (_a, _b, key) => scored.get(key));
  const built = (forced: readonly string[]) => poolCircles(graph, forced.map(n => profiles[n.charCodeAt(0) - 65]!.memberId), 3, 6)
    .map(c => c.members.map(name).sort().join(""));
  expect(built(["A", "B"])).toEqual(["ABCD"]);
  expect(built(["A"])).toEqual(["ABCD"]);
  expect(built([]).sort()).toEqual(["ACD", "BEFG"]);
});
