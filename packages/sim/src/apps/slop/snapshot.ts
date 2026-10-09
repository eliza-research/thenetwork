// Build the engine's snapshot for slop.date from what the agent KNOWS: stated preferences, facets
// extracted from the onboarding chat (filtered by profile richness), coarse location (zip only) and
// what the Network itself recorded (interactions, feedback, blocks, reports). Hidden truth never
// enters it: no desirability, no taste, no true age, no adversary label, no chemistry, no canary.
//
// Field mapping (also in docs/results/2026-10-08-slop-world.md "Snapshot mapping"). Dating fields
// go into facet tags with the prefixes below, so the core types stay unchanged:
//   Member.age = claimed age; Member.prefs.romanceOptIn = canBeMatched(claimed age);
//   Member.homeCity = city of the home zip (core City includes "la" since the slop pack);
//   preference  romance:is:<g> romance:seeks:<g> romance:age:<lo>-<hi>   (agent_private; existing engine tags)
//   fact        slop:zip:<zip>                                            (agent_private; zip centroid only)
//   preference  slop:scope:city | slop:scope:radius:<mi> | slop:scope:multi:<c1>,<c2>; slop:max_miles:<mi>
//   goal        slop:goal:<casual|long_term|unsure>
//   fact        slop:smoking:* slop:drinking:* slop:has_kids:* slop:wants_kids:* slop:religion:* slop:religion_importance:<0-3> slop:politics:*
//   boundary    slop:dealbreaker:<Dealbreaker>
//   interest    <interest tag>; preference slop:activity:<DateActivity>; availability_pattern slop:free:<slot>
//   preference  slop:wants:<dim>=<x>  (stated type); fact slop:self:<dim>=<x> (self-description)
//   fact        slop:identity:<identity> slop:orientation:<orientation> (sensitive "sexuality", agent_private)
//   fact        slop:occupation (shareable value)
//   fact        safety:<signal> (agent_private, inferred: cues the agent observed in chat)
//   Intent      category "romance", details "goal: <goal>"; Presence areas ["zip:<zip>"]
import { DAY, canBeMatched, type City, type Edge, type Facet, type Intent, type Member, type MemberId, type Presence, type WorldSnapshot } from "@thenetwork/core";
import type { FeedbackRecord, InteractionRecord, SafetyHold } from "@thenetwork/engine/src/types.ts";
import { Rng, hash32 } from "@thenetwork/core";
import { zipInfo, type SlopCity } from "./geo.ts";
import { appearanceFacet, canRatePhotos } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { SLOTS, TASTE_DIMS, type RichnessTier, type SlopPersona } from "./persona.ts";
import { bodyPref, bodyPrefStated, ratedBodyType, type BodyTypeModel } from "./bodyType.ts";

/** Monday 2026-10-12 00:00 UTC: week 0 of every slop run. */
export const SLOP_WORLD_START = Date.UTC(2026, 9, 12);

/** Inbound "find me a date" requests the member sent the agent (ask priming). */
export interface InboundAsk { memberId: MemberId; at: number }

export interface SlopSnapshot extends WorldSnapshot {
  interactions: InteractionRecord[];
  feedback: FeedbackRecord[];
  safetyHolds: SafetyHold[];
  inboundAsks: InboundAsk[];
  /** Questions the agent asked and their answer times (empty for matchers that never ask). */
  asks: SlopAskRecord[];
}

/** Fields an agent can ask a member about (world.ts SlopAsk): the hard filters; the basics (goal, dealbreakers, lifestyle); their type and how they describe themselves. */
export type SlopAskField = "orientation" | "age_range" | "distance" | "basics" | "type" | "widen";
/** A question the agent asked, and when the member answered (visible to the Network). */
export interface SlopAskRecord { memberId: MemberId; field: SlopAskField; at: number; answeredAt?: number }

