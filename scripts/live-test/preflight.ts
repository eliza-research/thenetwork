import { createConnection } from "node:net";
import {
  inspectSafetyStatus,
  isProductionDomainUrl,
  parseBudgetConfig,
} from "./safety.ts";
import {
  PHASE_NUMBERS,
  SUITE_NAMES,
  type CaseDefinition,
  type EnvMap,
  type PhaseNumber,
  type PreflightCaseResult,
  type PreflightClassification,
  type PreflightReport,
  type SuiteName,
} from "./types.ts";

export interface PreflightOptions {
  env?: EnvMap;
  suite?: SuiteName;
  phase?: PhaseNumber;
  skipNetworkChecks?: boolean;
  postgresReachableOverride?: boolean;
  postgresPort?: number;
  budgetOverrides?: { limitUsd?: number; maxRequests?: number };
  now?: Date;
}

export async function checkTcpPort(host: string, port: number, timeoutMs = 400): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function isEnvRequirementSatisfied(requirement: string, env: EnvMap): boolean {
  const alternatives = requirement
    .split("|")
    .map(part => part.trim())
    .filter(Boolean);
  if (alternatives.length === 0) return true;
  return alternatives.some(key => {
    const val = env[key];
    return val !== undefined && val.trim() !== "";
  });
}

export function findMissingEnv(requirements: readonly string[], env: EnvMap): string[] {
  const missing: string[] = [];
  for (const req of requirements) {
    if (!isEnvRequirementSatisfied(req, env)) {
      missing.push(req);
    }
  }
  return missing;
}

