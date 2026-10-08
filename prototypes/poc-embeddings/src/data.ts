// Engine-visible member text (public files only) and oracle ground truth (hidden truth, eval only).
import type { Facet, FacetKind, Intent, MemberId } from "../../../packages/core/src/index.ts";
import { DAY } from "../../../packages/core/src/index.ts";
import { loadPublic, loadPersonas, toSnapshot, type PublicData } from "../../../scripts/synthetic/load.ts";
import { Oracle } from "../../../packages/sim/src/oracle.ts";
import { DESIRES } from "../../../packages/sim/src/taxonomy.ts";
import type { Persona } from "../../../packages/sim/src/persona.ts";
import { intentText } from "../../../packages/engine/src/world.ts";

// Mirrors packages/engine/src/world.ts: matchable|shareable facets of these kinds; live active intents.
const MATCH_KINDS = new Set<FacetKind>(["interest", "skill", "offer", "desire", "goal", "trait", "fact", "resource"]);
const CAP_KINDS = new Set<FacetKind>(["skill", "offer", "resource"]);
const DESIRE_KINDS = new Set<FacetKind>(["interest", "desire", "goal"]);

export interface MemberView {
  id: MemberId; city: string; age: number;
  match: Facet[]; caps: Facet[]; desires: Facet[]; intents: Intent[];
  /** One document with everything the engine can match on. */
  doc: string;
  /** What the member is looking for (live intents; falls back to interests). */
  wants: string;
  /** What the member can give (skills, offers, occupation; falls back to interests). */
  offers: string;
}

/** Text the engine embeds for a facet (world.ts line ~234). */
export const facetText = (f: Facet) => `${f.value} ${f.tags.join(" ")}`;
export { intentText };

export function buildViews(d: PublicData, opts: { includeExpiredIntents?: boolean } = {}): MemberView[] {
  const snap = toSnapshot(d); // strips dataset-only fields exactly like the engine loader
  const now = snap.now;
  const facetsBy = new Map<string, Facet[]>();
  for (const f of snap.facets) {
    if (f.validTo !== undefined && f.validTo < now) continue;
    if (f.validFrom !== undefined && f.validFrom > now) continue;
    if (!(f.scope === "matchable" || f.scope === "shareable") || !MATCH_KINDS.has(f.kind)) continue;
    (facetsBy.get(f.memberId) ?? facetsBy.set(f.memberId, []).get(f.memberId)!).push(f);
  }
  const intentsBy = new Map<string, Intent[]>();
  for (const it of snap.intents) {
    if (!(it.status === "active" && (opts.includeExpiredIntents || it.createdAt + it.horizonDays * DAY > now))) continue;
    (intentsBy.get(it.memberId) ?? intentsBy.set(it.memberId, []).get(it.memberId)!).push(it);
  }
  return snap.members.map(m => {
    const match = (facetsBy.get(m.id) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1));
    const intents = (intentsBy.get(m.id) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1));
    const caps = match.filter(f => CAP_KINDS.has(f.kind));
    const desires = match.filter(f => DESIRE_KINDS.has(f.kind));
    const interests = match.filter(f => f.kind === "interest").map(f => f.value);
    const skills = match.filter(f => f.kind === "skill").map(f => f.value);
    const offers = match.filter(f => f.kind === "offer").map(f => f.value);
    const facts = match.filter(f => f.kind === "fact").map(f => f.value);
    const wantsL = intents.map(i => `${i.objective}: ${i.details ?? ""} Looking for: ${i.desiredPeople ?? ""}`.trim());
    const lines = [
      interests.length ? `Interests: ${interests.join("; ")}.` : "",
      skills.length ? `Skills: ${skills.join("; ")}.` : "",
      offers.length ? `Can offer: ${offers.join("; ")}.` : "",
      facts.length ? `About: ${facts.join("; ")}.` : "",
      wantsL.length ? `Looking for: ${wantsL.join(" | ")}` : "",
    ].filter(Boolean);
    const doc = lines.join("\n") || "(no profile)";
    const wants = wantsL.length ? `Wants: ${wantsL.join(" | ")}` : interests.length ? `Wants to meet people into: ${interests.join("; ")}` : "(nothing stated)";
    const offerParts = [...skills, ...offers, ...facts.filter(x => x.startsWith("works as"))];
    const offerText = offerParts.length ? `Can offer: ${offerParts.join("; ")}. Into: ${interests.join("; ")}` : interests.length ? `Into: ${interests.join("; ")}` : "(nothing stated)";
    return { id: m.id, city: m.homeCity, age: m.age, match, caps, desires, intents, doc, wants, offers: offerText };
  });
}

