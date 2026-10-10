// The onboard block: slop.date onboarding understanding (critical path #4, prototype P4).
//
// 1. Corpus gates (evals/slop-onboarding/, hand-written SMS, append-only), rules only, no model:
//      hard.jsonl         hard-field accuracy >= 95%; 0 wrong gender or seeking parses
//      hard-heldout.jsonl the same gates on rows written after the rules were tuned
//      ambiguous.jsonl    0 guessed values (every listed field stays unset)
//      parsers.jsonl      rows ported from the service's old parser corpus: 0 wrong values; fields read (tracked)
//      ages.jsonl         teen ages caught 100%; under-13 declined 100%; 0 adults read as minors or declined
//      corrections.jsonl  corrections and confirmations read as labelled (>= 95%), 0 wrong gender / seeking
//      soft.jsonl         goal, dealbreakers, values, interests, first-date ideas, free times (>= 90%)
//    and on every row: the read-back never states a sensitive fact or a field the member did not state.
// 2. The onboarding sim: slop personas (packages/sim/src/apps/slop/persona.ts) answer the agent's
//    questions by text, generated from their stated truth with templates and a paraphrase bank (slang,
//    typos, emoji, non-answers, orientation labels instead of lists). The agent runs the service loop:
//    extract -> read-back and confirm -> nextQuestion. Reported: hard fields filled within 24 hours
//    (P4 target >= 80%, TRACKED), fill after N member messages, wrong values before and after the
//    read-back (0 wrong gender / seeking after confirmation, BLOCKING), minors flagged 100% and never
//    matchable (BLOCKING), read-back leaks 0 (BLOCKING).
// 3. --llm (off by default, needs a provider key): the same corpus and a smaller sim with the LLM
//    reader filling low-confidence fields. Tracked only. `bun run sim` never sets it.
import { defaultLLM, endpointsFor, Rng, HOUR } from "../../packages/core/src/index.ts";
import {
  applyCorrection, extractSlopProfile, extractSlopProfileLLM, hardComplete, hasField, HARD_FIELDS, llmSlopReader, markAsked, nextQuestion, readBack, readBackFacts,
  type OnboardField, type SlopOnboarding, type SlopReader,
} from "../../packages/engine/src/packs/slop/index.ts";
import { generateSlopPersonas, type SlopPersona } from "../../packages/sim/src/apps/slop/persona.ts";
import { zipInfo } from "../../packages/sim/src/apps/slop/geo.ts";
import { Block } from "./gate.ts";

const ROOT = `${import.meta.dir}/../../evals/slop-onboarding`;
const jsonl = async <T>(name: string): Promise<T[]> => (await Bun.file(`${ROOT}/${name}`).text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A field's value in the shape the corpus labels use. */
function valueOf(p: SlopOnboarding, f: string): unknown {
  switch (f) {
    case "age": return p.age?.value;
    case "gender": return p.gender?.value;
    case "seeks": return p.seeks?.value;
    case "ageRange": return p.ageRange?.value;
    case "distance": { const d = p.distance?.value; return d?.mode === "multi" ? { mode: "multi", markets: [...d.markets].sort() } : d; }
    case "location": return p.location?.value.known ? (p.location.value.area ?? p.location.value.zip) : undefined;
    case "goal": return p.goal?.value;
    case "dealbreakers": return p.dealbreakers.map(d => d.value).sort();
    case "noDealbreakers": return p.noDealbreakers ? true : undefined;
    case "interests": return p.interests.map(d => d.value).sort();
    case "activities": return p.activities.map(d => d.value).sort();
    case "free": return p.free.map(d => d.value);
    case "values": return Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, v?.value]));
  }
  return undefined;
}
function matches(p: SlopOnboarding, f: string, want: unknown): boolean {
  const got = valueOf(p, f);
  if (f === "location") return typeof got === "string" && typeof want === "string" && got.toLowerCase() === want.toLowerCase();
  if (f === "values") return Object.entries(want as Record<string, unknown>).every(([k, v]) => (got as Record<string, unknown>)[k] === v);
  if (f === "free") return same([...(got as string[])].sort(), [...(want as string[])].sort());
  return same(got, want);
}
/** True when the field holds a value (for the "never guess" checks). */
function isSet(p: SlopOnboarding, f: string): boolean {
  if (f.startsWith("interests_")) return p.interests.some(i => i.value === f.slice(10));
  if (f === "location") return !!p.location;
  return hasField(p, f as OnboardField);
}

