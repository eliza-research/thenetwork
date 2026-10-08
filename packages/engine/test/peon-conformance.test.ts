// peonPack passes the shared per-pack conformance suite (test/conformance.ts) on peon-shaped worlds
// (the default network testkit world has no jobs, so the positive control needs a hiring world).
import { PEON_ENGINE_CONFIG, peonPack } from "../src/packs/peon/index.ts";
import { peonTestWorld } from "../src/packs/peon/testkit.ts";
import { runConformance } from "./conformance.ts";

runConformance(peonPack, { world: seed => peonTestWorld({ seed, candidates: 90, jobs: 20, minorShare: 0.15 }), cfg: PEON_ENGINE_CONFIG });