export interface Truth {
  /** Oracle label name. */
  name: string;
  /** member -> set of good partners. */
  good: Map<MemberId, Set<MemberId>>;
  pairs: number;
}

/**
 * Candidate pool per member: same home city, publicly 18+, not already connected by any public
 * edge (the latent definition excludes people who already know each other). Adversarial members
 * stay in the pool as negatives: the engine cannot see them.
 */
export function candidatePools(d: PublicData, views: MemberView[]): Map<MemberId, MemberId[]> {
  const connected = new Set<string>();
  for (const e of d.edges) { connected.add(`${e.from}|${e.to}`); connected.add(`${e.to}|${e.from}`); }
  const out = new Map<MemberId, MemberId[]>();
  for (const a of views) {
    if (a.age < 18) continue;
    out.set(a.id, views.filter(b => b.id !== a.id && b.city === a.city && b.age >= 18 && !connected.has(`${a.id}|${b.id}`)).map(b => b.id));
  }
  return out;
}

function toTruth(name: string, list: { a: string; b: string }[]): Truth {
  const good = new Map<MemberId, Set<MemberId>>();
  for (const { a, b } of list) {
    (good.get(a) ?? good.set(a, new Set()).get(a)!).add(b);
    (good.get(b) ?? good.set(b, new Set()).get(b)!).add(a);
  }
  return { name, good, pairs: list.length };
}

/** packages/sim Oracle.latentPairs, exactly as the simulator computes pair recall. */
export function oracleTruth(personas: Persona[], seed: number, at: number): Truth {
  const o = new Oracle(personas, seed, at);
  return toTruth(`oracle seed ${seed}`, o.latentPairs(personas.map(p => p.id), at));
}

/**
 * Same oracle utility but WITHOUT the seeded pair-chemistry term (which is unpredictable from any
 * profile by design). This is the "systematic" good-pair set: the part retrieval can in principle find.
 * Reproduces Oracle.evaluate for a 2-person intro with chem = 0.
 */
export function systematicTruth(personas: Persona[], at: number): { truth: Truth; score: (a: string, b: string) => number } {
  const o = new Oracle(personas, 0, at);
  const ok = personas.filter(p => !p.hidden.adversarial && p.hidden.trueAge >= 18);
  const byId = new Map(personas.map(p => [p.id, p]));
  const enjoy = (a: Persona, b: Persona) => {
    let e = o.pairEnjoyment(a, b).e;
    e -= 0.06 * Math.max(0, 2 - a.hidden.preferredGroupSize) * (1 - a.hidden.socialEnergy);
    if (a.hidden.boundaries.includes("prefers groups over one-on-one with strangers") && !a.relationships.some(r => r.to === b.id)) e -= 0.15;
    return Math.max(0, Math.min(1, e));
  };
  const score = (x: string, y: string) => { const a = byId.get(x)!, b = byId.get(y)!; return Math.min(enjoy(a, b), enjoy(b, a)); };
  const list: { a: string; b: string }[] = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
    const a = ok[i]!, b = ok[j]!;
    if (a.homeCity !== b.homeCity || a.relationships.some(r => r.to === b.id)) continue;
    if (!o.presentIn(a, a.homeCity, at) || !o.presentIn(b, a.homeCity, at)) continue;
    if (score(a.id, b.id) >= 0.55) list.push({ a: a.id, b: b.id });
  }
  return { truth: toTruth("systematic (no chemistry)", list), score };
}

/**
 * Diagnostic ceiling: the oracle's systematic utility computed from the persona's STATED public
 * profile (statedInterests/statedSkills/statedIntents) instead of hidden truth. This is what a
 * perfect parser of public text into the taxonomy could rank by. Not engine-legal input (it reads
 * the persona record), only a bound.
 */
export function statedScorer(personas: Persona[], at: number): (a: string, b: string) => number {
  const stated = personas.map(p => ({
    ...p,
    hidden: {
      ...p.hidden,
      interests: p.public.statedInterests,
      skills: p.public.statedSkills,
      desires: p.public.statedIntents.map(si => ({ id: si.desireId, text: si.text, category: si.category, strength: 0.7 })),
      adversarial: undefined, trueAge: p.public.claimedAge,
    },
  })) as Persona[];
  return systematicTruth(stated, at).score;
}

