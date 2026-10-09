// The Clef relay classifier: live evaluation and calibration (operator CLI). docs/results/2026-10-09-relay.md section 6.
// Only `--live` calls Cloudflare Workers AI, and only with CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID
// set. Every Clef answer is cached in evals/relay/clef-answers.jsonl (keyed by a hash; no text), so a
// second run, the fit and `bun run sim` read the cache. Reports are aggregates only: no message text.
//
//   bun run relay-eval [--model clef-flash|clef] [--weights evals/relay/clef-relay-weights.json]
//       Offline: the cost estimate for the missing answers, and the report from the cache (if any).
//   bun run relay-eval --live [--model clef-flash] [--budget-usd 1] [--concurrency 4] [--timeout-ms 15000]
//       Fill missing answers for every corpus (tuning sets, heldout-2, benign-adult), then report:
//       per category recall and precision on the tuning sets (5-fold cross-validated) vs heldout-2,
//       the false-hold rate on honest messages, for direct-only, question bank and both, and the cost.
//   bun run relay-eval fit --live [--model clef-flash] [--out evals/relay/clef-relay-weights.json]
//       [--mode auto|direct|bank|both] [--max-false-hold 0.02] [--l2 0.003] [--budget-usd 1]
//       Fill missing TUNING answers, compare the three modes by cross-validation on the tuning sets,
//       fit the best (or --mode) on all tuning rows and write the weights. heldout-2 is never fitted
//       on; it is scored (from the cache, filled with the tuning rows) and reported.
//   Without --live, `fit` prints the plan and the cost estimate and exits.
import { appendFile } from "node:fs/promises";
import { CLEF_MODEL_IDS, type ClefModel } from "../packages/engine/src/packs/slop/clef.ts";
import { clefRelayClassifier, DEFAULT_RELAY_CLEF_WEIGHTS, estimateRelayClefTokens, loadRelayClefWeights, RELAY_CLEF_BANK_VERSION, RELAY_CLEF_MODES, relayClefCost, relayClefKey, type RelayClefCacheRow, type RelayClefEvent, type RelayClefMode, type RelayClefWeights } from "../packages/engine/src/relayClef.ts";
import { compareRelayClefModes, fitRelayClefWeights, formatArm, RELAY_CLEF_FITTER, scoreArms, type RelayFitRow } from "../packages/engine/src/relayClefFit.ts";
import { BENIGN_FILE, CLEF_CACHE, CLEF_WEIGHTS, fitRows, HELDOUT_FILE, loadClefCache, loadCorpus, TUNING_FILES, type CorpusRow } from "./relay-clef-lib.ts";

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : "eval";
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k: string) => argv.includes(`--${k}`);
function die(msg: string, code = 2): never { console.error(msg); process.exit(code); }
const num = (k: string, d: number) => { const v = arg(k); if (v === undefined) return d; const n = Number(v); if (!Number.isFinite(n)) die(`--${k} must be a number`); return n; };
const usd = (x: number) => `$${x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;

if (!["eval", "fit"].includes(cmd)) die(`unknown command ${cmd}; usage: see scripts/relay-eval.ts`);
const modelArg = arg("model") ?? "clef-flash";
if (!(modelArg in CLEF_MODEL_IDS)) die("--model must be clef-flash or clef");
const model = modelArg as ClefModel;
const cachePath = arg("cache") ?? CLEF_CACHE;
const live = has("live");

const tuning: { file: string; rows: CorpusRow[] }[] = [];
for (const f of TUNING_FILES) tuning.push({ file: f, rows: await loadCorpus(f) });
const heldout = await loadCorpus(HELDOUT_FILE);
const benign = await loadCorpus(BENIGN_FILE);
const tuningRows = tuning.flatMap(t => t.rows);
const toFill = cmd === "fit" ? [...tuningRows, ...heldout] : [...tuningRows, ...heldout, ...benign];

let cache = (await loadClefCache(cachePath)) ?? new Map<string, RelayClefCacheRow>();
const missing = [...new Map(toFill.filter(r => !cache.has(relayClefKey(model, r.text.trim()))).map(r => [r.text.trim(), r])).values()];
const estTokens = missing.reduce((s, r) => s + estimateRelayClefTokens(r.text.trim()), 0);
const estUsd = relayClefCost(estTokens, model);
const perMsg = estimateRelayClefTokens("I'm running about ten minutes late, grab us a table?", ["Riley says: \"see you at 7!\"", "Sam says: \"can't wait\""]);
console.log(`model ${CLEF_MODEL_IDS[model]}, question bank ${RELAY_CLEF_BANK_VERSION}, cache ${cachePath} (${cache.size} rows)`);
console.log(`missing answers: ${missing.length} of ${toFill.length} rows; estimate ${estTokens.toLocaleString()} input tokens, ${usd(estUsd)} (${model}, input tokens only)`);
console.log(`production estimate: about ${perMsg} input tokens per relayed message with context, ${usd(relayClefCost(perMsg, model) * 1000)} per 1,000 messages`);

if (missing.length && !live) {
  console.log(cmd === "fit"
    ? "\nfit runs only with --live (and CLOUDFLARE_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID). Plan above; nothing was called."
    : "\nno --live: nothing was called. Re-run with --live (needs CLOUDFLARE_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID) to fill the cache.");
  if (cmd === "fit" || !cache.size) process.exit(0);
}
if (cmd === "fit" && !live) { console.log("\nfit runs only with --live; the cache is complete, re-run with --live to fit."); process.exit(0); }
if (cmd === "fit" && (!process.env.CLOUDFLARE_AI_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) die("fit needs CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment");

let spentTokens = 0;
if (live && missing.length) {
  const token = process.env.CLOUDFLARE_AI_TOKEN, accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) die("--live needs CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment");
  const budget = num("budget-usd", 1);
  if (estUsd > budget) die(`estimate ${usd(estUsd)} is over --budget-usd ${budget}; raise it to run`);
  const events: RelayClefEvent[] = [];
  const hook = clefRelayClassifier({
    token, accountId, model, timeoutMs: num("timeout-ms", 15000), holdOnUnavailable: false,
    answers: k => { const r = cache.get(k); return r ? { answers: r.answers } : undefined; },
    record: async (key, result) => {
      const row: RelayClefCacheRow = { key, model, bank: RELAY_CLEF_BANK_VERSION, answers: result.answers, ...(result.usage?.input_tokens ? { inputTokens: result.usage.input_tokens } : {}) };
      cache.set(key, row);
      await appendFile(cachePath, `${JSON.stringify(row)}\n`);
    },
    onEvent: e => { events.push(e); if (e.inputTokens) spentTokens += e.inputTokens; },
  });
  let next = 0;
  const worker = async () => { while (next < missing.length) { const r = missing[next++]!; await hook({ text: r.text.trim(), kind: "text", context: [] }); } };
  await Promise.all(Array.from({ length: Math.max(1, num("concurrency", 4)) }, worker));
  const by = (o: string) => events.filter(e => e.outcome === o).length;
  console.log(`live: ${by("ok")} answered, ${by("timeout")} timeouts, ${by("error")} errors; ${spentTokens.toLocaleString()} input tokens reported, ${usd(relayClefCost(spentTokens, model))}`);
  cache = (await loadClefCache(cachePath)) ?? cache;
}

// ------------------------------------------------------------------------------------- report
const tune = fitRows(tuningRows, cache, model), held = fitRows(heldout, cache, model), ben = fitRows(benign, cache, model);
console.log(`\nrows with answers: tuning ${tune.rows.length} (${tune.missing} missing), heldout-2 ${held.rows.length} (${held.missing} missing), benign-adult ${ben.rows.length} (${ben.missing} missing)`);
const cachedTokens = tune.tokens + held.tokens + ben.tokens;
if (cachedTokens) console.log(`cost of the cached answers: ${cachedTokens.toLocaleString()} input tokens, ${usd(relayClefCost(cachedTokens, model))}`);
if (tune.rows.length < 50) die("too few tuning rows with answers to report (need 50)", cmd === "fit" ? 1 : 0);

const headFalseHold = num("max-false-hold", 0.02), l2 = num("l2", 0.003);
const cmp = compareRelayClefModes(tune.rows, { l2, headFalseHold });
const fitted: Record<RelayClefMode, RelayClefWeights> = Object.fromEntries(RELAY_CLEF_MODES.map(m => [m, fitRelayClefWeights(tune.rows, { mode: m, l2, maxFalseHold: headFalseHold })])) as Record<RelayClefMode, RelayClefWeights>;
const report = (label: string, w: RelayClefWeights, cv?: (typeof cmp.modes)[number]) => {
  const h = scoreArms(held.rows, w), b = ben.rows.length ? scoreArms(ben.rows as RelayFitRow[], w) : null;
  console.log(`\n-- ${label}`);
  if (cv) { console.log(formatArm("tuning CV: Clef only", cv.cv.clef)); console.log(formatArm("tuning CV: rules + Clef", cv.cv.combined)); }
  else { const t = scoreArms(tune.rows, w); console.log(formatArm("tuning: Clef only", t.clef)); console.log(formatArm("tuning: rules + Clef", t.combined)); }
  if (held.rows.length) { console.log(formatArm("heldout-2: rules only", h.rules)); console.log(formatArm("heldout-2: Clef only", h.clef)); console.log(formatArm("heldout-2: rules + Clef", h.combined)); }
  if (b) console.log(`benign-adult honest held: rules + Clef ${(b.combined.falseHold * 100).toFixed(1)}% (n ${b.combined.n})`);
};
console.log(`\n${formatArm("tuning: rules only", scoreArms(tune.rows, DEFAULT_RELAY_CLEF_WEIGHTS).rules)}`);
for (const m of cmp.modes) report(`mode ${m.mode}${m.mode === cmp.best ? " (best on tuning CV, Clef alone)" : ""}${m.eligible ? "" : " (over the 5% false-hold limit)"}: weights fitted on all tuning rows for heldout-2`, fitted[m.mode], m);
const shippedPath = arg("weights") ?? CLEF_WEIGHTS;
const shipped = (await Bun.file(shippedPath).exists()) ? await loadRelayClefWeights(shippedPath) : DEFAULT_RELAY_CLEF_WEIGHTS;
report(`shipped weights ${shipped.version} (mode ${shipped.mode}; in-sample on tuning when fitted on it)`, shipped);

if (cmd === "fit") {
  const modeArg = arg("mode") ?? "auto";
  if (modeArg !== "auto" && !RELAY_CLEF_MODES.includes(modeArg as RelayClefMode)) die("--mode must be auto, direct, bank or both");
  const mode = modeArg === "auto" ? cmp.best : (modeArg as RelayClefMode);
  const date = new Date().toISOString().slice(0, 10);
  const w: RelayClefWeights = {
    ...fitted[mode],
    version: `relay-clef-${mode}-${date}`,
    provenance: {
      fitter: RELAY_CLEF_FITTER, fittedAt: date, rows: tune.rows.length, files: [...TUNING_FILES], model,
      notes: `mode ${mode} (${modeArg === "auto" ? "best of direct, bank, both by 5-fold CV on the tuning sets" : "chosen with --mode"}); heldout-2 not fitted on`,
      report: { cv: cmp.modes.map(m => ({ mode: m.mode, score: m.score, eligible: m.eligible, falseHold: m.cv.combined.falseHold, recall: m.cv.combined.recall })), heldout2: held.rows.length ? scoreArms(held.rows, fitted[mode]).combined : null },
    },
  };
  const out = arg("out") ?? CLEF_WEIGHTS;
  await Bun.write(out, `${JSON.stringify(w, null, 1)}\n`);
  console.log(`\nwrote ${out} (${w.version}); \`bun run sim --only relay\` now scores the Clef arm with it`);
}
