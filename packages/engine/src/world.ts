// Builds an immutable, canonical index over the engine input. Every identifier is mapped into
// ONE id space (member id) before any filter runs (ME-006; Soulmates pitfall: blocks stored in
// one id space and compared in another).
import type { Category, City, Edge, EdgeType, Facet, FacetKind, Intent, Member, MemberId, Presence, Proposal } from "@thenetwork/core";
import { canBeMatched, DAY, HOUR } from "@thenetwork/core";
import type { EngineConfig } from "./config.ts";
import { centroid, cosine, tokenize, type EmbedFn } from "./embed.ts";
import { sha256, stableStringify } from "./hash.ts";
import type { AppPack } from "./pack.ts";
import { networkPack } from "./packs/network/index.ts";
import type { EngineInput, FeedbackRecord, InteractionRecord, NetworkEvent, ReliabilityEvidence, Role } from "./types.ts";

import { intersect, subtract, union, type Interval } from "./interval.ts";
export type { Interval };
export const pairKey = (a: MemberId, b: MemberId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const BLOCKING_EDGES: ReadonlySet<EdgeType> = new Set<EdgeType>(["blocked", "avoid"]);
const CAP_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["skill", "offer", "resource"]);
const DESIRE_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["interest", "desire", "goal"]);
const MATCH_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["interest", "skill", "offer", "desire", "goal", "trait", "fact", "resource"]);

export interface RomanceProfile { is: string[]; seeks: string[]; ageMin: number; ageMax: number }

export interface MemberIndex {
  m: Member;
  /** Facets usable for matching: scope matchable|shareable (never agent_private / opportunity_specific). */
  match: Facet[];
  /** Facets that may be shown to other participants (ME-003). */
  share: Facet[];
  /** Non-shareable facet values: used by the leak checker. */
  privateValues: string[];
  caps: Facet[]; desires: Facet[];
  facetEmb: Map<string, number[]>;
  profileEmb: number[]; capEmb: number[]; desireEmb: number[];
  intents: Intent[];
  tags: Set<string>; cluster: string; revision: string;
  recentProactive: number; recentContribution: number; recentExposure30: number;
  categoryCount30: Map<Category, number>;
  lowExposure: boolean; newcomer: boolean; lowData: boolean;
  dealbreakers: string[]; romance?: RomanceProfile;
  isHost: boolean; degree: number; inviterRoot: string;
  presence: Presence[];
  /** v1.2: in an opportunity that was sent and is still open (config.dispatch.skipOpenOpportunities). */
  inOpenOpportunity: boolean;
  /** v1.2: estimated P(this member says yes to an invite), engine-visible data only (acceptanceOf). */
  acceptance: number;
}

export class World {
  readonly now: number;
  readonly members = new Map<MemberId, MemberIndex>();
  readonly ids: MemberId[];
  readonly blocked = new Set<string>();
  readonly positive = new Map<MemberId, Map<MemberId, number>>();
  readonly edgeTypes = new Map<string, Set<EdgeType>>();
  readonly holds = new Set<MemberId>();
  /** Members under 18 (or with no valid age). Never connected to anyone (minors policy, PRD 17.4). */
  readonly minors = new Set<MemberId>();
  readonly negativeFeedback = new Map<string, number>();
  readonly feedback: FeedbackRecord[];
  readonly pairInteractions = new Map<string, InteractionRecord[]>();
  readonly interactions: InteractionRecord[];
  readonly memberCategoryDeclines = new Map<MemberId, Map<Category, number>>();
  readonly activePairs = new Set<string>();
  readonly recentPairs = new Map<string, number>();
  readonly events: NetworkEvent[];
  readonly eventEmb = new Map<string, number[]>();
  readonly intentEmb = new Map<string, number[]>();
  readonly intentById = new Map<string, Intent>();
  readonly reliability: Record<MemberId, ReliabilityEvidence>;
  readonly quotas: NonNullable<EngineInput["categoryQuotas"]>;
  readonly embed: EmbedFn;
  readonly dim: number;
  readonly canonical: (id: MemberId) => MemberId;

