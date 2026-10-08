// Test worlds for slopPack: the slop world's agent-visible snapshot (packages/worlds, personas with
// hidden truth that never enters the snapshot), plus what the conformance suite needs on top: more
// minors (declared 13-17 and age liars), canary facets, blocks, safety holds and id aliases.
import type { Facet } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { Rng } from "../src/rng.ts";
import type { EngineInput } from "../src/types.ts";
import { slopEngineInput } from "../../worlds/src/slop/enginePack.ts";
import { generateSlopPersonas, type SlopPersona } from "../../worlds/src/slop/persona.ts";
import { buildSlopSnapshot, SLOP_WORLD_START, type SlopNetworkState } from "../../worlds/src/slop/snapshot.ts";

export const emptySlopState = (): SlopNetworkState => ({ now: SLOP_WORLD_START + 12 * 3_600_000, week: 0, interactions: [], feedback: [], safetyHolds: [], inboundAsks: [], edges: [], paused: new Set(), asks: [], learned: new Map() });

export interface SlopKitOptions { perCity?: number; minorShare?: number; extras?: boolean; state?: SlopNetworkState; personas?: SlopPersona[] }

/** A slop engine input: `perCity` personas in sf / nyc / la (default 40), 15% minors, plus conformance extras. */
export function slopWorld(seed: number, o: SlopKitOptions = {}): EngineInput {
  const personas = o.personas ?? generateSlopPersonas({ seed, perCity: o.perCity ?? 40, minorShare: o.minorShare ?? 0.15 });
  const snap = buildSlopSnapshot(personas, o.state ?? emptySlopState());
  const input = slopEngineInput(snap);
  if (o.extras === false) return input;
  const r = new Rng(seed * 7919 + 13);
  const ids = input.members.map(m => m.id);
  // Canary facets the matcher may read but must never show (agent_private).
  const canaries: Facet[] = ids.map((id, i) => ({ id: `${id}:canary`, memberId: id, kind: "fact", value: `private note CANARY-${seed}-${i}`, tags: ["private_note"], scope: "agent_private", provenance: "said", confidence: 0.9 }));
  // A few blocks and safety holds between adults.
  const adults = input.members.filter(m => m.age >= 18).map(m => m.id);
  const edges = [...input.edges];
  for (let k = 0; k < 6; k++) { const a = r.pick(adults), b = r.pick(adults); if (a !== b) edges.push({ from: a, to: b, type: "blocked", strength: 1, explicit: true, createdAt: input.now - DAY }); }
  const holds = [...(input.safetyHolds ?? []), ...r.sample(adults, 3).map(id => ({ memberId: id, from: input.now - DAY, reason: "test hold" }))];
  // Aliases: a phone alias for two members, used by one block edge.
  const [x, y] = r.sample(adults, 2) as [string, string];
  edges.push({ from: `tel:${x}`, to: y, type: "blocked", strength: 1, explicit: true, createdAt: input.now - DAY });
  return { ...input, facets: [...input.facets, ...canaries], edges, safetyHolds: holds, idAliases: { [`tel:${x}`]: x } };
}
