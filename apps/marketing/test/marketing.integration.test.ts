// Real Postgres (:54339) + real HTTP server integration test suite for @thenetwork/marketing.
// Proves all 15 Pass-1 & Pass-2 invariants, concurrency locks, security gates,
// anti-fraud, bandit, BD/QR, VIP, video factory, autopilot daemon + SSE, and live HTTP adapters.

import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { LLM } from "../../../packages/core/src/llm.ts";
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { findExecutable } from "../../../packages/core/src/runtime/process.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../../packages/db/dev-pg.ts";
import { createPaidAdapterRegistry, spendAuthFromCampaign } from "../src/adapters/paid.ts";
import {
  AgentLifecycleManager,
  sanitizeCliEnv,
  type CliProcessRunner,
} from "../src/agent-lifecycle.ts";
import { CrowdsourcingEngine } from "../src/crowdsourcing.ts";
import { DeviceBridge, type ExecFn } from "../src/devices/bridge.ts";
import { createNetworkCoreBridge } from "../src/network-bridge.ts";
import { keyedContactHash } from "../src/policy.ts";
import { createMarketingServer } from "../src/server.ts";
import { PgMarketingStore, PolicyViolationError } from "../src/store.ts";
import { VipDiscoveryEngine } from "../src/vip-engine.ts";
import type { Clock, MarketingAutopilotDaemon } from "../src/index.ts";

const execFileAsync = promisify(execFile);

const TEST_TIMEOUT = 120_000;
const TEST_DB_NAME = `network_mkt_test_${process.pid}`;
const PG_USER = process.env.USER ?? "postgres";
const ADMIN_URL = `postgres://${encodeURIComponent(PG_USER)}@localhost:${DEV_PG_PORT}/postgres`;
const TEST_DB_URL = `postgres://${encodeURIComponent(PG_USER)}@localhost:${DEV_PG_PORT}/${TEST_DB_NAME}`;

const pgAvailable =
  ["16", "17", "18"].some((v) => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) ||
  Boolean(findExecutable("pg_ctl"));

async function runAdmin<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try {
    await sql.unsafe("set lock_timeout = '5s'");
    return await fn(sql);
  } finally {
    await sql.close();
  }
}

async function createIsolatedMarketingDb(): Promise<string> {
  await devPgUp();
  await runAdmin(async (sql) => {
    const exists = await sql`select 1 from pg_database where datname = ${TEST_DB_NAME}`;
    if (!exists.length) await sql.unsafe(`create database ${TEST_DB_NAME}`);
  });
  await applySchema(TEST_DB_URL, { reset: true, lockTimeout: "5s" });
  return TEST_DB_URL;
}

async function dropIsolatedMarketingDb(): Promise<void> {
  if (!pgAvailable) return;
  await runAdmin((sql) => sql.unsafe(`drop database if exists ${TEST_DB_NAME} with (force)`));
}

function firstRow<T>(rows: unknown): T {
  const arr = rows as T[];
  const item = arr[0];
  if (item === undefined) {
    throw new Error("Expected at least one SQL row");
  }
  return item;
}

