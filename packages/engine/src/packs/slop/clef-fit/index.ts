// Fitting, extraction and audit for the Clef appearance decision model (P2). See
// docs/results/2026-10-09-clef-fitting.md for the method and the operator runbook; the CLI is
// scripts/clef-fit.ts (`bun run clef <fit|calibrate|features|audit|synth>`).
export * from "./fit.ts";
export * from "./audit.ts";
export * from "./features.ts";
