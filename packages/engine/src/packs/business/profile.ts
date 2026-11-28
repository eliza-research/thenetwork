// The ONE place peonPack reads member data (the protected-attribute firewall). Typed candidate and
// job profiles are parsed from facet tags (schema.ts) and intents, once per World.
//
// Firewall rules (pnpm run sim checks sealed-attribute invariance end to end):
//   - only matchable / shareable facets, plus two kinds of agent_private facet the pack needs:
//     the candidate's company exclusions (a boundary: never show me to my employer) and the
//     agent's safety cues (scam, fake identity, discriminatory request);
//   - `peon:proxy:*` tags are skipped whatever their scope (zip, graduation year, gaps);
//   - Member.name and Member.age are never read (age is only the core minors gate).
import type { City, Facet, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { peonApplicationAnswered } from "../../../../core/src/generated/peonCapacity.ts";
import type { World } from "../../world.ts";
import {
  hasBusinessTagPrefix, isBusinessJobDetails, isBusinessProxyTag, isBusinessSearchDetails, isBusinessTagExact, SAFETY, stripBusinessTag, type BusinessMode,
} from "./schema.ts";

export type Evidence = "claimed" | "demonstrated" | "interview";
/** `reviewedIn`: the facet that reviewed the skill (a trusted source or an interview); none for a claim. */
export interface SkillClaim { level: number; evidence: Evidence; facetId: string; shareable: boolean; reviewedIn?: string }

export interface CandidateProfile {
  kind: "candidate"; id: MemberId;
  families: string[]; seniority?: number;
  seniorityFacetId?: string;
  /** The facet of a trusted source (connected source or vouch) that gave the level; none when only the candidate stated it. */
  seniorityReviewedIn?: string;
  skills: Map<string, SkillClaim>;
  floor?: number; modes: Set<BusinessMode>; areas: Set<string>;
  auth?: boolean; needsSponsor?: boolean; creds: Set<string>; excluded: Set<string>;
  startWeeks?: number;
  /** A live search intent. */
  searching: boolean; searchIntentAt?: number;
  fakeCue: boolean;
  /** Market the candidate lives in (core homeCity: a market, not a zip). */
  market: City;
}
export interface JobProfile {
  kind: "job"; id: MemberId; intentId?: string; title: string;
  company?: string; companyName?: string; verified: boolean;
  family?: string; seniority?: number; seniorityFacetId?: string;
  payMin?: number; payMax?: number; payFacetId?: string;
  mode?: BusinessMode; market?: City; area?: string;
  must: { skill: string; min: number }[]; nice: string[];
  openings: number; urgency: number; sponsors: boolean; credRequired?: string;
  /** Openings left on a service seat (seats.ts): the slate of one run never goes past it. Undefined in the simulated world. */
  seatCap?: number;
  /** Fill-by date stated at intake (ms), if any. */
  fillBy?: number;
  open: boolean; scamCue: boolean; discriminatoryRequest: boolean;
  postedAt?: number;
  /** Facet ids of the job's shareable facets (titles, must-haves), for explanations. */
  shareFacetIds: string[];
}
export type BusinessProfile = CandidateProfile | JobProfile;
export type PeonProfile = BusinessProfile;

/** A fact from a connected source or a member's vouch: reviewed (spec/memberStanding.md), not only stated. */
const trustedSource = (f: Facet): boolean => f.provenance === "connected_source" || f.provenance === "vouched";

/** Pipeline state per member, from the Network's own interaction log. */
export interface BusinessHistory {
  /** Intros in flight (pending candidate / employer answer, or interviewing). */
  inFlight: number;
  /** Candidate yeses waiting for the employer's review (job seats). */
  pendingReview: number;
  /** Applications the employer answered, yes or no (job seats: the company's probation ends). */
  answered: number;
}
export type PeonHistory = BusinessHistory;

interface Cache { profiles: Map<MemberId, PeonProfile | null>; history: Map<MemberId, PeonHistory>; extra: Map<string, unknown> }
const caches = new WeakMap<World, Cache>();

function cacheOf(w: World): Cache {
  let c = caches.get(w);
  if (!c) { c = build(w); caches.set(w, c); }
  return c;
}

/** Per-World scratch space for other pack modules (company probation, seats per company). */
export function worldScratch<V>(w: World, key: string, make: () => V): V {
  const c = cacheOf(w);
  if (!c.extra.has(key)) c.extra.set(key, make());
  return c.extra.get(key) as V;
}

export function profileOf(w: World, id: MemberId): PeonProfile | null { return cacheOf(w).profiles.get(id) ?? null; }
export function candidateOf(w: World, id: MemberId): CandidateProfile | null { const p = profileOf(w, id); return p?.kind === "candidate" ? p : null; }
export function jobOf(w: World, id: MemberId): JobProfile | null { const p = profileOf(w, id); return p?.kind === "job" ? p : null; }
export function historyOf(w: World, id: MemberId): PeonHistory { return cacheOf(w).history.get(id) ?? { inFlight: 0, pendingReview: 0, answered: 0 }; }
/** All job seats / candidates, sorted by id. */
export function jobs(w: World): JobProfile[] { return w.ids.map(id => jobOf(w, id)).filter((p): p is JobProfile => !!p); }
export function candidates(w: World): CandidateProfile[] { return w.ids.map(id => candidateOf(w, id)).filter((p): p is CandidateProfile => !!p); }

/** Facets the pack may read for a member (see the firewall rules above). */
function readable(f: Facet): boolean {
  if (f.scope === "matchable" || f.scope === "shareable") return true;
  if (f.scope !== "agent_private") return false;
  if (f.kind === "boundary" && f.tags.some(t => hasBusinessTagPrefix(t, "exclude"))) return true;
  return f.tags.some(t => t === SAFETY.scam || t === SAFETY.fakeCandidate || t === SAFETY.discriminatoryRequest);
}

const isFirewallBlockedTag = (t: string): boolean =>
  isBusinessProxyTag(t) || t.startsWith("appearance:") || t.startsWith("dating:") || t.startsWith("slop:");

function build(w: World): Cache {
  const now = w.now;
  const facetsBy = new Map<MemberId, Facet[]>();
  for (const f of w.input.facets) {
    if (f.validTo !== undefined && f.validTo < now) continue;
    if (f.validFrom !== undefined && f.validFrom > now) continue;
    if (!readable(f)) continue;
    const id = w.canonical(f.memberId);
    if (!w.get(id)) continue;
    if (!facetsBy.has(id)) facetsBy.set(id, []);
    facetsBy.get(id)!.push(f);
  }
  const profiles = new Map<MemberId, PeonProfile | null>();
  for (const id of w.ids) {
    const fs = (facetsBy.get(id) ?? []).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const tags = (f: Facet) => f.tags.filter(t => !isFirewallBlockedTag(t));
    const entity = fs.flatMap(tags).map(t => stripBusinessTag(t, "entity")).find(v => v !== undefined);
    const mi = w.get(id)!;
    if (entity === "candidate") {
      const p: CandidateProfile = {
        kind: "candidate", id, families: [], skills: new Map(), modes: new Set(), areas: new Set(), creds: new Set(), excluded: new Set(),
        searching: false, fakeCue: false, market: mi.m.homeCity,
      };
      const demonstrated = new Map<string, { level: number; facetId: string }>();
      for (const f of fs) for (const t of tags(f)) {
        let v: string | undefined;
        if ((v = stripBusinessTag(t, "family")) !== undefined) { if (!p.families.includes(v)) p.families.push(v); }
        else if ((v = stripBusinessTag(t, "seniority")) !== undefined) {
          p.seniority = Number(v);
          p.seniorityFacetId = f.id;
          p.seniorityReviewedIn = trustedSource(f) ? f.id : undefined;
        }
        else if ((v = stripBusinessTag(t, "skill")) !== undefined) {
          const [skill, lvl] = v.split(":");
          const evidence: Evidence = trustedSource(f) ? "demonstrated" : "claimed";
          const cur = p.skills.get(skill!);
          if (!cur || (evidence === "demonstrated" && cur.evidence === "claimed")) p.skills.set(skill!, { level: Number(lvl), evidence, facetId: f.id, shareable: f.scope === "shareable", reviewedIn: evidence === "demonstrated" ? f.id : undefined });
        } else if ((v = stripBusinessTag(t, "demonstrated")) !== undefined) {
          const [skill, lvl] = v.split(":");
          const cur = demonstrated.get(skill!);
          if (!cur || f.id > cur.facetId) demonstrated.set(skill!, { level: Number(lvl), facetId: f.id });
        } else if ((v = stripBusinessTag(t, "floor")) !== undefined) p.floor = Number(v);
        else if ((v = stripBusinessTag(t, "mode")) !== undefined) p.modes.add(v as BusinessMode);
        else if ((v = stripBusinessTag(t, "area")) !== undefined) p.areas.add(v);
        else if ((v = stripBusinessTag(t, "auth")) !== undefined) p.auth = v === "yes";
        else if ((v = stripBusinessTag(t, "needsSponsor")) !== undefined) p.needsSponsor = v === "yes";
        else if ((v = stripBusinessTag(t, "cred")) !== undefined) p.creds.add(v);
        else if ((v = stripBusinessTag(t, "exclude")) !== undefined) p.excluded.add(v);
        else if ((v = stripBusinessTag(t, "start")) !== undefined) p.startWeeks = Number(v);
        else if (t === SAFETY.fakeCandidate) p.fakeCue = true;
      }
      for (const [skill, d] of demonstrated) {
        const cur = p.skills.get(skill);
        p.skills.set(skill, { level: d.level, evidence: "interview", facetId: cur?.facetId ?? d.facetId, shareable: cur?.shareable ?? false, reviewedIn: d.facetId });
      }
      const it = mi.intents.find(i => i.category === "professional" && isBusinessSearchDetails(i.details));
      p.searching = !!it; p.searchIntentAt = it?.createdAt;
      profiles.set(id, p);
    } else if (entity === "job") {
      const it = mi.intents.find(i => i.category === "professional" && isBusinessJobDetails(i.details));
      const p: JobProfile = {
        kind: "job", id, intentId: it?.id, title: it ? it.objective.replace(/^Hire:\s*/i, "") : "a role",
        verified: false, must: [], nice: [], openings: 0, urgency: 1, sponsors: false,
        open: false, scamCue: false, discriminatoryRequest: false, postedAt: it?.createdAt, shareFacetIds: [],
      };
      for (const f of fs) {
        if (f.scope === "shareable") p.shareFacetIds.push(f.id);
        for (const t of tags(f)) {
          let v: string | undefined;
          if ((v = stripBusinessTag(t, "company")) !== undefined) { p.company = v; p.companyName = f.value.replace(/^Company:\s*/i, ""); }
          else if (isBusinessTagExact(t, "verified")) p.verified = true;
          else if ((v = stripBusinessTag(t, "family")) !== undefined) p.family = v;
          else if ((v = stripBusinessTag(t, "seniority")) !== undefined) {
            p.seniority = Number(v);
            p.seniorityFacetId = f.id;
          }
          else if ((v = stripBusinessTag(t, "pay")) !== undefined) {
            const [lo, hi] = v.split("-").map(Number);
            if (Number.isFinite(lo) && Number.isFinite(hi) && hi! >= lo! && lo! > 0) { p.payMin = lo; p.payMax = hi; p.payFacetId = f.id; }
          }
          else if ((v = stripBusinessTag(t, "mode")) !== undefined) p.mode = v as BusinessMode;
          else if ((v = stripBusinessTag(t, "market")) !== undefined) p.market = v as City;
          else if ((v = stripBusinessTag(t, "area")) !== undefined) p.area = v;
          else if ((v = stripBusinessTag(t, "must")) !== undefined) { const [skill, min] = v.split(":"); if (!p.must.some(m => m.skill === skill)) p.must.push({ skill: skill!, min: Number(min) }); }
          else if ((v = stripBusinessTag(t, "nice")) !== undefined) { if (!p.nice.includes(v)) p.nice.push(v); }
          else if ((v = stripBusinessTag(t, "openings")) !== undefined) p.openings = Number(v);
          else if ((v = stripBusinessTag(t, "seatCap")) !== undefined) p.seatCap = Number(v);
          else if ((v = stripBusinessTag(t, "urgency")) !== undefined) p.urgency = Number(v);
          else if ((v = stripBusinessTag(t, "fillBy")) !== undefined) p.fillBy = Number(v) * DAY;
          else if ((v = stripBusinessTag(t, "sponsors")) !== undefined) p.sponsors = v === "yes";
          else if ((v = stripBusinessTag(t, "credRequired")) !== undefined) p.credRequired = v;
          else if (t === SAFETY.scam) p.scamCue = true;
          else if (t === SAFETY.discriminatoryRequest) p.discriminatoryRequest = true; // refused: never a criterion, only logged
        }
      }
      p.market ??= mi.m.homeCity;
      p.open = !!it && p.openings > 0;
      profiles.set(id, p);
    } else profiles.set(id, null);
  }
  // Pipeline history from the Network's interaction log.
  const history = new Map<MemberId, PeonHistory>();
  const h = (id: MemberId) => { let x = history.get(id); if (!x) { x = { inFlight: 0, pendingReview: 0, answered: 0 }; history.set(id, x); } return x; };
  for (const r of w.interactions) {
    if (r.at > now) continue;
    if (r.outcome === "pending" || r.outcome === "accepted") for (const id of r.participants) if (now - r.at <= 28 * DAY) h(id).inFlight++;
    const seat = r.participants.find(id => profiles.get(id)?.kind === "job");
    const cand = r.participants.find(id => profiles.get(id)?.kind === "candidate");
    if (!seat || !cand) continue;
    const candidateAccepted = r.acceptedBy?.includes(cand) === true;
    const employerAnswered = r.acceptedBy?.includes(seat) === true || r.declinedBy?.includes(seat) === true;
    if (r.outcome === "pending" && candidateAccepted) h(seat).pendingReview++;
    if (peonApplicationAnswered(r.hireAcceptedAt ?? -1, now, candidateAccepted, employerAnswered)) h(seat).answered++;
  }
  return { profiles, history, extra: new Map() };
}

/** The candidate and the job seat of a two-person configuration (either order), or null. */
export function sides(w: World, ids: readonly MemberId[]): { cand: CandidateProfile; job: JobProfile } | null {
  if (ids.length !== 2) return null;
  const a = profileOf(w, ids[0]!), b = profileOf(w, ids[1]!);
  if (a?.kind === "candidate" && b?.kind === "job") return { cand: a, job: b };
  if (b?.kind === "candidate" && a?.kind === "job") return { cand: b, job: a };
  return null;
}
