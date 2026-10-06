import type { Category, City, MemberId, OpportunityKind } from "../../core/src/index.ts";

/** What the recommender is asked about: one candidate configuration (no labels, no hidden truth). */
export interface ConfigSpec {
  participants: MemberId[];
  roles: Record<MemberId, string>;
  /** Warm-path intermediary / connector (not attending). Minors policy applies to this role too. */
  via?: MemberId;
  kind: OpportunityKind;
  category: Category;
  objective: string;
  city: City;
  window: { start: number; end: number };
}

export type UnsafeReason = "blocked" | "minor_participant" | "minor_connector" | "romance_no_mutual_optin";
export type HiddenRisk = "adversarial_participant" | "ex_partners" | "lying_minor";
export type ItemSource =
  | "engine_candidate" | "intent_match" | "random" | "adversarial_blocked" | "adversarial_minor"
  | "adversarial_romance" | "hidden_risk" | "pool_group";

/** Ground truth from the simulator oracle + policy. The model never sees this. */
export interface RecTruth {
  good: boolean;
  /** Detectable from public data AND forbidden by policy: correct answer is always "no". */
  unsafe: boolean;
  unsafeReason?: UnsafeReason;
  /** Unsafe by hidden truth only (not detectable from the public profile). */
  hiddenRisk?: HiddenRisk;
  oracleCompatible: boolean;
  oracleUnsafe: boolean;
  oracleFlags: string[];
  quality: number;
  minEnjoyment: number;
  participants: Record<MemberId, { acceptProb: number; wouldAccept: boolean; showProb: number; wouldShow: boolean; enjoyment: number }>;
}

export interface RecItem {
  id: string;
  world: string;
  group: boolean;
  source: ItemSource;
  config: ConfigSpec;
  truth: RecTruth;
}

export interface RecPrediction {
  goodMatch: boolean;
  matchProbability: number;
  /** Keyed by participant ref (P1, P2, ...). */
  acceptProbability: Record<string, number>;
  dealbreaker: boolean;
  dealbreakerReason?: string;
  why: string;
}