/**
 * OPTIONAL verification before a member's first intro (PRD 40.5 safety basics: selfie liveness and
 * age assurance, with an ID fallback near the age line). Off by default (the baselines and the world
 * doc run without it). The rates are ASSUMPTIONS, not measurements: P(fail) by adversary kind; honest
 * members fail with `falseFail` (age: only claimed 18-20). Harassers and members who are not single
 * pass: verification sees faces and ages, not intent or relationship status.
 */
export interface VerificationModel {
  liveness: { catfish: number; romance_scammer: number; falseFail: number };
  age: { age_liar: number; falseFailYoung: number };
}
export const VERIFICATION_DEFAULTS: VerificationModel = {
  liveness: { catfish: 0.9, romance_scammer: 0.7, falseFail: 0.005 },
  age: { age_liar: 0.85, falseFailYoung: 0.01 },
};

/** Verification facts for one persona (agent_private; deterministic per persona). */
export function verificationFacets(p: SlopPersona, joinedAt: number, v: VerificationModel): Facet[] {
  if (!canBeMatched(p.stated.claimedAge)) return [];
  const r = new Rng(hash32("slop-verify", p.id));
  const adv = p.hidden.adversary;
  const liveFail = r.next() < (adv === "catfish" ? v.liveness.catfish : adv === "romance_scammer" ? v.liveness.romance_scammer : v.liveness.falseFail);
  const ageFail = r.next() < (adv === "age_liar" ? v.age.age_liar : p.stated.claimedAge <= 20 ? v.age.falseFailYoung : 0);
  const mk = (i: number, kind: string, ok: boolean): Facet => ({
    id: `${p.id}:verify:${i}`, memberId: p.id, kind: "fact", value: `${kind} check ${ok ? "passed" : "failed"}`, tags: [`verify:${kind}:${ok ? "pass" : "fail"}`],
    scope: "agent_private", provenance: "connected_source", confidence: 0.95, validFrom: joinedAt, source: "chat", observedAt: joinedAt, inferred: false, confirmedByMember: true,
  });
  return [mk(0, "liveness", !liveFail), mk(1, "age", !ageFail)];
}

/**
 * OPTIONAL platform features (iteration 2), all off by default so the baselines are unchanged. The
 * rates are ASSUMPTIONS for sensitivity analysis, not measurements:
 *  - photos: the probe shows the other person's photo (PRD open question); answers then depend on a
 *    noisy view of attraction (oracle.photoFactor) and back-outs at the reveal shrink accordingly;
 *  - relay: a classifier on relayed messages flags scam scripts (money, moving off-platform) and
 *    hostile language; a flagged message is blocked (its harm does not happen) and the sender is put
 *    on a safety hold; honest members are flagged at `falsePositive` per revealed contact;
 *  - review: a human reviewer looks at every member held on a safety cue, a failed verification
 *    check or a classifier flag within `days`: honest members are cleared with p = clearHonest,
 *    adversaries are confirmed with p = catchAdversary (else cleared by mistake);
 *  - widen: a member asked "would you consider people up to <miles> mi?" agrees with p = agree.
 */