  /** The app pack (default networkPack). Identity travels beside the config, never inside it (byte-identity rule 1). */
  readonly pack: AppPack;

  constructor(readonly input: EngineInput, readonly cfg: EngineConfig, embed: EmbedFn, pack: AppPack = networkPack) {
    this.pack = pack;
    this.now = input.now;
    this.embed = embed;
    const aliases = input.idAliases ?? {};
    const memberIds = new Set(input.members.map(m => m.id));
    // Resolve alias chains; unknown ids are kept as-is (they simply never match a member).
    this.canonical = (id: MemberId) => {
      let cur = id; let hops = 0;
      while (!memberIds.has(cur) && aliases[cur] !== undefined && hops++ < 8) cur = aliases[cur]!;
      return cur;
    };
    const C = this.canonical;
    this.dim = embed("dimension probe").length;
    const now = this.now;

    // Duplicate member ids would decide age, state and consent by row order (engine-pipeline-2): reject them.
    if (memberIds.size !== input.members.length) {
      const seen = new Set<MemberId>();
      const dup = input.members.find(m => (seen.has(m.id) ? true : (seen.add(m.id), false)));
      throw new Error(`duplicate member id in engine input: ${dup?.id}`);
    }
    // Minors are identified before anything else so no derived structure can route through them.
    for (const m of input.members) if (!canBeMatched(m.age)) this.minors.add(m.id);

    // --- edges -------------------------------------------------------------------------
    const edges: Edge[] = input.edges.map(e => ({ ...e, from: C(e.from), to: C(e.to) }));
    for (const e of edges) {
      if (e.from === e.to) continue;
      const k = pairKey(e.from, e.to);
      if (!this.edgeTypes.has(k)) this.edgeTypes.set(k, new Set());
      this.edgeTypes.get(k)!.add(e.type);
      if (BLOCKING_EDGES.has(e.type)) this.blocked.add(k);
      // Minors policy: a minor is never a warm tie, a two-hop intermediary (`via`), or a source of
      // degree / "friendliness" for anyone. Their edges stay out of the warm graph entirely.
      if (pack.ontology.warmEdges.has(e.type) && !this.minors.has(e.from) && !this.minors.has(e.to)) {
        for (const [a, b] of [[e.from, e.to], [e.to, e.from]] as const) {
          if (!this.positive.has(a)) this.positive.set(a, new Map());
          const cur = this.positive.get(a)!.get(b) ?? 0;
          this.positive.get(a)!.set(b, Math.max(cur, Math.min(1, Math.max(0.1, e.strength))));
        }
      }
    }
    // Blocks dominate: a blocked pair is never treated as a warm tie.
    for (const k of this.blocked) {
      const [a, b] = k.split("|") as [string, string];
      this.positive.get(a)?.delete(b); this.positive.get(b)?.delete(a);
    }

    // --- safety holds --------------------------------------------------------------------
    for (const h of input.safetyHolds ?? []) {
      if (h.from <= now && (h.to === undefined || h.to > now)) this.holds.add(C(h.memberId));
    }

    // --- feedback (cooldowns persist whether or not processed) ---------------------------
    this.feedback = (input.feedback ?? []).map(f => ({ ...f, from: C(f.from), about: C(f.about) }));
    for (const f of this.feedback) {
      if (f.sentiment === "negative" || (f.wouldMeetAgain === false && f.sentiment !== "positive")) {
        const k = pairKey(f.from, f.about);
        this.negativeFeedback.set(k, Math.max(this.negativeFeedback.get(k) ?? -Infinity, f.at));
      }
    }

    // --- open opportunities (v1.2 dispatch awareness) ----------------------------------------
    const openMembers = new Set<MemberId>();
    if (cfg.dispatch.skipOpenOpportunities) {
      for (const o of input.openOpportunities ?? []) if (o.until === undefined || o.until > now) for (const id of o.participants) openMembers.add(C(id));
    }

    // --- interactions ----------------------------------------------------------------------
    this.interactions = (input.interactions ?? []).map(r => ({
      ...r, participants: r.participants.map(C), declinedBy: r.declinedBy?.map(C), contributors: r.contributors?.map(C),
    }));
    for (const r of this.interactions) {
      for (let i = 0; i < r.participants.length; i++) for (let j = i + 1; j < r.participants.length; j++) {
        const k = pairKey(r.participants[i]!, r.participants[j]!);
        if (!this.pairInteractions.has(k)) this.pairInteractions.set(k, []);
        this.pairInteractions.get(k)!.push(r);
        if ((r.outcome === "pending" || r.outcome === "accepted") && now - r.at < cfg.cooldowns.activeProposalDays * DAY * 4) this.activePairs.add(k);
      }
      if (r.outcome === "declined" || r.outcome === "expired") {
        const who = r.outcome === "declined" ? (r.declinedBy?.length ? r.declinedBy : r.participants) : r.participants;
        for (const m of who) {
          if (!this.memberCategoryDeclines.has(m)) this.memberCategoryDeclines.set(m, new Map());
          const mm = this.memberCategoryDeclines.get(m)!;
          mm.set(r.category, Math.max(mm.get(r.category) ?? -Infinity, r.at));
        }
      }
    }
    // Recent proposals (not yet resolved in interactions) are active duplicates for a while.
    const resolved = new Set(this.interactions.filter(r => r.outcome !== "pending").map(r => r.id));
    // v1.2: proposals the Network never sent neither count against budgets nor block the pair.
    const unsent = new Set(cfg.dispatch.billOnlySent ? input.unsentProposalIds ?? [] : []);
    const recent: Proposal[] = (input.recentProposals ?? []).filter(p => !unsent.has(p.id)).map(p => ({
      ...p, participants: p.participants.map(C), alternates: (p.alternates ?? []).map(C),
    }));
    for (const p of recent) {
      for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) {
        const k = pairKey(p.participants[i]!, p.participants[j]!);
        this.recentPairs.set(k, Math.max(this.recentPairs.get(k) ?? -Infinity, p.createdAt));
        if (!resolved.has(p.id) && now - p.createdAt < cfg.cooldowns.activeProposalDays * DAY) this.activePairs.add(k);
      }
    }

