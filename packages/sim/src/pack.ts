// The Network's simulator side (AppPack.sim -> SimPack): persona generator, snapshot builder,
// oracle, metrics and launch gates. HARNESS ONLY: the oracle reads hidden truth and must never be
// imported by engine code. The engine is referenced by type only (the sim never imports it at runtime).
import type { MetricsPack, SimPack } from "../../engine/src/pack.ts";
import { ADVERSARIAL_KINDS, generatePersonas, type GeneratorOptions } from "./generator.ts";
import { Oracle } from "./oracle.ts";
import type { Persona } from "./persona.ts";
import { buildSnapshot, type SimSnapshot, type SnapshotState } from "./snapshot.ts";

/** Oracle unsafe classes and blocking gates (judge/src/metrics.ts counters; docs/results network gates). */
export const NETWORK_SIM_METRICS: MetricsPack = {
  primary: ["met_worthwhile_per_seed", "precision", "worthwhile_rate", "v14"],
  gates: [
    { metric: "proposals.unsafe.minor", op: "==", value: 0, seeds: 8, blocking: true },
    { metric: "safety.minorContacts", op: "==", value: 0, seeds: 8, blocking: true },
    { metric: "privacy.canaryLeaks", op: "==", value: 0, seeds: 8, blocking: true },
    { metric: "invariants.violations", op: "==", value: 0, seeds: 8, blocking: true },
  ],
  unsafeClasses: ["minor", "adversarial", "cityMismatch", "romanceMismatch", "exPartners"],
};

export const networkSimPack: SimPack<Persona, SimSnapshot, Oracle> = {
  appId: "ntwrk",
  personas: {
    // Markets map onto the generator's city weights (sf / nyc ids, same key order: byte-identity rule 7).
    generate: o => generatePersonas({ n: o.n, seed: o.seed, ...(o.markets ? { cityWeights: o.markets as GeneratorOptions["cityWeights"] } : {}), ...(o.minorShare !== undefined ? { minorShare: o.minorShare } : {}) } as GeneratorOptions),
  },
  snapshot: (personas, state) => buildSnapshot(personas, state as SnapshotState),
  oracle: (personas, seed, start) => new Oracle(personas, seed, start),
  metrics: NETWORK_SIM_METRICS,
  adversarial: { kinds: ADVERSARIAL_KINDS, rate: 0.06 },
};
