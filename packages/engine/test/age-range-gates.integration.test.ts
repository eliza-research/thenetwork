import { DAY } from "@thenetwork/core";
import { expect, test } from "vitest";
import { defaultCadence, itemGate, type MemberAttention } from "../src/attention.ts";
import type { AppPack } from "../src/pack.ts";
import { networkPack } from "../src/packs/network/index.ts";
import { peonSeats, seatOwnerOf } from "../src/packs/peon/seats.ts";
import { peonTestWorld } from "../src/packs/peon/testkit.ts";
import { slopPack } from "../src/packs/slop/index.ts";
import type { AttentionItem } from "../src/types.ts";

const NOW = Date.UTC(2026, 9, 12, 12);
const soloRomance: AttentionItem = {
  id: "item", memberId: "member", kind: "place_suggestion", category: "romance", others: [], involvesMember: false,
  effort: "meet_short", enjoy: 0.9, accept: 0.5, urgency: { expiresAt: NOW + DAY }, createdAt: NOW, reviewState: "not_needed", key: "item",
};
const memberAged = (age: number): MemberAttention => ({
  memberId: "member", state: "open", age, tz: "America/New_York", quietHours: [22, 8], onlyWhenAsked: false,
  prefs: defaultCadence("open"), categoriesOptIn: ["romance"],
});

test.each<[string, AppPack]>([["slop", slopPack], ["network", networkPack]])("the %s romance item gate refuses an age outside the human range", (_app, pack) => {
  expect(itemGate(memberAged(30), soloRomance, NOW, pack.attention.config, pack)).toBeNull();
  for (const age of [150, 17, Number.NaN]) expect(itemGate(memberAged(age), soloRomance, NOW, pack.attention.config, pack)).toBe("romance_not_allowed");
});

test("a hiring manager with an age outside the human range gets no job seat", () => {
  const input = peonTestWorld({ seed: 1, jobs: 4, candidates: 8, now: NOW });
  const [outOfRange, adult] = input.members.filter(m => m.id.startsWith("j"));
  outOfRange!.age = 150;
  const owners = new Set(peonSeats(input).members.map(seatOwnerOf).filter(owner => owner !== undefined));
  expect(owners.has(outOfRange!.id)).toBe(false);
  expect(owners.has(adult!.id)).toBe(true);
});