export interface PlatformModel {
  /**
   * Photo in the probe: `consent` = share of adults who agreed to show their photo to a match
   * (default 1). Whether a probe carries a photo is decided by the engine's `probePhotoRefs`, the
   * function the platform calls (adults on both sides, consent, an opaque photo id).
   */
  photos?: { noiseSd: number; consent?: number };
  /**
   * Iteration 3: appearance ratings from photos (adults only), derived from hidden appearance
   * (desirability + per-person face / body terms) plus rater noise (SD `noise`) and a demographic
   * bias: members of the synthetic group "B" (`biasShare` of people, assigned by hash, unrelated to
   * any other trait) are rated `bias` SD lower. Stored as agent_private facets (appearanceFacet).
   */
  rater?: { noise: number; bias: number; biasShare: number };
  /** Iteration 3: post-date check-in reports, P(report | the victim answers) by harm kind. */
  checkin?: Partial<Record<string, number>>;
  /**
   * Relay after the reveal. `engine: true` (critical path item 7): the pair exchange scripted items
   * through the engine's `relayItem` (relay.ts in this folder); harms whose item is held or blocked do
   * not happen, a sender held for scam / harassment / a minor signal goes on a safety hold. Without
   * `engine`, the iteration-2 assumption: flagged with p = recall, honest members at `falsePositive`.
   */
  relay?: { scamRecall: number; hostileRecall: number; falsePositive: number; engine?: boolean; roles?: { contactFisher: number; ratingProber: number } };
  review?: { days: number; clearHonest: number; catchAdversary: number };
  widen?: { agree: number; miles: number };
  /**
   * What stops a ban evader's next account (world.ts): a ban by phone (a banned number never joins
   * any app; live) and a face match against held accounts (not live: photos and face matching are a
   * founder decision). Absent = the live policy, BAN_EVASION_LIVE.
   */
  banEvasion?: { phone: boolean; face: boolean };
}
/** The live ban policy (2026-10-08): a banned phone never joins again; no face matching. */
export const BAN_EVASION_LIVE = { phone: true, face: false };
export const RATER_DEFAULTS = { noise: 0.5, bias: 0, biasShare: 0.3 };
export const CHECKIN_DEFAULTS: Partial<Record<string, number>> = { harassment: 0.85, deception: 0.6, catfish_reveal: 0.85, money_ask: 0.7, offplatform_move: 0.4, minor_contact: 0.5 };

/** The synthetic demographic group used ONLY to test rater bias: hash-assigned, independent of everything. */
export const demoGroupOf = (id: MemberId, share = RATER_DEFAULTS.biasShare): "A" | "B" => ((hash32("slop-demo", id) % 1000) / 1000 < share ? "B" : "A");

/** Hidden appearance: desirability plus fixed per-person face and body terms (never in the snapshot). */
export function trueAppearance(p: SlopPersona): { face: number; body: number; overall: number } {
  const r = new Rng(hash32("slop-appearance", p.id));
  const face = p.hidden.desirability + r.normal(0, 0.5), body = p.hidden.desirability + r.normal(0, 0.7);
  return { face, body, overall: (face + body) / 2 };
}
/** The simulated rater's facet for a persona (adults only; skipped when an age check failed). */
export function raterFacet(p: SlopPersona, joinedAt: number, m: NonNullable<PlatformModel["rater"]>, ageFailed: boolean, bt?: BodyTypeModel): Facet | null {
  const subject = { age: p.stated.claimedAge, ageVerified: ageFailed ? false : undefined };
  if (!canRatePhotos(subject)) return null;
  const t = trueAppearance(p), r = new Rng(hash32("slop-rater", p.id));
  const shift = demoGroupOf(p.id, m.biasShare) === "B" ? -m.bias : 0;
  const face = t.face + r.normal(0, m.noise) + shift, body = t.body + r.normal(0, m.noise) + shift;
  const conf = 1 / (1 + m.noise * m.noise);
  return appearanceFacet(p.id, subject, { face, body, overall: (face + body) / 2, confidence: conf, model: "sim-rater", ...(bt ? { bodyType: ratedBodyType(p.id, bt), bodyTypeConfidence: bt.raterAccuracy } : {}) }, joinedAt);
}

export const RELAY_DEFAULTS = { scamRecall: 0.85, hostileRecall: 0.7, falsePositive: 0.005 };
export const REVIEW_DEFAULTS = { days: 3, clearHonest: 0.95, catchAdversary: 0.8 };
export const WIDEN_DEFAULTS = { agree: 0.5, miles: 25 };

/** The reviewer's decision on a member held for a cue or a failed check (deterministic per member). */
export function reviewDecision(p: SlopPersona, review: NonNullable<PlatformModel["review"]>): "cleared" | "confirmed" {
  const r = new Rng(hash32("slop-review", p.id)).next();
  const bad = !!p.hidden.adversary;
  return bad ? (r < review.catchAdversary ? "confirmed" : "cleared") : (r < review.clearHonest ? "cleared" : "confirmed");
}

