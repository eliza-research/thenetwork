import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SimClock } from "../../../packages/core/src/clock.ts";
import type { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { startMockServices, type MockServicesServer } from "../../../packages/mock-services/src/index.ts";
import { AdAdapterRegistry } from "../src/adapters/ads.ts";
import { createPaidAdapterRegistry, spendAuthFromCampaign } from "../src/adapters/paid.ts";
import { SocialAdapterRegistry } from "../src/adapters/social.ts";
import { AgentLifecycleManager } from "../src/agent-lifecycle.ts";
import {
  MarketingComplianceRuntime,
  resolveMockBaseUrl,
} from "../src/compliance-runtime.ts";
import { CrowdsourcingEngine } from "../src/crowdsourcing.ts";
import { DeviceBridge } from "../src/devices/bridge.ts";
import { PgNetworkCoreBridge } from "../src/network-bridge.ts";
import { createMarketingServer, seedNycLaunch } from "../src/server.ts";
import { MemoryMarketingStore } from "../src/store.ts";
import { normalizeCityLaunchStage } from "../src/types.ts";

describe("Marketing Engine Wave 2 Overhaul", () => {
  let mockServer: MockServicesServer;

  beforeAll(async () => {
    mockServer = await startMockServices({ hostname: "127.0.0.1", port: 0, seed: 42 });
  });

  afterAll(async () => {
    await mockServer.stop(true);
  });

  it("blocks RED compliance modes in production across DeviceBridge, AgentLifecycleManager, and PgNetworkCoreBridge", async () => {
    const clock = new SimClock(Date.parse("2026-11-27T12:00:00.000Z"));
    const prodEnv: Record<string, string> = {
      MARKETING_ENV: "production",
      MARKETING_LIVE_DEVICE: "1",
      PLATFORM_HASH_KEY: "test-hash-key-32-bytes-minimum-len",
    };

    const compliance = new MarketingComplianceRuntime({ env: prodEnv, clock });
    expect(compliance.evaluateGate("device_farm_social_automation").allowed).toBe(false);
    expect(compliance.evaluateGate("consumer_cli_subscription").allowed).toBe(false);
    expect(compliance.evaluateGate("unauthenticated_scraping").allowed).toBe(false);
    expect(compliance.evaluateGate("cold_sms_without_pewc").allowed).toBe(false);
    expect(compliance.evaluateGate("official_api_opt_in", { hasRecordedConsent: true }).allowed).toBe(true);
    expect(compliance.evaluateGate("us_b2b_commercial_email", { hasHitlApproval: false }).allowed).toBe(false);

    const store = new MemoryMarketingStore({ clock });
    const device = await store.upsertDevice({
      id: "dev-prod-1",
      label: "Prod Android",
      platform: "android",
      serialOrUdid: "emulator-5554",
      batteryPct: 80,
      tempC: 31,
      warmupDay: 20,
      status: "online",
    });
    const bridge = new DeviceBridge({ clock, env: prodEnv });
    const devRes = await bridge.executeDeviceAction(
      device,
      { kind: "tap", x: 100, y: 200 },
      { leaseHolder: "operator", lockdown: false, targetStopped: false, dryRun: false },
    );
    expect(devRes.ok).toBe(false);
    expect(devRes.status).toBe("blocked_safety");
    expect(devRes.reason).toContain("red_mode_blocked_device_farm_social_automation");

    const agent = await store.upsertAgent({
      id: "agent-prod-cli",
      personaId: "sloane",
      displayName: "Sloane",
      appId: "slop",
      provider: "claude",
      authMode: "cli",
      sessionRef: "cli:claude",
      sessionHealthy: true,
    });
    const manager = new AgentLifecycleManager({
      store,
      clock,
      env: prodEnv,
      dryRun: false,
    });
    const turn = await manager.dispatchTurn(agent.id, "Draft a short invite.", {
      dryRun: false,
      allowFailover: false,
    });
    expect(turn.ok).toBe(false);
    expect(turn.blockedReason).toContain("red_mode_blocked_consumer_cli_subscription");

    const missingFnSql = (() => {
      const err = Object.assign(new Error("function marketing.contact_fence does not exist"), {
        code: "42883",
      });
      return Promise.reject(err);
    }) as unknown as SQL;
    const prodNetBridge = new PgNetworkCoreBridge({ sql: missingFnSql, clock, env: prodEnv });
    const prodVerdict = await prodNetBridge.checkContactFence({ phone: "+12125550199" });
    expect(prodVerdict.allowed).toBe(false);
    expect(prodVerdict.reason).toBe("bridge_unavailable_fail_closed");

    const devNetBridge = new PgNetworkCoreBridge({
      sql: missingFnSql,
      clock,
      env: { MARKETING_ENV: "dev", PLATFORM_HASH_KEY: prodEnv.PLATFORM_HASH_KEY },
    });
    const devVerdict = await devNetBridge.checkContactFence({ phone: "+12125550199" });
    expect(devVerdict.allowed).toBe(true);
    expect(devVerdict.source).toBe("standalone_fallback");
  });

  it("blocks direct non-loopback Blooio v1 sends and dispatches live HTTP social/ad/email adapters against mock-services with 429 AIMD backoff", async () => {
    const clock = new SimClock(Date.parse("2026-11-27T12:00:00.000Z"));
    const store = new MemoryMarketingStore({ clock });
    const campaign = await store.createCampaign({
      slug: "nyc-adapters-test",
      name: "NYC Adapters Test",
      city: "nyc",
      appId: "ntwrk",
      billingArmed: true,
      riskDial: "balanced",
      monthlyBudgetCents: 100_000,
      dailyCapCents: 20_000,
      maxTaskCents: 10_000,
    });

    const liveNoMock = createPaidAdapterRegistry({
      env: { MARKETING_LIVE_BILLING: "1", BLOOIO_API_KEY: "test-key" },
      clock,
    });
    const blooioBlocked = await liveNoMock.execute(
      "sms_voice",
      { toE164: "+12125550101", body: "Hello", optedIn: true, action: "sms" },
      {
        spend: spendAuthFromCampaign(campaign, 5),
        idempotencyKey: "blooio-block-1",
        preferredProvider: "blooio",
      },
    );
    expect(blooioBlocked.ok).toBe(false);
    expect(blooioBlocked.reason).toContain("Direct Blooio v1 send is disabled");

    const mockEnv: Record<string, string> = {
      MARKETING_ENV: "test",
      MARKETING_MOCK_BASE_URL: mockServer.url,
      MARKETING_LIVE_SEND: "1",
    };
    const compliance = new MarketingComplianceRuntime({ env: mockEnv, clock });
    const social = new SocialAdapterRegistry({ env: mockEnv, clock, compliance });
    const xRes = await social.dispatch({
      platform: "x",
      text: "Join The Network in NYC this Thursday — ntwrk.party",
      campaignId: campaign.id,
      idempotencyKey: "x-post-1",
    });
    expect(xRes.ok).toBe(true);
    expect(xRes.mode).toBe("mock_http");
    expect(xRes.externalRef).toBeTruthy();

    const redditRes = await social.dispatch({
      platform: "reddit",
      title: "NYC community dinners",
      text: "Hosting a small curated meetup in SoHo.",
      subreddit: "nycmeetups",
      campaignId: campaign.id,
      idempotencyKey: "reddit-post-1",
    });
    expect(redditRes.ok).toBe(true);
    expect(redditRes.mode).toBe("mock_http");

    const ads = new AdAdapterRegistry({ env: mockEnv, clock, compliance });
    const metaRes = await ads.launchCampaign({
      platform: "meta_ads",
      campaignName: "NYC Friends Launch",
      city: "nyc",
      objective: "OUTCOME_LEADS",
      dailyBudgetCents: 2_500,
      destinationUrl: "https://friends.help",
      adCopy: "Meet real friends in NYC.",
      idempotencyKey: "meta-camp-1",
      spend: spendAuthFromCampaign(campaign, 2_500),
    });
    expect(metaRes.ok).toBe(true);
    expect(metaRes.mode).toBe("mock_http");

    const capiRes = await ads.sendConversionEvent({
      platform: "meta_ads",
      eventName: "CompleteRegistration",
      valueCents: 1_200,
      eventId: "capi-ev-1",
    });
    expect(capiRes.ok).toBe(true);

    const rateLimitedSocial = new SocialAdapterRegistry({
      env: mockEnv,
      clock,
      compliance,
      fetchFn: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: { "retry-after": "30", "x-rate-limit-remaining": "0" },
          }),
        ),
    });
    const rl1 = await rateLimitedSocial.dispatch({
      platform: "linkedin",
      text: "Launching curated founder circles in NYC.",
      idempotencyKey: "li-rl-1",
    });
    expect(rl1.ok).toBe(false);
    expect(rl1.status).toBe(429);
    const rl2 = await rateLimitedSocial.dispatch({
      platform: "linkedin",
      text: "Second attempt while AIMD backoff is active.",
      idempotencyKey: "li-rl-2",
    });
    expect(rl2.ok).toBe(false);
    expect(rl2.reason).toBe("aimd_backoff_active");
  });

  it("enforces CAN-SPAM + RFC 8058 unsubscribe, processes all 5 webhooks, serves analytics/trajectories, and runs live interactive game simulation", async () => {
    const clock = new SimClock(Date.parse("2026-11-27T14:00:00.000Z"));
    const store = new MemoryMarketingStore({ clock });
    const seeded = await seedNycLaunch(store);

    expect(normalizeCityLaunchStage("scout")).toBe("researching");
    expect(normalizeCityLaunchStage("soft_launch")).toBe("liquidity_seeding");
    expect(normalizeCityLaunchStage("live_matching")).toBe("live_matching");

    const serverHandle = await createMarketingServer({
      store,
      clock,
      port: 0,
      token: "test-overhaul-token",
      env: {
        ...process.env,
        NODE_ENV: "test",
        MARKETING_ENV: "test",
        MARKETING_MOCK_BASE_URL: mockServer.url,
        MARKETING_LIVE_SEND: "1",
        PLATFORM_HASH_KEY: "test-overhaul-hash-key-32-bytes-ok",
      },
    });

    const authHeaders = {
      Authorization: `Bearer ${serverHandle.token}`,
      "Content-Type": "application/json",
    };

    try {
      const htmlRes = await fetch(`${serverHandle.url}/`);
      expect(htmlRes.status).toBe(200);
      expect(await htmlRes.text()).toContain("Command Center");

      const complianceRes = await fetch(`${serverHandle.url}/api/compliance`, { headers: authHeaders });
      expect(complianceRes.status).toBe(200);
      const complianceBody = (await complianceRes.json()) as {
        gates: Record<string, { tier: string; allowed: boolean }>;
      };
      expect(complianceBody.gates.device_farm_social_automation?.tier).toBe("RED");
      expect(complianceBody.gates.device_farm_social_automation?.allowed).toBe(false);

      const human = await store.upsertHuman({
        handleOrEmailHmac: "email:unsub-test@example.com",
        contactEmail: "unsub-test@example.com",
        displayLabel: "Unsub Test",
        channel: "email",
        role: "venue",
        city: "nyc",
        lowestAge: 28,
      });
      await store.createOutreachMessage({
        campaignId: seeded.campaign.id,
        agentId: seeded.agents[0].id,
        humanId: human.id,
        channel: "email",
        tier: 1,
        subject: "NYC Venue Partner",
        bodySummary: "Quick note about hosting curated NYC evenings.",
        leakCheckPass: true,
        desiredStatus: "queued",
      });

      const badUnsub = await fetch(`${serverHandle.url}/api/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "tampered.signature" }),
      });
      expect(badUnsub.status).toBe(400);

      const validToken = serverHandle.compliance.signUnsubscribeToken(human.handleOrEmailHmac, "email");
      const unsubRes = await fetch(`${serverHandle.url}/api/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: validToken }),
      });
      expect(unsubRes.status).toBe(200);
      const unsubJson = (await unsubRes.json()) as { ok: boolean; cancelledOutreach: number };
      expect(unsubJson.ok).toBe(true);
      expect(unsubJson.cancelledOutreach).toBe(1);

      const auditAfterUnsub = await store.listOperatorAudit(10);
      expect(auditAfterUnsub.some((a) => a.action === "contact_unsubscribed")).toBe(true);

      const qr = await store.createQrBatch({
        campaignId: seeded.campaign.id,
        city: "nyc",
        batchCode: "NYC-WH-001",
        destinationUrl: "https://ntwrk.party",
        printQty: 100,
      });
      const dubWh = await fetch(`${serverHandle.url}/api/webhooks/dub`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrBatchCode: qr.batchCode, city: "nyc", appId: "ntwrk" }),
      });
      expect(dubWh.status).toBe(200);
      const updatedQr = await store.getQrBatchByCode(qr.batchCode);
      expect(updatedQr?.scans).toBe(1);

      const [emailWh, socialWh, lumaWh, beaconWh] = await Promise.all([
        fetch(`${serverHandle.url}/api/webhooks/email/resend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "email.bounced", data: { to: "bounced@example.com" } }),
        }),
        fetch(`${serverHandle.url}/api/webhooks/social/x`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handle: "@stop_user", text: "STOP please" }),
        }),
        fetch(`${serverHandle.url}/api/webhooks/luma`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city: "nyc", appId: "friends", guestId: "guest-1" }),
        }),
        fetch(`${serverHandle.url}/api/webhooks/beacon`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: [{ event: "site_visit", city: "nyc", appId: "ntwrk", utmSource: "qr" }] }),
        }),
      ]);
      expect(emailWh.status).toBe(200);
      expect(socialWh.status).toBe(200);
      expect(lumaWh.status).toBe(200);
      expect(beaconWh.status).toBe(200);

      const crowdsourcing = new CrowdsourcingEngine({
        store,
        clock,
        env: { MARKETING_ENV: "test", MARKETING_MOCK_BASE_URL: mockServer.url, MARKETING_LIVE_SEND: "1" },
        paidAdapters: createPaidAdapterRegistry({
          clock,
          env: { MARKETING_ENV: "test", MARKETING_MOCK_BASE_URL: mockServer.url },
          compliance: serverHandle.compliance,
        }),
        socialAdapters: new SocialAdapterRegistry({
          clock,
          env: { MARKETING_ENV: "test", MARKETING_MOCK_BASE_URL: mockServer.url },
          compliance: serverHandle.compliance,
        }),
        compliance: serverHandle.compliance,
      });
      const recipient = await store.upsertHuman({
        handleOrEmailHmac: "email:partner-live@example.com",
        contactEmail: "partner-live@example.com",
        displayLabel: "Partner Live",
        channel: "email",
        role: "venue",
        city: "nyc",
        lowestAge: 31,
      });
      await store.setRiskDial(seeded.campaign.id, "balanced", true);
      await crowdsourcing.queueOutreach({
        campaignId: seeded.campaign.id,
        agentId: seeded.agents[0].id,
        humanId: recipient.id,
        channel: "email",
        tier: 3,
        subject: "Curated NYC Partnership",
        bodyText: "We would love to host a small 18+ dinner at your venue.",
      });
      const dispatchRes = await crowdsourcing.dispatchPendingOutreach(seeded.campaign.id);
      expect(dispatchRes.sent).toBeGreaterThanOrEqual(1);

      const simStateRes = await fetch(`${serverHandle.url}/api/sim/state`, { headers: authHeaders });
      expect(simStateRes.status).toBe(200);
      const simState = (await simStateRes.json()) as {
        active: boolean;
        scenarioId: string;
        mockBaseUrl: string;
        scenarios: unknown[];
      };
      expect(simState.active).toBe(true);
      expect(simState.scenarioId).toBe("city_launch");
      expect(simState.mockBaseUrl).toContain("http://127.0.0.1:");
      expect(simState.scenarios.length).toBe(5);

      const stepRes = await fetch(`${serverHandle.url}/api/sim/command`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ type: "step", step: "+1d" }),
      });
      expect(stepRes.status).toBe(200);
      const stepped = (await stepRes.json()) as {
        ok: boolean;
        state: { snapshot: { simDay: number; safetyViolations: number } };
      };
      expect(stepped.ok).toBe(true);
      expect(stepped.state.snapshot.simDay).toBeGreaterThanOrEqual(1);
      expect(stepped.state.snapshot.safetyViolations).toBe(0);

      const chaosRes = await fetch(`${serverHandle.url}/api/sim/command`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ type: "trigger_chaos", service: "x", faultKind: "rate_limit_spike", probability: 0.5 }),
      });
      expect(chaosRes.status).toBe(200);

      const trafficRes = await fetch(`${serverHandle.url}/api/sim/mock/traffic?limit=20`, { headers: authHeaders });
      expect(trafficRes.status).toBe(200);
      const trafficJson = (await trafficRes.json()) as { entries: unknown[] };
      expect(Array.isArray(trafficJson.entries)).toBe(true);

      const [funnelRes, cohortsRes, attrRes, heatmapRes, tsRes, anomRes, sliceJsonRes, sliceCsvRes, trajRes] =
        await Promise.all([
          fetch(`${serverHandle.url}/api/analytics/funnel`, { headers: authHeaders }),
          fetch(`${serverHandle.url}/api/analytics/cohorts`, { headers: authHeaders }),
          fetch(`${serverHandle.url}/api/analytics/attribution?model=linear`, { headers: authHeaders }),
          fetch(`${serverHandle.url}/api/analytics/heatmap`, { headers: authHeaders }),
          fetch(`${serverHandle.url}/api/analytics/timeseries?granularity=day`, { headers: authHeaders }),
          fetch(`${serverHandle.url}/api/analytics/anomalies`, { headers: authHeaders }),
          fetch(`${serverHandle.url}/api/analytics/slice`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ metric: "site_visits", granularity: "day", groupBy: ["city"], format: "json" }),
          }),
          fetch(`${serverHandle.url}/api/analytics/slice`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ metric: "site_visits", granularity: "day", groupBy: ["city"], format: "csv" }),
          }),
          fetch(`${serverHandle.url}/api/trajectories?limit=20`, { headers: authHeaders }),
        ]);

      expect(funnelRes.status).toBe(200);
      expect(cohortsRes.status).toBe(200);
      expect(attrRes.status).toBe(200);
      expect(heatmapRes.status).toBe(200);
      expect(tsRes.status).toBe(200);
      expect(anomRes.status).toBe(200);
      expect(sliceJsonRes.status).toBe(200);
      expect(sliceCsvRes.status).toBe(200);
      expect(sliceCsvRes.headers.get("content-type")).toContain("text/csv");
      expect(await sliceCsvRes.text()).toContain("bucket,city,value,sample_count,suppressed");

      expect(trajRes.status).toBe(200);
      const trajJson = (await trajRes.json()) as { traces: Array<{ traceId: string }>; hotTail: unknown[] };
      expect(trajJson.traces.length + trajJson.hotTail.length).toBeGreaterThan(0);
      if (trajJson.traces[0]) {
        const detailRes = await fetch(
          `${serverHandle.url}/api/trajectories/${encodeURIComponent(trajJson.traces[0].traceId)}?decrypt=1`,
          { headers: authHeaders },
        );
        expect(detailRes.status).toBe(200);
        const detailJson = (await detailRes.json()) as { spans: unknown[] };
        expect(detailJson.spans.length).toBeGreaterThan(0);
      }

      const opsRes = await fetch(`${serverHandle.url}/api/ops-summary`, { headers: authHeaders });
      expect(opsRes.status).toBe(200);
      const opsJson = (await opsRes.json()) as {
        overview: { tracks: unknown[]; attribution: { cpaHistoryCents: number[] } };
        llmUsage: { deterministicSkips: number };
      };
      expect(Array.isArray(opsJson.overview.tracks)).toBe(true);
      expect(Array.isArray(opsJson.overview.attribution.cpaHistoryCents)).toBe(true);
      expect(typeof opsJson.llmUsage.deterministicSkips).toBe("number");

      const phoneToken = serverHandle.compliance.signUnsubscribeToken("+12125550188", "sms_opted_in");
      const phoneUnsub = await fetch(`${serverHandle.url}/api/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: phoneToken }),
      });
      expect(phoneUnsub.status).toBe(200);
      expect(
        serverHandle.compliance.suppression.check({ kind: "phone", value: "+12125550188" }).suppressed,
      ).toBe(true);

      const bigBatch = await fetch(`${serverHandle.url}/api/webhooks/beacon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: Array.from({ length: 101 }, () => ({ event: "site_visit" })) }),
      });
      expect(bigBatch.status).toBe(400);

      const oversized = await fetch(`${serverHandle.url}/api/webhooks/beacon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pad: "x".repeat(70_000) }),
      });
      expect(oversized.status).toBe(413);
    } finally {
      await serverHandle.stop();
    }
  });

  it("enforces deployed-env hardening: fails closed on webhooks without secrets, blocks /api/sim/*, refuses remote/staging mocks, and avoids fake site_visit spend inflation", async () => {
    const clock = new SimClock(Date.parse("2026-11-27T15:00:00.000Z"));
    expect(
      resolveMockBaseUrl({
        MARKETING_ENV: "staging",
        MARKETING_MOCK_BASE_URL: "http://127.0.0.1:4100",
      }),
    ).toBeNull();
    expect(
      resolveMockBaseUrl({
        MARKETING_ENV: "dev",
        MARKETING_MOCK_BASE_URL: "https://remote.example.com",
        MARKETING_ALLOW_REMOTE_MOCK: "1",
      }),
    ).toBeNull();
    expect(
      () => new MarketingComplianceRuntime({ env: { MARKETING_ENV: "production" }, clock }),
    ).toThrow(/MARKETING_UNSUBSCRIBE_SECRET/);

    const store = new MemoryMarketingStore({ clock });
    const camp = await store.createCampaign({
      slug: "prod-hardening",
      name: "Prod Hardening",
      city: "nyc",
      appId: "ntwrk",
      billingArmed: true,
      riskDial: "balanced",
      monthlyBudgetCents: 100_000,
      dailyCapCents: 20_000,
      maxTaskCents: 10_000,
    });
    await store.authorizeSpend({
      campaignId: camp.id,
      adapterId: "paid:email",
      tier: 3,
      amountCents: 500,
      entryType: "commit",
      idempotencyKey: "commit-no-visit-1",
    });

    const prodServer = await createMarketingServer({
      store,
      clock,
      port: 0,
      token: "prod-token-secret-32-chars-minimum",
      env: {
        NODE_ENV: "production",
        MARKETING_ENV: "production",
        PLATFORM_HASH_KEY: "prod-hash-key-32-bytes-minimum-len",
      },
    });
    const authHeaders = {
      Authorization: `Bearer ${prodServer.token}`,
      "Content-Type": "application/json",
    };

    try {
      const whNoSecret = await fetch(`${prodServer.url}/api/webhooks/email/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email.bounced", data: { to: "a@b.com" } }),
      });
      expect(whNoSecret.status).toBe(401);

      const simBlocked = await fetch(`${prodServer.url}/api/sim/state`, { headers: authHeaders });
      expect(simBlocked.status).toBe(403);

      const funnelRes = await fetch(`${prodServer.url}/api/analytics/funnel`, { headers: authHeaders });
      expect(funnelRes.status).toBe(200);
      const funnel = (await funnelRes.json()) as {
        steps: Array<{ stage: string; count: number }>;
      };
      const visitStep = funnel.steps.find((s) => s.stage === "site_visit");
      expect(visitStep?.count ?? 0).toBe(0);
    } finally {
      await prodServer.stop();
    }
  });
});