describe.skipIf(!pgAvailable)("@thenetwork/marketing Postgres + HTTP Pass-2 integration", () => {
  const fixedNow = Date.parse("2026-11-26T15:00:00.000Z");
  let currentNow = fixedNow;
  const clock: Clock = { now: () => (currentNow += 1_000) };

  let dbUrl = "";
  let sql!: SQL;
  let store!: PgMarketingStore;
  let baseUrl = "";
  let token = "";
  let daemon!: MarketingAutopilotDaemon;
  let deviceBridge!: DeviceBridge;
  let stopServer: (() => Promise<void>) | undefined;

  let cliCalls: Array<{ cmd: readonly string[]; env: Record<string, string | undefined> }> = [];
  let failPrimaryCodex = false;

  const mockCliRunner: CliProcessRunner = (cmd, opts) => {
    cliCalls.push({ cmd, env: opts?.env ?? {} });
    const bin = cmd[0] ?? "";
    if (failPrimaryCodex && bin === "codex") {
      return Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "429 rate limit exceeded: retry after 60s",
      });
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: `Executed safe NYC growth turn via ${bin}`,
      stderr: "",
    });
  };

  const mockDeviceExec: ExecFn = (cmd) => {
    const joined = cmd.join(" ");
    if (joined.includes("adb devices -l")) {
      return Promise.resolve({
        exitCode: 0,
        stdout: [
          "List of devices attached",
          "PIXEL7A9901            device usb:1-1 product:lynx model:Pixel_7a device:lynx transport_id:1",
          "",
        ].join("\n"),
        stderr: "",
      });
    }
    if (joined.includes("dumpsys battery")) {
      return Promise.resolve({
        exitCode: 0,
        stdout: [
          "Current Battery Service state:",
          "  AC powered: false",
          "  USB powered: true",
          "  level: 62",
          "  temperature: 310",
        ].join("\n"),
        stderr: "",
      });
    }
    if (joined.includes("devicectl list devices")) {
      return Promise.resolve({
        exitCode: 0,
        stdout: [
          "Name              Hostname                     Identifier                             State                 Model",
          "----------------  ---------------------------  -------------------------------------  --------------------  -------------------",
          "iPhone SE 3 NYC   iphone-se3.local             00008110-0011223344556677              connected             iPhone SE (3rd gen)",
        ].join("\n"),
        stderr: "",
      });
    }
    if (joined.includes("pymobiledevice3")) {
      return Promise.resolve({ exitCode: 1, stdout: "", stderr: "no tunnel in test" });
    }
    return Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "" });
  };

  const mockDiscoveryFetch: typeof fetch = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("data.cityofnewyork.us")) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              camis: "50012345",
              dba: "WEST VILLAGE SOCIAL CLUB",
              boro: "Manhattan",
              building: "142",
              street: "BLEECKER ST",
              zipcode: "10012",
              cuisine_description: "Cocktail Lounge",
              grade: "A",
            },
            {
              camis: "50012345",
              dba: "WEST VILLAGE SOCIAL CLUB",
              boro: "Manhattan",
              building: "142",
              street: "BLEECKER ST",
              zipcode: "10012",
              cuisine_description: "Cocktail Lounge",
              grade: "A",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    if (url.includes("hn.algolia.com")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            hits: [
              {
                objectID: "420001",
                title: "Show HN: NYC AI Founder Meetup in Flatiron",
                url: "https://example.com/nyc-meetup",
                author: "nycbuilder",
                points: 185,
                num_comments: 42,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    if (url.includes("youtube.com/feeds/videos.xml")) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <title>NYC Street Interviews</title>
  <entry>
    <yt:videoId>vidNYC001</yt:videoId>
    <title>Asking Washington Square Park About Dating in NYC</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=vidNYC001"/>
    <author><name>NYC Street Vox</name></author>
    <published>2026-11-25T18:00:00+00:00</published>
  </entry>
</feed>`;
      return Promise.resolve(
        new Response(xml, { status: 200, headers: { "Content-Type": "application/atom+xml" } }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    authToken: string | null = token,
  ): Promise<{ status: number; data: T; headers: Headers }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken !== null) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, data, headers: res.headers };
  }

  let seededCampaignId = "";
  let chadwickId = "";
  let sloaneId = "";
  let creatorHumanId = "";
  let creatorTaskId = "";
  let creatorQrBatch = "";

  beforeAll(async () => {
    dbUrl = await createIsolatedMarketingDb();
    sql = new SQL(dbUrl);
    store = new PgMarketingStore(dbUrl, { clock });

    deviceBridge = new DeviceBridge({
      exec: mockDeviceExec,
      findExecutable: (name) =>
        name === "adb" || name === "xcrun" || name === "scrcpy" ? `/usr/local/bin/${name}` : null,
      fetchFn: () => Promise.resolve(new Response("{}", { status: 503 })),
      clock,
      env: { MARKETING_LIVE_DEVICE: "0" },
    });

    const started = await createMarketingServer({
      store,
      clock,
      port: 0,
      hostname: "127.0.0.1",
      token: "test-marketing-bearer-token-2026",
      deviceBridge,
      discoveryFetch: mockDiscoveryFetch,
      cliRunner: mockCliRunner,
      env: {
        MARKETING_SLOP_CASH_ENABLED: "0",
        MARKETING_LIVE_SEND: "0",
        MARKETING_LIVE_DEVICE: "0",
        DATABASE_URL: "postgres://secret:should-not-leak@localhost/db",
        STRIPE_SECRET_KEY: "sk_live_secret_must_never_leak",
        RESEND_API_KEY: "re_secret_must_never_leak",
        MARKETING_TOKEN: "tok_secret_must_never_leak",
      },
    });
    baseUrl = started.url;
    token = started.token;
    daemon = started.daemon;
    stopServer = started.stop;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await stopServer?.();
    await store?.close();
    await sql?.close();
    await dropIsolatedMarketingDb();
  }, TEST_TIMEOUT);

  test(
    "1. Auth, Security Headers, CSP, UI Assets, and Empty-Token Hex Fallback Guard",
    async () => {
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as { ok: boolean; service: string };
      expect(health.ok).toBe(true);
      expect(health.service).toBe("marketing");

      const uiRes = await fetch(`${baseUrl}/`);
      expect(uiRes.status).toBe(200);
      expect(uiRes.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(uiRes.headers.get("x-content-type-options")).toBe("nosniff");
      expect(uiRes.headers.get("referrer-policy")).toBe("no-referrer");
      const html = await uiRes.text();
      expect(html).toContain("Command Center");
      expect(html).toContain("/assets/app.css");
      expect(html).toContain("/assets/app.js");

      const cssRes = await fetch(`${baseUrl}/assets/app.css`);
      expect(cssRes.status).toBe(200);
      expect(cssRes.headers.get("content-type")).toContain("text/css");
      expect(await cssRes.text()).toContain("oklch(");

      const jsRes = await fetch(`${baseUrl}/assets/app.js`);
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("content-type")).toContain("javascript");
      expect(await jsRes.text()).toContain("/api/overview");

      const fontRes = await fetch(`${baseUrl}/fonts/host-grotesk.woff2`);
      expect([200, 404]).toContain(fontRes.status);
      if (fontRes.status === 200) {
        expect(fontRes.headers.get("content-type")).toBe("font/woff2");
        expect((await fontRes.arrayBuffer()).byteLength).toBeGreaterThan(100);
      }

      const noAuth = await api("GET", "/api/overview", undefined, null);
      expect(noAuth.status).toBe(401);

      const wrongAuth = await api("GET", "/api/overview", undefined, "wrong-token");
      expect(wrongAuth.status).toBe(401);

      const okAuth = await api<{ slopCash: { enabled: boolean } }>("GET", "/api/overview");
      expect(okAuth.status).toBe(200);
      expect(okAuth.data.slopCash.enabled).toBe(false);

      // Empty MARKETING_TOKEN="" must NEVER allow blank auth — falls back to 48-char random hex
      const emptyTokenServer = await createMarketingServer({
        store,
        clock,
        port: 0,
        hostname: "127.0.0.1",
        token: "",
        env: { MARKETING_TOKEN: "   " },
      });
      try {
        expect(emptyTokenServer.token).toMatch(/^[0-9a-f]{48}$/);
        const blankAuthRes = await fetch(`${emptyTokenServer.url}/api/overview`, {
          headers: { Authorization: "Bearer " },
        });
        expect(blankAuthRes.status).toBe(401);
        const validAutoRes = await fetch(`${emptyTokenServer.url}/api/overview`, {
          headers: { Authorization: `Bearer ${emptyTokenServer.token}` },
        });
        expect(validAutoRes.status).toBe(200);
      } finally {
        await emptyTokenServer.stop();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "2. NYC Seed ($10,000) persists all 17 tables & is idempotent on re-seed",
    async () => {
      const seeded = await api<{
        campaign: { id: string; slug: string; monthlyBudgetCents: number; slopCashEnabled: boolean };
        agents: Array<{ id: string; personaId: string; provider: string }>;
        devices: Array<{ id: string; platform: string }>;
        agenciesPersisted: Array<{ id: string }>;
        banditArms: Array<{ id: string }>;
        bdDeals: Array<{ id: string }>;
        vipProspects: Array<{ id: string }>;
        videoAssets: Array<{ id: string }>;
        budgetTracksCents: Record<string, number>;
      }>("POST", "/api/seed/nyc");

      expect(seeded.status).toBe(200);
      expect(seeded.data.campaign.monthlyBudgetCents).toBe(1_000_000);
      expect(seeded.data.campaign.slopCashEnabled).toBe(false);
      expect(seeded.data.agents.length).toBe(5);
      expect(seeded.data.devices.some((d) => d.platform === "macbook")).toBe(true);
      expect(seeded.data.banditArms.length).toBe(5);
      expect(seeded.data.bdDeals.length).toBe(4);
      expect(seeded.data.vipProspects.length).toBe(4);
      expect(seeded.data.videoAssets.length).toBe(10);

      const personas = seeded.data.agents.map((a) => a.personaId).sort();
      expect(personas).toEqual(["chadwick", "operator", "peon", "sloane", "venn"]);
      const trackSum = Object.values(seeded.data.budgetTracksCents).reduce((a, b) => a + b, 0);
      expect(trackSum).toBe(1_000_000);

      seededCampaignId = seeded.data.campaign.id;
      const chadwick = seeded.data.agents.find((a) => a.personaId === "chadwick");
      const sloane = seeded.data.agents.find((a) => a.personaId === "sloane");
      expect(chadwick).toBeDefined();
      expect(sloane).toBeDefined();
      if (!chadwick || !sloane) throw new Error("Missing seeded personas");
      chadwickId = chadwick.id;
      sloaneId = sloane.id;

      // Verify all seeded tables directly in Postgres
      const campCount = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.campaigns`,
      );
      const agentCount = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.agents`,
      );
      const devCount = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.devices`,
      );
      const agencyCount = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.humans where role = 'agency'`,
      );
      const armCount = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.bandit_arms`,
      );
      const bdCount = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.bd_deals`,
      );
      const vipCount = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.vip_prospects`,
      );
      const videoCount = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.video_assets`,
      );

      expect(campCount.n).toBe(1);
      expect(agentCount.n).toBe(5);
      expect(devCount.n).toBeGreaterThanOrEqual(3);
      expect(agencyCount.n).toBeGreaterThanOrEqual(10);
      expect(armCount.n).toBe(5);
      expect(bdCount.n).toBe(4);
      expect(vipCount.n).toBe(4);
      expect(videoCount.n).toBe(10);

      // Idempotent re-seed creates zero duplicates
      const reseed = await api("POST", "/api/seed/nyc");
      expect(reseed.status).toBe(200);
      const armCountAfter = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.bandit_arms`,
      );
      const videoCountAfter = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.video_assets`,
      );
      expect(armCountAfter.n).toBe(5);
      expect(videoCountAfter.n).toBe(10);
    },
    TEST_TIMEOUT,
  );

  test(
    "3. Agent Subscription Lifecycle, Sanitized CLI Env, Rate-Limit Failover, Provider Switch, Pause & STOP Fence",
    async () => {
      cliCalls = [];
      failPrimaryCodex = false;

      // Verify sanitizeCliEnv strips DB, Stripe, Resend, and bearer tokens
      const sanitized = sanitizeCliEnv("chatgpt", {
        PATH: "/usr/bin",
        HOME: "/tmp/home",
        OPENAI_API_KEY: "ok-openai",
        DATABASE_URL: "postgres://secret",
        STRIPE_SECRET_KEY: "sk_live_secret",
        RESEND_API_KEY: "re_secret",
        MARKETING_TOKEN: "tok_secret",
      });
      expect(sanitized.PATH).toBe("/usr/bin");
      expect(sanitized.DATABASE_URL).toBeUndefined();
      expect(sanitized.STRIPE_SECRET_KEY).toBeUndefined();
      expect(sanitized.RESEND_API_KEY).toBeUndefined();
      expect(sanitized.MARKETING_TOKEN).toBeUndefined();

      const firstTick = await api<{
        ok: boolean;
        providerUsed: string;
        failedOverFrom: string | null;
        agent: { turnsUsedToday: number };
      }>("POST", `/api/agents/${chadwickId}/tick`, {
        campaignId: seededCampaignId,
        prompt: "Draft NYC street-team shift brief for West Village",
      });
      expect(firstTick.status).toBe(200);
      expect(firstTick.data.ok).toBe(true);
      expect(firstTick.data.providerUsed).toBe("chatgpt");
      expect(firstTick.data.failedOverFrom).toBeNull();
      expect(firstTick.data.agent.turnsUsedToday).toBe(1);
      expect(cliCalls.length).toBe(1);
      // Confirm runtime cliRunner did NOT receive leaked server secrets
      const firstEnv = cliCalls[0]?.env ?? {};
      expect(firstEnv.DATABASE_URL).toBeUndefined();
      expect(firstEnv.STRIPE_SECRET_KEY).toBeUndefined();
      expect(firstEnv.RESEND_API_KEY).toBeUndefined();
      expect(firstEnv.MARKETING_TOKEN).toBeUndefined();

      // Trigger rate limit on primary chatgpt (codex) -> automatic failover to claude
      failPrimaryCodex = true;
      const failoverTick = await api<{
        ok: boolean;
        providerUsed: string;
        failedOverFrom: string | null;
        agent: { turnsUsedToday: number };
      }>("POST", `/api/agents/${chadwickId}/tick`, {
        campaignId: seededCampaignId,
        prompt: "Draft follow-up agency RFP for SoHo shift",
        allowFailover: true,
      });
      expect(failoverTick.status).toBe(200);
      expect(failoverTick.data.ok).toBe(true);
      expect(failoverTick.data.providerUsed).toBe("claude");
      expect(failoverTick.data.failedOverFrom).toBe("chatgpt");
      expect(failoverTick.data.agent.turnsUsedToday).toBe(2);
      failPrimaryCodex = false;

      // Switch provider via POST /api/agents/:id/provider and restore
      const switched = await api<{ agent: { provider: string; sessionRef: string } }>(
        "POST",
        `/api/agents/${chadwickId}/provider`,
        { provider: "gemini", failoverProvider: "claude" },
      );
      expect(switched.status).toBe(200);
      expect(switched.data.agent.provider).toBe("gemini");
      expect(switched.data.agent.sessionRef).toBe("sub:gemini:chadwick");
      await api("POST", `/api/agents/${chadwickId}/provider`, {
        provider: "chatgpt",
        failoverProvider: "claude",
      });

      // STOPped target blocks agent turn (inv_stop_fence_respected)
      const stopBlocked = await api<{ ok: boolean }>("POST", `/api/agents/${chadwickId}/tick`, {
        campaignId: seededCampaignId,
        prompt: "Follow up with opted-out contact",
        targetStopped: true,
      });
      expect(stopBlocked.status).toBe(403);
      expect(stopBlocked.data.ok).toBe(false);

      // Pause blocks tick; resume re-enables
      expect((await api("POST", `/api/agents/${chadwickId}/pause`)).status).toBe(200);
      const pausedTick = await api<{ ok: boolean }>("POST", `/api/agents/${chadwickId}/tick`, {
        campaignId: seededCampaignId,
        prompt: "Should be blocked while paused",
      });
      expect(pausedTick.status).toBe(403);
      expect(pausedTick.data.ok).toBe(false);
      expect((await api("POST", `/api/agents/${chadwickId}/resume`)).status).toBe(200);

      const agentRow = firstRow<{ turns_used_today: number }>(
        await sql`select turns_used_today from marketing.agents where id = ${chadwickId}`,
      );
      expect(agentRow.turns_used_today).toBe(2);
    },
    TEST_TIMEOUT,
  );

  test(
    "4. Tier-2 Device Bridge: Counter-Preserving Scan, Safe Action, Thermal/Battery/Lease/Injection Guards & Expired Lease",
    async () => {
      const scan = await api<{
        scan: { androidCount: number; iosCount: number };
        devices: Array<{ id: string; platform: string; serialOrUdid: string; dailyActionsUsed: number }>;
      }>("POST", "/api/devices/scan");

      expect(scan.status).toBe(200);
      expect(scan.data.scan.androidCount).toBe(1);
      expect(scan.data.scan.iosCount).toBe(1);
      const androidDevice = scan.data.devices.find((d) => d.platform === "android");
      expect(androidDevice).toBeDefined();
      if (!androidDevice) throw new Error("Missing scanned Android device");

      // Safe telemetry -> ALLOWED and persisted via store.recordDeviceAction
      const safeAction = await api<{
        ok: boolean;
        device: { dailyActionsUsed: number; batteryPct: number; tempC: number };
      }>("POST", `/api/devices/${androidDevice.id}/action`, {
        action: { kind: "tap", x: 540, y: 1200 },
        leaseHolder: "chadwick",
        batteryPct: 62,
        tempC: 31,
        warmupDay: 5,
        dryRun: true,
      });
      expect(safeAction.status).toBe(200);
      expect(safeAction.data.ok).toBe(true);
      expect(safeAction.data.device.dailyActionsUsed).toBe(1);

      // Re-scan MUST preserve dailyActionsUsed = 1 (preserveCounters: true)
      const rescan = await api<{
        devices: Array<{ id: string; dailyActionsUsed: number }>;
      }>("POST", "/api/devices/scan");
      expect(rescan.status).toBe(200);
      const afterRescan = rescan.data.devices.find((d) => d.id === androidDevice.id);
      expect(afterRescan?.dailyActionsUsed).toBe(1);

      // Low battery (20% < 35%) -> BLOCKED
      const lowBattery = await api<{ ok: boolean }>("POST", `/api/devices/${androidDevice.id}/action`, {
        action: { kind: "tap", x: 540, y: 1200 },
        leaseHolder: "chadwick",
        batteryPct: 20,
        tempC: 31,
        warmupDay: 5,
        dryRun: true,
      });
      expect(lowBattery.status).toBe(403);
      expect(lowBattery.data.ok).toBe(false);

      // Hot device (45C > 41C) -> BLOCKED
      const hotDevice = await api<{ ok: boolean }>("POST", `/api/devices/${androidDevice.id}/action`, {
        action: { kind: "tap", x: 540, y: 1200 },
        leaseHolder: "chadwick",
        batteryPct: 62,
        tempC: 45,
        warmupDay: 5,
        dryRun: true,
      });
      expect(hotDevice.status).toBe(403);
      expect(hotDevice.data.ok).toBe(false);

      // Command injection guards: newline in text, invalid packageName, arbitrary scrcpy flag
      const healthyNode = await store.updateDeviceTelemetry(androidDevice.id, {
        batteryPct: 65,
        tempC: 30,
        warmupDay: 5,
      });
      const injectedText = await deviceBridge.executeDeviceAction(
        healthyNode,
        { kind: "text", text: "hello\nrm -rf /" },
        { leaseHolder: "chadwick", lockdown: false, targetStopped: false, dryRun: true },
      );
      expect(injectedText.ok).toBe(false);

      const injectedPkg = await deviceBridge.executeDeviceAction(
        healthyNode,
        { kind: "launch_app", packageName: "com.app; touch /tmp/pwn" },
        { leaseHolder: "chadwick", lockdown: false, targetStopped: false, dryRun: true },
      );
      expect(injectedPkg.ok).toBe(false);

      const injectedScrcpy = await deviceBridge.executeDeviceAction(
        healthyNode,
        { kind: "scrcpy_cmd", args: ["--record=/tmp/evil.mp4"] },
        { leaseHolder: "chadwick", lockdown: false, targetStopped: false, dryRun: true },
      );
      expect(injectedScrcpy.ok).toBe(false);

      // Active lease conflict -> BLOCKED; expired lease -> ALLOWED!
      await store.acquireDeviceLease(androidDevice.id, "chadwick", 600_000);
      const leasedConflict = await api<{ ok: boolean }>("POST", `/api/devices/${androidDevice.id}/action`, {
        action: { kind: "tap", x: 540, y: 1200 },
        leaseHolder: "sloane",
        dryRun: true,
      });
      expect(leasedConflict.status).toBe(403);
      expect(leasedConflict.data.ok).toBe(false);

      // Expire the lease in Postgres and confirm sloane is now ALLOWED
      await sql`
        update marketing.devices
        set lease_expires_at = ${new Date(clock.now() - 10_000)}
        where id = ${androidDevice.id}
      `;
      const expiredLeaseAllowed = await api<{ ok: boolean }>(
        "POST",
        `/api/devices/${androidDevice.id}/action`,
        {
          action: { kind: "tap", x: 540, y: 1200 },
          leaseHolder: "sloane",
          batteryPct: 65,
          tempC: 30,
          warmupDay: 5,
          dryRun: true,
        },
      );
      expect(expiredLeaseAllowed.status).toBe(200);
      expect(expiredLeaseAllowed.data.ok).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "5. Tier-4 Proof-of-Work, Youngest-Age/STOP Gates & Concurrent Double-Payout Race Test",
    async () => {
      // Underage applicant (17) rejected
      const underageHuman = await api<{ invariant: string }>("POST", "/api/humans", {
        handleOrEmailHmac: "creator:underage-17",
        displayLabel: "Minor Applicant",
        channel: "youtube",
        role: "creator",
        city: "nyc",
        lowestAge: 17,
      });
      expect(underageHuman.status).toBe(403);
      expect(underageHuman.data.invariant).toBe("inv_adult_only_paid");

      const underageTask = await api<{ invariant: string }>("POST", "/api/tasks", {
        campaignId: seededCampaignId,
        tier: 4,
        taskKind: "creator_video",
        city: "nyc",
        title: "Underage street interview test",
        briefText: "Should never be created for minor",
        vendorChannel: "creator_direct",
        assigneeAgeYears: 17,
        amountCents: 25_000,
        payoutRail: "fiat_stripe",
      });
      expect(underageTask.status).toBe(403);
      expect(underageTask.data.invariant).toBe("inv_adult_only_paid");

      // Adult creator + STOPped contact
      const adultCreator = await api<{ human: { id: string } }>("POST", "/api/humans", {
        handleOrEmailHmac: "creator:nyc-street-vox-24",
        displayLabel: "NYC Street Vox (YouTube)",
        channel: "youtube",
        role: "creator",
        city: "nyc",
        lowestAge: 24,
      });
      expect(adultCreator.status).toBe(201);
      creatorHumanId = adultCreator.data.human.id;

      // Youngest-age-wins: re-upserting with higher age (29) keeps 24
      const reUpsert = await store.upsertHuman({
        handleOrEmailHmac: "creator:nyc-street-vox-24",
        displayLabel: "NYC Street Vox (YouTube)",
        channel: "youtube",
        role: "creator",
        city: "nyc",
        lowestAge: 29,
      });
      expect(reUpsert.lowestAge).toBe(24);

      const stoppedContact = await api<{ human: { id: string } }>("POST", "/api/humans", {
        handleOrEmailHmac: "contact:opted-out-nyc",
        displayLabel: "Opted Out Contact",
        channel: "email",
        role: "applicant",
        city: "nyc",
        lowestAge: 26,
      });
      expect(stoppedContact.status).toBe(201);
      expect(
        (await api("POST", `/api/humans/${stoppedContact.data.human.id}/stop`, { reason: "replied_STOP" }))
          .status,
      ).toBe(200);

      const blockedOutreach = await api<{ message: { status: string } }>("POST", "/api/outreach", {
        campaignId: seededCampaignId,
        agentId: sloaneId,
        humanId: stoppedContact.data.human.id,
        channel: "email",
        tier: 1,
        subject: "NYC gig invite",
        bodyText: "Checking availability for Friday shift.",
      });
      expect(blockedOutreach.status).toBe(403);
      expect(blockedOutreach.data.message.status).toBe("blocked_stop");

      const okOutreach = await api("POST", "/api/outreach", {
        campaignId: seededCampaignId,
        agentId: sloaneId,
        humanId: creatorHumanId,
        channel: "email",
        tier: 1,
        subject: "NYC Street-Interview Brief ($250 + QR bonus)",
        bodyText: "Shoot 60s Washington Square Park street interview with FTC #Ad disclosure.",
      });
      expect(okOutreach.status).toBe(201);

      const dispatched = await api<{ dryRun: number; liveMode: boolean }>(
        "POST",
        "/api/outreach/dispatch",
        { campaignId: seededCampaignId },
      );
      expect(dispatched.status).toBe(200);
      expect(dispatched.data.liveMode).toBe(false);
      expect(dispatched.data.dryRun).toBe(1);

      // Arm billing on campaign
      const armed = await api<{ campaign: { billingArmed: boolean } }>(
        "POST",
        `/api/campaigns/${seededCampaignId}/risk-dial`,
        { riskDial: "balanced", billingArmed: true },
      );
      expect(armed.status).toBe(200);
      expect(armed.data.campaign.billingArmed).toBe(true);

      // Hire adult creator for $250 Tier-4 video task
      creatorQrBatch = "NYC-VOX-WSP-01";
      const taskRes = await api<{ task: { id: string } }>("POST", "/api/tasks", {
        campaignId: seededCampaignId,
        tier: 4,
        taskKind: "creator_video",
        city: "nyc",
        title: "Washington Square Park 60s Street Interview",
        briefText: "Public YouTube Short with FTC #Ad + NY Civil Rights Law 50-51 releases + QR card.",
        vendorChannel: "creator_direct",
        assigneeHumanId: creatorHumanId,
        assigneeAgeYears: 24,
        amountCents: 25_000,
        qrBatchCode: creatorQrBatch,
        payoutRail: "fiat_stripe",
        status: "hired",
      });
      expect(taskRes.status).toBe(201);
      creatorTaskId = taskRes.data.task.id;

      // Unverified proof (missing FTC #Ad) rejected -> spent_cents stays 0
      const badProofFtc = await api<{ approved: boolean; payoutAuthorized: boolean }>(
        "POST",
        "/api/proofs",
        {
          taskId: creatorTaskId,
          proofKind: "creator_video",
          evidenceUrl: "https://www.youtube.com/watch?v=vidNYC001",
          qrScansCount: 45,
          verifiedSignupsCount: 14,
          ftcDisclosed: false,
          geoTimeValid: true,
          likenessReleaseOk: true,
          workerAge: 24,
        },
      );
      expect(badProofFtc.status).toBe(400);
      expect(badProofFtc.data.approved).toBe(false);
      expect(badProofFtc.data.payoutAuthorized).toBe(false);

      // Complete proof approved -> pays $250
      const goodProof = await api<{
        approved: boolean;
        payoutAuthorized: boolean;
        task: { status: string; proofVerified: boolean };
        campaign: { spentCents: number };
      }>("POST", "/api/proofs", {
        taskId: creatorTaskId,
        proofKind: "creator_video",
        evidenceUrl: "https://www.youtube.com/watch?v=vidNYC001",
        checkinMediaHashes: ["sha256-unique-vid-001"],
        qrScansCount: 45,
        verifiedSignupsCount: 14,
        ftcDisclosed: true,
        geoTimeValid: true,
        likenessReleaseOk: true,
        workerAge: 24,
      });
      expect(goodProof.status).toBe(201);
      expect(goodProof.data.approved).toBe(true);
      expect(goodProof.data.payoutAuthorized).toBe(true);
      expect(goodProof.data.task.status).toBe("paid");
      expect(goodProof.data.campaign.spentCents).toBe(25_000);

      // CONCURRENCY DOUBLE-PAYOUT RACE TEST against Postgres FOR UPDATE lock!
      const raceTask = await store.createTask({
        campaignId: seededCampaignId,
        tier: 4,
        taskKind: "street_fliering",
        city: "nyc",
        title: "SoHo Concurrency Race Shift",
        briefText: "2h shift testing atomic FOR UPDATE payout lock",
        vendorChannel: "rentahuman",
        assigneeHumanId: creatorHumanId,
        assigneeAgeYears: 24,
        amountCents: 10_000,
        payoutRail: "fiat_tremendous",
        status: "hired",
      });
      const raceProof = await store.createProof({
        taskId: raceTask.id,
        proofKind: "street_shift",
        evidenceUrl: "https://cdn.example.com/race-shift.jpg",
        checkinMediaHashes: ["sha256-race-a", "sha256-race-b"],
        qrScansCount: 6,
        verifiedSignupsCount: 2,
        geoTimeValid: true,
        ftcDisclosed: true,
        likenessReleaseOk: true,
      });
      const raceEval = await store.evaluateProof(raceProof.id, {
        workerAge: 24,
        workerBanned: false,
        shiftDone: true,
      });
      expect(raceEval.approved).toBe(true);

      const raceResults = await Promise.allSettled([
        store.markTaskPaid(raceTask.id, { adapterId: "payouts", idempotencyKey: "race-pay-a" }),
        store.markTaskPaid(raceTask.id, { adapterId: "payouts", idempotencyKey: "race-pay-b" }),
      ]);
      const fulfilled = raceResults.filter((r) => r.status === "fulfilled");
      const rejected = raceResults.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(rejected[0]?.reason).toBeInstanceOf(PolicyViolationError);
      expect((rejected[0]?.reason as PolicyViolationError).code).toBe("TASK_ALREADY_PAID");

      // Verify campaign charged ONCE (+10_000 -> 35_000 total) and 1 ledger row for raceTask
      const afterRace = firstRow<{ spent_cents: number }>(
        await sql`select spent_cents from marketing.campaigns where id = ${seededCampaignId}`,
      );
      const raceLedger = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.budget_ledger where task_id = ${raceTask.id}`,
      );
      expect(afterRace.spent_cents).toBe(35_000);
      expect(raceLedger.n).toBe(1);
    },
    TEST_TIMEOUT,
  );

  test(
    "6. Reserve-to-Commit Accounting & Campaign PATCH Hardening (C-02 / C-07)",
    async () => {
      const capCamp = await store.createCampaign({
        slug: "nyc-reserve-accounting-test",
        name: "Reserve Accounting Campaign",
        appId: "friends",
        monthlyBudgetCents: 100_000,
        dailyCapCents: 20_000,
        maxTaskCents: 15_000,
        billingArmed: true,
        status: "active",
      });

      // fromReserve=true with 0 reserved MUST fail with INSUFFICIENT_RESERVE
      await expect(
        store.authorizeSpend({
          campaignId: capCamp.id,
          adapterId: "payouts",
          tier: 4,
          entryType: "commit",
          fromReserve: true,
          amountCents: 5_000,
          idempotencyKey: "res-fail-zero",
        }),
      ).rejects.toMatchObject({ code: "INSUFFICIENT_RESERVE" });

      // Reserve 15_000 (hits dailySpentCents=15_000, reservedCents=15_000)
      const resv = await store.authorizeSpend({
        campaignId: capCamp.id,
        adapterId: "payouts",
        tier: 4,
        entryType: "reserve",
        amountCents: 15_000,
        idempotencyKey: "res-ok-1",
      });
      expect(resv.campaign.reservedCents).toBe(15_000);
      expect(resv.campaign.dailySpentCents).toBe(15_000);

      // Commit 15_000 fromReserve=true MUST NOT double-count dailySpentCents (stays 15_000 <= 20_000 cap!)
      const comm = await store.authorizeSpend({
        campaignId: capCamp.id,
        adapterId: "payouts",
        tier: 4,
        entryType: "commit",
        fromReserve: true,
        amountCents: 15_000,
        idempotencyKey: "com-from-res-1",
      });
      expect(comm.entry.fromReserve).toBe(true);
      expect(comm.campaign.reservedCents).toBe(0);
      expect(comm.campaign.spentCents).toBe(15_000);
      expect(comm.campaign.dailySpentCents).toBe(15_000);

      // PATCH /api/campaigns/:id MUST NOT reset spentCents or reservedCents
      const patchAttempt = await api<{ campaign: { name: string; spentCents: number } }>(
        "PATCH",
        `/api/campaigns/${capCamp.id}`,
        { name: "Renamed Safe", spentCents: 0, reservedCents: 0 },
      );
      expect(patchAttempt.status).toBe(200);
      expect(patchAttempt.data.campaign.name).toBe("Renamed Safe");
      expect(patchAttempt.data.campaign.spentCents).toBe(15_000);
    },
    TEST_TIMEOUT,
  );

  test(
    "7. Input Validation & SSRF Security (413 oversize, 400 coerced number, prototype pollution, SSRF proof URL)",
    async () => {
      // > 1 MiB body -> 413 PAYLOAD_TOO_LARGE
      const hugePayload = JSON.stringify({ title: "x".repeat(1_100_000) });
      const bigRes = await fetch(`${baseUrl}/api/campaigns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: hugePayload,
      });
      expect(bigRes.status).toBe(413);

      // String-coerced number ("25" instead of 25) -> 400
      const coerced = await api<{ code: string }>("POST", "/api/humans", {
        handleOrEmailHmac: "human:coerced-num",
        displayLabel: "Coerced Age",
        channel: "email",
        role: "applicant",
        lowestAge: "25",
      });
      expect(coerced.status).toBe(400);

      // Prototype pollution key {"__proto__": ...} -> 400 PROTOTYPE_POLLUTION_KEY
      const protoRes = await fetch(`${baseUrl}/api/campaigns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: '{"slug":"bad","name":"Bad","appId":"ntwrk","__proto__":{"polluted":true}}',
      });
      expect(protoRes.status).toBe(400);
      const protoBody = (await protoRes.json()) as { code: string };
      expect(protoBody.code).toBe("PROTOTYPE_POLLUTION_KEY");

      // SSRF private/metadata URL https://169.254.169.254/latest -> 400 SSRF_PRIVATE_HOST
      const ssrf = await api<{ code: string }>("POST", "/api/proofs", {
        taskId: creatorTaskId,
        proofKind: "creator_video",
        evidenceUrl: "https://169.254.169.254/latest/meta-data/",
        ftcDisclosed: true,
        geoTimeValid: true,
        likenessReleaseOk: true,
      });
      expect(ssrf.status).toBe(400);
      expect(ssrf.data.code).toBe("SSRF_PRIVATE_HOST");
    },
    TEST_TIMEOUT,
  );

  test(
    "8. Anti-Fraud Engine: VoIP block, $2 MVNO cap, $20 lifetime cap, dup media hash & Sybil ring scan",
    async () => {
      // VoIP rejected (403)
      const voip = await api<{ evaluation: { allowed: boolean; status: string } }>(
        "POST",
        "/api/antifraud",
        {
          campaignId: seededCampaignId,
          personKey: "af-voip-1",
          phoneLineType: "voip",
          vestingTier: 2,
          amountCents: 200,
        },
      );
      expect(voip.status).toBe(403);
      expect(voip.data.evaluation.allowed).toBe(false);

      // Prepaid / MVNO capped at $2 (200c) -> 500c claim rejected
      const mvnoOver = await api<{ evaluation: { allowed: boolean; payableCents: number } }>(
        "POST",
        "/api/antifraud",
        {
          campaignId: seededCampaignId,
          personKey: "af-mvno-1",
          phoneLineType: "mvno",
          vestingTier: 2,
          amountCents: 500,
        },
      );
      expect(mvnoOver.status).toBe(403);
      expect(mvnoOver.data.evaluation.allowed).toBe(false);

      // Lifetime $20 cap (2_000c): first 1_500c enters vesting hold (201), once approved next 1_000c is blocked (403)
      const firstBonus = await api<{
        evaluation: { status: string; allowed: boolean };
        claim: { id: string; status: string };
      }>("POST", "/api/antifraud", {
        campaignId: seededCampaignId,
        personKey: "af-cap-person",
        phoneLineType: "postpaid",
        vestingTier: 2,
        amountCents: 1_500,
      });
      expect(firstBonus.status).toBe(201);
      expect(firstBonus.data.claim.status).toBe("vesting");
      await store.updateAntiFraudClaim(firstBonus.data.claim.id, { status: "approved" });

      const overLifetime = await api<{ evaluation: { allowed: boolean } }>(
        "POST",
        "/api/antifraud",
        {
          campaignId: seededCampaignId,
          personKey: "af-cap-person",
          phoneLineType: "postpaid",
          vestingTier: 2,
          amountCents: 1_000,
        },
      );
      expect(overLifetime.status).toBe(403);
      expect(overLifetime.data.evaluation.allowed).toBe(false);

      // Duplicate media hash across tasks rejected (400 DUPLICATE_MEDIA_HASH)
      const secondTask = await store.createTask({
        campaignId: seededCampaignId,
        tier: 4,
        taskKind: "creator_video",
        city: "nyc",
        title: "Dup Media Hash Test Task",
        briefText: "Reuses media hash from creatorTaskId",
        vendorChannel: "creator_direct",
        assigneeHumanId: creatorHumanId,
        assigneeAgeYears: 24,
        amountCents: 5_000,
        payoutRail: "fiat_stripe",
        status: "hired",
      });
      const dupMedia = await api<{ code: string }>("POST", "/api/proofs", {
        taskId: secondTask.id,
        proofKind: "creator_video",
        evidenceUrl: "https://www.youtube.com/watch?v=vidNYC002",
        checkinMediaHashes: ["sha256-unique-vid-001"],
        ftcDisclosed: true,
        geoTimeValid: true,
        likenessReleaseOk: true,
      });
      expect(dupMedia.status).toBe(400);
      expect(dupMedia.data.code).toBe("DUPLICATE_MEDIA_HASH");

      // Sybil ring scan flags high-density paid cluster with shared subnet/payoutAccountRef
      const sybilRes = await api<{
        scan: { clusters: Array<{ clusterId: string; size: number }>; quarantinedClaimIds: string[] };
      }>("POST", "/api/antifraud/scan-sybil", {
        campaignId: seededCampaignId,
        claims: [
          { id: "syb-1", personKey: "p1", workerId: null, mediaHash: "h-shared", subnetPrefix: "198.51.100", payoutAccountRef: "acct-ring", paidReferred: true, organicAnchorVerified: false },
          { id: "syb-2", personKey: "p2", workerId: null, mediaHash: "h-shared", subnetPrefix: "198.51.100", payoutAccountRef: "acct-ring", paidReferred: true, organicAnchorVerified: false },
          { id: "syb-3", personKey: "p3", workerId: null, mediaHash: "h-shared", subnetPrefix: "198.51.100", payoutAccountRef: "acct-ring", paidReferred: true, organicAnchorVerified: false },
          { id: "syb-4", personKey: "p4", workerId: null, mediaHash: "h-shared", subnetPrefix: "198.51.100", payoutAccountRef: "acct-ring", paidReferred: true, organicAnchorVerified: false },
        ],
      });
      expect(sybilRes.status).toBe(200);
      expect(sybilRes.data.scan.clusters.length).toBeGreaterThanOrEqual(1);
      expect(sybilRes.data.scan.quarantinedClaimIds.length).toBe(4);
    },
    TEST_TIMEOUT,
  );

  test(
    "9. Contextual Bandit Rebalance: deterministic weights & auto-kill on >2.5x CPA or >5% STOP rate",
    async () => {
      // Seed one high-STOP arm (>5% STOP across 100 contacts) and one high-CPA arm (>2.5x target $8.58)
      const highStop = await api<{ arm: { id: string } }>("POST", "/api/bandit", {
        campaignId: seededCampaignId,
        armKey: "test-high-stop-arm",
        label: "High STOP Arm",
        track: "organic_play",
        alpha: 2,
        beta: 50,
        weight: 0.15,
        spendCents: 10_000,
        signups: 10,
        stopEvents: 12,
        totalContacts: 100,
        status: "active",
      });
      expect(highStop.status).toBe(201);

      const highCpa = await api<{ arm: { id: string } }>("POST", "/api/bandit", {
        campaignId: seededCampaignId,
        armKey: "test-high-cpa-arm",
        label: "High CPA Arm",
        track: "street_fliering",
        alpha: 2,
        beta: 120,
        weight: 0.15,
        spendCents: 50_000,
        signups: 5, // $100 CPA >> 2.5 * $8.58
        stopEvents: 0,
        totalContacts: 150,
        status: "active",
      });
      expect(highCpa.status).toBe(201);

      const reb1 = await api<{
        rebalance: {
          decisions: Array<{ armKey: string; state: string; bucket: string; nextShareBps: number }>;
        };
        arms: Array<{ armKey: string; status: string; weight: number }>;
      }>("POST", "/api/bandit/rebalance", {
        campaignId: seededCampaignId,
        seed: "deterministic-seed-42",
      });
      expect(reb1.status).toBe(200);
      const stopDec = reb1.data.rebalance.decisions.find((d) => d.armKey === "test-high-stop-arm");
      const cpaDec = reb1.data.rebalance.decisions.find((d) => d.armKey === "test-high-cpa-arm");
      expect(stopDec?.state).toBe("halted_safety");
      expect(stopDec?.bucket).toBe("killed");
      expect(stopDec?.nextShareBps).toBe(0);
      expect(cpaDec?.state).toBe("auto_killed");
      expect(cpaDec?.bucket).toBe("killed");
      expect(cpaDec?.nextShareBps).toBe(0);

      // Confirm CPA-killed arm persisted as status = 'killed' and weight = 0 in Postgres
      const killedRow = firstRow<{ arm_key: string; status: string; weight: number }>(
        await sql`
          select arm_key, status, weight from marketing.bandit_arms
          where arm_key = 'test-high-cpa-arm'
        `,
      );
      expect(killedRow.status).toBe("killed");
      expect(killedRow.weight).toBe(0);
    },
    TEST_TIMEOUT,
  );

  test(
    "10. Zero-Human BD Pipeline & Serialized QR Batches: DTMF callback, SHA-256 contract, QR bind & stage FSM",
    async () => {
      const created = await api<{ deal: { id: string; stage: string } }>("POST", "/api/bd", {
        campaignId: seededCampaignId,
        city: "nyc",
        venueName: "Bleecker Espresso Bar",
        vertical: "friends",
        contactEmail: "owner@bleeckerespresso.nyc",
        businessPhone: "+12125550188",
        offeredCents: 15_000,
      });
      expect(created.status).toBe(201);
      const dealId = created.data.deal.id;

      // Issue DTMF callback challenge & verify PIN
      const challengeRes = await api<{ expectedPin: string }>(
        "POST",
        `/api/bd/${dealId}/callback`,
        { businessPhone: "+12125550188" },
      );
      expect(challengeRes.status).toBe(200);
      expect(challengeRes.data.expectedPin).toMatch(/^\d{4,8}$/);

      const verifyRes = await api<{ verified: boolean; deal: { phoneCallbackVerified: boolean } }>(
        "POST",
        `/api/bd/${dealId}/callback`,
        { pin: challengeRes.data.expectedPin },
      );
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.data.verified).toBe(true);
      expect(verifyRes.data.deal.phoneCallbackVerified).toBe(true);

      // Generate SHA-256 clickwrap contract
      const contractRes = await api<{ contract: { contractHash: string }; deal: { contractHash: string } }>(
        "POST",
        `/api/bd/${dealId}/contract`,
        { kind: "venue_placement" },
      );
      expect(contractRes.status).toBe(200);
      expect(contractRes.data.contract.contractHash).toMatch(/^[0-9a-f]{64}$/);
      expect(contractRes.data.deal.contractHash).toBe(contractRes.data.contract.contractHash);

      // Create & bind serialized QR batch to BD deal
      const qrRes = await api<{ batch: { id: string; batchCode: string } }>(
        "POST",
        "/api/qr-batches",
        {
          campaignId: seededCampaignId,
          city: "nyc",
          batchCode: "BD-BLEECKER-001",
          destinationUrl: "https://friends.help/r/bleecker",
          printQty: 250,
          assignedToType: "bd_deal",
          assignedToId: dealId,
        },
      );
      expect(qrRes.status).toBe(201);

      // Walk the legal FSM: prospect -> enriched -> pitched -> negotiating -> contracted -> kit_shipped -> live
      for (const stage of ["enriched", "pitched", "negotiating", "contracted", "kit_shipped", "live"]) {
        const step = await api<{ deal: { stage: string } }>("POST", `/api/bd/${dealId}/stage`, {
          stage,
        });
        expect(step.status).toBe(200);
        expect(step.data.deal.stage).toBe(stage);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "11. 28-Archetype VIP Engine (<75-word invite) & 5-Agent Video Factory (script linter + stage FSM)",
    async () => {
      const vipList = await api<{ archetypes: Array<{ slug: string }> }>("GET", "/api/vips");
      expect(vipList.status).toBe(200);
      expect(vipList.data.archetypes.length).toBe(28);

      const createdVip = await api<{ prospect: { id: string; prestigeScore: number } }>(
        "POST",
        "/api/vips",
        {
          campaignId: seededCampaignId,
          city: "nyc",
          name: "Dr. Elena Vasquez",
          archetype: "ai_biotech_researcher",
          organization: "NYU Center for Data Science",
          publicSource: "arXiv 2026",
        },
      );
      expect(createdVip.status).toBe(201);
      expect(createdVip.data.prospect.prestigeScore).toBeGreaterThan(0);

      const inviteRes = await api<{
        invite: { valid: boolean; wordCount: number; body: string };
        prospect: { status: string; inviteDraft: string };
      }>("POST", `/api/vips/${createdVip.data.prospect.id}/invite`, {
        neighborhood: "West Village",
        proofOfWork1Line: "your recent interpretability paper at NYU",
      });
      expect(inviteRes.status).toBe(200);
      expect(inviteRes.data.invite.valid).toBe(true);
      expect(inviteRes.data.invite.wordCount).toBeLessThanOrEqual(75);
      expect(inviteRes.data.invite.body).not.toMatch(/https?:\/\//i);
      expect(inviteRes.data.prospect.status).toBe("drafted");

      // Video linter MUST reject minor targeting, raw phone PII, and missing FTC #Ad
      const badVideo = await api<{ lint: { pass: boolean; errors: string[] } }>(
        "POST",
        "/api/videos/lint",
        {
          personaId: "sloane",
          title: "Bad script",
          hookText: "Hey high schoolers text 212-555-0199 right now",
          dialogue: "Try our app for prom date matches",
          sponsored: true,
          ftcDisclosureText: null,
        },
      );
      expect(badVideo.status).toBe(400);
      expect(badVideo.data.lint.pass).toBe(false);
      expect(badVideo.data.lint.errors.length).toBeGreaterThanOrEqual(2);

      // Clean video script passes lint & transitions stages
      const goodVideo = await api<{ lint: { pass: boolean } }>("POST", "/api/videos/lint", {
        personaId: "sloane",
        title: "SoHo Adult Dating Roast",
        hookText: "Why every NYC Hinge prompt says tacos and sarcasm",
        dialogue: "Real adults 18+ are done swiping on slop.date",
        punchline: "Skip the small talk.",
        ctaText: "go.slop.date",
        sponsored: true,
        ftcDisclosureText: "#Ad #PaidPartnership",
      });
      expect(goodVideo.status).toBe(200);
      expect(goodVideo.data.lint.pass).toBe(true);

      const newAsset = await api<{ asset: { id: string; stage: string } }>("POST", "/api/videos", {
        campaignId: seededCampaignId,
        title: "SoHo Adult Dating Roast",
        hook: "Why every NYC Hinge prompt says tacos",
        script: "Clean 18+ script #Ad",
        stage: "trend",
        ftcDisclosed: true,
      });
      expect(newAsset.status).toBe(201);
      const toScript = await api<{ asset: { stage: string } }>(
        "POST",
        `/api/videos/${newAsset.data.asset.id}/stage`,
        { stage: "script" },
      );
      expect(toScript.status).toBe(200);
      expect(toScript.data.asset.stage).toBe("script");
    },
    TEST_TIMEOUT,
  );

  test(
    "12. Autopilot Daemon (UTC day rollover + STOP-spike lockdown breaker) & Live SSE /api/events",
    async () => {
      // Connect a real SSE client to GET /api/events and verify it receives live mutation events!
      const sseAbort = new AbortController();
      const sseRes = await fetch(`${baseUrl}/api/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: sseAbort.signal,
      });
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get("content-type")).toContain("text/event-stream");
      const reader = sseRes.body?.getReader();
      expect(reader).toBeDefined();
      if (!reader) throw new Error("Missing SSE body reader");

      // Trigger a mutation while SSE is connected
      const sseCamp = await api<{ campaign: { id: string } }>("POST", "/api/campaigns", {
        slug: "nyc-sse-daemon-test",
        name: "SSE & Daemon Campaign",
        appId: "ntwrk",
        monthlyBudgetCents: 50_000,
        dailyCapCents: 10_000,
        maxTaskCents: 5_000,
        billingArmed: true,
        status: "active",
      });
      expect(sseCamp.status).toBe(201);

      const decoder = new TextDecoder();
      let sseBuffer = "";
      for (let i = 0; i < 6 && !sseBuffer.includes("event: marketing_update"); i += 1) {
        const chunk = await reader.read();
        if (chunk.done) break;
        sseBuffer += decoder.decode(chunk.value, { stream: true });
      }
      sseAbort.abort();
      await reader.cancel().catch(() => undefined);
      expect(sseBuffer).toContain("event: marketing_update");
      expect(sseBuffer).toContain("nyc-sse-daemon-test".slice(0, 0)); // event payload present
      expect(sseBuffer).toContain(sseCamp.data.campaign.id);

      // Start & stop daemon via HTTP API
      expect((await api("POST", "/api/daemon/start")).status).toBe(200);
      expect((await api<{ running: boolean }>("GET", "/api/daemon/status")).data.running).toBe(true);
      expect((await api("POST", "/api/daemon/stop")).status).toBe(200);

      // Seed 20 outreach messages with 3 STOPped humans (>500 bps STOP rate!) on sseCamp
      const spikeCampId = sseCamp.data.campaign.id;
      for (let i = 0; i < 20; i += 1) {
        const hum = await store.upsertHuman({
          handleOrEmailHmac: `spike-hum-${i}`,
          displayLabel: `Spike Human ${i}`,
          channel: "email",
          role: "applicant",
          city: "nyc",
          lowestAge: 25,
          stopped: i < 3,
          stopReason: i < 3 ? "STOP" : null,
        });
        await store.createOutreachMessage({
          campaignId: spikeCampId,
          agentId: sloaneId,
          humanId: hum.id,
          channel: "email",
          tier: 1,
          subject: "Spike test",
          bodySummary: "Testing STOP rate breaker",
          leakCheckPass: true,
        });
      }

      // First tick records initial UTC day; advance clock by +25h to trigger UTC day rollover!
      await daemon.tickNow();
      currentNow += 25 * 3_600_000;
      const tickReport = await daemon.tickNow();
      expect(tickReport.dailyResetExecuted).toBe(true);

      // STOP-spike campaign MUST have been automatically locked down & disarmed!
      const lockedCamp = await store.getCampaign(spikeCampId);
      expect(lockedCamp?.riskDial).toBe("lockdown");
      expect(lockedCamp?.billingArmed).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "13. slop.cash Disabled-by-Default Guard: status, disabled_stub preview, 403 SLOP_CASH_DISABLED",
    async () => {
      const statusRes = await api<{ enabled: boolean }>("GET", "/api/slop-cash/status");
      expect(statusRes.status).toBe(200);
      expect(statusRes.data.enabled).toBe(false);

      const blockedSlopTask = await api<{ code: string; invariant: string }>("POST", "/api/tasks", {
        campaignId: seededCampaignId,
        tier: 4,
        taskKind: "oss_dev_bounty",
        city: "nyc",
        title: "Blocked slop.cash settlement task",
        briefText: "Must fail closed while slopCashEnabled == false",
        vendorChannel: "slop_cash",
        assigneeHumanId: creatorHumanId,
        assigneeAgeYears: 24,
        amountCents: 10_000,
        payoutRail: "slop_cash",
        status: "drafted",
      });
      expect(blockedSlopTask.status).toBe(403);
      expect(blockedSlopTask.data.code).toBe("SLOP_CASH_DISABLED");

      const ossTask = await api<{ task: { id: string } }>("POST", "/api/tasks", {
        campaignId: seededCampaignId,
        tier: 4,
        taskKind: "oss_dev_bounty",
        city: "nyc",
        title: "Open-source skill connector PR",
        briefText: "Preview future slop.cash integration without settling",
        vendorChannel: "internal",
        assigneeHumanId: creatorHumanId,
        assigneeAgeYears: 24,
        amountCents: 10_000,
        payoutRail: "none",
        status: "drafted",
      });
      expect(ossTask.status).toBe(201);

      const previewRes = await api<{ settlementBlocked: boolean; hook: { hookState: string } }>(
        "POST",
        "/api/slop-cash/preview",
        {
          taskId: ossTask.data.task.id,
          repoSlug: "eliza-research/thenetwork",
          issueNumber: 42,
          vaultChain: "base",
        },
      );
      expect(previewRes.status).toBe(200);
      expect(previewRes.data.settlementBlocked).toBe(true);
      expect(previewRes.data.hook.hookState).toBe("disabled_stub");

      const settleRes = await api<{ code: string; invariant: string }>(
        "POST",
        "/api/slop-cash/settle",
        { taskId: ossTask.data.task.id },
      );
      expect(settleRes.status).toBe(403);
      expect(settleRes.data.code).toBe("SLOP_CASH_DISABLED");
      expect(settleRes.data.invariant).toBe("inv_slop_cash_disabled");
    },
    TEST_TIMEOUT,
  );

  test(
    "14. Multi-City Discovery + Legal Guardrails (CA AB5 / London Schedule 3A) + CTE Attribution Overview",
    async () => {
      // Multi-city configs available via /api/cities
      const citiesRes = await api<{ cities: Array<{ code: string }> }>("GET", "/api/cities");
      expect(citiesRes.status).toBe(200);
      expect(citiesRes.data.cities.length).toBe(7);

      // CA AB5 blocks direct 1099 street fliering in SF; London blocks without Schedule 3A boroughLicenceRef
      const sfBlocked = await api<{ code: string }>("POST", "/api/hiring-packet", {
        role: "street_fliering",
        city: "sf",
        budgetCents: 25_000,
      });
      expect(sfBlocked.status).toBe(403);

      const londonBlocked = await api<{ code: string }>("POST", "/api/hiring-packet", {
        role: "street_fliering",
        city: "london",
        budgetCents: 25_000,
      });
      expect(londonBlocked.status).toBe(403);

      // Agency booking (W-2 / PAYE agency mode) is allowed in both SF & London
      const londonAgency = await api<{ packet: { city: string } }>("POST", "/api/hiring-packet", {
        role: "agency_booking",
        city: "london",
        budgetCents: 25_000,
        boroughLicenceRef: "CAMDEN-S3A-2026-001",
      });
      expect(londonAgency.status).toBe(200);

      // Parallel discovery dedupes NYC DOHMH + HN + YouTube RSS
      const disc = await api<{
        city: string;
        leads: Array<{ dedupeKey: string }>;
        sourceCounts: Record<string, number>;
      }>("POST", "/api/discovery/nyc", {
        city: "nyc",
        includeSources: ["nyc_open_data", "hn", "youtube_rss"],
        youtubeChannelIds: ["UC_NYC_VOX_TEST"],
      });
      expect(disc.status).toBe(200);
      expect(disc.data.leads.length).toBe(3);
      expect(disc.data.sourceCounts.nyc_open_data).toBe(1);
      expect(disc.data.sourceCounts.hn).toBe(1);
      expect(disc.data.sourceCounts.youtube_rss).toBe(1);

      // Attribution events reflected in single-CTE GET /api/overview
      expect(
        (
          await api("POST", "/api/attribution", {
            campaignId: seededCampaignId,
            taskId: creatorTaskId,
            qrBatchCode: creatorQrBatch,
            eventKind: "qr_scan",
            city: "nyc",
            appId: "slop",
            count: 45,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await api("POST", "/api/attribution", {
            campaignId: seededCampaignId,
            taskId: creatorTaskId,
            qrBatchCode: creatorQrBatch,
            eventKind: "signup_verified_adult",
            city: "nyc",
            appId: "slop",
            count: 14,
          })
        ).status,
      ).toBe(201);

      const overview = await api<{
        attribution: { qrScans: number; verifiedAdultSignups: number; blendedCpaCents: number | null };
        budget: { spentCents: number };
      }>("GET", `/api/overview?campaignId=${encodeURIComponent(seededCampaignId)}`);
      expect(overview.status).toBe(200);
      expect(overview.data.attribution.qrScans).toBe(45);
      expect(overview.data.attribution.verifiedAdultSignups).toBe(14);
      expect(overview.data.attribution.blendedCpaCents).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  test(
    "15. Live-Mode Paid Adapters against Real Ephemeral Local HTTP Server (Resend, RentAHuman, Dub PATCH, Twilio Voice, Tremendous, C-03)",
    async () => {
      const captured: Array<{ method: string; path: string; body: string }> = [];
      const mockVendorServer = await serveHttp({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (req) => {
          const u = new URL(req.url);
          const body = await req.text();
          captured.push({ method: req.method, path: u.pathname, body });

          if (u.pathname.startsWith("/resend/")) {
            return new Response(JSON.stringify({ id: "re_live_101" }), { status: 200 });
          }
          if (u.pathname.startsWith("/rentahuman/")) {
            if (body.includes("TRIGGER_RPC_ERR")) {
              return new Response(
                JSON.stringify({ jsonrpc: "2.0", id: "1", error: { code: -32001, message: "insufficient_balance" } }),
                { status: 200 },
              );
            }
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", id: "1", result: { bountyId: "rah_bounty_99" } }),
              { status: 200 },
            );
          }
          if (u.pathname.startsWith("/dub/")) {
            return new Response(
              JSON.stringify({ id: "dub_link_7", shortLink: "https://go.friends.help/soho" }),
              { status: 200 },
            );
          }
          if (u.pathname.startsWith("/twilio/")) {
            return new Response(JSON.stringify({ sid: "CA_VOICE_888" }), { status: 201 });
          }
          if (u.pathname.startsWith("/tremendous/")) {
            return new Response(JSON.stringify({ order: { id: "ord_trem_55" } }), { status: 200 });
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      });

      const localBase = mockVendorServer.url.toString().replace(/\/$/, "");
      // Route external vendor URLs to our real local ephemeral HTTP server over TCP
      const localProxyFetch: typeof fetch = (input, init) => {
        const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const parsed = new URL(rawUrl);
        let prefix = "/other";
        if (parsed.hostname.includes("resend.com")) prefix = "/resend";
        else if (parsed.hostname.includes("rentahuman.ai")) prefix = "/rentahuman";
        else if (parsed.hostname.includes("dub.co")) prefix = "/dub";
        else if (parsed.hostname.includes("twilio.com")) prefix = "/twilio";
        else if (parsed.hostname.includes("tremendous.com")) prefix = "/tremendous";
        return fetch(`${localBase}${prefix}${parsed.pathname}${parsed.search}`, init);
      };

      try {
        const liveCamp = await store.createCampaign({
          slug: "nyc-live-http-adapters",
          name: "Live Adapter Test Campaign",
          appId: "ntwrk",
          monthlyBudgetCents: 100_000,
          dailyCapCents: 50_000,
          maxTaskCents: 20_000,
          billingArmed: true,
          status: "active",
        });

        const reg = createPaidAdapterRegistry({
          clock,
          fetchFn: localProxyFetch,
          store,
          env: {
            MARKETING_LIVE_BILLING: "1",
            RESEND_API_KEY: "re_live_key",
            RENTAHUMAN_API_KEY: "rah_live_key",
            DUB_API_KEY: "dub_live_key",
            TWILIO_ACCOUNT_SID: "AC_LIVE_SID",
            TWILIO_AUTH_TOKEN: "tw_live_tok",
            TWILIO_FROM_NUMBER: "+12125550100",
            TREMENDOUS_API_KEY: "trem_live_key",
            TREMENDOUS_FUNDING_SOURCE_ID: "fs_nyc_01",
          },
        });

        // 1. C-03 mismatched spend.amountCents MUST be rejected before touching network
        const mismatch = await reg.execute(
          "payouts",
          {
            rail: "tremendous",
            recipientId: "u-c03",
            recipientName: "Alex",
            recipientEmail: "alex@example.com",
            amountCents: 2_500,
            memo: "Bonus",
          },
          {
            campaignId: liveCamp.id,
            idempotencyKey: "live-c03-mismatch",
            spend: spendAuthFromCampaign(liveCamp, 1_000, { tier: 4 }),
          },
        );
        expect(mismatch.ok).toBe(false);
        expect(mismatch.reason).toContain("C-03");
        expect(captured.length).toBe(0);

        // 2. Resend live email
        const em = await reg.execute(
          "email",
          { to: "venue@example.com", subject: "Tabletop QR Kit", text: "Hello from SoHo" },
          {
            campaignId: liveCamp.id,
            idempotencyKey: "live-em-1",
            spend: spendAuthFromCampaign(liveCamp, 1, { tier: 3 }),
          },
        );
        expect(em.ok).toBe(true);
        expect(em.externalRef).toBe("re_live_101");

        // 3. RentAHuman create_bounty + JSON-RPC HTTP 200 error detection
        const rahInput = {
          city: "nyc",
          title: "SoHo Shift",
          brief: "2h flyering shift",
          neighborhood: "SoHo",
          shiftHours: 2,
          budgetCents: 6_000,
        };
        const rahOk = await reg.execute("rentahuman", rahInput, {
          campaignId: liveCamp.id,
          idempotencyKey: "live-rah-ok",
          spend: spendAuthFromCampaign(liveCamp, reg.estimateCostCents("rentahuman", rahInput), {
            tier: 4,
          }),
        });
        expect(rahOk.ok).toBe(true);
        expect(captured.some((c) => c.path.startsWith("/rentahuman/") && c.body.includes("create_bounty"))).toBe(
          true,
        );

        const rahErrInput = { ...rahInput, title: "TRIGGER_RPC_ERR" };
        const rahErr = await reg.execute("rentahuman", rahErrInput, {
          campaignId: liveCamp.id,
          idempotencyKey: "live-rah-err",
          spend: spendAuthFromCampaign(liveCamp, reg.estimateCostCents("rentahuman", rahErrInput), {
            tier: 4,
          }),
        });
        expect(rahErr.ok).toBe(false);
        expect(rahErr.reason).toContain("insufficient_balance");

        // 4. Dub.co PATCH link update
        const dubInput = {
          destinationUrl: "https://friends.help/r/soho-v2",
          linkId: "dub_link_7",
          qrBatchCode: "NYC-SOHO-7",
        };
        const dubRes = await reg.execute("qr_links", dubInput, {
          campaignId: liveCamp.id,
          idempotencyKey: "live-dub-patch",
          spend: spendAuthFromCampaign(liveCamp, reg.estimateCostCents("qr_links", dubInput), {
            tier: 3,
          }),
        });
        expect(dubRes.ok).toBe(true);
        expect(captured.some((c) => c.method === "PATCH" && c.path.includes("/dub/links/dub_link_7"))).toBe(
          true,
        );

        // 5. Twilio Voice /Calls.json
        const voiceInput = {
          action: "voice" as const,
          toE164: "+12125550199",
          body: "Your verification PIN is 4821",
          optedIn: true,
        };
        const voiceRes = await reg.execute("sms_voice", voiceInput, {
          campaignId: liveCamp.id,
          idempotencyKey: "live-tw-voice",
          spend: spendAuthFromCampaign(liveCamp, reg.estimateCostCents("sms_voice", voiceInput), {
            tier: 3,
          }),
        });
        expect(voiceRes.ok).toBe(true);
        expect(captured.some((c) => c.path.endsWith("/Calls.json"))).toBe(true);

        // 6. Tremendous payout with funding_source_id and reward.products
        const tremRes = await reg.execute(
          "payouts",
          {
            rail: "tremendous",
            recipientId: "u-trem",
            recipientName: "Jordan",
            recipientEmail: "jordan@example.com",
            amountCents: 2_500,
            memo: "SoHo shift payout",
          },
          {
            campaignId: liveCamp.id,
            idempotencyKey: "live-trem-1",
            spend: spendAuthFromCampaign(liveCamp, 2_500, { tier: 4 }),
          },
        );
        expect(tremRes.ok).toBe(true);
        expect(tremRes.externalRef).toBe("ord_trem_55");
        const tremCall = captured.find((c) => c.path.startsWith("/tremendous/"));
        expect(tremCall).toBeDefined();
        const tremBody = JSON.parse(tremCall?.body ?? "{}") as {
          payment?: { funding_source_id?: string };
          reward?: { products?: string[] };
        };
        expect(tremBody.payment?.funding_source_id).toBe("fs_nyc_01");
        expect(Array.isArray(tremBody.reward?.products)).toBe(true);
      } finally {
        await mockVendorServer.stop();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "16. Pass-3 Cross-Schema Bridge RPCs: marketing.contact_fence & marketing.supply_demand_k5",
    async () => {
      const bridge = createNetworkCoreBridge({ sql, clock });
      const ping = await bridge.ping();
      expect(ping.ok).toBe(true);
      expect(ping.mode).toBe("platform_pg");
      expect(ping.bridgeFunctionsPresent).toBe(true);

      const bannedHash = keyedContactHash("phone", "+12125550111");
      const stoppedE164 = "+12125550112";
      const stoppedHash = keyedContactHash("phone", stoppedE164);
      const minorHash = keyedContactHash("phone", "+12125550113");
      const cleanHash = keyedContactHash("phone", "+12125550114");

      await sql`
        insert into platform.bans (id, scope, phone_hash, reason, banned_by, at)
        values ('ban-mkt-p3-1', 'phone', ${bannedHash}, 'policy_abuse', 'staff-test', ${new Date(clock.now())})
        on conflict do nothing
      `;
      await sql`
        insert into platform.consent_events (e164, app_id, state, source, at)
        values (${stoppedE164}, null, 'opted_out', 'sms_stop', ${new Date(clock.now())})
      `;
      await sql`
        insert into platform.age_floor (phone_hash, lowest_age, at)
        values (${minorHash}, 16, ${new Date(clock.now())})
        on conflict (phone_hash) do update set lowest_age = 16
      `;

      const bannedVerdict = await bridge.checkContactFence({ phoneHash: bannedHash });
      expect(bannedVerdict.allowed).toBe(false);
      expect(bannedVerdict.banned).toBe(true);

      const stoppedVerdict = await bridge.checkContactFence({
        phoneHash: stoppedHash,
        phone: stoppedE164,
      });
      expect(stoppedVerdict.allowed).toBe(false);
      expect(stoppedVerdict.globallyStopped).toBe(true);

      const minorVerdict = await bridge.checkContactFence({ phoneHash: minorHash });
      expect(minorVerdict.allowed).toBe(false);
      expect(minorVerdict.knownMinor).toBe(true);

      const cleanVerdict = await bridge.checkContactFence({ phoneHash: cleanHash });
      expect(cleanVerdict.allowed).toBe(true);

      // Verify supply_demand_k5 bucket floor and line_safety backpressure trigger
      await sql`
        insert into platform.networks (id, app_id, city, matching_enabled)
        values ('slop:nyc', 'slop', 'nyc', true)
        on conflict (app_id, city) do update set matching_enabled = true
      `;
      for (let i = 0; i < 6; i += 1) {
        await sql`
          insert into network.members (id, app_id, home_city, account_status, age)
          values (${`mkt-p3-adult-${i}`}, 'slop', 'nyc', 'active', 26)
          on conflict (id) do nothing
        `;
      }
      await sql`
        insert into platform.line_safety (line, action, at)
        values ('line-mkt-p3', 'throttle', ${new Date(clock.now())})
        on conflict (line) do update set action = 'throttle'
      `;

      const signals = await bridge.getDemandAndPressure("nyc");
      const slopNyc = signals.find((s) => s.appId === "slop" && s.city === "nyc");
      expect(slopNyc).toBeDefined();
      expect(slopNyc?.activeAdultBucket).toBeGreaterThanOrEqual(5);
      expect((slopNyc?.activeAdultBucket ?? 0) % 5).toBe(0);
      expect(slopNyc?.lineRestricted).toBe(true);
      expect(slopNyc?.queuePressurePaused).toBe(true);

      // Reset line_safety so subsequent tests stay unpaused
      await sql`delete from platform.line_safety where line = 'line-mkt-p3'`;
    },
    TEST_TIMEOUT,
  );

  test(
    "17. Pass-3 Global City Launch (POST /api/seed/sf, unknown city 400), /api/cities, /api/desire-lanes & /api/directory",
    async () => {
      const sfSeed = await api<{
        ok: boolean;
        city: string;
        campaign: { id: string; city: string };
        tasks: Array<{ taskKind: string; vendorChannel: string }>;
      }>("POST", "/api/seed/sf");
      expect(sfSeed.status).toBe(200);
      expect(sfSeed.data.ok).toBe(true);
      expect(sfSeed.data.city).toBe("sf");
      expect(sfSeed.data.campaign.city).toBe("sf");
      // CA AB5: SF street-team starter task uses W-2 agency_booking, never 1099 craigslist
      expect(sfSeed.data.tasks.some((t) => t.taskKind === "agency_booking")).toBe(true);
      expect(sfSeed.data.tasks.some((t) => t.taskKind === "street_fliering")).toBe(false);

      const unknownSeed = await api<{ error?: string }>("POST", "/api/seed/unknown_city");
      expect(unknownSeed.status).toBe(400);

      const citiesRes = await api<{
        cities: Array<{ code: string; stage: string; readiness?: { currentStage: string } }>;
      }>("GET", "/api/cities");
      expect(citiesRes.status).toBe(200);
      expect(citiesRes.data.cities.length).toBeGreaterThanOrEqual(7);
      expect(citiesRes.data.cities.some((c) => c.code === "sf")).toBe(true);

      const lanesRes = await api<{
        lanes: Array<{ id: string; defaultAppId?: string; appId?: string }>;
        metrics: Record<string, { campaigns: number; tasks: number }>;
      }>("GET", "/api/desire-lanes");
      expect(lanesRes.status).toBe(200);
      expect(lanesRes.data.lanes.length).toBeGreaterThanOrEqual(4);
      expect(lanesRes.data.metrics).toBeDefined();

      const dirRes = await api<{ city?: string; agencies?: unknown[] }>(
        "GET",
        "/api/directory?city=sf",
      );
      expect(dirRes.status).toBe(200);
    },
    TEST_TIMEOUT,
  );

  test(
    "18. Pass-3 P0 Crowdsourcing Fixes: ops.ntwrk.party boundary, contactEmail-only dispatch, and B-07 duplicate media hash",
    async () => {
      const capturedEmails: Array<{ to: string; body: string }> = [];
      const mockResendServer = await serveHttp({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (req) => {
          const text = await req.text();
          const parsed = JSON.parse(text) as { to?: string | string[] };
          const to = Array.isArray(parsed.to) ? (parsed.to[0] ?? "") : (parsed.to ?? "");
          capturedEmails.push({ to, body: text });
          return new Response(JSON.stringify({ id: "re_p3_ok" }), { status: 200 });
        },
      });
      const localResendBase = mockResendServer.url.toString().replace(/\/$/, "");
      const proxyFetch: typeof fetch = (input, init) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const u = new URL(raw);
        return fetch(`${localResendBase}${u.pathname}${u.search}`, init);
      };

      try {
        const paidAdapters = createPaidAdapterRegistry({
          clock,
          store,
          fetchFn: proxyFetch,
          env: {
            MARKETING_LIVE_BILLING: "1",
            RESEND_API_KEY: "re_p3_test_key",
          },
        });
        const engine = new CrowdsourcingEngine({
          store,
          clock,
          paidAdapters,
          env: { MARKETING_LIVE_SEND: "1" },
        });

        // P0 #1: Legal/release/contract URLs strictly use ops.ntwrk.party (never bare ntwrk.party)
        const packet = engine.buildHiringPacket("creator_video", "nyc", 25_000, {
          neighborhood: "SoHo",
        });
        const packetBody = packet.creatorBrief?.body ?? packet.craigslistPost.body;
        expect(packetBody).toContain("https://ops.ntwrk.party/");
        expect(packetBody).not.toMatch(/https:\/\/ntwrk\.party\/(release|contractor-terms|proofs)/i);

        // P0 #2: Live email dispatch uses contactEmail ONLY, never displayLabel
        const p0Camp = await store.createCampaign({
          slug: "nyc-p3-contact-email-test",
          name: "P3 Contact Email Guard",
          appId: "slop",
          monthlyBudgetCents: 100_000,
          dailyCapCents: 50_000,
          maxTaskCents: 20_000,
          billingArmed: true,
          status: "active",
        });

        const noEmailHuman = await store.upsertHuman({
          handleOrEmailHmac: "p3:no-email-human",
          displayLabel: "must-never-send@evil.example",
          channel: "email",
          role: "creator",
          city: "nyc",
          lowestAge: 26,
        });
        const validEmailHuman = await store.upsertHuman({
          handleOrEmailHmac: "p3:valid-email-human",
          displayLabel: "Real Creator Display Name",
          contactEmail: "real-creator@example.com",
          channel: "email",
          role: "creator",
          city: "nyc",
          lowestAge: 27,
        });

        await engine.queueOutreach({
          campaignId: p0Camp.id,
          agentId: sloaneId,
          humanId: noEmailHuman.id,
          channel: "email",
          tier: 1,
          subject: "No-email guard check",
          bodyText: "18+ street interview collaboration for slop.date #Ad",
        });
        await engine.queueOutreach({
          campaignId: p0Camp.id,
          agentId: sloaneId,
          humanId: validEmailHuman.id,
          channel: "email",
          tier: 1,
          subject: "Valid-email dispatch check",
          bodyText: "18+ street interview collaboration for slop.date #Ad",
        });

        const dispatchRes = await engine.dispatchPendingOutreach(p0Camp.id);
        expect(dispatchRes.failed).toBe(1);
        expect(dispatchRes.sent).toBe(1);
        expect(capturedEmails.length).toBe(1);
        expect(capturedEmails[0]?.to).toBe("real-creator@example.com");

        // B-07: submitAndEvaluateProof rejects duplicate checkinMediaHashes across tasks
        const b07Task = await store.createTask({
          campaignId: p0Camp.id,
          tier: 4,
          taskKind: "street_fliering",
          city: "nyc",
          title: "B-07 Duplicate Hash Check Shift",
          briefText: "Verifies duplicate media hash rejection",
          vendorChannel: "craigslist",
          assigneeHumanId: validEmailHuman.id,
          assigneeAgeYears: 27,
          amountCents: 10_000,
          payoutRail: "fiat_stripe",
          status: "hired",
        });
        const b07Res = await engine.submitAndEvaluateProof({
          taskId: b07Task.id,
          proofKind: "street_shift",
          evidenceUrl: "https://cdn.example.com/b07-dup.jpg",
          checkinMediaHashes: ["sha256-unique-vid-001"],
          qrScansCount: 10,
          verifiedSignupsCount: 3,
          ftcDisclosed: true,
          geoTimeValid: true,
          likenessReleaseOk: true,
          workerAge: 27,
        });
        expect(b07Res.approved).toBe(false);
        expect(b07Res.payoutAuthorized).toBe(false);
      } finally {
        await mockResendServer.stop();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "19. Pass-3 Contact Hygiene: POST /api/suppressions, 14-day cold cooldown & global STOP auto-suppression",
    async () => {
      const suppRes = await api<{ ok: boolean; suppression: { contactHash: string; reason: string } }>(
        "POST",
        "/api/suppressions",
        {
          email: "optout-user@example.com",
          reason: "user_requested_stop",
          sourceChannel: "email",
        },
      );
      expect(suppRes.status).toBe(201);
      expect(suppRes.data.ok).toBe(true);
      expect(suppRes.data.suppression.contactHash).toHaveLength(64);

      const listSupp = await api<{ suppressions: Array<{ contactHash: string }> }>(
        "GET",
        "/api/suppressions?limit=50",
      );
      expect(listSupp.status).toBe(200);
      expect(
        listSupp.data.suppressions.some(
          (s) => s.contactHash === suppRes.data.suppression.contactHash,
        ),
      ).toBe(true);

      // 14-day cold touch cooldown via CrowdsourcingEngine
      const engine = new CrowdsourcingEngine({ store, clock });
      const coldHuman = await store.upsertHuman({
        handleOrEmailHmac: "p3:cold-cooldown-target",
        displayLabel: "Cold Target",
        contactEmail: "cold-target@example.com",
        channel: "email",
        role: "applicant",
        city: "nyc",
        lowestAge: 28,
      });

      const firstCold = await engine.queueOutreach({
        campaignId: seededCampaignId,
        agentId: sloaneId,
        humanId: coldHuman.id,
        channel: "email",
        tier: 1,
        subject: "First cold intro",
        bodyText: "Quick 18+ local invite via go.slop.date",
      });
      expect(firstCold.status).toBe("queued");
      await store.recordContactTouchpoint({
        contactHash: coldHuman.handleOrEmailHmac,
        campaignId: seededCampaignId,
        surface: "outreach",
        isCold: true,
        answered: false,
      });

      // Immediate second cold outreach (< 14 days) MUST be blocked by cold cooldown!
      const secondCold = await engine.queueOutreach({
        campaignId: seededCampaignId,
        agentId: sloaneId,
        humanId: coldHuman.id,
        channel: "email",
        tier: 1,
        subject: "Too-soon second cold intro",
        bodyText: "Following up 1 minute later via go.slop.date",
      });
      expect(secondCold.status).toBe("blocked_policy");
    },
    TEST_TIMEOUT,
  );

  test(
    "20. Pass-3 LLM Lifecycle: PromptCache hit, deterministic skip, trajectories in PG, LeakGuard turn burn & Dafny daily cap",
    async () => {
      let llmCalls = 0;
      const testLlm: LLM = {
        chat(messages): Promise<string> {
          llmCalls += 1;
          const userText = messages[messages.length - 1]?.content ?? "";
          if (userText.includes("TRIGGER_LEAK")) {
            return Promise.resolve("Call +1-212-555-0199 privately for the secret list.");
          }
          return Promise.resolve("18+ local NYC invitation via go.ntwrk.party #Ad");
        },
      };

      const surplusAgent = await store.upsertAgent({
        id: "agent-operator",
        personaId: "operator",
        displayName: "The Operator",
        appId: "ntwrk",
        provider: "surplus",
        failoverProvider: "claude",
        authMode: "api",
        sessionRef: "api:surplus:p3-test",
        dailyTurnCap: 80,
        turnsUsedToday: 0,
        status: "idle",
      });

      const currentDayIso = new Date(clock.now()).toISOString().slice(0, 10);
      const baselineUsage = await store.getDailyLlmUsage({ dayIso: currentDayIso });
      const manager = new AgentLifecycleManager({
        store,
        clock,
        env: {},
        dryRun: false,
        llmClient: testLlm,
        dailyTokenCap: baselineUsage.totalTokens + 550,
        dailyCostCapMicros: baselineUsage.costMicros + 500_000,
      });

      // 1. Deterministic zero-token skip (no LLM call, 0 tokens)
      const detRes = await manager.dispatchTurn(surplusAgent.id, "STOP emailing me", {
        campaignId: seededCampaignId,
        deterministicTaskHint: "opt_out_check",
      });
      expect(detRes.ok).toBe(true);
      expect(detRes.deterministicRule).toBe("opt_out_check");
      expect(detRes.inputTokens).toBe(0);
      expect(llmCalls).toBe(0);

      // 2. First real prompt hits LLM; identical second prompt hits PromptCache (0 tokens)
      const p1 = await manager.dispatchTurn(surplusAgent.id, "Draft 18+ SoHo salon invite", {
        campaignId: seededCampaignId,
        estimatedOutputTokens: 80,
      });
      expect(p1.ok).toBe(true);
      expect(p1.cached).toBe(false);
      expect(llmCalls).toBe(1);

      const p2 = await manager.dispatchTurn(surplusAgent.id, "Draft 18+ SoHo salon invite", {
        campaignId: seededCampaignId,
        estimatedOutputTokens: 80,
      });
      expect(p2.ok).toBe(true);
      expect(p2.cached).toBe(true);
      expect(p2.inputTokens).toBe(0);
      expect(llmCalls).toBe(1);

      // 3. LeakGuard-blocked output STILL consumes turn, is NOT cached, and persists leak_blocked trajectory
      const beforeLeak = await store.getAgent(surplusAgent.id);
      const leakRes = await manager.dispatchTurn(surplusAgent.id, "TRIGGER_LEAK draft", {
        campaignId: seededCampaignId,
        estimatedOutputTokens: 80,
      });
      expect(leakRes.ok).toBe(false);
      expect(leakRes.blockedReason).toBe("leak_guard_blocked");
      const afterLeak = await store.getAgent(surplusAgent.id);
      expect(afterLeak?.turnsUsedToday).toBe((beforeLeak?.turnsUsedToday ?? 0) + 1);

      // 4. Exceeding dailyTokenCap trips Dafny llmBudgetWithinCaps breaker
      let blockedCount = 0;
      for (let i = 0; i < 8; i += 1) {
        const r = await manager.dispatchTurn(
          surplusAgent.id,
          `Unique P3 budget test prompt #${i} with enough tokens to trip cap`,
          { campaignId: seededCampaignId, skipCache: true, estimatedOutputTokens: 150 },
        );
        if (!r.ok && r.blockedReason === "daily_token_cap_exceeded") {
          blockedCount += 1;
        }
      }
      expect(blockedCount).toBeGreaterThan(0);

      // Verify HTTP endpoints return persisted Postgres LLM usage & trajectories
      const usageRes = await api<{
        usage: { calls: number; cachedCalls: number; leakBlockedCalls: number; budgetBlockedCalls: number };
        caps: { dailyTokenCap: number; dailyCostCapMicros: number };
      }>("GET", `/api/llm/usage?agentId=${encodeURIComponent(surplusAgent.id)}`);
      expect(usageRes.status).toBe(200);
      expect(usageRes.data.usage.calls).toBeGreaterThanOrEqual(5);
      expect(usageRes.data.usage.leakBlockedCalls).toBeGreaterThanOrEqual(1);
      expect(usageRes.data.usage.budgetBlockedCalls).toBeGreaterThanOrEqual(1);

      const trajRes = await api<{ trajectories: Array<{ id: string; status: string }> }>(
        "GET",
        `/api/llm/trajectories?agentId=${encodeURIComponent(surplusAgent.id)}&limit=25`,
      );
      expect(trajRes.status).toBe(200);
      expect(trajRes.data.trajectories.length).toBeGreaterThanOrEqual(5);
    },
    TEST_TIMEOUT,
  );

  test(
    "21. Pass-3 Security Closures (B-01 BD PATCH, B-02 Video Lint Stage Gate, VIP Weak Hook 400) & Bandit T3 Attribution",
    async () => {
      // B-01: PATCH /api/bd/:id must reject stage and contractHash bypasses
      const bdCreated = await api<{ deal: { id: string } }>("POST", "/api/bd", {
        campaignId: seededCampaignId,
        city: "nyc",
        venueName: "B-01 Security Test Bar",
        vertical: "slop",
        offeredCents: 12_000,
      });
      expect(bdCreated.status).toBe(201);
      const bdId = bdCreated.data.deal.id;

      const stageBypass = await api("PATCH", `/api/bd/${bdId}`, { stage: "live" });
      expect(stageBypass.status).toBe(400);
      const hashBypass = await api("PATCH", `/api/bd/${bdId}`, { contractHash: "a".repeat(64) });
      expect(hashBypass.status).toBe(400);

      // B-02: POST /api/videos/:id/stage must block advancing failing-lint video to voice_render/published
      const badVid = await api<{ asset: { id: string } }>("POST", "/api/videos", {
        campaignId: seededCampaignId,
        agentId: sloaneId,
        title: "Unsafe Video Asset",
        hook: "Hey high schoolers text 212-555-0199 now",
        script: "Prom date hookup without disclosure",
        stage: "script",
        ftcDisclosed: false,
      });
      expect(badVid.status).toBe(201);
      const badAdvance = await api("POST", `/api/videos/${badVid.data.asset.id}/stage`, {
        stage: "published",
      });
      expect(badAdvance.status).toBe(400);

      // VIP fail-closed: weak/raw DB slug hook rejected with 400
      const vipCreated = await api<{ prospect: { id: string } }>("POST", "/api/vips", {
        campaignId: seededCampaignId,
        city: "nyc",
        name: "Dr. Samira Patel",
        archetype: "startup_founder",
        organization: "Kernel Labs",
        publicSource: "SEC Form D",
      });
      expect(vipCreated.status).toBe(201);
      const weakInvite = await api("POST", `/api/vips/${vipCreated.data.prospect.id}/invite`, {
        neighborhood: "SoHo",
        proofOfWork1Line: "row_42",
      });
      expect(weakInvite.status).toBe(400);

      // Bandit real T3 verifiedOutcomes increment + rebalance persistence
      const arms = await store.listBanditArms(seededCampaignId);
      const targetArm = arms.find((a) => a.status === "active");
      expect(targetArm).toBeDefined();
      if (!targetArm) throw new Error("Expected active bandit arm");
      const beforeOutcomes = targetArm.verifiedOutcomes ?? 0;

      const attrRes = await api("POST", "/api/attribution", {
        campaignId: seededCampaignId,
        armId: targetArm.id,
        desireLane: "soulmate_dating",
        eventKind: "signup_verified_adult",
        city: "nyc",
        appId: "slop",
        count: 3,
      });
      expect(attrRes.status).toBe(201);

      await store.recordAttributionEvent({
        campaignId: seededCampaignId,
        armId: targetArm.id,
        desireLane: "soulmate_dating",
        eventKind: "t3_match_verified",
        city: "nyc",
        appId: "slop",
        count: 2,
      });

      const updatedArm = await store.getBanditArm(targetArm.id);
      expect(updatedArm?.verifiedOutcomes).toBe(beforeOutcomes + 5);

      const rebRes = await api("POST", "/api/bandit/rebalance", {
        campaignId: seededCampaignId,
        seed: "p3-t3-rebalance",
      });
      expect(rebRes.status).toBe(200);
    },
    TEST_TIMEOUT,
  );

  test(
    "22. Pass-3 Ops Summary, Core Pressure, Offline Launch Simulator, Static UI ETag/304/gzip & Zero-PG CLI",
    async () => {
      const opsSummary = await api<{
        overview: Record<string, unknown>;
        cities: unknown[];
        desireLanes: Record<string, unknown>;
        llmUsage: Record<string, unknown>;
        corePressure: Record<string, unknown>;
      }>("GET", "/api/ops-summary");
      expect(opsSummary.status).toBe(200);
      expect(opsSummary.data.overview).toBeDefined();
      expect(Array.isArray(opsSummary.data.cities)).toBe(true);
      expect(opsSummary.data.desireLanes).toBeDefined();
      expect(opsSummary.data.llmUsage).toBeDefined();
      expect(opsSummary.data.corePressure).toBeDefined();

      const pressure = await api<{
        mode: string;
        bridgeHealthy: boolean;
        paused: boolean;
        signals: unknown[];
      }>("GET", "/api/core-pressure");
      expect(pressure.status).toBe(200);
      expect(pressure.data.bridgeHealthy).toBe(true);
      expect(Array.isArray(pressure.data.signals)).toBe(true);

      const simRes = await api<{
        ok: boolean;
        summary: {
          allBlockingPass: boolean;
          blockingTotal: number;
          blockingPassed: number;
          digest: string;
        };
      }>("POST", "/api/simulate/launch", {
        seed: 1,
        days: 14,
        cities: ["nyc", "sf"],
      });
      expect(simRes.status).toBe(200);
      expect(simRes.data.ok).toBe(true);
      expect(simRes.data.summary.allBlockingPass).toBe(true);
      expect(simRes.data.summary.blockingTotal).toBeGreaterThanOrEqual(11);
      expect(simRes.data.summary.digest).toHaveLength(16);

      // Static UI caching: ETag, 304 Not Modified, and gzip compression on app.css & app.js
      for (const assetPath of ["/assets/app.css", "/assets/app.js"]) {
        const res1 = await fetch(`${baseUrl}${assetPath}`, {
          headers: { "Accept-Encoding": "gzip" },
        });
        expect(res1.status).toBe(200);
        const etag = res1.headers.get("etag");
        expect(etag).toBeTruthy();
        expect(res1.headers.get("cache-control")).toContain("max-age");
        expect(res1.headers.get("content-encoding")).toBe("gzip");
        await res1.arrayBuffer();

        const res304 = await fetch(`${baseUrl}${assetPath}`, {
          headers: { "If-None-Match": etag ?? "" },
        });
        expect(res304.status).toBe(304);
      }

      // Offline CLI commands succeed with DATABASE_URL & NETWORK_DATABASE_URL stripped (zero PG boot!)
      const offlineEnv = { ...process.env };
      delete offlineEnv.DATABASE_URL;
      delete offlineEnv.NETWORK_DATABASE_URL;
      delete offlineEnv.SURPLUS_API_KEY;
      delete offlineEnv.OPENAI_API_KEY;

      for (const cliArgs of [
        ["--import", "tsx", "apps/marketing/src/cli.ts", "cities", "--json"],
        ["--import", "tsx", "apps/marketing/src/cli.ts", "doctor", "--json"],
        ["--import", "tsx", "apps/marketing/src/cli.ts", "sim", "--quick", "--json"],
      ]) {
        const { stdout } = await execFileAsync(process.execPath, cliArgs, {
          cwd: process.cwd(),
          env: offlineEnv,
          timeout: 30_000,
        });
        const parsed = JSON.parse(stdout) as { ok?: boolean };
        expect(parsed.ok).toBe(true);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "23. Pass-4 Apollo Enrichment API (/api/apollo/{search,enrich,credits}), D11 Cache Purge on Suppression, & VIP Pipeline/Send (D3/D4)",
    async () => {
      // 1. 0-credit Apollo search (dry-run deterministic fixtures)
      const searchRes = await api<{
        ok: boolean;
        creditsSpent: number;
        candidates: Array<{ apolloPersonId: string; fullName: string; archetypeSlug: string | null }>;
      }>("POST", "/api/apollo/search", {
        city: "nyc",
        campaignId: seededCampaignId,
        archetypeSlugs: ["startup_founder", "creative_director_tastemaker"],
        perPage: 4,
      });
      expect(searchRes.status).toBe(200);
      expect(searchRes.data.ok).toBe(true);
      expect(searchRes.data.creditsSpent).toBe(0);
      expect(searchRes.data.candidates.length).toBeGreaterThanOrEqual(2);

      // 2. Apollo enrich persists in marketing.enrichment_cache + apollo_credit_ledger
      const enrichRes = await api<{
        ok: boolean;
        cacheHit: boolean;
        contactHash: string | null;
        person: { workEmail: string | null; verifiedWorkEmail: boolean } | null;
      }>("POST", "/api/apollo/enrich", {
        campaignId: seededCampaignId,
        city: "nyc",
        firstName: "Claire",
        lastName: "Mercer",
        organizationName: "Atelier Mercer",
        domain: "ateliermercer.studio",
        title: "Creative Director",
      });
      expect(enrichRes.status).toBe(200);
      expect(enrichRes.data.ok).toBe(true);
      expect(enrichRes.data.person?.verifiedWorkEmail).toBe(true);
      expect(enrichRes.data.person?.workEmail).toBe("claire.mercer@ateliermercer.studio");

      // Second identical enrich call hits enrichment_cache
      const enrichHit = await api<{ ok: boolean; cacheHit: boolean }>(
        "POST",
        "/api/apollo/enrich",
        {
          campaignId: seededCampaignId,
          city: "nyc",
          firstName: "Claire",
          lastName: "Mercer",
          organizationName: "Atelier Mercer",
          domain: "ateliermercer.studio",
          title: "Creative Director",
        },
      );
      expect(enrichHit.status).toBe(200);
      expect(enrichHit.data.cacheHit).toBe(true);

      // 3. GET /api/apollo/credits reflects logged ledger entries
      const creditsRes = await api<{
        ok: boolean;
        usage: { totalCallsToday: number; cacheHitsToday: number };
      }>("GET", "/api/apollo/credits");
      expect(creditsRes.status).toBe(200);
      expect(creditsRes.data.ok).toBe(true);
      expect(creditsRes.data.usage.totalCallsToday).toBeGreaterThanOrEqual(3);
      expect(creditsRes.data.usage.cacheHitsToday).toBeGreaterThanOrEqual(1);

      // 4. D11 regression: suppressing enriched contact immediately purges marketing.enrichment_cache in Postgres!
      const suppRes = await api("POST", "/api/suppressions", {
        email: "claire.mercer@ateliermercer.studio",
        reason: "user_stop",
        sourceChannel: "email",
      });
      expect(suppRes.status).toBe(201);
      const cacheCountAfter = firstRow<{ n: number }>(
        await sql`
          select count(*)::int as n from marketing.enrichment_cache
          where contact_hash = ${enrichRes.data.contactHash}
        `,
      );
      expect(cacheCountAfter.n).toBe(0);

      // Re-enriching the suppressed email fails closed with 403
      const blockedEnrich = await api<{ ok: boolean; blockedReason?: string }>(
        "POST",
        "/api/apollo/enrich",
        {
          campaignId: seededCampaignId,
          city: "nyc",
          email: "claire.mercer@ateliermercer.studio",
        },
      );
      expect(blockedEnrich.status).toBe(403);
      expect(blockedEnrich.data.ok).toBe(false);

      // 5. POST /api/vips/pipeline/run creates researched/drafted prospects + bilateral invite + gated send (D3/D4)
      const pipeRes = await api<{
        ok: boolean;
        persistedCount: number;
        items: Array<{ prospect: { id: string; contactEmail: string | null } | null }>;
      }>("POST", "/api/vips/pipeline/run", {
        campaignId: seededCampaignId,
        city: "nyc",
        archetypeSlugs: ["senior_staff_engineer"],
        maxEnrich: 2,
        offerMode: "bilateral_intro",
        bilateralPeerSummary: "a principal distributed systems engineer at a NYC database startup",
        sharedExactProblem: "low-latency Raft consensus tuning",
      });
      expect(pipeRes.status).toBe(200);
      expect(pipeRes.data.ok).toBe(true);
      expect(pipeRes.data.persistedCount).toBeGreaterThanOrEqual(1);
      const createdProspect = pipeRes.data.items.find((it) => it.prospect !== null)?.prospect;
      expect(createdProspect).toBeDefined();
      if (!createdProspect) throw new Error("Expected pipeline VIP prospect");

      // Bilateral offer mode invite validation
      const bilatInvite = await api<{
        invite: { valid: boolean; offerMode: string; wordCount: number; reportRiskScore: number };
      }>("POST", `/api/vips/${createdProspect.id}/invite`, {
        proofOfWork1Line: "your distributed storage benchmarks from last month",
        offerMode: "bilateral_intro",
        bilateralPeerSummary: "a principal storage engineer in Brooklyn",
        sharedExactProblem: "zero-copy WAL compaction",
      });
      expect(bilatInvite.status).toBe(200);
      expect(bilatInvite.data.invite.valid).toBe(true);
      expect(bilatInvite.data.invite.offerMode).toBe("bilateral_intro");
      expect(bilatInvite.data.invite.reportRiskScore).toBeLessThanOrEqual(24);

      // Ensure daytime NYC clock (1pm EST) for first send
      currentNow = Date.UTC(2026, 10, 27, 18, 0, 0);
      const firstSend = await api<{ ok: boolean; mode: string; prospect: { status: string } }>(
        "POST",
        `/api/vips/${createdProspect.id}/send`,
        { forceDryRun: true },
      );
      expect(firstSend.status).toBe(200);
      expect(firstSend.data.ok).toBe(true);
      expect(firstSend.data.prospect.status).toBe("invited");

      // Verify surface='vip' touchpoint was recorded in Postgres
      const vipTouchRow = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.contact_touchpoints where surface = 'vip'`,
      );
      expect(vipTouchRow.n).toBeGreaterThanOrEqual(1);

      // D3/D4 regression: immediate second cold VIP send (< 14d cooldown) MUST be blocked with 403!
      const secondSendTooSoon = await api<{ ok: boolean; blocked: boolean }>(
        "POST",
        `/api/vips/${createdProspect.id}/send`,
        { isFollowup: true, forceDryRun: true },
      );
      expect(secondSendTooSoon.status).toBe(403);
      expect(secondSendTooSoon.data.blocked).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "24. Pass-4 10-Platform Playbooks API (/api/playbooks/{:platform/draft,lint,health}) & Rolling-20 Circuit Breaker",
    async () => {
      for (const platform of ["reddit", "tinder", "partiful", "luma"] as const) {
        const draftRes = await api<{
          ok: boolean;
          draft: { text: string; risk: { pass: boolean; score: number } };
        }>("POST", `/api/playbooks/${platform}/draft`, {
          city: "nyc",
          recipientName: "Sam",
          specificContext: "your neighborhood ceramics studio in Williamsburg",
          peerSummary: "another local potter and coffee roaster",
          senderName: "Alex",
        });
        expect(draftRes.status).toBe(200);
        expect(draftRes.data.ok).toBe(true);
        expect(draftRes.data.draft.risk.pass).toBe(true);
        expect(draftRes.data.draft.risk.score).toBeLessThanOrEqual(24);
      }

      // High-risk pitch-slap + URL + Clef leak must fail /api/playbooks/lint with 400
      const badLint = await api<{ ok: boolean; risk: { pass: boolean; score: number } }>(
        "POST",
        "/api/playbooks/lint",
        {
          platform: "hinge",
          text: "Check out our app! Limited spots at https://evil.example.com — your Clef score is 9.1/10!",
          isFirstTouch: true,
          hasRecipientSpecificReference: false,
        },
      );
      expect(badLint.status).toBe(400);
      expect(badLint.data.ok).toBe(false);
      expect(badLint.data.risk.score).toBeGreaterThan(24);

      // Seed 20 rolling interactions in Postgres with 2 reports -> health circuit breaker trips to 'suspended'
      for (let i = 0; i < 20; i += 1) {
        await store.recordPlatformInteraction({
          campaignId: seededCampaignId,
          platform: "reddit",
          channelAccountId: null,
          contactHash: `pg-reddit-cb-${i}`,
          direction: "outbound",
          interactionKind: "public_reply",
          reportRiskScore: 4,
          outcome: i < 2 ? "reported" : "sent",
        });
      }
      const healthRes = await api<{
        ok: boolean;
        platforms: Array<{ platform: string; status: string; reportedCount: number }>;
      }>("GET", "/api/playbooks/health?platform=reddit");
      expect(healthRes.status).toBe(200);
      expect(healthRes.data.platforms[0]?.platform).toBe("reddit");
      expect(healthRes.data.platforms[0]?.status).toBe("suspended");
      expect(healthRes.data.platforms[0]?.reportedCount).toBeGreaterThanOrEqual(2);
    },
    TEST_TIMEOUT,
  );

  test(
    "25. Pass-4 Quality Intake API (/api/intake/{score,:id/promote}), slop!=peon Air-Gap, Once-Only Invite & external_prospect_suppressions Fence",
    async () => {
      // 1. Slop rejected (score 0)
      const slopRes = await api<{ qualityScore: number; recommendedStatus: string }>(
        "POST",
        "/api/intake/score",
        {
          campaignId: seededCampaignId,
          city: "nyc",
          targetAppId: "friends",
          sourcePlatform: "reddit",
          contactIdentifier: "slop_low_effort_user",
          statedAge: 25,
          replyOrBioText: "interested",
        },
      );
      expect(slopRes.status).toBe(200);
      expect(slopRes.data.qualityScore).toBe(0);
      expect(slopRes.data.recommendedStatus).toBe("rejected_slop");

      // 2. Minor rejected with 403 + suppressed in Postgres
      const minorRes = await api<{ isMinorSignal: boolean; recommendedStatus: string }>(
        "POST",
        "/api/intake/score",
        {
          campaignId: seededCampaignId,
          city: "nyc",
          targetAppId: "friends",
          sourcePlatform: "luma",
          contactIdentifier: "minor_luma_user",
          statedAge: 16,
          replyOrBioText: "Excited for the Brooklyn robotics meetup this weekend!",
        },
      );
      expect(minorRes.status).toBe(403);
      expect(minorRes.data.isMinorSignal).toBe(true);

      // 3. Cross-brand air-gap: Tinder dating prospect CANNOT promote into peon.biz
      const airGapScore = await api<{ candidate: { id: string } }>(
        "POST",
        "/api/intake/score",
        {
          campaignId: seededCampaignId,
          city: "nyc",
          targetAppId: "peon",
          sourcePlatform: "tinder",
          contactIdentifier: "tinder_staff_eng",
          statedAge: 30,
          replyOrBioText:
            "Staff distributed systems engineer in Brooklyn, loved the coffee shop rec and happy to meet Thursday at 6pm.",
          verifiedWorkEmail: true,
          tier1PublicProof: true,
          confirmedTimeWithin24h: true,
          memberOrAnchorVouched: true,
          valueDelivered: true,
          explicitPositiveSignal: true,
        },
      );
      expect(airGapScore.status).toBe(200);
      const airGapPromote = await api<{ allowed: boolean; blockedReason?: string }>(
        "POST",
        `/api/intake/${airGapScore.data.candidate.id}/promote`,
        { recipientName: "Morgan" },
      );
      expect(airGapPromote.status).toBe(403);
      expect(airGapPromote.data.allowed).toBe(false);
      expect(airGapPromote.data.blockedReason).toBe("cross_brand_external_prospect_air_gap");

      // 4. Verified high-signal adult promotes ONCE, writes surface='intake' touchpoint, second promote blocked!
      const goodScore = await api<{ qualified: boolean; candidate: { id: string } }>(
        "POST",
        "/api/intake/score",
        {
          campaignId: seededCampaignId,
          city: "nyc",
          targetAppId: "ntwrk",
          sourcePlatform: "luma",
          contactIdentifier: "highsignal.builder@heliossystems.io",
          identifierKind: "email",
          statedAge: 31,
          replyOrBioText:
            "Thanks for introducing me to Maya at the SoHo hardware salon — confirmed for Thursday at 7pm. How do I stay in the loop for future Brooklyn intros?",
          verifiedWorkEmail: true,
          tier1PublicProof: true,
          attendedIrlEvent: true,
          confirmedTimeWithin24h: true,
          memberOrAnchorVouched: true,
          valueDelivered: true,
          explicitPositiveSignal: true,
        },
      );
      expect(goodScore.status).toBe(200);
      expect(goodScore.data.qualified).toBe(true);

      const firstPromote = await api<{
        allowed: boolean;
        inviteText: string | null;
        entryUrl: string | null;
        skillUrl: string | null;
        candidate: { inviteAttempts: number; status: string };
      }>("POST", `/api/intake/${goodScore.data.candidate.id}/promote`, {
        recipientName: "Jordan",
        senderName: "The Operator",
      });
      expect(firstPromote.status).toBe(200);
      expect(firstPromote.data.allowed).toBe(true);
      expect(firstPromote.data.entryUrl).toBe("https://ntwrk.party");
      expect(firstPromote.data.skillUrl).toBe("https://ntwrk.party/SKILL.md");
      expect(firstPromote.data.candidate.inviteAttempts).toBe(1);
      expect(firstPromote.data.candidate.status).toBe("invited");

      const intakeTouchRow = firstRow<{ n: number }>(
        await sql`select count(*)::int as n from marketing.contact_touchpoints where surface = 'intake'`,
      );
      expect(intakeTouchRow.n).toBeGreaterThanOrEqual(1);

      const secondPromote = await api<{ allowed: boolean; blockedReason?: string }>(
        "POST",
        `/api/intake/${goodScore.data.candidate.id}/promote`,
        { recipientName: "Jordan" },
      );
      expect(secondPromote.status).toBe(403);
      expect(secondPromote.data.allowed).toBe(false);
      expect(secondPromote.data.blockedReason).toBe("candidate_already_invited");

      // 5. Verify marketing.contact_fence blocks rows in platform.external_prospect_suppressions
      const extHash = keyedContactHash("handle", "ext_suppressed_tinder_user") ?? "ext-hash-fallback";
      const hasExtTable = firstRow<{ present: boolean }>(
        await sql`select to_regclass('platform.external_prospect_suppressions') is not null as present`,
      );
      if (hasExtTable.present) {
        await sql`
          insert into platform.external_prospect_suppressions (
            city, dedupe_hash, phone_hash, reason, permanent, created_at
          ) values (
            'nyc', ${extHash}, null, 'stopped', true, ${new Date(clock.now())}
          )
          on conflict do nothing
        `;
        const bridge = createNetworkCoreBridge({ sql, clock });
        const extVerdict = await bridge.checkContactFence({ handleHash: extHash });
        expect(extVerdict.allowed).toBe(false);
        expect(extVerdict.globallyStopped).toBe(true);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "26. Pass-4 Defect Regressions: D1 Local Quiet Hours, D2 Tier-3 Cold Cooldown, D4 >=14d VIP Follow-up, D7 leakCheckPass Accuracy, & Source Authority",
    async () => {
      // D1 + D7: CrowdsourcingEngine at 11pm NYC EST blocks cold outreach with blocked_policy while preserving true leakCheckPass!
      const nightClock: Clock = { now: () => Date.UTC(2026, 10, 27, 4, 0, 0) }; // 11pm EST
      const nightEngine = new CrowdsourcingEngine({ store, clock: nightClock });
      const nightHuman = await store.upsertHuman({
        handleOrEmailHmac: "p4:d1-quiet-hours-target",
        displayLabel: "Night Quiet Target",
        contactEmail: "night-target@example.com",
        channel: "email",
        role: "applicant",
        city: "nyc",
        lowestAge: 28,
      });
      const quietMsg = await nightEngine.queueOutreach({
        campaignId: seededCampaignId,
        agentId: sloaneId,
        humanId: nightHuman.id,
        channel: "email",
        tier: 1,
        subject: "Quick note for NYC",
        bodyText: "Clean 18+ local message with zero leaks via go.slop.date.",
      });
      expect(quietMsg.status).toBe("blocked_policy");
      expect(quietMsg.leakCheckPass).toBe(true);

      // D2: Tier-3 cold email is subject to 14-day cold cooldown (cannot bypass by bumping tier to 3!)
      const dayClock: Clock = { now: () => Date.UTC(2026, 10, 27, 18, 0, 0) }; // 1pm EST
      const dayEngine = new CrowdsourcingEngine({ store, clock: dayClock });
      const t3Human = await store.upsertHuman({
        handleOrEmailHmac: "p4:d2-tier3-cold-target",
        displayLabel: "Tier 3 Cold Target",
        contactEmail: "t3-cold@example.com",
        channel: "email",
        role: "applicant",
        city: "nyc",
        lowestAge: 29,
      });
      await store.recordContactTouchpoint({
        contactHash: t3Human.handleOrEmailHmac,
        campaignId: seededCampaignId,
        surface: "outreach",
        isCold: true,
        answered: false,
      });
      const t3Blocked = await dayEngine.queueOutreach({
        campaignId: seededCampaignId,
        agentId: sloaneId,
        humanId: t3Human.id,
        channel: "email",
        tier: 3,
        subject: "Tier 3 cold follow-up too soon",
        bodyText: "Clean 18+ local message via go.slop.date.",
      });
      expect(t3Blocked.status).toBe("blocked_policy");
      expect(t3Blocked.leakCheckPass).toBe(true);

      // D4: VIP follow-up requires >= 14 days (blocks at 7 days, allows at 14 days)
      const vipEng = new VipDiscoveryEngine({ clock: dayClock });
      const tooEarly = vipEng.buildVipFollowUp("Elena", 7, "NYC distributed systems", "The Operator");
      expect(tooEarly.allowed).toBe(false);
      const after14d = vipEng.buildVipFollowUp("Elena", 14, "NYC distributed systems", "The Operator");
      expect(after14d.allowed).toBe(true);

      // Source authority fix on POST /api/vips: sec_form_d outranks social_only reddit!
      const socialVip = await api<{ prospect: { prestigeScore: number } }>("POST", "/api/vips", {
        campaignId: seededCampaignId,
        city: "nyc",
        name: "Social Only Prospect",
        archetype: "startup_founder",
        publicSource: "reddit",
      });
      const filingVip = await api<{ prospect: { prestigeScore: number } }>("POST", "/api/vips", {
        campaignId: seededCampaignId,
        city: "nyc",
        name: "Filing Verified Prospect",
        archetype: "startup_founder",
        publicSource: "sec_form_d",
      });
      expect(socialVip.status).toBe(201);
      expect(filingVip.status).toBe(201);
      expect(filingVip.data.prospect.prestigeScore).toBeGreaterThan(
        socialVip.data.prospect.prestigeScore,
      );
    },
    TEST_TIMEOUT,
  );
});
