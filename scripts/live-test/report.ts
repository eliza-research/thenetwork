import { atomicWriteFileSync } from "./state.ts";
import {
  PHASE_NUMBERS,
  SUITE_NAMES,
  type CaseDefinition,
  type CaseStatus,
  type PhaseNumber,
  type PreflightReport,
  type ReportSummary,
  type ScriptReviewItem,
  type StateFile,
  type SuiteName,
} from "./types.ts";

const ALL_STATUSES: readonly CaseStatus[] = [
  "pending",
  "ready",
  "blocked",
  "running",
  "passed",
  "failed",
  "manual_pending",
  "manual_passed",
  "skipped",
] as const;

export function buildReportSummary(
  manifestCases: readonly CaseDefinition[],
  state: StateFile,
  statePath: string,
  preflight?: PreflightReport,
  now: Date = new Date(),
): ReportSummary {
  const totals = Object.fromEntries(
    ALL_STATUSES.map(s => [s, 0]),
  ) as Record<CaseStatus, number> & { total: number };
  totals.total = manifestCases.length;

  const bySuite = Object.fromEntries(
    SUITE_NAMES.map(s => [
      s,
      { total: 0, passed: 0, failed: 0, blocked: 0, manualPending: 0, pending: 0 },
    ]),
  ) as ReportSummary["bySuite"];

  const byPhase = Object.fromEntries(
    PHASE_NUMBERS.map(p => [
      p,
      { total: 0, passed: 0, failed: 0, blocked: 0, manualPending: 0, pending: 0 },
    ]),
  ) as ReportSummary["byPhase"];

  const preflightById = new Map(preflight?.cases.map(c => [c.id, c]) ?? []);
  const missingEnvCounts = new Map<string, number>();
  const failedCases: ReportSummary["failedCases"] = [];
  const scriptReviewQueue: ScriptReviewItem[] = [];

  let totalCostUsd = 0;
  let totalRequests = 0;
  let totalTokens = 0;

  for (const def of manifestCases) {
    const cp = state.cases[def.id];
    const pf = preflightById.get(def.id);
    const effectiveStatus: CaseStatus =
      cp?.status ??
      (pf?.classification === "blocked"
        ? "blocked"
        : pf?.classification === "manual_pending"
          ? "manual_pending"
          : pf?.classification === "ready"
            ? "ready"
            : "pending");

    totals[effectiveStatus] += 1;

    bySuite[def.suite].total += 1;
    byPhase[def.phase].total += 1;

    if (effectiveStatus === "passed" || effectiveStatus === "manual_passed") {
      bySuite[def.suite].passed += 1;
      byPhase[def.phase].passed += 1;
    } else if (effectiveStatus === "failed") {
      bySuite[def.suite].failed += 1;
      byPhase[def.phase].failed += 1;
    } else if (effectiveStatus === "blocked") {
      bySuite[def.suite].blocked += 1;
      byPhase[def.phase].blocked += 1;
    } else if (effectiveStatus === "manual_pending") {
      bySuite[def.suite].manualPending += 1;
      byPhase[def.phase].manualPending += 1;
    } else {
      bySuite[def.suite].pending += 1;
      byPhase[def.phase].pending += 1;
    }

    if (cp) {
      totalCostUsd += cp.costUsd;
      totalRequests += cp.requests;
      totalTokens += cp.tokens;
    }

    const missingKeys = cp?.missingEnv ?? pf?.missingEnv ?? [];
    for (const k of missingKeys) {
      missingEnvCounts.set(k, (missingEnvCounts.get(k) ?? 0) + 1);
    }

    if (effectiveStatus === "failed" && cp) {
      failedCases.push({
        id: def.id,
        suite: def.suite,
        phase: def.phase,
        attempts: cp.attempts,
        errorSummary: cp.errorSummary,
        logFile: cp.logFile,
      });
    }

    const lowScore = cp?.transcriptScore !== undefined && cp.transcriptScore < 0.85;
    if (cp && (cp.needsScriptReview || lowScore || effectiveStatus === "failed")) {
      const reasons: string[] = [];
      if (effectiveStatus === "failed") reasons.push("failed");
      if (lowScore) reasons.push(`low transcript score (${cp.transcriptScore?.toFixed(2)})`);
      if (cp.needsScriptReview && !reasons.length) reasons.push("flagged for script review");
      scriptReviewQueue.push({
        id: def.id,
        suite: def.suite,
        phase: def.phase,
        status: effectiveStatus,
        reason: reasons.join("; "),
        transcriptScore: cp.transcriptScore,
        logFile: cp.logFile,
        errorSummary: cp.errorSummary,
      });
    }
  }

  const missingEnvFromUser = [...missingEnvCounts.entries()]
    .map(([key, blockedCases]) => ({ key, blockedCases }))
    .sort((a, b) => b.blockedCases - a.blockedCases || a.key.localeCompare(b.key));

  return {
    generatedAt: now.toISOString(),
    runId: state.runId,
    statePath,
    budget: { ...state.budget },
    totals,
    bySuite,
    byPhase,
    telemetry: {
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalRequests,
      totalTokens,
    },
    missingEnvFromUser,
    failedCases,
    scriptReviewQueue,
  };
}