// ---- read-back checks ---------------------------------------------------------------------------
/** Words a read-back must never contain: identity, orientation, own age, kids, faith, habits, health. */
const SENSITIVE = /\b(?:trans|transgender|cis|cisgender|gay|lesbian|bisexual|bi|queer|pansexual|pan|straight|asexual|ace|genderqueer|agender|christian|jewish|muslim|catholic|hindu|buddhist|atheist|agnostic|sober|smoke|smoker|drinker|pregnant|hiv|disabled|divorced|your (?:kids|son|daughter)|you have kids|years? old|you'?re \d+|age \d+|black|white|asian|latina|latino|hispanic|immigra\w*)\b/i;
/** Problems with a read-back: sensitive words, facts without evidence, or facts from fields the member did not state. */
export function readBackProblems(p: SlopOnboarding, msgs: string[], allowed?: Set<string>): string[] {
  const out: string[] = [];
  const text = readBack(p);
  if (!text) return out;
  if (p.minor || p.declined) out.push("read-back for a minor");
  const head = text.split("; dealbreakers:")[0]!;
  if (SENSITIVE.test(head)) out.push(`sensitive: ${text}`);
  for (const f of readBackFacts(p)) {
    if (allowed && !allowed.has(f.field) && !(f.field === "activities" && allowed.has("interests"))) out.push(`unstated ${f.field}: ${text}`);
    const fld = f.field === "interests" ? p.interests[0] : f.field === "activities" ? p.activities[0] : f.field === "dealbreakers" ? p.dealbreakers[0] : (p as unknown as Record<string, { evidence?: { text: string } }>)[f.field];
    const evText = fld?.evidence?.text ?? "";
    if (!evText.trim() || !msgs.some(m => m.includes(evText))) out.push(`no evidence ${f.field}: ${text}`);
  }
  return out;
}

// ---- corpus -------------------------------------------------------------------------------------
type Row = { text?: string; messages?: string[]; asked?: OnboardField; expect?: Record<string, unknown>; unset?: string[] };
type AgeRow = { text: string; minor: boolean; age?: number; declined?: boolean };
type CorrRow = { messages: string[]; correction: string; asked?: OnboardField; expect: Record<string, unknown>; confirmed: boolean; minor?: boolean };

async function corpusGates(b: Block, extract: (msgs: { text: string; asked?: OnboardField }[], prior?: SlopOnboarding) => Promise<SlopOnboarding>, label = "", blocking = true): Promise<void> {
  const gate = (name: string, pass: boolean, detail?: string) => (blocking ? b.gate(name, pass, detail) : b.track(name, pass, detail));
  const rbProblems: string[] = [];
  // Hard fields: the tuning set, then the held-out set (written after the rules were tuned, never tuned on).
  for (const file of ["hard.jsonl", "hard-heldout.jsonl"]) {
  const hard = await jsonl<Row>(file);
  const tag = file === "hard.jsonl" ? "hard fields" : "hard fields, held-out";
  let ok = 0, n = 0;
  const wrongGS: string[] = [], misses: string[] = [];
  for (const r of hard) {
    const msgs = r.messages ?? [r.text!];
    const p = await extract(msgs.map(t => ({ text: t, asked: r.asked })));
    for (const [f, want] of Object.entries(r.expect ?? {})) {
      if (!["gender", "seeks", "ageRange", "distance", "location"].includes(f)) continue;
      n++;
      if (matches(p, f, want)) ok++;
      else {
        misses.push(`${f} ${JSON.stringify(msgs.join(" / "))} -> ${JSON.stringify(valueOf(p, f))}`);
        if ((f === "gender" || f === "seeks") && valueOf(p, f) !== undefined) wrongGS.push(`${f} ${JSON.stringify(r.text)} -> ${JSON.stringify(valueOf(p, f))} (want ${JSON.stringify(want)})`);
      }
    }
    // Facts about hard fields the row did not label are unstated.
    const allowed = new Set([...Object.keys(r.expect ?? {}), "goal", "dealbreakers", "interests", "activities"]);
    rbProblems.push(...readBackProblems(p, msgs, allowed));
  }
  gate(`${label}${tag}: accuracy >= 95% (n ${hard.length} rows, ${n} fields)`, hard.length >= (file === "hard.jsonl" ? 150 : 40) && ok / n >= 0.95, `${pct(ok / n)} (${ok}/${n})${misses.length && ok / n < 0.95 ? `; misses: ${misses.slice(0, 6).join(" | ")}` : misses.length ? `; ${misses.length} unset or wrong` : ""}`);
  gate(`${label}${tag}: 0 wrong gender or seeking parses`, wrongGS.length === 0, wrongGS.slice(0, 5).join(" | "));

  }
  // Ambiguous: never guess.
  const amb = await jsonl<Row>("ambiguous.jsonl");
  const guessed: string[] = [];
  for (const r of amb) {
    const p = await extract([{ text: r.text!, asked: r.asked }]);
    for (const f of r.unset ?? []) if (isSet(p, f)) guessed.push(`${f} ${JSON.stringify(r.text)} -> ${JSON.stringify(valueOf(p, f.startsWith("interests_") ? "interests" : f))}`);
    rbProblems.push(...readBackProblems(p, [r.text!], new Set(["gender", "seeks", "ageRange", "distance", "location", "goal", "dealbreakers", "interests", "activities"].filter(f => !(r.unset ?? []).includes(f)))));
  }
  gate(`${label}ambiguous inputs: 0 guessed values (n ${amb.length})`, amb.length >= 50 && guessed.length === 0, guessed.slice(0, 6).join(" | "));

  // Rows ported from the service's old parser corpus (evals/slop/, removed with packs.ts parseOrientation and
  // friends), labelled to the engine's policy: bi, pan, queer, both, either and a mix leave who they seek
  // unset (PRD 40.5), decades read early 0-3, mid 3-6, late 6-9, and vague distances stay unset.
  // A value other than the label (or any value where the label says unset) is wrong; an unset field is a miss.
  const ported = await jsonl<Row & { from: string }>("parsers.jsonl");
  const wrong: string[] = [], missed: string[] = [];
  let fields = 0;
  for (const r of ported) {
    const msgs = r.messages ?? [r.text!];
    const p = await extract(msgs.map(t => ({ text: t, asked: r.asked })));
    for (const [f, want] of Object.entries(r.expect ?? {})) {
      fields++;
      if (!matches(p, f, want)) (isSet(p, f) ? wrong : missed).push(`${f} ${JSON.stringify(msgs.join(" / "))} -> ${JSON.stringify(valueOf(p, f))}`);
    }
    for (const f of r.unset ?? []) { fields++; if (isSet(p, f)) wrong.push(`${f} ${JSON.stringify(msgs.join(" / "))} -> ${JSON.stringify(valueOf(p, f))} (want unset)`); }
  }
  gate(`${label}ported parser rows (evals/slop): 0 wrong values (n ${ported.length})`, ported.length >= 120 && wrong.length === 0, wrong.slice(0, 6).join(" | "));
  b.track(`${label}ported parser rows (evals/slop): labelled fields read`, missed.length === 0, `${pct(1 - (wrong.length + missed.length) / Math.max(1, fields))} (${fields - wrong.length - missed.length}/${fields}); unset: ${missed.slice(0, 8).join(" | ")}`);

  // Ages.
  const ages = await jsonl<AgeRow>("ages.jsonl");
  const teens = ages.filter(a => a.minor), adults = ages.filter(a => !a.minor);
  const missedTeen = teens.filter(a => !extractSlopProfile([a.text]).minor).map(a => a.text);
  gate(`${label}teen ages caught: 100% (n ${teens.length})`, teens.length >= 30 && missedTeen.length === 0, missedTeen.slice(0, 5).join(" | "));
  const adultMinor = adults.filter(a => extractSlopProfile([a.text]).minor).map(a => a.text);
  gate(`${label}adults never read as minors (n ${adults.length})`, adultMinor.length === 0, adultMinor.slice(0, 5).join(" | "));
  const under13 = ages.filter(a => a.declined), notDeclined = under13.filter(a => !extractSlopProfile([a.text]).declined).map(a => a.text);
  const wrongDecline = ages.filter(a => !a.declined && extractSlopProfile([a.text]).declined).map(a => a.text);
  gate(`${label}under 13 declined 100%, nobody else declined`, under13.length >= 3 && notDeclined.length === 0 && wrongDecline.length === 0, [...notDeclined, ...wrongDecline].slice(0, 5).join(" | "));
  const wrongAge = ages.filter(a => a.age !== undefined && extractSlopProfile([a.text]).age?.value !== a.age).map(a => `${a.text} -> ${extractSlopProfile([a.text]).age?.value}`);
  gate(`${label}stated ages read exactly`, wrongAge.length === 0, wrongAge.slice(0, 5).join(" | "));
  const minorQuestions = teens.filter(a => { const p = extractSlopProfile([a.text]); return nextQuestion(p) !== undefined || readBack(p) !== undefined || p.matchable; }).map(a => a.text);
  gate(`${label}minors: never matchable, no dating question, no read-back`, minorQuestions.length === 0, minorQuestions.slice(0, 5).join(" | "));

  // Corrections.
  const corr = await jsonl<CorrRow>("corrections.jsonl");
  let cOk = 0;
  const cMiss: string[] = [], cWrongGS: string[] = [];
  for (const r of corr) {
    const p0 = await extract(r.messages.map(t => ({ text: t })));
    const p = applyCorrection(p0, r.correction, { asked: r.asked });
    const bad = Object.entries(r.expect).filter(([f, w]) => !matches(p, f, w)).map(([f]) => f);
    if (p.confirmed !== r.confirmed) bad.push("confirmed");
    if (r.minor !== undefined && p.minor !== r.minor) bad.push("minor");
    if (!bad.length) cOk++; else cMiss.push(`${bad.join(",")} ${JSON.stringify(r.correction)}`);
    for (const f of ["gender", "seeks"]) if (f in r.expect && valueOf(p, f) !== undefined && !matches(p, f, r.expect[f])) cWrongGS.push(`${f} ${JSON.stringify(r.correction)} -> ${JSON.stringify(valueOf(p, f))}`);
    rbProblems.push(...readBackProblems(p, [...r.messages, r.correction]));
  }
  gate(`${label}corrections and confirmations: >= 95% (n ${corr.length})`, corr.length >= 40 && cOk / corr.length >= 0.95, `${pct(cOk / corr.length)}${cMiss.length ? `; misses: ${cMiss.slice(0, 5).join(" | ")}` : ""}`);
  gate(`${label}corrections: 0 wrong gender or seeking`, cWrongGS.length === 0, cWrongGS.slice(0, 5).join(" | "));

  // Soft fields.
  const soft = await jsonl<Row>("soft.jsonl");
  let sOk = 0, sN = 0;
  const sMiss: string[] = [];
  for (const r of soft) {
    const p = await extract([{ text: r.text!, asked: r.asked }]);
    for (const [f, w] of Object.entries(r.expect ?? {})) { sN++; if (matches(p, f, w)) sOk++; else sMiss.push(`${f} ${JSON.stringify(r.text)} -> ${JSON.stringify(valueOf(p, f))}`); }
    for (const f of r.unset ?? []) { sN++; if (!isSet(p, f)) sOk++; else sMiss.push(`unset ${f} ${JSON.stringify(r.text)}`); }
    rbProblems.push(...readBackProblems(p, [r.text!]));
  }
  gate(`${label}soft fields: accuracy >= 90% (n ${soft.length} rows, ${sN} fields)`, soft.length >= 60 && sOk / sN >= 0.9, `${pct(sOk / sN)} (${sOk}/${sN})${sMiss.length && sOk / sN < 0.9 ? `; misses: ${sMiss.slice(0, 6).join(" | ")}` : ""}`);

  gate(`${label}read-back: 0 sensitive or unstated facts over every corpus row`, rbProblems.length === 0, rbProblems.slice(0, 5).join(" | "));
  const total = (await jsonl<Row>("hard.jsonl")).length + (await jsonl<Row>("hard-heldout.jsonl")).length + amb.length + ages.length + corr.length + soft.length;
  if (!label) b.track(`corpus size: ${total} rows (target 300+)`, total >= 300, `hard ${(await jsonl<Row>("hard.jsonl")).length} + held-out ${(await jsonl<Row>("hard-heldout.jsonl")).length}, ambiguous ${amb.length}, ages ${ages.length}, corrections ${corr.length}, soft ${soft.length}`);
}

// ---- persona speech -------------------------------------------------------------------------------
// Templates and a paraphrase bank. Persona answers come from the persona's STATED side (what they
// would tell the agent; the slop world's truth for onboarding), never from the Network's guesses.
type G = "woman" | "man" | "nonbinary";
const SELF: Record<G, string[]> = {
  woman: ["woman", "i'm a woman", "im a girl", "female", "girl", "woman here", "i'm a woman lol"],
  man: ["man", "guy", "i'm a guy", "im a man", "dude", "male", "guy here"],
  nonbinary: ["nonbinary", "i'm nonbinary", "enby", "nb", "im non-binary"],
};
const TRANS: Record<string, string[]> = { trans_woman: ["trans woman", "i'm a trans woman"], trans_man: ["trans man", "i'm a trans guy"], genderqueer: ["genderqueer", "i'm genderqueer"], agender: ["agender", "i'm agender"] };
const PLUR: Record<G, string[]> = { woman: ["women", "girls", "ladies", "women"], man: ["men", "guys", "dudes", "men"], nonbinary: ["nonbinary people", "nb folks", "enbies", "nonbinary folks"] };
const ANY = ["anyone", "everyone", "all genders", "anyone really", "whoever honestly", "men, women and nonbinary people"];
const NON_ANSWERS = ["idk", "hmm", "lol why", "can we skip this one", "what do you mean", "ok", "sure", "haha", "wait what"];
const DB_SAY: Record<string, string[]> = {
  smoker: ["no smokers", "smoking is a dealbreaker", "not into smokers", "can't date smokers"], heavy_drinker: ["no heavy drinkers"], has_kids: ["not dating people with kids", "no single parents"],
  wants_kids: ["if you want kids we're not a match"], no_kids_ever: ["must want kids"], religious: ["not into very religious people"], nonreligious: ["need someone who shares my faith"],
  right_politics: ["no trump supporters", "no maga", "won't date conservatives"], left_politics: ["no liberals"],
};
const GOAL_SAY: Record<string, string[]> = { long_term: ["something serious", "long term", "a relationship", "ltr"], casual: ["something casual", "nothing serious", "casual for now"], unsure: ["not sure yet", "see where it goes", "open to either"] };
const INTEREST_SAY: Record<string, string> = { climbing: "climbing", running: "running", hiking: "hiking", cycling: "biking", sailing: "sailing", tennis: "tennis", pickleball: "pickleball", basketball: "basketball", rock_music: "punk", jazz: "jazz", electronic_music: "techno", live_music: "concerts", film: "movies", ceramics: "pottery", painting: "painting", photography: "photography", theater: "theater", books: "reading", philosophy: "philosophy", ai: "AI", climate_tech: "climate tech", startups: "startups", crypto: "crypto", hardware: "arduino stuff", cooking: "cooking", wine: "natural wine", coffee: "specialty coffee", board_games: "board games", chess: "chess", volunteering: "volunteering", urbanism: "urban planning", parenting: "parenting", dogs: "my dog", meditation: "meditation", yoga: "yoga", dancing: "dancing", writing: "writing", gardening: "gardening" };
const ACT_SAY: Record<string, string> = { coffee: "coffee", drinks: "drinks", dinner: "dinner", walk: "a walk", museum: "a museum", live_music: "live music", comedy: "a comedy show", climbing: "climbing gym", hike: "a hike", cooking_class: "a cooking class" };
const DAY_SAY: Record<string, string> = { mon_eve: "monday nights", tue_eve: "tuesday nights", wed_eve: "wednesday nights", thu_eve: "thursday nights", fri_eve: "friday nights", sat_day: "saturday afternoons", sat_eve: "saturday nights", sun_day: "sunday afternoons", sun_eve: "sunday nights" };
const MARKET_SAY: Record<string, string[]> = { nyc: ["nyc", "new york"], sf: ["sf", "the bay"], la: ["la", "los angeles"] };

const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

class Speaker {
  constructor(private p: SlopPersona, private r: Rng) {}
  private S() { return this.p.stated; }
  /** Noise: case, slang, emoji, a typo now and then. */
  noisy(s: string): string {
    let t = s;
    if (this.r.bool(0.06)) { const w = t.split(" "); const i = this.r.int(0, w.length - 1); if (w[i]!.length > 4) { const k = this.r.int(1, w[i]!.length - 2); w[i] = w[i]!.slice(0, k) + w[i]!.slice(k + 1); } t = w.join(" "); }
    if (this.r.bool(0.12)) t += this.r.pick([" lol", " tbh", " haha", " !!", " ig"]);
    if (this.r.bool(0.12)) t += this.r.pick([" 😊", " 🙂", " ✨", " 😅", " 👍"]);
    return this.r.bool(0.3) ? t[0]!.toUpperCase() + t.slice(1) : t;
  }
  age() { const a = this.S().claimedAge; return this.r.pick([`${a}`, `im ${a}`, `i'm ${a}`, `${a} lol`, `${a} years old`]); }
  self(): string {
    const id = this.S().identity;
    return TRANS[id] && this.r.bool(0.5) ? this.r.pick(TRANS[id]!) : this.r.pick(SELF[this.S().matchGender]);
  }
  seeks(): string {
    const s = this.S().seeks as G[];
    if (s.length === 3) return this.r.pick(ANY);
    return join(s.map(g => this.r.pick(PLUR[g])));
  }
  /** A label alone, as people often answer ("i'm bi", "straight guy"): may be ambiguous; the read-back catches it. */
  label(): string | undefined {
    const o = this.S().orientation, g = this.S().matchGender;
    if (o === "straight") return this.r.pick([`straight ${g === "woman" ? "woman" : "guy"}`, `im a straight ${g === "woman" ? "girl" : "guy"}`]);
    if (o === "gay" && g === "man") return this.r.pick(["gay man", "gay guy here"]);
    if (o === "lesbian" && g === "woman") return this.r.pick(["lesbian woman", "im a lesbian woman"]);
    if (o === "bisexual") return this.r.pick(["i'm bi", "bi", "bisexual"]);
    if (o === "queer" || o === "pansexual") return this.r.pick([`im ${o}`, o]);
    return undefined;
  }
  orientation(): string {
    const l = this.label();
    if (l && this.r.bool(0.25)) return l;
    return this.r.pick([`${this.self()}, into ${this.seeks()}`, `${this.self()} looking for ${this.seeks()}`, `${this.self()}. i date ${this.seeks()}`]);
  }
  range() {
    const [lo, hi] = this.S().ageRange;
    if (lo % 10 === 0 && hi === lo + 9 && this.r.bool(0.5)) return `${lo}s`;
    return this.r.pick([`${lo}-${hi}`, `${lo} to ${hi}`, `between ${lo} and ${hi}`, `${lo}-${hi} ish`, `like ${lo} to ${hi}?`]);
  }
  distance() {
    const sc = this.S().scope;
    if (sc.mode === "radius") return this.r.pick([`${sc.miles} miles`, `within ${sc.miles} mi`, `${sc.miles}`, `${sc.miles}mi`, `like ${sc.miles} miles?`, `${sc.miles} max`]);
    if (sc.mode === "city") return this.r.pick(["just the city", "anywhere in the city", "the whole city", "city is fine", "anywhere in the city is fine"]);
    return `${sc.cities.map(c => this.r.pick(MARKET_SAY[c]!)).join(" and ")}, i split my time`;
  }
  location() {
    const zip = this.S().homeZip, area = zipInfo.get(zip)?.area.split(/\s*[\/,]\s*/)[0]?.trim();
    if (area && this.r.bool(0.45)) return this.r.pick([`${area.toLowerCase()}`, `i'm in ${area}`, `live in ${area.toLowerCase()}`]);
    return this.r.pick([zip, `zip is ${zip}`, `${zip}`]);
  }
  basics() {
    const S = this.S(), parts: string[] = [this.r.pick(GOAL_SAY[S.goal]!)];
    if (S.dealbreakers.length) parts.push(...S.dealbreakers.slice(0, 3).map(d => this.r.pick(DB_SAY[d]!)));
    else parts.push(this.r.pick(["no real dealbreakers", "no dealbreakers really"]));
    return parts.join(", ");
  }
  interests() { return join(this.r.sample(this.S().interests, Math.min(3, this.S().interests.length)).map(t => INTEREST_SAY[t] ?? t.replace(/_/g, " "))); }
  activities() { return `${join(this.r.sample(this.S().activities, Math.min(2, this.S().activities.length)).map(a => ACT_SAY[a]!))}${this.r.bool(0.4) ? " for a first date" : ""}`; }
  free() { const f = this.S().usuallyFree; return f.length ? `usually free ${join(f.slice(0, 3).map(s => DAY_SAY[s]!))}` : "honestly anytime"; }
  /** The opening text when they join, richer for richer personas. */
  opening(): string {
    const tier = this.p.hidden.richness;
    const k = tier === "minimal" ? 0 : tier === "light" ? 1 : tier === "medium" ? 2 : tier === "rich" ? 4 : 6;
    const S = this.S();
    const bits: string[] = [];
    const sc = S.scope;
    const pool = [
      () => `${this.self()}, ${S.claimedAge}`, () => `looking for ${this.seeks()}`, () => `${this.range()}`,
      () => (sc.mode === "radius" ? `within ${sc.miles} miles of ${S.homeZip}` : `${this.distance()}, i'm in ${S.homeZip}`), () => `into ${this.interests()}`, () => this.basics(),
    ];
    for (let i = 0; i < k && i < pool.length; i++) bits.push(pool[i]!());
    return bits.length ? this.noisy(`hey! ${bits.join(", ")}`) : this.r.pick(["slop", "hi", "hey i saw slop.date", "slop.date"]);
  }
  answer(f: OnboardField): string {
    if (this.r.bool(0.07)) return this.r.pick(NON_ANSWERS);
    const say: Record<string, () => string> = {
      age: () => this.age(), orientation: () => this.orientation(), seeks: () => this.seeks(), gender: () => this.self(), ageRange: () => this.range(),
      distance: () => this.distance(), location: () => this.location(), dealbreakers: () => this.basics(), goal: () => this.r.pick(GOAL_SAY[this.S().goal]!),
      interests: () => this.interests(), activities: () => this.activities(), free: () => this.free(),
    };
    return this.noisy((say[f] ?? (() => "ok"))());
  }
  /** The reply to a read-back: the first wrong hard field corrected, else a yes. */
  confirm(p: SlopOnboarding): string {
    const w = wrongHard(this.p, p);
    if (!w.length) return this.r.pick(["yep", "yes!", "that's right", "perfect", "yup 👍", "correct"]);
    const S = this.S();
    switch (w[0]) {
      case "gender": return `no, ${this.self()}`;
      case "seeks": { const miss = (S.seeks as G[]).filter(g => !p.seeks?.value.includes(g)); return miss.length && (p.seeks?.value ?? []).every(g => S.seeks.includes(g)) ? `actually ${join(miss.map(g => PLUR[g][0]!))} too` : `no, ${S.seeks.length === 3 ? "anyone" : join((S.seeks as G[]).map(g => PLUR[g][0]!))}`; }
      case "ageRange": return `no, ${S.ageRange[0]}-${S.ageRange[1]}`;
      case "distance": return `no, ${this.distance()}`;
      default: return `no, my zip is ${S.homeZip}`;
    }
  }
}

/** Hard fields set to a value that differs from the persona's stated truth. */
function wrongHard(per: SlopPersona, p: SlopOnboarding): string[] {
  const S = per.stated, out: string[] = [];
  if (p.gender && p.gender.value !== S.matchGender) out.push("gender");
  if (p.seeks && !same([...p.seeks.value].sort(), [...S.seeks].sort())) out.push("seeks");
  if (p.ageRange && !same(p.ageRange.value, S.ageRange)) out.push("ageRange");
  if (p.distance) {
    const d = p.distance.value, sc = S.scope;
    const ok = sc.mode === "radius" ? d.mode === "radius" && d.miles === sc.miles : sc.mode === "city" ? d.mode === "city" : d.mode === "multi" && same([...d.markets].sort(), [...sc.cities].sort());
    if (!ok) out.push("distance");
  }
  if (p.location?.value.known) {
    const home = zipInfo.get(S.homeZip);
    const ok = p.location.value.zip === S.homeZip || (!!p.location.value.area && !!home && home.area.split(/\s*[\/,]\s*/).some(a => a.toLowerCase() === p.location!.value.area!.toLowerCase()));
    if (!ok) out.push("location");
  }
  return out;
}

// ---- the onboarding loop ----------------------------------------------------------------------------
interface ConvResult { filledAt24: number; fields: string[]; filledAfter: Record<number, number>; wrongBefore: string[]; wrongAfter: string[]; confirmed: boolean; minor: boolean; matchable: boolean; ageKnown: boolean; leaks: string[]; messages: number }
const N_CHECKPOINTS = [1, 3, 5, 8];

async function converse(per: SlopPersona, seed: number, read: (text: string, asked: OnboardField | undefined, p: SlopOnboarding) => Promise<SlopOnboarding>): Promise<ConvResult> {
  const r = new Rng(seed).fork("onboard", per.id);
  const sp = new Speaker(per, r.fork("speech"));
  const market = per.hidden.homeCity;
  let p: SlopOnboarding | undefined;
  let t = 0, member = 0, readbacks = 0, wrongBefore: string[] = [];
  const filledAfter: Record<number, number> = {};
  const msgs: string[] = [];
  let awaiting: { field?: OnboardField; readBack?: boolean; at: number; reasked: boolean; reason?: string } | undefined;
  let leaks: string[] = [];
  const say = async (text: string, asked: OnboardField | undefined, isReadBack: boolean) => {
    msgs.push(text);
    member++;
    p = isReadBack ? applyCorrection(p!, text, { market }) : await read(text, asked, p ?? extractSlopProfile([], undefined));
    for (const n of N_CHECKPOINTS) if (member === n) filledAfter[n] = HARD_FIELDS.filter(f => hasField(p!, f)).length / HARD_FIELDS.length;
  };
  await say(sp.opening(), undefined, false);
  void market;
  // The agent replies at once to a member message; a question left unanswered is re-asked once after 6 hours.
  for (let guard = 0; guard < 40 && t < 24 * HOUR; guard++) {
    if (!awaiting) {
      if (p!.declined || p!.minor) break;
      if (hardComplete(p!) && !p!.confirmed && readbacks < 3) {
        const rb = readBack(p!);
        if (!rb) break;
        leaks.push(...readBackProblems(p!, msgs));
        if (!readbacks) wrongBefore = wrongHard(per, p!);
        readbacks++;
        awaiting = { readBack: true, at: t, reasked: true };
      } else {
        const q = nextQuestion(p!);
        if (!q) break;
        p = markAsked(p!, q.reason);
        awaiting = { field: q.field, at: t, reasked: false, reason: q.reason };
      }
    }
    // Does the member answer, and when?
    const replies = r.bool(per.hidden.replyProb);
    const latency = Math.min(30 * HOUR, r.logNormal(per.hidden.latencyMedianMin, 1) * 60_000);
    if (replies && awaiting.at + latency < 24 * HOUR) {
      t = Math.max(t, awaiting.at + latency);
      const isRb = !!awaiting.readBack;
      await say(isRb ? sp.confirm(p!) : sp.answer(awaiting.field!), awaiting.field, isRb);
      awaiting = undefined;
    } else if (!awaiting.reasked && awaiting.at + 6 * HOUR < 24 * HOUR) {
      awaiting = { ...awaiting, at: awaiting.at + 6 * HOUR, reasked: true };
      if (awaiting.reason) p = markAsked(p!, awaiting.reason);
    } else break;
  }
  const fin = p!;
  for (const n of N_CHECKPOINTS) filledAfter[n] ??= HARD_FIELDS.filter(f => hasField(fin, f)).length / HARD_FIELDS.length;
  leaks = [...new Set(leaks)];
  return {
    filledAt24: HARD_FIELDS.filter(f => hasField(fin, f)).length / HARD_FIELDS.length, fields: HARD_FIELDS.filter(f => hasField(fin, f)), filledAfter, wrongBefore,
    wrongAfter: fin.confirmed ? wrongHard(per, fin) : [], confirmed: fin.confirmed, minor: fin.minor, matchable: fin.matchable,
    ageKnown: !!fin.age || fin.minor, leaks, messages: member,
  };
}

async function simGates(b: Block, o: { quick: boolean }, read: (text: string, asked: OnboardField | undefined, p: SlopOnboarding, market: string) => Promise<SlopOnboarding>, label = "", perCity?: number, blocking = true): Promise<void> {
  const gate = (name: string, pass: boolean, detail?: string) => (blocking ? b.gate(name, pass, detail) : b.track(name, pass, detail));
  const seeds = o.quick ? [13] : [13, 14];
  const rows: { per: SlopPersona; res: ConvResult }[] = [];
  for (const seed of seeds) {
    const personas = generateSlopPersonas({ seed, perCity: perCity ?? (o.quick ? 40 : 100), minorShare: 0.06 });
    for (const per of personas) rows.push({ per, res: await converse(per, seed, (text, asked, p) => read(text, asked, p, per.hidden.homeCity)) });
  }
  const adults = rows.filter(x => x.per.stated.claimedAge >= 18), minors = rows.filter(x => x.per.stated.claimedAge < 18);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const fill = mean(adults.map(x => x.res.filledAt24)), full = adults.filter(x => x.res.filledAt24 === 1).length / adults.length;
  b.track(`${label}P4: hard fields filled within 24 h >= 80% (${adults.length} adult personas, seeds ${seeds.join(",")})`, fill >= 0.8, `${pct(fill)} of fields; ${pct(full)} of personas fully filled; after N member messages: ${N_CHECKPOINTS.map(n => `${n}: ${pct(mean(adults.map(x => x.res.filledAfter[n]!)))}`).join(", ")}; median messages ${[...adults.map(x => x.res.messages)].sort((a, b) => a - b)[adults.length >> 1]}`);
  b.track(`${label}hard fields filled within 24 h, by field`, true, HARD_FIELDS.map(f => `${f} ${pct(adults.filter(x => x.res.fields.includes(f)).length / adults.length)}`).join(", "));
  const wrongB = adults.flatMap(x => x.res.wrongBefore), wrongA = adults.flatMap(x => x.res.wrongAfter);
  const count = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((m, f) => ((m[f] = (m[f] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  b.track(`${label}wrong hard values at the first read-back (caught by the read-back)`, true, count(wrongB));
  gate(`${label}0 wrong gender or seeking after the member confirms`, !wrongA.some(f => f === "gender" || f === "seeks"), count(wrongA));
  b.track(`${label}confirmed within 24 h`, true, pct(adults.filter(x => x.res.confirmed).length / adults.length));
  // A minor who never said an age is not flagged, but an unknown age is never matchable either (fail closed).
  const said = minors.filter(x => x.res.ageKnown);
  gate(`${label}minors (stated age < 18): every one who said an age flagged, none matchable (n ${minors.length}, said ${said.length})`, said.length > 0 && said.every(x => x.res.minor) && minors.every(x => !x.res.matchable), `${minors.filter(x => x.res.minor).length}/${minors.length} flagged; ${minors.filter(x => x.res.matchable).length} matchable`);
  const leaks = rows.flatMap(x => x.res.leaks);
  gate(`${label}read-backs: 0 sensitive or unstated facts`, leaks.length === 0, leaks.slice(0, 3).join(" | "));
}

/** The LLM merge rules with a scripted reader (no model): off unless enabled, quotes required, never overrides, age only lowers. */
async function llmMergeGate(b: Block): Promise<void> {
  const scripted = (reply: object) => llmSlopReader({ chat: async () => JSON.stringify(reply) });
  await b.run("LLM hook (scripted reader, no model): flag-gated, quoted, fills only gaps, age only marks a minor", async () => {
    const run = (text: string, reply: object, enabled = true) => extractSlopProfileLLM([text], undefined, { llm: { enabled, reader: scripted(reply) } });
    const filled = await run("into fellas mostly", { seeks: { value: ["man"], quote: "into fellas" } });
    if (!same(filled.seeks?.value, ["man"]) || filled.seeks?.source !== "llm" || filled.seeks.evidence.text !== "into fellas") throw new Error(`fill: ${JSON.stringify(filled.seeks)}`);
    if ((await run("into fellas mostly", { seeks: { value: ["man"], quote: "into fellas" } }, false)).seeks) throw new Error("ran with the flag off");
    if ((await run("into fellas mostly", { seeks: { value: ["woman"], quote: "i love women" } })).seeks) throw new Error("accepted a quote not in the message");
    const kept = await run("im a woman into men", { seeks: { value: ["woman"], quote: "im a woman" }, gender: { value: "man", quote: "im a woman" } });
    if (!same(kept.seeks?.value, ["man"]) || kept.gender?.value !== "woman") throw new Error("overrode a confident rules value");
    const teen = await run("sophomore year lol", { selfAge: { value: 15, quote: "sophomore year" } });
    if (!teen.minor || teen.declined) throw new Error("an LLM age must mark a minor and never decline");
    if ((await run("im 30 lol", { selfAge: { value: 45, quote: "im 30" } })).age?.value !== 30) throw new Error("an LLM age raised the age");
  });
}

export async function onboardBlock(b: Block, o: { quick: boolean; llm?: boolean }): Promise<void> {
  await corpusGates(b, async msgs => extractSlopProfile(msgs));
  await llmMergeGate(b);
  await simGates(b, o, async (text, asked, p, market) => extractSlopProfile([{ text, asked }], p, { market: market as "nyc" }));
  if (!o.llm) return;
  if (!endpointsFor("surplus").length && !endpointsFor("openai").length) { b.track("LLM arm: skipped (no provider key)", false); return; }
  const reader: SlopReader = llmSlopReader(defaultLLM());
  const llmOpts = { llm: { enabled: true, reader } };
  await corpusGates(b, async msgs => extractSlopProfileLLM(msgs, undefined, llmOpts), "LLM arm: ", false);
  await simGates(b, { quick: true }, async (text, asked, p, market) => extractSlopProfileLLM([{ text, asked }], p, { ...llmOpts, market: market as "nyc" }), "LLM arm: ", 20, false);
}