/** What the Network recorded so far (harness-maintained; all of it is visible to the Network). */
export interface SlopNetworkState {
  now: number; week: number;
  interactions: InteractionRecord[];
  feedback: FeedbackRecord[];
  safetyHolds: SafetyHold[];
  inboundAsks: InboundAsk[];
  /** Explicit edges the Network recorded: blocked, met. */
  edges: Edge[];
  /** Members who paused (e.g. started seeing someone). */
  paused: Set<MemberId>;
  /** Questions the agent asked (optional: older callers build a state without them). */
  asks?: SlopAskRecord[];
  /** Stated fields a member told the agent in answer to a question (shown from the next snapshot on). */
  learned?: Map<MemberId, Set<SlopAskField>>;
  /** Optional verification before the first intro (VerificationModel); absent = not modelled. */
  verification?: VerificationModel;
  /** Optional platform features (iteration 2); absent = not modelled. */
  platform?: PlatformModel;
  /** Iteration 4: body types (bodyType.ts): stated body-type preferences and the rater's body type. */
  bodyTypes?: BodyTypeModel;
  /** Ban evaders' next accounts: due in a week, then joined or stopped at the door (harness side; never in a snapshot). */
  rejoins?: { week: number; persona: SlopPersona; outcome?: "joined" | "stopped_phone" | "stopped_face" }[];
}

/** Which stated fields the agent learned in onboarding, by richness tier. */
export const KNOWS: Record<RichnessTier, { ageRange: boolean; scope: boolean; goal: boolean; basicValues: boolean; allValues: boolean; dealbreakers: boolean; interests: number; activities: boolean; availability: number; type: boolean; identity: boolean; occupation: boolean }> = {
  minimal:   { ageRange: false, scope: false, goal: false, basicValues: false, allValues: false, dealbreakers: false, interests: 0,   activities: false, availability: 0,   type: false, identity: false, occupation: false },
  light:     { ageRange: true,  scope: true,  goal: true,  basicValues: false, allValues: false, dealbreakers: false, interests: 0.3, activities: false, availability: 0.3, type: false, identity: false, occupation: true },
  medium:    { ageRange: true,  scope: true,  goal: true,  basicValues: true,  allValues: false, dealbreakers: false, interests: 0.5, activities: true,  availability: 0.6, type: false, identity: false, occupation: true },
  rich:      { ageRange: true,  scope: true,  goal: true,  basicValues: true,  allValues: true,  dealbreakers: true,  interests: 0.8, activities: true,  availability: 0.9, type: true,  identity: true,  occupation: true },
  very_rich: { ageRange: true,  scope: true,  goal: true,  basicValues: true,  allValues: true,  dealbreakers: true,  interests: 1,   activities: true,  availability: 1,   type: true,  identity: true,  occupation: true },
};

/** What the agent knows after the member answered questions: the tier's knowledge plus the answered fields. */
export function knowsWith(k: (typeof KNOWS)[RichnessTier], learned?: ReadonlySet<SlopAskField>): (typeof KNOWS)[RichnessTier] {
  if (!learned?.size) return k;
  const basics = learned.has("basics");
  return {
    ...k,
    ageRange: k.ageRange || learned.has("age_range"),
    scope: k.scope || learned.has("distance"),
    identity: k.identity || learned.has("orientation"),
    type: k.type || learned.has("type"),
    goal: k.goal || basics, basicValues: k.basicValues || basics, allValues: k.allValues || basics, dealbreakers: k.dealbreakers || basics,
  };
}

/** P(the agent noticed a safety cue in the onboarding chat), by adversary kind and richness. */
export const SIGNAL_RATES: Record<string, { tag: string; byTier: Record<RichnessTier, number> }> = {
  age_liar: { tag: "safety:age_signal", byTier: { minimal: 0.2, light: 0.35, medium: 0.5, rich: 0.65, very_rich: 0.8 } },
  romance_scammer: { tag: "safety:scam_pattern", byTier: { minimal: 0.15, light: 0.25, medium: 0.3, rich: 0.4, very_rich: 0.5 } },
  catfish: { tag: "safety:photo_mismatch", byTier: { minimal: 0.15, light: 0.2, medium: 0.25, rich: 0.3, very_rich: 0.35 } },
  harasser: { tag: "safety:hostile_language", byTier: { minimal: 0.1, light: 0.15, medium: 0.2, rich: 0.3, very_rich: 0.4 } },
  not_single: { tag: "safety:relationship_signal", byTier: { minimal: 0.05, light: 0.1, medium: 0.15, rich: 0.2, very_rich: 0.25 } },
};
/** False-positive rate of each cue on an honest adult (an 18-19 year old is more often age-flagged). */
export const SIGNAL_FALSE_POSITIVE = 0.01, AGE_SIGNAL_FALSE_POSITIVE_YOUNG = 0.06;

