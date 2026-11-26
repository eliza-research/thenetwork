// Real Postgres (:54339) + real HTTP server integration test suite for @thenetwork/marketing.
// Covers all 7 end-to-end scenarios against migrated marketing.* schema and Vibestack-generated
// policy/device guards without mocks for DB or HTTP transport.

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { findExecutable } from "../../../packages/core/src/runtime/process.ts";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { applySchema, DEV_PG_PORT, devPgUp } from "../../../packages/db/dev-pg.ts";
import type { CliProcessRunner } from "../src/agent-lifecycle.ts";
import { DeviceBridge, type ExecFn } from "../src/devices/bridge.ts";
import { createMarketingServer } from "../src/server.ts";
import { PgMarketingStore } from "../src/store.ts";
import type { Clock } from "../src/types.ts";

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

describe.skipIf(!pgAvailable)("@thenetwork/marketing Postgres + HTTP integration", () => {
  const fixedNow = Date.parse("2026-11-26T15:00:00.000Z");
  let currentNow = fixedNow;
  const clock: Clock = { now: () => (currentNow += 1_000) };

  let dbUrl = "";
  let sql!: SQL;
  let store!: PgMarketingStore;
  let baseUrl = "";
  let token = "";
  let stopServer: (() => Promise<void>) | undefined;

  let cliCalls: Array<{ cmd: readonly string[] }> = [];
  let failPrimaryCodex = false;

  const mockCliRunner: CliProcessRunner = async (cmd) => {
    cliCalls.push({ cmd });
    const bin = cmd[0] ?? "";
    if (failPrimaryCodex && bin === "codex") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "429 rate limit exceeded: retry after 60s",
      };
    }
    return {
      exitCode: 0,
      stdout: `Executed safe NYC growth turn via ${bin}`,
      stderr: "",
    };
  };

  const mockDeviceExec: ExecFn = async (cmd) => {
    const joined = cmd.join(" ");
    if (joined.includes("adb devices -l")) {
      return {
        exitCode: 0,
        stdout: [
          "List of devices attached",
          "PIXEL7A9901            device usb:1-1 product:lynx model:Pixel_7a device:lynx transport_id:1",
          "",
        ].join("\n"),
        stderr: "",
      };
    }
    if (joined.includes("dumpsys battery")) {
      return {
        exitCode: 0,
        stdout: ["Current Battery Service state:", "  AC powered: false", "  USB powered: true", "  level: 62", "  temperature: 310"].join("\n"),
        stderr: "",
      };
    }
    if (joined.includes("devicectl list devices")) {
      return {
        exitCode: 0,
        stdout: [
          "Name              Hostname                     Identifier                             State                 Model",
          "----------------  ---------------------------  -------------------------------------  --------------------  -------------------",
          "iPhone SE 3 NYC   iphone-se3.local             00008110-0011223344556677              connected             iPhone SE (3rd gen)",
        ].join("\n"),
        stderr: "",
      };
    }
    if (joined.includes("pymobiledevice3")) {
      return { exitCode: 1, stdout: "", stderr: "no tunnel in test" };
    }
    return { exitCode: 0, stdout: "ok", stderr: "" };
  };

  const mockDiscoveryFetch: typeof fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("data.cityofnewyork.us")) {
      return new Response(
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
      );
    }
    if (url.includes("hn.algolia.com")) {
      return new Response(
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
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/atom+xml" } });
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  async function api<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    authToken: string | null = token,
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken !== null) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, data };
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

    const deviceBridge = new DeviceBridge({
      exec: mockDeviceExec,
      findExecutable: (name) =>
        name === "adb" || name === "xcrun" || name === "scrcpy" ? `/usr/local/bin/${name}` : null,
      fetchFn: async () => new Response("{}", { status: 503 }),
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
      },
    });
    baseUrl = started.url;
    token = started.token;
    stopServer = started.stop;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await stopServer?.();
    await store?.close();
    await sql?.close();
    await dropIsolatedMarketingDb();
  }, TEST_TIMEOUT);

  test("1. Auth & Health Gate: public /health, HTML UI at /, 401/200 Bearer auth on /api/overview", async () => {
    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as { ok: boolean; service: string };
    expect(health.ok).toBe(true);
    expect(health.service).toBe("marketing");

    const uiRes = await fetch(`${baseUrl}/`);
    expect(uiRes.status).toBe(200);
    const html = await uiRes.text();
    expect(html).toContain("The Network — Marketing Command Center");
    expect(html).toContain("Authorization");

    const noAuth = await api("GET", "/api/overview", undefined, null);
    expect(noAuth.status).toBe(401);

    const wrongAuth = await api("GET", "/api/overview", undefined, "wrong-token");
    expect(wrongAuth.status).toBe(401);

    const okAuth = await api<{ slopCash: { enabled: boolean } }>("GET", "/api/overview");
    expect(okAuth.status).toBe(200);
    expect(okAuth.data.slopCash.enabled).toBe(false);
  }, TEST_TIMEOUT);

  test("2. NYC Seed & $10,000 Budget Verification persisted in Postgres marketing.*", async () => {
    const seeded = await api<{
      campaign: { id: string; slug: string; monthlyBudgetCents: number; slopCashEnabled: boolean };
      agents: Array<{ id: string; personaId: string; displayName: string; provider: string }>;
      devices: Array<{ id: string; platform: string }>;
      agenciesPersisted: Array<{ id: string }>;
      budgetTracksCents: Record<string, number>;
    }>("POST", "/api/seed/nyc");

    expect(seeded.status).toBe(200);
    expect(seeded.data.campaign.monthlyBudgetCents).toBe(1_000_000);
    expect(seeded.data.campaign.slopCashEnabled).toBe(false);
    expect(seeded.data.agents.length).toBe(5);

    const personas = seeded.data.agents.map((a) => a.personaId).sort();
    expect(personas).toEqual(["chadwick", "operator", "peon", "sloane", "venn"]);
    const providers = new Set(seeded.data.agents.map((a) => a.provider));
    expect(providers.has("chatgpt")).toBe(true);
    expect(providers.has("claude")).toBe(true);
    expect(providers.has("gemini")).toBe(true);

    const trackSum = Object.values(seeded.data.budgetTracksCents).reduce((a, b) => a + b, 0);
    expect(trackSum).toBe(1_000_000);

    seededCampaignId = seeded.data.campaign.id;
    chadwickId = seeded.data.agents.find((a) => a.personaId === "chadwick")!.id;
    sloaneId = seeded.data.agents.find((a) => a.personaId === "sloane")!.id;

    // Verify directly against Postgres tables
    const [campCount] = await sql`select count(*)::int as n from marketing.campaigns`;
    const [agentCount] = await sql`select count(*)::int as n from marketing.agents`;
    const [devCount] = await sql`select count(*)::int as n from marketing.devices`;
    const [agencyCount] = await sql`select count(*)::int as n from marketing.humans where role = 'agency'`;
    expect(campCount.n).toBe(1);
    expect(agentCount.n).toBe(5);
    expect(devCount.n).toBeGreaterThanOrEqual(3);
    expect(agencyCount.n).toBe(seeded.data.agenciesPersisted.length);
    expect(agencyCount.n).toBeGreaterThanOrEqual(10);

    // Idempotent re-seed does not duplicate campaigns or agents
    const reseed = await api("POST", "/api/seed/nyc");
    expect(reseed.status).toBe(200);
    const [agentCountAfter] = await sql`select count(*)::int as n from marketing.agents`;
    expect(agentCountAfter.n).toBe(5);
  }, TEST_TIMEOUT);

  test("3. Agent Subscription Lifecycle, Rate-Limit Failover, Pause & STOP Fence", async () => {
    cliCalls = [];
    failPrimaryCodex = false;

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

    // STOPped target blocks agent turn (inv_stop_fence_respected)
    const stopBlocked = await api<{ ok: boolean }>("POST", `/api/agents/${chadwickId}/tick`, {
      campaignId: seededCampaignId,
      prompt: "Follow up with opted-out contact",
      targetStopped: true,
    });
    expect(stopBlocked.status).toBe(403);
    expect(stopBlocked.data.ok).toBe(false);

    // Pause blocks tick; resume re-enables
    const paused = await api("POST", `/api/agents/${chadwickId}/pause`);
    expect(paused.status).toBe(200);
    const pausedTick = await api<{ ok: boolean }>("POST", `/api/agents/${chadwickId}/tick`, {
      campaignId: seededCampaignId,
      prompt: "Should be blocked while paused",
    });
    expect(pausedTick.status).toBe(403);
    expect(pausedTick.data.ok).toBe(false);

    const resumed = await api("POST", `/api/agents/${chadwickId}/resume`);
    expect(resumed.status).toBe(200);

    // Confirm turns persisted in Postgres
    const [row] = await sql`select turns_used_today from marketing.agents where id = ${chadwickId}`;
    expect(row.turns_used_today).toBe(2);
  }, TEST_TIMEOUT);

  test("4. Tier-2 Local MacBook + Android + iPhone Device Bridge & Vibestack Safety Envelope", async () => {
    const scan = await api<{
      scan: { androidCount: number; iosCount: number; devices: Array<{ platform: string; serialOrUdid: string }> };
      devices: Array<{ id: string; platform: string; serialOrUdid: string }>;
    }>("POST", "/api/devices/scan");

    expect(scan.status).toBe(200);
    expect(scan.data.scan.androidCount).toBe(1);
    expect(scan.data.scan.iosCount).toBe(1);
    const androidDevice = scan.data.devices.find((d) => d.platform === "android")!;
    const iosDevice = scan.data.devices.find((d) => d.platform === "ios")!;
    expect(androidDevice.serialOrUdid).toBe("PIXEL7A9901");
    expect(iosDevice.serialOrUdid).toBe("00008110-0011223344556677");

    // Safe telemetry (battery 62%, temp 31C, warmupDay 5) -> ALLOWED
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

    // Low battery (20% < 35%) -> BLOCKED by Vibestack canExecuteDeviceAction
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

    // Concurrent lease conflict -> BLOCKED
    await store.upsertDevice({
      id: androidDevice.id,
      label: "android-Pixel_7a-9901",
      platform: "android",
      hostMachine: "local-macbook",
      serialOrUdid: "PIXEL7A9901",
      batteryPct: 62,
      tempC: 31,
      warmupDay: 5,
      warmupStage: "branded_cadence",
      dailyActionsUsed: 1,
      dailyActionCap: 12,
      leaseHolder: "chadwick",
      leaseExpiresAt: new Date(fixedNow + 600_000).toISOString(),
      status: "leased",
    });
    const leasedConflict = await api<{ ok: boolean }>("POST", `/api/devices/${androidDevice.id}/action`, {
      action: { kind: "tap", x: 540, y: 1200 },
      leaseHolder: "sloane",
      dryRun: true,
    });
    expect(leasedConflict.status).toBe(403);
    expect(leasedConflict.data.ok).toBe(false);
  }, TEST_TIMEOUT);

  test("5. Tier-4 Crowdsourced Street-Team/Creator Proof-of-Work, Age, STOP & Budget Gates", async () => {
    // 5a. Underage applicant (age 17) rejected by Vibestack adultParticipantAge
    const underageHuman = await api<{ code: string; invariant: string }>("POST", "/api/humans", {
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

    // 5b. Create adult (age 24) street-interview YouTuber + a STOPped contact
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

    const stoppedContact = await api<{ human: { id: string } }>("POST", "/api/humans", {
      handleOrEmailHmac: "contact:opted-out-nyc",
      displayLabel: "Opted Out Contact",
      channel: "email",
      role: "applicant",
      city: "nyc",
      lowestAge: 26,
    });
    expect(stoppedContact.status).toBe(201);
    const stopRes = await api("POST", `/api/humans/${stoppedContact.data.human.id}/stop`, {
      reason: "replied_STOP",
    });
    expect(stopRes.status).toBe(200);

    // Outreach to STOPped contact blocked (403); outreach to adult creator queued & dry-run dispatched
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

    const okOutreach = await api<{ message: { id: string; status: string } }>("POST", "/api/outreach", {
      campaignId: seededCampaignId,
      agentId: sloaneId,
      humanId: creatorHumanId,
      channel: "email",
      tier: 1,
      subject: "NYC Street-Interview Brief ($250 + QR bonus)",
      bodyText: "Shoot 60s Washington Square Park street interview with FTC #Ad disclosure and mobile releases.",
    });
    expect(okOutreach.status).toBe(201);

    const dispatched = await api<{ dryRun: number; liveMode: boolean }>("POST", "/api/outreach/dispatch", {
      campaignId: seededCampaignId,
    });
    expect(dispatched.status).toBe(200);
    expect(dispatched.data.liveMode).toBe(false);
    expect(dispatched.data.dryRun).toBe(1);

    // 5c. Arm billing on campaign (balanced risk dial, billingArmed: true)
    const armed = await api<{ campaign: { billingArmed: boolean; riskDial: string } }>(
      "POST",
      `/api/campaigns/${seededCampaignId}/risk-dial`,
      { riskDial: "balanced", billingArmed: true },
    );
    expect(armed.status).toBe(200);
    expect(armed.data.campaign.billingArmed).toBe(true);

    // 5d. Hire adult creator for $250 Tier-4 video task
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

    // 5e. Unverified proof (missing FTC #Ad) rejected -> spent_cents stays 0!
    const badProofFtc = await api<{ approved: boolean; payoutAuthorized: boolean }>("POST", "/api/proofs", {
      taskId: creatorTaskId,
      proofKind: "creator_video",
      evidenceUrl: "https://www.youtube.com/watch?v=vidNYC001",
      qrScansCount: 45,
      verifiedSignupsCount: 14,
      ftcDisclosed: false,
      geoTimeValid: true,
      likenessReleaseOk: true,
      workerAge: 24,
    });
    expect(badProofFtc.status).toBe(400);
    expect(badProofFtc.data.approved).toBe(false);
    expect(badProofFtc.data.payoutAuthorized).toBe(false);

    // Missing evidence URL also rejected -> spent_cents stays 0!
    const badProofUrl = await api<{ approved: boolean }>("POST", "/api/proofs", {
      taskId: creatorTaskId,
      proofKind: "creator_video",
      evidenceUrl: "",
      qrScansCount: 45,
      verifiedSignupsCount: 14,
      ftcDisclosed: true,
      geoTimeValid: true,
      likenessReleaseOk: true,
      workerAge: 24,
    });
    expect(badProofUrl.status).toBe(400);
    expect(badProofUrl.data.approved).toBe(false);

    const [beforePay] = await sql`select spent_cents from marketing.campaigns where id = ${seededCampaignId}`;
    expect(beforePay.spent_cents).toBe(0);

    // 5f. Complete proof approved -> pays $250, writes marketing.budget_ledger, updates campaigns.spent_cents
    const goodProof = await api<{
      approved: boolean;
      payoutAuthorized: boolean;
      task: { status: string; proofVerified: boolean };
      campaign: { spentCents: number };
      budgetEntry: { amountCents: number; entryType: string };
    }>("POST", "/api/proofs", {
      taskId: creatorTaskId,
      proofKind: "creator_video",
      evidenceUrl: "https://www.youtube.com/watch?v=vidNYC001",
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
    expect(goodProof.data.task.proofVerified).toBe(true);
    expect(goodProof.data.campaign.spentCents).toBe(25_000);
    expect(goodProof.data.budgetEntry.amountCents).toBe(25_000);

    const [afterPay] = await sql`select spent_cents from marketing.campaigns where id = ${seededCampaignId}`;
    const ledgerRows = await sql`select amount_cents, entry_type from marketing.budget_ledger where task_id = ${creatorTaskId}`;
    expect(afterPay.spent_cents).toBe(25_000);
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].amount_cents).toBe(25_000);

    // 5g. Over-budget payout exceeding daily/per-task cap rejected by Vibestack canAuthorizeSpend
    const hugeTask = await api<{ task: { id: string } }>("POST", "/api/tasks", {
      campaignId: seededCampaignId,
      tier: 4,
      taskKind: "agency_booking",
      city: "nyc",
      title: "Over-cap NYC surge booking",
      briefText: "Attempts payout exceeding daily/per-task cap",
      vendorChannel: "agency_email",
      assigneeHumanId: creatorHumanId,
      assigneeAgeYears: 24,
      amountCents: 200_000, // exceeds maxTaskCents (150_000) and dailyCapCents (100_000)
      payoutRail: "fiat_stripe",
      status: "hired",
    });
    expect(hugeTask.status).toBe(201);

    const overCapProof = await api<{
      approved: boolean;
      payoutAuthorized: boolean;
      payoutError?: string;
    }>("POST", "/api/proofs", {
      taskId: hugeTask.data.task.id,
      proofKind: "street_shift",
      evidenceUrl: "https://example.com/shift-recap-001",
      checkinMediaHashes: ["sha256:aaa", "sha256:bbb"],
      ftcDisclosed: true,
      geoTimeValid: true,
      shiftDone: true,
      workerAge: 24,
    });
    expect(overCapProof.status).toBe(403);
    expect(overCapProof.data.payoutAuthorized).toBe(false);
    expect(overCapProof.data.payoutError).toContain("SPEND_NOT_AUTHORIZED");

    const [afterOverCap] = await sql`select spent_cents from marketing.campaigns where id = ${seededCampaignId}`;
    expect(afterOverCap.spent_cents).toBe(25_000);
  }, TEST_TIMEOUT);

  test("6. slop.cash Disabled-by-Default Guard: status, disabled_stub preview, 403 settle", async () => {
    const statusRes = await api<{ enabled: boolean }>("GET", "/api/slop-cash/status");
    expect(statusRes.status).toBe(200);
    expect(statusRes.data.enabled).toBe(false);

    // Direct slop_cash rail task creation is blocked while disabled
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
    expect(blockedSlopTask.data.invariant).toBe("inv_slop_cash_disabled");

    // Draft OSS bounty with rail "none" allows non-settling preview hook
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

    const previewRes = await api<{
      settlementBlocked: boolean;
      hook: { id: string; hookState: string; taskId: string };
    }>("POST", "/api/slop-cash/preview", {
      taskId: ossTask.data.task.id,
      repoSlug: "eliza-research/thenetwork",
      issueNumber: 42,
      vaultChain: "base",
    });
    expect(previewRes.status).toBe(200);
    expect(previewRes.data.settlementBlocked).toBe(true);
    expect(previewRes.data.hook.hookState).toBe("disabled_stub");

    // Verify persisted disabled_stub row in Postgres
    const hooks = await sql`select hook_state, enabled from marketing.slop_cash_hooks where task_id = ${ossTask.data.task.id}`;
    expect(hooks.length).toBe(1);
    expect(hooks[0].hook_state).toBe("disabled_stub");
    expect(hooks[0].enabled).toBe(false);

    // Settlement fails closed with 403 SlopCashDisabledError
    const settleRes = await api<{ code: string; invariant: string }>("POST", "/api/slop-cash/settle", {
      taskId: ossTask.data.task.id,
    });
    expect(settleRes.status).toBe(403);
    expect(settleRes.data.code).toBe("SLOP_CASH_DISABLED");
    expect(settleRes.data.invariant).toBe("inv_slop_cash_disabled");
  }, TEST_TIMEOUT);

  test("7. Tier-1 $0 Open-Web NYC Discovery + Attribution Funnel reflected in /api/overview", async () => {
    const disc = await api<{
      city: string;
      leads: Array<{ dedupeKey: string; source: string; title: string }>;
      sourceCounts: Record<string, number>;
    }>("POST", "/api/discovery/nyc", {
      city: "nyc",
      includeSources: ["nyc_open_data", "hn", "youtube_rss"],
      youtubeChannelIds: ["UC_NYC_VOX_TEST"],
    });
    expect(disc.status).toBe(200);
    expect(disc.data.city).toBe("nyc");
    // 2 duplicate DOHMH rows deduplicate to 1 + 1 HN + 1 YouTube RSS = 3 unique leads
    const uniqueKeys = new Set(disc.data.leads.map((l) => l.dedupeKey));
    expect(uniqueKeys.size).toBe(disc.data.leads.length);
    expect(disc.data.leads.length).toBe(3);
    expect(disc.data.sourceCounts.nyc_open_data).toBe(1);
    expect(disc.data.sourceCounts.hn).toBe(1);
    expect(disc.data.sourceCounts.youtube_rss).toBe(1);

    const scanEvent = await api("POST", "/api/attribution", {
      campaignId: seededCampaignId,
      taskId: creatorTaskId,
      qrBatchCode: creatorQrBatch,
      eventKind: "qr_scan",
      city: "nyc",
      appId: "slop",
      count: 45,
    });
    expect(scanEvent.status).toBe(201);

    const signupEvent = await api("POST", "/api/attribution", {
      campaignId: seededCampaignId,
      taskId: creatorTaskId,
      qrBatchCode: creatorQrBatch,
      eventKind: "signup_verified_adult",
      city: "nyc",
      appId: "slop",
      count: 14,
    });
    expect(signupEvent.status).toBe(201);

    const overview = await api<{
      budget: { monthlyBudgetCents: number; spentCents: number; remainingMonthlyCents: number };
      tasks: { total: number; paid: number };
      proofs: { verified: number };
      attribution: { qrScans: number; verifiedAdultSignups: number; blendedCpaCents: number | null };
      slopCash: { enabled: boolean };
    }>("GET", `/api/overview?campaignId=${encodeURIComponent(seededCampaignId)}`);

    expect(overview.status).toBe(200);
    expect(overview.data.budget.monthlyBudgetCents).toBe(1_000_000);
    expect(overview.data.budget.spentCents).toBe(25_000);
    expect(overview.data.budget.remainingMonthlyCents).toBe(975_000);
    expect(overview.data.tasks.paid).toBe(1);
    expect(overview.data.proofs.verified).toBeGreaterThanOrEqual(1);
    expect(overview.data.attribution.qrScans).toBe(45);
    expect(overview.data.attribution.verifiedAdultSignups).toBe(14);
    expect(overview.data.attribution.blendedCpaCents).toBe(Math.round(25_000 / 14));
    expect(overview.data.slopCash.enabled).toBe(false);
  }, TEST_TIMEOUT);
});
