import { extractMemberRedLines, type Category, type EdgeType, type Facet, type Intent } from "@thenetwork/core";
import type { EngineConfig } from "../../config.ts";
import type { MemberConstraints, Ontology } from "../../pack.ts";
import { CONTRIBUTOR_ROLES } from "../../types.ts";
import type { RomanceProfile } from "../../world.ts";
import { connectionTypeForIntent, connectionTypeForObjective, isPersonalGrowth, objectivesFor, OBJECTIVES } from "./taxonomy.ts";
import {
  CONNECTION_ONTOLOGY_SPECS,
  CONNECTION_ONTOLOGY_TYPES,
  HUMOR_REGISTERS,
  LIFE_STAGES,
  SPEND_COMFORT_TIERS,
  type ConnectionOntologySpec,
  type ConnectionOntologyType,
  type HumorRegister,
  type LifeStage,
  type SpendComfortTier,
} from "./vocabulary.ts";

export {
  CONNECTION_ONTOLOGY_SPECS,
  CONNECTION_ONTOLOGY_TYPES,
  connectionTypeForIntent,
  connectionTypeForObjective,
  type ConnectionOntologySpec,
  type ConnectionOntologyType,
};

export const NETWORK_WARM_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>([
  "invited_by", "vouched_for", "knows", "met", "introduced", "helped", "hosted", "enjoyed", "would_interact_again",
]);

