import { expect, test } from "vitest";
import { searchTouchesPerCheck } from "../../core/src/generated/candidateSearch.ts";
import { laneLimits } from "../../core/src/generated/matchLane.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { bruteForceCandidates, type PackVectors } from "../src/match/mod.ts";
import { networkPack } from "../src/packs/network/index.ts";
import { baseMember, emptyInput } from "../src/testkit.ts";
import { World } from "../src/world.ts";

test("candidate search can finish exactly with untagged pairs and still checks blocks", () => {
  // spec/candidateSearch.md, "The posting walk covers or bounds every partner in the window"
  // Date is the one lane without lawNoSharedTagStaysBelowFloor (spec/matchLane.md): both custom
  // scoring terms reach its floor without any shared tags, so the shell walks the whole window.
  const input = emptyInput();
  const dating = { prefs: { romanceOptIn: true, categoriesOptIn: ["romance" as const] } };
  input.members.push(baseMember("owner", dating), baseMember("adult-b", dating), baseMember("adult-a", dating), baseMember("blocked", dating), baseMember("minor", { age: 17, ...dating }));
  input.edges.push({ from: "owner", to: "blocked", type: "blocked", strength: 1, explicit: true, createdAt: input.now });
  const vectors: PackVectors = {
    memberships: (_w, id) => [{ id, lane: "Date", side: "Peer", market: "sf", capacity: 3 }],
    tags: () => ({ interests: [], seeks: [], offers: [] }),
    standing: () => ({ standing: 50, uncertainty: 0 }),
    traits: { costs: [10], of: () => [0] },
    packValue: () => 1000,
  };
  // The members opted in to romance and stated no constraints (networkPack romance_incompatible).
  const world = new World(input, resolveConfig({ romance: { requireStatedPrefs: false } }), localEmbed, { ...networkPack, id: "slop", vectors });
  const profile = world.match.profileIn("owner", "Date");
  if (!profile) throw new Error("missing Date profile");

  const result = world.match.candidates(profile);
  expect(result.exact).toBe(true);
  expect(result.kept).toEqual(bruteForceCandidates(world, world.match.index, profile));
  expect(result.kept.map(candidate => [candidate.profile.memberId, candidate.value])).toEqual([["adult-a", 500], ["adult-b", 500]]);
  expect(world.match.profileIn("minor", "Date")).toBeUndefined();
  expect(world.match.tally()).toMatchObject({ members: 1, exact: 1, checks: 3, touches: 4, empty: 0 });
});

test("an unfinished dense posting keeps a sound bound before spending the pair-check budget", () => {
  // spec/candidateSearch.md, "A search that spends its budget or its posting walk before it is exact reports the value it may have missed"
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
  expect(world.match.tally()).toEqual({ members: 1, checks: 0, touches: touchLimit, exact: 0, budgeted: 1, empty: 1, largestUnseenBound: result.unseenBound });
});
