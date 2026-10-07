// The ONE context builder for the three LLM judgment passes. Every pass sees the same pseudonymous
// people (refs P1, P2, ... in participant order, then the connector), built from the same helpers,
// at one of four visibility levels:
//
//   "public"    pass 1 (screen): shareable + matchable facets as text lines, active intents,
//               presence, stated preferences, explicit edges. Built from the snapshot alone, so the
//               evals' single-pass baseline (rec-eval-v1) uses exactly the same view.
//   "compact"   pass 2 judge-v2.1 (cfg.judge.pass2Context = "compact"): scrubbed shareable /
//               do-not-quote lines and the anchor request. No logistics.
//   "matchable" pass 2 judge-v3 (the engine default): pass 3's context with every fact's basis,
//               source, confidence and age, minus private context and history, plus a redacted
//               private-boundary flag. Refs = attending people only.
//   "private"   pass 3 (deep review): the full context, including agent_private facts (canary-like
//               tokens redacted) for internal judgment only.
//
// None of them ever contains hidden truth, names, member ids or labels. JSON key order is part of
// the prompt bytes (and therefore of the evals cache key): do not reorder fields.
import type { Category, City, Facet, MemberId, OpportunityKind, Presence, WorldSnapshot } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { basisOf, boundaryRelevance, evidenceTag, isHypothesis, redactPrivate, scrubIds, STALE_DAYS, type EvidenceBasis } from "./judgeCommon.ts";
import type { Candidate } from "./types.ts";
import { pairKey, type World } from "./world.ts";

export type Visibility = "public" | "compact" | "matchable" | "private";

// ---- shared pieces ------------------------------------------------------------------------------

const r1 = (x: number) => Math.round(x * 10) / 10;
const CONNECTOR_ROLE = "connector (introduces the others, does not attend)";

/** Pseudonymous refs: participants in order, then the connector. */
function refsFor(ids: MemberId[]): { refs: Record<string, MemberId>; refOf: Map<MemberId, string>; scrub: (s: string) => string } {
  const refs: Record<string, MemberId> = {};
  const refOf = new Map<MemberId, string>();
  ids.forEach((id, i) => { const r = `P${i + 1}`; refs[r] = id; refOf.set(id, r); });
  return { refs, refOf, scrub: (s: string) => scrubIds(s, refOf) };
}

const validAt = (f: Facet, now: number) => (f.validFrom === undefined || f.validFrom <= now) && (f.validTo === undefined || f.validTo >= now);
const presenceOf = (p: Presence, now: number) => ({
  city: p.city, type: p.type, areas: [...p.areas],
  ...(p.from !== undefined ? { from_day: r1((p.from - now) / DAY) } : {}), ...(p.to !== undefined ? { to_day: r1((p.to - now) / DAY) } : {}),
});
const joinedDaysAgo = (joinedAt: number, now: number) => Math.max(0, Math.round((now - joinedAt) / DAY));
const roleOf = (id: MemberId, c: { via?: MemberId; roles: Record<MemberId, string> }) => (id === c.via ? CONNECTOR_ROLE : c.roles[id] ?? "peer");
const everyone = (c: { participants: MemberId[]; via?: MemberId }) => [...c.participants, ...(c.via ? [c.via] : [])];

// ---- "public" (pass 1) ---------------------------------------------------------------------------

/** The configuration being screened (no labels, no hidden truth). Structurally equal to evals ConfigSpec. */
export interface ScreenConfig {
  participants: MemberId[];
  roles: Record<MemberId, string>;
  via?: MemberId;
  kind: OpportunityKind;
  category: Category;
  objective: string;
  city: City;
  window: { start: number; end: number };
}

export interface PublicPerson {
  ref: string;
  role: string;
  attending: boolean;
  age: number;
  home_city: string;
  participation_state: string;
  joined_days_ago: number;
  preferences: { formats: string[]; categories_opted_in: string[]; romance_opt_in: boolean; max_travel_minutes: number; only_when_asked: boolean };
  shareable: string[];
  matchable_do_not_quote: string[];
  intents: { objective: string; category: string; created_days_ago?: number }[];
  presence: { city: string; type: string; areas: string[]; from_day?: number; to_day?: number }[];
  /** v3 view only: which aspects of THIS configuration a private boundary touches. Never the boundary itself. */
  private_boundary_relevant_to?: string[];
}