export async function loadAll(opts: { includeExpiredIntents?: boolean } = {}) {
  const d = await loadPublic();
  const personas = await loadPersonas();
  const views = buildViews(d, opts);
  return { d, personas, views, now: d.manifest.snapshotNow };
}

/**
 * Like statedScorer, but every member-level hidden trait (social energy, openness, capacity,
 * preferred group size, boundaries) is set to a neutral value, so only the PAIR terms from stated
 * interests/skills/intents remain. Separates "who complements whom" from "who enjoys meeting anyone".
 */
export function statedPairOnlyScorer(personas: Persona[], at: number): (a: string, b: string) => number {
  const neutral = personas.map(p => ({
    ...p,
    hidden: {
      ...p.hidden,
      interests: p.public.statedInterests, skills: p.public.statedSkills,
      desires: p.public.statedIntents.map(si => ({ id: si.desireId, text: si.text, category: si.category, strength: 0.7 })),
      adversarial: undefined, trueAge: p.public.claimedAge,
      socialEnergy: 0.5, openness: 0.5, capacity: 0.5, preferredGroupSize: 2, boundaries: [],
    },
  })) as Persona[];
  return systematicTruth(neutral, at).score;
}

/**
 * ENGINE-LEGAL structured scorer: uses only engine-visible data (facet tags, live intents, public
 * age, romance opt-in/preference tags the engine already reads for its filters) plus the product
 * taxonomy (DESIRES: what each objective needs). Same functional form as the oracle's pair terms:
 * interest overlap + intent complementarity (skill > shared pool > interest), symmetric via min.
 */
export function structuredPublicScorer(views: MemberView[], d: PublicData): (a: string, b: string) => number {
  const byText = new Map(DESIRES.map(x => [x.text, x]));
  const romance = new Map<string, { optIn: boolean; is: string[]; seeks: string[]; lo: number; hi: number }>();
  const optIn = new Map(d.members.map(m => [m.id, !!m.prefs.romanceOptIn]));
  for (const f of d.facets) for (const t of f.tags) if (t.startsWith("romance:")) {
    const r = romance.get(f.memberId) ?? { optIn: optIn.get(f.memberId) ?? false, is: [], seeks: [], lo: 18, hi: 120 };
    const [, k, v] = t.split(":");
    if (k === "is") r.is.push(v!); if (k === "seeks") r.seeks.push(v!);
    if (k === "age") { const [lo, hi] = v!.split("-").map(Number); r.lo = lo!; r.hi = hi!; }
    romance.set(f.memberId, r);
  }
  const prof = new Map(views.map(v => {
    const interests = new Set(v.match.filter(f => f.kind === "interest").map(f => f.tags[0]!));
    const skills = new Set(v.match.filter(f => f.kind === "skill").flatMap(f => f.tags));
    const desires = v.intents.map(i => byText.get(i.objective)).filter((x): x is (typeof DESIRES)[number] => !!x);
    return [v.id, { v, interests, skills, desires }] as const;
  }));
  const romanceOk = (a: string, b: string) => {
    const ra = romance.get(a), rb = romance.get(b);
    const A = prof.get(a)!.v, B = prof.get(b)!.v;
    const one = (r: typeof ra, s: typeof rb, age: number) => !!r && r.optIn && !!s && s.is.some(g => r.seeks.includes(g)) && age >= r.lo && age <= r.hi;
    return one(ra, rb, B.age) && one(rb, ra, A.age);
  };
  const sat = (x: string, y: string) => {
    const X = prof.get(x)!, Y = prof.get(y)!;
    let best = 0;
    for (const def of X.desires) {
      if (def.category === "romance") { if (romanceOk(x, y)) best = Math.max(best, 0.9); continue; }
      let s = 0;
      if (def.needsSkills.some(k => Y.skills.has(k))) s = 1;
      else if (def.pool && Y.desires.some(o => o.pool === def.pool)) s = 0.85;
      else if (def.needsInterests.some(t => Y.interests.has(t))) s = 0.45;
      best = Math.max(best, s);
    }
    return best;
  };
  const e = (x: string, y: string) => {
    const X = prof.get(x)!, Y = prof.get(y)!;
    let shared = 0; for (const t of X.interests) if (Y.interests.has(t)) shared++;
    const overlap = shared / Math.max(1, Math.min(X.interests.size, Y.interests.size));
    return 0.3 * overlap + 0.42 * sat(x, y) + 0.05 * sat(y, x);
  };
  return (a, b) => Math.min(e(a, b), e(b, a)) + 1e-3 * (e(a, b) + e(b, a));
}