/** SlopCity -> core City (identical since core City gained "la" with the slop pack; kept as the one boundary). */
export const asCoreCity = (c: SlopCity): City => c as unknown as City;

const tag = (dim: string, x: number) => `${dim}=${x >= 0 ? "+" : ""}${x.toFixed(2)}`;

/** Facets the agent extracted for one persona (deterministic per persona; no hidden truth). */
export function slopFacetsOf(p: SlopPersona, joinedAt: number, learned?: ReadonlySet<SlopAskField>): Facet[] {
  const S = p.stated, tier = p.hidden.richness, K = knowsWith(KNOWS[tier], learned);
  const minor = !canBeMatched(S.claimedAge);
  const r = new Rng(hash32("slop-knows", p.id));
  const out: Facet[] = [];
  const f = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], extra: Partial<Facet> = {}) => out.push({
    id: `${p.id}:slop:${out.length}`, memberId: p.id, kind, value, tags, scope: minor ? "agent_private" : scope,
    provenance: "said", confidence: 0.8, validFrom: joinedAt, source: "chat", observedAt: joinedAt, inferred: false, confirmedByMember: true, ...extra,
  });
  f("fact", `home zip ${S.homeZip}`, [`slop:zip:${S.homeZip}`], "agent_private");
  if (!minor) {
    const who = S.seeks.map(g => (g === "nonbinary" ? "nonbinary people" : g === "woman" ? "women" : "men")).join(" and ");
    f("preference", `Open to dating; interested in ${who}${K.ageRange ? `, ages ${S.ageRange[0]}-${S.ageRange[1]}` : ""}`,
      [`romance:is:${S.matchGender}`, ...S.seeks.map(g => `romance:seeks:${g}`), ...(K.ageRange ? [`romance:age:${S.ageRange[0]}-${S.ageRange[1]}`] : [])], "agent_private");
    if (K.scope) {
      const sc = S.scope;
      const st = sc.mode === "city" ? "slop:scope:city" : sc.mode === "radius" ? `slop:scope:radius:${sc.miles}` : `slop:scope:multi:${sc.cities.join(",")}`;
      f("preference", sc.mode === "radius" ? `dates within ${sc.miles} miles` : sc.mode === "multi_city" ? `dates in ${sc.cities.join(" and ")}` : "dates in their city", [st, `slop:max_miles:${S.maxMiles}`], "agent_private");
    }
    if (K.goal) f("goal", S.goal === "long_term" ? "looking for something long-term" : S.goal === "casual" ? "looking for something casual" : "not sure what they're looking for yet", [`slop:goal:${S.goal}`], "matchable");
  }
  const v = S.values;
  if (K.basicValues) {
    f("fact", `smoking: ${v.smoking}`, [`slop:smoking:${v.smoking}`], "matchable");
    f("fact", `drinking: ${v.drinking}`, [`slop:drinking:${v.drinking}`], "matchable");
    f("fact", v.hasKids ? "has kids" : "no kids", [`slop:has_kids:${v.hasKids ? "yes" : "no"}`], "agent_private", { sensitive: "children" });
    f("fact", `wants kids: ${v.wantsKids}`, [`slop:wants_kids:${v.wantsKids}`], "agent_private", { sensitive: "children" });
  }
  if (K.allValues) {
    f("fact", `religion: ${v.religion} (importance ${v.religionImportance}/3)`, [`slop:religion:${v.religion}`, `slop:religion_importance:${v.religionImportance}`], "agent_private", { sensitive: "religion" });
    f("fact", `politics: ${v.politics}`, [`slop:politics:${v.politics}`], "agent_private");
  }
  if (K.dealbreakers) for (const d of S.dealbreakers) f("boundary", `dealbreaker: ${d.replace(/_/g, " ")}`, [`slop:dealbreaker:${d}`], "agent_private");
  for (const t of S.interests) if (r.next() < K.interests)
    f("interest", t.replace(/_/g, " "), [t], (hash32("share", p.id, t) % 10) < 6 ? "shareable" : "matchable");
  if (K.activities) for (const a of S.activities) f("preference", `first date idea: ${a.replace(/_/g, " ")}`, [`slop:activity:${a}`], "matchable");
  for (const s of S.usuallyFree) if (r.next() < K.availability) f("availability_pattern", `usually free ${s.replace("_eve", " evening").replace("_day", " daytime")}`, [`slop:free:${s}`], "agent_private");
  if (K.type) {
    f("preference", "their type (stated)", TASTE_DIMS.map((d, i) => `slop:wants:${tag(d, S.wantsTraits[i]!)}`), "agent_private");
    f("fact", "how they describe themselves", TASTE_DIMS.map((d, i) => `slop:self:${tag(d, S.selfTraits[i]!)}`), "matchable");
  }
  if (K.identity) f("fact", `${S.identity.replace(/_/g, " ")}, ${S.orientation}`, [`slop:identity:${S.identity}`, `slop:orientation:${S.orientation}`], "agent_private", { sensitive: "sexuality" });
  if (K.occupation) f("fact", S.occupation, ["slop:occupation"], "shareable");
  if (tier === "very_rich") f("fact", S.bio, ["slop:bio"], "shareable");
  // Safety cues the agent noticed in the chat (observable behaviour, not the hidden label).
  const sr = new Rng(hash32("slop-signal", p.id));
  const adv = p.hidden.adversary;
  for (const [kind, sig] of Object.entries(SIGNAL_RATES)) {
    const fp = kind === "age_liar" && S.claimedAge <= 19 ? AGE_SIGNAL_FALSE_POSITIVE_YOUNG : SIGNAL_FALSE_POSITIVE;
    // A ban evader is a harasser in the chat too.
    const pr = adv === kind || (adv === "ban_evader" && kind === "harasser") ? sig.byTier[tier] : fp;
    if (sr.next() < pr) f("fact", sig.tag.replace("safety:", "").replace(/_/g, " "), [sig.tag], "agent_private", { provenance: "inferred", inferred: true, confirmedByMember: false, confidence: 0.6 });
  }
  return out;
}

