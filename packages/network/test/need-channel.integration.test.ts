// Retrieval need channel (engine sections 14.2 and 33.5). A member who can do the thing the
// intent asks for is kept even when their text embedding is below minSim. Interest overlap
// alone is not enough to pass that bar. The engine runs with its default config. No model call.
import { expect, test } from "bun:test";
import { DAY, type Category, type Facet } from "@thenetwork/core";
import { localEmbed, networkPack, runEngine, type EngineInput } from "@thenetwork/engine";

const now = Date.UTC(2026, 9, 5, 16);
const prefs = {
  categoriesOptIn: ["hobby", "social", "professional", "help", "events"] as Category[],
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
// A stored embedding that does not contain the skill tag. A real embedding model can score
// this below minSim while the tag still names the skill the intent needs.
const unlike = localEmbed("quark lattice neutrino spectrometer calibration protocol");

function world(boFacets: Facet[]): EngineInput {
  return {
    now,
    members: [person("ada", "Ada"), person("bo", "Bo")],
    facets: [
      { id: "ada-skill", memberId: "ada", kind: "skill", value: "reviews startup pitch decks and fundraising stories", tags: ["pitch_feedback"], scope: "shareable", provenance: "said", confidence: 0.9 },
      ...boFacets,
    ],
    intents: [
      { id: "ada-intent", memberId: "ada", objective: "learn sailing this season", category: "hobby", horizonDays: 60, status: "active", createdAt: now - DAY },
    ],
    presence: [
      { memberId: "ada", city: "nyc", type: "home", areas: ["williamsburg"] },
      { memberId: "bo", city: "nyc", type: "home", areas: ["williamsburg"] },
    ],
    edges: [],
    recentProposals: [],
  };
}

const pitchWant: Facet = {
  id: "bo-want", memberId: "bo", kind: "desire", value: "wants feedback on a pitch deck", tags: ["deck_notes"], scope: "shareable", provenance: "said", confidence: 0.9,
};

test("a skill the intent needs is proposed when the embedding is below minSim", async () => {
  const input = world([
    { id: "bo-offer", memberId: "bo", kind: "offer", value: "lattice clock calibration for deep space probes", tags: ["sailing_instructor"], scope: "shareable", provenance: "said", confidence: 0.9, embedding: unlike },
    pitchWant,
  ]);
  const { proposals } = await runEngine(input, { seed: 1, cities: ["nyc"] }, { pack: networkPack });
  const pair = proposals.filter(p => p.participants.includes("ada") && p.participants.includes("bo"));
  expect(pair.map(p => p.generator)).toEqual(["intent_to_capability"]);
  expect(pair[0]!.channels).toEqual(["need"]);
});

test("interest overlap below minSim does not open the need channel", async () => {
  const input = world([
    { id: "bo-like", memberId: "bo", kind: "interest", value: "weekend water and boats", tags: ["sailing"], scope: "shareable", provenance: "said", confidence: 0.9, embedding: unlike },
    pitchWant,
  ]);
  const { proposals } = await runEngine(input, { seed: 1, cities: ["nyc"] }, { pack: networkPack });
  expect(proposals.filter(p => p.participants.includes("ada") && p.participants.includes("bo"))).toEqual([]);
});
