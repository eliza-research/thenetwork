import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAY,
  HOUR,
  K_ANONYMITY_FLOOR,
  OpenAILLM,
  SimClock,
  setGlobalTrajectoryRecorder,
  type TrajectorySpan,
} from "@thenetwork/core";
import { createServer, MODE_HEADER, type ObservatoryServer } from "../src/server.ts";
import { GameSource } from "../src/sources/game.ts";
import { validateReadOnlyAnalyticsSql } from "../src/analytics.ts";

const ADMIN_TOKEN = "a".repeat(36);
const ANALYST_TOKEN = "b".repeat(36);
const REVIEWER_TOKEN = "c".repeat(36);
const SAFETY_TOKEN = "d".repeat(36);

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

describe("LLM trajectory recording hook (packages/core/src/llm.ts)", () => {
  afterEach(() => {
    setGlobalTrajectoryRecorder(undefined);
  });

  it("records scrubbed LLM spans via client hook and global recorder without breaking calls", async () => {
    const localSpans: TrajectorySpan[] = [];
    const globalSpans: TrajectorySpan[] = [];
    setGlobalTrajectoryRecorder(span => {
      globalSpans.push(span);
      throw new Error("observer failure must not break llm call");
    });

    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          model: "gpt-6-luna",
          choices: [{ message: { content: "Reach me at alice@example.com or +1-415-555-0199" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 42, completion_tokens: 18, buyer_cost_micro: 132 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const client = new OpenAILLM(
      "test-key",
      "gpt-6-luna",
      "https://surplus.example/v1",
      {
        fetch: mockFetch,
        clock: new SimClock(1_700_000_000_000),
        onTrajectorySpan: span => localSpans.push(span),
        trajectoryMeta: { app: "ntwrk", city: "nyc", traceId: "trace-llm-1", entityType: "member", entityId: "m1" },
      },
    );

    const reply = await client.chat([{ role: "user", content: "Ping +1-415-555-0100" }]);
    expect(reply).toContain("alice@example.com");
    expect(localSpans).toHaveLength(1);
    expect(globalSpans).toHaveLength(1);

    const span = localSpans[0]!;
    expect(span.kind).toBe("llm");
    expect(span.traceId).toBe("trace-llm-1");
    expect(span.app).toBe("ntwrk");
    expect(span.city).toBe("nyc");
    expect(span.status).toBe("ok");
    expect(span.metrics?.model).toBe("gpt-6-luna");
    expect(span.metrics?.inputTokens).toBe(42);
    expect(span.metrics?.outputTokens).toBe(18);
    expect(span.metrics?.costMicros).toBe(132);
    const serialized = JSON.stringify(span.payload);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("415-555-0199");
    expect(serialized).not.toContain("415-555-0100");
  });
});

describe("SQL analytics guard", () => {
  it("enforces strict analytics.* allowlist and blocks mutations, comments, quotes, functions, and PII tables", () => {
    expect(validateReadOnlyAnalyticsSql("SELECT day, app_id, stage, event_count FROM analytics.funnel_daily").ok).toBe(true);
    expect(validateReadOnlyAnalyticsSql("WITH c AS (SELECT day, event_count FROM analytics.funnel_daily) SELECT * FROM c;").ok).toBe(true);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM network.members").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT body FROM network.messages").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM \"platform\".\"people\"").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT pg_sleep(1) FROM analytics.funnel_daily").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("DELETE FROM analytics.funnel_daily").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT 1 FROM analytics.funnel_daily; DROP TABLE analytics.funnel_daily").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM analytics.funnel_daily -- comment").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM platform.channel_identities").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM analytics.trajectory_deks").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM analytics.funnel_daily, analytics.trajectory_deks").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM analytics.funnel_daily, marketing.humans").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM marketing.humans").ok).toBe(false);
    expect(validateReadOnlyAnalyticsSql("SELECT * FROM platform.people").ok).toBe(false);
  });
});

