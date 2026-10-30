// Sim gate for the home-entry vacuous-truth fix: the F14 home-entry rule requires
// 2+ helpers, or helpers who already met the requester. `helpers.every(...)` on an
// empty helper list is vacuously true, so a help candidate with NO helpers at all
// used to pass the rule and be marked medium-safety. This gate fails before the fix
// (solo help + home-entry text passes with null) and passes after it (rejected
// with home_entry_rule). It is a sim gate, not a unit test: it runs inside
// `bun run sim --only network` via the network block.
import { DAY, type Member } from "../../packages/core/src/index.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { candidateReason } from "../../packages/engine/src/filters.ts";
import type { EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { Block, expect } from "./gate.ts";

const NOW = Date.UTC(2026, 9, 5, 16);
const HOME_TEXT = "can someone come over to my house to fix the sink";
const PLAIN_TEXT = "can someone help me carry boxes to the park";

function member(id: string): Member {
  return {
    id, name: id, homeCity: "sf", state: "normal",
    prefs: {
      categoriesOptIn: ["social", "help"], quietHours: [22, 8], romanceOptIn: false,
      formats: ["one_to_one"], maxTravelMinutes: 60, onlyWhenAsked: false,
    },
    joinedAt: NOW - 30 * DAY, age: 30, unansweredProactive: 0,
  };
}

function world(withMetEdge: boolean): World {
  const input: EngineInput = {
    now: NOW,
    members: [member("a"), member("b"), member("c")],
    facets: [], intents: [], presence: [],
    edges: withMetEdge ? [{ from: "a", to: "b", type: "met", strength: 1, explicit: true, createdAt: NOW - DAY }] : [],
    recentProposals: [],
  };
  return new World(input, resolveConfig(), localEmbed);
}

function helpCandidate(participants: string[], riskText: string): any {
  return {
    kind: "help", category: "help", participants,
    roles: Object.fromEntries(participants.map(id => [id, id === participants[0] ? "seeker" : "helper"])),
    format: "one_to_one", riskText, channels: new Set(), benefit: {}, evidence: {}, fit: 0.5, warm: 0,
  };
}

export async function homeEntryGate(b: Block): Promise<void> {
  await b.run("engine: a solo help candidate entering a home is rejected, not passed", () => {
    const c = helpCandidate(["a"], HOME_TEXT);
    expect(candidateReason(world(false), c)).toBe("home_entry_rule");
  });

  await b.run("engine: one unacquainted helper entering a home is still rejected (control)", () => {
    const c = helpCandidate(["a", "b"], HOME_TEXT);
    expect(candidateReason(world(false), c)).toBe("home_entry_rule");
  });

  await b.run("engine: two helpers entering a home still pass (control)", () => {
    const c = helpCandidate(["a", "b", "c"], HOME_TEXT);
    expect(candidateReason(world(false), c)).toBeNull();
    expect(c.safetyClass).toBe("medium");
  });

  await b.run("engine: one acquainted helper entering a home still passes (control)", () => {
    const c = helpCandidate(["a", "b"], HOME_TEXT);
    expect(candidateReason(world(true), c)).toBeNull();
    expect(c.safetyClass).toBe("medium");
  });

  await b.run("engine: a solo help candidate with no home entry still passes (control)", () => {
    const c = helpCandidate(["a"], PLAIN_TEXT);
    expect(candidateReason(world(false), c)).toBeNull();
  });
}
