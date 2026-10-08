// Capture golden artifacts (run on a clean tree at the baseline commit).
//   bun packages/engine/test/goldens/capture.ts            # fast tier -> fast.json
//   bun packages/engine/test/goldens/capture.ts --full     # full tier -> full.json (nightly; minutes of CPU)
// Keys are unset for the subprocesses; no LLM calls are made.
import { computeTier, FAST, FULL } from "./compute.ts";

const full = process.argv.includes("--full");
const t0 = performance.now();
const out = await computeTier(full ? FULL : FAST);
const file = `${import.meta.dir}/${full ? "full" : "fast"}.json`;
await Bun.write(file, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${file} (${Object.keys(out).join(", ")}) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
