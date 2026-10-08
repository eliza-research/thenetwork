// Build the engine snapshot for peon.biz from what the agent KNOWS: the stated profile from
// onboarding and job intake, the agent's own cues, and what the Network recorded (interactions,
// interview feedback, holds, blocks). The tag schema is the pack's (engine packs/peon/schema.ts).
//
// Never in a snapshot: sealed attributes (sex, race / ethnicity, age, disability, caregiver), true
// skill levels, true pay floor, interest / retention propensities, adversary labels, canaries in
// anything but an agent_private fact. Member.age is 18 for confirmed adults (an 18+ yes) and the
// stated age for declared minors. Proxies the agent may know (zip, graduation year, gaps) are
// agent_private `peon:proxy:*` facts that the pack never reads; Member.name is the person's name.
import { DAY, canBeMatched, type Edge, type Facet, type Intent, type Member, type MemberId, type Presence, type Proposal } from "@thenetwork/core";
import { JOB_INTENT, SAFETY, SEARCH_INTENT, T } from "@thenetwork/engine/src/packs/peon/schema.ts";
import type { EngineInput, InteractionRecord, SafetyHold } from "@thenetwork/engine/src/types.ts";
import type { Candidate, Job, PeonPopulation } from "./persona.ts";
import { FAMILY } from "./skills.ts";

/** Monday 2026-10-12 00:00 UTC: week 0 of every peon run. */
export const PEON_WORLD_START = Date.UTC(2026, 9, 12);

/** What the Network recorded so far (harness-maintained; all of it is visible to the Network). */
export interface PeonNetworkState {
  now: number; week: number;
  interactions: InteractionRecord[];
  recentProposals: Proposal[];
  safetyHolds: SafetyHold[];
  edges: Edge[];
  /** Interview feedback: demonstrated skill levels the employer reported (visible, matchable). */
  feedbackFacets: Facet[];
  /** Hired or otherwise out of the search. */
  hired: Set<MemberId>; exited: Set<MemberId>;
  /** Remaining openings per job seat. */
  openings: Map<MemberId, number>;
}

export type PeonSnapshot = EngineInput & { interactions: InteractionRecord[]; safetyHolds: SafetyHold[] };

const PREFS = { categoriesOptIn: ["professional" as const], quietHours: [21, 8] as [number, number], romanceOptIn: false, formats: ["one_to_one" as const], maxTravelMinutes: 60, onlyWhenAsked: false };
const human = (s: string) => s.replace(/_/g, " ");

export function buildPeonSnapshot(pop: PeonPopulation, state: PeonNetworkState): PeonSnapshot {
  const members: Member[] = [], facets: Facet[] = [], intents: Intent[] = [], presence: Presence[] = [];
  const week = state.week;
  const coById = new Map(pop.companies.map(c => [c.id, c]));
  for (const c of pop.candidates) {
    if (c.joinWeek > week) continue;
    addCandidate(c, state, members, facets, intents, presence);
  }
  for (const j of pop.jobs) {
    if (j.postedWeek > week) continue;
    const co = coById.get(j.company)!;
    const left = state.openings.get(j.id) ?? j.openings;
    const posted = PEON_WORLD_START + j.postedWeek * 7 * DAY;
    members.push({ id: j.id, name: j.manager, homeCity: j.market, state: "open", prefs: PREFS, joinedAt: posted, age: 18, unansweredProactive: 0 });
    presence.push({ memberId: j.id, city: j.market, type: "home", areas: j.area ? [j.area] : [] });
    let fi = 0;
    const add = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], provenance: Facet["provenance"] = "said") =>
      facets.push({ id: `${j.id}-f${String(fi++).padStart(2, "0")}`, memberId: j.id, kind, value, tags, scope, provenance, confidence: 0.95 });
    add("fact", "Hiring seat", [`${T.entity}job`], "matchable");
    add("fact", `Company: ${co.name}`, [`${T.company}${co.id}`], "shareable");
    if (co.verified) add("fact", "Employer verified", [T.verified], "matchable", "connected_source");
    add("fact", j.title, [`${T.family}${j.family}`, `${T.seniority}${j.seniority}`], "shareable");
    if (j.payMin !== undefined && j.payMax !== undefined) add("fact", `$${j.payMin}k-$${j.payMax}k`, [`${T.pay}${j.payMin}-${j.payMax}`], "shareable");
    add("fact", j.mode === "remote" ? "Remote" : `${j.mode === "hybrid" ? "Hybrid" : "Onsite"} in ${human(j.area!)}`, [`${T.mode}${j.mode}`, `${T.market}${j.market}`, ...(j.area ? [`${T.area}${j.area}`] : [])], "shareable");
    for (const m of j.must) add("skill", `Must have: ${human(m.skill)} (level ${m.min})`, [`${T.must}${m.skill}:${m.min}`, m.skill], "shareable");
    for (const s of j.nice) add("skill", `Nice to have: ${human(s)}`, [`${T.nice}${s}`, s], "shareable");
    add("fact", "Headcount", [`${T.openings}${left}`, `${T.urgency}${j.urgency}`, `${T.sponsors}${j.sponsors ? "yes" : "no"}`], "matchable");
    if (j.credRequired) add("fact", `Requires licence: ${j.credRequired}`, [`${T.credRequired}${j.credRequired}`], "shareable");
    if (co.scamCue) add("fact", "Intake flags: moved to WhatsApp, asked about bank details", [SAFETY.scam], "agent_private", "inferred");
    if (co.discriminatoryRequest) add("fact", "Intake: asked to filter by a protected trait (refused, logged)", [SAFETY.discriminatoryRequest], "agent_private", "inferred");
    intents.push({
      id: `${j.id}-job`, memberId: j.id, objective: `Hire: ${j.title}`, category: "professional", details: `${JOB_INTENT} ${left}`,
      horizonDays: 120, status: left > 0 ? "active" : "closed", createdAt: posted,
    });
  }
  facets.push(...state.feedbackFacets);
  return {
    now: state.now, members, facets, intents, presence,
    edges: state.edges.map(e => ({ ...e })), recentProposals: state.recentProposals,
    interactions: state.interactions.map(r => ({ ...r })), safetyHolds: state.safetyHolds.map(h => ({ ...h })),
  };
}

