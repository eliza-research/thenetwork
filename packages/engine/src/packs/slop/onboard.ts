// slop.date onboarding conversation: the read-back, corrections and the next question.
// The network service runs the loop (docs/results/2026-10-09-slop-onboarding.md "Integration"):
//   inbound text -> extractSlopProfile (or applyCorrection after a read-back) -> persist slopOnboardTags
//   -> when every hard field is set and not yet confirmed: send readBack -> otherwise send nextQuestion.
// Copy rules: one question per message, about the member only; the read-back repeats only what the
// member said, and never identity, orientation, age, kids, faith or anything the rules did not read.
import { classifyYesNo } from "@thenetwork/core";
import type { Gender } from "./profile.ts";
import { SLOP_ASK_QUESTIONS } from "./copy.ts";
import {
  extractSlopProfile, finalize, HARD_FIELDS, hasField, type Dealbreaker, type DateActivity, type ExtractOptions, type OnboardField, type SlopOnboarding,
} from "./extract.ts";

// ------------------------------------------------------------------------------------------ read-back

const PLURAL: Record<Gender, string> = { woman: "women", man: "men", nonbinary: "nonbinary people" };
const DB_PHRASE: Record<Dealbreaker, string> = {
  smoker: "smoking", heavy_drinker: "heavy drinking", has_kids: "people with kids", wants_kids: "people who want kids", no_kids_ever: "people who don't want kids",
  religious: "very religious people", nonreligious: "people without faith", right_politics: "right-wing politics", left_politics: "left-wing politics",
};
const ACT_PHRASE: Record<DateActivity, string> = {
  coffee: "coffee", drinks: "drinks", dinner: "dinner", walk: "a walk", museum: "museums", live_music: "live music", comedy: "comedy", climbing: "climbing", hike: "a hike", cooking_class: "a cooking class",
};
const INTEREST_PHRASE: Record<string, string> = { rock_music: "rock", electronic_music: "electronic music", live_music: "live music", board_games: "board games", climate_tech: "climate tech", ai: "AI", books: "books", film: "movies" };
const MARKET_NAME: Record<string, string> = { nyc: "NYC", sf: "SF", la: "LA" };
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Each fact the read-back states, with the field it comes from (the evals check every one was stated). */
export interface ReadBackFact { field: OnboardField; text: string }
/** Fields the read-back may repeat. Identity, orientation, age, values (kids, faith, smoking, drinking) never. */
export const READBACK_FIELDS: readonly OnboardField[] = ["gender", "seeks", "ageRange", "distance", "location", "goal", "dealbreakers", "interests", "activities"];
const MIN_CONF = 0.6;

export function readBackFacts(p: SlopOnboarding): ReadBackFact[] {
  const out: ReadBackFact[] = [];
  if (p.minor || p.declined) return out;
  const ok = (f?: { confidence: number }) => !!f && f.confidence >= MIN_CONF;
  if (ok(p.gender)) out.push({ field: "gender", text: p.gender!.value === "nonbinary" ? "you're nonbinary" : `you're a ${p.gender!.value}` });
  if (ok(p.seeks)) {
    const s = p.seeks!.value;
    const who = s.length === 3 ? "people of any gender" : list(s.map(g => PLURAL[g]));
    out.push({ field: "seeks", text: `looking for ${who}` });
  }
  if (ok(p.ageRange)) { const [lo, hi] = p.ageRange!.value; out.push({ field: "ageRange", text: hi >= 99 ? `${lo}+` : lo <= 18 ? `up to ${hi}` : `${lo}-${hi}` }); }
  const loc = ok(p.location) && p.location!.value.known ? (p.location!.value.area ?? p.location!.value.zip) : undefined;
  if (ok(p.distance)) {
    const d = p.distance!.value;
    if (d.mode === "radius") out.push({ field: "distance", text: `within ${d.miles} mi` });
    else if (d.mode === "city") out.push({ field: "distance", text: "anywhere in the city" });
    else out.push({ field: "distance", text: `dating in ${list(d.markets.map(m => MARKET_NAME[m] ?? m))}` });
  }
  if (loc) out.push({ field: "location", text: p.distance?.value.mode === "radius" ? `of ${loc}` : `near ${loc}` });
  const likes = [...p.interests.filter(ok).map(i => INTEREST_PHRASE[i.value] ?? i.value.replace(/_/g, " ")), ...p.activities.filter(ok).map(a => ACT_PHRASE[a.value])];
  const uniq = [...new Set(likes)].slice(0, 4);
  if (uniq.length) out.push({ field: p.interests.length ? "interests" : "activities", text: `into ${list(uniq)}` });
  if (ok(p.goal)) out.push({ field: "goal", text: p.goal!.value === "long_term" ? "something long-term" : p.goal!.value === "casual" ? "something casual" : "seeing where it goes" });
  const dbs = p.dealbreakers.filter(ok).map(d => DB_PHRASE[d.value]);
  if (dbs.length) out.push({ field: "dealbreakers", text: `dealbreakers: ${list(dbs)}` });
  return out;
}