export function renderMarkdownReport(summary: ReportSummary): string {
  const lines: string[] = [];
  lines.push(`# Live-Test Execution Report`);
  lines.push("");
  lines.push(`- **Run ID:** \`${summary.runId}\``);
  lines.push(`- **Generated:** ${summary.generatedAt}`);
  lines.push(`- **State File:** \`${summary.statePath}\``);
  lines.push(
    `- **Budget:** $${summary.budget.spentUsd.toFixed(4)} / $${summary.budget.limitUsd.toFixed(2)} USD | ${summary.budget.requests} / ${summary.budget.maxRequests} requests | ${summary.telemetry.totalTokens.toLocaleString()} tokens`,
  );
  lines.push("");

  lines.push("## Status Totals");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Passed (auto + manual) | ${summary.totals.passed + summary.totals.manual_passed} |`);
  lines.push(`| Failed | ${summary.totals.failed} |`);
  lines.push(`| Ready / Pending | ${summary.totals.ready + summary.totals.pending} |`);
  lines.push(`| Blocked (missing env/infra) | ${summary.totals.blocked} |`);
  lines.push(`| Manual Pending | ${summary.totals.manual_pending} |`);
  lines.push(`| Skipped | ${summary.totals.skipped} |`);
  lines.push(`| **Total** | **${summary.totals.total}** |`);
  lines.push("");

  lines.push("## Breakdown by Suite");
  lines.push("");
  lines.push("| Suite | Total | Passed | Failed | Blocked | Manual Pending | Pending/Ready |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const suite of SUITE_NAMES) {
    const s = summary.bySuite[suite];
    lines.push(
      `| \`${suite}\` | ${s.total} | ${s.passed} | ${s.failed} | ${s.blocked} | ${s.manualPending} | ${s.pending} |`,
    );
  }
  lines.push("");

  lines.push("## Breakdown by Phase");
  lines.push("");
  lines.push("| Phase | Total | Passed | Failed | Blocked | Manual Pending | Pending/Ready |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const phase of PHASE_NUMBERS) {
    const p = summary.byPhase[phase];
    lines.push(
      `| Phase ${phase} | ${p.total} | ${p.passed} | ${p.failed} | ${p.blocked} | ${p.manualPending} | ${p.pending} |`,
    );
  }
  lines.push("");

  lines.push("## Missing Environment Variables Needed From User");
  lines.push("");
  if (summary.missingEnvFromUser.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Env Var | Blocked Cases |");
    lines.push("| --- | ---: |");
    for (const row of summary.missingEnvFromUser) {
      lines.push(`| \`${row.key}\` | ${row.blockedCases} |`);
    }
  }
  lines.push("");

  lines.push("## Failed Cases");
  lines.push("");
  if (summary.failedCases.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Case ID | Suite | Phase | Attempts | Error Summary | Log |");
    lines.push("| --- | --- | ---: | ---: | --- | --- |");
    for (const item of summary.failedCases) {
      const err = (item.errorSummary ?? "n/a").replace(/\|/g, "\\|");
      const log = item.logFile ? `\`${item.logFile}\`` : "n/a";
      lines.push(`| \`${item.id}\` | \`${item.suite}\` | ${item.phase} | ${item.attempts} | ${err} | ${log} |`);
    }
  }
  lines.push("");

  lines.push("## Script-Review Queue");
  lines.push("");
  if (summary.scriptReviewQueue.length === 0) {
    lines.push("Queue is empty.");
  } else {
    lines.push("Review the transcripts/logs below, patch prompts or scripts, then run `pnpm run live-test -- run --retry-failed`:");
    lines.push("");
    lines.push("| Case ID | Suite | Status | Reason | Score | Log |");
    lines.push("| --- | --- | --- | --- | ---: | --- |");
    for (const item of summary.scriptReviewQueue) {
      const score = item.transcriptScore !== undefined ? item.transcriptScore.toFixed(2) : "n/a";
      const log = item.logFile ? `\`${item.logFile}\`` : "n/a";
      lines.push(
        `| \`${item.id}\` | \`${item.suite}\` | \`${item.status}\` | ${item.reason.replace(/\|/g, "\\|")} | ${score} | ${log} |`,
      );
    }
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export function writeMarkdownReport(outPath: string, summary: ReportSummary): string {
  const md = renderMarkdownReport(summary);
  atomicWriteFileSync(outPath, md);
  return md;
}
