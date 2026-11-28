// peon.biz snapshot schema: how hiring data rides on the core types (Member, Facet, Intent) without
// changing them. The world builder (packages/sim/src/apps/peon/snapshot.ts) writes these tags; the
// pack reads them ONLY through profile.ts. A leaf module (no engine imports).
//
// ENTITIES. Two kinds of member record share the core `Member` type:
//   - candidate: a person looking for work. Facet `peon:entity:candidate`, a live intent with
//     details "peon:search" (category professional).
//   - job seat: ONE open job, held by the verified hiring manager who owns it. Facet
//     `peon:entity:job`, a live intent "Hire: <title>" (category professional, details
//     "peon:job"), capacity in `peon:openings:<n>`. Member.name is the hiring manager's name and
//     Member.age is 18 (an 18+ confirmation, see below). A company with several jobs has several
//     seats; `peon:company:<id>` ties them together (verification, holds and audits are per company).
//   Why a seat per job (not jobs as extra intents of one employer member): the engine dedupes
//   candidates by participant set and budgets per member, so one member per job gives per-job
//   dedupe, per-job capacity and per-job congestion control with no engine change
//   (docs/results/2026-10-08-peon-pack.md 3.1).
//   In generic matching (match.ts) a seat is a Hire Offering entity whose id is its job intent id;
//   a candidate is Hire Seeking once per role family they seek.
//
// AGE. Hiring must not see age (ADEA 40+), but the core needs it for the minors gate. The snapshot
// carries Member.age = 18 for every confirmed adult ("18+: yes") and the stated age for declared
// minors (13-17), who may join but are never matched. True age lives only in the sealed store.
//
// SEALED ATTRIBUTES (sex, race/ethnicity, age, disability, caregiver status) are NEVER in a snapshot.
// They live in the simulator's sealed store and are read only by the adverse-impact audit.
//
// PROXIES (zip, graduation year, employment gaps) may be known to the agent (from a resume) and
// are stored agent_private under `peon:proxy:*`. profile.ts skips them by prefix and scope; the
// firewall tests change them and check that the pack's output does not move. Member.name is never
// read by the pack either.

/** Tag prefixes. Values are lower-case ids; numbers are plain integers. */
export const T = {
  entity: "peon:entity:",          // candidate | job
  family: "peon:family:",          // role family id (O*NET SOC based, skills.ts in the world)
  seniority: "peon:seniority:",    // 1 entry .. 5 principal
  skill: "peon:skill:",            // candidate: peon:skill:<skill>:<claimed level 0-5>
  demonstrated: "peon:demonstrated:", // candidate: peon:demonstrated:<skill>:<level> (interview feedback)
  must: "peon:must:",              // job: peon:must:<skill>:<min level>
  nice: "peon:nice:",              // job: peon:nice:<skill>
  pay: "peon:pay:",                // job: peon:pay:<min>-<max> ($k per year); absent = no range
  floor: "peon:pay_floor:",        // candidate: expected minimum ($k per year), never salary history
  mode: "peon:mode:",              // onsite | hybrid | remote (candidate: acceptable; job: its model)
  market: "peon:market:",          // job site market (sf | nyc); remote jobs: hiring market
  area: "peon:area:",              // job: site area; candidate: areas they will commute to (candidate-set)
  auth: "peon:auth:",              // candidate: yes | no (authorized to work in the US)
  needsSponsor: "peon:sponsorship:", // candidate: yes | no
  sponsors: "peon:sponsors:",      // job: yes | no
  cred: "peon:cred:",              // candidate: licence / credential held (rn, cdl, cpa)
  credRequired: "peon:cred_required:", // job: a job-related licence the employer states
  exclude: "peon:exclude:",        // candidate boundary: company id never to be shown to (current employer)
  company: "peon:company:",        // job: company id
  verified: "peon:verified",       // job: employer verified (domain, registry / EIN, a human call)
  openings: "peon:openings:",      // job: open headcount
  posting: "peon:posting:",        // service: a hiring manager's facet that belongs to one job posting (intent id); seats.ts
  postingUpdatedAt: "peon:posting_updated_at:", // service: private revision time of a posting (epoch ms)
  postingClosedReason: "peon:posting_closed_reason:", // service: private close reason of a posting (closed | filled)
  seatCap: "peon:seat_cap:",       // job seat: openings left this run (seats.ts peonSeatCapacity); caps the slate
  urgency: "peon:urgency:",        // job: 1-3
  fillBy: "peon:fill_by:",         // job: the fill-by date the employer stated at intake (epoch day)
  start: "peon:start_weeks:",      // candidate: can start in N weeks
  proxy: "peon:proxy:",            // NEVER READ: zip, grad_year, gap_months (agent_private)
} as const;

