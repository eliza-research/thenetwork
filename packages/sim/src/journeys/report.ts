import { writePath } from "../../../core/src/runtime/files.ts";
import type { JourneyOutcome, JourneyTelemetry } from "./rubric.ts";

export interface JourneySimSummary {
  readonly seed: number;
  readonly mode: "offline" | "live_llm";
  readonly elapsedMs: number;
  readonly digest: string;
  readonly cohortCount: number;
  readonly stylesCovered: number;
  readonly ageBracketsCovered: number;
  readonly clarityBandsCovered: number;
  readonly strataCovered: number;
  readonly channelsCovered: number;
  readonly passedJourneys: number;
  readonly totalJourneys: number;
  readonly totalLeaks: number;
  readonly totalRankingLeaks: number;
  readonly telemetry: JourneyTelemetry;
  readonly llmSkippedReason?: string;
  readonly llmGradedCount: number;
  readonly llmRubricPassCount: number;
  readonly outcomes: readonly JourneyOutcome[];
}

export interface JourneyReportMeta {
  readonly command: string;
  readonly model?: string;
  readonly requestSettings?: string;
}

function wilson95(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return [
    Math.max(0, Number((center - margin).toFixed(4))),
    Math.min(1, Number((center + margin).toFixed(4))),
  ];
}

function redactForReport(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{8,14}\d/g, "[redacted-phone]");
}

