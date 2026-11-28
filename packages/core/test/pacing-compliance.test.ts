import { describe, expect, test } from "vitest";
import { SimClock, HOUR, MINUTE, DAY } from "../src/clock.ts";
import { Rng } from "../src/rng.ts";
import {
  AimdController,
  applyQuietHoursSpread,
  buildHierarchySpecs,
  DEFAULT_QUIET_SPREAD_WINDOW_MS,
  decorrelatedJitterDelayMs,
  evaluateComplianceGate,
  fullJitterDelayMs,
  hammingDistance64,
  HierarchicalGcraLimiter,
  lintComplianceCopy,
  MultiSignalCircuitBreaker,
  parseRetryAfterHeader,
  poissonSpacingMs,
  quietHoursSpreadOffsetMs,
  simHash64,
  SuppressionSync,
  TemplateEntropyGuard,
  versionedContactHmac,
} from "../src/pacing/index.ts";

describe("HierarchicalGcraLimiter", () => {
  test("enforces all 5 hierarchy levels with all-or-nothing reservation", () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));
    const limiter = new HierarchicalGcraLimiter({ clock });

    const specs = buildHierarchySpecs({
      org: { key: "eliza", limit: 100, windowMs: HOUR, burst: 5 },
      platform: { key: "resend", limit: 50, windowMs: HOUR, burst: 3 },
      account: { key: "partners.ntwrk.party", limit: 20, windowMs: HOUR, burst: 2 },
      campaign: { key: "nyc-launch", limit: 10, windowMs: HOUR, burst: 1 },
      recipient: { key: "v1:abc", limit: 1, windowMs: HOUR, burst: 0 },
    });

    const first = limiter.tryReserve(specs);
    expect(first.allowed).toBe(true);
    expect(first.retryAfterMs).toBe(0);

    const beforeDenied = limiter.snapshot();
    const second = limiter.tryReserve(specs);
    expect(second.allowed).toBe(false);
    expect(second.blockedLevel).toBe("recipient");
    expect(second.blockedKey).toBe("recipient:v1:abc");
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.snapshot()).toEqual(beforeDenied);

    clock.advance(HOUR);
    const third = limiter.tryReserve(specs);
    expect(third.allowed).toBe(true);
  });

  test("blocks at org ceiling without consuming recipient or campaign tokens", () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));
    const limiter = new HierarchicalGcraLimiter({ clock });

    const makeSpecs = (recipient: string) =>
      buildHierarchySpecs({
        org: { key: "global", limit: 1, windowMs: MINUTE, burst: 0 },
        platform: { key: "twilio", limit: 10, windowMs: MINUTE, burst: 2 },
        account: { key: "line-1", limit: 10, windowMs: MINUTE, burst: 2 },
        campaign: { key: "camp-a", limit: 10, windowMs: MINUTE, burst: 2 },
        recipient: { key: recipient, limit: 5, windowMs: MINUTE, burst: 1 },
      });

    expect(limiter.tryReserve(makeSpecs("r1")).allowed).toBe(true);
    const blocked = limiter.tryReserve(makeSpecs("r2"));
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedLevel).toBe("org");
    expect(limiter.snapshot()["recipient:r2"]).toBeUndefined();
  });

  test("snapshots, restores, and prunes idle keys", () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));
    const limiter = new HierarchicalGcraLimiter({ clock });
    const specs = buildHierarchySpecs({
      account: { key: "acct-1", limit: 5, windowMs: MINUTE, burst: 1 },
    });
    expect(limiter.tryReserve(specs).allowed).toBe(true);
    const snap = limiter.snapshot();

    const restored = new HierarchicalGcraLimiter({ clock, initialTats: snap });
    expect(restored.snapshot()).toEqual(snap);

    clock.advance(2 * DAY);
    expect(restored.prune(DAY)).toBe(1);
    expect(restored.snapshot()).toEqual({});
  });
});

