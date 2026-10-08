// The ONE place peonPack reads member data (the protected-attribute firewall). Typed candidate and
// job profiles are parsed from facet tags (schema.ts) and intents, once per World.
//
// Firewall rules (tested in test/peon-firewall.test.ts):
//   - only matchable / shareable facets, plus two kinds of agent_private facet the pack needs:
//     the candidate's company exclusions (a boundary: never show me to my employer) and the
//     agent's safety cues (scam, fake identity, discriminatory request);
//   - `peon:proxy:*` tags are skipped whatever their scope (zip, graduation year, gaps);
//   - Member.name and Member.age are never read (age is only the core minors gate).
import type { City, Facet, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import type { World } from "../../world.ts";
import { JOB_INTENT, SAFETY, SEARCH_INTENT, T, type PeonMode } from "./schema.ts";

export type Evidence = "claimed" | "demonstrated" | "interview";
export interface SkillClaim { level: number; evidence: Evidence; facetId: string; shareable: boolean }

export interface CandidateProfile {
  kind: "candidate"; id: MemberId;
  families: string[]; seniority?: number;
  skills: Map<string, SkillClaim>;
  floor?: number; modes: Set<PeonMode>; areas: Set<string>;
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
  family?: string; seniority?: number;
  payMin?: number; payMax?: number; payFacetId?: string;
  mode?: PeonMode; market?: City; area?: string;
  must: { skill: string; min: number }[]; nice: string[];
  openings: number; urgency: number; sponsors: boolean; credRequired?: string;
  open: boolean; scamCue: boolean; discriminatoryRequest: boolean;
  postedAt?: number;
  /** Facet ids of the job's shareable facets (titles, must-haves), for explanations. */
  shareFacetIds: string[];
}
export type PeonProfile = CandidateProfile | JobProfile;

/** Pipeline state per member, from the Network's own interaction log. */
export interface PeonHistory {
  /** Intros in flight (pending candidate / employer answer, or interviewing). */
  inFlight: number;
  /** Candidate yeses waiting for the employer's review (job seats). */
  pendingReview: number;
  /** Applications the employer answered (yes or no) / let expire without an answer (job seats: responsiveness). */
  answered: number; ghosted: number;
  /** Candidate yeses received in the last 28 days (job seats). */
  applications28: number;
  /** All intros ever proposed to this member (job seats: total exposure so far). */
  intros: number;
  hires: number;
}

interface Cache { profiles: Map<MemberId, PeonProfile | null>; history: Map<MemberId, PeonHistory>; extra: Map<string, unknown> }
const caches = new WeakMap<World, Cache>();

function cacheOf(w: World): Cache {
  let c = caches.get(w);
  if (!c) { c = build(w); caches.set(w, c); }
  return c;
}

/** Per-World scratch space for other pack modules (pool sizes etc.). */
export function worldScratch<V>(w: World, key: string, make: () => V): V {
  const c = cacheOf(w);
  if (!c.extra.has(key)) c.extra.set(key, make());
  return c.extra.get(key) as V;
}

export function profileOf(w: World, id: MemberId): PeonProfile | null { return cacheOf(w).profiles.get(id) ?? null; }
export function candidateOf(w: World, id: MemberId): CandidateProfile | null { const p = profileOf(w, id); return p?.kind === "candidate" ? p : null; }
export function jobOf(w: World, id: MemberId): JobProfile | null { const p = profileOf(w, id); return p?.kind === "job" ? p : null; }
export function historyOf(w: World, id: MemberId): PeonHistory { return cacheOf(w).history.get(id) ?? { inFlight: 0, pendingReview: 0, answered: 0, ghosted: 0, applications28: 0, intros: 0, hires: 0 }; }
/** All job seats / candidates, sorted by id. */
export function jobs(w: World): JobProfile[] { return w.ids.map(id => jobOf(w, id)).filter((p): p is JobProfile => !!p); }
export function candidates(w: World): CandidateProfile[] { return w.ids.map(id => candidateOf(w, id)).filter((p): p is CandidateProfile => !!p); }

/** Split a tag "peon:x:a:b" after its prefix. */
const rest = (tag: string, prefix: string) => tag.slice(prefix.length).split(":");

/** Facets the pack may read for a member (see the firewall rules above). */
function readable(f: Facet): boolean {
  if (f.scope === "matchable" || f.scope === "shareable") return true;
  if (f.scope !== "agent_private") return false;
  if (f.kind === "boundary" && f.tags.some(t => t.startsWith(T.exclude))) return true;
  return f.tags.some(t => t === SAFETY.scam || t === SAFETY.fakeCandidate || t === SAFETY.discriminatoryRequest);
}

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
    const tags = (f: Facet) => f.tags.filter(t => !t.startsWith(T.proxy));
    const entity = fs.flatMap(tags).find(t => t.startsWith(T.entity))?.slice(T.entity.length);
    const mi = w.get(id)!;
    if (entity === "candidate") {
      const p: CandidateProfile = {
        kind: "candidate", id, families: [], skills: new Map(), modes: new Set(), areas: new Set(), creds: new Set(), excluded: new Set(),
        searching: false, fakeCue: false, market: mi.m.homeCity,
      };
      const demonstrated = new Map<string, { level: number; facetId: string }>();
      for (const f of fs) for (const t of tags(f)) {
        if (t.startsWith(T.family)) { const v = t.slice(T.family.length); if (!p.families.includes(v)) p.families.push(v); }
        else if (t.startsWith(T.seniority)) p.seniority = Number(t.slice(T.seniority.length));
        else if (t.startsWith(T.skill)) {
          const [skill, lvl] = rest(t, T.skill);
          const evidence: Evidence = f.provenance === "connected_source" || f.provenance === "vouched" ? "demonstrated" : "claimed";
          const cur = p.skills.get(skill!);
          if (!cur || (evidence === "demonstrated" && cur.evidence === "claimed")) p.skills.set(skill!, { level: Number(lvl), evidence, facetId: f.id, shareable: f.scope === "shareable" });
        } else if (t.startsWith(T.demonstrated)) {
          const [skill, lvl] = rest(t, T.demonstrated);
          const cur = demonstrated.get(skill!);
          // The latest interview wins (facet ids sort by time of writing in the world).
          if (!cur || f.id > cur.facetId) demonstrated.set(skill!, { level: Number(lvl), facetId: f.id });
        } else if (t.startsWith(T.floor)) p.floor = Number(t.slice(T.floor.length));
        else if (t.startsWith(T.mode)) p.modes.add(t.slice(T.mode.length) as PeonMode);
        else if (t.startsWith(T.area)) p.areas.add(t.slice(T.area.length));
        else if (t.startsWith(T.auth)) p.auth = t.slice(T.auth.length) === "yes";
        else if (t.startsWith(T.needsSponsor)) p.needsSponsor = t.slice(T.needsSponsor.length) === "yes";
        else if (t.startsWith(T.cred)) p.creds.add(t.slice(T.cred.length));
        else if (t.startsWith(T.exclude)) p.excluded.add(t.slice(T.exclude.length));
        else if (t.startsWith(T.start)) p.startWeeks = Number(t.slice(T.start.length));
        else if (t === SAFETY.fakeCandidate) p.fakeCue = true;
      }
      for (const [skill, d] of demonstrated) {
        const cur = p.skills.get(skill);
        p.skills.set(skill, { level: d.level, evidence: "interview", facetId: cur?.facetId ?? d.facetId, shareable: cur?.shareable ?? false });
      }
      const it = mi.intents.find(i => i.category === "professional" && (i.details ?? "").startsWith(SEARCH_INTENT));
      p.searching = !!it; p.searchIntentAt = it?.createdAt;
      profiles.set(id, p);
    } else if (entity === "job") {
      const it = mi.intents.find(i => i.category === "professional" && (i.details ?? "").startsWith(JOB_INTENT));
      const p: JobProfile = {
        kind: "job", id, intentId: it?.id, title: it ? it.objective.replace(/^Hire:\s*/i, "") : "a role",
        verified: false, must: [], nice: [], openings: 0, urgency: 1, sponsors: false,
        open: false, scamCue: false, discriminatoryRequest: false, postedAt: it?.createdAt, shareFacetIds: [],
      };
      for (const f of fs) {
        if (f.scope === "shareable") p.shareFacetIds.push(f.id);
        for (const t of tags(f)) {
          if (t.startsWith(T.company)) { p.company = t.slice(T.company.length); p.companyName = f.value.replace(/^Company:\s*/i, ""); }
          else if (t === T.verified) p.verified = true;
          else if (t.startsWith(T.family)) p.family = t.slice(T.family.length);
          else if (t.startsWith(T.seniority)) p.seniority = Number(t.slice(T.seniority.length));
          else if (t.startsWith(T.pay)) {
            const [lo, hi] = t.slice(T.pay.length).split("-").map(Number);
            if (Number.isFinite(lo) && Number.isFinite(hi) && hi! >= lo! && lo! > 0) { p.payMin = lo; p.payMax = hi; p.payFacetId = f.id; }
          }
          else if (t.startsWith(T.mode)) p.mode = t.slice(T.mode.length) as PeonMode;
          else if (t.startsWith(T.market)) p.market = t.slice(T.market.length) as City;
          else if (t.startsWith(T.area)) p.area = t.slice(T.area.length);
          else if (t.startsWith(T.must)) { const [skill, min] = rest(t, T.must); if (!p.must.some(m => m.skill === skill)) p.must.push({ skill: skill!, min: Number(min) }); }
          else if (t.startsWith(T.nice)) { const v = t.slice(T.nice.length); if (!p.nice.includes(v)) p.nice.push(v); }
          else if (t.startsWith(T.openings)) p.openings = Number(t.slice(T.openings.length));
          else if (t.startsWith(T.urgency)) p.urgency = Number(t.slice(T.urgency.length));
          else if (t.startsWith(T.sponsors)) p.sponsors = t.slice(T.sponsors.length) === "yes";
          else if (t.startsWith(T.credRequired)) p.credRequired = t.slice(T.credRequired.length);
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
  const h = (id: MemberId) => { let x = history.get(id); if (!x) { x = { inFlight: 0, pendingReview: 0, answered: 0, ghosted: 0, applications28: 0, intros: 0, hires: 0 }; history.set(id, x); } return x; };
  for (const r of w.interactions) {
    if (r.at > now) continue;
    for (const id of r.participants) {
      const x = h(id);
      x.intros++;
      if ((r.outcome === "pending" || r.outcome === "accepted") && now - r.at <= 28 * DAY) x.inFlight++;
      if (r.outcome === "completed") x.hires++;
    }
    const seat = r.participants.find(id => profiles.get(id)?.kind === "job");
    const cand = r.participants.find(id => profiles.get(id)?.kind === "candidate");
    if (seat && cand && (r.acceptedBy ?? []).includes(cand) && now - r.at <= 28 * DAY) h(seat).applications28++;
    if (seat && cand && r.outcome === "pending" && (r.acceptedBy ?? []).includes(cand)) h(seat).pendingReview++;
    if (seat && cand && (r.acceptedBy ?? []).includes(cand)) {
      if ((r.acceptedBy ?? []).includes(seat) || (r.declinedBy ?? []).includes(seat)) h(seat).answered++;
      else if ((r.noResponse ?? []).includes(seat)) h(seat).ghosted++;
    }
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