export function formatJourneyMarkdownReport(
  summary: JourneySimSummary,
  meta: JourneyReportMeta,
): string {
  const [lo, hi] = wilson95(summary.passedJourneys, summary.totalJourneys);
  const t = summary.telemetry;
  const localCacheTotal = t.llmCacheHits + t.llmCacheMisses;
  const localHitRate = localCacheTotal > 0 ? ((t.llmCacheHits / localCacheTotal) * 100).toFixed(1) : "0.0";
  const providerCacheRate =
    t.promptTokens > 0 ? ((t.cachedTokens / t.promptTokens) * 100).toFixed(1) : "0.0";

  const lines: string[] = [
    `# Pass 4 Multi-Channel Journey Simulation Report (${summary.mode})`,
    "",
    "## Run Metadata",
    "",
    `- **Command:** \`${meta.command}\``,
    `- **Seed:** \`${summary.seed}\``,
    `- **Mode:** \`${summary.mode}\``,
    `- **Model:** \`${meta.model ?? (summary.mode === "live_llm" ? "surplus/gpt-6-luna (OpenAI fallback)" : "none (offline deterministic)")}\``,
    `- **Request Settings:** \`${meta.requestSettings ?? (summary.mode === "live_llm" ? "reasoningEffort=low, withLLMCache + LLMBudget" : "offline SimClock + Rng")}\``,
    `- **Sample Size:** ${summary.totalJourneys} journeys, ${summary.cohortCount} stratified personas`,
    `- **Determinism Digest:** \`${summary.digest}\``,
    `- **Elapsed Wall Time:** ${summary.elapsedMs} ms`,
    `- **Generated vs Hand-Written:** Cohort/channel scenarios are hand-written; policy predicates (` +
      "`qualityAndLeague`, `friendIntroAge`, `marketingPolicy`) are Vibestack-generated.",
    "",
    "## Coverage & Invariant Summary",
    "",
    "| Metric | Value | Target |",
    "|---|---:|---:|",
    `| Journeys Passed | ${summary.passedJourneys}/${summary.totalJourneys} (95% Wilson CI [${(lo * 100).toFixed(1)}%, ${(hi * 100).toFixed(1)}%]) | 100% |`,
    `| Speaking Styles Covered | ${summary.stylesCovered} | 14 |`,
    `| Age Brackets Covered | ${summary.ageBracketsCovered} | 6 |`,
    `| Clarity Bands Covered | ${summary.clarityBandsCovered} | 4 |`,
    `| Status Strata Covered | ${summary.strataCovered} | 6 |`,
    `| Channels Covered (In-Net + 10 Ext) | ${summary.channelsCovered} | 14 |`,
    `| Total Privacy / Canary Leaks | ${summary.totalLeaks} | 0 |`,
    `| Internal Ranking / Status Leaks | ${summary.totalRankingLeaks} | 0 |`,
    "",
  ];

  if (summary.mode === "live_llm") {
    const [rLo, rHi] = wilson95(summary.llmRubricPassCount, summary.llmGradedCount);
    lines.push(
      "## Live-LLM Cost, Prompt-Cache & Quality Telemetry",
      "",
      ...(summary.llmSkippedReason ? [`- **Note:** Live-LLM arm skipped (\`${summary.llmSkippedReason}\`).`, ""] : []),
      "| Telemetry Field | Value |",
      "|---|---:|",
      `| LLM HTTP Calls | ${t.llmCalls} |`,
      `| Local Cache Hits / Misses / Coalesced | ${t.llmCacheHits} / ${t.llmCacheMisses} / ${t.llmCacheCoalesced} (${localHitRate}% hit rate) |`,
      `| Prompt Tokens / Provider Cached / Cache Write | ${t.promptTokens} / ${t.cachedTokens} / ${t.cacheWriteTokens} (${providerCacheRate}% prefix-cached) |`,
      `| Completion / Reasoning Tokens | ${t.completionTokens} / ${t.reasoningTokens} |`,
      `| Total Cost (USD) | $${(t.costMicro / 1_000_000).toFixed(6)} |`,
      `| Provider Fallbacks | ${t.fallbackCount} |`,
      `| Budget Exhausted | ${t.budgetExhausted} |`,
      `| Live Rubric Pass Rate | ${summary.llmRubricPassCount}/${summary.llmGradedCount} (95% Wilson CI [${(rLo * 100).toFixed(1)}%, ${(rHi * 100).toFixed(1)}%]) |`,
      "",
    );
  }

  lines.push(
    "## Journey Matrix Results",
    "",
    "| ID | Category | Channel | Pass | Leaks | Summary |",
    "|---|---|---|---:|---:|---|",
  );
  for (const o of summary.outcomes) {
    lines.push(
      `| ${o.id} | ${o.category} | ${o.channel} | ${o.pass ? "PASS" : "FAIL"} | ${o.leakCount} | ${o.summary.replace(/\|/g, "/")} |`,
    );
  }

  const rubricGraded = summary.outcomes.filter(o => o.llmRubric !== undefined);
  if (rubricGraded.length > 0) {
    lines.push(
      "",
      "## Live-LLM 5-Dimension Quality Rubric Breakdown",
      "",
      "| Journey | Naturalness | Friction | Helpfulness | Non-Annoyance | Zero-Leak | Pass |",
      "|---|---:|---:|---:|---:|---:|---:|",
    );
    for (const o of rubricGraded) {
      const r = o.llmRubric!;
      lines.push(
        `| ${o.id} | ${r.naturalness}/5 | ${r.frictionCount} | ${r.helpfulness}/5 | ${r.nonAnnoyance}/5 | ${r.zeroLeak} | ${r.pass ? "PASS" : "FAIL"} |`,
      );
    }
  }

  lines.push("", "## Sample Redacted Trajectories", "");
  for (const o of summary.outcomes.slice(0, 6)) {
    lines.push(`### ${o.id}: ${o.title} (${o.channel})`, "");
    for (const turn of o.transcript.slice(0, 6)) {
      lines.push(`- **${turn.from} -> ${turn.to}:** ${redactForReport(turn.text)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function writeJourneyReport(
  summary: JourneySimSummary,
  outMdPath: string,
  meta: JourneyReportMeta,
): Promise<{ mdPath: string; jsonPath: string }> {
  const md = formatJourneyMarkdownReport(summary, meta);
  const jsonPath = outMdPath.endsWith(".md") ? `${outMdPath.slice(0, -3)}.json` : `${outMdPath}.json`;
  await writePath(outMdPath, md);
  await writePath(jsonPath, JSON.stringify({ meta, summary }, null, 2));
  return { mdPath: outMdPath, jsonPath };
}
