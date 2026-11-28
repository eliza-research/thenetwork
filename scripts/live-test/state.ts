import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_BUDGET_USD, DEFAULT_MAX_REQUESTS, redactSensitive } from "./safety.ts";
import type {
  CaseCheckpoint,
  CaseDefinition,
  CaseLog,
  CaseStatus,
  PhaseNumber,
  StateFile,
  SuiteName,
} from "./types.ts";

export const DEFAULT_STATE_PATH = "runs/live-test-state.json";
export const DEFAULT_LOG_DIR = "runs/live-test-logs";
export const DEFAULT_REPORT_PATH = "runs/live-test-report.md";

let tmpCounter = 0;

export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
  tmpCounter += 1;
  const tmpPath = `${filePath}.${process.pid}.${tmpCounter}.tmp`;
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, filePath);
}

export function createEmptyState(
  budget: { limitUsd?: number; maxRequests?: number } = {},
  now: Date = new Date(),
): StateFile {
  const iso = now.toISOString();
  return {
    version: 1,
    runId: `lt-${randomUUID().slice(0, 8)}`,
    createdAt: iso,
    updatedAt: iso,
    budget: {
      limitUsd: budget.limitUsd ?? DEFAULT_BUDGET_USD,
      spentUsd: 0,
      requests: 0,
      maxRequests: budget.maxRequests ?? DEFAULT_MAX_REQUESTS,
    },
    cases: {},
  };
}

export function loadState(
  statePath: string = DEFAULT_STATE_PATH,
  budgetOverrides: { limitUsd?: number; maxRequests?: number } = {},
  now: Date = new Date(),
): StateFile {
  if (!existsSync(statePath)) {
    return createEmptyState(budgetOverrides, now);
  }
  const raw = readFileSync(statePath, "utf8");
  const parsed = JSON.parse(raw) as StateFile;
  if (parsed.version !== 1 || typeof parsed.cases !== "object" || parsed.cases === null) {
    throw new Error(`Invalid live-test state file at ${statePath}`);
  }
  if (budgetOverrides.limitUsd !== undefined) {
    parsed.budget.limitUsd = budgetOverrides.limitUsd;
  }
  if (budgetOverrides.maxRequests !== undefined) {
    parsed.budget.maxRequests = budgetOverrides.maxRequests;
  }
  return parsed;
}