    // --- events ------------------------------------------------------------------------------
    this.events = [...(input.events ?? [])].filter(e => e.end > now).sort((a, b) => (a.start - b.start) || (a.id < b.id ? -1 : 1));
    for (const e of this.events) this.eventEmb.set(e.id, embed(`${e.title} ${e.description ?? ""} ${e.tags.join(" ")}`));

    this.reliability = Object.fromEntries(Object.entries(input.reliability ?? {}).map(([k, v]) => [C(k), v]));
    this.quotas = Object.fromEntries(Object.entries(input.categoryQuotas ?? {}).map(([k, v]) => [C(k), v]));

    // --- members -------------------------------------------------------------------------------
    const facetsBy = new Map<MemberId, Facet[]>();
    for (const f of input.facets) {
      const id = C(f.memberId);
      if (f.validTo !== undefined && f.validTo < now) continue;
      if (f.validFrom !== undefined && f.validFrom > now) continue;
      if (!facetsBy.has(id)) facetsBy.set(id, []);
      facetsBy.get(id)!.push({ ...f, memberId: id });
    }
    const intentsBy = new Map<MemberId, Intent[]>();
    // v1.2: personal-growth wants are matched as hobby; stating one opts the member in to hobby
    // (networkPack.ontology.relabelIntent). Member -> lanes the member is opted in to by relabelling.
    const growthAsHobby = new Map<MemberId, Category[]>();
    for (const it of input.intents) {
      const id = C(it.memberId);
      const relabel = pack.ontology.relabelIntent?.(it, cfg);
      if (relabel) { if (!growthAsHobby.has(id)) growthAsHobby.set(id, []); if (!growthAsHobby.get(id)!.includes(relabel)) growthAsHobby.get(id)!.push(relabel); }
      const live = it.status === "active" && it.createdAt + it.horizonDays * DAY > now;
      if (!live) continue;
      const intent: Intent = { ...it, memberId: id, ...(relabel ? { category: relabel } : {}) };
      if (!intentsBy.has(id)) intentsBy.set(id, []);
      intentsBy.get(id)!.push(intent);
      this.intentById.set(intent.id, intent);
      this.intentEmb.set(intent.id, intent.embedding ?? embed(intentText(intent)));
    }
    const presenceBy = new Map<MemberId, Presence[]>();
    for (const p of input.presence) {
      const id = C(p.memberId);
      if (!presenceBy.has(id)) presenceBy.set(id, []);
      presenceBy.get(id)!.push({ ...p, memberId: id });
    }
    // Per-member counts from recent proposals.
    const proactive = new Map<MemberId, number>(), contrib = new Map<MemberId, number>(), exposure30 = new Map<MemberId, number>();
    const cat30 = new Map<MemberId, Map<Category, number>>();
    const stateById = new Map(input.members.map(m => [m.id, m.state] as const));
    const recentIds = new Set(recent.map(p => p.id));
    for (const p of recent) {
      const age = now - p.createdAt;
      if (age < 0) continue;
      const roles = (p as any).roles as Record<MemberId, Role> | undefined;
      const category = (p as any).category as Category | undefined;
      for (const raw of p.participants) {
        const id = C(raw);
        const st = stateById.get(id) ?? "normal";
        const period = cfg.budgets[st].periodDays * DAY;
        if (age < period) proactive.set(id, (proactive.get(id) ?? 0) + 1);
        const role = roles?.[raw] ?? roles?.[id];
        const isContrib = role ? pack.ontology.contributorRoles.has(role) : (p.kind === "help" && p.participants[0] !== raw);
        if (isContrib && age < cfg.contribution.periodDays * DAY) contrib.set(id, (contrib.get(id) ?? 0) + 1);
        if (age < 30 * DAY) {
          exposure30.set(id, (exposure30.get(id) ?? 0) + 1);
          if (category) {
            if (!cat30.has(id)) cat30.set(id, new Map());
            cat30.get(id)!.set(category, (cat30.get(id)!.get(category) ?? 0) + 1);
          }
        }
      }
    }
    for (const r of this.interactions) {
      if (now - r.at > cfg.contribution.periodDays * DAY || r.at > now) continue;
      for (const c of r.contributors ?? []) if (!recentIds.has(r.id)) contrib.set(c, (contrib.get(c) ?? 0) + 1);
    }

