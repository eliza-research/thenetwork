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
import { CITATION_RULES, keyOrderOk, parseCitedFacts, parsePassVerdict, prob, scrubIds, str, type CitedFact, type PassVerdict } from "./judgeCommon.ts";
import type { Candidate } from "./types.ts";
import type { World } from "./world.ts";

export const SCREEN_PROMPT_VERSION = "pass1-screen-v2";

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
  intents: { objective: string; category: string }[];
  presence: { city: string; type: string; areas: string[]; from_day?: number; to_day?: number }[];
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

export function buildPublicView(snap: WorldSnapshot, cfg: ScreenConfig): PublicView {
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
      shareable: facets.filter(f => f.scope === "shareable").map(f => scrub(`${f.kind}: ${f.value}`)),
      matchable_do_not_quote: facets.filter(f => f.scope === "matchable").map(f => scrub(`${f.kind}: ${f.value}`)),
      intents: snap.intents.filter(i => i.memberId === id && i.status === "active").map(i => ({ objective: scrub(i.objective), category: i.category })),
      presence: snap.presence.filter(p => p.memberId === id).map(p => ({
        city: p.city, type: p.type, areas: [...p.areas],
        ...(p.from !== undefined ? { from_day: day(p.from) } : {}), ...(p.to !== undefined ? { to_day: day(p.to) } : {}),
      })),
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

export const SCREEN_SYSTEM = `You are the first-pass screen for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone involved opted in) dating.
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

/** Messages for pass 1. Takes ONLY the public view (the refs map is dropped). */
export function screenMessages(view: PublicView): ChatMessage[] {
  const { refs: _refs, ...visible } = view;
  return [
    { role: "system", content: SCREEN_SYSTEM },
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
