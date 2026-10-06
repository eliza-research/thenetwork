// Seeded synthetic worlds for the recommender eval: personas (with hidden truth) from the
// simulator's deterministic generator, the snapshot an engine would see, and the oracle.
import type { City, WorldSnapshot } from "../../core/src/index.ts";
import { DAY } from "../../core/src/index.ts";
import { generatePersonas } from "../../sim/src/generator.ts";
import { Oracle } from "../../sim/src/oracle.ts";
import type { Persona } from "../../sim/src/persona.ts";
import { buildSnapshot } from "../../sim/src/snapshot.ts";

/** Same epoch the simulator uses (Mon Oct 5 2026, 00:00 SF). */
export const WORLD_START = Date.UTC(2026, 9, 5, 7);
/** Evaluate configurations three days in, so announced trips are visible as temporary presence. */
export const EVAL_NOW = WORLD_START + 3 * DAY;

export interface WorldSpec {
  id: string; city: City; seed: number; n: number;
  /**
   * Profile richness tiers + simulated connected sources (sim generator option, 2026-10-06). The
   * snapshot then holds only what the Network knows (chat coverage + source observations, with
   * source / observedAt / inferred / confirmedByMember); hidden truth and oracle labels are unchanged.
   */
  richness?: boolean;
}
export const DEFAULT_WORLDS: WorldSpec[] = [
  { id: "sf-1", city: "sf", seed: 101, n: 320 },
  { id: "sf-2", city: "sf", seed: 102, n: 320 },
  { id: "nyc-1", city: "nyc", seed: 201, n: 320 },
  { id: "nyc-2", city: "nyc", seed: 202, n: 320 },
];
/** The same four worlds with richness tiers and connected sources on (judgment-passes suite). */
export const RICHNESS_WORLDS: WorldSpec[] = DEFAULT_WORLDS.map(w => ({ ...w, richness: true }));

export interface EvalWorld {
  spec: WorldSpec;
  personas: Persona[];
  byId: Map<string, Persona>;
  oracle: Oracle;
  /** Blocks added for adversarial items (from -> to). Included in the snapshot as `blocked` edges. */
  blocks: { from: string; to: string; at: number }[];
  snapshot(): WorldSnapshot;
}

export function buildEvalWorld(spec: WorldSpec): EvalWorld {
  const personas = generatePersonas({
    n: spec.n, seed: `evals:${spec.id}:${spec.seed}`, idPrefix: `${spec.id}-`,
    cityWeights: spec.city === "sf" ? { sf: 1, nyc: 0 } : { sf: 0, nyc: 1 },
    // Everyone has joined by EVAL_NOW so the whole population is matchable.
    joinSpreadDays: 3,
    ...(spec.richness ? { richness: true } : {}),
  });
  const byId = new Map(personas.map(p => [p.id, p]));
  const oracle = new Oracle(personas, `evals:${spec.id}:${spec.seed}`, WORLD_START);
  const blocks: EvalWorld["blocks"] = [];
  let cached: WorldSnapshot | undefined;
  let cachedBlocks = -1;
  return {
    spec, personas, byId, oracle, blocks,
    snapshot() {
      if (cached && cachedBlocks === blocks.length) return cached;
      const joined = new Map(personas.map(p => [p.id, WORLD_START + Math.min(p.joinDay, 2) * DAY]));
      cached = buildSnapshot(personas, {
        now: EVAL_NOW, worldStart: WORLD_START, joined, optedOut: new Set(), blocks: [...blocks],
        unanswered: new Map(), recentProposals: [],
      });
      cachedBlocks = blocks.length;
      return cached;
    },
  };
}
