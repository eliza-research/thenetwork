// Sim gate for the second-encounter repetition fix: in computeComponents, the
// recent-proposal branch penalised every pair proposed within 30 days with
// repetition = 0.6, including second_encounter candidates — the very follow-ups
// the second_encounter generator exists to create (it only fires after a
// completed, mutually positive meeting within 60 days, whose original proposal
// is typically still within 30 days). The completed-interaction branch already
// exempted second_encounter; the recent-proposal branch did not, so a canonical
// second encounter scored repetition = 0.6, identical to a plain intro. This
// gate fails before the fix and passes after it. It is a sim gate, not a unit
// test: it runs inside `bun run sim --only network` via the network block.
import { DAY, type Member } from "../../packages/core/src/index.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { computeComponents } from "../../packages/engine/src/scoring.ts";
import type { EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { Block, expect } from "./gate.ts";

const NOW = Date.UTC(2026, 9, 5, 16);

function member(id: string): Member {
  return {
    id, name: id, homeCity: "sf", state: "normal",
    prefs: {
      categoriesOptIn: ["social"], quietHours: [22, 8], romanceOptIn: false,
      formats: ["one_to_one"], maxTravelMinutes: 60, onlyWhenAsked: false,
    },
    joinedAt: NOW - 30 * DAY, age: 30, unansweredProactive: 0,
  };
}

function world(): World {
  const input: EngineInput = {
    now: NOW,
    members: [member("a"), member("b")],
    facets: [], intents: [], presence: [], edges: [],
    recentProposals: [{
      id: "p1", kind: "intro", participants: ["a", "b"], alternates: [],
      objective: "x", city: "sf", score: 0, components: null as any,
      exploration: false, explanations: {}, generator: "intro", createdAt: NOW - 10 * DAY,
    }],
    interactions: [{
      id: "i1", kind: "intro", category: "social", participants: ["a", "b"],
      at: NOW - 5 * DAY, outcome: "completed",
    }],
  };
  return new World(input, resolveConfig(), localEmbed);
}

function candidate(kind: string): any {
  return {
    key: "k", kind, generator: "second_encounter", category: "social",
    participants: ["a", "b"], roles: { a: "peer", b: "peer" }, format: "one_to_one",
    objective: "again", channels: new Set(["history"]), evidence: {},
    fit: 0.8, benefit: { a: 0.8, b: 0.8 }, warm: 1, alternates: [],
    exploration: false, safetyClass: "low", timeSensitive: false, riskText: "",
    confidenceHint: 0.95,
  };
}

export async function secondEncounterGate(b: Block): Promise<void> {
  await b.run("engine: a second encounter is not penalised for its own recent proposal", () => {
    expect(computeComponents(world(), candidate("second_encounter")).repetition).toBe(0);
  });

  await b.run("engine: a plain intro with the same recent proposal still pays the repetition penalty (control)", () => {
    expect(computeComponents(world(), candidate("intro")).repetition).toBe(0.6);
  });
}
