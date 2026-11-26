// Builds an immutable, canonical index over the engine input. Every identifier is mapped into
// ONE id space (member id) before any filter runs (ME-006; Soulmates pitfall: blocks stored in
// one id space and compared in another).
import { MatchRun } from "./match/run.ts";
import type { Category, City, Edge, EdgeType, Facet, FacetKind, Intent, Member, MemberId, Presence } from "@thenetwork/core";
import { ADULT_AGE, canBeMatched, DAY, earliestDayKeyOf, latestDayKeyOf } from "@thenetwork/core";
import { mayFollowMemberAlias } from "../../core/src/generated/datingRadius.ts";
import { matchingExpiryCooldown, matchingPairHistory } from "../../core/src/generated/matchingHistory.ts";
import { standingIntentLive } from "../../core/src/standing-intent.ts";
import type { EngineConfig } from "./config.ts";
import { centroid, cosine, tokenize, type EmbedFn } from "./embed.ts";
import { sha256, stableStringify } from "./hash.ts";
import {
  buildAdultCsrGraph, computeAdamicAdar, computeBurtBrokerage, detectLeidenCommunities,
  type AdultGraphMemberInput, type CsrAdultGraph, type LeidenPartition,
} from "./leiden.ts";
import type { AppPack } from "./pack.ts";
import { networkPack } from "./packs/network/index.ts";
import { SpatialIndex, type SpatialMemberInput } from "./spatialIndex.ts";
import type { EngineInput, FeedbackRecord, InteractionRecord, NetworkEvent, RecentProposal, ReliabilityEvidence, Role } from "./types.ts";

import type { Interval } from "./interval.ts";
export type { Interval };
export const pairKey = (a: MemberId, b: MemberId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export type MemberIdResolver = (id: MemberId) => MemberId;

/** Follow the aliases from this input and give a current member ID priority. */
export function memberIdResolver(input: Pick<EngineInput, "members" | "idAliases">, knownMemberIds?: ReadonlySet<MemberId>): MemberIdResolver {
  const aliases = input.idAliases;
  if (!aliases) return id => id;
  const memberIds = knownMemberIds ?? new Set(input.members.map(member => member.id));
  return id => {
    let current = id;
    let hops = 0;
    while (mayFollowMemberAlias(memberIds.has(current), Object.hasOwn(aliases, current), hops)) {
      current = aliases[current]!;
      hops++;
    }
    return current;
  };
}

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
  leidenMicroId?: number;
  leidenMesoId?: number;
}

class LazyVectorMap extends Map<string, number[]> {
  private readonly sources = new Map<string, () => number[]>();
  registerLazy(id: string, compute: () => number[]): void {
    this.sources.set(id, compute);
  }
  override get(key: string): number[] | undefined {
    const existing = super.get(key);
    if (existing !== undefined) return existing;
    const fn = this.sources.get(key);
    if (!fn) return undefined;
    const val = fn();
    super.set(key, val);
    this.sources.delete(key);
    return val;
  }
  override has(key: string): boolean {
    return super.has(key) || this.sources.has(key);
  }
}

export class World {
  readonly now: number;
  readonly members = new Map<MemberId, MemberIndex>();
  readonly ids: MemberId[];
  readonly blocked = new Set<string>();
  readonly positive = new Map<MemberId, Map<MemberId, number>>();
  readonly edgeTypes = new Map<string, Set<EdgeType>>();
  readonly holds = new Set<MemberId>();
  readonly minors = new Set<MemberId>();
  readonly negativeFeedback = new Map<string, number>();
  readonly feedbackByPair = new Map<string, FeedbackRecord[]>();
  readonly feedback: FeedbackRecord[];
  readonly pairInteractions = new Map<string, InteractionRecord[]>();
  readonly interactions: InteractionRecord[];
  readonly memberCategoryDeclines = new Map<MemberId, Map<Category, number>>();
  readonly activePairs = new Set<string>();
  readonly recentPairs = new Map<string, number>();
  readonly events: NetworkEvent[];
  readonly eventEmb: Map<string, number[]> = new LazyVectorMap();
  readonly intentEmb: Map<string, number[]> = new LazyVectorMap();
  readonly intentTokens = new Map<string, ReadonlySet<string>>();
  readonly intentById = new Map<string, Intent>();
  readonly presenceByMember = new Map<MemberId, Presence[]>();
  readonly reliability: Record<MemberId, ReliabilityEvidence>;
  readonly quotas: NonNullable<EngineInput["categoryQuotas"]>;
  readonly embed: EmbedFn;
  readonly dim: number;
  readonly canonical: (id: MemberId) => MemberId;
  readonly teenIntros: boolean;
  readonly minDay: number;
  readonly maxDay: number;

