//@ option safe-slice true
// The pure decisions of the app packs, proved with LemmaScript (docs/formal-verification.md).
// This module imports nothing: every shipping caller passes plain facts in and takes one decision back.
// A boolean input is trusted here (`adult` is `canBeMatched(age)` at the call site, read by the caller);
// the proof covers what the decision does with it. Numbers are ideal in the proofs, so NaN and rounding
// stay with the sims.

// ------------------------------------------------------------------------------------- adults, photos

/** A romance item needs an adult who has the lane in an opt-in list. No list is no consent (fail closed). */
export function romanceItemAllowed(adult: boolean, optIn: readonly string[] | undefined, lane: string): boolean {
  //@ verify
  //@ ensures \result ==> adult
  //@ ensures optIn === undefined ==> !\result
  //@ ensures optIn !== undefined ==> (\result === (adult && optIn.includes(lane)))
  return optIn === undefined ? false : adult && optIn.includes(lane);
}

/** Photos are rated only for an adult whose age is not known to be unverified. */
export function photosRatable(adult: boolean, ageVerified: boolean | undefined): boolean {
  //@ verify
  //@ ensures \result === (adult && ageVerified !== false)
  return adult && ageVerified !== false;
}

/** A photo passes the Clef gate only on an answer at or over the bar. No answer is no pass (fail closed). */
export function photoPasses(oneAdult: number | undefined, gate: number): boolean {
  //@ verify
  //@ ensures oneAdult === undefined ==> !\result
  //@ ensures oneAdult !== undefined ==> (\result === (oneAdult >= gate))
  return oneAdult === undefined ? false : oneAdult >= gate;
}

export const PROBE_PHOTO_MAX = 1;
export interface ProbePhotoGate { subjectAdult: boolean; recipientAdult: boolean; photoConsent: boolean; held?: boolean }

/** The ids a probe may carry, from ids the caller already checked as opaque: both adults, consent, no hold. */
export function probePhotoIds(g: ProbePhotoGate, opaqueIds: readonly string[]): string[] {
  //@ verify
  //@ ensures \result.length <= PROBE_PHOTO_MAX
  //@ ensures \result.length > 0 ==> g.subjectAdult && g.recipientAdult && g.photoConsent && g.held !== true
  //@ ensures \result.length > 0 ==> opaqueIds.length > 0 && \result[0] === opaqueIds[0]
  if (!g.subjectAdult || !g.recipientAdult || !g.photoConsent || g.held === true) return [];
  return opaqueIds.slice(0, PROBE_PHOTO_MAX);
}

/** The sentence added when the probe carries the other person's photo. It names no one and describes nothing. */
export const SLOP_PROBE_PHOTO_LINE = "I've attached a photo they chose to share; their name and number stay private until you both say yes.";
export interface ProbeText { text: string }
export interface ProbePhotoRef { id: string }
export interface ProbeMessage { text: string; photos: string[] }

/**
 * The probe as sent: the core probe text (already through the leak gate) plus, when `photos` is not
 * empty, the photo line before the question, and the photo ids to attach (opaque ids the platform
 * resolves; at most one). With an empty list the text is unchanged.
 */
export function slopProbeMessage(probe: ProbeText, photos: readonly ProbePhotoRef[] = []): ProbeMessage {
  //@ verify
  //@ ensures \result.photos.length <= 1
  //@ ensures photos.length === 0 ==> \result.text === probe.text
  //@ ensures photos.length > 0 ==> \result.photos.length === 1 && \result.photos[0] === photos[0].id
  const ids = photos.slice(0, 1).map(p => p.id);
  if (ids.length === 0) return { text: probe.text, photos: [] };
  const at = probe.text.indexOf(" Want me to check");
  const text = at >= 0 ? `${probe.text.slice(0, at)} ${SLOP_PROBE_PHOTO_LINE}${probe.text.slice(at)}` : `${probe.text} ${SLOP_PROBE_PHOTO_LINE}`;
  return { text, photos: ids };
}

// ------------------------------------------------------------------------------------- slop onboarding

