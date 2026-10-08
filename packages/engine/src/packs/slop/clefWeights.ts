// The decision model on top of Clef's answers (clef.ts): pluggable weights.
//
//   head      z_d = (b_d + sum_f w_d[f] x[f] - mean_d) / sd_d     for d in face, body, overall
//   gate      photos with P(exactly one adult) < gate.oneAdult are dropped
//   bodyType  argmax of Clef's body-type choice probabilities, if >= bodyType.minProb
//
// DEFAULT_CLEF_WEIGHTS is a DOCUMENTED PLACEHOLDER, not a fitted model: each dimension reads Clef's
// own zero-shot rating question for that dimension (overall also averages face and body), and the
// calibration assumes the 7-level answers centre on "typical" with SD of about 1.2 levels. Replace it
// with weights fitted on labelled pairs from our own raters (fitClef.ts; CLI
// packages/engine/experiments/fit-clef-weights.ts), then re-run `calibrateClefWeights` on the live
// member population so 0 = the population mean and 1 = one population SD. Load a fitted file with
// `loadClefWeights(path)` (env CLEF_WEIGHTS_PATH on the platform).

export interface ClefHead { w: Record<string, number>; b: number }
export interface ClefWeights {
  version: string;
  /** True for the shipped placeholder; fitted files set false and record their training data. */
  placeholder: boolean;
  /** Provenance: what the head was fitted on (pairs, raters, date), or why it is a placeholder. */
  notes: string;
  heads: { face: ClefHead; body: ClefHead; overall: ClefHead };
  calibration: { face: { mean: number; sd: number }; body: { mean: number; sd: number }; overall: { mean: number; sd: number } };
  gate: { oneAdult: number };
  bodyType: { minProb: number };
  /** Confidence multiplier (fitted files may raise it) and the spread assumed for a single photo. */
  confidence: { scale: number; singlePhotoSpread: number };
}

// 7 levels scaled to 0..1: "typical" = 0.5; one level = 1/6, so SD 1.2 levels = 0.2.
export const DEFAULT_CLEF_WEIGHTS: ClefWeights = {
  version: "placeholder-0",
  placeholder: true,
  notes: "Placeholder: Clef's zero-shot rating per dimension, calibrated by assumption (mean 0.5, sd 0.2). Not fitted on any labels. Fit with fitClef.ts and recalibrate on the member population before relying on it.",
  heads: {
    face: { w: { "rate.face": 1 }, b: 0 },
    body: { w: { "rate.body": 1 }, b: 0 },
    overall: { w: { "rate.overall": 0.5, "rate.face": 0.25, "rate.body": 0.25 }, b: 0 },
  },
  calibration: { face: { mean: 0.5, sd: 0.2 }, body: { mean: 0.5, sd: 0.2 }, overall: { mean: 0.5, sd: 0.2 } },
  gate: { oneAdult: 0.5 },
  bodyType: { minProb: 0.45 },
  confidence: { scale: 1, singlePhotoSpread: 0.6 },
};

export function validateClefWeights(w: ClefWeights): ClefWeights {
  for (const d of ["face", "body", "overall"] as const) {
    const h = w.heads?.[d], c = w.calibration?.[d];
    if (!h || typeof h.b !== "number" || !h.w || Object.values(h.w).some(x => !Number.isFinite(x))) throw new Error(`clef weights: bad head ${d}`);
    if (!c || !Number.isFinite(c.mean) || !(c.sd > 0)) throw new Error(`clef weights: bad calibration ${d}`);
  }
  if (!w.version) throw new Error("clef weights: version required");
  return w;
}

/** Load a weights JSON file (as written by the fit CLI). */
export async function loadClefWeights(path: string): Promise<ClefWeights> {
  return validateClefWeights(JSON.parse(await Bun.file(path).text()) as ClefWeights);
}