  /** The app pack (default networkPack). Identity travels beside the config, never inside it (byte-identity rule 1). */
  readonly pack: AppPack;

  private readonly adultGraphInputs: AdultGraphMemberInput[] = [];
  private readonly pausedAdultIds = new Set<MemberId>();
  private readonly allFacetsByMember = new Map<MemberId, Facet[]>();
  private cachedAdultGraph: CsrAdultGraph | undefined;
  private cachedLeidenMicro: LeidenPartition | undefined;
  private cachedLeidenMeso: LeidenPartition | undefined;
  private cachedBrokerage: Map<MemberId, number> | undefined;
  private cachedAdamicAdar: Map<MemberId, Map<MemberId, number>> | undefined;
  private cachedSpatialIndex: SpatialIndex | undefined;

  get adultGraph(): CsrAdultGraph {
    return this.cachedAdultGraph ??= buildAdultCsrGraph(this.adultGraphInputs, this.positive, this.blocked, this.minors);
  }

  get leidenMicro(): LeidenPartition {
    if (!this.cachedLeidenMicro) {
      this.cachedLeidenMicro = detectLeidenCommunities(this.adultGraph, 2.5);
      for (const id of this.adultGraph.ids) {
        const mi = this.members.get(id);
        if (mi) mi.leidenMicroId = this.cachedLeidenMicro.communityOf.get(id);
      }
    }
    return this.cachedLeidenMicro;
  }

  get leidenMeso(): LeidenPartition {
    if (!this.cachedLeidenMeso) {
      this.cachedLeidenMeso = detectLeidenCommunities(this.adultGraph, 1.0);
      for (const id of this.adultGraph.ids) {
        const mi = this.members.get(id);
        if (mi) mi.leidenMesoId = this.cachedLeidenMeso.communityOf.get(id);
      }
    }
    return this.cachedLeidenMeso;
  }

  get brokerage(): ReadonlyMap<MemberId, number> {
    return this.cachedBrokerage ??= computeBurtBrokerage(
      this.adultGraphInputs.map(a => a.id), this.positive, this.minors,
    );
  }

  get adamicAdar(): ReadonlyMap<MemberId, ReadonlyMap<MemberId, number>> {
    return this.cachedAdamicAdar ??= computeAdamicAdar(
      this.adultGraphInputs.map(a => a.id), this.positive, this.holds, this.pausedAdultIds, this.minors, this.blocked,
    );
  }