/** A read-back is confirmed only by a yes that changed nothing, and never for a minor or a declined person. */
export function confirmedAfter(changed: boolean, yes: boolean, minor: boolean, declined: boolean): boolean {
  //@ verify
  //@ ensures \result === (yes && !changed && !minor && !declined)
  return changed ? false : yes && !minor && !declined;
}

/** Matchable: an adult, not a minor, not declined, with every hard field set and a confirmed read-back. */
export function matchableOf(minor: boolean, declined: boolean, adult: boolean, hardFilled: number, hardTotal: number, confirmed: boolean): boolean {
  //@ verify
  //@ ensures \result === (!minor && !declined && adult && hardFilled === hardTotal && confirmed)
  return !minor && !declined && adult && hardFilled === hardTotal && confirmed;
}

/** Minor is sticky, and an age under the adult age sets it. */
export function minorOf(minor: boolean, age: number | undefined, adultAge: number): boolean {
  //@ verify
  //@ ensures minor ==> \result
  //@ ensures age !== undefined && age < adultAge ==> \result
  //@ ensures \result ==> minor || (age !== undefined ? age < adultAge : false)
  return age !== undefined && age < adultAge ? true : minor;
}

/** The lowest age ever stated wins: a new reading replaces the stored age only when it is lower. */
export function lowerAge(prior: number | undefined, read: number): boolean {
  //@ verify
  //@ ensures prior === undefined ==> \result
  //@ ensures prior !== undefined ==> (\result === (read < prior))
  return prior === undefined ? true : read < prior;
}

/** The next question: the first entry that is needed and still under the re-ask cap. -1 means none, and always for a blocked person. */
export function firstQuestion(blocked: boolean, needed: readonly boolean[], asked: readonly number[], maxAsks: number): number {
  //@ verify
  //@ requires needed.length === asked.length
  //@ ensures blocked ==> \result === -1
  //@ ensures -1 <= \result && \result < needed.length
  //@ ensures \result >= 0 ==> needed[\result] && asked[\result] < maxAsks
  //@ ensures forall(i, 0 <= i && i < needed.length && (\result === -1 ? !blocked : i < \result) ==> !needed[i] || asked[i] >= maxAsks)
  if (blocked) return -1;
  for (let i = 0; i < needed.length; i++) {
    //@ invariant 0 <= i && i <= needed.length
    //@ invariant forall(k, 0 <= k && k < i ==> !needed[k] || asked[k] >= maxAsks)
    //@ decreases needed.length - i
    if (needed[i] && asked[i]! < maxAsks) return i;
  }
  return -1;
}

// ------------------------------------------------------------------------------------- slop review

export interface ReviewHistory { yes: number; no: number; silent: number; dates: number; noShows: number; negativeFrom: number; blockedBy: number }
export interface ReviewSubject { review?: "cleared" | "confirmed"; verification: readonly string[]; safety: readonly string[]; history: ReviewHistory }
export interface ReviewVerification { required: boolean }
export interface ReviewTrust { enabled: boolean; negativeFrom: number; blockedBy: number; noShows: number; eagerYes: number }
export interface ReviewOptions { verification: ReviewVerification; safetyGate: boolean; safetyCues: readonly string[]; trust: ReviewTrust }

