// PASS 3: deep review. Runs on candidates that survived passes 1-2 (in the engine) or on every
// item (in the evals, for comparison). Compared with passes 1-2 it sees MORE context, uses an
// explicit rubric with more criteria, and has to show more discernment:
//   context  - every matchable/shareable fact with its basis (stated / observed from a connected
//              source / inferred / member-confirmed), source, confidence and age (staleness);
//              connected-source summaries; presence and schedule overlap; edges, mutual contacts
//              and the warm path; recent proposals, declines and feedback; each person's state,
//              capacity (budgets, recent asks) and preferences; agent_private context (boundaries,
//              disclosures) for internal judgment only, with canary tokens redacted.
//   rubric   - mutual benefit, reciprocity / asymmetry risk, intent specificity and timing,
//              logistics, stage and seniority fit, values and energy, novelty vs redundancy,
//              evidence quality, risk and safety, "would each person thank us?".
//   output   - evidence review, steelman FOR and AGAINST, rubric, synthesis, cited facts, THEN the
//              verdict (yes / no / insufficient_information + the one question to ask), THEN the
//              calibrated confidence, and LAST member-facing text (shareable facts only).
// Hard filters always win: this pass can only remove candidates, never add one, and `hardGate`
// re-checks minors, blocks, safety holds and opt-ins after the model (the model cannot override).
import type { ChatMessage, Facet, LLM, MemberId } from "@thenetwork/core";
import { DAY, parseJson } from "@thenetwork/core";
import { privateVocabulary } from "./explain.ts";
import { involvesMinor } from "./filters.ts";
import {
  basisOf, checkMemberFacing, CITATION_RULES, CODE_ENFORCED_V3, HYPOTHESIS_CONFIDENCE, JUDGING_NOTES, JUDGING_NOTES_V3, keyOrderOk, parseCitedFacts, parsePassVerdict, prob, redactPrivate, scrubIds,
  isHypothesis, STALE_DAYS, str, type CitedFact, type EvidenceBasis, type PassVerdict,
} from "./judgeCommon.ts";
import type { Candidate } from "./types.ts";
import { pairKey, type World } from "./world.ts";

/** Current pass-3 prompt (v3, 2026-10-07). The v2 prompt stays available as DEEP_SYSTEM_V2 for paired evals. */
export const DEEP_PROMPT_VERSION = "pass3-deep-v3";
export const DEEP_PROMPT_VERSION_V2 = "pass3-deep-v2";
export { basisOf, STALE_DAYS, type EvidenceBasis } from "./judgeCommon.ts";

/** Optional provenance fields on a facet (connected sources / richness work in core types). */
type FacetX = Facet & {
  source?: string; observedAt?: number; inferred?: boolean; confirmedByMember?: boolean;
};