/** The member record (claimed age; romance only for adults by claimed age). */
export function slopMemberOf(p: SlopPersona, joinedAt: number, s: Pick<SlopNetworkState, "paused">): Member {
  const S = p.stated, adult = canBeMatched(S.claimedAge);
  const city = zipInfo.get(S.homeZip)?.city ?? p.hidden.homeCity; // an unknown zip falls back to the home city
  const known = KNOWS[p.hidden.richness];
  return {
    id: p.id, name: p.name, homeCity: asCoreCity(city), state: s.paused.has(p.id) ? "paused" : "normal",
    prefs: {
      categoriesOptIn: adult ? ["romance"] : ["social"], quietHours: [22, 8], romanceOptIn: adult,
      formats: ["one_to_one"], maxTravelMinutes: known.scope ? Math.min(120, S.maxMiles * 4) : 35, onlyWhenAsked: false,
    },
    joinedAt, age: S.claimedAge, unansweredProactive: 0,
  };
}

/** Build the snapshot for week `state.week`. */
export function buildSlopSnapshot(personas: readonly SlopPersona[], state: SlopNetworkState): SlopSnapshot {
  const members: Member[] = [], facets: Facet[] = [], intents: Intent[] = [], presence: Presence[] = [];
  const joinedAt = SLOP_WORLD_START;
  for (const p of personas) {
    members.push(slopMemberOf(p, joinedAt, state));
    const learned = state.learned?.get(p.id);
    facets.push(...slopFacetsOf(p, joinedAt, learned));
    if (state.verification) facets.push(...verificationFacets(p, joinedAt, state.verification));
    // Iteration 4: a stated body-type preference (agent_private; adults only, like everything romantic).
    const bpref = state.bodyTypes && canBeMatched(p.stated.claimedAge) ? bodyPref(p.id, state.bodyTypes) : undefined;
    if (bpref && bodyPrefStated(p.id, state.bodyTypes!)) facets.push({
      id: `${p.id}:wants_body`, memberId: p.id, kind: "preference", value: "partner preference (stated)", tags: bpref.map(t => `slop:wants_body:${t}`),
      scope: "agent_private", provenance: "said", confidence: 0.9, validFrom: joinedAt, source: "chat", observedAt: joinedAt, inferred: false, confirmedByMember: true,
    });
    if (state.platform?.rater) {
      const ageFailed = facets.some(f => f.memberId === p.id && f.tags.includes("verify:age:fail"));
      const rf = raterFacet(p, joinedAt, state.platform.rater, ageFailed, state.bodyTypes);
      if (rf) facets.push(rf);
    }
    // Human review of a cue or a failed check, visible once `days` have passed since the member joined.
    const rv = state.platform?.review;
    if (rv && state.now >= joinedAt + rv.days * DAY) {
      const flagged = facets.some(f => f.memberId === p.id && f.tags.some(t => t.startsWith("safety:") || (t.startsWith("verify:") && t.endsWith(":fail"))));
      if (flagged) {
        const d = reviewDecision(p, rv);
        facets.push({ id: `${p.id}:review`, memberId: p.id, kind: "fact", value: `safety review ${d}`, tags: [`review:${d}`], scope: "agent_private", provenance: "vouched", confidence: 0.95, validFrom: joinedAt + rv.days * DAY, source: "chat", observedAt: joinedAt + rv.days * DAY, inferred: false, confirmedByMember: false });
      }
    }
    const S = p.stated, city = zipInfo.get(S.homeZip)?.city ?? p.hidden.homeCity;
    const K = knowsWith(KNOWS[p.hidden.richness], learned);
    if (canBeMatched(S.claimedAge)) {
      const lastAsk = state.inboundAsks.filter(a => a.memberId === p.id).reduce((m, a) => Math.max(m, a.at), joinedAt);
      intents.push({
        id: `${p.id}:date`, memberId: p.id, category: "romance", horizonDays: 90, createdAt: lastAsk,
        objective: "go on dates", details: K.goal ? `goal: ${S.goal}` : undefined,
        status: state.paused.has(p.id) ? "paused" : "active",
      });
    }
    presence.push({ memberId: p.id, city: asCoreCity(city), type: "home", areas: [`zip:${S.homeZip}`] });
    if (K.scope && S.scope.mode === "multi_city")
      for (const c of S.scope.cities) if (c !== city) presence.push({ memberId: p.id, city: asCoreCity(c), type: "routine", areas: [] });
    // Trips are told to the agent: visible for the week they happen (announced the week before).
    if (S.scope.mode !== "multi_city") for (const pr of p.hidden.presence) if (pr.city !== city) for (const w of pr.weeks)
      if (w === state.week || w === state.week + 1) presence.push({ memberId: p.id, city: asCoreCity(pr.city), type: "temporary", areas: [], from: SLOP_WORLD_START + w * 7 * DAY, to: SLOP_WORLD_START + (w + 1) * 7 * DAY });
  }
  return {
    now: state.now, members, facets, intents, presence, edges: state.edges.map(e => ({ ...e })), recentProposals: [],
    interactions: state.interactions.map(i => ({ ...i })), feedback: state.feedback.map(f => ({ ...f })),
    safetyHolds: state.safetyHolds.map(h => ({ ...h })), inboundAsks: state.inboundAsks.map(a => ({ ...a })),
    asks: (state.asks ?? []).map(a => ({ ...a })),
  };
}
