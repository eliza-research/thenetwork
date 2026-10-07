// PASS 1: the screen (PRD 33.6: "a cheap model pre-screens"). One call per candidate on a compact,
// pseudonymous public view. The model writes a fact-citing explanation FIRST, then the
// dealbreaker check, the verdict, the confidence (match_probability), and only last a short
// member-facing "why" that may use shareable items only.
//
// The public view (moved here from packages/evals/src/publicView.ts so the engine and the evals
// build exactly the same prompt input) contains:
//   shareable facets, matchable facets (marked do-not-quote), active intents, presence,
//   stated age, participation state, stated preferences, explicit edges among the people.
// It never contains agent_private / opportunity_specific facets, hidden truth, names, member ids.
import type { Category, ChatMessage, City, Facet, LLM, MemberId, OpportunityKind, WorldSnapshot } from "@thenetwork/core";
import { DAY, parseJson } from "@thenetwork/core";
import {
  boundaryRelevance, CITATION_RULES, evidenceTag, JUDGING_NOTES_V3, keyOrderOk, parseCitedFacts, parsePassVerdict, prob, scrubIds, str,
  type CitedFact, type PassVerdict,
} from "./judgeCommon.ts";
import type { Candidate } from "./types.ts";
import type { World } from "./world.ts";

/**
 * Pass-1 prompt versions. v3 (2026-10-07) won on the dev split but not on the held-out test split
 * (docs/results/2026-10-07-judge-v2.md), so the engine default stays v2; v3 is kept for evals.
 */
export const SCREEN_PROMPT_VERSION_V2 = "pass1-screen-v2";
export const SCREEN_PROMPT_VERSION_V3 = "pass1-screen-v3";
/** The engine's pass-1 prompt version (cache key). */
export const SCREEN_PROMPT_VERSION = SCREEN_PROMPT_VERSION_V2;

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
  /**
   * v3 view only: which aspects of THIS configuration one of the person's private boundaries is
   * relevant to ("format", "category", "topic"). Never the boundary itself.
   */
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
const VISIBLE: ReadonlySet<Facet["scope"]> = new Set(["shareable", "matchable"]);

/**
 * View options. "v2" (default) is the view the rec-eval-v1 baseline and pass1-screen-v2 use. "v3"
 * adds, per fact, its basis, source, confidence and age (and a HYPOTHESIS mark for
 * unconfirmed low-confidence facts), the age of each intent, drops expired intents, and gives a
 * redacted private-boundary flag (which aspect of this configuration it touches, never its content).
 */
export interface PublicViewOptions { version?: "v2" | "v3" }

