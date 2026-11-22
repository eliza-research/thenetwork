export interface SlopPackOptions {
  safetyGate: boolean;
  safetyCues: readonly string[];
  verification: { required: boolean };
  trust: { enabled: boolean; negativeFrom: number; blockedBy: number; noShows: number; eagerYes: number };
  asks: boolean;
  compatAsks: boolean;
  typeAsk: boolean;
  holdForBasics: boolean;
  unknownDefaults: { ageSpread: number; maxMiles: number };
  silentFallback: { enabled: boolean; ageSpread: number; maxMiles: number };
  reprobeAfterDays: number;
  learned: { enabled: boolean };
  congestion: {
    perMemberPerTick: number;
    debtWeight: number; debtCap: number;
    scarceDegree: number;
    backupMaxDegree: number;
  };
  pacing: { likedDateDays: number };
  radiusMargin: number;
  maxAsksPerField: number;
  widen: { enabled: boolean; maxDegree: number; miles: number };
  appearance: {
    minConfidence: number;
    bodyType: { enabled: boolean; revealedShrink: number; minConfidence: number };
  };
  minValue: number;
}

export const SLOP_DEFAULT_OPTIONS: SlopPackOptions = {
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
  learned: { enabled: true },
  congestion: { perMemberPerTick: 1, debtWeight: 0.02, debtCap: 3, scarceDegree: 6, backupMaxDegree: 0 },
  pacing: { likedDateDays: 10 },
  radiusMargin: 0.9,
  minValue: 0,
  maxAsksPerField: 2,
  appearance: {
    minConfidence: 0.3,
    bodyType: { enabled: true, revealedShrink: 3, minConfidence: 0.4 },
  },
  widen: { enabled: true, maxDegree: 2, miles: 25 },
};

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
