import { expect, test } from "vitest";
import { DAY, HOUR, type City, type Presence } from "@thenetwork/core";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { friendsPack } from "../src/packs/friends/index.ts";
import { networkPack } from "../src/packs/network/index.ts";
import { computeComponents } from "../src/scoring.ts";
import { randomWorld } from "../src/testkit.ts";
import type { Candidate } from "../src/types.ts";
import { World } from "../src/world.ts";

test.each([networkPack, friendsPack])("$id scores a shared area during the meeting window", pack => {
  // spec/travelPresence.md, "Shared areas lower cost only during the meeting window"
  const input = randomWorld({ members: 2, seed: 83, minors: false, aliases: false });
  const [a, b] = input.members.map(member => member.id) as [string, string];
  input.members = input.members.map(member => ({ ...member, homeCity: "nyc", prefs: { ...member.prefs, maxTravelMinutes: 45 } }));
  const start = input.now + DAY, end = start + 2 * HOUR, midpoint = start + HOUR;
  const west = "Upper West Side";
  const homes: Presence[] = [
    { memberId: a, city: "nyc", type: "home", areas: [west] },
    { memberId: b, city: "nyc", type: "home", areas: ["Bushwick"] },
  ];
  const visit = (memberId: string, city: City, area: string, from?: number, to?: number): Presence =>
    ({ memberId, city, type: "temporary", areas: [area], from, to });
  const candidate: Candidate = {
    key: "window-locality", kind: "intro", generator: "shared_intent", category: "social", participants: [a, b],
    roles: { [a]: "peer", [b]: "peer" }, format: "one_to_one", objective: "coffee", city: "nyc",
    fixedWindow: true, window: { start, end }, channels: new Set(["semantic"]), evidence: {},
    fit: 1, benefit: { [a]: 1, [b]: 1 }, warm: 0, alternates: [], exploration: false,
    safetyClass: "low", timeSensitive: false, riskText: "",
  };
  const score = (extra: Presence[], withWindow = true) =>
    computeComponents(new World({ ...input, presence: [...homes, ...extra] }, resolveConfig(), localEmbed, pack),
      withWindow ? candidate : { ...candidate, window: undefined });
  const late = [visit(b, "nyc", west, end + DAY, end + 2 * DAY)];
  const baseline = score([]);
  expect(baseline.activationCost).toBe(0.3);
  expect(score(late)).toEqual(baseline);
  expect(score([visit(b, "nyc", west, start - DAY, start)])).toEqual(baseline);
  expect(score([visit(b, "nyc", west, start, end)])).toEqual({ ...baseline, activationCost: 0.1 });
  expect(score([visit(b, "nyc", west, midpoint, end)]).activationCost).toBe(0.1);
  expect(score([visit(a, "nyc", "Queens", midpoint, end), visit(b, "nyc", west, midpoint, end)])).toEqual(baseline);
  expect(score([visit(a, "sf", "Mission", midpoint, end), visit(b, "nyc", west, midpoint, end)])).toEqual(baseline);
  expect(score([visit(b, "nyc", west, undefined, end)])).toEqual(baseline);
  expect(score([visit(b, "nyc", west, end, start)])).toEqual(baseline);
  expect(score(late, false).activationCost).toBe(0.1);
});