export const BT = {
  entity: "business:entity:",
  family: "business:family:",
  seniority: "business:seniority:",
  skill: "business:skill:",
  demonstrated: "business:demonstrated:",
  must: "business:must:",
  nice: "business:nice:",
  pay: "business:pay:",
  floor: "business:pay_floor:",
  mode: "business:mode:",
  market: "business:market:",
  area: "business:area:",
  auth: "business:auth:",
  needsSponsor: "business:sponsorship:",
  sponsors: "business:sponsors:",
  cred: "business:cred:",
  credRequired: "business:cred_required:",
  exclude: "business:exclude:",
  company: "business:company:",
  verified: "business:verified",
  openings: "business:openings:",
  posting: "business:posting:",
  postingUpdatedAt: "business:posting_updated_at:",
  postingClosedReason: "business:posting_closed_reason:",
  seatCap: "business:seat_cap:",
  urgency: "business:urgency:",
  fillBy: "business:fill_by:",
  start: "business:start_weeks:",
  proxy: "business:proxy:",
} as const;

export type BusinessTagKey = keyof typeof T;

export function stripBusinessTag(tag: string, key: BusinessTagKey): string | undefined {
  const b = BT[key];
  if (tag.startsWith(b)) return tag.slice(b.length);
  const p = T[key];
  if (tag.startsWith(p)) return tag.slice(p.length);
  return undefined;
}

export function hasBusinessTagPrefix(tag: string, key: BusinessTagKey): boolean {
  return tag.startsWith(BT[key]) || tag.startsWith(T[key]);
}

export function isBusinessTagExact(tag: string, key: BusinessTagKey): boolean {
  return tag === BT[key] || tag === T[key];
}

export function isBusinessProxyTag(tag: string): boolean {
  return tag.startsWith(BT.proxy) || tag.startsWith(T.proxy);
}

/** Safety cues the agent observed (agent_private facts, provenance inferred). The pack may read these. */
export const SAFETY = {
  scam: "safety:scam_pattern",               // employer asked for money / bank details / moved to WhatsApp
  fakeCandidate: "safety:identity_mismatch", // resume / identity inconsistencies
  discriminatoryRequest: "safety:discriminatory_request", // employer asked for a protected-trait filter (refused, logged)
} as const;

export const SEARCH_INTENT = "peon:search";
export const JOB_INTENT = "peon:job";
export const BUSINESS_SEARCH_INTENT = "business:search";
export const BUSINESS_JOB_INTENT = "business:job";
export const isBusinessSearchDetails = (details?: string): boolean => {
  const d = details ?? "";
  return d.startsWith(SEARCH_INTENT) || d.startsWith(BUSINESS_SEARCH_INTENT);
};
export const isBusinessJobDetails = (details?: string): boolean => {
  const d = details ?? "";
  return d.startsWith(JOB_INTENT) || d.startsWith(BUSINESS_JOB_INTENT);
};

/** Employers and candidate exclusions use the same key, including existing verified employer rows. */
export const businessCompanyKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
export const peonCompanyKey = businessCompanyKey;

export type BusinessMode = "onsite" | "hybrid" | "remote";
export type PeonMode = BusinessMode;
export const MODES: readonly BusinessMode[] = ["onsite", "hybrid", "remote"];

