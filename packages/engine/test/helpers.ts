import type { ChatMessage, Facet, Intent, LLM, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { resolveConfig, type EngineConfigInput } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { Candidate, EngineInput, EngineProposal } from "../src/types.ts";
import { World } from "../src/world.ts";

export const NOW = Date.UTC(2026, 9, 5, 16);
export { baseMember, emptyInput, facet };

export function mkWorld(input: EngineInput, cfg: EngineConfigInput = {}) {
  return new World(input, resolveConfig(cfg), localEmbed);
}

export function cand(participants: MemberId[], over: Partial<Candidate> = {}): Candidate {
  return {
    key: `test:${participants.join(",")}`, kind: "intro", generator: "test", category: "social",
    participants, roles: Object.fromEntries(participants.map(p => [p, "peer"])), format: "one_to_one",
    objective: "Intro", channels: new Set(["semantic"]), evidence: {}, fit: 0.6,
    benefit: Object.fromEntries(participants.map(p => [p, 0.6])), warm: 0, alternates: [], exploration: false,
    safetyClass: "low", timeSensitive: false, riskText: "coffee chat", ...over,
  };
}

/** A two-person world where a wants to learn sailing and b teaches sailing. */
export function sailingPair(): EngineInput {
  const inp = emptyInput(NOW);
  inp.members.push(baseMember("a"), baseMember("b"));
  inp.presence.push({ memberId: "a", city: "sf", type: "home", areas: ["mission"] }, { memberId: "b", city: "sf", type: "home", areas: ["mission"] });
  inp.facets.push(
    facet("a", 0, "interest", "sailing on the bay and the ocean", ["sailing"]),
    facet("b", 0, "offer", "teaches sailing to beginners", ["sailing"]),
    facet("b", 1, "interest", "sailing on the bay", ["sailing"]),
  );
  inp.intents.push(intent("a", "learn sailing this season", "hobby"));
  return inp;
}

export function intent(memberId: string, objective: string, category: Intent["category"], over: Partial<Intent> = {}): Intent {
  return { id: `${memberId}-i${objective.length}`, memberId, objective, category, horizonDays: 60, status: "active", createdAt: NOW - DAY, ...over };
}

export function addFacets(inp: EngineInput, fs: Facet[]) { inp.facets.push(...fs); return inp; }

/** Resolve an id through aliases (independently of the engine). */
export function resolver(inp: EngineInput) {
  const ids = new Set(inp.members.map(m => m.id));
  return (id: string) => { let c = id; for (let i = 0; i < 8 && !ids.has(c) && inp.idAliases?.[c]; i++) c = inp.idAliases[c]!; return c; };
}

export function proposalsJson(ps: EngineProposal[]) { return JSON.stringify(ps); }

export class FakeLLM implements LLM {
  calls = 0;
  lastMessages: ChatMessage[] = [];
  constructor(private reply: (msgs: ChatMessage[]) => string) {}
  async chat(messages: ChatMessage[]) { this.calls++; this.lastMessages = messages; return this.reply(messages); }
}
export const verdictJson = (o: Partial<Record<string, unknown>> = {}, refs = ["P1", "P2"]) => JSON.stringify({
  fit: 5, mutual_value: 5, capacity_realism: 5, timing: 5, social_comfort: 5, red_flags: 1, certainty: 5,
  dealbreaker: false, dealbreaker_reason: "", why: Object.fromEntries(refs.map(r => [r, "You both love being out on the water."])), ...o,
});

