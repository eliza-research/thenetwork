import { expect, test } from "vitest";
import { searchTouchesPerCheck } from "../../core/src/generated/candidateSearch.ts";
import { laneLimits } from "../../core/src/generated/matchLane.ts";
import { noPairValue } from "../../core/src/generated/pairValue.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { pairReason } from "../src/filters.ts";
import { bruteForceCandidates, eligiblePair, laneCategory, type PackVectors } from "../src/match/mod.ts";
import { networkPack } from "../src/packs/network/index.ts";
import { baseMember, emptyInput } from "../src/testkit.ts";
import { World } from "../src/world.ts";

test("candidate search can finish exactly with untagged pairs and still checks blocks", () => {
  // spec/candidateSearch.md, "The posting walk covers or bounds every partner in the window"
  // Both custom scoring terms make the existing Friend floor reachable without any shared tags.
  const input = emptyInput();
  input.members.push(baseMember("owner"), baseMember("adult-b"), baseMember("adult-a"), baseMember("blocked"), baseMember("minor", { age: 17 }));
  input.edges.push({ from: "owner", to: "blocked", type: "blocked", strength: 1, explicit: true, createdAt: input.now });
  const vectors: PackVectors = {
    memberships: (_w, id) => [{ id, lane: "Friend", side: "Peer", market: "sf", capacity: 3 }],
    tags: () => ({ interests: [], seeks: [], offers: [] }),
    standing: () => ({ standing: 50, uncertainty: 0 }),
    traits: { costs: [10], of: () => [0] },
    packValue: () => 1000,
  };
  const world = new World(input, resolveConfig({}), localEmbed, { ...networkPack, vectors });
  const profile = world.match.profileIn("owner", "Friend");
  if (!profile) throw new Error("missing Friend profile");

  const result = world.match.candidates(profile);
  expect(result.exact).toBe(true);
  expect(result.kept).toEqual(bruteForceCandidates(world, world.match.index, profile));
  expect(result.kept.map(candidate => [candidate.profile.memberId, candidate.value])).toEqual([["adult-a", 300], ["adult-b", 300]]);
  expect(world.match.profileIn("minor", "Friend")).toBeUndefined();
  expect(world.match.tally()).toMatchObject({ members: 1, exact: 1, checks: 3, touches: 4, empty: 0 });
  expect(world.match.searchOutcomes()).toEqual([]);
});

test("an exact search that keeps no candidate is a recorded empty outcome with its bound", () => {
  const input = emptyInput();
  input.members.push(baseMember("owner"), baseMember("blocked"));
  input.edges.push({ from: "owner", to: "blocked", type: "blocked", strength: 1, explicit: true, createdAt: input.now });
  const vectors: PackVectors = {
    memberships: (_w, id) => [{ id, lane: "Friend", side: "Peer", market: "sf", capacity: 3 }],
    tags: () => ({ interests: [], seeks: [], offers: [] }),
    standing: () => ({ standing: 50, uncertainty: 0 }),
    traits: { costs: [10], of: () => [0] },
    packValue: () => 1000,
  };
  const world = new World(input, resolveConfig({}), localEmbed, { ...networkPack, vectors });
  const profile = world.match.profileIn("owner", "Friend");
  if (!profile) throw new Error("missing Friend profile");

  const result = world.match.candidates(profile);
  expect(result).toMatchObject({ exact: true, kept: [] });
  expect(world.match.searchOutcomes()).toEqual([{ memberId: "owner", lane: "Friend", outcome: "empty", unseenBound: result.unseenBound }]);
});