describe("AimdController", () => {
  test("increases additively when healthy and cuts multiplicatively on 429/5xx/low headroom", () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));
    const aimd = new AimdController({
      clock,
      config: {
        minConcurrency: 1,
        maxConcurrency: 10,
        initialConcurrency: 4,
        healthyWindow: 3,
        baselineLatencyMs: 500,
      },
    });

    for (let i = 0; i < 3; i += 1) {
      aimd.record({ ok: true, status: 200, latencyMs: 200 });
    }
    expect(aimd.snapshot().concurrency).toBe(5);

    aimd.record({ ok: false, status: 429, retryAfterHeader: "12" });
    expect(aimd.snapshot().concurrency).toBe(2);
    expect(aimd.canDispatch().allowed).toBe(false);
    expect(aimd.canDispatch().waitMs).toBe(12_000);

    clock.advance(12_000);
    expect(aimd.canDispatch().allowed).toBe(true);

    aimd.record({
      ok: true,
      status: 200,
      latencyMs: 200,
      rateLimitRemaining: 1,
      rateLimitLimit: 100,
    });
    expect(aimd.snapshot().concurrency).toBe(1);
  });

  test("parses numeric and HTTP-date Retry-After headers", () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0);
    expect(parseRetryAfterHeader("45", now)).toBe(45_000);
    expect(parseRetryAfterHeader(new Date(now + 30_000).toUTCString(), now)).toBe(30_000);
    expect(parseRetryAfterHeader("invalid", now)).toBeUndefined();
  });
});

describe("MultiSignalCircuitBreaker", () => {
  test("opens on consecutive 5xx and closes after half-open probes succeed", () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));
    const breaker = new MultiSignalCircuitBreaker({
      clock,
      scopeKey: "resend:partners.ntwrk.party",
      thresholds: {
        consecutiveServerErrors: 3,
        baseCooldownMs: 30_000,
        halfOpenProbesRequired: 2,
      },
    });

    breaker.recordDelivery({ ok: false, status: 503 });
    breaker.recordDelivery({ ok: false, status: 503 });
    expect(breaker.canDispatch().allowed).toBe(true);
    breaker.recordDelivery({ ok: false, status: 502 });
    expect(breaker.snapshot().state).toBe("open");
    expect(breaker.canDispatch().allowed).toBe(false);

    clock.advance(30_000);
    const probe1 = breaker.canDispatch();
    expect(probe1.allowed).toBe(true);
    expect(probe1.state).toBe("half_open");
    expect(breaker.canDispatch().allowed).toBe(false);

    breaker.recordDelivery({ ok: true, status: 200 });
    expect(breaker.snapshot().state).toBe("half_open");
    expect(breaker.canDispatch().allowed).toBe(true);
    breaker.recordDelivery({ ok: true, status: 200 });
    expect(breaker.snapshot().state).toBe("closed");
  });

  test("hard-opens on hard bounce > 2%, spam complaint >= 0.30%, STOP > 300 bps, and Blooio safety", () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));

    const bounceBreaker = new MultiSignalCircuitBreaker({
      clock,
      scopeKey: "email:bounce",
      thresholds: { minBounceSamples: 10, hardBounceRateThreshold: 0.02 },
    });
    for (let i = 0; i < 9; i += 1) bounceBreaker.recordDelivery({ ok: true, status: 200 });
    bounceBreaker.recordDelivery({ ok: true, status: 200, hardBounce: true });
    expect(bounceBreaker.snapshot().state).toBe("open");
    expect(bounceBreaker.snapshot().tripSignal).toBe("hard_bounce");
    expect(bounceBreaker.snapshot().requiresManualReset).toBe(true);

    const complaintBreaker = new MultiSignalCircuitBreaker({
      clock,
      scopeKey: "email:complaint",
      thresholds: { minComplaintSamples: 1000, spamComplaintWarnRate: 0.001, spamComplaintOpenRate: 0.003 },
    });
    for (let i = 0; i < 998; i += 1) complaintBreaker.recordDelivery({ ok: true, status: 200 });
    complaintBreaker.recordDelivery({ ok: true, status: 200, spamComplaint: true });
    complaintBreaker.recordDelivery({ ok: true, status: 200, spamComplaint: true });
    expect(complaintBreaker.snapshot().state).toBe("closed");
    expect(complaintBreaker.snapshot().throttled).toBe(true);
    complaintBreaker.recordDelivery({ ok: true, status: 200, spamComplaint: true });
    complaintBreaker.recordDelivery({ ok: true, status: 200, spamComplaint: true });
    expect(complaintBreaker.snapshot().state).toBe("open");
    expect(complaintBreaker.snapshot().tripSignal).toBe("spam_complaint");

    const stopBreaker = new MultiSignalCircuitBreaker({
      clock,
      scopeKey: "sms:stop",
      thresholds: { minStopSamples: 10, stopRateBpsThreshold: 200 },
    });
    for (let i = 0; i < 9; i += 1) stopBreaker.recordDelivery({ ok: true, status: 200 });
    stopBreaker.recordDelivery({ ok: true, status: 200, stopped: true });
    expect(stopBreaker.snapshot().state).toBe("open");
    expect(stopBreaker.snapshot().tripSignal).toBe("stop_rate");

    const safetyBreaker = new MultiSignalCircuitBreaker({ clock, scopeKey: "blooio:line-1" });
    safetyBreaker.recordSafetySignal({ kind: "blooio_safety", active: true, reason: "reply_only" });
    expect(safetyBreaker.canDispatch().allowed).toBe(false);
    const serialized = safetyBreaker.snapshot();
    const rehydrated = new MultiSignalCircuitBreaker({ clock, scopeKey: "blooio:line-1", initial: serialized });
    expect(rehydrated.canDispatch().allowed).toBe(false);
    rehydrated.reset();
    expect(rehydrated.canDispatch().allowed).toBe(true);
  });
});

