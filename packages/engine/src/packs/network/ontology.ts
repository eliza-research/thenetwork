// The Network's ontology (networkPack.ontology): lanes, the objective taxonomy and the
// member constraints read from facet tags. Moved verbatim from world.ts (warm edges, romance /
// dealbreaker tag parsing, host tag), taxonomy.ts and types.ts. Function values from non-leaf
// modules are wrapped in arrows so this module is safe inside import cycles.
import type { Category, EdgeType, Facet, Intent } from "@thenetwork/core";
import type { EngineConfig } from "../../config.ts";
import type { MemberConstraints, Ontology } from "../../pack.ts";
import { CONTRIBUTOR_ROLES } from "../../types.ts";
import type { RomanceProfile } from "../../world.ts";
import { isPersonalGrowth, objectivesFor, OBJECTIVES } from "./taxonomy.ts";

/** Positive edges form the warm graph (was world.ts POSITIVE_EDGES). Blocking edges (blocked, avoid) are core. */
export const NETWORK_WARM_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>([
  "invited_by", "vouched_for", "knows", "met", "introduced", "helped", "hosted", "enjoyed", "would_interact_again",
]);

/** Dealbreaker and romance preference tags on boundary / preference facets (was world.ts). */
export function networkConstraints(boundaries: readonly Facet[]): MemberConstraints {
  const dealbreakers = boundaries.flatMap(f => f.tags.filter(t => t.startsWith("dealbreaker:")).map(t => t.slice(12).toLowerCase()));
  // Strict parsing (engine-pipeline-18): case-insensitive, values keep any further ":", and an
  // age range that does not parse as "lo-hi" with 18 <= lo <= hi admits nobody (fail closed).
  const romanceTags = boundaries.flatMap(f => f.tags).map(t => t.trim().toLowerCase()).filter(t => t.startsWith("romance:"));
  let romance: RomanceProfile | undefined;
  if (romanceTags.length) {
    romance = { is: [], seeks: [], ageMin: 18, ageMax: 120 };
    for (const t of romanceTags) {
      const [, key, ...rest] = t.split(":");
      const val = rest.join(":").trim();
      if (key === "is" && val) romance.is.push(val);
      if (key === "seeks" && val) romance.seeks.push(val);
      if (key === "age") {
        const m = /^(\d{2,3})\s*-\s*(\d{2,3})$/.exec(val);
        const lo = m ? Number(m[1]) : NaN, hi = m ? Number(m[2]) : NaN;
        if (lo >= 18 && hi >= lo) { romance.ageMin = lo; romance.ageMax = hi; } else { romance.ageMin = Infinity; romance.ageMax = -Infinity; }
      }
    }
  }
  return { dealbreakers, romance };
}

export const networkOntology: Ontology = {
  lanes: [
    { id: "social", minors: "teenFriendship" },
    { id: "professional", minors: "never" },
    { id: "romance", minors: "never", neverInPlans: true },
    { id: "hobby", minors: "never" },
    { id: "help", minors: "never" },
    { id: "events", minors: "never" },
    { id: "growth", minors: "never" },
  ],
  contributorRoles: CONTRIBUTOR_ROLES,
  warmEdges: NETWORK_WARM_EDGES,
  funnelProbe: { lane: "social", role: "peer" },
  objectives: OBJECTIVES,
  objectivesFor: (text, details, lane) => objectivesFor(text, details, lane),
  relabelIntent: (it: Intent, cfg: EngineConfig): Category | undefined => (cfg.personalGrowthAsHobby && isPersonalGrowth(it) ? "hobby" : undefined),
  constraints: networkConstraints,
  isHost: match => match.some(f => f.tags.some(t => t.toLowerCase() === "host")),
};
