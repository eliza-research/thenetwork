import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  LIVE_TEST_MANIFEST,
  USER_CREDENTIAL_MANIFEST,
  getCaseById,
  manifestSummary,
} from "./manifest.ts";
import { runPreflight } from "./preflight.ts";
import { buildReportSummary, renderMarkdownReport, writeMarkdownReport } from "./report.ts";
import {
  LiveTestSafetyError,
  assertNotProductionMutation,
  assertSafeLiveSend,
  assertWithinBudget,
  parseBudgetConfig,
} from "./safety.ts";
import {
  DEFAULT_LOG_DIR,
  DEFAULT_REPORT_PATH,
  DEFAULT_STATE_PATH,
  loadState,
  markManualCase,
  recordCaseResult,
  resetStateCases,
  saveState,
  selectRunnableCases,
  writeCaseLog,
} from "./state.ts";
import {
  PHASE_NUMBERS,
  SUITE_NAMES,
  type CaseLog,
  type EnvMap,
  type PhaseNumber,
  type SuiteName,
} from "./types.ts";

export interface CliRunOptions {
  argv: string[];
  env?: EnvMap;
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

function getFlagValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const eq = argv.find(a => a.startsWith(prefix));
  if (eq !== undefined) return eq.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < argv.length && !argv[idx + 1]!.startsWith("--")) {
    return argv[idx + 1];
  }
  return undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function parseSuite(raw: string | undefined): SuiteName | undefined {
  if (!raw) return undefined;
  const val = raw.trim().toLowerCase();
  if ((SUITE_NAMES as readonly string[]).includes(val)) {
    return val as SuiteName;
  }
  throw new Error(`Unknown --suite ${JSON.stringify(raw)}. Expected one of: ${SUITE_NAMES.join(", ")}`);
}

function parsePhase(raw: string | undefined): PhaseNumber | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || !(PHASE_NUMBERS as readonly number[]).includes(n)) {
    throw new Error(`Invalid --phase ${JSON.stringify(raw)}. Expected 0..5.`);
  }
  return n as PhaseNumber;
}

function resolveCommand(argv: string[]): { command: string; positional: string[] } {
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") continue;
    if (token.startsWith("--")) {
      if (!token.includes("=")) {
        const next = argv[i + 1];
        const flagName = token.slice(2);
        const valueFlags = new Set([
          "suite",
          "phase",
          "only",
          "budget-usd",
          "max-requests",
          "state",
          "log-dir",
          "out",
          "notes",
          "reset",
          "mark-manual",
        ]);
        if (valueFlags.has(flagName) && next !== undefined && !next.startsWith("--")) {
          i += 1;
        }
      }
      continue;
    }
    positionals.push(token);
  }

  if (positionals.length > 0) {
    return { command: positionals[0]!, positional: positionals.slice(1) };
  }
  if (hasFlag(argv, "dry-run")) return { command: "preflight", positional: [] };
  if (hasFlag(argv, "report")) return { command: "report", positional: [] };
  if (getFlagValue(argv, "reset") !== undefined) {
    return { command: "reset", positional: [getFlagValue(argv, "reset")!] };
  }
  if (getFlagValue(argv, "mark-manual") !== undefined) {
    return { command: "mark-manual", positional: [getFlagValue(argv, "mark-manual")!] };
  }
  if (hasFlag(argv, "help") || hasFlag(argv, "h")) return { command: "help", positional: [] };
  return { command: "preflight", positional: [] };
}

function usageText(): string {
  return [
    "Usage: pnpm run live-test -- <command> [options]",
    "",
    "Commands:",
    "  preflight (or --dry-run)  Classify all cases as ready/blocked/manual_pending without side effects",
    "  run                       Execute ready automated cases with atomic checkpointing & budget caps",
    "  status                    Show checkpoint status totals and budget usage",
    "  report                    Write runs/live-test-report.md (or --out) with Script-Review Queue",
    "  reset <id|all>            Reset case checkpoint(s) to pending",
    "  mark-manual <id>          Record human result (--pass|--fail --notes \"...\")",
    "  manifest                  Emit full machine-readable case & credential manifest",
    "",
    "Options:",
    "  --suite <core|mcp|site|obs|deploy|ext|mkt>",
    "  --phase <0..5>",
    "  --only <LT-ID[,LT-ID]>",
    "  --retry-failed",
    "  --budget-usd <number>     Hard USD cap (default 2.00)",
    "  --max-requests <integer>  Hard request cap (default 150)",
    "  --state <path>            Checkpoint file path (default runs/live-test-state.json)",
    "  --log-dir <path>          Per-case log dir (default runs/live-test-logs)",
    "  --out <path>              Report output path (default runs/live-test-report.md)",
    "  --skip-network            Skip Postgres TCP probe during preflight",
    "  --json                    Structured JSON output",
  ].join("\n");
}