describe("Deterministic Jitter & Pacing", () => {
  test("produces deterministic retry jitter, quiet-hours spread, and Poisson spacing", () => {
    const j1 = fullJitterDelayMs("msg-1", 3, 30_000, 30 * MINUTE);
    const j2 = fullJitterDelayMs("msg-1", 3, 30_000, 30 * MINUTE);
    expect(j1).toBe(j2);
    expect(j1).toBeGreaterThanOrEqual(0);
    expect(j1).toBeLessThanOrEqual(120_000);

    const d1 = decorrelatedJitterDelayMs("msg-1", 30_000, 10_000, 120_000);
    const d2 = decorrelatedJitterDelayMs("msg-1", 30_000, 10_000, 120_000);
    expect(d1).toBe(d2);
    expect(d1).toBeGreaterThanOrEqual(10_000);
    expect(d1).toBeLessThanOrEqual(90_000);

    const baseWake = Date.UTC(2026, 10, 27, 14, 0, 0);
    const offsetA = quietHoursSpreadOffsetMs("row-a", DEFAULT_QUIET_SPREAD_WINDOW_MS);
    const offsetB = quietHoursSpreadOffsetMs("row-b", DEFAULT_QUIET_SPREAD_WINDOW_MS);
    expect(offsetA).toBe(quietHoursSpreadOffsetMs("row-a", DEFAULT_QUIET_SPREAD_WINDOW_MS));
    expect(offsetA).toBeGreaterThanOrEqual(0);
    expect(offsetA).toBeLessThanOrEqual(DEFAULT_QUIET_SPREAD_WINDOW_MS);
    expect(offsetA).not.toBe(offsetB);
    expect(applyQuietHoursSpread(baseWake, "row-a", 0)).toBe(baseWake);

    const rng1 = new Rng(42);
    const rng2 = new Rng(42);
    const p1 = poissonSpacingMs(rng1, 10_000);
    const p2 = poissonSpacingMs(rng2, 10_000);
    expect(p1).toBe(p2);
    expect(p1).toBeGreaterThanOrEqual(4_000);
    expect(p1).toBeLessThanOrEqual(25_000);
  });
});

