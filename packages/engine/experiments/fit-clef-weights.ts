// Fit the Clef appearance decision model from labelled pairs (offline; no network calls).
//
//   bun run packages/engine/experiments/fit-clef-weights.ts \
//     --features features.jsonl   # {"id": "<member or photo id>", "x": {"rate.face": 0.62, ...}} per line
//     --pairs pairs.jsonl         # {"a": "<id>", "b": "<id>", "dim": "face|body|overall", "winner": "a|b"} per line
//     [--population pop.jsonl]    # rows to calibrate on (default: the feature rows)
//     --version v1-2026-11 --notes "1,200 pairs, 3 raters per pair, audited by group" --out weights.json
//
// Feature rows come from WorkersAIClefRater.features() (packages/engine/src/packs/slop/clef.ts) run
// on consented photos of verified adults only. Point the platform at the result with CLEF_WEIGHTS_PATH.
import { calibrateClefWeights, fitClefWeights, type LabelledPair } from "../src/packs/slop/fitClef.ts";

const argv = process.argv;
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const jsonl = async <T>(p: string) => (await Bun.file(p).text()).split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T);

const fp = arg("features"), pp = arg("pairs"), out = arg("out");
if (!fp || !pp || !out) { console.error("usage: --features f.jsonl --pairs p.jsonl --out weights.json [--population pop.jsonl] [--version v] [--notes text] [--l2 0.01]"); process.exit(2); }
const rows = new Map((await jsonl<{ id: string; x: Record<string, number> }>(fp)).map(r => [r.id, r.x]));
const pairs = await jsonl<LabelledPair>(pp);
let { weights, report } = fitClefWeights(rows, pairs, { version: arg("version") ?? `fit-${new Date().toISOString().slice(0, 10)}`, notes: arg("notes") ?? "", l2: Number(arg("l2") ?? 0.01) });
const pop = arg("population");
if (pop) weights = calibrateClefWeights(weights, (await jsonl<{ x: Record<string, number> }>(pop)).map(r => r.x));
await Bun.write(out, JSON.stringify(weights, null, 2));
console.log(JSON.stringify(report, null, 2));
