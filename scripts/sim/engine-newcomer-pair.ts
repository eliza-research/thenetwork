// Sim gate for the newcomer pair-rule fix: newcomerWelcome builds its pool from
// eligible members, ranks them by affinity, and keeps only the first poolSize
// (24) before composeGroup runs. Unlike intent_to_capability and expansion, it
// did not check pair rules against the newcomer before ranking. Members blocked
// against the newcomer therefore took pool slots, and composeGroup pruned them
// as incompatible — so when 24 blocked members filled the pool, a viable host
// and guest ranked below the cut never entered the pool at all, and the
// newcomer got no welcome, even though a valid group existed.
// This gate fails before the fix and passes after it. It is a sim gate, not a
// unit test: it runs inside `bun run sim --only network` via the network block.
import { DAY, EngineRng as Rng, type Facet, type Member } from "../../packages/core/src/index.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { newcomerWelcome } from "../../packages/engine/src/packs/network/generators.ts";
import type { GenCtx } from "../../packages/engine/src/genkit.ts";
import type { EngineInput } from "../../packages/engine/src/types.ts";
import { World } from "../../packages/engine/src/world.ts";
import { candidateReason } from "../../packages/engine/src/filters.ts";
import { Block, expect } from "./gate.ts";

const NOW = Date.UTC(2026, 9, 5, 16);

function member(id: string, city: string, joinedAgoDays: number): Member {
  return {
    id, name: id, homeCity: city, state: "normal",
    prefs: {
      categoriesOptIn: ["social", "professional", "hobby", "help", "events", "growth"],
      quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one", "small_group"],
      maxTravelMinutes: 60, onlyWhenAsked: false,
    },
    joinedAt: NOW - joinedAgoDays * DAY, age: 30, unansweredProactive: 0,
  } as Member;
}

function facet(id: string, memberId: string, kind: Facet["kind"], value: string, tags: string[]): Facet {
  return { id, memberId, kind, value, tags, scope: "matchable", provenance: "said", confidence: 1 } as Facet;
}

// Newcomer "n" (joined 2 days ago) plus `blockedCount` high-affinity members
// (same desire as "n", positive ties to each other, so they rank first) who are
// blocked against "n", plus, unless `viable` is false, a viable host "vh" (a
// host facet, a different desire, so it ranks below the blocked members) and a
// viable guest "vg" (positive ties to six members in another city, so its
// affinity clears 0.1 without sharing "n"'s desire).
function worldWith(blockedCount: number, blocked: boolean, viable = true): World {
  const members: Member[] = [member("n", "sf", 2)];
  const facets: Facet[] = [facet("n1", "n", "desire", "chess club", ["chess"])];
  const edges: EngineInput["edges"] = [];
  for (let i = 0; i < blockedCount; i++) {
    const id = `b${String(i).padStart(2, "0")}`;
    members.push(member(id, "sf", 30));
    facets.push(facet(`${id}f`, id, "desire", "chess club", ["chess"]));
    if (blocked) edges.push({ from: "n", to: id, type: "blocked", strength: 1, explicit: true, createdAt: NOW - DAY });
    if (i > 0) edges.push({ from: `b${String(i - 1).padStart(2, "0")}`, to: id, type: "knows", strength: 0.8, explicit: true, createdAt: NOW - DAY });
  }
  if (viable) {
    members.push(member("vh", "sf", 30));
    facets.push(facet("vh1", "vh", "interest", "hosting gatherings", ["host"]));
    facets.push(facet("vh2", "vh", "desire", "salsa dancing", ["salsa"]));
    members.push(member("vg", "sf", 30));
    facets.push(facet("vg1", "vg", "desire", "pottery class", ["pottery"]));
    for (let i = 0; i < 6; i++) {
      const id = `d${i}`;
      members.push(member(id, "nyc", 30));
      edges.push({ from: "vg", to: id, type: "knows", strength: 0.8, explicit: true, createdAt: NOW - DAY });
    }
  }
  const input: EngineInput = {
    now: NOW,
    members, facets, intents: [],
    presence: members.map(m => ({ memberId: m.id, city: m.homeCity, type: "home", areas: ["mission"] })),
    edges, recentProposals: [],
  };
  return new World(input, resolveConfig(), localEmbed);
}

function welcomes(w: World) {
  const ctx: GenCtx = { w, memberExclusions: {}, rng: new Rng(1).fork("gen"), unmatchedIntents: new Set() };
  return newcomerWelcome(ctx);
}

export async function newcomerPairGate(b: Block): Promise<void> {
  await b.run("engine: newcomer welcome skips pool members blocked against the newcomer and welcomes with the viable host and guest", () => {
    const w = worldWith(24, true);
    const out = welcomes(w);
    expect(out.map(c => c.participants)).toEqual([["n", "vh", "vg"]]);
    expect(candidateReason(w, out[0]!)).toBeNull();
  });

  await b.run("engine: newcomer welcome still forms when only a few members are blocked (control)", () => {
    const w = worldWith(3, true);
    const out = welcomes(w);
    expect(out.map(c => c.participants)).toEqual([["n", "vh", "vg"]]);
    expect(candidateReason(w, out[0]!)).toBeNull();
  });

  await b.run("engine: newcomer welcome proposes nothing when no viable host exists (control)", () => {
    const w = worldWith(24, true, false);
    expect(welcomes(w)).toEqual([]);
  });
}