export interface DeepFact {
  field: string; value: string; visibility: "shareable" | "do_not_quote";
  basis: EvidenceBasis; source?: string; confidence: number; age_days?: number; older_than_180_days?: boolean;
  /** v3 context only: unconfirmed inferred/observed fact with confidence < 0.65 (never a sole anchor). */
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

const r1 = (x: number) => Math.round(x * 10) / 10;
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

/** Context options: v3 marks hypothesis facts; v2 is the context the pass3-deep-v2 prompt was run on. */
export interface DeepContextOptions { version?: "v2" | "v3" }

export function buildDeepContext(w: World, c: Candidate, o: DeepContextOptions = {}): { context: DeepContext; refs: Record<string, MemberId> } {
  const v3 = (o.version ?? "v3") === "v3";
  const ids = [...c.participants, ...(c.via ? [c.via] : [])];
  const refs: Record<string, MemberId> = {};
  const refOf = new Map<MemberId, string>();
  ids.forEach((id, i) => { const r = `P${i + 1}`; refs[r] = id; refOf.set(id, r); });
  const scrub = (s: string) => scrubIds(s, refOf);
  const now = w.now;
  const daysAgo = (t: number) => r1((now - t) / DAY);
  const window = c.window ?? { start: now, end: now + w.cfg.windowDays * DAY };
  const anchorIntent = c.anchor?.type === "intent" ? w.intentById.get(c.anchor.id) : undefined;
  const snap = w.input;

  const people = ids.map((id): DeepPerson => {
    const mi = w.get(id);
    if (!mi) throw new Error(`unknown member ${id}`);
    const m = mi.m;
    const all = snap.facets.filter(f => w.canonical(f.memberId) === id
      && (f.validFrom === undefined || f.validFrom <= now) && (f.validTo === undefined || f.validTo >= now));
    const visible = all.filter(f => f.scope === "shareable" || f.scope === "matchable");
    const facts: DeepFact[] = visible
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
      ref: refOf.get(id)!,
      role: id === c.via ? "connector (introduces the others, does not attend)" : c.roles[id] ?? "peer",
      attending: id !== c.via,
      stated_age: m.age, home_city: m.homeCity, participation_state: m.state,
      joined_days_ago: Math.max(0, Math.round((now - m.joinedAt) / DAY)), newcomer: mi.newcomer,
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
      presence: mi.presence.map(p => ({
        city: p.city, type: p.type, areas: [...p.areas],
        ...(p.from !== undefined ? { from_day: r1((p.from - now) / DAY) } : {}), ...(p.to !== undefined ? { to_day: r1((p.to - now) / DAY) } : {}),
      })),
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

export const RUBRIC_KEYS = [
  "mutual_benefit", "reciprocity", "intent_timing", "logistics", "stage_fit", "values_energy", "novelty", "evidence_quality", "risk_safety",
] as const;
export type RubricKey = typeof RUBRIC_KEYS[number];

export const DEEP_SYSTEM_V2 = `You are the final reviewer (third pass) for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone opted in) dating. Earlier passes found this configuration plausible; your job is discernment: catch the ones that only look good, and do not guess when one question would settle it.
You get much richer context than earlier passes: every visible fact with its basis ("stated" = the member said it; "confirmed" = from a connected source and confirmed by the member; "observed" = taken from a connected source, unconfirmed; "inferred" = derived or guessed, can be wrong; "vouched" = an inviter said it), source, confidence and age in days (older_than_180_days marks facts older than ${STALE_DAYS} days, which may no longer be true); presence and schedule overlap; relationships, mutual contacts and the warm path; recent proposals, declines and feedback; each person's state, capacity and preferences; and private context.
Private context ("private_context_never_quote") may inform your judgment, but you must never mention, hint at or paraphrase it in member_why or question_to_ask. In your internal fields refer to it only generically (e.g. "a private boundary of P2 about venues").
Hard filters (age, blocks, opt-ins, safety holds) are enforced by code; you cannot override them. Most candidates are NOT good: be a skeptical friend who protects members' attention.
${JUDGING_NOTES}

Rubric (integers 1-5, higher is always better):
- mutual_benefit: 1 = nobody clearly gains; 3 = modest gains; 5 = every attending person gets something specific they want.
- reciprocity: 1 = one-sided (one gives, the other takes; someone may feel used); 5 = balanced, or the asymmetry is explicitly welcome (e.g. a stated offer to help or mentor).
- intent_timing: 1 = no live intent behind it, or vague / expiring; 5 = answers a specific, current intent within the window.
- logistics: 1 = cannot realistically meet (city, no overlap, travel beyond limits, quiet hours, trips); 5 = same area, ample overlap.
- stage_fit: career/life stage and seniority fit for THIS purpose; 3 if irrelevant or unknown.
- values_energy: values, energy, preferred formats and vibe signals (including private boundaries); 1 = clash, 5 = clearly compatible.
- novelty: 1 = redundant (already close, or recently proposed / declined together); 5 = a valuable new tie.
- evidence_quality: 1 = thin, stale or inferred-only evidence; 5 = several fresh facts that members stated or confirmed.
- risk_safety: 1 = serious concern (pressure, exploitation, safety, a violated boundary); 5 = no concern.

Write the JSON keys in EXACTLY this order (explanation first, verdict after, member-facing text last):
1. "evidence_review": which facts are strong (stated/confirmed, fresh) and which are thin, stale or inferred-only. ${CITATION_RULES}
2. "steelman_for": the strongest honest case FOR proposing it, citing facts.
3. "steelman_against": the strongest honest case AGAINST, citing facts.
4. "rubric": {"mutual_benefit":n,"reciprocity":n,"intent_timing":n,"logistics":n,"stage_fit":n,"values_energy":n,"novelty":n,"evidence_quality":n,"risk_safety":n}
5. "would_thank_us": for each ATTENDING ref, "yes", "no" or "unsure": would this person thank the Network for this intro afterwards?
6. "reasoning": 2-4 sentences weighing the case for against the case against, and deciding.
7. "cited_facts": at most 8: [{"ref":"P1","field":"facts[2]","fact":"..."}].
8. "verdict": "yes" (propose), "no", or "insufficient_information". Rules: say "yes" only if every attending person would plausibly thank us and nothing scores 1 on mutual_benefit, logistics or risk_safety. Use "insufficient_information" rarely (well under one candidate in ten): ONLY when the case for yes is strong AND one specific missing fact would flip it AND one short question to one member would get it; otherwise decide. Never use it for format or opt-in questions. Thin evidence that does not hinge on one fact means a lower match_probability, usually "no".
9. "question_to_ask": when the verdict is "insufficient_information", {"ref":"P1","question":"..."}: one short, friendly question to that member that would settle it, using no private context and nothing about the other people's do-not-quote facts; otherwise null.
10. "match_probability": your calibrated probability (0-1) that this is a genuinely good, mutually wanted opportunity. Calibrated means: of the configurations you give 0.7, about 7 in 10 should go well. Thin, stale or inferred-only evidence pulls it down.
11. "member_why": LAST. If the verdict is "yes", for each attending ref one or two warm sentences using ONLY facts with visibility "shareable" and the logistics; otherwise "" for each ref. No names, ids, ages, contact details, do-not-quote facts or private context.
Return ONLY the JSON object.`;

/**
 * pass3-deep-v3 (2026-10-07). Changes from v2, all from the luna error analysis (recs 3-5):
 * - shared v3 judging notes: enjoyment and benefit if they meet (not acceptance); a shared stated
 *   intent is sufficient; each person's gain maps to their own live intent (one-sided fits fail);
 *   groups judged as a whole; unknown schedules are normal; hypothesis facts never anchor alone;
 * - private boundaries are penalties (values_energy), not vetoes, unless a hard dealbreaker for this
 *   intro; "a violated boundary" no longer defines risk_safety = 1;
 * - re-read every person's intents before claiming they have none (live intents outrank inferred
 *   or old "goal" facts);
 * - abstention questions about format, logistics or schedules are not allowed.
 */
export const DEEP_SYSTEM = `You are the final reviewer (third pass) for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone opted in) dating. Earlier passes found this configuration plausible; your job is discernment: catch the ones that only look good, and do not guess when one question would settle it.
You get much richer context than earlier passes: every visible fact with its basis ("stated" = the member said it; "confirmed" = from a connected source and confirmed by the member; "observed" = taken from a connected source, unconfirmed; "inferred" = derived or guessed, can be wrong; "vouched" = an inviter said it), source, confidence and age in days (older_than_180_days marks facts older than ${STALE_DAYS} days; hypothesis marks unconfirmed facts with confidence below ${HYPOTHESIS_CONFIDENCE}); each person's live intents with their age; presence and schedule overlap; relationships, mutual contacts and the warm path; recent proposals, declines and feedback; each person's state, capacity and preferences; and private context.
Private context ("private_context_never_quote") may inform your judgment, but you must never mention, hint at or paraphrase it in member_why or question_to_ask. In your internal fields refer to it only generically (e.g. "a private boundary of P2 about venues").
Hard filters (age, blocks, opt-ins, safety holds) are enforced by code; you cannot override them. Be a skeptical friend who protects members' attention, and also one who does not withhold a good intro.
${JUDGING_NOTES_V3}
${CODE_ENFORCED_V3}
- Intents: before you claim that a person has no relevant intent, re-read their "intents" list. A live intent (shown there with its age) outranks an inferred or old "goal" fact; an identical live intent on both sides is the strongest evidence there is.

Rubric (integers 1-5, higher is always better):
- mutual_benefit: 1 = nobody clearly gains; 3 = modest gains; 5 = every attending person gets something specific that one of their own intents asks for.
- reciprocity: 1 = one-sided (one person's intent is served, the other's is not; someone may feel used); 5 = balanced, or the asymmetry is explicitly welcome (e.g. a stated offer to help or mentor).
- intent_timing: 1 = no live intent behind it, or vague / expiring; 5 = answers a specific, current intent within the window.
- logistics: 1 = cannot meet at all in the window (wrong city for the whole window, no overlap); 3 = unknown schedules (normal); 5 = same area, ample overlap.
- stage_fit: career/life stage and seniority fit for THIS purpose; 3 if irrelevant or unknown.
- values_energy: values, energy, preferred formats and vibe signals; a private format or topic boundary that this intro touches lowers this score (it is a penalty, not a veto); 1 = clear clash, 5 = clearly compatible.
- novelty: 1 = redundant (already close, or recently proposed / declined together); 5 = a valuable new tie.
- evidence_quality: 1 = thin, stale or hypothesis-only evidence; 5 = several fresh facts that members stated or confirmed.
- risk_safety: 1 = serious concern (pressure, exploitation, safety, or a hard dealbreaker boundary for this exact intro); 5 = no concern. A soft preference is not a safety concern.

Write the JSON keys in EXACTLY this order (explanation first, verdict after, member-facing text last):
1. "evidence_review": which facts are strong (stated/confirmed, fresh) and which are thin, stale or hypotheses; list each attending person's live intents. ${CITATION_RULES}
2. "steelman_for": the strongest honest case FOR proposing it, naming for each person which of their own intents (or offers) it serves.
3. "steelman_against": the strongest honest case AGAINST, citing facts.
4. "rubric": {"mutual_benefit":n,"reciprocity":n,"intent_timing":n,"logistics":n,"stage_fit":n,"values_energy":n,"novelty":n,"evidence_quality":n,"risk_safety":n}
5. "would_thank_us": for each ATTENDING ref, "yes", "no" or "unsure": would this person be glad, afterwards, that they met?
6. "reasoning": 2-4 sentences weighing the case for against the case against, and deciding.
7. "cited_facts": at most 8: [{"ref":"P1","field":"facts[2]","fact":"..."}].
8. "verdict": "yes" (propose), "no", or "insufficient_information". Rules: say "yes" when every attending person would plausibly be glad they met and nothing scores 1 on mutual_benefit, logistics or risk_safety. Use "insufficient_information" rarely (well under one candidate in ten): ONLY when the case for yes is strong AND one specific missing fact about what a person wants would flip it AND one short question to one member would get it; otherwise decide. Never use it for format, schedule, logistics or opt-in questions. Thin evidence that does not hinge on one fact means a lower match_probability.
9. "question_to_ask": when the verdict is "insufficient_information", {"ref":"P1","question":"..."}: one short, friendly question to that member that would settle it, using no private context and nothing about the other people's do-not-quote facts; otherwise null.
10. "match_probability": your calibrated probability (0-1) that every attending person would enjoy and benefit from this meeting. Calibrated means: of the configurations you give 0.7, about 7 in 10 should go well. Use the full range.
11. "member_why": LAST. If the verdict is "yes", for each attending ref one or two warm sentences using ONLY facts with visibility "shareable" and the logistics; otherwise "" for each ref. No names, ids, ages, contact details, do-not-quote facts or private context.
Return ONLY the JSON object.`;

export const DEEP_PROMPTS = { v2: { version: DEEP_PROMPT_VERSION_V2, system: DEEP_SYSTEM_V2 }, v3: { version: DEEP_PROMPT_VERSION, system: DEEP_SYSTEM } } as const;

export function buildDeepMessages(w: World, c: Candidate, o: DeepContextOptions = {}): { messages: ChatMessage[]; refs: Record<string, MemberId>; context: DeepContext } {
  const version = o.version ?? "v3";
  const { context, refs } = buildDeepContext(w, c, { version });
  return { refs, context, messages: [{ role: "system", content: DEEP_PROMPTS[version].system }, { role: "user", content: JSON.stringify(context) }] };
}

export interface DeepVerdict {
  pass: 3;
  evidenceReview: string; steelmanFor: string; steelmanAgainst: string;
  rubric: Record<RubricKey, number>;
  wouldThankUs: Record<string, "yes" | "no" | "unsure">;
  reasoning: string; citedFacts: CitedFact[];
  verdict: PassVerdict;
  question?: { ref: string; question: string };
  matchProbability: number;
  /** Raw member-facing text by ref. Use `gateMemberFacing` before showing any of it. */
  memberWhy: Record<string, string>;
  reasoningFirst: boolean;
}

/** Validate a raw pass-3 reply. Throws on schema errors (counted as parse failures). */
export function parseDeepVerdict(raw: unknown, attendingRefs: string[]): DeepVerdict {
  const o = raw as Record<string, any>;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("not an object");
  const errs: string[] = [];
  const steelmanFor = str(o.steelman_for), steelmanAgainst = str(o.steelman_against), reasoning = str(o.reasoning);
  if (!steelmanFor) errs.push("steelman_for");
  if (!steelmanAgainst) errs.push("steelman_against");
  if (!reasoning) errs.push("reasoning");
  const verdict = parsePassVerdict(o.verdict, true);
  if (!verdict) errs.push("verdict");
  const mp = prob(o.match_probability);
  if (mp === undefined) errs.push("match_probability");
  const rubric = {} as Record<RubricKey, number>;
  for (const k of RUBRIC_KEYS) {
    const v = Number(o.rubric?.[k]);
    if (!Number.isFinite(v) || v < 1 || v > 5) errs.push(`rubric.${k}`); else rubric[k] = Math.round(v);
  }
  if (errs.length) throw new Error(`schema: ${errs.join(", ")}`);
  const thank: Record<string, "yes" | "no" | "unsure"> = {};
  for (const r of attendingRefs) {
    const t = String(o.would_thank_us?.[r] ?? "unsure").toLowerCase();
    thank[r] = t === "yes" || t === "no" ? t : "unsure";
  }
  const q = o.question_to_ask && typeof o.question_to_ask === "object" ? { ref: str(o.question_to_ask.ref, 12), question: str(o.question_to_ask.question, 400) } : undefined;
  const why: Record<string, string> = {};
  for (const r of attendingRefs) why[r] = typeof o.member_why === "object" && o.member_why ? str(o.member_why[r], 600) : "";
  return {
    pass: 3, evidenceReview: str(o.evidence_review), steelmanFor, steelmanAgainst, rubric, wouldThankUs: thank,
    reasoning, citedFacts: parseCitedFacts(o.cited_facts), verdict: verdict!,
    ...(q && q.question ? { question: q } : {}), matchProbability: mp!, memberWhy: why,
    reasoningFirst: keyOrderOk(o, ["steelman_for", "steelman_against", "reasoning"], "verdict"),
  };
}

/** Pass-3 decision: "yes" only. "insufficient_information" is an abstention (never a proposal). */
export const deepDecision = (v: DeepVerdict) => v.verdict === "yes";

/**
 * Hard gate applied AFTER any model verdict (the model can never override it): minors in any role,
 * blocks (incl. with the connector), safety holds, category and romance opt-ins of attending people.
 * Returns the first failing reason or null.
 */
export function hardGate(w: World, c: Pick<Candidate, "participants" | "via" | "category"> & { alternates?: MemberId[] }): string | null {
  if (involvesMinor(w, { participants: c.participants, alternates: c.alternates ?? [], via: c.via })) return "underage";
  const everyone = [...c.participants, ...(c.via ? [c.via] : [])];
  for (const id of everyone) if (!w.get(id)) return "unknown_member";
  for (const id of everyone) if (w.holds.has(id)) return "safety_hold";
  for (let i = 0; i < everyone.length; i++) for (let j = i + 1; j < everyone.length; j++) if (w.blocked.has(pairKey(everyone[i]!, everyone[j]!))) return "blocked";
  for (const id of c.participants) {
    const m = w.get(id)!.m;
    if (c.category === "romance" && !m.prefs.romanceOptIn) return "romance_opt_out";
    if (!m.prefs.categoriesOptIn.includes(c.category)) return "category_opt_out";
  }
  return null;
}

/**
 * Member-facing text from a deep verdict, keyed by member id, keeping only text that passes the
 * deterministic leak gate (canaries, words found only in non-shareable or private facets, contact
 * details). Rejected text is dropped (callers fall back to template explanations).
 */
export function gateMemberFacing(w: World, c: Candidate, v: DeepVerdict, refs: Record<string, MemberId>): { why: Record<MemberId, string>; rejected: { ref: string; reasons: string[] }[] } {
  const vocab = privateVocabulary(w, [...c.participants, ...(c.via ? [c.via] : [])]);
  const why: Record<MemberId, string> = {};
  const rejected: { ref: string; reasons: string[] }[] = [];
  if (v.verdict !== "yes") return { why, rejected };
  for (const [ref, text] of Object.entries(v.memberWhy)) {
    if (!text) continue;
    const chk = checkMemberFacing(text, vocab);
    if (chk.ok && refs[ref]) why[refs[ref]!] = text; else rejected.push({ ref, reasons: chk.reasons });
  }
  return { why, rejected };
}

export async function deepReviewOne(w: World, c: Candidate, llm: LLM, maxTokens: number): Promise<{ verdict: DeepVerdict; refs: Record<string, MemberId> }> {
  const { messages, refs } = buildDeepMessages(w, c);
  const attending = Object.entries(refs).filter(([, id]) => c.participants.includes(id)).map(([r]) => r);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await llm.chat(messages, { maxTokens, json: true });
      return { verdict: parseDeepVerdict(parseJson(out), attending), refs };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