describe("ComplianceGate, CopyLinter, SimHash & SuppressionSync", () => {
  test("blocks RED modes, minors, unapproved AMBER, and EU/UK cold email", () => {
    expect(
      evaluateComplianceGate({ mode: "device_farm_social_automation", env: "production" }).allowed,
    ).toBe(false);
    expect(
      evaluateComplianceGate({ mode: "unauthenticated_scraping", env: "staging" }).allowed,
    ).toBe(false);
    expect(
      evaluateComplianceGate({ mode: "cold_sms_without_pewc", env: "dev" }).allowed,
    ).toBe(false);
    expect(
      evaluateComplianceGate({ mode: "consumer_cli_subscription", env: "production" }).allowed,
    ).toBe(false);
    expect(
      evaluateComplianceGate({ mode: "official_api_opt_in", env: "production", recipientIsMinor: true }).code,
    ).toBe("minor_outreach_prohibited");

    expect(
      evaluateComplianceGate({ mode: "us_b2b_commercial_email", env: "production", hasHitlApproval: false }).allowed,
    ).toBe(false);
    expect(
      evaluateComplianceGate({
        mode: "us_b2b_commercial_email",
        env: "production",
        hasHitlApproval: true,
        recipientCountry: "GB",
        hasRecordedConsent: false,
      }).code,
    ).toBe("opt_in_required_for_jurisdiction");
    expect(
      evaluateComplianceGate({
        mode: "us_b2b_commercial_email",
        env: "production",
        hasHitlApproval: true,
        recipientCountry: "US",
      }).allowed,
    ).toBe(true);
    expect(
      evaluateComplianceGate({
        mode: "inbound_qr_deeplink",
        env: "production",
      }).allowed,
    ).toBe(true);
  });

  test("lints CAN-SPAM, RFC 8058, AI disclosure, FTC #Ad, and unrendered tokens", () => {
    const badEmail = lintComplianceCopy({
      channel: "email",
      subject: "Hi {{FIRST_NAME}}",
      text: "Guaranteed date tonight! I am not an AI.",
      isCommercial: true,
      isAiGenerated: true,
    });
    expect(badEmail.ok).toBe(false);
    expect(badEmail.violations).toContain("unrendered_template_variable");
    expect(badEmail.violations).toContain("prohibited_claim");
    expect(badEmail.violations).toContain("missing_postal_address");
    expect(badEmail.violations).toContain("missing_unsubscribe_copy");
    expect(badEmail.violations).toContain("missing_rfc8058_headers");
    expect(badEmail.violations).toContain("missing_ai_disclosure");

    const goodEmail = lintComplianceCopy({
      channel: "email",
      subject: "NYC venue partnership with The Network",
      text: "Hello! Sent by The Network's AI Partnerships Coordinator. Reply or unsubscribe anytime. Eliza Research Corp, 228 Park Ave S, New York, NY 10003.",
      isCommercial: true,
      isAiGenerated: true,
      headers: {
        "List-Unsubscribe": "<https://ntwrk.party/api/unsubscribe?t=abc>, <mailto:unsub@ntwrk.party>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    expect(goodEmail.ok).toBe(true);
    expect(goodEmail.violations).toEqual([]);

    const badCreator = lintComplianceCopy({
      channel: "creator",
      text: "Check out this cool dating event in Soho",
      isCommercial: true,
      hasNativePaidToggle: false,
    });
    expect(badCreator.ok).toBe(false);
    expect(badCreator.violations).toContain("missing_ftc_disclosure");
    expect(badCreator.violations).toContain("missing_native_paid_toggle");
  });

  test("detects near-duplicate templates via 64-bit SimHash and catches unrendered vars", () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));
    const h1 = simHash64("Hey Alex, we are hosting a curated six person neighborhood dinner in SoHo this Thursday evening with warm introductions for local builders and creatives in New York.");
    const h2 = simHash64("Hey Jordan, we are hosting a curated six person neighborhood dinner in SoHo this Thursday evening with warm introductions for local builders and creatives in New York.");
    const h3 = simHash64("Completely different technical recruiting brief for Rust distributed systems engineers working on storage engines in Austin Texas.");
    expect(hammingDistance64(h1, h2)).toBeLessThanOrEqual(8);
    expect(hammingDistance64(h1, h3)).toBeGreaterThan(15);

    const guard = new TemplateEntropyGuard({ clock, maxHammingDistance: 3, maxNearDuplicates: 2 });
    const base = "We are hosting a curated neighborhood social salon near Washington Square Park this Friday night.";
    expect(guard.checkAndRecord("camp-1", base).ok).toBe(true);
    expect(guard.checkAndRecord("camp-1", base).ok).toBe(true);
    const blocked = guard.checkAndRecord("camp-1", base);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("near_duplicate_entropy_limit");

    const unrendered = guard.checkAndRecord("camp-1", "Hello {{NAME}} from NYC");
    expect(unrendered.ok).toBe(false);
    expect(unrendered.reason).toBe("unrendered_template_variable");
  });

  test("supports versioned HMAC key rotation, bidirectional delta sync, and fail-closed checks", () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));
    const keyV1 = { version: "v1", secret: "first-secret-key-at-least-32-bytes-long!" };
    const keyV2 = { version: "v2", secret: "second-secret-key-at-least-32-bytes-long" };

    const marketingSync = new SuppressionSync({ clock, keys: [keyV1] });
    const rec = marketingSync.suppress({
      kind: "phone",
      value: "(212) 555-0199",
      scope: "global",
      reason: "stop_keyword",
      source: "marketing_email",
    });
    expect(rec?.hash.startsWith("v1:")).toBe(true);
    expect(rec?.hash).toBe(versionedContactHmac("phone", "+12125550199", keyV1));

    const platformSync = new SuppressionSync({ clock, keys: [keyV2, keyV1] });
    expect(platformSync.check({ kind: "phone", value: "+12125550199", scope: "sms" }).suppressed).toBe(false);
    platformSync.mergeDelta(marketingSync.exportDelta(0));

    const hit = platformSync.check({ kind: "phone", value: "+12125550199", scope: "sms" });
    expect(hit.suppressed).toBe(true);
    expect(hit.failClosed).toBe(false);
    expect(hit.record?.scope).toBe("global");

    const noKeySync = new SuppressionSync({ clock, keys: [] });
    const closed = noKeySync.check({ kind: "email", value: "a@example.com" });
    expect(closed.suppressed).toBe(true);
    expect(closed.failClosed).toBe(true);
  });
});
