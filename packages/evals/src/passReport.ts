// Markdown report for the judgment-passes suite (docs/results/2026-10-06-judge-passes.md).
import { compareToBaseline, type PassesScores, type RowScore } from "./passScore.ts";
import { datasetComposition } from "./recDataset.ts";
import { PROXY_ORDER, TIERS } from "./richness.ts";
import type { PassItemResult } from "./runPasses.ts";
import type { RecItem } from "./types.ts";
import { wilson } from "./metrics.ts";

const pct = (x: number, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : "n/a");
const sec = (x: number) => (Number.isFinite(x) ? `${(x / 1000).toFixed(1)}s` : "n/a");
const usd = (micro: number) => `$${(micro / 1e6).toFixed(micro < 1e5 ? 4 : 3)}`;
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`;
const pv = (p: number) => (p < 0.001 ? "<0.001" : p.toFixed(3));
const ci = (k: number, n: number) => { const [a, b] = wilson(k, n); return `${pct(a, 0)}-${pct(b, 0)}`; };

function table(head: string[], rows: (string | number)[][]): string {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map(r => `| ${r.join(" | ")} |`)].join("\n");
}

export interface PassesReportInput {
  model: string; settings: Record<string, unknown>;
  items: RecItem[]; results: PassItemResult[]; scores: PassesScores; freshSpendMicro: number;
  worlds: string; command: string; resultsStem: string; richness: boolean;
}

export function renderPassesReport(inp: PassesReportInput): string {
  const { scores: S, items } = inp;
  const gold = items.map(i => i.truth.good);
  const base = S.baseline!;
  const row = (name: string) => S.rows.find(r => r.name === name)!;
  const all: RowScore[] = [base, ...S.rows, ...S.references];
  const L: string[] = [];
  const comp = datasetComposition(items);
  L.push(`# Judgment passes: explanation-first passes 1-2 and a deep third pass (2026-10-06)`, "");
  L.push(`Model: **${inp.model}** on Surplus for every pass (founder decision: gpt-6-luna for everything). Request settings: \`${JSON.stringify(inp.settings)}\`.`, "");
  L.push(`Reproduce: \`${inp.command}\` (responses are cached under \`runs/evals/cache/\`, so reruns are free).`, "");
  L.push(`Dataset: ${comp.total} recommender items (${comp.pairs} pairs, ${comp.groups} groups; ${comp.good} good, ${comp.unsafe} policy-unsafe, ${comp.hiddenRisk} hidden-risk). Worlds: ${inp.worlds}.`, "");
  L.push(`<!-- NARRATIVE -->`, "");

  L.push(`## Results per pass`, "");
  L.push(`Accuracy, precision, recall and F1 count "insufficient information" as "no" and a failed call as wrong. AUC, Brier and ECE use each pass's \`match_probability\` (failed calls excluded). "+ hard gate" rows apply the deterministic gate (minors in any role, blocks, safety holds, category and romance opt-ins) after the model; the model can never override it. Pipeline rows stop at the first "no"; a failed call is skipped (fails open), as in the engine. Latency is per item (all calls the row needs); "deployed cost" counts only the calls a gated pipeline would make.`, "");
  L.push(table(["Row", "Accuracy (95% CI)", "Precision", "Recall", "F1", "AUC", "Brier", "ECE", "Insufficient info", "Coverage", "Failures", "Explanation first", "Latency p50 / p95", "Eval cost", "Deployed cost"],
    all.map(r => [r.name, `${pct(r.asNo.accuracy)} (${ci(r.correct.filter(Boolean).length, r.n)})`, pct(r.asNo.precision), pct(r.asNo.recall), f3(r.asNo.f1), f3(r.auc), f3(r.brier), f3(r.ece),
      pct(r.abstainRate), pct(r.coverage), r.failures, Number.isFinite(r.reasoningFirstRate) ? pct(r.reasoningFirstRate, 0) : "-",
      r.calls ? `${sec(r.latencyP50)} / ${sec(r.latencyP95)}` : "-", r.calls ? usd(r.costMicro) : "$0", r.calls ? usd(r.deployedCostMicro) : "$0"])), "");

  L.push(`### Significance vs the previous single-pass luna result`, "");
  L.push(`Paired on the same ${items.length} items. McNemar = exact test on per-item correctness. Precision / F1 / accuracy deltas: paired bootstrap (2,000 resamples), 95% percentile interval and two-sided p. The baseline row is the original single-pass \`rec-eval-v1\` prompt run on this same dataset${inp.richness ? " (the richness-tier data is new, so the baseline was re-run on it; its 67.8% in the model comparison was on the older full-profile data)" : " (replayed from cache: identical requests and responses to the 2026-10-06 model comparison)"}.`, "");
  L.push(table(["Row", "Accuracy delta (95% CI)", "Only row right / only baseline right", "McNemar p", "Precision delta (95% CI)", "p", "F1 delta (95% CI)", "p"],
    [...S.rows, ...S.references].map(r => {
      const c = compareToBaseline(r, base, gold);
      return [r.name, `${pp(c.accuracy.diff)} (${pp(c.accuracy.lo)} to ${pp(c.accuracy.hi)})`, `${c.onlyRow} / ${c.onlyBase}`, pv(c.mcnemarP),
        `${pp(c.precision.diff)} (${pp(c.precision.lo)} to ${pp(c.precision.hi)})`, pv(c.precision.p), `${(c.f1.diff >= 0 ? "+" : "") + c.f1.diff.toFixed(3)} (${c.f1.lo.toFixed(3)} to ${c.f1.hi.toFixed(3)})`, pv(c.f1.p)];
    })), "");

  L.push(`### Abstentions ("insufficient information", pass 3 only)`, "");
  for (const name of ["pass3 (model only)", "pass3 + hard gate", "pipeline: gate > 1 > 2 > 3"]) {
    const r = row(name);
    L.push(`- **${name}:** insufficient-info rate ${pct(r.abstainRate)} (${r.abstentions}/${r.n}); on gold-good items ${pct(r.abstainRateOnGood)}, on gold-bad items ${pct(r.abstainRateOnBad)}. Abstain = no: precision ${pct(r.asNo.precision)}, recall ${pct(r.asNo.recall)}. Selective (answered items only, coverage ${pct(r.coverage)}): accuracy ${pct(r.selective.accuracy)}, precision ${pct(r.selective.precision)}, recall ${pct(r.selective.recall)}. Coverage-adjusted precision (precision x coverage) ${pct(r.coverageAdjustedPrecision)}.`);
  }
  L.push("", `Precision is the same under "abstain = no" and "answered only" because an abstention is never a positive prediction; what abstaining changes is recall and coverage, which is why coverage-adjusted precision is reported next to it.`, "");
  if (S.questions.length) {
    L.push(`Sample of questions pass 3 asked instead of guessing (first 8; "good" = oracle label):`, "");
    for (const q of S.questions.slice(0, 8)) L.push(`- ${q.itemId} (${q.good ? "good" : "bad"}), to ${q.ref}: "${q.question.replace(/\|/g, "/")}"`);
    L.push("");
  }

  L.push(`## Results by profile richness tier`, "");
  if (S.tiersAvailable) {
    L.push(`Item tier = the thinnest attending participant's tier as exposed by the simulator.`, "");
    L.push(tierTable(all, "byTier", [...TIERS]), "");
  } else {
    L.push(`**The simulator did not expose richness tiers on this dataset**, so this section uses a PROXY: the number of visible (matchable + shareable) facts of the thinnest attending participant. It is not the tier definition and should be replaced once tiers land.`, "");
  }
  L.push(`Proxy buckets (visible facts of the thinnest attending participant):`, "");
  L.push(tierTable(all, "byProxy", PROXY_ORDER), "");

  L.push(`## Calibration (reliability of match_probability)`, "");
  const calRows = [base, row("pass1 (model only)"), row("pass2 (model only)"), row("pass3 (model only)")];
  L.push(table(["Bin", ...calRows.map(r => r.name)], Array.from({ length: 10 }, (_, b) => [`${(b / 10).toFixed(1)}-${((b + 1) / 10).toFixed(1)}`,
    ...calRows.map(r => { const x = r.reliability[b]!; return x.n ? `${pct(x.rate, 0)} good (n=${x.n})` : "-"; })])), "");

  L.push(`## Safety and privacy`, "");
  L.push(table(["Row", "Policy-unsafe rejected", "Hidden-risk rejected", "Acc. excl. policy items"],
    all.map(r => [r.name, `${r.unsafeRejected}/${r.unsafeN}`, `${r.hiddenRejected}/${r.hiddenN}`, pct(r.nonPolicyAccuracy)])), "");
  L.push(`- Gate overrides attempted (model said "yes" on an item the hard gate rejects; the gate wins every time): pass 1 ${S.gateOverridesAttempted.pass1}, pass 2 ${S.gateOverridesAttempted.pass2}, pass 3 ${S.gateOverridesAttempted.pass3}. Pass 2's prompt (unchanged engine input) does not show ages, blocks or opt-ins, because in the engine it only ever sees candidates that already passed the hard filters.`);
  L.push(`- Gold-good items the gate rejects (opt-in rules the oracle does not model): ${S.gateRejectsGood}.`);
  L.push(`- Member-facing text, raw model output -> after the deterministic leak gate:`, "");
  L.push(table(["Pass", "Canary leaks", "Sensitive-fact leaks", "Do-not-quote words (ME-003)", "Contact/impersonation rules", "Texts rejected by gate", "Canary after gate", "Sensitive after gate"],
    (["pass1", "pass2", "pass3"] as const).map(p => { const x = S.leaks[p]; return [p, x.canary, x.sensitive, x.scope, x.rules, x.gateRejected, x.afterGateCanary, x.afterGateSensitive]; })), "");
  L.push(`- Canary tokens in internal reasoning across all passes: ${S.internalCanaries} (canaries are redacted before any prompt, so this must be 0). Pass 3 sees agent_private context (boundaries, private disclosures) for internal judgment; its member-facing text and clarifying questions go through the same leak gate, which rejects any word found only in non-shareable or private facts.`, "");

  L.push(`## Cost and latency`, "");
  const tok = (r: RowScore) => `${r.tokens.prompt.toLocaleString("en-US")} / ${r.tokens.completion.toLocaleString("en-US")} (${r.tokens.reasoning.toLocaleString("en-US")})`;
  L.push(table(["Row", "Calls (deployed)", "Eval cost", "Deployed cost", "Deployed cost per 1,000 configs", "Tokens in / out (reasoning), eval"],
    [base, row("pass1 (model only)"), row("pass2 (model only)"), row("pass3 (model only)"), row("pipeline: gate > 1 > 2"), row("pipeline: gate > 1 > 3"), row("pipeline: gate > 1 > 2 > 3")]
      .map(r => [r.name, r.calls, usd(r.costMicro), usd(r.deployedCostMicro), usd((r.deployedCostMicro / items.length) * 1000), tok(r)])), "");
  L.push(`Fresh spend by the invocation that rendered this report: ${usd(inp.freshSpendMicro)} (Surplus \`usage.buyer_cost_micro\`, summed over every HTTP request incl. retries; cache replays cost $0).`, "");

  L.push(`## Per-item output for error analysis`, "");
  L.push(`- \`${inp.resultsStem}.items.jsonl\`: one JSON object per item (all ${items.length}).`);
  L.push(`- \`${inp.resultsStem}.errors.jsonl\`: the items where the pipeline or any single pass was wrong.`);
  L.push(`- \`${inp.resultsStem}.json\`: raw per-pass results incl. HTTP records; \`${inp.resultsStem}.summary.json\`: the metrics above.`, "");
  L.push("Schema of each line: `{itemId, world, model, label: {good, unsafe, unsafeReason, hiddenRisk, oracleFlags, quality, minEnjoyment}, meta: {group, source, kind, category, objective, tier, proxyBucket}, hardGate, perPassVerdicts: {baseline, pass1, pass2, pass3, pipeline, pipelineStoppedAt}, correct: {baseline, pass1, pass2, pass3, pipeline}, confidence: {baseline, pass1, pass2, pass2Certainty, pass3}, explanations: {baseline, pass1: {reasoning, citedFacts, dealbreaker, memberWhy, reasoningFirst}, pass2: {reasoning, citedFacts, dimensions, dealbreaker, why}, pass3: {evidenceReview, steelmanFor, steelmanAgainst, rubric, wouldThankUs, reasoning, citedFacts, question, memberWhy}}, memberFacingAfterGate, leaks, refs, hidden: {byRef: {P1: {tier, sourceTruth: [{kind, value, source, truth, note}]}}}, visibleProfiles: {pass1, pass2, pass3}}`. `hidden` holds simulator hidden truth (each person's richness tier and the correct / stale / wrong_inference label of every connected-source fact) for error analysis only; it is never part of any prompt. `visibleProfiles` is exactly the user message each pass's model saw (parsed JSON; refs P1..Pn map to member ids via `refs`). Labels live only in this results file, never in a prompt.", "");
  L.push(`<!-- CAVEATS -->`, "");
  return L.join("\n");
}

function tierTable(rows: RowScore[], key: "byTier" | "byProxy", order: string[]): string {
  const keys = order.filter(k => rows.some(r => r[key][k]));
  const pick = rows.filter(r => /single-pass|model only|gate > 1 > 2 > 3|engine-v1/.test(r.name));
  return table(["Row", ...keys.map(k => `${k} (n=${pick[0]?.[key][k]?.n ?? 0})`)],
    pick.map(r => [r.name, ...keys.map(k => { const x = r[key][k]; return x ? `acc ${pct(x.accuracy, 0)}, P ${x.yes ? pct(x.precision, 0) : "-"}, R ${pct(x.recall, 0)}${x.abstain ? `, abst ${x.abstain}` : ""}` : "-"; })]));
}