/** Why a member is held for review (safety cue or the Network's own records), or null. */
export function reviewReason(p: ReviewSubject, o: ReviewOptions): string | null {
  //@ verify
  //@ ensures p.review === "confirmed" ==> \result !== null
  //@ ensures p.review !== "cleared" && exists(i, 0 <= i && i < p.verification.length && p.verification[i].endsWith(":fail")) ==> \result !== null
  //@ ensures o.verification.required && !(p.verification.includes("verify:liveness:pass") && p.verification.includes("verify:age:pass")) ==> \result !== null
  //@ ensures p.review !== "cleared" && o.safetyGate && exists(i, 0 <= i && i < p.safety.length && o.safetyCues.includes(p.safety[i])) ==> \result !== null
  // Human review: a confirmed hold stays; a cleared one (a false positive) lifts the cue / check hold.
  if (p.review === "confirmed") return "review_confirmed";
  const cleared = p.review === "cleared";
  if (!cleared && p.verification.some(t => t.endsWith(":fail"))) return "verification_failed";
  if (o.verification.required && !(p.verification.includes("verify:liveness:pass") && p.verification.includes("verify:age:pass"))) return "unverified";
  if (!cleared && o.safetyGate && p.safety.some(t => o.safetyCues.includes(t))) return "safety_review";
  const T = o.trust;
  if (T.enabled) {
    const h = p.history;
    if (T.negativeFrom > 0 && h.negativeFrom >= T.negativeFrom) return "trust_review";
    if (T.blockedBy > 0 && h.blockedBy >= T.blockedBy) return "trust_review";
    if (T.noShows > 0 && h.noShows >= T.noShows && h.noShows > h.dates) return "trust_review";
    if (T.eagerYes > 0 && h.yes >= T.eagerYes && h.no === 0 && h.silent === 0) return "trust_review";
  }
  return null;
}

// ------------------------------------------------------------------------------------- slop pairs

export interface PairEdge { a: string; b: string }

/** Greedy round: indices of the edges to take, in order, each member at most once. */
export function greedyPick(edges: readonly PairEdge[]): number[] {
  //@ verify
  //@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] < edges.length)
  //@ ensures forall(i, forall(j, 0 <= i && i < j && j < \result.length ==> edges[\result[i]].a !== edges[\result[j]].a && edges[\result[i]].a !== edges[\result[j]].b && edges[\result[i]].b !== edges[\result[j]].a && edges[\result[i]].b !== edges[\result[j]].b))
  const taken = new Set<string>();
  const out: number[] = [];
  for (let k = 0; k < edges.length; k++) {
    //@ invariant 0 <= k && k <= edges.length
    //@ invariant forall(i, 0 <= i && i < out.length ==> 0 <= out[i] && out[i] < k)
    //@ invariant forall(i, 0 <= i && i < out.length ==> taken.has(edges[out[i]].a) && taken.has(edges[out[i]].b))
    //@ invariant forall(i, forall(j, 0 <= i && i < j && j < out.length ==> edges[out[i]].a !== edges[out[j]].a && edges[out[i]].a !== edges[out[j]].b && edges[out[i]].b !== edges[out[j]].a && edges[out[i]].b !== edges[out[j]].b))
    //@ decreases edges.length - k
    const e = edges[k]!;
    if (taken.has(e.a) || taken.has(e.b)) continue;
    taken.add(e.a); taken.add(e.b);
    out.push(k);
  }
  return out;
}

/** Each is in the other's seeking set, both ways. An unknown gender is never a match. */
export function mutualSeek(aIs: string | undefined, aSeeks: readonly string[], bIs: string | undefined, bSeeks: readonly string[]): boolean {
  //@ verify
  //@ ensures \result === mutualSeek(bIs, bSeeks, aIs, aSeeks)
  //@ ensures aIs === undefined || bIs === undefined ==> !\result
  if (aIs === undefined || bIs === undefined) return false;
  return aSeeks.includes(bIs) && bSeeks.includes(aIs);
}

/** Age ranges both ways: each age is inside the other's range. */
export function agesMutual(a: number, aLo: number, aHi: number, b: number, bLo: number, bHi: number): boolean {
  //@ verify
  //@ ensures \result === agesMutual(b, bLo, bHi, a, aLo, aHi)
  //@ ensures \result ==> aLo <= b && b <= aHi && bLo <= a && a <= bHi
  return b >= aLo && b <= aHi && a >= bLo && a <= bHi;
}

export interface PairRecord { outcome: string; at: number }