/**
 * A short, warm SMS that repeats what the member told us, for them to confirm or correct:
 * "so: you're a woman looking for men 28-38 within 5 mi of 11211, into climbing and dinner; dealbreakers: smoking. right?"
 * Undefined when there is nothing to read back (and always for a minor or a declined person).
 */
export function readBack(p: SlopOnboarding): string | undefined {
  const f = readBackFacts(p);
  if (!f.length) return undefined;
  const get = (k: OnboardField) => f.find(x => x.field === k)?.text;
  const who = [get("gender"), get("seeks"), get("ageRange")].filter(Boolean).join(" ");
  const where = [get("distance"), get("location")].filter(Boolean).join(" ");
  const into = f.find(x => x.field === "interests" || x.field === "activities")?.text;
  const goal = get("goal");
  const head = [who, where].filter(Boolean).join(" ");
  const mid = [into, goal ? (head || into ? `looking for ${goal}` : `you want ${goal}`) : undefined].filter(Boolean).join(", ");
  const parts = [[head, mid].filter(Boolean).join(", "), get("dealbreakers")].filter(Boolean);
  return `so: ${parts.join("; ")}. right?`;
}

// ------------------------------------------------------------------------------------------ corrections

/**
 * The member's answer to a read-back: "yep" confirms; "no, 30-40" or "actually women too" changes the
 * field and leaves the profile unconfirmed (the service reads back again). "no" alone changes nothing
 * and stays unconfirmed (the service asks what to fix).
 */