    const tagCount = new Map<string, number>();
    const response = responseHistory(this.interactions, now);
    for (const raw of [...input.members].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const addLanes = (growthAsHobby.get(raw.id) ?? []).filter(l => !raw.prefs.categoriesOptIn.includes(l));
      const m: Member = addLanes.length
        ? { ...raw, prefs: { ...raw.prefs, categoriesOptIn: [...raw.prefs.categoriesOptIn, ...addLanes] } } : raw;
      const all = facetsBy.get(m.id) ?? [];
      const match = all.filter(f => (f.scope === "matchable" || f.scope === "shareable") && MATCH_KINDS.has(f.kind));
      const share = all.filter(f => f.scope === "shareable");
      const privateValues = all.filter(f => f.scope !== "shareable").map(f => f.value);
      const facetEmb = new Map<string, number[]>();
      for (const f of match) facetEmb.set(f.id, f.embedding ?? embed(`${f.value} ${f.tags.join(" ")}`));
      const caps = match.filter(f => CAP_KINDS.has(f.kind));
      const desires = match.filter(f => DESIRE_KINDS.has(f.kind));
      const vecs = (fs: Facet[]) => fs.map(f => facetEmb.get(f.id)!);
      const tags = new Set<string>();
      for (const f of match) for (const t of f.tags) tags.add(t.toLowerCase());
      // Cluster = dominant interest tag (deterministic tie-break); used for diversity & expansion.
      const tc = new Map<string, number>();
      for (const f of desires) for (const t of f.tags) tc.set(t.toLowerCase(), (tc.get(t.toLowerCase()) ?? 0) + 1);
      const cluster = [...tc.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "none";
      for (const t of tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
      const boundaries = all.filter(f => f.kind === "boundary" || f.kind === "preference");
      const { dealbreakers, romance } = pack.ontology.constraints(boundaries);
      const revision = sha256(stableStringify({
        f: all.map(f => [f.id, f.value, f.scope, f.tags, f.confidence]).sort(),
        i: (intentsBy.get(m.id) ?? []).map(i => [i.id, i.objective, i.details ?? "", i.status]).sort(),
        p: m.prefs, s: m.state,
      })).slice(0, 12);
      const exp30 = exposure30.get(m.id) ?? 0;
      const newcomer = now - m.joinedAt < cfg.newcomerDays * DAY;
      this.members.set(m.id, {
        m, match, share, privateValues, caps, desires, facetEmb,
        profileEmb: match.length ? centroid(vecs(match), this.dim) : new Array(this.dim).fill(0),
        capEmb: caps.length ? centroid(vecs(caps), this.dim) : new Array(this.dim).fill(0),
        desireEmb: desires.length ? centroid(vecs(desires), this.dim) : new Array(this.dim).fill(0),
        intents: (intentsBy.get(m.id) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1)),
        tags, cluster, revision,
        recentProactive: proactive.get(m.id) ?? 0,
        recentContribution: contrib.get(m.id) ?? 0,
        recentExposure30: exp30,
        categoryCount30: cat30.get(m.id) ?? new Map(),
        lowExposure: exp30 <= cfg.retrieval.lowExposureMax,
        newcomer, lowData: match.length < 3,
        dealbreakers, romance,
        isHost: pack.ontology.isHost(match),
        degree: this.positive.get(m.id)?.size ?? 0,
        inviterRoot: "",
        presence: presenceBy.get(m.id) ?? [],
        inOpenOpportunity: openMembers.has(m.id),
        acceptance: acceptanceOf(cfg, m, intentsBy.get(m.id) ?? [], response.get(m.id), proactive.get(m.id) ?? 0, now),
      });
    }
    this.ids = [...this.members.keys()].sort();
    // Inviter cluster (fairness cohort): follow invitedBy to the root.
    for (const id of this.ids) {
      let cur = id; const seen = new Set<string>();
      while (true) {
        const inv = this.members.get(cur)?.m.invitedBy;
        // Never follow an invite chain into a minor: their id must not surface as a fairness cohort key.
        if (!inv || seen.has(inv) || !this.members.has(C(inv)) || this.minors.has(C(inv))) break;
        seen.add(cur); cur = C(inv);
      }
      this.members.get(id)!.inviterRoot = cur;
    }
  }