test("an unfinished dense posting keeps a sound bound before spending the pair-check budget", () => {
  const budget = laneLimits("Intro").searchBudget;
  const touchLimit = searchTouchesPerCheck * budget;
  const input = emptyInput();
  input.members.push(baseMember("owner"), baseMember("winner"));
  for (let index = 0; index < touchLimit; index++) input.members.push(baseMember(`crowd-${index}`));
  const vectors: PackVectors = {
    memberships: (_w, id) => [{ id, lane: "Intro", side: "Peer", market: "sf", capacity: 3 }],
    standing: () => ({ standing: 50, uncertainty: 0 }),
    tags: (_w, entity) => ({
      interests: [],
      offers: entity.memberId === "owner" ? ["design"] : ["python"],
      seeks: entity.memberId === "owner" ? ["python"] : entity.memberId === "winner" ? ["design"] : ["design", "a", "b", "c", "d", "e"],
    }),
  };
  const world = new World(input, resolveConfig({}), localEmbed, { ...networkPack, vectors });
  const profile = world.match.profileIn("owner", "Intro");
  if (!profile) throw new Error("missing Intro profile");

  const result = world.match.candidates(profile);
  expect(result).toMatchObject({ exact: false, checks: 0, touches: touchLimit, kept: [] });
  const oracle = bruteForceCandidates(world, world.match.index, profile);
  expect(oracle.map(candidate => candidate.profile.memberId)).toEqual(["winner"]);
  expect(result.unseenBound).toBeGreaterThanOrEqual(oracle[0]!.value);
  expect(world.match.tally()).toEqual({
    members: 1, checks: 0, touches: touchLimit, exact: 0, budgeted: 1, empty: 1, largestUnseenBound: result.unseenBound,
    bounds: touchLimit, checksAfterSettled: 0, boundViolations: 0, packBoundViolations: 0, classCapViolations: 0, touchClosed: 1, checkClosed: 0, memoHits: 0, refusals: {},
  });
  expect(world.match.searchOutcomes()).toEqual([{ memberId: "owner", lane: "Intro", outcome: "budgeted", unseenBound: result.unseenBound }]);
});

/** Owner, a best partner with the same interests, and a nearer partner who shares fewer. */
function segmentWorld(bestReachesNorth: boolean): World {
  const input = emptyInput();
  input.members.push(baseMember("owner"), baseMember("best"), baseMember("near"));
  const interests: Record<string, string[]> = { owner: ["chess", "climbing", "jazz"], best: ["chess", "climbing", "jazz"], near: ["chess", "climbing"] };
  const segments: Record<string, { own: string; partners: string[] }> = {
    owner: { own: "north", partners: bestReachesNorth ? ["north", "south"] : ["north"] },
    best: { own: "south", partners: bestReachesNorth ? ["north", "south"] : ["south"] },
    near: { own: "north", partners: ["north"] },
  };
  const vectors: PackVectors = {
    memberships: (_w, id) => [{ id, lane: "Friend", side: "Peer", market: "sf", capacity: 3 }],
    tags: (_w, entity) => ({ interests: interests[entity.memberId]!, seeks: [], offers: [] }),
    standing: () => ({ standing: 50, uncertainty: 0 }),
    segment: (_w, entity) => segments[entity.memberId],
  };
  return new World(input, resolveConfig({}), localEmbed, { ...networkPack, vectors });
}

test("segment blocking skips a best candidate whose segment does not reach back, and the search still equals brute force", () => {
  // spec/candidateSearch.md, "Segment blocking never drops a pair the pair gate admits"
  const world = segmentWorld(false);
  const owner = world.match.profileIn("owner", "Friend"), best = world.match.profileIn("best", "Friend");
  if (!owner || !best) throw new Error("missing Friend profiles");
  expect(eligiblePair(world, owner, best)).toBe("segment_unreachable");
  expect(world.match.value(owner, best)).toBe(noPairValue);

  const result = world.match.candidates(owner);
  expect(result.exact).toBe(true);
  expect(result.kept).toEqual(bruteForceCandidates(world, world.match.index, owner));
  expect(result.kept.map(candidate => candidate.profile.memberId)).toEqual(["near"]);
  // Only the owner's own segment is read: the best candidate is never touched or checked.
  expect(world.match.tally()).toMatchObject({ members: 1, exact: 1, checks: 1, touches: 3 });
});

test("segments that reach each other keep the best candidate first", () => {
  // spec/candidateSearch.md, "Segment blocking never drops a pair the pair gate admits"
  const world = segmentWorld(true);
  const owner = world.match.profileIn("owner", "Friend"), best = world.match.profileIn("best", "Friend");
  if (!owner || !best) throw new Error("missing Friend profiles");
  expect(eligiblePair(world, owner, best)).toBeNull();

  const result = world.match.candidates(owner);
  expect(result.exact).toBe(true);
  expect(result.kept).toEqual(bruteForceCandidates(world, world.match.index, owner));
  expect(result.kept.map(candidate => candidate.profile.memberId)).toEqual(["best", "near"]);
  expect(world.match.tally()).toMatchObject({ members: 1, exact: 1, checks: 2 });
});