export function applyCorrection(p: SlopOnboarding, text: string, o: ExtractOptions = {}): SlopOnboarding {
  const next = extractSlopProfile([{ text, asked: o.asked }], p, o);
  const changed = JSON.stringify(view(next)) !== JSON.stringify(view(p));
  if (changed) return finalize({ ...next, confirmed: false });
  const yes = classifyYesNo(text) === "yes" || /^\s*(?:right|correct|exactly|that'?s (?:it|right)|you got it|perfect|yup|yep|ya|ye|100|👍)\b/i.test(text);
  return finalize({ ...next, confirmed: yes && !p.minor && !p.declined });
}
const view = (p: SlopOnboarding) => ({ g: p.gender?.value, s: p.seeks?.value, a: p.ageRange?.value, d: p.distance?.value, l: p.location?.value, goal: p.goal?.value, db: p.dealbreakers.map(d => d.value).sort(), i: p.interests.map(x => x.value).sort(), ac: p.activities.map(x => x.value).sort(), f: p.free.map(x => x.value).sort(), age: p.age?.value, v: Object.fromEntries(Object.entries(p.values).map(([k, x]) => [k, x?.value])) });

// ------------------------------------------------------------------------------------------ next question

/** Onboarding questions. The hard ones reuse the pack's ask texts (SLOP_ASK_QUESTIONS) and reasons. */
export const SLOP_ONBOARD_QUESTIONS: Record<string, { field: OnboardField; text: string }> = {
  slop_age: { field: "age", text: "First, how old are you?" },
  slop_orientation: { field: "orientation", text: SLOP_ASK_QUESTIONS.slop_orientation! },
  slop_seeks: { field: "seeks", text: "Who are you hoping to meet: women, men, nonbinary people, or a mix? Name them so I get it right." },
  slop_gender: { field: "gender", text: "And how do you describe yourself: a woman, a man, nonbinary, or something else?" },
  slop_age_range: { field: "ageRange", text: SLOP_ASK_QUESTIONS.slop_age_range! },
  slop_distance: { field: "distance", text: SLOP_ASK_QUESTIONS.slop_distance! },
  slop_location: { field: "location", text: "What's your zip code or neighborhood? It's only used to work out rough distances." },
  slop_zip: { field: "location", text: SLOP_ASK_QUESTIONS.slop_zip! },
  slop_basics: { field: "dealbreakers", text: SLOP_ASK_QUESTIONS.slop_basics! },
  slop_goal: { field: "goal", text: "And what are you looking for right now: something casual, something long-term, or not sure yet?" },
  slop_interests: { field: "interests", text: "What are you into? A few things you love doing is plenty." },
  slop_activities: { field: "activities", text: "What's your idea of a good first date: coffee, drinks, dinner, a walk, a show?" },
  slop_free: { field: "free", text: "Which evenings or weekend times are usually free for you?" },
};
/** Each question at most this many times (the pack's maxAsksPerField default). */
export const MAX_ASKS_PER_QUESTION = 2;

/**
 * The one next question to send, hard fields first (gender and seeking, age range, distance, then a
 * place), then the soft ones (goal and dealbreakers, interests, first-date ideas, free times).
 * Undefined when there is nothing left to ask, or for a minor or a declined person (no dating questions).
 */
export function nextQuestion(p: SlopOnboarding): { reason: string; field: OnboardField; text: string } | undefined {
  if (p.declined || p.minor) return undefined;
  const can = (r: string) => (p.askCounts[r] ?? 0) < MAX_ASKS_PER_QUESTION;
  const q = (r: string) => ({ reason: r, ...SLOP_ONBOARD_QUESTIONS[r]! });
  const order: [boolean, string][] = [
    [!hasField(p, "age"), "slop_age"],
    [!hasField(p, "gender") && !hasField(p, "seeks"), "slop_orientation"],
    [!hasField(p, "seeks"), "slop_seeks"],
    [!hasField(p, "gender"), "slop_gender"],
    [!hasField(p, "ageRange"), "slop_age_range"],
    [!hasField(p, "distance"), "slop_distance"],
    [!hasField(p, "location") && !!p.location?.value.zip && !p.location.value.known, "slop_zip"],
    [!hasField(p, "location"), "slop_location"],
    [!hasField(p, "dealbreakers") && !hasField(p, "goal"), "slop_basics"],
    [!hasField(p, "goal"), "slop_goal"],
    [!hasField(p, "interests"), "slop_interests"],
    [!hasField(p, "activities"), "slop_activities"],
    [!hasField(p, "free"), "slop_free"],
  ];
  for (const [need, r] of order) if (need && can(r)) return q(r);
  return undefined;
}

/** Record that a question was sent (the re-ask cap). */
export function markAsked(p: SlopOnboarding, reason: string): SlopOnboarding {
  return { ...p, askCounts: { ...p.askCounts, [reason]: (p.askCounts[reason] ?? 0) + 1 } };
}

/** True when every hard field is set (the service then sends the read-back). */
export const hardComplete = (p: SlopOnboarding): boolean => HARD_FIELDS.every(f => hasField(p, f));
