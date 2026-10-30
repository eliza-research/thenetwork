// Sim gate for the World alias canonicalisation fix: the World constructor
// promises every identifier is mapped into ONE id space (ME-006) before any
// filter runs. The interactions mapping canonicalised participants, declinedBy
// and contributors — but not acceptedBy / noResponse — so responseHistory
// bumped the raw alias id and acceptanceOf (looked up by canonical member id)
// never saw it. This gate fails before the fix and passes after it.
// It is a sim gate, not a unit test: it runs inside `bun run sim --only network`
// via the network block.
import { DAY, type Member } from "../../packages/core/src/index.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
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

function worldWith(interaction: EngineInput["interactions"] extends (infer T)[] | undefined ? T : never): World {
  const input: EngineInput = {
    now: NOW,
    members: [member("a"), member("b")],
    facets: [], intents: [], presence: [], edges: [],
    recentProposals: [],
    idAliases: { oldA: "a" },
    interactions: [interaction],
  };
  return new World(input, resolveConfig(), localEmbed);
}

const approx = (v: number, want: number) => Math.abs(v - want) < 1e-9;

export async function worldAliasGate(b: Block): Promise<void> {
  await b.run("engine: acceptedBy under an alias counts toward the canonical member's acceptance", () => {
    const w = worldWith({
      id: "i1", kind: "intro", category: "social", participants: ["a", "b"],
      at: NOW - DAY, outcome: "completed", acceptedBy: ["oldA"],
    });
    // Prior 0.45, strength 2 (config defaults): (1 + 0.9) / (1 + 2) = 0.6333...
    expect(approx(w.members.get("a")!.acceptance, (1 + 0.45 * 2) / 3)).toBe(true);
  });

  await b.run("engine: noResponse under an alias counts toward the canonical member's denominator", () => {
    const w = worldWith({
      id: "i1", kind: "intro", category: "social", participants: ["a", "b"],
      at: NOW - DAY, outcome: "completed", noResponse: ["oldA"],
    });
    // (0 + 0.9) / (1 + 2) = 0.3, not the prior-only 0.45.
    expect(approx(w.members.get("a")!.acceptance, 0.9 / 3)).toBe(true);
  });

  await b.run("engine: acceptedBy under the canonical id still counts (control)", () => {
    const w = worldWith({
      id: "i1", kind: "intro", category: "social", participants: ["a", "b"],
      at: NOW - DAY, outcome: "completed", acceptedBy: ["a"],
    });
    expect(approx(w.members.get("a")!.acceptance, (1 + 0.45 * 2) / 3)).toBe(true);
  });

  await b.run("engine: no history still gives the prior (control)", () => {
    const w = worldWith({
      id: "i1", kind: "intro", category: "social", participants: ["a", "b"],
      at: NOW - DAY, outcome: "completed",
    });
    expect(approx(w.members.get("a")!.acceptance, 0.45)).toBe(true);
  });
}