  get(id: MemberId): MemberIndex | undefined { return this.members.get(id); }

  /** Where a member is during [start,end): city -> intervals. Temporary presence overrides home (ME-011). Delegates to the pack's geo model. */
  location(id: MemberId, start: number, end: number): Map<City, Interval[]> {
    return this.pack.geo.location(this, id, start, end);
  }

  private locCache = new Map<string, Map<City, Interval[]>>();
  /** Memoised `location` (the world is immutable, so a member's whereabouts for a window never change). */
  locationCached(id: MemberId, start: number, end: number): Map<City, Interval[]> {
    const k = `${id}|${start}|${end}`;
    let v = this.locCache.get(k);
    if (!v) { v = this.location(id, start, end); this.locCache.set(k, v); }
    return v;
  }

  /**
   * True if all `ids` share enough time in one run city during the default opportunity window.
   * Generators use this before ranking so co-location never costs a candidate its top-K slot.
   */
  canMeet(ids: MemberId[]): boolean {
    const start = this.now, end = this.now + this.cfg.windowDays * DAY;
    if (ids.length !== 2) return this.overlap(ids, start, end) !== null;
    const k = pairKey(ids[0]!, ids[1]!);
    let v = this.meetCache.get(k);
    if (v === undefined) {
      // Fast path: no run city in common at all (the common case across SF/NYC).
      const la = this.locationCached(ids[0]!, start, end), lb = this.locationCached(ids[1]!, start, end);
      v = this.pack.geo.markets(this.cfg).some(c => la.has(c) && lb.has(c)) && this.overlap(ids, start, end) !== null;
      this.meetCache.set(k, v);
    }
    return v;
  }
  private meetCache = new Map<string, boolean>();

