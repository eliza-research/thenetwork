// Sim gate for the expansion pair-rule fix: the expansion generator picks the
// single best provider for a member's outside-cluster desire, but unlike every
// other intent generator it did not check pair rules before ranking. A blocked
// best provider therefore took the expansion slot, and the engine's later
// candidateReason dropped that candidate as "blocked" — so the member got no
// expansion proposal at all, even though a viable second-best provider existed.
// This gate fails before the fix and passes after it. It is a sim gate, not a
// unit test: it runs inside `bun run sim --only network` via the network block.
import { DAY, EngineRng as Rng, type Facet, type Member } from "../../packages/core/src/index.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { expansion } from "../../packages/engine/src/packs/network/generators.ts";
import type { GenCtx } from "../../packages/engine/src/genkit.ts";
import type { EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { candidateReason } from "../../packages/engine/src/filters.ts";
import { Block, expect } from "./gate.ts";

const NOW = Date.UTC(2026, 9, 5, 16);

function member(id: string): Member {
  return {
    id, name: id, homeCity: "sf", state: "normal",
    prefs: {
      categoriesOptIn: ["social", "professional", "hobby", "help", "events", "growth"],
      quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one"],
      maxTravelMinutes: 60, onlyWhenAsked: false,
    },
    joinedAt: NOW - 30 * DAY, age: 30, unansweredProactive: 0,
  };
}

function facet(id: string, memberId: string, kind: Facet["kind"], value: string, tags: string[]): Facet {
  return { id, memberId, kind, value, tags, scope: "matchable", provenance: "said", confidence: 1 } as Facet;
}

// Member "a" wants chess most (cluster "chess") and salsa as an outside-cluster
// desire. "b" and "c" offer identical salsa skills, so "b" wins the tie on id
// order — unless "b" is blocked, in which case the slot must go to "c".
function worldWith(blocked: boolean): World {
  const facets: Facet[] = [
    facet("a1", "a", "desire", "chess club", ["chess"]),
    facet("a2", "a", "desire", "chess club", ["chess"]),
    facet("a3", "a", "desire", "salsa dancing", ["salsa"]),
    facet("b1", "b", "skill", "salsa dancing", ["salsa"]),
    facet("c1", "c", "skill", "salsa dancing", ["salsa"]),
  ];
  const input: EngineInput = {
    now: NOW,
    members: [member("a"), member("b"), member("c")],
    facets, intents: [],
    presence: (["a", "b", "c"] as const).map(memberId => ({ memberId, city: "sf", type: "home", areas: ["mission"] })),
    edges: blocked ? [{ from: "a", to: "b", type: "blocked", strength: 1, explicit: true, createdAt: NOW - DAY }] : [],
    recentProposals: [],
  };
  return new World(input, resolveConfig(), localEmbed);
}

function expansionFor(w: World) {
  const ctx: GenCtx = { w, memberExclusions: {}, rng: new Rng(1).fork("gen"), unmatchedIntents: new Set() };
  return expansion(ctx);
}

export async function expansionPairGate(b: Block): Promise<void> {
  await b.run("engine: expansion skips a blocked best provider and proposes the viable second-best", () => {
    const w = worldWith(true);
    const out = expansionFor(w);
    expect(out.map(c => c.participants)).toEqual([["a", "c"]]);
    expect(candidateReason(w, out[0]!)).toBeNull();
  });

  await b.run("engine: expansion still proposes the best provider when nobody is blocked (control)", () => {
    const w = worldWith(false);
    const out = expansionFor(w);
    expect(out.map(c => c.participants)).toEqual([["a", "b"]]);
    expect(candidateReason(w, out[0]!)).toBeNull();
  });

  await b.run("engine: expansion proposes nothing when the only provider is blocked (control)", () => {
    const w = worldWith(true);
    // Drop "c"'s skill so "b" is the only salsa provider.
    const input = { ...w.input, facets: w.input.facets!.filter(f => f.id !== "c1") };
    const w2 = new World(input, resolveConfig(), localEmbed);
    expect(expansionFor(w2)).toEqual([]);
  });
}