/** Two people revealed to each other are never proposed again. A probe that ended before the reveal waits out the cooldown. */
export function reprobeReason(records: readonly PairRecord[], now: number, cooldown: number, met: boolean): string | null {
  //@ verify
  //@ ensures met ==> \result !== null
  //@ ensures cooldown <= 0 && records.length > 0 ==> \result !== null
  //@ ensures forall(i, 0 <= i && i < records.length && records[i].outcome !== "declined" && records[i].outcome !== "expired" ==> \result !== null)
  if (met) return "already_introduced";
  for (let i = 0; i < records.length; i++) {
    //@ invariant 0 <= i && i <= records.length
    //@ invariant forall(k, 0 <= k && k < i ==> records[k].outcome === "declined" || records[k].outcome === "expired")
    //@ invariant cooldown <= 0 ==> i === 0
    //@ decreases records.length - i
    const r = records[i]!;
    const preReveal = r.outcome === "declined" || r.outcome === "expired";
    if (!preReveal || cooldown <= 0) return "already_introduced";
    if (now - r.at < cooldown) return "reprobe_cooldown";
  }
  return null;
}

export interface DealbreakerValues { smoking?: string; drinking?: string; hasKids?: string; wantsKids?: string; religionImportance?: number; politics?: string }

/** Lifestyle values that, held by the other person, someone with that dealbreaker would refuse. Unknown never counts. */
export function dealbreakerHit(d: string, v: DealbreakerValues): boolean | undefined {
  //@ verify
  //@ ensures (d === "smoker" && v.smoking === undefined) ==> \result === undefined
  //@ ensures (d === "heavy_drinker" && v.drinking === undefined) ==> \result === undefined
  //@ ensures (d === "has_kids" && v.hasKids === undefined) ==> \result === undefined
  //@ ensures ((d === "wants_kids" || d === "no_kids_ever") && v.wantsKids === undefined) ==> \result === undefined
  //@ ensures ((d === "religious" || d === "nonreligious") && v.religionImportance === undefined) ==> \result === undefined
  //@ ensures ((d === "right_politics" || d === "left_politics") && v.politics === undefined) ==> \result === undefined
  switch (d) {
    case "smoker": return v.smoking === undefined ? undefined : v.smoking === "regular";
    case "heavy_drinker": return v.drinking === undefined ? undefined : v.drinking === "regular";
    case "has_kids": return v.hasKids === undefined ? undefined : v.hasKids === "yes";
    case "wants_kids": return v.wantsKids === undefined ? undefined : v.wantsKids === "yes";
    case "no_kids_ever": return v.wantsKids === undefined ? undefined : v.wantsKids === "no";
    case "religious": return v.religionImportance === undefined ? undefined : v.religionImportance >= 2;
    case "nonreligious": return v.religionImportance === undefined ? undefined : v.religionImportance === 0;
    case "right_politics": return v.politics === undefined ? undefined : v.politics === "right";
    case "left_politics": return v.politics === undefined ? undefined : v.politics === "left";
    default: return undefined;
  }
}

// ------------------------------------------------------------------------------------- slop bias monitor

/** An alert needs a group of at least `minN` members and a ratio under the threshold. */
export function isAlert(n: number, ratio: number, minN: number, threshold: number): boolean {
  //@ verify
  //@ type ratio real
  //@ type threshold real
  //@ ensures \result === (n >= minN && ratio < threshold)
  return n >= minN && ratio < threshold;
}

/**
 * 1 as a real. LemmaScript types a bare `1` as an integer, and a real-typed branch cannot return one;
 * 0.5 + 0.5 is exactly 1, so the caller returns the same number as before.
 */
export function realOne(): number {
  //@ verify
  //@ type \result real
  //@ ensures \result === 1.0
  return 0.5 + 0.5;
}

/**
 * A group's outcome rate over the overall rate; 1 when the overall rate is 0 or not a number (the
 * truthiness test it replaces: NaN is the one value not equal to itself). With an overall rate above 0,
 * ratio x overall = rate, so a ratio under a threshold is a rate under threshold x overall (four-fifths rule).
 */
export function ratioOf(rate: number, overall: number): number {
  //@ verify
  //@ type rate real
  //@ type overall real
  //@ type \result real
  //@ ensures overall === 0.0 ==> \result === 1.0
  //@ ensures overall > 0.0 && rate >= 0.0 ==> \result >= 0.0
  //@ ensures overall > 0.0 ==> \result * overall === rate
  return overall !== 0 && overall === overall ? rate / overall : realOne();
}