export function buildPublicView(snap: WorldSnapshot, cfg: ScreenConfig, o: PublicViewOptions = {}): PublicView {
  const v3 = (o.version ?? "v2") === "v3";
  const ids = [...cfg.participants, ...(cfg.via ? [cfg.via] : [])];
  const refs: Record<string, MemberId> = {};
  const refOf = new Map<MemberId, string>();
  ids.forEach((id, i) => { const r = `P${i + 1}`; refs[r] = id; refOf.set(id, r); });
  const day = (t: number) => Math.round(((t - snap.now) / DAY) * 10) / 10;
  const scrub = (s: string) => scrubIds(s, refOf);

  const people = ids.map((id): PublicPerson => {
    const m = snap.members.find(x => x.id === id);
    if (!m) throw new Error(`unknown member ${id}`);
    const facets = snap.facets.filter(f => f.memberId === id && VISIBLE.has(f.scope)
      && (f.validFrom === undefined || f.validFrom <= snap.now) && (f.validTo === undefined || f.validTo >= snap.now));
    return {
      ref: refOf.get(id)!,
      role: id === cfg.via ? "connector (introduces the others, does not attend)" : cfg.roles[id] ?? "peer",
      attending: id !== cfg.via,
      age: m.age,
      home_city: m.homeCity,
      participation_state: m.state,
      joined_days_ago: Math.max(0, Math.round((snap.now - m.joinedAt) / DAY)),
      preferences: {
        formats: [...m.prefs.formats], categories_opted_in: [...m.prefs.categoriesOptIn],
        romance_opt_in: m.prefs.romanceOptIn, max_travel_minutes: m.prefs.maxTravelMinutes,
        only_when_asked: m.prefs.onlyWhenAsked,
      },
      shareable: facets.filter(f => f.scope === "shareable").map(f => scrub(`${f.kind}: ${f.value}`) + (v3 ? ` ${evidenceTag(f, snap.now)}` : "")),
      matchable_do_not_quote: facets.filter(f => f.scope === "matchable").map(f => scrub(`${f.kind}: ${f.value}`) + (v3 ? ` ${evidenceTag(f, snap.now)}` : "")),
      intents: snap.intents.filter(i => i.memberId === id && i.status === "active" && (!v3 || i.createdAt + i.horizonDays * DAY >= snap.now))
        .map(i => ({ objective: scrub(i.objective), category: i.category, ...(v3 ? { created_days_ago: Math.max(0, Math.round((snap.now - i.createdAt) / DAY)) } : {}) })),
      presence: snap.presence.filter(p => p.memberId === id).map(p => ({
        city: p.city, type: p.type, areas: [...p.areas],
        ...(p.from !== undefined ? { from_day: day(p.from) } : {}), ...(p.to !== undefined ? { to_day: day(p.to) } : {}),
      })),
      ...(v3 && id !== cfg.via ? (() => {
        // Redacted boundary signal: agent_private boundary facets are read here, but only the aspect
        // of this configuration they touch leaves this function, never their text.
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
      window_days: { from: day(cfg.window.start), to: day(cfg.window.end) },
    },
    people, relationships, refs,
  };
}

export const SCREEN_SYSTEM_V2 = `You are the first-pass screen for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone involved opted in) dating.
You evaluate ONE candidate configuration of people and decide whether the Network should propose it. Be a thoughtful, skeptical friend: precision over volume. Most candidates are NOT good; say yes only when every attending person clearly gains and would plausibly accept.
Hard policy (any violation means verdict "no" and dealbreaker=true):
- Everyone involved in ANY role (attending or connector) must be 18 or older.
- Never propose people when one has blocked the other.
- Romance/dating configurations require every attending person to have romance_opt_in=true.
- Everyone must be able to be in the configuration's city during the window (check presence and trips).
Judge from what is listed: intents, interests/skills (matchable_do_not_quote), shareable facts, preferences, participation state, presence, and relationships.

Think in this order and write the JSON keys in EXACTLY this order:
1. "reasoning": FIRST, a concrete explanation (3-6 sentences) of why these people would or would not be a good fit: what each attending person specifically gains, what argues against it, and whether each would plausibly say yes. ${CITATION_RULES} This text is internal (reviewers only); it is never shown to members, so it may refer to matchable_do_not_quote items.
2. "cited_facts": the facts you relied on, at most 6: [{"ref":"P1","field":"intents[0]","fact":"..."}].
3. "dealbreaker": true if a hard policy or a clear stated preference makes it inappropriate regardless of fit; "dealbreaker_reason": short text or "".
4. "verdict": "yes" (the Network should propose this) or "no". It must follow from your reasoning.
5. "match_probability": your calibrated probability (0-1) that this is a genuinely good, mutually wanted opportunity. Use the full range; "yes" should normally be >= 0.5 and "no" < 0.5.
6. "accept_probability": for each ATTENDING person ref, probability (0-1) they would accept the invitation.
7. "member_why": LAST, one or two warm sentences that could be shown to the participants, using ONLY items under "shareable" and the configuration's logistics. Never quote matchable_do_not_quote items; never use names, ids, ages, contact details, or anything sensitive. Use "" when the verdict is "no".
Return ONLY a JSON object: {"reasoning":string,"cited_facts":[...],"dealbreaker":bool,"dealbreaker_reason":string,"verdict":"yes"|"no","match_probability":number,"accept_probability":{"P1":number,...},"member_why":string}`;

/**
 * pass1-screen-v3 (2026-10-07). Changes from v2 (luna error analysis recs 3-5): judge enjoyment and
 * benefit if they meet, not acceptance; a shared stated intent is sufficient; each person's gain maps
 * to their own live intent; groups as a whole; unknown schedules are normal; facts carry basis,
 * confidence and age, and hypothesis facts never anchor alone; a redacted private-boundary flag.
 */
export const SCREEN_SYSTEM_V3 = `You are the first-pass screen for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone involved opted in) dating.
You evaluate ONE candidate configuration of people and decide whether the Network should propose it. Be a thoughtful, skeptical friend: protect members' attention, and do not withhold an intro that would clearly serve both sides.
Hard policy (any violation means verdict "no" and dealbreaker=true):
- Everyone involved in ANY role (attending or connector) must be 18 or older.
- Never propose people when one has blocked the other.
- Romance/dating configurations require every attending person to have romance_opt_in=true.
- Everyone must be able to be in the configuration's city at some point during the window (check presence and trips).
Judge from what is listed: intents (live, with their age), interests/skills (matchable_do_not_quote), shareable facts, preferences, participation state, presence, relationships, and private_boundary_relevant_to.
Each fact ends with its evidence in brackets: basis (stated / confirmed / observed / inferred / vouched), source, confidence, age, and HYPOTHESIS when it is an unconfirmed fact with low confidence.
private_boundary_relevant_to (when present) says that the person has a private boundary relevant to that aspect of this configuration ("format" = meeting one-to-one with someone new; "category" = this kind of intro; "topic" = what the intro is about). You never see the boundary itself; treat it as a penalty on fit, not a veto.
${JUDGING_NOTES_V3}

Think in this order and write the JSON keys in EXACTLY this order:
1. "reasoning": FIRST, a concrete explanation (3-6 sentences): for each attending person, which of their OWN intents (or offers) this serves and what they would get from the others; what argues against it; and whether each would enjoy and benefit from meeting. ${CITATION_RULES} This text is internal (reviewers only); it is never shown to members, so it may refer to matchable_do_not_quote items.
2. "cited_facts": the facts you relied on, at most 6: [{"ref":"P1","field":"intents[0]","fact":"..."}].
3. "dealbreaker": true only if a hard policy or a hard dealbreaker makes it inappropriate regardless of fit; "dealbreaker_reason": short text or "".
4. "verdict": "yes" (the Network should propose this) or "no". It must follow from your reasoning.
5. "match_probability": your calibrated probability (0-1) that every attending person would enjoy and benefit from this meeting. Use the full range; "yes" should normally be >= 0.5 and "no" < 0.5.
6. "accept_probability": for each ATTENDING person ref, probability (0-1) they would accept the invitation (reported separately; it does not decide the verdict).
7. "member_why": LAST, one or two warm sentences that could be shown to the participants, using ONLY items under "shareable" and the configuration's logistics (never the bracketed evidence notes). Never quote matchable_do_not_quote items; never use names, ids, ages, contact details, or anything sensitive. Use "" when the verdict is "no".
Return ONLY a JSON object: {"reasoning":string,"cited_facts":[...],"dealbreaker":bool,"dealbreaker_reason":string,"verdict":"yes"|"no","match_probability":number,"accept_probability":{"P1":number,...},"member_why":string}`;

export const SCREEN_PROMPTS = { v2: { version: SCREEN_PROMPT_VERSION_V2, system: SCREEN_SYSTEM_V2 }, v3: { version: SCREEN_PROMPT_VERSION_V3, system: SCREEN_SYSTEM_V3 } } as const;
/** The engine's pass-1 system prompt (v2; see SCREEN_PROMPT_VERSION). */
export const SCREEN_SYSTEM = SCREEN_SYSTEM_V2;

/** Messages for pass 1. Takes ONLY the public view (the refs map is dropped). */
export function screenMessages(view: PublicView, version: "v2" | "v3" = "v2"): ChatMessage[] {
  const { refs: _refs, ...visible } = view;
  return [
    { role: "system", content: SCREEN_PROMPTS[version].system },
    { role: "user", content: JSON.stringify(visible) },
  ];
}

export interface ScreenVerdict {
  pass: 1;
  reasoning: string;
  citedFacts: CitedFact[];
  dealbreaker: boolean;
  dealbreakerReason?: string;
  verdict: PassVerdict;
  matchProbability: number;
  /** Keyed by participant ref (P1, P2, ...). */
  acceptProbability: Record<string, number>;
  /** Member-facing text (shareable only); must still pass the leak gate before use. */
  memberWhy: string;
  /** The model wrote its explanation before its verdict (JSON key order). */
  reasoningFirst: boolean;
}

/** Validate a raw pass-1 reply. Throws on schema errors (counted as parse failures). */
export function parseScreenVerdict(raw: unknown, attendingRefs: string[]): ScreenVerdict {
  const o = raw as Record<string, any>;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("not an object");
  const errs: string[] = [];
  const reasoning = str(o.reasoning);
  if (!reasoning) errs.push("reasoning");
  const verdict = parsePassVerdict(o.verdict, false);
  if (!verdict) errs.push("verdict");
  const mp = prob(o.match_probability);
  if (mp === undefined) errs.push("match_probability");
  if (typeof o.dealbreaker !== "boolean") errs.push("dealbreaker");
  const acc: Record<string, number> = {};
  for (const r of attendingRefs) {
    const p = prob(o.accept_probability?.[r]);
    if (p === undefined) errs.push(`accept_probability.${r}`); else acc[r] = p;
  }
  if (errs.length) throw new Error(`schema: ${errs.join(", ")}`);
  return {
    pass: 1, reasoning, citedFacts: parseCitedFacts(o.cited_facts), dealbreaker: o.dealbreaker,
    dealbreakerReason: str(o.dealbreaker_reason, 300) || undefined, verdict: verdict!, matchProbability: mp!,
    acceptProbability: acc, memberWhy: str(o.member_why ?? o.why, 600),
    reasoningFirst: keyOrderOk(o, ["reasoning"], "verdict"),
  };
}

/** Pass-1 decision: yes only if verdict is yes and there is no dealbreaker. */
export const screenDecision = (v: ScreenVerdict) => v.verdict === "yes" && !v.dealbreaker;

/** Engine side: the screen config for a candidate that already passed the hard filters. */
export function screenConfigOf(w: World, c: Candidate): ScreenConfig {
  return {
    participants: [...c.participants], roles: { ...c.roles }, via: c.via, kind: c.kind, category: c.category,
    objective: c.objective, city: c.city ?? w.get(c.participants[0]!)?.m.homeCity ?? "sf",
    window: c.window ?? { start: w.now, end: w.now + w.cfg.windowDays * DAY },
  };
}

export async function screenOne(w: World, c: Candidate, llm: LLM, maxTokens: number): Promise<{ verdict: ScreenVerdict; refs: Record<string, MemberId> }> {
  const view = buildPublicView(w.input, screenConfigOf(w, c));
  const attending = Object.entries(view.refs).filter(([, id]) => c.participants.includes(id)).map(([r]) => r);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await llm.chat(screenMessages(view), { maxTokens, json: true });
      return { verdict: parseScreenVerdict(parseJson(out), attending), refs: view.refs };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