  /** Common availability of all members in one city (prefers `preferred`, else largest overlap). The pack's geo model decides. */
  overlap(ids: MemberId[], start: number, end: number, preferred?: City): { city: City; intervals: Interval[]; hours: number } | null {
    return this.pack.geo.overlap(this, ids, start, end, preferred);
  }

  /** Best matching facet of `member` for a query embedding among `facets`. */
  bestFacet(member: MemberIndex, q: number[], facets: "caps" | "desires" | "match"): { sim: number; facet?: Facet } {
    let best = 0; let bf: Facet | undefined;
    for (const f of member[facets]) {
      const s = cosine(q, member.facetEmb.get(f.id)!) * provenanceWeight(f);
      if (s > best || (s === best && bf && f.id < bf.id)) { best = s; bf = f; }
    }
    return { sim: best, facet: bf };
  }

  /** Fit of a free-text intent to a member: best facet similarity plus a tag bonus. */
  intentFit(intent: Intent, member: MemberIndex, facets: "caps" | "desires" | "match" = "caps"): { sim: number; facet?: Facet } {
    const q = this.intentEmb.get(intent.id)!;
    const r = this.bestFacet(member, q, facets);
    if (r.facet) {
      const toks = new Set(tokenize(intentText(intent)));
      if (r.facet.tags.some(t => toks.has(t.toLowerCase()))) r.sim = Math.min(1, r.sim + 0.15);
    }
    return r;
  }

  isWarm(a: MemberId, b: MemberId): boolean { return this.positive.get(a)?.has(b) ?? false; }
  edgeHas(a: MemberId, b: MemberId, t: EdgeType): boolean { return this.edgeTypes.get(pairKey(a, b))?.has(t) ?? false; }
}

/** Per member: invites answered yes / all invites resolved (yes, no, or expired unanswered). */
export function responseHistory(interactions: InteractionRecord[], now: number): Map<MemberId, { yes: number; n: number }> {
  const out = new Map<MemberId, { yes: number; n: number }>();
  const bump = (id: MemberId, yes: boolean) => { const a = out.get(id) ?? { yes: 0, n: 0 }; a.n++; if (yes) a.yes++; out.set(id, a); };
  for (const r of interactions) {
    if (r.at > now) continue;
    for (const id of r.acceptedBy ?? []) bump(id, true);
    for (const id of r.declinedBy ?? []) bump(id, false);
    for (const id of r.noResponse ?? []) bump(id, false);
  }
  return out;
}

/**
 * v1.2 acceptance estimate: P(member says yes to the next invite), from engine-visible data only
 * (no oracle, no hidden truth). A Beta-smoothed share of the invites the member said yes to,
 * with prior `acceptance.prior` and weight `acceptance.strength`.
 */
export function acceptanceOf(cfg: EngineConfig, m: Member, intents: Intent[], hist: { yes: number; n: number } | undefined, recentProactive: number, now: number): number {
  const A = cfg.acceptance;
  return ((hist?.yes ?? 0) + A.prior * A.strength) / ((hist?.n ?? 0) + A.strength);
}

export function intentText(i: Intent): string {
  return `${i.objective} ${i.details ?? ""} ${i.desiredPeople ?? ""}`;
}

export function provenanceWeight(f: Facet): number {
  const p = f.provenance === "said" || f.provenance === "vouched" ? 1 : f.provenance === "connected_source" ? 0.95 : 0.8;
  return p * (0.6 + 0.4 * Math.max(0, Math.min(1, f.confidence)));
}

// ---- interval helpers (moved to interval.ts, a leaf module the geo models share) ----
export { intersect, subtract, union } from "./interval.ts";

export function buildWorld(input: EngineInput, cfg: EngineConfig, embed: EmbedFn): World {
  return new World(input, cfg, embed);
}
