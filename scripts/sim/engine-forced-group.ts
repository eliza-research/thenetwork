// Sim gate for the forced-group fix (PR 211): composeGroup must not drop a valid
// forced group just because it cannot be expanded. The beam search only collected
// states produced by expansion, so a forced trio that already met minSize returned
// null when the pool was empty or incompatible, even though the forced group had
// already been evaluated and accepted. This gate fails before the fix (null) and
// passes after it (the forced trio is returned). It is a sim gate, not a unit test:
// it runs inside `bun run sim --only network` via the network block.
import { DAY, HOUR, type Member } from "../../packages/core/src/index.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { composeGroup, type ComposeOptions } from "../../packages/engine/src/group.ts";
import type { EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { Block, expect } from "./gate.ts";

const NOW = Date.UTC(2026, 9, 5, 16);

function member(id: string, homeCity: "sf" | "nyc" = "sf"): Member {
  return {
    id, name: id, homeCity, state: "normal",
    prefs: {
      categoriesOptIn: ["social", "professional", "hobby", "help", "events", "growth"],
      quietHours: [22, 8], romanceOptIn: false, formats: ["small_group"],
      maxTravelMinutes: 60, onlyWhenAsked: false,
    },
    joinedAt: NOW - 30 * DAY, age: 30, unansweredProactive: 0,
  };
}

function world(): World {
  const input: EngineInput = {
    now: NOW,
    members: [member("a"), member("b"), member("c"), member("d", "nyc")],
    facets: [], intents: [], presence: [], edges: [], recentProposals: [],
  };
  return new World(input, resolveConfig(), localEmbed);
}

function opts(forced: string[], pool: string[]): ComposeOptions {
  return {
    pool: pool.map(id => ({ id, affinity: 0.5 })),
    forced, category: "social", minSize: 3, maxSize: 6,
    window: { start: NOW, end: NOW + 10 * HOUR },
    preferredCity: "sf", needHost: false,
    beamWidth: 8, minPairwise: 0, alternates: 3,
  };
}

export async function forcedGroupGate(b: Block): Promise<void> {
  await b.run("engine: a valid forced trio with an empty pool is returned, not dropped", () => {
    const g = composeGroup(world(), opts(["a", "b", "c"], []));
    expect(g).not.toBeNull();
    expect([...g!.primary].sort()).toEqual(["a", "b", "c"]);
  });

  await b.run("engine: a valid forced trio with only an incompatible pool member is returned", () => {
    // "d" lives in nyc and shares no sf window with the trio, so no expansion
    // is possible — the forced group itself must still stand.
    const g = composeGroup(world(), opts(["a", "b", "c"], ["d"]));
    expect(g).not.toBeNull();
    expect([...g!.primary].sort()).toEqual(["a", "b", "c"]);
  });

  await b.run("engine: a forced group below minSize is still not returned (control)", () => {
    expect(composeGroup(world(), opts(["a"], []))).toBeNull();
    expect(composeGroup(world(), opts(["a", "b"], []))).toBeNull();
  });
}
