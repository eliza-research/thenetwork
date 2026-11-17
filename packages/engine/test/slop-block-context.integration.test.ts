import { DAY, type Edge } from "@thenetwork/core";
import { expect, test } from "vitest";
import { localEmbed } from "../src/embed.ts";
import { memberReason, pairReason } from "../src/filters.ts";
import { slopPack, SLOP_ENGINE_DEFAULTS } from "../src/packs/slop/index.ts";
import { slopHardPairCurrent } from "../src/packs/slop/rules.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { InteractionRecord } from "../src/types.ts";
import { World } from "../src/world.ts";

// spec/datingRadius.md, "Only encounter-backed blocks inform a member review"
test.each(["unrelated", "later", "same_member", "prior"] as const)("Slop separates a pair block from contextual review: %s", context => {
  const input = emptyInput();
  for (const id of ["member", "unrelated", "counterpart-one", "counterpart-two"]) {
    const gender = id === "member" ? "woman" : "man";
    const seeks = gender === "woman" ? "man" : "woman";
    input.members.push(baseMember(id, { homeCity: "nyc", prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }));
    input.facets.push(facet(id, 0, "preference", "Private dating preferences", [
      `romance:is:${gender}`, `romance:seeks:${seeks}`, "romance:age:18-65", "slop:zip:11222", "slop:max_miles:10",
    ], "agent_private"));
  }
  const first = "counterpart-one";
  const second = context === "same_member" ? first : "counterpart-two";
  const blockedAt = input.now - 2 * DAY;
  input.edges = [first, second].map((from): Edge => ({
    from, to: "member", type: "blocked", createdAt: blockedAt, explicit: true, strength: 1,
  }));
  input.interactions = context === "unrelated" ? [] : [first, second].map((other, i): InteractionRecord => ({
    id: `encounter-${i}`, kind: "intro", category: "romance", participants: ["member", other], outcome: "completed",
    at: blockedAt + (context === "later" ? DAY : -DAY),
  }));

  const world = new World(input, SLOP_ENGINE_DEFAULTS, localEmbed, slopPack);
  const member = memberReason(world, "member", { role: "peer", category: "romance", lane: "Date", format: "one_to_one", timeSensitive: false });
  expect(member).toBe(context === "prior" ? "trust_review" : null);
  expect(pairReason(world, "member", first, "romance", "Date")).toBe("blocked");
  expect(pairReason(world, "member", "unrelated", "romance", "Date")).toBeNull();
  expect(slopHardPairCurrent(input, ["member", "unrelated"], "nyc")).toBe(context !== "prior");
});