/** Quintile (1 to 5) of position `i` among `n` sorted ratings. */
export function quintileOf(i: number, n: number): number {
  //@ verify
  //@ requires 0 <= i && i < n
  //@ ensures 1 <= \result && \result <= 5
  return 1 + Math.floor((5 * i) / n);
}

// ------------------------------------------------------------------------------------- slop distance

/**
 * The band of a distance (slop zips.ts distanceBand), 0 = "under 2 mi" to 4 = "25+ mi". More miles never
 * give a nearer band. The labels stay in zips.ts: LemmaScript cannot emit a union of strings that start
 * with a digit, so the proof works on the index.
 */
export function distanceBandIndex(miles: number): number {
  //@ verify
  //@ type miles real
  //@ ensures 0 <= \result && \result <= 4
  //@ ensures \result === 0 ==> miles < 2.0
  //@ ensures forall(m: real, m >= miles ==> distanceBandIndex(m) >= \result)
  return miles < 2 ? 0 : miles < 5 ? 1 : miles < 10 ? 2 : miles < 25 ? 3 : 4;
}

// ------------------------------------------------------------------------------------- peon

/** Openings a seat has left. */
export function seatLeft(posted: number, filled: number): number {
  //@ verify
  //@ ensures \result >= 0
  //@ ensures posted >= 0 && filled >= 0 ==> \result <= posted
  //@ ensures \result + filled >= posted
  return Math.max(0, posted - filled);
}

/** The slate for a job: the base, under a seat's cap when it has one, and the probation cap until the company is trusted. */
export function slateCapOf(base: number, seatCap: number | undefined, trusted: boolean, probationCap: number): number {
  //@ verify
  //@ ensures seatCap !== undefined ==> \result <= Math.max(0, seatCap)
  //@ ensures !trusted ==> \result <= probationCap
  //@ ensures \result <= base
  const cap = seatCap === undefined ? base : Math.min(base, Math.max(0, seatCap));
  return trusted ? cap : Math.min(cap, probationCap);
}

/** Work authorization: not refused, and sponsorship offered if the candidate needs it. */
export function workAuthAllowed(auth: boolean | undefined, needsSponsor: boolean | undefined, sponsors: boolean): boolean {
  //@ verify
  //@ ensures \result ==> auth !== false
  //@ ensures \result && needsSponsor === true ==> sponsors
  if (auth === false) return false;
  if (needsSponsor === true && !sponsors) return false;
  return true;
}

export interface CandidatePlace { modes: Set<string>; market?: string; areas: Set<string> }
export interface JobPlace { mode?: string; market?: string; area?: string }

/** Onsite / hybrid: same market and a site area the candidate said they will commute to. Remote: the candidate wants remote. */
export function placeAllowed(c: CandidatePlace, j: JobPlace): boolean {
  //@ verify
  //@ ensures j.mode === undefined ==> !\result
  //@ ensures j.mode !== undefined && \result ==> c.modes.has(j.mode)
  //@ ensures j.mode !== undefined && j.mode !== "remote" && \result ==> c.market === j.market
  if (j.mode === undefined) return false;
  if (j.mode === "remote") return c.modes.has("remote");
  if (!c.modes.has(j.mode)) return false;
  return c.market === j.market && (j.area === undefined ? false : c.areas.has(j.area));
}

// ------------------------------------------------------------------------------------- friends

/** Groups are 3 to 6 people; an intro or a second encounter is exactly 2. */
export function groupSizeOk(kind: string, n: number): boolean {
  //@ verify
  //@ ensures kind === "group" && \result ==> 3 <= n && n <= 6
  //@ ensures (kind === "intro" || kind === "second_encounter") && \result ==> n === 2
  if (kind === "group" && (n < 3 || n > 6)) return false;
  if ((kind === "intro" || kind === "second_encounter") && n !== 2) return false;
  return true;
}

/** Two homes too far apart for any venue to fit both tolerances. Symmetric. */
export function beyondTolerance(minutes: number, ta: number, tb: number): boolean {
  //@ verify
  //@ ensures \result === beyondTolerance(minutes, tb, ta)
  return minutes > ta + tb;
}