export interface PublicView {
  configuration: {
    kind: string; category: string; objective: string; city: string;
    window_days: { from: number; to: number };
  };
  people: PublicPerson[];
  relationships: { a: string; b: string; type: string }[];
  /** ref -> member id; kept OUT of the prompt, used only to map predictions back. */
  refs: Record<string, MemberId>;
}

/** Scopes pass 1 may read. agent_private / opportunity_specific are never exposed. */
const PUBLIC_SCOPES: ReadonlySet<Facet["scope"]> = new Set(["shareable", "matchable"]);

/**
 * "v2" (default) is the view pass1-screen-v2 (the engine's pass 1) and rec-eval-v1 use. "v3" is the
 * view the historical pass1-screen-v3 prompt was run on (evals replay only, packages/evals/src/
 * historicalPrompts.ts): per-fact evidence notes, intent age, expired intents dropped, and a redacted
 * private-boundary flag.
 */
export interface PublicViewOptions { version?: "v2" | "v3" }

export function buildPublicView(snap: WorldSnapshot, cfg: ScreenConfig, o: PublicViewOptions = {}): PublicView {
  const v3 = (o.version ?? "v2") === "v3";
  const now = snap.now;
  const { refs, refOf, scrub } = refsFor(everyone(cfg));
  const line = (f: Facet) => scrub(`${f.kind}: ${f.value}`) + (v3 ? ` ${evidenceTag(f, now)}` : "");

  const people = everyone(cfg).map((id): PublicPerson => {
    const m = snap.members.find(x => x.id === id);
    if (!m) throw new Error(`unknown member ${id}`);
    const facets = snap.facets.filter(f => f.memberId === id && PUBLIC_SCOPES.has(f.scope) && validAt(f, now));
    return {
      ref: refOf.get(id)!, role: roleOf(id, cfg), attending: id !== cfg.via, age: m.age, home_city: m.homeCity,
      participation_state: m.state, joined_days_ago: joinedDaysAgo(m.joinedAt, now),
      preferences: {
        formats: [...m.prefs.formats], categories_opted_in: [...m.prefs.categoriesOptIn],
        romance_opt_in: m.prefs.romanceOptIn, max_travel_minutes: m.prefs.maxTravelMinutes,
        only_when_asked: m.prefs.onlyWhenAsked,
      },
      shareable: facets.filter(f => f.scope === "shareable").map(line),
      matchable_do_not_quote: facets.filter(f => f.scope === "matchable").map(line),
      intents: snap.intents.filter(i => i.memberId === id && i.status === "active" && (!v3 || i.createdAt + i.horizonDays * DAY >= now))
        .map(i => ({ objective: scrub(i.objective), category: i.category, ...(v3 ? { created_days_ago: joinedDaysAgo(i.createdAt, now) } : {}) })),
      presence: snap.presence.filter(p => p.memberId === id).map(p => presenceOf(p, now)),
      ...(v3 && id !== cfg.via ? (() => {
        // agent_private boundary facets are read here, but only the aspect of this configuration
        // they touch leaves this function, never their text.
        const directTie = snap.edges.some(e => e.type !== "blocked" && e.type !== "avoid"
          && ((e.from === id && cfg.participants.includes(e.to)) || (e.to === id && cfg.participants.includes(e.from))));
        const rel = boundaryRelevance(snap.facets.filter(f => f.memberId === id && f.kind === "boundary").map(f => f.value),
          { category: cfg.category, attendingCount: cfg.participants.length, directTie });
        return rel.length ? { private_boundary_relevant_to: rel } : {};
      })() : {}),
    };
  });
  const relationships: PublicView["relationships"] = [];
  const seen = new Set<string>();
  for (const e of snap.edges) {
    const a = refOf.get(e.from), b = refOf.get(e.to);
    if (!a || !b || a === b) continue;
    const k = `${a}|${b}|${e.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    relationships.push({ a, b, type: e.type === "blocked" ? `${a} blocked ${b}` : e.type });
  }
  return {
    configuration: {
      kind: cfg.kind, category: cfg.category, objective: scrub(cfg.objective), city: cfg.city,
      window_days: { from: r1((cfg.window.start - now) / DAY), to: r1((cfg.window.end - now) / DAY) },
    },
    people, relationships, refs,
  };
}

/** Engine side: the screen config for a candidate that already passed the hard filters. */
export function screenConfigOf(w: World, c: Candidate): ScreenConfig {
  return {
    participants: [...c.participants], roles: { ...c.roles }, via: c.via, kind: c.kind, category: c.category,
    objective: c.objective, city: c.city ?? w.get(c.participants[0]!)?.m.homeCity ?? "sf",
    window: c.window ?? { start: w.now, end: w.now + w.cfg.windowDays * DAY },
  };
}

// ---- "compact" (pass 2 judge-v2.1) ---------------------------------------------------------------

function countWarm(w: World, ids: MemberId[]) {
  let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (w.isWarm(ids[i]!, ids[j]!)) n++;
  return n;
}

function buildCompactContext(w: World, c: Candidate) {
  const { refs } = refsFor(c.participants);
  const anchor = c.anchor?.type === "intent" ? w.intentById.get(c.anchor.id) : undefined;
  const participants = c.participants.map((id, i) => {
    const mi = w.get(id)!;
    return {
      ref: `P${i + 1}`, role: c.roles[id] ?? "peer", state: mi.m.state, preferred_formats: mi.m.prefs.formats,
      shareable: mi.share.filter(f => f.kind !== "boundary").map(f => `${f.kind}: ${f.value}`).slice(0, 8),
      context_do_not_quote: mi.match.filter(f => f.scope === "matchable").map(f => `${f.kind}: ${f.value}`).slice(0, 6),
      own_request: anchor?.memberId === id ? `${anchor.objective}` : undefined,
    };
  });
  return {
    refs,
    context: {
      configuration: {
        kind: c.kind, category: c.category, format: c.format, objective: c.objective,
        window_hours: c.window ? Math.round((c.window.end - c.window.start) / 3_600_000) : undefined,
        safety_class: c.safetyClass, existing_warm_ties: c.participants.length > 1 ? countWarm(w, c.participants) : 0,
      },
      participants,
    },
  };
}

// ---- "private" (pass 3) and "matchable" (pass 2 judge-v3) ---------------------------------------

/** Optional provenance fields on a facet (connected sources / richness work in core types). */
type FacetX = Facet & { source?: string; observedAt?: number; inferred?: boolean; confirmedByMember?: boolean };

export interface DeepFact {
  field: string; value: string; visibility: "shareable" | "do_not_quote";
  basis: EvidenceBasis; source?: string; confidence: number; age_days?: number; older_than_180_days?: boolean;
  /** "v3" context only: unconfirmed inferred/observed fact with confidence < 0.65 (never a sole anchor). */
  hypothesis?: boolean;
}

export interface DeepPerson {
  ref: string; role: string; attending: boolean; stated_age: number; home_city: string;
  participation_state: string; joined_days_ago: number; newcomer: boolean;
  asks_and_budget: {
    proactive_asks_in_budget_period: number; proactive_budget: number; contributions_recent: number; contribution_limit: number;
    unanswered_proactive: number; proposals_last_30d: number; only_when_asked: boolean;
  };
  preferences: { formats: string[]; categories_opted_in: string[]; romance_opt_in: boolean; max_travel_minutes: number; quiet_hours: [number, number] };
  facts: DeepFact[];
  connected_sources?: unknown;
  intents: { objective: string; category: string; details?: string; desired_people?: string; created_days_ago: number; expires_in_days: number; anchors_this?: boolean }[];
  presence: { city: string; type: string; areas: string[]; from_day?: number; to_day?: number }[];
  network: { warm_ties: number };
  history: { category_declines: { category: string; days_ago: number }[] };
  private_context_never_quote: { field: string; value: string }[];
}

export interface DeepContext {
  configuration: {
    kind: string; category: string; format: string; objective: string; city: string;
    window_days: { from: number; to: number }; hard_filters: string;
  };
  people: DeepPerson[];
  pairs: {
    a: string; b: string; edges: string[]; mutual_contacts: number; warm_path: string;
    proposed_together_days_ago?: number;
    past_interactions: { kind: string; category: string; outcome: string; days_ago: number; declined_by: string[] }[];
    feedback: { from: string; about: string; sentiment: string; would_meet_again?: boolean; days_ago: number }[];
  }[];
  logistics: { overlap_hours_in_window: number; overlap_city?: string; shared_areas: string[]; tightest_travel_limit_minutes: number; anyone_traveling: boolean };
  /** Shape of the evidence overall (counts by basis, old-fact count) so thin profiles are obvious. */
  evidence_summary: Record<string, { facts: number; stated: number; confirmed: number; observed: number; inferred: number; vouched: number; older_than_180_days: number }>;
}

const MAX_FACTS = 24;

/** Safe summary of an optional connectedSources structure: platform-level fields only, no handles/urls/emails. */
export function summarizeConnectedSources(x: unknown, now: number): unknown {
  if (x == null) return undefined;
  const SAFE = new Set(["source", "kind", "type", "platform", "provider", "status", "connected", "confirmed", "confirmedByMember",
    "facets", "facetCount", "facet_count", "observations", "observationCount", "lastSyncedAt", "observedAt", "connectedAt", "since", "scopes", "richness"]);
  const clean = (v: unknown, k: string): unknown => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return /At$|^since$/.test(k) && v > 1e11 ? `${Math.round((now - v) / DAY)} days ago` : v;
    if (typeof v === "string") return v.length <= 40 && !/[@/]|https?:|www\./i.test(v) ? v : undefined;
    if (Array.isArray(v)) { const a = v.map(e => clean(e, k)).filter(e => e !== undefined); return a.length ? a.slice(0, 10) : undefined; }
    return undefined;
  };
  const obj = (o: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) if (SAFE.has(k)) { const c = clean(v, k); if (c !== undefined) out[k] = c; }
    return out;
  };
  if (Array.isArray(x)) return x.filter(e => e && typeof e === "object").slice(0, 12).map(e => obj(e as Record<string, unknown>));
  if (typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>).slice(0, 12)) {
      if (!/^[a-z_ -]{2,30}$/i.test(k)) continue;
      if (v && typeof v === "object" && !Array.isArray(v)) out[k] = obj(v as Record<string, unknown>);
      else { const c = clean(v, k); if (c !== undefined) out[k] = c; }
    }
    return out;
  }
  return undefined;
}

/** "v2" = the context pass3-deep-v2 (the engine's pass 3) runs on; "v3" adds hypothesis marks (pass 2 judge-v3). */
export interface DeepContextOptions { version?: "v2" | "v3" }

export function buildDeepContext(w: World, c: Candidate, o: DeepContextOptions = {}): { context: DeepContext; refs: Record<string, MemberId> } {
  const v3 = (o.version ?? "v2") === "v3";
  const ids = everyone(c);
  const { refs, refOf, scrub } = refsFor(ids);
  const now = w.now;
  const daysAgo = (t: number) => r1((now - t) / DAY);
  const window = c.window ?? { start: now, end: now + w.cfg.windowDays * DAY };
  const anchorIntent = c.anchor?.type === "intent" ? w.intentById.get(c.anchor.id) : undefined;
  const snap = w.input;

  const people = ids.map((id): DeepPerson => {
    const mi = w.get(id);
    if (!mi) throw new Error(`unknown member ${id}`);
    const m = mi.m;
    const all = snap.facets.filter(f => w.canonical(f.memberId) === id && validAt(f, now));
    const facts: DeepFact[] = all.filter(f => f.scope === "shareable" || f.scope === "matchable")
      .map(f => {
        const x = f as FacetX;
        const at = typeof x.observedAt === "number" ? x.observedAt : f.validFrom;
        const age = at !== undefined ? Math.max(0, Math.round((now - at) / DAY)) : undefined;
        return {
          field: f.kind, value: scrub(f.value), visibility: f.scope === "shareable" ? "shareable" as const : "do_not_quote" as const,
          basis: basisOf(f), ...(typeof x.source === "string" ? { source: x.source } : {}),
          confidence: Math.round(f.confidence * 100) / 100,
          ...(age !== undefined ? { age_days: age } : {}), ...(age !== undefined && age > STALE_DAYS ? { older_than_180_days: true } : {}),
          ...(v3 && isHypothesis(f) ? { hypothesis: true } : {}),
        };
      })
      // Most useful first: shareable, then confident and fresh.
      .sort((a, b) => (a.visibility === b.visibility ? 0 : a.visibility === "shareable" ? -1 : 1) || (b.confidence - a.confidence) || ((a.age_days ?? 0) - (b.age_days ?? 0)))
      .slice(0, MAX_FACTS);
    const budget = w.cfg.budgets[m.state];
    const declines = [...(w.memberCategoryDeclines.get(id)?.entries() ?? [])].map(([category, at]) => ({ category, days_ago: daysAgo(at) }));
    const sources = (m as Record<string, any>).connectedSources ?? (snap as Record<string, any>).connectedSources?.[id];
    return {
      ref: refOf.get(id)!, role: roleOf(id, c), attending: id !== c.via,
      stated_age: m.age, home_city: m.homeCity, participation_state: m.state,
      joined_days_ago: joinedDaysAgo(m.joinedAt, now), newcomer: mi.newcomer,
      asks_and_budget: {
        proactive_asks_in_budget_period: mi.recentProactive, proactive_budget: budget.limit,
        contributions_recent: mi.recentContribution, contribution_limit: w.cfg.contribution.limit,
        unanswered_proactive: m.unansweredProactive, proposals_last_30d: mi.recentExposure30, only_when_asked: m.prefs.onlyWhenAsked,
      },
      preferences: {
        formats: [...m.prefs.formats], categories_opted_in: [...m.prefs.categoriesOptIn], romance_opt_in: m.prefs.romanceOptIn,
        max_travel_minutes: m.prefs.maxTravelMinutes, quiet_hours: [...m.prefs.quietHours] as [number, number],
      },
      facts,
      ...(sources !== undefined ? { connected_sources: summarizeConnectedSources(sources, now) } : {}),
      intents: mi.intents.map(it => ({
        objective: scrub(it.objective), category: it.category,
        ...(it.details ? { details: scrub(it.details) } : {}), ...(it.desiredPeople ? { desired_people: scrub(it.desiredPeople) } : {}),
        created_days_ago: daysAgo(it.createdAt), expires_in_days: r1((it.createdAt + it.horizonDays * DAY - now) / DAY),
        ...(anchorIntent?.id === it.id ? { anchors_this: true } : {}),
      })),
      presence: mi.presence.map(p => presenceOf(p, now)),
      network: { warm_ties: mi.degree },
      history: { category_declines: declines },
      // Internal judgment only. Canary-like tokens are redacted so they can never be echoed.
      private_context_never_quote: all.filter(f => f.scope === "agent_private").map(f => ({ field: f.kind, value: redactPrivate(scrub(f.value)) })),
    };
  });

  const pairs: DeepContext["pairs"] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i]!, b = ids[j]!;
    const k = pairKey(a, b);
    const edges = [...(w.edgeTypes.get(k) ?? [])].sort().map(t => {
      if (t !== "blocked" && t !== "avoid") return t;
      const e = snap.edges.find(x => x.type === t && pairKey(w.canonical(x.from), w.canonical(x.to)) === k);
      return e ? `${refOf.get(w.canonical(e.from))} ${t} ${refOf.get(w.canonical(e.to))}` : t;
    });
    const pa = w.positive.get(a), pb = w.positive.get(b);
    let mutual = 0;
    if (pa && pb) for (const x of pa.keys()) if (x !== a && x !== b && pb.has(x)) mutual++;
    const warm = w.isWarm(a, b) ? "direct tie" : (c.via && (a === c.via || b === c.via)) ? "connector link"
      : c.via ? "introduced through the connector" : mutual > 0 ? `two-hop (${mutual} mutual contact${mutual > 1 ? "s" : ""})` : "none (cold intro)";
    const rp = w.recentPairs.get(k);
    pairs.push({
      a: refOf.get(a)!, b: refOf.get(b)!, edges, mutual_contacts: mutual, warm_path: warm,
      ...(rp !== undefined ? { proposed_together_days_ago: daysAgo(rp) } : {}),
      past_interactions: (w.pairInteractions.get(k) ?? []).slice(-6).map(r => ({
        kind: r.kind, category: r.category, outcome: r.outcome, days_ago: daysAgo(r.at),
        declined_by: (r.declinedBy ?? []).map(x => refOf.get(x) ?? "someone else"),
      })),
      feedback: w.feedback.filter(f => pairKey(f.from, f.about) === k).slice(-6).map(f => ({
        from: refOf.get(f.from)!, about: refOf.get(f.about)!, sentiment: f.sentiment,
        ...(f.wouldMeetAgain !== undefined ? { would_meet_again: f.wouldMeetAgain } : {}), days_ago: daysAgo(f.at),
      })),
    });
  }

  const attending = c.participants;
  const ov = w.overlap(attending, Math.max(window.start, now), window.end, c.city);
  const areaSets = attending.map(id => new Set((w.get(id)?.presence ?? []).filter(p => !c.city || p.city === c.city).flatMap(p => p.areas)));
  const shared = areaSets.length ? [...areaSets[0]!].filter(a => areaSets.every(s => s.has(a))) : [];
  const evidence_summary: DeepContext["evidence_summary"] = {};
  for (const p of people) {
    const s = { facts: p.facts.length, stated: 0, confirmed: 0, observed: 0, inferred: 0, vouched: 0, older_than_180_days: 0 };
    for (const f of p.facts) { s[f.basis]++; if (f.older_than_180_days) s.older_than_180_days++; }
    evidence_summary[p.ref] = s;
  }
  return {
    refs,
    context: {
      configuration: {
        kind: c.kind, category: c.category, format: c.format, objective: scrub(c.objective), city: c.city ?? "unknown",
        window_days: { from: r1((window.start - now) / DAY), to: r1((window.end - now) / DAY) },
        hard_filters: "Enforced by code before and after you (age 18+ for everyone in any role, blocks, safety holds, category and romance opt-ins, budgets). You cannot override them.",
      },
      people, pairs,
      logistics: {
        overlap_hours_in_window: ov ? Math.round(ov.hours) : 0, ...(ov ? { overlap_city: ov.city } : {}),
        shared_areas: shared, tightest_travel_limit_minutes: Math.min(...attending.map(id => w.get(id)?.m.prefs.maxTravelMinutes ?? 30)),
        anyone_traveling: attending.some(id => (w.get(id)?.presence ?? []).some(p => p.type === "temporary" && (p.to ?? Infinity) > now)),
      },
      evidence_summary,
    },
  };
}

/** "matchable": the v3 deep context minus private context and history, plus the redacted boundary flag. Refs = attending only. */
function buildMatchableContext(w: World, c: Candidate) {
  const { context, refs: all } = buildDeepContext(w, c, { version: "v3" });
  const people = context.people.map(p => {
    const { private_context_never_quote, history: _h, ...rest } = p;
    const id = all[p.ref]!;
    const directTie = c.participants.some(o => o !== id && w.isWarm(o, id));
    const rel = p.attending ? boundaryRelevance(private_context_never_quote.filter(f => f.field === "boundary").map(f => f.value),
      { category: c.category, attendingCount: c.participants.length, directTie }) : [];
    return { ...rest, ...(rel.length ? { private_boundary_relevant_to: rel } : {}) };
  });
  const refs: Record<string, MemberId> = {};
  for (const [r, id] of Object.entries(all)) if (c.participants.includes(id)) refs[r] = id;
  return { refs, context: { ...context, people } };
}

// ---- the entry point -----------------------------------------------------------------------------

/**
 * The prompt input (the user message, as an object) for one candidate at one visibility level,
 * plus the ref -> member id map (never part of the prompt).
 */
export function buildPassContext(w: World, c: Candidate, visibility: Visibility): { context: object; refs: Record<string, MemberId> } {
  switch (visibility) {
    case "public": { const { refs, ...context } = buildPublicView(w.input, screenConfigOf(w, c)); return { context, refs }; }
    case "compact": return buildCompactContext(w, c);
    case "matchable": return buildMatchableContext(w, c);
    case "private": return buildDeepContext(w, c);
  }
}