export function networkConstraints(boundaries: readonly Facet[]): MemberConstraints {
  const dealbreakers = boundaries.flatMap(f => f.tags.filter(t => t.startsWith("dealbreaker:")).map(t => t.slice(12).toLowerCase()));
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

export interface StatedConnectionTag {
  connectionType: ConnectionOntologyType;
  direction: "seeks" | "offers" | "mutual_pool";
  role: string;
  domain: string;
  scope: Facet["scope"];
}

export interface ParsedOntologyTags {
  spendTier?: SpendComfortTier;
  lifeStage?: LifeStage;
  transitions: string[];
  humor: HumorRegister[];
  guilds: string[];
  nativeLanguages: string[];
  learningLanguages: string[];
  domainRungs: Record<string, number>;
  depthHint?: number;
  verifiedCraft: boolean;
  hvVerifiedCraftTag: boolean;
  hypeClaimCount: number;
  statedConnections: StatedConnectionTag[];
  economicHint?: number;
  publicityHint?: number;
  discretionHint?: number;
  extractionHint?: number;
  strictSober: boolean;
  nonDrinker: boolean;
  soberProtected: boolean;
}

const SPEND_SET = new Set<string>(SPEND_COMFORT_TIERS);
const STAGE_SET = new Set<string>(LIFE_STAGES);
const HUMOR_SET = new Set<string>(HUMOR_REGISTERS);

const HV_SPEND_MAP: Readonly<Record<string, SpendComfortTier>> = {
  free: "free", freetier: "free",
  low: "low", lowtier: "low",
  moderate: "moderate", moderatetier: "moderate",
  high: "high", hightier: "high",
  unconstrained: "unconstrained", unconstrainedtier: "unconstrained",
};

const HV_STAGE_MAP: Readonly<Record<string, LifeStage>> = {
  student: "student",
  early_career: "early_career", earlycareer: "early_career",
  established_single: "established_single", establishedsingle: "established_single", established: "established_single",
  partnered_no_kids: "partnered_no_kids", partnerednokids: "partnered_no_kids",
  young_family: "young_family", youngfamily: "young_family", parent: "young_family",
  established_family: "established_family", establishedfamily: "established_family",
  empty_nest: "empty_nest", emptynest: "empty_nest",
  post_exit: "post_exit", postexit: "post_exit",
  retired: "retired",
};

const HV_HUMOR_MAP: Readonly<Record<string, HumorRegister>> = {
  dry_ironic: "dry_ironic", dryironic: "dry_ironic",
  absurdist: "absurdist",
  warm_earnest: "warm_earnest", warmearnest: "warm_earnest",
  nerdy_wordplay: "nerdy_wordplay", nerdywordplay: "nerdy_wordplay",
  roast_banter: "roast_banter", roastbanter: "roast_banter",
};

const HV_CONN_MAP: Readonly<Record<string, ConnectionOntologyType>> = Object.fromEntries(
  CONNECTION_ONTOLOGY_TYPES.flatMap(ct => [
    [ct, ct],
    [ct.replace(/_/g, ""), ct],
  ]),
);

const HV_RUNG_BAND: Readonly<Record<string, number>> = {
  emerging: 2.5,
  practitioner: 5.0,
  seniorcraft: 7.5,
  senior_craft: 7.5,
  principalmaster: 9.2,
  principal_master: 9.2,
};

const HV_DEPTH_MAP: Readonly<Record<string, number>> = {
  deepsalon: 0.85,
  deep_salon: 0.85,
  balancedchat: 0.50,
  balanced_chat: 0.50,
  activityfirst: 0.20,
  activity_first: 0.20,
};

const HV_TRANSITION_MAP: Readonly<Record<string, string>> = {
  relocatedcity: "relocated_city", relocated_city: "relocated_city",
  postexit: "post_exit", post_exit: "post_exit",
  newparent: "new_parent", new_parent: "new_parent",
  postdivorce: "post_divorce", post_divorce: "post_divorce",
  careerpivot: "career_pivot", career_pivot: "career_pivot",
  earlysobriety: "early_sobriety", early_sobriety: "early_sobriety",
  bereavement: "bereavement",
  graduating: "graduating",
  returningabroad: "returning_abroad", returning_abroad: "returning_abroad",
  startingcompany: "starting_company", starting_company: "starting_company",
};

export function parseOntologyTags(facets: readonly Facet[]): ParsedOntologyTags {
  const redLines = extractMemberRedLines(facets);
  const out: ParsedOntologyTags = {
    transitions: [],
    humor: [],
    guilds: [],
    nativeLanguages: [],
    learningLanguages: [],
    domainRungs: {},
    verifiedCraft: false,
    hvVerifiedCraftTag: false,
    hypeClaimCount: 0,
    statedConnections: [],
    strictSober: redLines.strictSober,
    nonDrinker: redLines.nonDrinker,
    soberProtected: redLines.strictSober,
  };
  const pushUnique = <T>(arr: T[], v: T) => { if (!arr.includes(v)) arr.push(v); };
  for (const f of facets) {
    if ((f.kind === "skill" || f.kind === "offer") && f.provenance === "vouched") {
      out.verifiedCraft = true;
    }
    let facetConn: ConnectionOntologyType | undefined;
    let facetRole: string | undefined;
    let facetDom: string | undefined;
    for (const raw of f.tags) {
      const t = raw.trim().toLowerCase();
      if (t.startsWith("spend:")) {
        const v = t.slice(6);
        if (SPEND_SET.has(v)) out.spendTier = v as SpendComfortTier;
      } else if (t.startsWith("hv:spend:")) {
        const mapped = HV_SPEND_MAP[t.slice(9)];
        if (mapped) out.spendTier = mapped;
      } else if (t.startsWith("stage:")) {
        const v = t.slice(6);
        if (STAGE_SET.has(v)) out.lifeStage = v as LifeStage;
      } else if (t.startsWith("hv:stage:")) {
        const mapped = HV_STAGE_MAP[t.slice(9)];
        if (mapped) out.lifeStage = mapped;
      } else if (t.startsWith("transition:")) {
        const v = t.slice(11);
        if (v) pushUnique(out.transitions, HV_TRANSITION_MAP[v] ?? v);
      } else if (t.startsWith("hv:trans:")) {
        const v = t.slice(9);
        if (v) pushUnique(out.transitions, HV_TRANSITION_MAP[v] ?? v);
      } else if (t.startsWith("humor:")) {
        const v = t.slice(6);
        if (HUMOR_SET.has(v)) pushUnique(out.humor, v as HumorRegister);
      } else if (t.startsWith("hv:humor:")) {
        const mapped = HV_HUMOR_MAP[t.slice(9)];
        if (mapped) pushUnique(out.humor, mapped);
      } else if (t.startsWith("hv:depth:")) {
        const mapped = HV_DEPTH_MAP[t.slice(9)];
        if (mapped !== undefined) out.depthHint = mapped;
      } else if (t.startsWith("hv:conn:")) {
        const mapped = HV_CONN_MAP[t.slice(8)];
        if (mapped) facetConn = mapped;
      } else if (t.startsWith("hv:role:")) {
        const v = t.slice(8);
        if (v) facetRole = v;
      } else if (t.startsWith("hv:dom:")) {
        const v = t.slice(7);
        if (v) facetDom = v;
      } else if (t === "hv:verifiedcraft") {
        out.verifiedCraft = true;
        out.hvVerifiedCraftTag = true;
      } else if (t.startsWith("hv:hype:")) {
        out.hypeClaimCount++;
      } else if (t.startsWith("hv:rung:")) {
        const parts = t.slice(8).split(":");
        const dom = parts[0];
        const band = parts[1];
        if (dom && band) {
          const val = HV_RUNG_BAND[band] ?? Number(band);
          if (Number.isFinite(val)) {
            const clamped = Math.max(0, Math.min(10, val));
            out.domainRungs[dom] = Math.max(out.domainRungs[dom] ?? 0, clamped);
          }
        }
      } else if (t.startsWith("guild:")) {
        const v = t.slice(6);
        if (v) pushUnique(out.guilds, v);
      } else if (t.startsWith("lang_native:")) {
        const v = t.slice(12);
        if (v) pushUnique(out.nativeLanguages, v);
      } else if (t.startsWith("lang_learn:")) {
        const v = t.slice(11);
        if (v) pushUnique(out.learningLanguages, v);
      } else if (t.endsWith("_native") && t.length > 7) {
        pushUnique(out.nativeLanguages, t.slice(0, -7));
      } else if (t.startsWith("rung:")) {
        const [dom, valStr] = t.slice(5).split(":");
        const val = Number(valStr);
        if (dom && Number.isFinite(val)) {
          const clamped = Math.max(0, Math.min(10, val));
          out.domainRungs[dom] = Math.max(out.domainRungs[dom] ?? 0, clamped);
        }
      } else if (t.startsWith("econ_tier:")) {
        const v = Number(t.slice(10));
        if (Number.isFinite(v)) out.economicHint = Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
      } else if (t.startsWith("publicity_tier:")) {
        const v = Number(t.slice(15));
        if (Number.isFinite(v)) out.publicityHint = Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
      } else if (t.startsWith("discretion:")) {
        const v = Number(t.slice(11));
        if (Number.isFinite(v)) out.discretionHint = Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
      } else if (t.startsWith("extraction_risk:")) {
        const v = Number(t.slice(16));
        if (Number.isFinite(v)) out.extractionHint = Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
      }
    }
    if (facetConn) {
      const direction: "seeks" | "offers" | "mutual_pool" =
        f.kind === "offer" || f.kind === "skill" || f.kind === "resource" ? "offers"
        : /\bmutual_pool\b/.test(f.value) ? "mutual_pool"
        : /\boffers\b/.test(f.value) ? "offers"
        : "seeks";
      out.statedConnections.push({
        connectionType: facetConn,
        direction,
        role: facetRole ?? facetConn,
        domain: facetDom ?? "general",
        scope: f.scope,
      });
      if (CONNECTION_ONTOLOGY_SPECS[facetConn].chettyMixedSesContainer && facetDom) {
        pushUnique(out.guilds, `${facetDom}_guild`);
      }
    }
  }
  return out;
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