export function saveState(statePath: string, state: StateFile, now: Date = new Date()): void {
  state.updatedAt = now.toISOString();
  atomicWriteFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function caseLogPath(logDir: string, caseId: string): string {
  const safeId = caseId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(logDir, `${safeId}.json`);
}

export function writeCaseLog(logDir: string, log: CaseLog): string {
  const target = caseLogPath(logDir, log.id);
  const redacted = redactSensitive(log);
  atomicWriteFileSync(target, `${JSON.stringify(redacted, null, 2)}\n`);
  return target;
}

export function readCaseLog(logPath: string): CaseLog | undefined {
  if (!existsSync(logPath)) return undefined;
  return JSON.parse(readFileSync(logPath, "utf8")) as CaseLog;
}

export function recordCaseResult(
  state: StateFile,
  def: CaseDefinition,
  update: {
    status: CaseStatus;
    durationMs?: number;
    costUsdDelta?: number;
    requestsDelta?: number;
    tokensDelta?: number;
    missingEnv?: string[];
    errorSummary?: string;
    logFile?: string;
    transcriptScore?: number;
    needsScriptReview?: boolean;
    manualNotes?: string;
    incrementAttempt?: boolean;
  },
  now: Date = new Date(),
): CaseCheckpoint {
  const existing = state.cases[def.id];
  const costDelta = Math.max(0, update.costUsdDelta ?? 0);
  const reqDelta = Math.max(0, update.requestsDelta ?? 0);
  const tokDelta = Math.max(0, update.tokensDelta ?? 0);

  const next: CaseCheckpoint = {
    id: def.id,
    suite: def.suite,
    phase: def.phase,
    mode: def.mode,
    status: update.status,
    attempts: (existing?.attempts ?? 0) + (update.incrementAttempt === false ? 0 : 1),
    lastRunAt: now.toISOString(),
    durationMs: update.durationMs ?? existing?.durationMs,
    costUsd: Number(((existing?.costUsd ?? 0) + costDelta).toFixed(6)),
    requests: (existing?.requests ?? 0) + reqDelta,
    tokens: (existing?.tokens ?? 0) + tokDelta,
    missingEnv: update.missingEnv,
    errorSummary: update.errorSummary,
    logFile: update.logFile ?? existing?.logFile,
    transcriptScore: update.transcriptScore ?? existing?.transcriptScore,
    needsScriptReview: update.needsScriptReview ?? existing?.needsScriptReview,
    manualNotes: update.manualNotes ?? existing?.manualNotes,
  };

  state.cases[def.id] = next;
  state.budget.spentUsd = Number((state.budget.spentUsd + costDelta).toFixed(6));
  state.budget.requests += reqDelta;
  state.updatedAt = now.toISOString();
  return next;
}

export function resetStateCases(
  state: StateFile,
  target: string,
  logDir?: string,
  now: Date = new Date(),
): string[] {
  const trimmed = target.trim();
  if (!trimmed) return [];

  if (trimmed.toLowerCase() === "all") {
    const ids = Object.keys(state.cases);
    for (const id of ids) {
      if (logDir) {
        const p = caseLogPath(logDir, id);
        if (existsSync(p)) rmSync(p, { force: true });
      }
    }
    state.cases = {};
    state.budget.spentUsd = 0;
    state.budget.requests = 0;
    state.updatedAt = now.toISOString();
    return ids;
  }

  const requested = trimmed
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const resetIds: string[] = [];

  for (const id of requested) {
    const existing = state.cases[id];
    if (existing) {
      state.cases[id] = {
        id: existing.id,
        suite: existing.suite,
        phase: existing.phase,
        mode: existing.mode,
        status: "pending",
        attempts: 0,
        costUsd: 0,
        requests: 0,
        tokens: 0,
      };
      resetIds.push(id);
    }
    if (logDir) {
      const p = caseLogPath(logDir, id);
      if (existsSync(p)) rmSync(p, { force: true });
    }
  }

  state.updatedAt = now.toISOString();
  return resetIds;
}

export function markManualCase(
  state: StateFile,
  def: CaseDefinition,
  outcome: "pass" | "fail",
  notes: string,
  now: Date = new Date(),
): CaseCheckpoint {
  const status: CaseStatus = outcome === "pass" ? "manual_passed" : "failed";
  return recordCaseResult(
    state,
    def,
    {
      status,
      manualNotes: notes.trim(),
      errorSummary: outcome === "fail" ? notes.trim() || "Marked failed manually" : undefined,
      needsScriptReview: outcome === "fail",
      incrementAttempt: true,
    },
    now,
  );
}

export function isCaseCompleted(checkpoint: CaseCheckpoint | undefined): boolean {
  if (!checkpoint) return false;
  return checkpoint.status === "passed" || checkpoint.status === "manual_passed";
}

export function selectRunnableCases(
  manifestCases: readonly CaseDefinition[],
  state: StateFile,
  opts: {
    suite?: SuiteName;
    phase?: PhaseNumber;
    only?: readonly string[];
    retryFailed?: boolean;
  } = {},
): { run: CaseDefinition[]; skipped: CaseDefinition[] } {
  const onlySet = opts.only && opts.only.length > 0 ? new Set(opts.only) : undefined;
  const filtered = manifestCases.filter(c => {
    if (onlySet && !onlySet.has(c.id)) return false;
    if (opts.suite && c.suite !== opts.suite) return false;
    if (opts.phase !== undefined && c.phase !== opts.phase) return false;
    return true;
  });

  const run: CaseDefinition[] = [];
  const skipped: CaseDefinition[] = [];

  for (const def of filtered) {
    const existing = state.cases[def.id];
    if (opts.retryFailed) {
      if (existing?.status === "failed") {
        run.push(def);
      } else {
        skipped.push(def);
      }
      continue;
    }
    if (isCaseCompleted(existing)) {
      skipped.push(def);
      continue;
    }
    run.push(def);
  }

  return { run, skipped };
}