  get spatialIndex(): SpatialIndex {
    if (this.cachedSpatialIndex) return this.cachedSpatialIndex;
    const adultIds = this.adultGraphInputs.map(a => a.id);
    const brokerage = this.brokerage;
    const adultRanked = [...adultIds].sort((a, b) => {
      const ma = this.members.get(a)!, mb = this.members.get(b)!;
      const sa = 0.5 * ma.acceptance + 0.3 * Math.min(1, ma.degree / 8) + 0.2 * (brokerage.get(a) ?? 0);
      const sb = 0.5 * mb.acceptance + 0.3 * Math.min(1, mb.degree / 8) + 0.2 * (brokerage.get(b) ?? 0);
      return (sa - sb) || (a < b ? -1 : 1);
    });
    const pctById = new Map<MemberId, number>();
    const denom = Math.max(1, adultRanked.length - 1);
    for (let i = 0; i < adultRanked.length; i++) {
      pctById.set(adultRanked[i]!, adultRanked.length <= 1 ? 0.5 : i / denom);
    }
    const spatialInputs: SpatialMemberInput[] = [];
    for (const id of this.ids) {
      const mi = this.members.get(id)!;
      const isAdult = !this.minors.has(id) && canBeMatched(mi.m.age);
      const emptyVec: readonly number[] = [];
      spatialInputs.push({
        m: mi.m,
        held: this.holds.has(id),
        tags: mi.tags,
        profileEmb: isAdult ? mi.profileEmb : emptyVec,
        capEmb: isAdult ? mi.capEmb : emptyVec,
        desireEmb: isAdult ? mi.desireEmb : emptyVec,
        capFacetEmbs: isAdult ? mi.caps.map(f => mi.facetEmb.get(f.id)).filter((v): v is number[] => !!v) : undefined,
        desireFacetEmbs: isAdult ? mi.desires.map(f => mi.facetEmb.get(f.id)).filter((v): v is number[] => !!v) : undefined,
        matchFacetEmbs: isAdult ? mi.match.map(f => mi.facetEmb.get(f.id)).filter((v): v is number[] => !!v) : undefined,
        presence: mi.presence,
        allFacets: this.allFacetsByMember.get(id) ?? [],
        lowExposureOrNew: mi.lowExposure || mi.lowData || mi.newcomer,
        romance: mi.romance,
        statusPercentile: pctById.get(id) ?? 0.5,
      });
    }
    this.cachedSpatialIndex = new SpatialIndex(spatialInputs, {
      now: this.now,
      windowDays: this.cfg.windowDays,
      adultMin: Math.max(ADULT_AGE, this.cfg.ageMin),
      dim: this.dim,
      seed: this.cfg.seed,
    });
    return this.cachedSpatialIndex;
  }

  private matchRun: MatchRun | undefined;
  /** The run's generic matching handle, built on first use (profiles, index, searches, edges, circles). */
  get match(): MatchRun { return this.matchRun ??= new MatchRun(this); }

  private postings: ReadonlyMap<string, readonly MemberId[]> | undefined;
  /** Members by lower-case facet tag (MemberIndex.tags), in id order; built once per run on first use. */
  get tagPostings(): ReadonlyMap<string, readonly MemberId[]> {
    if (this.postings) return this.postings;
    const postings = new Map<string, MemberId[]>();
    for (const id of this.ids) for (const tag of this.members.get(id)!.tags) {
      const list = postings.get(tag);
      if (list) list.push(id); else postings.set(tag, [id]);
    }
    return this.postings = postings;
  }

