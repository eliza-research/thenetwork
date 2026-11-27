export type HumorRegister = "dry_ironic" | "absurdist" | "warm_earnest" | "nerdy_wordplay" | "roast_banter";
export const HUMOR_REGISTERS: readonly HumorRegister[] = [
  "dry_ironic", "absurdist", "warm_earnest", "nerdy_wordplay", "roast_banter",
];

export type SpendComfortTier = "free" | "low" | "moderate" | "high" | "unconstrained";
export const SPEND_TIERS: readonly SpendComfortTier[] = [
  "free", "low", "moderate", "high", "unconstrained",
];

export interface DunbarOpenSlots {
  inner5: boolean;
  sympathy15: boolean;
  affinity50: boolean;
}

export function spendTierIndex(tier: SpendComfortTier): number {
  const idx = SPEND_TIERS.indexOf(tier);
  return idx >= 0 ? idx : 2;
}

export function extractiveGroupDrag(
  ownExtraction: number,
  maxOtherExtraction: number,
  groupSize: number,
  threshold = 0.65,
  ownCeiling = 0.45,
  penalty = 0.18,
): number {
  return groupSize >= 3 && maxOtherExtraction >= threshold && ownExtraction < ownCeiling ? penalty : 0;
}