describe("Observatory analytics, trajectories, mocks, and unified sim backend", () => {
  let srv: ObservatoryServer | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    await srv?.stop();
    srv = undefined;
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  async function startGameServer() {
    dir = mkdtempSync(join(tmpdir(), "obs-analytics-test-"));
    srv = await createServer({
      port: 0,
      mode: "game",
      tokens: `${ADMIN_TOKEN}:admin@*,${ANALYST_TOKEN}:analyst@*,${REVIEWER_TOKEN}:reviewer@*,${SAFETY_TOKEN}:safety@*`,
      audit: { dir },
      game: { personas: 36, seed: 7, days: 14, pushMs: 10_000, tickMs: 10_000 },
    });
    return srv;
  }

  it("serves analytics endpoints, slice CSV/JSON exports, and guarded SQL enforcement with audit rows", async () => {
    const server = await startGameServer();

    const stepRes = await fetch(`${server.url}/api/control`, {
      method: "POST",
      headers: authHeaders(ADMIN_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({ type: "step", ms: 2 * DAY }),
    });
    expect(stepRes.status).toBe(200);

    const [funnelR, cohortsR, tsR, heatR, anomR] = await Promise.all([
      fetch(`${server.url}/api/analytics/funnel`, { headers: authHeaders(ANALYST_TOKEN) }),
      fetch(`${server.url}/api/analytics/cohorts`, { headers: authHeaders(ANALYST_TOKEN) }),
      fetch(`${server.url}/api/analytics/timeseries?granularity=day`, { headers: authHeaders(ANALYST_TOKEN) }),
      fetch(`${server.url}/api/analytics/heatmap`, { headers: authHeaders(ANALYST_TOKEN) }),
      fetch(`${server.url}/api/analytics/anomalies`, { headers: authHeaders(ANALYST_TOKEN) }),
    ]);

    expect(funnelR.status).toBe(200);
    const funnel = await funnelR.json() as { steps: unknown[]; kFloor: number; totalActors: number };
    expect(funnel.kFloor).toBeGreaterThanOrEqual(K_ANONYMITY_FLOOR);
    expect(funnel.steps.length).toBeGreaterThan(0);

    expect(cohortsR.status).toBe(200);
    const cohorts = await cohortsR.json() as { horizons: number[]; rows: { cohortSize: number; suppressed: boolean }[]; kFloor: number };
    expect(cohorts.horizons).toEqual([1, 3, 7, 14, 30]);
    expect(cohorts.kFloor).toBeGreaterThanOrEqual(K_ANONYMITY_FLOOR);
    for (const row of cohorts.rows) {
      if (row.cohortSize < K_ANONYMITY_FLOOR) expect(row.suppressed).toBe(true);
    }

    expect(tsR.status).toBe(200);
    const ts = await tsR.json() as { granularity: string; labels: string[]; series: Record<string, unknown[]> };
    expect(ts.granularity).toBe("day");
    expect(Object.keys(ts.series).sort()).toEqual(["meetings", "messages", "proposals", "signups", "stops", "visits"]);

    expect(heatR.status).toBe(200);
    const heat = await heatR.json() as { cells: unknown[]; templateLift: unknown[] };
    expect(heat.cells).toHaveLength(168);

    expect(anomR.status).toBe(200);
    const anom = await anomR.json() as { alerts: unknown[]; safety: { canaryLeaks: number; teenViolationContacts: number } };
    expect(anom.safety.canaryLeaks).toBe(0);
    expect(anom.safety.teenViolationContacts).toBe(0);

    const sliceJsonR = await fetch(`${server.url}/api/analytics/slice`, {
      method: "POST",
      headers: authHeaders(ANALYST_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({ metric: "verified_signups", groupBy: ["city"], granularity: "1d", format: "json" }),
    });
    expect(sliceJsonR.status).toBe(200);
    const sliceJson = await sliceJsonR.json() as { metric: string; rows: unknown[]; kFloor: number };
    expect(sliceJson.metric).toBe("verified_signups");
    expect(sliceJson.kFloor).toBeGreaterThanOrEqual(K_ANONYMITY_FLOOR);

    const sliceCsvR = await fetch(`${server.url}/api/analytics/slice`, {
      method: "POST",
      headers: authHeaders(ANALYST_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({ metric: "verified_signups", groupBy: ["city"], granularity: "day", format: "csv" }),
    });
    expect(sliceCsvR.status).toBe(200);
    expect(sliceCsvR.headers.get("content-type")).toContain("text/csv");

    const sqlForbiddenRole = await fetch(`${server.url}/api/analytics/slice`, {
      method: "POST",
      headers: authHeaders(REVIEWER_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({ sql: "SELECT day, event_count FROM analytics.funnel_daily" }),
    });
    expect(sqlForbiddenRole.status).toBe(403);

    const sqlBlockedMutate = await fetch(`${server.url}/api/analytics/slice`, {
      method: "POST",
      headers: authHeaders(ANALYST_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({ sql: "DELETE FROM analytics.funnel_daily" }),
    });
    expect(sqlBlockedMutate.status).toBe(400);

    const sqlBlockedMembers = await fetch(`${server.url}/api/analytics/slice`, {
      method: "POST",
      headers: authHeaders(ANALYST_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({ sql: "SELECT id, name FROM network.members" }),
    });
    expect(sqlBlockedMembers.status).toBe(400);

    const sqlBlockedPii = await fetch(`${server.url}/api/analytics/slice`, {
      method: "POST",
      headers: authHeaders(ANALYST_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({ sql: "SELECT * FROM analytics.trajectory_deks" }),
    });
    expect(sqlBlockedPii.status).toBe(400);

    const sqlOk = await fetch(`${server.url}/api/analytics/slice`, {
      method: "POST",
      headers: authHeaders(ANALYST_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({ sql: "SELECT day, app_id, stage, event_count FROM analytics.funnel_daily" }),
    });
    expect(sqlOk.status).toBe(200);
    const sqlData = await sqlOk.json() as { columns: string[]; rows: unknown[]; truncated: boolean };
    expect(Array.isArray(sqlData.columns)).toBe(true);
    expect(sqlData.truncated).toBe(false);

    const auditEntries = await server.audit.list({ limit: 50 });
    expect(auditEntries.some(e => e.action === "read_analytics")).toBe(true);
    expect(auditEntries.some(e => e.action === "read_analytics_sql" && e.ok === true)).toBe(true);
  });

  it("enforces trajectory RBAC (analyst redacted, safety decrypted) and DEK crypto-shredding", async () => {
    const server = await startGameServer();
    const src = await server.source("game", "ntwrk");
    expect(src).toBeInstanceOf(GameSource);
    const game = src as GameSource;

    const personId = "11111111-1111-4111-8111-111111111111";
    const traceId = "trace-shred-check";
    game.recordTrajectorySpan({
      schemaVersion: 1,
      traceId,
      spanId: "sp-shred-1",
      app: "ntwrk",
      city: "nyc",
      kind: "llm",
      name: "llm.chat_completions",
      startedAt: game.state().clock.now,
      durationMs: 120,
      entityType: "member",
      entityId: "m1",
      personId,
      status: "ok",
      metrics: { model: "gpt-6-luna", inputTokens: 20, outputTokens: 10, costMicros: 50 },
      payload: { prompt: "Invite Alice to coffee", contact: "alice@example.com" },
    });

    const listAnalystR = await fetch(`${server.url}/api/trajectories`, { headers: authHeaders(ANALYST_TOKEN) });
    expect(listAnalystR.status).toBe(200);
    const listAnalyst = await listAnalystR.json() as { traces: { traceId: string }[]; hotTail: { payload?: unknown }[] };
    expect(listAnalyst.traces.some(t => t.traceId === traceId)).toBe(true);
    for (const sp of listAnalyst.hotTail) expect(sp.payload).toBeUndefined();

    const detailAnalystR = await fetch(`${server.url}/api/trajectories/${traceId}?decrypt=1`, { headers: authHeaders(ANALYST_TOKEN) });
    expect(detailAnalystR.status).toBe(200);
    const detailAnalyst = await detailAnalystR.json() as { spans: { payloadState: string; payload?: unknown }[] };
    expect(detailAnalyst.spans).toHaveLength(1);
    expect(detailAnalyst.spans[0]!.payloadState).toBe("redacted");
    expect(detailAnalyst.spans[0]!.payload).toBeUndefined();

    const detailSafetyR = await fetch(`${server.url}/api/trajectories/${traceId}?decrypt=1`, { headers: authHeaders(SAFETY_TOKEN) });
    expect(detailSafetyR.status).toBe(200);
    const detailSafety = await detailSafetyR.json() as { spans: { payloadState: string; payload?: Record<string, unknown> }[] };
    expect(detailSafety.spans[0]!.payloadState).toBe("decrypted");
    expect(JSON.stringify(detailSafety.spans[0]!.payload)).not.toContain("alice@example.com");

    await game.shredTrajectoryPerson(personId);
    const detailShreddedR = await fetch(`${server.url}/api/trajectories/${traceId}?decrypt=1`, { headers: authHeaders(SAFETY_TOKEN) });
    expect(detailShreddedR.status).toBe(200);
    const detailShredded = await detailShreddedR.json() as { spans: { payloadState: string; payload?: { status?: string } }[] };
    expect(detailShredded.spans[0]!.payloadState).toBe("shredded");
    expect(detailShredded.spans[0]!.payload?.status).toBe("[crypto-shredded]");

    const minorTraceId = "trace-minor-redacted";
    game.recordTrajectorySpan({
      schemaVersion: 1,
      traceId: minorTraceId,
      spanId: "sp-minor-1",
      app: "ntwrk",
      city: "nyc",
      kind: "turn",
      name: "minor.turn",
      startedAt: game.state().clock.now,
      durationMs: 10,
      isMinor: true,
      status: "ok",
      payload: { secret: "should never be shown" },
    });
    const detailMinorR = await fetch(`${server.url}/api/trajectories/${minorTraceId}?decrypt=1`, { headers: authHeaders(SAFETY_TOKEN) });
    expect(detailMinorR.status).toBe(200);
    const detailMinor = await detailMinorR.json() as { spans: { payloadState: string; payload?: unknown }[] };
    expect(detailMinor.spans).toHaveLength(1);
    expect(detailMinor.spans[0]!.payloadState).toBe("redacted");
    expect(detailMinor.spans[0]!.payload).toBeUndefined();
  });

  it("wires unified sim controls, speed presets, levels, and embedded mocks cleanly", async () => {
    const server = await startGameServer();

    const levelsR = await fetch(`${server.url}/api/levels`, { headers: authHeaders(ADMIN_TOKEN) });
    expect(levelsR.status).toBe(200);
    const levels = await levelsR.json() as { id: string; kind: string }[];
    expect(levels.some(l => l.id === "city_launch" && l.kind === "unified")).toBe(true);
    expect(levels.some(l => l.id === "high_volume_stress" && l.kind === "unified")).toBe(true);

    const control = (body: unknown) =>
      fetch(`${server.url}/api/control`, {
        method: "POST",
        headers: authHeaders(ADMIN_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
        body: JSON.stringify(body),
      });

    expect((await control({ type: "set_response_mode", mode: "hybrid" })).status).toBe(200);
    expect((await control({ type: "set_llm_budget", maxCostUsd: 2.5, maxRequests: 120 })).status).toBe(200);
    expect((await control({ type: "speed", speed: "turbo" })).status).toBe(200);
    expect((await control({ type: "teen_stop", stop: true })).status).toBe(200);
    expect((await control({ type: "trigger_world_event", event: "viral_mention", city: "nyc" })).status).toBe(200);

    const chaosPost = await fetch(`${server.url}/api/mocks/chaos`, {
      method: "POST",
      headers: authHeaders(ADMIN_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "game" }),
      body: JSON.stringify({
        id: "chaos-x-429",
        service: "x",
        probability: 1,
        fault: { kind: "http_error", status: 429, retryAfterSec: 30 },
        enabled: true,
      }),
    });
    expect(chaosPost.status).toBe(200);
    const chaosAfterPost = await chaosPost.json() as { ok: boolean; rules: { id: string }[] };
    expect(chaosAfterPost.ok).toBe(true);
    expect(chaosAfterPost.rules.some(r => r.id === "chaos-x-429")).toBe(true);

    const trafficR = await fetch(`${server.url}/api/mocks/traffic`, { headers: authHeaders(ADMIN_TOKEN) });
    expect(trafficR.status).toBe(200);
    const traffic = await trafficR.json() as { entries: unknown[]; baseUrl: string | null };
    expect(traffic.baseUrl).toContain("http://127.0.0.1:");

    const chaosDel = await fetch(`${server.url}/api/mocks/chaos/chaos-x-429`, {
      method: "DELETE",
      headers: authHeaders(ADMIN_TOKEN, { [MODE_HEADER]: "game" }),
    });
    expect(chaosDel.status).toBe(200);
    const chaosAfterDel = await chaosDel.json() as { ok: boolean; rules: { id: string }[] };
    expect(chaosAfterDel.rules).toHaveLength(0);

    const resetUnified = await control({ type: "reset", scenario: "city_launch", personas: 24, seed: 3, responseMode: "canned" });
    expect(resetUnified.status).toBe(200);
    expect((await control({ type: "step", ms: 6 * HOUR })).status).toBe(200);

    const stateR = await fetch(`${server.url}/api/state`, { headers: authHeaders(ADMIN_TOKEN) });
    const state = await stateR.json() as { game?: { unified?: { scenarioId?: string; mockBaseUrl?: string; scorecard?: { totalScore: number } } } };
    expect(state.game?.unified?.scenarioId).toBe("city_launch");
    expect(state.game?.unified?.mockBaseUrl).toContain("http://127.0.0.1:");
    expect(state.game?.unified?.scorecard).toBeDefined();
  });

  it("refuses /api/mocks/* and unified game controls with 403 real_only under OBSERVATORY_REAL_ONLY=1", async () => {
    dir = mkdtempSync(join(tmpdir(), "obs-realonly-test-"));
    srv = await createServer({
      port: 0,
      realOnly: true,
      platformEnv: "dev",
      tokens: `${ADMIN_TOKEN}:admin@*`,
      audit: { dir },
      real: { url: undefined },
    });

    const trafficR = await fetch(`${srv.url}/api/mocks/traffic`, { headers: authHeaders(ADMIN_TOKEN) });
    expect(trafficR.status).toBe(403);
    expect((await trafficR.json() as { code: string }).code).toBe("real_only");

    const chaosR = await fetch(`${srv.url}/api/mocks/chaos`, { headers: authHeaders(ADMIN_TOKEN) });
    expect(chaosR.status).toBe(403);
    expect((await chaosR.json() as { code: string }).code).toBe("real_only");

    const ctrlR = await fetch(`${srv.url}/api/control`, {
      method: "POST",
      headers: authHeaders(ADMIN_TOKEN, { "content-type": "application/json", [MODE_HEADER]: "real" }),
      body: JSON.stringify({ type: "set_response_mode", mode: "hybrid" }),
    });
    expect(ctrlR.status).toBe(403);
    expect((await ctrlR.json() as { code: string }).code).toBe("real_only");
  });
});
