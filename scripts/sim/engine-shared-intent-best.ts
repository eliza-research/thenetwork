// Sim gate for the shared-intent best-match fix: sharedIntentPooling builds its
// `similar` list from every intent in the category, but kept only the first intent
// seen per member. Intents arrive in id order, not fit order, so when a member's
// weaker intent sorts before their perfect intent in the same category, the pair
// (and any group) was scored on the weaker fit even though a perfect match
// existed. This gate fails before the fix and passes after it. It is a sim gate,
// not a unit test: it runs inside `bun run sim --only network` via the network block.
import { DAY, EngineRng as Rng, type Facet, type Intent, type Member } from "../../packages/core/src/index.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { sharedIntentPooling } from "../../packages/engine/src/packs/network/generators.ts";
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
      quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one", "small_group"],
      maxTravelMinutes: 60, onlyWhenAsked: false,
    },
    joinedAt: NOW - 30 * DAY, age: 30, unansweredProactive: 0,
  } as Member;
}

function facet(id: string, memberId: string, value: string, tags: string[]): Facet {
  return { id, memberId, kind: "interest", value, tags, scope: "shareable", provenance: "said", confidence: 1 } as Facet;
}

function intent(id: string, memberId: string, objective: string): Intent {
  return { id, memberId, category: "hobby", objective, status: "active", createdAt: NOW - DAY, horizonDays: 30 } as Intent;
}

// Member "a" wants "play chess". Member "z" has two hobby intents: one weaker
// ("play chess on weekends", sim 0.786 to "a") and one perfect ("play chess",
// sim 1). The intent ids are chosen so the weaker intent sorts first: "za"
// before "zb" (or, in the control, the other way round).
function worldWith(zIntents: Intent[]): World {
  const members = [member("a"), member("z")];
  const facets = [facet("a1", "a", "chess", ["chess"]), facet("z1", "z", "chess", ["chess"])];
  const input: EngineInput = {
    now: NOW,
    members, facets,
    intents: [intent("a1", "a", "play chess"), ...zIntents],
    presence: members.map(m => ({ memberId: m.id, city: "sf", type: "home", areas: ["mission"] })),
    edges: [], recentProposals: [],
  };
  return new World(input, resolveConfig(), localEmbed);
}

function pooled(w: World) {
  const ctx: GenCtx = { w, memberExclusions: {}, rng: new Rng(1).fork("gen"), unmatchedIntents: new Set() };
  return sharedIntentPooling(ctx);
}

export async function sharedIntentBestGate(b: Block): Promise<void> {
  await b.run("engine: shared intent pooling scores a member on their best-fitting intent, not the first intent in id order", () => {
    const w = worldWith([intent("za", "z", "play chess on weekends"), intent("zb", "z", "play chess")]);
    const out = pooled(w);
    expect(out.map(c => c.participants)).toEqual([["a", "z"]]);
    expect(out[0]!.fit).toBe(1);
    expect(candidateReason(w, out[0]!)).toBeNull();
  });

  await b.run("engine: shared intent pooling is unchanged when the best intent already sorts first (control)", () => {
    const w = worldWith([intent("za", "z", "play chess"), intent("zb", "z", "play chess on weekends")]);
    const out = pooled(w);
    expect(out.map(c => c.participants)).toEqual([["a", "z"]]);
    expect(out[0]!.fit).toBe(1);
    expect(candidateReason(w, out[0]!)).toBeNull();
  });

  await b.run("engine: shared intent pooling proposes nothing when no intent clears the pool threshold (control)", () => {
    const w = worldWith([intent("za", "z", "underwater basket weaving")]);
    expect(pooled(w)).toEqual([]);
  });
}
