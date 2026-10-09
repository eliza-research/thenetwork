// slop.date's offline readers of a member's own words: who they are and who they seek, the age range,
// how far they would go, their zip, and the basics (what they are looking for, dealbreakers). The
// eval corpora in evals/slop/ score every one of them (scripts/sim/evals.ts, a blocking gate).
// Nothing is guessed: unknown stays unknown. Orientation is read only from what the member says,
// never inferred from anything else (PRD 40.5).
//
// Age words map to years of the decade: early = 0-3, mid = 4-6, late = 7-9 (the same bands as the
// pack's ageBand). A range's low end takes the band's first year, its high end the band's last:
// "late 20s to mid 30s" -> [27, 36]; "30s" -> [30, 39]; "early to mid 30s" -> [30, 36].
// "around 30" is 30 +- 3; "my age" is the member's stated age +- 3. Nothing goes under 18.
//
// Distances: "5 miles", "8 km" (rounded to miles), "walking distance" or "my neighborhood" (2 miles,
// the pack's minimum), "same borough" (5 miles), "just the city" (the whole city). A bare number is
// miles only when it answers the distance question.

export const GENDERS = ["man", "nonbinary", "woman"] as const;
export type Gender = (typeof GENDERS)[number];

/** Lower case, curly quotes made straight, punctuation as spaces, dashes kept; padded with spaces. */
export const words = (s: string) =>
  ` ${s.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\p{L}\p{N}' -]+/gu, " ").replace(/\s+/g, " ")} `;

const WOMAN = "women|woman|girls|girl|females|female|ladies|lady|gals|gal";
const MAN = "men|man|guys|guy|males|male|dudes|dude|boys|boy";
const NB = "nonbinary|nb|enbies|enby|genderqueer";
const SINGULAR = "woman|girl|female|lady|gal|man|guy|male|dude|nonbinary|nb|enby|genderqueer";
const ALL_WORDS = "everyone|everybody|anyone|anybody|all genders|any gender|all of them|all three|all of the above";
/** "both" or "either" as an answer ("both", "either is fine"), never "both hiking and music". */
const PAIR_WORDS = `(?:both|either)(?=\\s(?:$|\\d|${WOMAN}|${MAN}|genders|sexes|is |are |works|really|honestly|tbh|i guess|equally|ways|i think|please|i'm|im))`;
const GROUP = `(?:${WOMAN}|${MAN}|${NB}|nonbinary people|nonbinary folks|${ALL_WORDS}|${PAIR_WORDS})`;
/** A list of gender words: "women", "men and nonbinary people", "only women", "trans women or guys". "only" starts a new list. */
const LIST = `((?:(?:a|an|only|just|mostly|mainly|other|cis|trans|some|single|straight|queer|gay|bi)\\s+)*${GROUP}(?:\\s+(?:people|folks|ones))?(?:\\s*(?:,|and|or|&|plus|\\/)\\s*(?:(?:a|an|other|cis|trans|some)\\s+)*${GROUP}(?:\\s+(?:people|folks|ones))?)*)`;
const VERB = "looking for|look for|looking to meet|looking to date|into|seeking|seek|interested in|date|dating|dates|dated|meet|meeting|like|likes|liking|prefer|prefers|want|wants|attracted to|open to|go for|fancy|love|loves";
/** "not", "don't", "never", "no longer", with at most one word between it and the verb ("not really into"). */
const NEG = "(?:not|never|don't|dont|do not|doesn't|doesnt|won't|wont|can't|cant|no longer|isn't|aren't)(?: (?:really|usually|ever|much|at all|so|interested|that))?";

/** "woman", "a guy", "enbies" ... -> the pack's gender id. */
export function genderOf(w: string): Gender | undefined {
  if (new RegExp(`^(?:${WOMAN})$`).test(w)) return "woman";
  if (new RegExp(`^(?:${MAN})$`).test(w)) return "man";
  if (new RegExp(`^(?:${NB})$`).test(w)) return "nonbinary";
  return undefined;
}

/** The genders a list names ("men and nonbinary people" -> man, nonbinary; "both" -> man, woman; "anyone" -> all three). */
function listGenders(list: string, specific = false): Set<Gender> {
  const out = new Set<Gender>();
  // A negation names genders, never "anyone" ("not into anyone who smokes" says nothing about gender).
  if (!specific && new RegExp(`\\b(?:${ALL_WORDS})\\b`).test(list)) GENDERS.forEach(g => out.add(g));
  if (!specific && /\b(?:both|either)\b/.test(list)) { out.add("man"); out.add("woman"); }
  for (const w of list.split(/[\s,&/]+/)) { const g = genderOf(w); if (g) out.add(g); }
  return out;
}

