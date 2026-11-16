import type { Facet } from "@thenetwork/core";
import { expect, test } from "vitest";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import { World } from "../src/world.ts";

test("ordinary standing follows the current app, lane, and owner-approved matching scope", () => {
  const id = "member";
  const input = emptyInput();
  input.members.push(baseMember(id));
  input.facets.push(facet(id, 0, "goal", "Find a cofounder", ["lane:Cofounder"], "matchable"));
  const base = facet(id, 1, "fact", "Work track record", ["lane:Cofounder", "evidence:40"], "matchable");
  const profileWith = (changes: Partial<Facet>) => {
    const world = new World({ ...input, facets: [...input.facets, { ...base, ...changes }] }, resolveConfig({}), localEmbed);
    return world.match.profilesOf(id).find(profile => profile.lane === "Cofounder");
  };

  expect(profileWith({})).toMatchObject({ standing: 20, uncertainty: 20 });
  expect(profileWith({ provenance: "connected_source", confirmedByMember: true })).toMatchObject({ standing: 40, uncertainty: 18 });
  for (const excluded of [
    { scope: "agent_private" }, { scope: "opportunity_specific" }, { app: "peon" },
    { provenance: "connected_source" }, { inferred: true }, { sensitive: "health" },
    { validTo: input.now - 1 }, { tags: ["lane:Invest", "evidence:40"] },
  ] satisfies Partial<Facet>[]) {
    expect(profileWith(excluded)).toMatchObject({ standing: 0, uncertainty: 20 });
  }
});
