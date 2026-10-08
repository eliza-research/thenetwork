// The Network's ontology (networkPack.ontology): lanes, roles, kinds, the objective taxonomy and the
// member constraints read from facet tags. Moved verbatim from world.ts (warm edges, romance /
// dealbreaker tag parsing, host tag), taxonomy.ts and types.ts. Function values from non-leaf
// modules are wrapped in arrows so this module is safe inside import cycles.
import type { Category, EdgeType, Facet, Intent } from "@thenetwork/core";
import { romanceMutual } from "../../complementarity.ts";
import type { EngineConfig } from "../../config.ts";
import type { MemberConstraints, Ontology } from "../../pack.ts";
import { CONTRIBUTOR_ROLES, type Role } from "../../types.ts";
import type { RomanceProfile } from "../../world.ts";
import { CATEGORY_LABEL } from "./copy.ts";
import { isPersonalGrowth, objectivesFor, OBJECTIVES } from "./taxonomy.ts";

/** Positive edges form the warm graph (was world.ts POSITIVE_EDGES). Blocking edges (blocked, avoid) are core. */
export const NETWORK_WARM_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>([
  "invited_by", "vouched_for", "knows", "met", "introduced", "helped", "hosted", "enjoyed", "would_interact_again",
]);

const ROLES: Role[] = ["initiator", "seeker", "provider", "peer", "helper", "host", "guest", "newcomer", "connector", "attendee"];

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
    { id: "social", label: CATEGORY_LABEL.social, optIn: "explicit", adultOnly: true },
    { id: "professional", label: CATEGORY_LABEL.professional, optIn: "explicit", adultOnly: true },
    { id: "romance", label: CATEGORY_LABEL.romance, optIn: "explicit_mutual", adultOnly: true, shipsAlone: true, neverInPlans: true },
    { id: "hobby", label: CATEGORY_LABEL.hobby, optIn: "explicit", adultOnly: true },
    { id: "help", label: CATEGORY_LABEL.help, optIn: "explicit", adultOnly: true },
    { id: "events", label: CATEGORY_LABEL.events, optIn: "explicit", adultOnly: true },
    { id: "growth", label: CATEGORY_LABEL.growth, optIn: "explicit", adultOnly: true },
  ],
  roles: ROLES.map(id => ({ id, contributor: CONTRIBUTOR_ROLES.has(id) })),
  kinds: [
    { id: "intro", format: "one_to_one", size: [2, 2] },
    { id: "group", format: "small_group", size: [3, 6] },
    { id: "event_coattend", format: "event", size: [2, 4] },
    { id: "help", format: "one_to_one", size: [2, 4] },
    { id: "member_intro", format: "one_to_one", size: [2, 2] },
    { id: "newcomer_welcome", format: "small_group", size: [3, 4] },
    { id: "network_growth", format: "one_to_one", size: [1, 1] },
    { id: "second_encounter", format: "one_to_one", size: [2, 2] },
    { id: "expansion", format: "one_to_one", size: [2, 2] },
  ],
  contributorRoles: CONTRIBUTOR_ROLES,
  warmEdges: NETWORK_WARM_EDGES,
  funnelProbe: { lane: "social", role: "peer" },
  objectives: OBJECTIVES,
  objectivesFor: (text, details, lane) => objectivesFor(text, details, lane),
  mutualPreferenceMatch: (w, a, b) => romanceMutual(w, a, b),
  relabelIntent: (it: Intent, cfg: EngineConfig): Category | undefined => (cfg.personalGrowthAsHobby && isPersonalGrowth(it) ? "hobby" : undefined),
  constraints: networkConstraints,
  isHost: match => match.some(f => f.tags.some(t => t.toLowerCase() === "host")),
};