export async function runCli(opts: CliRunOptions): Promise<number> {
  const argv = opts.argv;
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const out = opts.stdout ?? ((line: string) => console.log(line));
  const err = opts.stderr ?? ((line: string) => console.error(line));

  const asJson = hasFlag(argv, "json");
  const { command, positional } = resolveCommand(argv);

  if (command === "help") {
    out(usageText());
    return 0;
  }

  try {
    const suite = parseSuite(getFlagValue(argv, "suite"));
    const phase = parsePhase(getFlagValue(argv, "phase") ?? env.LIVE_TEST_PHASE);
    const statePath = resolve(cwd, getFlagValue(argv, "state") ?? DEFAULT_STATE_PATH);
    const logDir = resolve(cwd, getFlagValue(argv, "log-dir") ?? DEFAULT_LOG_DIR);
    const reportPath = resolve(cwd, getFlagValue(argv, "out") ?? DEFAULT_REPORT_PATH);

    const budgetUsdRaw = getFlagValue(argv, "budget-usd");
    const maxReqRaw = getFlagValue(argv, "max-requests");
    const budgetOverrides: { limitUsd?: number; maxRequests?: number } = {};
    if (budgetUsdRaw !== undefined) budgetOverrides.limitUsd = Number(budgetUsdRaw);
    if (maxReqRaw !== undefined) budgetOverrides.maxRequests = Number(maxReqRaw);

    if (command === "manifest") {
      const payload = {
        summary: manifestSummary(),
        credentials: USER_CREDENTIAL_MANIFEST,
        cases: LIVE_TEST_MANIFEST,
      };
      if (asJson) {
        out(JSON.stringify(payload, null, 2));
      } else {
        out(
          `Manifest: ${payload.summary.total} cases across ${SUITE_NAMES.length} suites, ${payload.summary.credentialsCount} credential entries.`,
        );
        for (const s of SUITE_NAMES) {
          out(`  ${s}: ${payload.summary.bySuite[s]}`);
        }
      }
      return 0;
    }

    if (command === "preflight") {
      const report = await runPreflight(LIVE_TEST_MANIFEST, {
        env,
        suite,
        phase,
        skipNetworkChecks: hasFlag(argv, "skip-network"),
        budgetOverrides,
      });
      if (asJson) {
        out(JSON.stringify(report, null, 2));
      } else {
        out(
          `[live-test preflight] total=${report.counts.total} ready=${report.counts.ready} blocked=${report.counts.blocked} manual_pending=${report.counts.manual_pending} estReadyMax=$${report.budget.estimatedReadyMaxUsd.toFixed(2)} (budget=$${report.budget.limitUsd.toFixed(2)}, maxReq=${report.budget.maxRequests})`,
        );
        out(
          `  postgres(:${report.infrastructure.postgresPort})=${String(report.infrastructure.postgresReachable)} baseUrl=${report.infrastructure.baseUrl ?? "unset"} marketingUrl=${report.infrastructure.marketingUrl ?? "unset"}`,
        );
        if (report.safety.safetyError) {
          out(`  SAFETY LOCK: ${report.safety.safetyError}`);
        }
        if (report.missingEnvSummary.length > 0) {
          out("  Top missing env vars:");
          for (const item of report.missingEnvSummary.slice(0, 12)) {
            out(`    - ${item.key} (blocks ${item.blockedCases} cases)`);
          }
        }
      }
      return 0;
    }

    if (command === "status") {
      const budgetCfg = parseBudgetConfig(env, budgetOverrides);
      const state = loadState(statePath, budgetCfg);
      const summary = buildReportSummary(LIVE_TEST_MANIFEST, state, statePath);
      if (asJson) {
        out(JSON.stringify({ stateExists: existsSync(statePath), summary }, null, 2));
      } else {
        out(
          `[live-test status] runId=${summary.runId} passed=${summary.totals.passed + summary.totals.manual_passed} failed=${summary.totals.failed} blocked=${summary.totals.blocked} manual_pending=${summary.totals.manual_pending} pending=${summary.totals.pending + summary.totals.ready} spent=$${summary.budget.spentUsd.toFixed(4)}/$${summary.budget.limitUsd.toFixed(2)} req=${summary.budget.requests}/${summary.budget.maxRequests}`,
        );
      }
      return 0;
    }

    if (command === "report") {
      const budgetCfg = parseBudgetConfig(env, budgetOverrides);
      const state = loadState(statePath, budgetCfg);
      const preflight = await runPreflight(LIVE_TEST_MANIFEST, {
        env,
        suite,
        phase,
        skipNetworkChecks: hasFlag(argv, "skip-network"),
        budgetOverrides,
      });
      const summary = buildReportSummary(LIVE_TEST_MANIFEST, state, statePath, preflight);
      writeMarkdownReport(reportPath, summary);
      if (asJson) {
        out(JSON.stringify({ reportPath, summary }, null, 2));
      } else {
        out(renderMarkdownReport(summary));
        out(`Report written to ${reportPath}`);
      }
      return 0;
    }

    if (command === "reset") {
      const target = positional[0] ?? getFlagValue(argv, "reset");
      if (!target) {
        err("Usage: live-test reset <LT-ID|all>");
        return 1;
      }
      const budgetCfg = parseBudgetConfig(env, budgetOverrides);
      const state = loadState(statePath, budgetCfg);
      const resetIds = resetStateCases(state, target, logDir);
      saveState(statePath, state);
      if (asJson) {
        out(JSON.stringify({ reset: resetIds, statePath }, null, 2));
      } else {
        out(`Reset ${resetIds.length} case(s) in ${statePath}: ${resetIds.join(", ") || "(none)"}`);
      }
      return 0;
    }

    if (command === "mark-manual") {
      const id = positional[0] ?? getFlagValue(argv, "mark-manual");
      if (!id) {
        err("Usage: live-test mark-manual <LT-ID> --pass|--fail --notes \"...\"");
        return 1;
      }
      const def = getCaseById(id);
      if (!def) {
        err(`Unknown case ID: ${id}`);
        return 1;
      }
      const passFlag = hasFlag(argv, "pass");
      const failFlag = hasFlag(argv, "fail");
      if (passFlag === failFlag) {
        err("Specify exactly one of --pass or --fail.");
        return 1;
      }
      const notes = getFlagValue(argv, "notes") ?? "";
      const budgetCfg = parseBudgetConfig(env, budgetOverrides);
      const state = loadState(statePath, budgetCfg);
      const cp = markManualCase(state, def, passFlag ? "pass" : "fail", notes);
      saveState(statePath, state);
      if (asJson) {
        out(JSON.stringify({ checkpoint: cp, statePath }, null, 2));
      } else {
        out(`Recorded ${def.id} as ${cp.status} (${notes || "no notes"}).`);
      }
      return 0;
    }

    if (command === "run") {
      assertSafeLiveSend(env);
      const budgetCfg = parseBudgetConfig(env, budgetOverrides);
      const state = loadState(statePath, budgetCfg);
      const preflight = await runPreflight(LIVE_TEST_MANIFEST, {
        env,
        suite,
        phase,
        skipNetworkChecks: hasFlag(argv, "skip-network"),
        budgetOverrides: budgetCfg,
      });
      const preflightById = new Map(preflight.cases.map(c => [c.id, c]));

      const onlyRaw = getFlagValue(argv, "only");
      const only = onlyRaw
        ? onlyRaw
            .split(",")
            .map(s => s.trim())
            .filter(Boolean)
        : undefined;
      if (only) {
        for (const id of only) {
          if (!getCaseById(id)) {
            err(`Unknown case ID in --only: ${id}`);
            return 1;
          }
        }
      }

      const retryFailed = hasFlag(argv, "retry-failed");
      const { run, skipped } = selectRunnableCases(LIVE_TEST_MANIFEST, state, {
        suite,
        phase,
        only,
        retryFailed,
      });

      const { PROBE_REGISTRY } = await import("./probes.ts");
      const executed: Array<{ id: string; status: string; summary: string; logFile?: string }> = [];
      let failedCount = 0;
      let haltedByBudget = false;

      for (const def of run) {
        const pf = preflightById.get(def.id);
        if (pf && pf.classification === "blocked") {
          recordCaseResult(state, def, {
            status: "blocked",
            missingEnv: pf.missingEnv,
            errorSummary: pf.reasons.join("; "),
            incrementAttempt: false,
          });
          saveState(statePath, state);
          executed.push({ id: def.id, status: "blocked", summary: pf.reasons.join("; ") });
          continue;
        }

        if (def.requiresBaseUrl && env.LIVE_TEST_BASE_URL) {
          assertNotProductionMutation(env.LIVE_TEST_BASE_URL, def.mutating);
        }
        if (def.requiresMarketingUrl && env.LIVE_TEST_MARKETING_URL) {
          assertNotProductionMutation(env.LIVE_TEST_MARKETING_URL, def.mutating);
        }

        try {
          if (def.estimatedMaxUsd > 0) {
            assertWithinBudget(state.budget, def.estimatedMaxUsd, 1);
          } else {
            assertWithinBudget(state.budget, 0, 0);
          }
        } catch (e) {
          if (e instanceof LiveTestSafetyError && e.code === "budget_exceeded") {
            haltedByBudget = true;
            executed.push({ id: def.id, status: "pending", summary: e.message });
            break;
          }
          throw e;
        }

        const handler = PROBE_REGISTRY[def.probeKey];
        const startedAt = new Date().toISOString();
        const t0 = performance.now();
        let log: CaseLog;

        try {
          const remainingUsd = Math.max(0.01, state.budget.limitUsd - state.budget.spentUsd);
          const remainingRequests = Math.max(1, state.budget.maxRequests - state.budget.requests);
          const result = await handler({
            caseDef: def,
            env,
            cwd,
            remainingBudgetUsd: remainingUsd,
            remainingRequests,
          });
          const finishedAt = new Date().toISOString();
          log = {
            id: def.id,
            suite: def.suite,
            phase: def.phase,
            mode: def.mode,
            probeKey: def.probeKey,
            startedAt,
            finishedAt,
            durationMs: Math.round(performance.now() - t0),
            status: result.status,
            summary: result.summary,
            command: result.command,
            exitCode: result.exitCode,
            telemetry: result.telemetry,
            safety: result.safety ?? {
              allowlistChecks: 0,
              canaryLeaks: 0,
              minorContacts: 0,
              liveSendBlocked: 0,
            },
            transcript: result.transcript,
            transcriptScore: result.transcriptScore,
            needsScriptReview: result.needsScriptReview,
            checklist: result.checklist ?? def.checklist,
            error: result.error,
            details: result.details,
          };
        } catch (probeErr) {
          const finishedAt = new Date().toISOString();
          const msg = probeErr instanceof Error ? probeErr.message : String(probeErr);
          const stack = probeErr instanceof Error ? probeErr.stack : undefined;
          log = {
            id: def.id,
            suite: def.suite,
            phase: def.phase,
            mode: def.mode,
            probeKey: def.probeKey,
            startedAt,
            finishedAt,
            durationMs: Math.round(performance.now() - t0),
            status: "failed",
            summary: msg,
            safety: {
              allowlistChecks: 0,
              canaryLeaks: 0,
              minorContacts: 0,
              liveSendBlocked: 0,
            },
            needsScriptReview: true,
            error: {
              message: msg,
              code: probeErr instanceof LiveTestSafetyError ? probeErr.code : undefined,
              stack,
            },
          };
        }

        const logFile = writeCaseLog(logDir, log);
        const tokens =
          (log.telemetry?.promptTokens ?? 0) + (log.telemetry?.completionTokens ?? 0);
        recordCaseResult(state, def, {
          status: log.status,
          durationMs: log.durationMs,
          costUsdDelta: log.telemetry?.costUsd ?? 0,
          requestsDelta: log.telemetry?.requests ?? 0,
          tokensDelta: tokens,
          errorSummary: log.status === "failed" ? log.summary : undefined,
          logFile,
          transcriptScore: log.transcriptScore,
          needsScriptReview: log.needsScriptReview,
          incrementAttempt: log.status !== "manual_pending",
        });
        saveState(statePath, state);

        if (log.status === "failed") failedCount += 1;
        executed.push({ id: def.id, status: log.status, summary: log.summary, logFile });
      }

      const payload = {
        runId: state.runId,
        statePath,
        skippedCount: skipped.length,
        executedCount: executed.length,
        failedCount,
        haltedByBudget,
        budget: state.budget,
        executed,
      };

      if (asJson) {
        out(JSON.stringify(payload, null, 2));
      } else {
        out(
          `[live-test run] runId=${state.runId} executed=${executed.length} skipped=${skipped.length} failed=${failedCount} spent=$${state.budget.spentUsd.toFixed(4)}/$${state.budget.limitUsd.toFixed(2)}${haltedByBudget ? " (HALTED BY BUDGET)" : ""}`,
        );
        for (const item of executed) {
          out(`  [${item.status}] ${item.id}: ${item.summary}`);
        }
      }
      return failedCount > 0 || haltedByBudget ? 1 : 0;
    }

    err(`Unknown command ${JSON.stringify(command)}. Run with --help for usage.`);
    return 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (asJson) {
      out(
        JSON.stringify(
          {
            error: msg,
            code: e instanceof LiveTestSafetyError ? e.code : "cli_error",
          },
          null,
          2,
        ),
      );
    } else {
      err(`[live-test error] ${msg}`);
    }
    return 1;
  }
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/cli.ts") || process.argv[1].endsWith("\\cli.ts"));

if (isMain) {
  process.exitCode = await runCli({ argv: process.argv.slice(2) });
}
