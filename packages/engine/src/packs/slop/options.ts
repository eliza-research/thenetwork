// slopPack options: every policy knob in one place, so ablations are a different options object
// (makeSlopPack(options)) rather than a code change. Defaults were tuned on slop world seeds 1-4 and
// reported on held-out seeds 5-8 (docs/results/2026-10-08-slop-pack.md).

export interface SlopPackOptions {
  /** Reciprocal aggregate of the two directional values (PRD 40.5: harmonic mean or minimum). */
  aggregate: "harmonic" | "min";
  /** Global assignment per tick: stable roommates (Irving; works for queer, non-bipartite pools) or greedy max-value. */
  assignment: "stable" | "greedy";
  /** safety:* cues observed in chat hold the member for human review instead of matching them. */
  safetyGate: boolean;
  /** Which cues hold (default: all five). */
  safetyCues: readonly string[];
  /**
   * Verification before the first intro (PRD 40.5: selfie liveness + age assurance). A failed check
   * (fact verify:<liveness|age>:fail) always holds the member for review; with `required`, a member
   * without a passed check is not matched at all (PRD 40.8: 0 intros involving anyone unverified).
   */
  verification: { required: boolean };
  /** Behavioural trust holds from the Network's own records (reports, negative feedback, no-shows, blocks). */
  trust: { enabled: boolean; negativeFrom: number; blockedBy: number; noShows: number; eagerYes: number };
  /** Ask for an unknown age range, distance or orientation instead of proposing on a guess. */
  asks: boolean;
  /** Also ask (without holding proposals back) for goal, dealbreakers and lifestyle basics when unknown. */
  compatAsks: boolean;
  /** With compatAsks: also ask for their type and self-description (the stated-type signal). */
  typeAsk: boolean;
  /**
   * Hold a member's first intro while the basics question (goal, dealbreakers, lifestyle) is open:
   * propose once they answered, or after 7 days of silence (never a lockout). Onboarding asks these
   * before the first intro anyway (research A6).
   */
  holdForBasics: boolean;
  /** When asks are off: what to assume for unknown fields (the baselines' UNKNOWN_DEFAULTS). */
  unknownDefaults: { ageSpread: number; maxMiles: number };
  /**
   * When a hard-filter question went unanswered for 7 days (profile.ts SILENT_AFTER_DAYS): with
   * `enabled`, propose on a NARROW guess (claimed age +- ageSpread, within maxMiles); without it
   * (default, the founder's ask-first rule), keep asking weekly and never propose on a guess. The
   * guess measured 1-3 stated-filter violations per seed (some members' stated range excludes
   * their own age), so it is off.
   */
  silentFallback: { enabled: boolean; ageSpread: number; maxMiles: number };
  /**
   * Re-probe a pair whose earlier probe ended BEFORE any reveal (a "no" or silence to an anonymous
   * probe is about the week and the plan, not the person) after this many days; 0 = never. A pair
   * that was revealed (booked, backed out, met) is never proposed again.
   */
  reprobeAfterDays: number;
  /** Revealed-preference component from probe answers and post-date feedback. */
  learned: { enabled: boolean; positivity: number; appeal: number; taste: number; prior: number; strength: number };
  /** Compatibility model weights (multiplicative factors on each side's estimated enjoyment). */
  compat: {
    goalClash: number; goalUnsure: number; goalUnknown: number;
    lifestyleMismatch: number; politicsClash: number; religionGap: number; kidsClash: number;
    /** Expected factor for a lifestyle field that is unknown on either side. */
    unknownField: number;
    /** P(a stated-dealbreaker-like value is a real dealbreaker for someone whose dealbreakers are unknown). */
    hiddenDealbreaker: number;
    sharedInterest: [number, number, number];
    activityMiss: number; typeWeight: number;
  };
  /** Pair logistics: no stated common free slot / unknown availability. */
  logistics: { noCommonSlot: number; unknownSlots: number };
  /** Congestion control and exposure fairness. */
  congestion: {
    /** Proposals per member per tick (1 = one first-date thread at a time; 2 = one backup round). */
    perMemberPerTick: number;
    /** Candidates kept per member before assignment (retrieval depth). */
    topK: number;
    /** selection.adjust: lift per unit of carried exposure debt (capped). */
    debtWeight: number; debtCap: number;
    /** selection.adjust: lift for members with few eligible partners (scarce pools), x 1/sqrt(degree). */
    scarcityWeight: number;
    /** selection.adjust: penalty for members many others rank highly (popularity), x demand share. */
    popularityPenalty: number;
    /**
     * Scarce pools first: pairs whose scarcer member has at most this many eligible partners are
     * assigned before everyone else (then by value), so small queer pools are not crowded out by
     * members with many options. 0 = off.
     */
    scarceDegree: number;
    /** A backup proposal (round 2) only for members with at most this many eligible partners; 0 = none. */
    backupMaxDegree: number;
  };
  /** Receptivity pacing: no new probe for this many days after a date the member liked; never while a mutual yes is open. */
  pacing: { likedDateDays: number };
  /** Mutual radius safety margin in miles (cells are coarse; a pair must be inside both radii by this margin). */
  radiusMargin: number;
  /**
   * Iteration 2: online revealed-preference model of attraction (learn.ts) from probe answers,
   * back-outs and ratings: partner effect (itemWeight), per-member revealed taste over
   * self-descriptions (tasteWeight), collaborative signal (cfWeight). Its score multiplies each
   * side's directional value by exp(score).
   */
  attraction: {
    enabled: boolean; itemWeight: number; tasteWeight: number; cfWeight: number;
    probeWeight: number; backoutWeight: number; feedbackWeight: number; shrink: number; ridge: number; cfShrink: number;
  };
  /** Iteration 2: each question is asked at most this many times (then the agent waits for the member). */
  maxAsksPerField: number;
  /**
   * Iteration 2: members with at most `maxDegree` eligible partners whose distance limit is under
   * `miles` are asked once "would you consider people up to <miles> mi?" (small pools).
   */
  widen: { enabled: boolean; maxDegree: number; miles: number };
  /** Pairs below this reciprocal value are not proposed (a dud first date costs both people an evening). */
  minValue: number;
}