const LABELS = "straight|heterosexual|hetero|gay|homosexual|lesbian|bisexual|bi|pansexual|pan|queer";
const LABEL = new RegExp(`(?<![\\w'-])(${LABELS})(?![\\w'-])`);

/**
 * Who the member is and who they seek, from their words. "I'm a woman looking for men" gives both;
 * a label ("straight woman", "gay man", "lesbian", "bi", "queer") gives the seeking set; "anyone",
 * "everyone" or "a mix" seeks all three. Negations remove: "not into men", "no women please",
 * "anyone but men". "X only" / "only X" keeps just X. `bare`: the message answers "who would you like
 * to meet?", so a plain plural ("women", "men mostly") names who they seek.
 */
export function parseOrientation(text: string, bare = false): { is?: Gender; seeks?: Gender[] } {
  let t = words(text).replace(/\bnon[- ]binary\b/g, "nonbinary").replace(/\bthey them\b/g, " ");
  const out: { is?: Gender; seeks?: Gender[] } = {};
  // Who they are: "I'm a (straight) woman", "as a guy", "woman here", a bare "gay man, 31", "29f", "m4w".
  const selfRe = new RegExp(`\\b(?:i'm|im|i am|as|me|i identify as|identify as)\\s+(?:a |an )?(?:(?:${LABELS})\\s+)?(?:(?:trans|cis)\\s+)?(${SINGULAR})\\b`);
  const self = selfRe.exec(t)
    ?? new RegExp(`^ (?:(?:straight|gay|lesbian|bi|bisexual|pan|pansexual|queer|trans|cis)\\s+)*(${SINGULAR})\\b(?! (?:only|please|people|folks|ones))`).exec(t)
    ?? new RegExp(`\\b(${SINGULAR}) here\\b`).exec(t);
  if (self) out.is = genderOf(self[1]!);
  const short = /\b(?:\d{2}\s?)?([mfw])\s?4\s?([mfwa])\b/.exec(t) ?? /\b(?:1[89]|[2-9]\d)\s?([mf])\b/.exec(t);
  const letter = (c: string): Gender | undefined => (c === "m" ? "man" : c === "f" || c === "w" ? "woman" : undefined);
  if (!out.is && short) out.is = letter(short[1]!);
  // The self phrase is not a statement about who they seek.
  if (self) t = t.slice(0, self.index) + " ".repeat(self[0].length) + t.slice(self.index + self[0].length);

  const pos = new Set<Gender>(), neg = new Set<Gender>();
  let only: Set<Gender> | undefined;
  if (short?.[2]) { const g = short[2] === "a" ? undefined : letter(short[2]); if (g) pos.add(g); else if (short[2] === "a") GENDERS.forEach(x => pos.add(x)); }
  // Spans already read (so a bare scan does not read them twice).
  const used: [number, number][] = [];
  const mark = (m: RegExpMatchArray) => used.push([m.index!, m.index! + m[0].length]);

  // "anyone but men", "everyone except guys": all three, minus the named ones.
  for (const m of t.matchAll(new RegExp(`\\b(?:${ALL_WORDS}) (?:but|except|other than|besides) ${LIST}`, "g"))) {
    GENDERS.forEach(g => pos.add(g)); listGenders(m[1]!).forEach(g => neg.add(g)); mark(m);
  }
  // "not into men", "don't date women", "never dated guys": the named ones are out.
  for (const m of t.matchAll(new RegExp(`\\b${NEG} (?:${VERB}) ${LIST}`, "g"))) { listGenders(m[1]!, true).forEach(g => neg.add(g)); mark(m); }
  // "no women (please)", "not men", "men are a no", "no guys at all".
  for (const m of t.matchAll(new RegExp(`\\b(?:no|not|never|nothing with|zero) ${LIST}`, "g"))) {
    if (used.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    listGenders(m[1]!, true).forEach(g => neg.add(g)); mark(m);
  }
  for (const m of t.matchAll(new RegExp(`${LIST} (?:are|is) (?:a no|a hard no|not for me|not my thing|off the table)`, "g"))) { listGenders(m[1]!, true).forEach(g => neg.add(g)); mark(m); }
  // "only women", "just men", "women only", "strictly guys": just these.
  for (const re of [`\\b(?:only|just|strictly|exclusively) ${LIST}`, `${LIST} only\\b`]) {
    for (const m of t.matchAll(new RegExp(re, "g"))) {
      if (used.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
      const g = listGenders(m[1]!);
      only = new Set([...(only ?? []), ...g]); g.forEach(x => pos.add(x)); mark(m);
    }
  }
  // "looking for women", "into men and nonbinary people", "a man who likes men".
  for (const m of t.matchAll(new RegExp(`\\b(?:${VERB}) ${LIST}`, "g"))) {
    if (used.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    listGenders(m[1]!).forEach(g => pos.add(g)); mark(m);
  }
  if (/\b(?:a mix|open to (?:everyone|anyone|all)|doesn't matter|doesnt matter|don't mind|dont mind|gender doesn't matter|any of them)\b/.test(t) && (bare || /\bgender\b/.test(t))) GENDERS.forEach(g => pos.add(g));
  // A bare answer to "who would you like to meet?": plural words name who they seek ("women", "men mostly", "anyone").
  if (bare && !pos.size) {
    const rest = used.reduce((s, [a, b]) => s.slice(0, a) + " ".repeat(b - a) + s.slice(b), t);
    for (const m of rest.matchAll(new RegExp(`\\b(women|girls|ladies|gals|men|guys|dudes|boys|enbies|nonbinary people|nonbinary folks|${ALL_WORDS}|${PAIR_WORDS})\\b`, "g"))) {
      listGenders(m[1]!).forEach(g => pos.add(g));
    }
  }
  // A label they used about themselves (never a negated one: "not straight").
  const label = (() => { const m = LABEL.exec(t.replace(/\bnot (?:\S+ )?(?:straight|gay|lesbian|bi|bisexual|pan|queer)\b/g, " ")); return m?.[1]; })()
    ?? (self ? new RegExp(`\\b(straight|gay|lesbian|bisexual|bi|pansexual|pan|queer)\\s+(?:(?:trans|cis)\\s+)?(?:${SINGULAR})\\b`).exec(words(text))?.[1] : undefined);
  if (label === "lesbian") out.is ??= "woman";
  if (!pos.size && label) {
    if ((label === "straight" || label === "heterosexual" || label === "hetero") && out.is && out.is !== "nonbinary") pos.add(out.is === "woman" ? "man" : "woman");
    else if ((label === "gay" || label === "homosexual") && out.is && out.is !== "nonbinary") pos.add(out.is);
    else if (label === "lesbian") pos.add("woman");
    else if (label === "bi" || label === "bisexual") { pos.add("man"); pos.add("woman"); }
    else if (label === "pan" || label === "pansexual" || label === "queer") GENDERS.forEach(g => pos.add(g));
  }
  // Only a negation ("no men") with nothing positive: nothing is guessed.
  const seeks = [...(only ?? pos)].filter(g => !neg.has(g));
  if (seeks.length) out.seeks = seeks.sort();
  return out;
}

// ---------------------------------------------------------------------------------------- ages
const DECADE = "(?:(early|mid|late)[- ]?(?:to[- ](early|mid|late)[- ]?)?)?(\\d)0 ?'?s\\b";
const DECADE_WORDS: Record<string, string> = { twenties: "20s", thirties: "30s", forties: "40s", fifties: "50s", sixties: "60s", seventies: "70s" };
const band = (b: string | undefined, d: number, end: "lo" | "hi") =>
  d + (end === "lo" ? (b === "mid" ? 4 : b === "late" ? 7 : 0) : (b === "early" ? 3 : b === "mid" ? 6 : 9));

function clampRange(lo: number, hi: number): [number, number] | undefined {
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi < 18 || lo > 99) return undefined;
  return [Math.max(18, lo), Math.min(99, hi)];
}

/**
 * The age range a member wants: "25-35", "25 to 35", "between 25 and 35", "late 20s to mid 30s".
 * `bare` (the message answers the age question) also reads one decade ("30s", "mid 30s"), "around 30",
 * "30+", "under 40" and "my age" (with `statedAge`). Never under 18; undefined when the words do not say.
 */
export function parseAgeRange(text: string, bare: boolean, statedAge?: number): [number, number] | undefined {
  const raw = text.replace(/(\d)\s*\+/g, "$1 plus").replace(/~\s*(\d)/g, "around $1");
  const t = words(raw).replace(/\b(twenties|thirties|forties|fifties|sixties|seventies)\b/g, w => DECADE_WORDS[w]!).replace(/(\d) ?(?:yo|y o|years old|year olds|yrs|years)\b/g, "$1");
  // Decade to decade: "late 20s to mid 30s", "20s-30s", "between late 20s and early 30s".
  const dd = new RegExp(`\\b${DECADE}\\s*(?:-|to|and|through|thru|or)\\s*${DECADE}`).exec(t);
  if (dd) return clampRange(band(dd[1], Number(dd[3]) * 10, "lo"), band(dd[5] ?? dd[4], Number(dd[6]) * 10, "hi"));
  // Number to decade or decade to number: "25 to early 30s", "late 20s to 35".
  const nd = new RegExp(`\\b(\\d{2})\\s*(?:-|to|and|through|thru)\\s*${DECADE}`).exec(t);
  if (nd) return clampRange(Number(nd[1]), band(nd[3] ?? nd[2], Number(nd[4]) * 10, "hi"));
  const dn = new RegExp(`\\b${DECADE}\\s*(?:-|to|and|through|thru)\\s*(\\d{2})\\b`).exec(t);
  if (dn) return clampRange(band(dn[1], Number(dn[3]) * 10, "lo"), Number(dn[4]));
  // Number to number: "25-35", "25 to 35", "between 25 and 35".
  const nn = /(?<![\d-])(\d{2})\s*(?:-|to|and|through|thru|or)\s*(\d{2})(?![\d-])/.exec(t);
  if (nn) {
    const lo = Number(nn[1]), hi = Number(nn[2]);
    if (bare || (lo >= 18 && hi >= 18)) return clampRange(lo, hi);
    return undefined;
  }
  if (!bare) return undefined;
  // "my age", "around my age", "close to my age".
  if (/\b(?:my (?:own )?age|same age|my age range|similar (?:in )?age)\b/.test(t)) {
    return statedAge !== undefined && statedAge >= 18 ? clampRange(statedAge - 3, statedAge + 3) : undefined;
  }
  // "around 30", "30ish", "about 30".
  const around = /\b(?:around|about|roughly|approximately|close to|near|circa) (\d{2})\b|\b(\d{2}) ?ish\b/.exec(t);
  if (around) { const n = Number(around[1] ?? around[2]); return clampRange(n - 3, n + 3); }
  // "30+", "30 and up", "over 30", "at least 30", "30 or older".
  const up = /\b(\d{2}) (?:plus|and up|and older|or older|and over)\b|\b(?:over|older than|at least|minimum|min) (\d{2})\b/.exec(t);
  if (up) { const n = Number(up[1] ?? up[2]); return clampRange(/\bover|older than\b/.test(up[0]) ? n + 1 : n, 99); }
  // "under 40", "up to 40", "40 or younger", "no older than 40".
  const down = /\b(?:under|younger than|up to|no older than|max|maximum|below) (\d{2})\b|\b(\d{2}) (?:or younger|and younger|and under|max)\b/.exec(t);
  if (down) { const n = Number(down[1] ?? down[2]); return clampRange(18, /\bunder|younger than|below\b/.test(down[0]) ? n - 1 : n); }
  // One decade: "30s", "mid 30s", "early to mid 30s"; never their own ("I'm in my late 20s").
  const d = new RegExp(`\\b${DECADE}`).exec(t);
  if (d && !/\b(?:i'm|im|i am) (?:in my|in their)\b/.test(t.slice(Math.max(0, d.index - 14), d.index + 1))) {
    const dec = Number(d[3]) * 10;
    return clampRange(band(d[1], dec, "lo"), band(d[2] ?? d[1], dec, "hi"));
  }
  return undefined;
}

// ----------------------------------------------------------------------------------- distance
const NUM_WORDS: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, "twenty five": 25, "twenty-five": 25, thirty: 30, forty: 40, fifty: 50, hundred: 100, "a hundred": 100, "one hundred": 100,
};
const NUM = `(\\d{1,3}(?:\\.\\d+)?|half an?|${Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
const numOf = (s: string) => (s.startsWith("half") ? 0.5 : NUM_WORDS[s] ?? Number(s));
/** The pack's smallest radius (PRD 40.5: minimum 2 miles) and its largest. */
const MIN_MILES = 2, MAX_MILES = 100;
const miles = (n: number) => Math.min(MAX_MILES, Math.max(MIN_MILES, Math.round(n)));

/**
 * How far they would go for a first date: "within 5 miles", "10mi", "8 km", "walking distance",
 * "same borough", "just the city". A bare number ("5") is miles only when `bare`. Miles are whole
 * numbers from 2 (the pack's minimum) to 100.
 */
export function parseDistance(text: string, bare: boolean): { miles?: number; city?: boolean } | undefined {
  const t = words(text);
  const mi = new RegExp(`\\b${NUM}[ -]?(?:mi|mile|miles|mile radius)\\b`).exec(t);
  if (mi) { const n = numOf(mi[1]!); return n > 0 && n <= 200 ? { miles: miles(n) } : undefined; }
  // "5k" alone is a race, not a distance: a bare k counts only with "radius", "away" or "max" after it.
  const km = new RegExp(`\\b${NUM}[ -]?(?:km|kms|kilometers|kilometres|kilometer|kilometre|k(?= (?:radius|away|max|or less|tops)))\\b`).exec(t);
  if (km) { const n = numOf(km[1]!); return n > 0 && n <= 300 ? { miles: miles(n * 0.621371) } : undefined; }
  if (/\b(walking distance|walkable|walk to|within walking|my neighborhood|same neighborhood|my neighbourhood|my area|close to home|very close|really close)\b/.test(t)) return { miles: MIN_MILES };
  if (/\b(same borough|my borough|in my borough|this borough|stay in (?:brooklyn|manhattan|queens|the bronx|bronx|staten island))\b/.test(t)) return { miles: 5 };
  if (/\b(just|only|anywhere in) (my|the) city\b|\b(the )?(whole|entire) city\b|\bcity( wide|wide)?\b|\ball (of )?(nyc|new york)\b|\banywhere in (nyc|new york|the five boroughs|the boroughs)\b|\ball (five|5) boroughs\b|\bany borough\b/.test(t)) return { city: true };
  if (bare) {
    const b = new RegExp(`^ (?:within |about |around |up to |maybe |like |max |)${NUM}(?: ?ish)?(?: or so| max| tops)? $`).exec(t);
    if (b) { const n = numOf(b[1]!); return n > 0 && n <= 200 ? { miles: miles(n) } : undefined; }
    if (/^ (anywhere|wherever|doesn't matter|doesnt matter|don't care|dont care|far as needed) $/.test(t)) return { city: true };
  }
  return undefined;
}

/** A 5-digit zip the member gave (a ZIP+4 counts by its first five), never part of a longer number, a price or a range. */
export const parseZip = (text: string): string | undefined =>
  /(?<![\d$#.,+-])(\d{5})(?:-\d{4})?(?!\d|[.,-]\d)/.exec(text.normalize("NFKC"))?.[1];

// ------------------------------------------------------------------------------------ basics
/** The basics: what they are looking for right now, a few stated dealbreakers, and "none". Unknown stays unknown. */
export function parseBasics(text: string): { goal?: "casual" | "long_term" | "unsure"; dealbreakers: string[]; none?: boolean } {
  const t = words(text);
  const goal = /\b(not sure|unsure|don't know|dont know|open to (either|both|anything)|see where it goes|see what happens|figuring it out)\b/.test(t) ? "unsure"
    : /\b(long[- ]term|serious|relationship|something (real|longer|lasting)|marriage|settle down|partner|the one|wife|husband)\b/.test(t) && !/\bnot (looking for )?(anything |something )?(serious|long[- ]term)\b/.test(t) ? "long_term"
    : /\b(casual|nothing serious|not (looking for )?(anything |something )?serious|fun|hookups?|keep it light|short[- ]term)\b/.test(t) ? "casual" : undefined;
  const dealbreakers: string[] = [];
  if (/\b(no smok(ers|ing)|smok(ers|ing|e) (is|are) a (dealbreaker|no)|can't (date|stand) smokers|cant (date|stand) smokers|non[- ]?smokers? only|hate smoking)\b/.test(t)) dealbreakers.push("smoker");
  if (/\b(no (heavy )?drinkers|sober|heavy drink(ers|ing) (is|are) a dealbreaker)\b/.test(t)) dealbreakers.push("heavy_drinker");
  if (/\b(no kids ever|never want kids|don't want kids|dont want kids|childfree|child-free)\b/.test(t)) dealbreakers.push("wants_kids");
  if (/\b(want(s)? kids|want(ing)? children)\b/.test(t) && !/\b(don't|dont|never|not) want(s)? kids\b/.test(t) && !dealbreakers.includes("wants_kids")) dealbreakers.push("no_kids_ever");
  if (/\b(no single (parents|moms|dads)|no one with kids|not dating (parents|anyone with kids)|someone without kids)\b|(?<!have )\bno kids\b(?! ever)/.test(t)) dealbreakers.push("has_kids");
  const none = !dealbreakers.length && /^ (none|nope|nah|no|not really|nothing|nothing really|no dealbreakers|none really|not that i can think of|i'm easy|im easy|open minded|open-minded)\b/.test(t);
  return { ...(goal ? { goal } : {}), dealbreakers, ...(none ? { none } : {}) };
}