  constructor(readonly input: EngineInput, readonly cfg: EngineConfig, embed: EmbedFn, pack: AppPack = networkPack) {
    this.pack = pack;
    this.now = input.now;
    this.teenIntros = input.teenIntros === true;
    this.minDay = earliestDayKeyOf(input.now);
    this.maxDay = latestDayKeyOf(input.now);
    this.embed = embed;
    const memberIds = new Set(input.members.map(member => member.id));
    this.canonical = memberIdResolver(input, memberIds);
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
      if (f.from !== f.about) {
        const pk = pairKey(f.from, f.about);
        let list = this.feedbackByPair.get(pk);
        if (!list) { list = []; this.feedbackByPair.set(pk, list); }
        list.push(f);
      }
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
    // Canonical and distinct: a record that names one member under two ids counts that member once.
    const distinctIds = (ids: readonly MemberId[]): MemberId[] => [...new Set(ids.map(C))];
    this.interactions = (input.interactions ?? []).map(r => {
      const declineTimes = new Map<MemberId, number>();
      for (const [id, at] of Object.entries(r.declinedAt ?? {})) {
        const memberId = C(id);
        declineTimes.set(memberId, Math.max(declineTimes.get(memberId) ?? -Infinity, at));
      }
      return {
        ...r, participants: distinctIds(r.participants),
        declinedBy: r.declinedBy && distinctIds(r.declinedBy), contributors: r.contributors && distinctIds(r.contributors),
        acceptedBy: r.acceptedBy && distinctIds(r.acceptedBy), noResponse: r.noResponse && distinctIds(r.noResponse),
        noShowBy: r.noShowBy && distinctIds(r.noShowBy),
        ...(r.declinedAt ? { declinedAt: Object.fromEntries(declineTimes) } : {}),
      };
    });
    for (const r of this.interactions) {
      const roster = new Set(r.participants);
      const refused = new Set(r.declinedAt ? (r.declinedBy ?? []).filter(id => Object.hasOwn(r.declinedAt!, id)) : []);
      const expired = new Set(r.noResponse ?? []);
      const ids = refused.size ? [...new Set([...roster, ...refused, ...(r.acceptedBy ?? []), ...expired])] : r.participants;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!, b = ids[j]!;
        const pairRefusals = [a, b].filter(id => refused.has(id));
        const pairEvidence = matchingPairHistory(roster.has(a) && roster.has(b), pairRefusals.length > 0, refused.size > 0 && r.outcome === "declined");
        if (pairEvidence === "HistoryOmittedPair") continue;
        const record: InteractionRecord = pairEvidence === "HistoryRefusedPair"
          ? { ...r, participants: [a, b], outcome: "declined", declinedBy: pairRefusals, at: Math.max(...pairRefusals.map(id => r.declinedAt![id]!)) }
          : r;
        const k = pairKey(a, b);
        if (!this.pairInteractions.has(k)) this.pairInteractions.set(k, []);
        this.pairInteractions.get(k)!.push(record);
        if ((record.outcome === "pending" || record.outcome === "accepted") && now - record.at < cfg.cooldowns.activeProposalDays * DAY * 4) this.activePairs.add(k);
      }
      const cooling = new Set(refused);
      if (r.outcome === "declined") {
        for (const id of r.declinedBy?.length ? r.declinedBy : roster) cooling.add(id);
      } else if (r.outcome === "expired") {
        for (const id of new Set([...roster, ...expired])) {
          if (matchingExpiryCooldown(r.noResponse !== undefined, expired.has(id), roster.has(id))) cooling.add(id);
        }
      }
      for (const id of cooling) {
        if (!this.memberCategoryDeclines.has(id)) this.memberCategoryDeclines.set(id, new Map());
        const times = this.memberCategoryDeclines.get(id)!;
        times.set(r.category, Math.max(times.get(r.category) ?? -Infinity, r.declinedAt?.[id] ?? r.at));
      }
    }
    // Recent proposals (not yet resolved in interactions) are active duplicates for a while.
    const resolved = new Set(this.interactions.filter(r => r.outcome !== "pending").map(r => r.id));
    // v1.2: proposals the Network never sent neither count against budgets nor block the pair.
    const unsent = new Set(cfg.dispatch.billOnlySent ? input.unsentProposalIds ?? [] : []);
    // Roles are keyed by canonical id too; a role under the canonical id wins over one under an alias.
    const recent: RecentProposal[] = (input.recentProposals ?? []).filter(p => !unsent.has(p.id)).map(p => {
      const roles = p.roles;
      const canonicalRoles = new Map<MemberId, Role>();
      for (const [raw, role] of Object.entries(roles ?? {})) {
        const id = C(raw);
        if (id === raw || !canonicalRoles.has(id)) canonicalRoles.set(id, role);
      }
      return {
        ...p, participants: distinctIds(p.participants), alternates: distinctIds(p.alternates ?? []),
        ...(roles ? { roles: Object.fromEntries(canonicalRoles) } : {}),
      };
    });
    for (const p of recent) {
      for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) {
        const k = pairKey(p.participants[i]!, p.participants[j]!);
        this.recentPairs.set(k, Math.max(this.recentPairs.get(k) ?? -Infinity, p.createdAt));
        if (!resolved.has(p.id) && now - p.createdAt < cfg.cooldowns.activeProposalDays * DAY) this.activePairs.add(k);
      }
    }

    // --- events ------------------------------------------------------------------------------
    this.events = [...(input.events ?? [])].filter(e => e.end > now).sort((a, b) => (a.start - b.start) || (a.id < b.id ? -1 : 1));
    const lazyEvents = this.eventEmb as LazyVectorMap;
    for (const e of this.events) lazyEvents.registerLazy(e.id, () => embed(`${e.title} ${e.description ?? ""} ${e.tags.join(" ")}`));

    this.reliability = Object.fromEntries(Object.entries(input.reliability ?? {}).map(([k, v]) => [C(k), v]));
    this.quotas = Object.fromEntries(Object.entries(input.categoryQuotas ?? {}).map(([k, v]) => [C(k), v]));

    // --- members -------------------------------------------------------------------------------
    const facetsBy = this.allFacetsByMember;
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
    const lazyIntents = this.intentEmb as LazyVectorMap;
    for (const it of input.intents) {
      if (!standingIntentLive(it, now)) continue;
      const id = C(it.memberId);
      const relabel = pack.ontology.relabelIntent?.(it, cfg);
      if (relabel) { if (!growthAsHobby.has(id)) growthAsHobby.set(id, []); if (!growthAsHobby.get(id)!.includes(relabel)) growthAsHobby.get(id)!.push(relabel); }
      const intent: Intent = { ...it, memberId: id, ...(relabel ? { category: relabel } : {}) };
      if (!intentsBy.has(id)) intentsBy.set(id, []);
      intentsBy.get(id)!.push(intent);
      this.intentById.set(intent.id, intent);
      const text = intentText(intent);
      if (intent.embedding) this.intentEmb.set(intent.id, intent.embedding);
      else lazyIntents.registerLazy(intent.id, () => embed(text));
    }
    const presenceBy = this.presenceByMember;
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
      const { roles, category } = p;
      for (const id of p.participants) {
        const st = stateById.get(id) ?? "normal";
        const period = cfg.budgets[st].periodDays * DAY;
        if (age < period) proactive.set(id, (proactive.get(id) ?? 0) + 1);
        const role = roles?.[id];
        const isContrib = role ? pack.ontology.contributorRoles.has(role) : (p.kind === "help" && p.participants[0] !== id);
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
      const caps = match.filter(f => CAP_KINDS.has(f.kind));
      const desires = match.filter(f => DESIRE_KINDS.has(f.kind));
      const tags = new Set<string>();
      for (const f of match) for (const t of f.tags) tags.add(t.toLowerCase());
      const tc = new Map<string, number>();
      const desireTagList: string[] = [];
      for (const f of desires) for (const t of f.tags) {
        const lt = t.toLowerCase();
        tc.set(lt, (tc.get(lt) ?? 0) + 1);
        desireTagList.push(lt);
      }
      const cluster = [...tc.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? "none";
      for (const t of tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
      const boundaries = all.filter(f => f.kind === "boundary" || f.kind === "preference");
      const { dealbreakers, romance } = pack.ontology.constraints(boundaries);
      const memberIntents = (intentsBy.get(m.id) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1));
      const exp30 = exposure30.get(m.id) ?? 0;
      const newcomer = now - m.joinedAt < cfg.newcomerDays * DAY;
      const dim = this.dim;
      let cachedFacetEmb: Map<string, number[]> | undefined;
      let cachedProfileEmb: number[] | undefined;
      let cachedCapEmb: number[] | undefined;
      let cachedDesireEmb: number[] | undefined;
      let cachedRevision: string | undefined;
      const ensureFacetEmb = (): Map<string, number[]> => {
        if (!cachedFacetEmb) {
          cachedFacetEmb = new Map<string, number[]>();
          for (const f of match) cachedFacetEmb.set(f.id, f.embedding ?? embed(`${f.value} ${f.tags.join(" ")}`));
        }
        return cachedFacetEmb;
      };
      this.members.set(m.id, {
        m, match, share, privateValues, caps, desires,
        get facetEmb() { return ensureFacetEmb(); },
        get profileEmb() {
          if (!cachedProfileEmb) {
            const fe = ensureFacetEmb();
            cachedProfileEmb = match.length ? centroid(match.map(f => fe.get(f.id)!), dim) : new Array(dim).fill(0);
          }
          return cachedProfileEmb;
        },
        get capEmb() {
          if (!cachedCapEmb) {
            const fe = ensureFacetEmb();
            cachedCapEmb = caps.length ? centroid(caps.map(f => fe.get(f.id)!), dim) : new Array(dim).fill(0);
          }
          return cachedCapEmb;
        },
        get desireEmb() {
          if (!cachedDesireEmb) {
            const fe = ensureFacetEmb();
            cachedDesireEmb = desires.length ? centroid(desires.map(f => fe.get(f.id)!), dim) : new Array(dim).fill(0);
          }
          return cachedDesireEmb;
        },
        intents: memberIntents,
        tags, cluster,
        get revision() {
          return cachedRevision ??= sha256(stableStringify({
            f: all.map(f => [f.id, f.value, f.scope, f.tags, f.confidence]).sort(),
            i: memberIntents.map(i => [i.id, i.objective, i.details ?? "", i.status]).sort(),
            p: m.prefs, s: m.state,
          })).slice(0, 12);
        },
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
        acceptance: acceptanceOf(cfg, response.get(m.id)),
      });
      if (!this.minors.has(m.id) && canBeMatched(m.age)) {
        if (m.state === "paused") this.pausedAdultIds.add(m.id);
        this.adultGraphInputs.push({ id: m.id, age: m.age, city: m.homeCity, desireTags: desireTagList });
      }
    }
    this.ids = [...this.members.keys()].sort();
    // Inviter cluster (fairness cohort, PRD 33.8): follow invitedBy to the root.
    // The stored id may be an alias (ME-006). Stop when the next canonical id was already
    // visited. The old check compared the raw alias, so an alias cycle never matched and
    // the walk did not finish. A canonical cycle keeps the same stop (the member before
    // the repeat). Never follow a chain into a minor.
    for (const id of this.ids) {
      let cur = id;
      const seen = new Set<MemberId>();
      while (true) {
        seen.add(cur);
        const raw = this.members.get(cur)?.m.invitedBy;
        if (!raw) break;
        const next = C(raw);
        // Never follow an invite chain into a minor: their id must not surface as a fairness cohort key.
        if (!this.members.has(next) || this.minors.has(next) || seen.has(next)) break;
        cur = next;
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

  intentTokenSet(intent: Intent): ReadonlySet<string> {
    let cached = this.intentTokens.get(intent.id);
    if (!cached) {
      cached = new Set(tokenize(intentText(intent)));
      if (this.intentById.has(intent.id)) this.intentTokens.set(intent.id, cached);
    }
    return cached;
  }

  /** Fit of a free-text intent to a member: best facet similarity plus a tag bonus. */
  intentFit(intent: Intent, member: MemberIndex, facets: "caps" | "desires" | "match" = "caps"): { sim: number; facet?: Facet } {
    const q = this.intentEmb.get(intent.id) ?? this.embed(intentText(intent));
    const r = this.bestFacet(member, q, facets);
    if (r.facet) {
      const toks = this.intentTokenSet(intent);
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
export function acceptanceOf(cfg: EngineConfig, hist: { yes: number; n: number } | undefined): number {
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
