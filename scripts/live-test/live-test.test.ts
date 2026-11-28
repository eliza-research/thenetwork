import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.ts";
import { LIVE_TEST_MANIFEST, USER_CREDENTIAL_MANIFEST, getCaseById, manifestSummary } from "./manifest.ts";
import { runPreflight } from "./preflight.ts";
import { PROBE_REGISTRY } from "./probes.ts";
import { buildReportSummary, renderMarkdownReport, writeMarkdownReport } from "./report.ts";
import {
  LiveTestSafetyError,
  assertAllowedRecipient,
  assertNotProductionMutation,
  assertSafeLiveSend,
  assertWithinBudget,
  redactSensitive,
  redactText,
} from "./safety.ts";
import {
  createEmptyState,
  loadState,
  markManualCase,
  recordCaseResult,
  resetStateCases,
  saveState,
  selectRunnableCases,
  writeCaseLog,
} from "./state.ts";
import { PHASE_NUMBERS, PROBE_KEYS, SUITE_NAMES } from "./types.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "live-test-unit-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("live-test manifest integrity", () => {
  it("has unique IDs, valid suites/phases/modes, and registered probes across all 7 suites", () => {
    const ids = new Set<string>();
    const validSuites = new Set<string>(SUITE_NAMES);
    const validPhases = new Set<number>(PHASE_NUMBERS);
    const validProbes = new Set<string>(PROBE_KEYS);
    const validModes = new Set<string>(["AUTO-LIVE", "SEMI-AUTO", "MANUAL"]);

    for (const c of LIVE_TEST_MANIFEST) {
      expect(ids.has(c.id), `duplicate ID ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(validSuites.has(c.suite), `invalid suite on ${c.id}`).toBe(true);
      expect(validPhases.has(c.phase), `invalid phase on ${c.id}`).toBe(true);
      expect(validModes.has(c.mode), `invalid mode on ${c.id}`).toBe(true);
      expect(validProbes.has(c.probeKey), `unknown probeKey on ${c.id}`).toBe(true);
      expect(typeof PROBE_REGISTRY[c.probeKey]).toBe("function");
      expect(c.estimatedMaxUsd).toBeGreaterThanOrEqual(0);
      expect(c.cleanupNote.trim().length).toBeGreaterThan(0);
    }

    const summary = manifestSummary();
    expect(summary.total).toBe(133);
    expect(summary.bySuite.core).toBe(34);
    expect(summary.bySuite.mcp).toBe(16);
    expect(summary.bySuite.site).toBe(14);
    expect(summary.bySuite.obs).toBe(10);
    expect(summary.bySuite.deploy).toBe(9);
    expect(summary.bySuite.ext).toBe(24);
    expect(summary.bySuite.mkt).toBe(26);
    expect(USER_CREDENTIAL_MANIFEST.length).toBeGreaterThanOrEqual(30);
  });
});

describe("live-test fail-closed safety locks", () => {
  it("enforces recipient allowlists for phone, email, and handle", () => {
    const env = {
      LIVE_TEST_ALLOWLIST_PHONES: "+18085550101, (212) 555-0199",
      LIVE_TEST_ALLOWLIST_EMAILS: "QA-Test@example.org",
      LIVE_TEST_ALLOWLIST_HANDLES: "@Internal_Tester",
    };

    expect(assertAllowedRecipient("phone", "808-555-0101", env)).toBe("+18085550101");
    expect(assertAllowedRecipient("phone", "+12125550199", env)).toBe("+12125550199");
    expect(assertAllowedRecipient("email", "qa-test@example.org", env)).toBe("qa-test@example.org");
    expect(assertAllowedRecipient("handle", "internal_tester", env)).toBe("internal_tester");

    expect(() => assertAllowedRecipient("phone", "+19175550123", env)).toThrow(LiveTestSafetyError);
    expect(() => assertAllowedRecipient("email", "stranger@example.com", env)).toThrow(
      LiveTestSafetyError,
    );
    expect(() => assertAllowedRecipient("handle", "@stranger", env)).toThrow(LiveTestSafetyError);
    expect(() => assertAllowedRecipient("phone", "+18085550101", {})).toThrow(LiveTestSafetyError);
  });

  it("enforces live-send double-lock when any live-send flag is set", () => {
    expect(() => assertSafeLiveSend({})).not.toThrow();

    for (const flagEnv of [
      { NETWORK_CHANNEL: "blooio" },
      { NETWORK_CHANNEL: "eliza_cloud" },
      { MARKETING_LIVE_SEND: "1" },
      { MARKETING_LIVE_BILLING: "1" },
      { MARKETING_LIVE_DEVICE: "1" },
    ]) {
      expect(() => assertSafeLiveSend(flagEnv)).toThrow(LiveTestSafetyError);
      expect(() =>
        assertSafeLiveSend({
          ...flagEnv,
          LIVE_TEST_CONFIRM_LIVE_SEND: "ALLOWLIST_ONLY",
        }),
      ).toThrow(LiveTestSafetyError);
      expect(() =>
        assertSafeLiveSend({
          ...flagEnv,
          LIVE_TEST_CONFIRM_LIVE_SEND: "YES",
          LIVE_TEST_ALLOWLIST_PHONES: "+18085550101",
        }),
      ).toThrow(LiveTestSafetyError);
      expect(() =>
        assertSafeLiveSend({
          ...flagEnv,
          LIVE_TEST_CONFIRM_LIVE_SEND: "ALLOWLIST_ONLY",
          LIVE_TEST_ALLOWLIST_PHONES: "+18085550101",
        }),
      ).not.toThrow();
    }
  });

  it("blocks mutating operations against production domains while allowing read-only and staging", () => {
    for (const prodUrl of [
      "https://ntwrk.party",
      "https://www.ntwrk.party/api/app",
      "https://slop.date",
      "https://peon.biz/join",
      "https://friends.help",
      "https://api.ntwrk.party/mcp",
    ]) {
      expect(() => assertNotProductionMutation(prodUrl, true)).toThrow(LiveTestSafetyError);
      expect(() => assertNotProductionMutation(prodUrl, false)).not.toThrow();
    }

    for (const safeUrl of [
      "https://api-stage.ntwrk.party",
      "https://staging.friends.help",
      "http://127.0.0.1:8790",
      "http://localhost:4848",
    ]) {
      expect(() => assertNotProductionMutation(safeUrl, true)).not.toThrow();
    }
  });

  it("enforces hard USD and request budgets before overspending", () => {
    const budget = { limitUsd: 2.0, spentUsd: 1.85, requests: 140, maxRequests: 150 };
    expect(() => assertWithinBudget(budget, 0.1, 5)).not.toThrow();
    expect(() => assertWithinBudget(budget, 0.25, 1)).toThrow(LiveTestSafetyError);
    expect(() => assertWithinBudget(budget, 0.01, 15)).toThrow(LiveTestSafetyError);
  });

  it("redacts phones, emails, bearer tokens, cookies, and API keys before writing logs", () => {
    const raw = [
      "Contact +18087881821 or (212) 555-0199 at alice@example.com",
      "Authorization: Bearer super_secret_token_9999999",
      "Set-Cookie: session=abc123def456; HttpOnly",
      "SURPLUS_API_KEY=sk-live-secretkey1234567890",
    ].join("\n");

    const cleaned = redactText(raw);
    expect(cleaned).not.toContain("+18087881821");
    expect(cleaned).not.toContain("555-0199");
    expect(cleaned).not.toContain("alice@example.com");
    expect(cleaned).not.toContain("super_secret_token_9999999");
    expect(cleaned).not.toContain("session=abc123def456");
    expect(cleaned).not.toContain("sk-live-secretkey1234567890");

    const nested = redactSensitive({
      authorization: "Bearer xyz123456789",
      cookie: "sid=secret",
      phone: "+18087881821",
      note: "Called +19175550100 with token sk-proj-abcdef123456789",
    });
    expect(nested.authorization).toBe("[REDACTED]");
    expect(nested.cookie).toBe("[REDACTED]");
    expect(nested.phone).toBe("[REDACTED]");
    expect(nested.note).not.toContain("+19175550100");
    expect(nested.note).not.toContain("sk-proj-abcdef123456789");
  });
});

describe("live-test preflight classification", () => {
  it("classifies ready vs blocked with exact missingEnv without network calls", async () => {
    const emptyPreflight = await runPreflight(LIVE_TEST_MANIFEST, {
      env: {},
      skipNetworkChecks: true,
      postgresReachableOverride: false,
    });
    expect(emptyPreflight.counts.total).toBe(133);
    const core01 = emptyPreflight.cases.find(c => c.id === "LT-CORE-01")!;
    expect(core01.classification).toBe("blocked");
    expect(core01.missingEnv).toContain("SURPLUS_API_KEY|OPENAI_API_KEY");

    const core19 = emptyPreflight.cases.find(c => c.id === "LT-CORE-19")!;
    expect(core19.classification).toBe("ready");
    expect(core19.missingEnv).toEqual([]);

    const llmPreflight = await runPreflight(LIVE_TEST_MANIFEST, {
      env: { SURPLUS_API_KEY: "test-placeholder-key" },
      skipNetworkChecks: true,
      postgresReachableOverride: true,
    });
    const core01Ready = llmPreflight.cases.find(c => c.id === "LT-CORE-01")!;
    expect(core01Ready.classification).toBe("ready");
    expect(core01Ready.missingEnv).toEqual([]);

    const prodBlocked = await runPreflight(LIVE_TEST_MANIFEST, {
      env: { LIVE_TEST_BASE_URL: "https://ntwrk.party" },
      suite: "mcp",
      skipNetworkChecks: true,
      postgresReachableOverride: true,
    });
    expect(prodBlocked.infrastructure.baseUrlProductionBlocked).toBe(true);
    const mcp03 = prodBlocked.cases.find(c => c.id === "LT-MCP-03")!;
    expect(mcp03.classification).toBe("blocked");
    expect(mcp03.reasons.some(r => r.includes("production domain"))).toBe(true);
  });
});

describe("live-test checkpointing, resume, retry-failed, reset, mark-manual, and report", () => {
  it("supports idempotent resume, retry-failed, reset, mark-manual, log redaction, and markdown report", async () => {
    const dir = makeTempDir();
    const statePath = join(dir, "state.json");
    const logDir = join(dir, "logs");
    const reportPath = join(dir, "report.md");

    const defPass = getCaseById("LT-CORE-19")!;
    const defFail = getCaseById("LT-CORE-20")!;
    const defManual = getCaseById("LT-EXT-06")!;

    const state = createEmptyState({ limitUsd: 2.0, maxRequests: 150 });
    const logFile = writeCaseLog(logDir, {
      id: defFail.id,
      suite: defFail.suite,
      phase: defFail.phase,
      mode: defFail.mode,
      probeKey: defFail.probeKey,
      startedAt: "2026-11-27T00:00:00.000Z",
      finishedAt: "2026-11-27T00:00:01.000Z",
      durationMs: 1000,
      status: "failed",
      summary: "Leak check triggered for +18087881821",
      safety: { allowlistChecks: 1, canaryLeaks: 0, minorContacts: 0, liveSendBlocked: 0 },
      transcriptScore: 0.62,
      needsScriptReview: true,
    });

    const savedLog = readFileSync(logFile, "utf8");
    expect(savedLog).not.toContain("+18087881821");
    expect(savedLog).toContain("[REDACTED_PHONE]");

    recordCaseResult(state, defPass, { status: "passed", costUsdDelta: 0.02, requestsDelta: 2, tokensDelta: 500 });
    recordCaseResult(state, defFail, {
      status: "failed",
      costUsdDelta: 0.03,
      requestsDelta: 3,
      tokensDelta: 700,
      errorSummary: "Rubric below threshold",
      logFile,
      transcriptScore: 0.62,
      needsScriptReview: true,
    });
    markManualCase(state, defManual, "pass", "Verified Partiful scrub manually");
    saveState(statePath, state);

    const reloaded = loadState(statePath);
    expect(reloaded.budget.spentUsd).toBeCloseTo(0.05, 5);
    expect(reloaded.budget.requests).toBe(5);
    expect(reloaded.cases[defManual.id]?.status).toBe("manual_passed");

    const normalResume = selectRunnableCases([defPass, defFail, defManual], reloaded);
    expect(normalResume.run.map(c => c.id)).toEqual([defFail.id]);
    expect(normalResume.skipped.map(c => c.id)).toEqual([defPass.id, defManual.id]);

    const retryOnly = selectRunnableCases([defPass, defFail, defManual], reloaded, {
      retryFailed: true,
    });
    expect(retryOnly.run.map(c => c.id)).toEqual([defFail.id]);

    const summary = buildReportSummary(LIVE_TEST_MANIFEST, reloaded, statePath);
    expect(summary.failedCases.map(f => f.id)).toEqual([defFail.id]);
    expect(summary.scriptReviewQueue.map(q => q.id)).toEqual([defFail.id]);
    const md = writeMarkdownReport(reportPath, summary);
    expect(existsSync(reportPath)).toBe(true);
    expect(md).toContain("## Script-Review Queue");
    expect(md).toContain(defFail.id);
    expect(renderMarkdownReport(summary)).toContain("## Status Totals");

    const resetIds = resetStateCases(reloaded, defPass.id, logDir);
    expect(resetIds).toEqual([defPass.id]);
    expect(reloaded.cases[defPass.id]?.status).toBe("pending");

    const cliOut: string[] = [];
    const code = await runCli({
      argv: ["mark-manual", defManual.id, "--fail", "--notes", "Found copy issue", "--state", statePath, "--json"],
      env: {},
      cwd: dir,
      stdout: line => cliOut.push(line),
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(cliOut.join("\n")) as { checkpoint: { status: string; manualNotes: string } };
    expect(parsed.checkpoint.status).toBe("failed");
    expect(parsed.checkpoint.manualNotes).toBe("Found copy issue");
  });
});