test("a search whose posting walk is spent closes as soon as no touched candidate can still enter", () => {
  const { searchLimit, searchBudget } = laneLimits("Intro");
  const input = emptyInput();
  input.members.push(baseMember("owner"));
  for (let index = 0; index < searchLimit; index++) input.members.push(baseMember(`best-${String(index).padStart(2, "0")}`));
  for (let index = 0; index < searchTouchesPerCheck * searchBudget; index++) input.members.push(baseMember(`crowd-${index}`));
  const vectors: PackVectors = {
    memberships: (_w, id) => [{ id, lane: "Intro", side: "Peer", market: "sf", capacity: 3 }],
    standing: () => ({ standing: 50, uncertainty: 0 }),
    tags: (_w, entity) => ({
      interests: [],
      offers: entity.memberId === "owner" ? ["design"] : ["python"],
      seeks: entity.memberId === "owner" ? ["python"] : entity.memberId.startsWith("best") ? ["design"] : ["design", "go"],
    }),
  };
  const world = new World(input, resolveConfig({}), localEmbed, { ...networkPack, vectors });
  const profile = world.match.profileIn("owner", "Intro");
  if (!profile) throw new Error("missing Intro profile");

  const result = world.match.candidates(profile);
  expect(result.exact).toBe(false);
  expect(result.kept).toEqual(bruteForceCandidates(world, world.match.index, profile));
  expect(result.checks).toBe(searchLimit);
  expect(world.match.tally()).toMatchObject({ members: 1, checks: searchLimit, touchClosed: 1, checkClosed: 0, checksAfterSettled: 0, boundViolations: 0 });
});

test("pack bounds, acceptance masks and the pair memo keep every search equal to brute force", () => {
  const ids = Array.from({ length: 30 }, (_, index) => `m-${String(index).padStart(2, "0")}`);
  const rank = (id: string) => Number(id.slice(2));
  const build = (withBound: boolean): World => {
    const input = emptyInput();
    input.members.push(...ids.map(id => baseMember(id)));
    const vectors: PackVectors = {
      memberships: (_w, id) => [{ id, lane: "Friend", side: "Peer", market: "sf", capacity: 3 }],
      tags: () => ({ interests: ["chess"], seeks: [], offers: [] }),
      standing: () => ({ standing: 50, uncertainty: 0 }),
      packValue: (_w, a, b) => (rank(a.memberId) * 7 + rank(b.memberId) * 13) % 1000,
      masks: (_w, entity) => [{ own: rank(entity.memberId) < 10 ? 1 : 2, accepts: entity.memberId === "m-00" ? 1 : 3 }],
      ...(withBound ? { packBound: (_w: unknown, a: { memberId: string }, b: { memberId: string }) => (rank(a.memberId) * 7 + rank(b.memberId) * 13) % 1000 } : {}),
    };
    return new World(input, resolveConfig({}), localEmbed, { ...networkPack, vectors });
  };
  const tallies = [false, true].map(withBound => {
    const world = build(withBound);
    const profiles = ids.map(id => world.match.profileIn(id, "Friend")!);
    for (const profile of profiles) {
      const result = world.match.candidates(profile);
      expect(result.exact).toBe(true);
      expect(result.kept).toEqual(bruteForceCandidates(world, world.match.index, profile));
    }
    const owner = profiles[0], banded = profiles[20];
    expect(eligiblePair(world, owner, banded)).toBe("mask_refused");
    expect(pairReason(world, owner.memberId, banded.memberId, laneCategory(owner.lane), owner.lane)).toBeNull();
    return world.match.tally();
  });
  for (const tally of tallies) {
    expect(tally).toMatchObject({ members: ids.length, exact: ids.length, boundViolations: 0, packBoundViolations: 0, classCapViolations: 0, checksAfterSettled: 0 });
    expect(tally.refusals?.mask_refused).toBeGreaterThan(0);
    expect(tally.memoHits).toBeGreaterThan(0);
  }
  expect(tallies[1].checks).toBeLessThan(tallies[0].checks);
});