function addCandidate(c: Candidate, state: PeonNetworkState, members: Member[], facets: Facet[], intents: Intent[], presence: Presence[]) {
  const s = c.stated;
  const joined = PEON_WORLD_START + c.joinWeek * 7 * DAY;
  const out = state.hired.has(c.id) || state.exited.has(c.id);
  // The snapshot carries an 18+ confirmation for adults, the stated age for declared minors.
  const age = canBeMatched(s.declaredAge) ? 18 : s.declaredAge;
  members.push({ id: c.id, name: c.proxies.name, homeCity: c.market, state: out ? "paused" : "normal", prefs: PREFS, joinedAt: joined, age, unansweredProactive: 0 });
  presence.push({ memberId: c.id, city: c.market, type: "home", areas: [] });
  let fi = 0;
  const add = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], provenance: Facet["provenance"] = "said") =>
    facets.push({ id: `${c.id}-f${String(fi++).padStart(2, "0")}`, memberId: c.id, kind, value, tags, scope, provenance, confidence: 0.85 });
  add("fact", "Candidate profile", [`${T.entity}candidate`], "matchable");
  add("goal", `Target: ${s.families.map(f => FAMILY.get(f)!.title).join(" / ")}`, [...s.families.map(f => `${T.family}${f}`), `${T.seniority}${s.seniority}`], "matchable");
  // Skills: the three strongest claims are in the candidate-approved summary (shareable).
  const ranked = Object.entries(s.skills).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
  ranked.forEach(([skill, lvl], i) => add("skill", `${human(skill)} (level ${lvl})`, [`${T.skill}${skill}:${lvl}`, skill], i < 3 ? "shareable" : "matchable", s.demonstrated.includes(skill) ? "connected_source" : "said"));
  add("preference", `Pay floor $${s.floor}k`, [`${T.floor}${s.floor}`], "matchable");
  add("preference", `Work models: ${s.modes.join(", ")}; commute: ${s.areas.map(human).join(", ")}`, [...s.modes.map(m => `${T.mode}${m}`), ...s.areas.map(a => `${T.area}${a}`)], "matchable");
  add("fact", "Authorization and start", [`${T.auth}${s.auth ? "yes" : "no"}`, `${T.needsSponsor}${s.needsSponsor ? "yes" : "no"}`, `${T.start}${s.startWeeks}`], "matchable");
  for (const cr of s.creds) add("fact", `Licence: ${cr}`, [`${T.cred}${cr}`], "matchable");
  if (s.exclude) add("boundary", "Never show me to my current employer", [`${T.exclude}${s.exclude}`], "agent_private");
  // Proxies (from the resume / phone): agent_private, never read by the pack.
  add("fact", `Home zip ${c.proxies.zip}`, [`${T.proxy}zip:${c.proxies.zip}`], "agent_private");
  if (c.proxies.gradYear !== undefined) add("fact", `Graduated ${c.proxies.gradYear}`, [`${T.proxy}grad_year:${c.proxies.gradYear}`], "agent_private");
  if (c.proxies.gapMonths > 0) add("fact", `Resume gap ${c.proxies.gapMonths} months`, [`${T.proxy}gap_months:${c.proxies.gapMonths}`], "agent_private");
  add("fact", `Private note ${c.truth.canary}`, ["private"], "agent_private");
  if (c.fakeCue) add("fact", "Resume and identity details did not line up", [SAFETY.fakeCandidate], "agent_private", "inferred");
  intents.push({
    id: `${c.id}-search`, memberId: c.id, objective: `Find a ${s.families.map(f => FAMILY.get(f)!.title).join(" or ")} role`, category: "professional",
    details: SEARCH_INTENT, horizonDays: 120, status: out ? "closed" : "active", createdAt: joined,
  });
}

/** A proposal shell for `recentProposals` (pair history, budgets and exposure in the next snapshot). */
export function proposalShell(id: string, cand: MemberId, job: MemberId, city: Job["market"], at: number): Proposal {
  return {
    id, kind: "intro", participants: [cand, job], alternates: [], objective: "intro", category: "professional", city, score: 0,
    components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
    exploration: false, explanations: {}, generator: "harness", createdAt: at,
  };
}
