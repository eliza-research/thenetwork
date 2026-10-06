// The ONLY thing the recommender model sees about a configuration: a pseudonymous, public view
// built from the engine snapshot (never from Persona objects, never from oracle labels).
//   included: shareable facets, matchable facets (marked do-not-quote), active intents, presence,
//             stated age, participation state, stated preferences, explicit edges among the people.
//   excluded: agent_private facets (boundaries, private disclosures + canaries), hidden truth,
//             names, member ids, oracle verdicts.
import type { ChatMessage, Facet, MemberId, WorldSnapshot } from "../../core/src/index.ts";
import { DAY } from "../../core/src/index.ts";
import type { ConfigSpec, RecPrediction } from "./types.ts";

export const PROMPT_VERSION = "rec-eval-v1";

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

/** Scopes the recommender may read. agent_private / opportunity_specific are never exposed. */
const VISIBLE: ReadonlySet<Facet["scope"]> = new Set(["shareable", "matchable"]);

export function buildPublicView(snap: WorldSnapshot, cfg: ConfigSpec): PublicView {
  const ids = [...cfg.participants, ...(cfg.via ? [cfg.via] : [])];
  const refs: Record<string, MemberId> = {};
  const refOf = new Map<MemberId, string>();
  ids.forEach((id, i) => { const r = `P${i + 1}`; refs[r] = id; refOf.set(id, r); });
  const day = (t: number) => Math.round(((t - snap.now) / DAY) * 10) / 10;
  // Replace any member id that might appear inside a text value with its ref (or a neutral token).
  const scrub = (s: string) => s.replace(/\b[a-z]{2,4}-\d-\d{4}\b/gi, m => refOf.get(m) ?? "another member");

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

export const RECOMMENDER_SYSTEM = `You are the recommender for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone involved opted in) dating.
You evaluate ONE candidate configuration of people and decide whether the Network should propose it. Be a thoughtful, skeptical friend: precision over volume. Most candidates are NOT good; say yes only when every attending person clearly gains and would plausibly accept.
Hard policy (any violation means good_match=false and dealbreaker=true):
- Everyone involved in ANY role (attending or connector) must be 18 or older.
- Never propose people when one has blocked the other.
- Romance/dating configurations require every attending person to have romance_opt_in=true.
- Everyone must be able to be in the configuration's city during the window (check presence and trips).
Judge from what is listed: intents, interests/skills (matchable_do_not_quote), shareable facts, preferences, participation state, presence, and relationships.
Output fields:
- good_match: true if the Network should propose this.
- match_probability: your probability (0-1) that this is a genuinely good, mutually wanted opportunity.
- accept_probability: for each ATTENDING person ref, probability (0-1) they would accept the invitation.
- dealbreaker: true if a hard policy or a clear stated preference makes it inappropriate regardless of fit; dealbreaker_reason: short text or "".
- why: one or two warm sentences that could be shown to the participants, using ONLY items under "shareable" and the configuration's logistics. Never quote matchable_do_not_quote items, never use names, ids, ages, contact details, or anything sensitive.
Return ONLY a JSON object: {"good_match":bool,"match_probability":number,"accept_probability":{"P1":number,...},"dealbreaker":bool,"dealbreaker_reason":string,"why":string}`;

/** Messages sent to the model. Takes ONLY the public view (refs map is dropped). */
export function recommenderMessages(view: PublicView): ChatMessage[] {
  const { refs: _refs, ...visible } = view;
  return [
    { role: "system", content: RECOMMENDER_SYSTEM },
    { role: "user", content: JSON.stringify(visible) },
  ];
}

const prob = (x: unknown): number | undefined => {
  const n = typeof x === "string" ? Number(x) : x;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const v = n > 1 && n <= 100 ? n / 100 : n;
  return v < 0 || v > 1 ? undefined : v;
};

/** Validate a raw model reply. Throws on schema errors (counted as parse failures). */
export function parseRecPrediction(raw: unknown, attendingRefs: string[]): RecPrediction {
  const o = raw as Record<string, any>;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("not an object");
  const errs: string[] = [];
  if (typeof o.good_match !== "boolean") errs.push("good_match");
  const mp = prob(o.match_probability);
  if (mp === undefined) errs.push("match_probability");
  if (typeof o.dealbreaker !== "boolean") errs.push("dealbreaker");
  if (typeof o.why !== "string") errs.push("why");
  const acc: Record<string, number> = {};
  for (const r of attendingRefs) {
    const p = prob(o.accept_probability?.[r]);
    if (p === undefined) errs.push(`accept_probability.${r}`); else acc[r] = p;
  }
  if (errs.length) throw new Error(`schema: ${errs.join(", ")}`);
  return {
    goodMatch: o.good_match, matchProbability: mp!, acceptProbability: acc, dealbreaker: o.dealbreaker,
    dealbreakerReason: typeof o.dealbreaker_reason === "string" ? o.dealbreaker_reason : undefined, why: o.why.trim(),
  };
}

/** Final yes/no decision used for accuracy: yes only if good_match and no dealbreaker. */
export const decision = (p: RecPrediction) => p.goodMatch && !p.dealbreaker;
