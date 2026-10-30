// Expansion scores every desire outside the member's cluster. A desire stored first, with no
// provider above minSim, must not hide a later desire that does have a provider. The best
// similarity wins. No model call. The engine uses its default config (seed 1, city nyc).
import { DAY, EngineRng as Rng, type Category } from "../../packages/core/src/index.ts";
import { buildWorld, localEmbed, resolveConfig, runEngine, type EngineInput } from "../../packages/engine/src/index.ts";
import { expansion } from "../../packages/engine/src/packs/network/generators.ts";
import type { Block } from "./gate.ts";
import { expect } from "./gate.ts";

const now = Date.UTC(2026, 9, 5, 16);
const categories: Category[] = ["hobby", "social", "professional", "help", "events"];
const prefs = {
  categoriesOptIn: categories,
  quietHours: [22, 8] as [number, number],
  romanceOptIn: false,
  formats: ["one_to_one" as const, "small_group" as const],
  maxTravelMinutes: 45,
  onlyWhenAsked: false,
};

const person = (id: string, name: string) => ({
  id, name, homeCity: "nyc" as const, state: "open" as const, prefs,
  joinedAt: now - 60 * DAY, age: 32, unansweredProactive: 0,
});

type Kind = "interest" | "desire" | "offer";
const facet = (id: string, memberId: string, kind: Kind, value: string, tags: string[]) => ({
  id, memberId, kind, value, tags, scope: "shareable" as const, provenance: "said" as const, confidence: 0.9,
});

const PHYSICS = "quark lattice neutrino spectrometer calibration protocol";
const SAIL_WANT = "learn to sail on the bay this season";
const SAIL_OFFER = "certified sailing instructor teaches beginners on the bay";

/** "later": the first stored desire has no provider. "best": that desire is also the strongest. "none": nothing clears minSim. */
export function expansionDesireInput(mode: "later" | "best" | "none"): EngineInput {
  const adaDesires = mode === "none"
    ? [
        facet("ada-physics", "ada", "desire", PHYSICS, ["physics"]),
        facet("ada-sail", "ada", "desire", "unrelated glacier ice core chronology", ["glacier"]),
      ]
    : [
        facet("ada-physics", "ada", "desire", PHYSICS, ["physics"]),
        facet("ada-sail", "ada", "desire", SAIL_WANT, ["sailing"]),
      ];
  const boOffer = mode === "none"
    ? facet("bo-pot", "bo", "offer", "studio pottery wheel and kiln firing", ["pottery"])
    : facet("bo-sail", "bo", "offer", SAIL_OFFER, ["sailing_instructor"]);
  const members = [person("ada", "Ada"), person("bo", "Bo")];
  const facets = [
    facet("ada-run-1", "ada", "interest", "running trails every morning", ["running"]),
    facet("ada-run-2", "ada", "interest", "marathon training and long runs", ["running"]),
    facet("ada-run-3", "ada", "interest", "weekend running club", ["running"]),
    ...adaDesires,
    facet("bo-cer-1", "bo", "interest", "pottery and ceramics studio", ["ceramics"]),
    facet("bo-cer-2", "bo", "interest", "wheel throwing ceramics", ["ceramics"]),
    facet("bo-cer-3", "bo", "interest", "glaze chemistry ceramics", ["ceramics"]),
    boOffer,
  ];
  if (mode === "best") {
    members.push(person("cy", "Cy"));
    facets.push(
      facet("cy-cer-1", "cy", "interest", "pottery and ceramics studio", ["ceramics"]),
      facet("cy-cer-2", "cy", "interest", "wheel throwing ceramics", ["ceramics"]),
      facet("cy-cer-3", "cy", "interest", "glaze chemistry ceramics", ["ceramics"]),
      facet("cy-physics", "cy", "offer", PHYSICS, ["physics_lab"]),
    );
  }
  return {
    now,
    members,
    facets,
    intents: [],
    presence: members.map(m => ({ memberId: m.id, city: "nyc" as const, type: "home" as const, areas: ["williamsburg"] })),
    edges: [],
    recentProposals: [],
  };
}

export function expansionFor(input: EngineInput) {
  const w = buildWorld(input, resolveConfig({ seed: 1, cities: ["nyc"] }), localEmbed);
  return expansion({ w, memberExclusions: {}, rng: new Rng(1), unmatchedIntents: new Set() });
}

export async function expansionDesireGate(b: Block): Promise<void> {
  await b.run("engine: expansion uses a later desire when the first has no provider above minSim", () => {
    const out = expansionFor(expansionDesireInput("later"));
    expect(out.map(c => c.participants)).toEqual([["ada", "bo"]]);
    expect(out[0]!.evidence.ada).toEqual(["ada-sail"]);
    expect(out[0]!.evidence.bo).toEqual(["bo-sail"]);
  });
  await b.run("engine: expansion keeps the stronger desire when it is stored first", () => {
    const out = expansionFor(expansionDesireInput("best"));
    expect(out.map(c => c.participants)).toEqual([["ada", "cy"]]);
    expect(out[0]!.evidence.ada).toEqual(["ada-physics"]);
    expect(out[0]!.evidence.cy).toEqual(["cy-physics"]);
  });
  await b.run("engine: expansion proposes nothing when no outside desire clears minSim", () => {
    expect(expansionFor(expansionDesireInput("none"))).toEqual([]);
  });
  await b.run("engine: the later-desire expansion passes hard filters and score floors", async () => {
    const { runLog } = await runEngine(expansionDesireInput("later"), { seed: 1, cities: ["nyc"] });
    expect(runLog.funnel.byGenerator.expansion).toBe(1);
    const row = runLog.scored.filter(s => s.generator === "expansion");
    expect(row.map(s => s.participants)).toEqual([["ada", "bo"]]);
    expect(row[0]!.eligible).toBe(true);
  });
}
