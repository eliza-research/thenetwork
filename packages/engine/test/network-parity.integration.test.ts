// The Intro lane's standing band through every ntwrk generator (spec/pairValue.md, "A pair needs
// both utilities over the floor and a standing gap within the band"): two adults whose asks and
// offers complement each other but whose private standing gap is beyond the band plus both
// uncertainties are never put in one candidate; a control pair inside the band is introduced.
import { expect, test } from "vitest";
import { DAY, EngineRng as Rng, type Facet, type MemberId } from "@thenetwork/core";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import type { GenCtx } from "../src/genkit.ts";
import { NETWORK_GENERATORS } from "../src/packs/network/generators.ts";
import type { EngineInput } from "../src/types.ts";
import { World } from "../src/world.ts";

const NOW = Date.UTC(2026, 10, 2, 12);

/** One adult who asks for `seeks`, offers `offers`, and has one verified standing fact worth `evidence` points. */
function addMember(input: EngineInput, id: MemberId, o: { seeks: string; offers: string; evidence: number }) {
  input.members.push({ id, name: `Synthetic ${id}`, age: 30, homeCity: "nyc", state: "open", joinedAt: NOW - 40 * DAY, unansweredProactive: 0,
    prefs: { categoriesOptIn: ["professional"], quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false } });
  input.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["manhattan"] });
  const add = (kind: Facet["kind"], tags: string[], value: string, extra: Partial<Facet> = {}) =>
    input.facets.push({ id: `${id}-f${input.facets.length}`, memberId: id, kind, value, tags, scope: "shareable", confidence: 1, provenance: "said", ...extra });
  add("desire", [o.seeks], `Wants help with ${o.seeks}`);
  add("skill", [o.offers], `Knows ${o.offers}`);
  add("fact", ["lane:Intro", `evidence:${o.evidence}`], "Verified track record",
    { scope: "matchable", provenance: "connected_source", confirmedByMember: true });
  input.intents.push({ id: `${id}-intent`, memberId: id, category: "professional", objective: "Professional introduction", status: "active", createdAt: NOW - DAY, horizonDays: 30 });
}

test("an Intro pair beyond the standing band gets no candidate; a pair inside the band does", () => {
  const input: EngineInput = { now: NOW, members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [], interactions: [] };
  // One reviewed fact each: uncertainty 18. Gap 70 > band 20 + 18 + 18.
  addMember(input, "far-high", { seeks: "python", offers: "sql", evidence: 90 });
  addMember(input, "far-low", { seeks: "sql", offers: "python", evidence: 20 });
  // Gap 5, inside the band, with the far pair's tags: the standing gap is the only difference.
  addMember(input, "near-a", { seeks: "python", offers: "sql", evidence: 50 });
  addMember(input, "near-b", { seeks: "sql", offers: "python", evidence: 45 });
  for (const seed of [1, 2]) {
    const w = new World(input, resolveConfig({ seed }), localEmbed);
    for (const id of ["far-high", "far-low", "near-a", "near-b"]) expect(w.match.profilesOf(id).some(p => p.lane === "Intro")).toBe(true);
    const ctx: GenCtx = { w, memberExclusions: {}, rng: new Rng(seed).fork("gen"), unmatchedIntents: new Set() };
    const candidates = NETWORK_GENERATORS.flatMap(g => g.run(ctx));
    const together = (a: MemberId, b: MemberId) => candidates.filter(c => {
      const involved = new Set([...c.participants, ...c.alternates, ...(c.via ? [c.via] : [])]);
      return involved.has(a) && involved.has(b);
    });
    expect(together("far-high", "far-low")).toEqual([]);
    expect(together("near-a", "near-b").some(c => c.generator === "intent_to_capability" && c.lane === "Intro")).toBe(true);
  }
});