export async function runPreflight(
  manifestCases: readonly CaseDefinition[],
  options: PreflightOptions = {},
): Promise<PreflightReport> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const postgresPort =
    options.postgresPort ??
    (env.OBSERVATORY_PG_PORT && Number.isFinite(Number(env.OBSERVATORY_PG_PORT))
      ? Number(env.OBSERVATORY_PG_PORT)
      : 54339);

  let postgresReachable: boolean | "skipped";
  if (options.postgresReachableOverride !== undefined) {
    postgresReachable = options.postgresReachableOverride;
  } else if (options.skipNetworkChecks) {
    postgresReachable = "skipped";
  } else if (env.NETWORK_DATABASE_URL && env.NETWORK_DATABASE_URL.trim() !== "") {
    postgresReachable = true;
  } else {
    postgresReachable = await checkTcpPort("127.0.0.1", postgresPort, 400);
  }

  const baseUrl = env.LIVE_TEST_BASE_URL?.trim() || undefined;
  const marketingUrl = env.LIVE_TEST_MARKETING_URL?.trim() || undefined;
  const baseUrlProductionBlocked = baseUrl ? isProductionDomainUrl(baseUrl) : false;
  const marketingUrlProductionBlocked = marketingUrl ? isProductionDomainUrl(marketingUrl) : false;

  const safety = inspectSafetyStatus(env);
  const budgetConfig = parseBudgetConfig(env, options.budgetOverrides);

  const selected = manifestCases.filter(c => {
    if (options.suite && c.suite !== options.suite) return false;
    if (options.phase !== undefined && c.phase !== options.phase) return false;
    return true;
  });

  const bySuite = Object.fromEntries(
    SUITE_NAMES.map(s => [s, { total: 0, ready: 0, blocked: 0, manual_pending: 0 }]),
  ) as PreflightReport["bySuite"];

  const byPhase = Object.fromEntries(
    PHASE_NUMBERS.map(p => [p, { total: 0, ready: 0, blocked: 0, manual_pending: 0 }]),
  ) as PreflightReport["byPhase"];

  const missingEnvMap = new Map<string, string[]>();
  const caseResults: PreflightCaseResult[] = [];

  let readyCount = 0;
  let blockedCount = 0;
  let manualCount = 0;
  let estimatedTotalMaxUsd = 0;
  let estimatedReadyMaxUsd = 0;

  for (const def of selected) {
    const missingEnv = findMissingEnv(def.requiresEnv, env);
    const reasons: string[] = [];

    if (def.requiresBaseUrl && !baseUrl) {
      if (!missingEnv.includes("LIVE_TEST_BASE_URL")) missingEnv.push("LIVE_TEST_BASE_URL");
    }
    if (def.requiresMarketingUrl && !marketingUrl) {
      if (!missingEnv.includes("LIVE_TEST_MARKETING_URL")) {
        missingEnv.push("LIVE_TEST_MARKETING_URL");
      }
    }
    if (def.requiresBaseUrl && def.mutating && baseUrlProductionBlocked) {
      reasons.push(`LIVE_TEST_BASE_URL (${baseUrl}) is a production domain and case is mutating.`);
    }
    if (def.requiresMarketingUrl && def.mutating && marketingUrlProductionBlocked) {
      reasons.push(
        `LIVE_TEST_MARKETING_URL (${marketingUrl}) is a production domain and case is mutating.`,
      );
    }
    if (def.requiresPostgres && postgresReachable === false) {
      reasons.push(`Postgres not reachable on 127.0.0.1:${postgresPort} and NETWORK_DATABASE_URL is unset.`);
    }
    if (def.requiresLiveSendLock && !safety.safeToRunLiveSend) {
      reasons.push(
        "Requires LIVE_TEST_CONFIRM_LIVE_SEND=ALLOWLIST_ONLY and at least one allowlisted recipient.",
      );
    }
    if (safety.safetyError) {
      reasons.push(safety.safetyError);
    }
    if (missingEnv.length > 0) {
      reasons.push(`Missing env: ${missingEnv.join(", ")}`);
    }

    let classification: PreflightClassification;
    if (def.mode === "MANUAL") {
      classification = missingEnv.length > 0 || reasons.length > 0 ? "blocked" : "manual_pending";
    } else if (def.probeKey === "manual_checklist_probe" && def.mode === "SEMI-AUTO") {
      classification = missingEnv.length > 0 || reasons.length > 0 ? "blocked" : "manual_pending";
    } else if (missingEnv.length > 0 || reasons.length > 0) {
      classification = "blocked";
    } else {
      classification = "ready";
    }

    for (const key of missingEnv) {
      const list = missingEnvMap.get(key) ?? [];
      list.push(def.id);
      missingEnvMap.set(key, list);
    }

    estimatedTotalMaxUsd += def.estimatedMaxUsd;
    if (classification === "ready") {
      readyCount += 1;
      estimatedReadyMaxUsd += def.estimatedMaxUsd;
    } else if (classification === "blocked") {
      blockedCount += 1;
    } else {
      manualCount += 1;
    }

    bySuite[def.suite].total += 1;
    bySuite[def.suite][classification] += 1;
    byPhase[def.phase].total += 1;
    byPhase[def.phase][classification] += 1;

    caseResults.push({
      id: def.id,
      suite: def.suite,
      phase: def.phase,
      mode: def.mode,
      probeKey: def.probeKey,
      classification,
      missingEnv,
      reasons,
      estimatedMaxUsd: def.estimatedMaxUsd,
      mutating: def.mutating,
    });
  }

  const missingEnvSummary = [...missingEnvMap.entries()]
    .map(([key, caseIds]) => ({ key, blockedCases: caseIds.length, caseIds }))
    .sort((a, b) => b.blockedCases - a.blockedCases || a.key.localeCompare(b.key));

  return {
    generatedAt: now.toISOString(),
    filters: {
      ...(options.suite ? { suite: options.suite } : {}),
      ...(options.phase !== undefined ? { phase: options.phase } : {}),
    },
    infrastructure: {
      postgresPort,
      postgresReachable,
      ...(baseUrl ? { baseUrl } : {}),
      baseUrlProductionBlocked,
      ...(marketingUrl ? { marketingUrl } : {}),
      marketingUrlProductionBlocked,
    },
    safety,
    budget: {
      limitUsd: budgetConfig.limitUsd,
      maxRequests: budgetConfig.maxRequests,
      estimatedTotalMaxUsd: Number(estimatedTotalMaxUsd.toFixed(4)),
      estimatedReadyMaxUsd: Number(estimatedReadyMaxUsd.toFixed(4)),
    },
    counts: {
      total: selected.length,
      ready: readyCount,
      blocked: blockedCount,
      manual_pending: manualCount,
    },
    bySuite,
    byPhase,
    missingEnvSummary,
    cases: caseResults,
  };
}