export const SLOP_DEFAULT_OPTIONS: SlopPackOptions = {
  aggregate: "harmonic",
  assignment: "greedy",
  safetyGate: true,
  safetyCues: ["safety:scam_pattern", "safety:age_signal", "safety:photo_mismatch", "safety:hostile_language", "safety:relationship_signal"],
  verification: { required: false },
  trust: { enabled: true, negativeFrom: 0, blockedBy: 2, noShows: 2, eagerYes: 0 },
  asks: true,
  compatAsks: true,
  typeAsk: true,
  holdForBasics: false,
  unknownDefaults: { ageSpread: 7, maxMiles: 25 },
  silentFallback: { enabled: false, ageSpread: 0, maxMiles: 5 },
  reprobeAfterDays: 7,
  learned: { enabled: true, positivity: 0.6, appeal: 0.6, taste: 1, prior: 0.5, strength: 2 },
  compat: {
    goalClash: 0.6, goalUnsure: 0.85, goalUnknown: 0.85,
    lifestyleMismatch: 0.8, politicsClash: 0.75, religionGap: 0.85, kidsClash: 0.7,
    unknownField: 0.97, hiddenDealbreaker: 0.35,
    sharedInterest: [0.88, 0.95, 1],
    activityMiss: 0.92, typeWeight: 0.1,
  },
  logistics: { noCommonSlot: 0.75, unknownSlots: 0.9 },
  congestion: { perMemberPerTick: 1, topK: 40, debtWeight: 0.02, debtCap: 3, scarcityWeight: 0, popularityPenalty: 0, scarceDegree: 6, backupMaxDegree: 0 },
  pacing: { likedDateDays: 10 },
  radiusMargin: 0.9,
  minValue: 0,
  // Off by default: with anonymous probes (no photo) a probe answer says nothing about the person and
  // the model measured no gain (iteration 2). Turn it on when probes show a photo.
  attraction: { enabled: false, itemWeight: 1, tasteWeight: 1, cfWeight: 1, probeWeight: 1, backoutWeight: 2, feedbackWeight: 1.5, shrink: 4, ridge: 4, cfShrink: 0.5 },
  maxAsksPerField: 2,
  widen: { enabled: true, maxDegree: 2, miles: 25 },
};

/** Deep-merge partial options over the defaults. */
export function slopOptions(over: DeepPartial<SlopPackOptions> = {}): SlopPackOptions {
  const merge = (b: any, o: any): any => {
    if (o === undefined) return b;
    if (Array.isArray(b) || typeof b !== "object" || b === null) return o;
    const out: any = { ...b };
    for (const k of Object.keys(o)) out[k] = merge(b[k], o[k]);
    return out;
  };
  return merge(SLOP_DEFAULT_OPTIONS, over);
}
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
