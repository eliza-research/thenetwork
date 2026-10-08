// The Network's enjoyment calibrator knots (networkPack.attention.calibrator), moved verbatim from
// attention.ts. Data fitted on Network sim labels (seeds 101-104); every pack fits its own.
import type { Category } from "@thenetwork/core";

export const DEFAULT_ENJOY_KNOTS: [number, number][] = [[0.3, 0.424], [0.382, 0.539], [0.427, 0.545], [0.443, 0.673], [0.488, 0.764]];
export const DEFAULT_ENJOY_BY_CATEGORY: Partial<Record<Category, [number, number][]>> = {
  social: [[0.299, 0.486], [0.384, 0.497], [0.43, 0.532], [0.472, 0.723]],
  romance: [[0.386, 0.714], [0.489, 0.809]],
  hobby: [[0.355, 0.57], [0.426, 0.721], [0.504, 0.927]],
  professional: [[0.335, 0.174], [0.393, 0.391], [0.455, 0.489]],
};
