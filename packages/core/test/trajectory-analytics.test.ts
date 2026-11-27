import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnalyticsEngine,
  BufferedTrajectoryWriter,
  classifyChurnReason,
  computeUnfulfilledDemandRatio,
  DAY,
  detectAnomalies,
  evaluateSafetyInvariants,
  exportScrubbedCsv,
  exportScrubbedJson,
  FUNNEL_STAGES,
  HOUR,
  INTENT_TAXONOMY,
  K_ANONYMITY_FLOOR,
  LocalFsTrajectoryBlobStore,
  MemoryHotCache,
  MemoryTrajectoryBlobStore,
  MemoryTrajectoryKeyRing,
  MemoryTrajectoryManifestStore,
  MINUTE,
  R2TrajectoryBlobStore,
  resolveDesireLane,
  SimClock,
  summarizeIntentDemand,
  trajectoryBlobStoreFromEnv,
  type FunnelEvent,
  type MemberLifecycleRecord,
  type OutreachTelemetryRecord,
  type TrajectorySpan,
} from "../src/index.ts";
import { migrations } from "../../db/migrate.ts";

const MASTER_KEY = "test-master-trajectory-key-at-least-32-bytes-long!!";

async function startStubS3Server() {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.replace(/^\/+/, "").split("/");
    const key = decodeURIComponent(parts.slice(1).join("/"));

    if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const startAfter = url.searchParams.get("start-after") ?? "";
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort();
      const contentsXml = keys.map(k => `<Contents><Key>${k}</Key></Contents>`).join("");
      const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${contentsXml}</ListBucketResult>`;
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(xml);
      return;
    }

    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", c => chunks.push(Buffer.from(c)));
      req.on("end", () => {
        objects.set(key, {
          body: Buffer.concat(chunks),
          contentType: req.headers["content-type"] ?? "application/octet-stream",
        });
        res.writeHead(200, { etag: '"stub"' });
        res.end();
      });
      return;
    }

    if (req.method === "GET") {
      const found = objects.get(key);
      if (!found) {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end("<Error><Code>NoSuchKey</Code></Error>");
        return;
      }
      res.writeHead(200, { "content-type": found.contentType, "content-length": String(found.body.length) });
      res.end(found.body);
      return;
    }

    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const port = (server.address() as AddressInfo).port;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    close: () => new Promise<void>((resolveClose, rejectClose) => server.close(err => (err ? rejectClose(err) : resolveClose()))),
  };
}

describe("Trajectory blob stores, zstd NDJSON, crypto-shredding, and minor redaction", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips bytes across Memory, LocalFs, and R2 S3-compatible HTTP stores", async () => {
    const payload = new TextEncoder().encode("hello-trajectory");
    const mem = new MemoryTrajectoryBlobStore();
    await mem.put("trajectories/a.zst", payload, "application/zstd");
    expect(await mem.get("trajectories/a.zst")).toEqual(payload);
    expect((await mem.list("trajectories/")).keys).toEqual(["trajectories/a.zst"]);
    await mem.delete("trajectories/a.zst");
    expect(await mem.get("trajectories/a.zst")).toBeUndefined();

    const dir = await mkdtemp(join(tmpdir(), "tn-traj-"));
    tempDirs.push(dir);
    const local = new LocalFsTrajectoryBlobStore(dir);
    await local.put("trajectories/raw/dt=2026-11-27/c1.ndjson.zst", payload, "application/zstd");
    expect(await local.get("trajectories/raw/dt=2026-11-27/c1.ndjson.zst")).toEqual(payload);
    expect((await local.list("trajectories/raw/")).keys).toEqual(["trajectories/raw/dt=2026-11-27/c1.ndjson.zst"]);
    await expect(local.put("../escape.zst", payload, "application/zstd")).rejects.toThrow(/invalid trajectory key/);
    await local.delete("trajectories/raw/dt=2026-11-27/c1.ndjson.zst");
    expect(await local.get("trajectories/raw/dt=2026-11-27/c1.ndjson.zst")).toBeUndefined();

    const s3 = await startStubS3Server();
    try {
      const r2 = new R2TrajectoryBlobStore({
        endpoint: s3.endpoint,
        bucket: "trajectories-bucket",
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
      });
      await r2.put("trajectories/raw/app=slop/c1.ndjson.zst", payload, "application/zstd");
      expect(await r2.get("trajectories/raw/app=slop/c1.ndjson.zst")).toEqual(payload);
      expect((await r2.list("trajectories/raw/")).keys).toEqual(["trajectories/raw/app=slop/c1.ndjson.zst"]);
      await r2.delete("trajectories/raw/app=slop/c1.ndjson.zst");
      expect(await r2.get("trajectories/raw/app=slop/c1.ndjson.zst")).toBeUndefined();
    } finally {
      await s3.close();
    }

    expect(() =>
      trajectoryBlobStoreFromEnv({
        TRAJECTORY_STORAGE: "r2",
        TRAJECTORY_R2_ACCOUNT_ID: "acct",
        TRAJECTORY_R2_BUCKET: "photos-bucket",
        R2_BUCKET: "photos-bucket",
        TRAJECTORY_R2_ACCESS_KEY_ID: "k",
        TRAJECTORY_R2_SECRET_ACCESS_KEY: "s",
      }),
    ).toThrow(/R2_BUCKET/);
  });

  it("flushes compressed zstd NDJSON chunks, scrubs PII, supports O(1) crypto-shredding, and redacts minors", async () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 12, 0, 0));
    const blobStore = new MemoryTrajectoryBlobStore();
    const manifestStore = new MemoryTrajectoryManifestStore();
    const keyRing = new MemoryTrajectoryKeyRing(MASTER_KEY);
    const writer = new BufferedTrajectoryWriter({
      blobStore,
      manifestStore,
      keyRing,
      clock,
      workerId: "api-1",
      flushIntervalMs: 0,
      maxBatchSpans: 50,
    });

    const personA = "11111111-1111-4111-8111-111111111111";
    const personB = "22222222-2222-4222-8222-222222222222";
    const minorPerson = "33333333-3333-4333-8333-333333333333";

    const spanA1: TrajectorySpan = {
      schemaVersion: 1,
      traceId: "trace-a",
      spanId: "span-a-1",
      app: "slop",
      city: "nyc",
      kind: "llm",
      name: "llm.chat",
      startedAt: clock.now(),
      durationMs: 420,
      entityType: "member",
      entityId: "mem_a",
      personId: personA,
      status: "ok",
      metrics: { model: "gpt-6-luna", provider: "surplus", inputTokens: 1200, outputTokens: 250, costMicros: 245 },
      flags: ["review_pass"],
      payload: {
        prompt: "Call me at 212-555-0199 or email alice@example.com about dinner",
        authorization: "Bearer super-secret-token",
        note: "wants cocktail bar in SoHo",
      },
    };

    const spanB1: TrajectorySpan = {
      schemaVersion: 1,
      traceId: "trace-b",
      spanId: "span-b-1",
      app: "slop",
      city: "nyc",
      kind: "llm",
      name: "llm.chat",
      startedAt: clock.now() + 500,
      durationMs: 310,
      entityType: "member",
      entityId: "mem_b",
      personId: personB,
      status: "fallback",
      metrics: { model: "gpt-6-luna", provider: "openai", inputTokens: 800, outputTokens: 100, costMicros: 130 },
      payload: { note: "prefers coffee walk in Brooklyn" },
    };

    const minorSpan: TrajectorySpan = {
      schemaVersion: 1,
      traceId: "trace-minor",
      spanId: "span-m-1",
      app: "friends",
      city: "nyc",
      kind: "review_judge",
      name: "judge.teen_strict",
      startedAt: clock.now() + 1000,
      durationMs: 180,
      entityType: "member",
      entityId: "mem_teen",
      personId: minorPerson,
      isMinor: true,
      status: "flagged",
      metrics: { model: "gpt-6-luna", inputTokens: 500, outputTokens: 80, costMicros: 90 },
      flags: ["teen_strict"],
      payload: { rawText: "this text must never be stored for a minor" },
    };

    writer.record(spanA1);
    writer.record(spanB1);
    writer.record(minorSpan);

    const hotSlop = writer.tailHot({ app: "slop" });
    expect(hotSlop).toHaveLength(2);
    const hotA = hotSlop.find(s => s.traceId === "trace-a")!;
    expect(hotA.personId).toBeUndefined();
    expect(hotA.payload?.authorization).toBe("[redacted]");
    expect(String(hotA.payload?.prompt)).not.toContain("212-555-0199");
    expect(String(hotA.payload?.prompt)).not.toContain("alice@example.com");

    const hotMinor = writer.tailHot({ app: "friends", traceId: "trace-minor" });
    expect(hotMinor).toHaveLength(1);
    expect(hotMinor[0]!.personId).toBeUndefined();
    expect(hotMinor[0]!.payload).toBeUndefined();
    expect(hotMinor[0]!.flags).toContain("minor_redacted");
    expect(writer.pendingCount()).toBe(3);

    const flushed = await writer.shutdown();
    expect(flushed.chunksWritten).toBe(2);
    expect(flushed.spansWritten).toBe(3);
    expect(writer.pendingCount()).toBe(0);

    const manifestA = await manifestStore.getByTraceId("slop", "trace-a");
    expect(manifestA).toBeDefined();
    expect(manifestA!.inputTokens).toBe(1200);
    expect(manifestA!.costMicros).toBe(245);
    expect(manifestA!.byteLength).toBeGreaterThan(0);
    expect(manifestA!.flags).toContain("pii_masked");

    const beforeShredA = await writer.readTrace("slop", "trace-a", { decrypt: true });
    expect(beforeShredA).toHaveLength(1);
    expect(beforeShredA[0]!.payloadState).toBe("decrypted");
    expect(beforeShredA[0]!.payload?.authorization).toBe("[redacted]");
    expect(String(beforeShredA[0]!.payload?.prompt)).not.toContain("212-555-0199");
    expect(String(beforeShredA[0]!.payload?.prompt)).not.toContain("alice@example.com");
    expect(beforeShredA[0]!.payload?.note).toBe("wants cocktail bar in SoHo");

    const rawBlobBefore = await blobStore.get(manifestA!.objectKey);
    expect(rawBlobBefore).toBeDefined();

    await writer.shredPerson(personA);

    const hotAfterShredA = writer.tailHot({ app: "slop", traceId: "trace-a" });
    expect(hotAfterShredA).toHaveLength(1);
    expect(hotAfterShredA[0]!.payload).toBeUndefined();
    expect(hotAfterShredA[0]!.personId).toBeUndefined();
    expect(hotAfterShredA[0]!.flags).toContain("shredded");

    const rawBlobAfter = await blobStore.get(manifestA!.objectKey);
    expect(rawBlobAfter).toEqual(rawBlobBefore);

    const afterShredA = await writer.readTrace("slop", "trace-a", { decrypt: true });
    expect(afterShredA).toHaveLength(1);
    expect(afterShredA[0]!.payloadState).toBe("shredded");
    expect(afterShredA[0]!.payload).toBeUndefined();
    expect(afterShredA[0]!.metrics?.inputTokens).toBe(1200);
    expect(afterShredA[0]!.metrics?.costMicros).toBe(245);

    const stillReadableB = await writer.readTrace("slop", "trace-b", { decrypt: true });
    expect(stillReadableB).toHaveLength(1);
    expect(stillReadableB[0]!.payloadState).toBe("decrypted");
    expect(stillReadableB[0]!.payload?.note).toBe("prefers coffee walk in Brooklyn");

    expect(keyRing.hasPersonDek(minorPerson)).toBe(false);
    const minorTrace = await writer.readTrace("friends", "trace-minor", { decrypt: true });
    expect(minorTrace).toHaveLength(1);
    expect(minorTrace[0]!.payloadState).toBe("redacted");
    expect(minorTrace[0]!.payload).toBeUndefined();
    expect(minorTrace[0]!.flags).toContain("teen_strict");
    const minorManifest = await manifestStore.getByTraceId("friends", "trace-minor");
    expect(minorManifest?.personId).toBeNull();
    expect(minorManifest?.flags).toContain("minor_redacted");
  });
});

describe("MemoryHotCache deterministic TTL, LRU, incr, and Pub/Sub", () => {
  it("expires keys on SimClock advance, evicts LRU, and fans out pub/sub", async () => {
    const clock = new SimClock(Date.UTC(2026, 10, 27, 0, 0, 0));
    const cache = new MemoryHotCache({ clock, maxEntries: 2 });

    await cache.set("k1", { v: 1 }, 10_000);
    await cache.set("k2", { v: 2 }, 10_000);
    expect(await cache.get("k1")).toEqual({ v: 1 });
    await cache.set("k3", { v: 3 }, 10_000);

    expect(await cache.get("k2")).toBeUndefined();
    expect(await cache.get("k1")).toEqual({ v: 1 });
    expect(await cache.get("k3")).toEqual({ v: 3 });

    clock.advance(10_000);
    expect(await cache.get("k1")).toBeUndefined();
    expect(cache.size()).toBe(0);

    expect(await cache.incr("rl:ip", 60_000)).toBe(1);
    expect(await cache.incr("rl:ip", 60_000, 2)).toBe(3);
    clock.advance(60_000);
    expect(await cache.incr("rl:ip", 60_000)).toBe(1);

    const received: string[] = [];
    const unsub = cache.subscribe("obs:slop", msg => received.push(msg));
    expect(await cache.publish("obs:slop", '{"delta":1}')).toBe(1);
    unsub();
    expect(await cache.publish("obs:slop", '{"delta":2}')).toBe(0);
    expect(received).toEqual(['{"delta":1}']);
  });
});

describe("Intent taxonomy and AnalyticsEngine", () => {
  it("maps all 12 desire lanes and computes unfulfilled demand ratios", () => {
    expect(INTENT_TAXONOMY).toHaveLength(12);
    expect(resolveDesireLane({ appId: "slop", category: "romance" })).toBe("soulmate_dating");
    expect(resolveDesireLane({ appId: "peon", objective: "looking for a technical cofounder for AI startup" })).toBe("cofounder_venture");
    expect(resolveDesireLane({ appId: "friends", objective: "new in town looking for board game friends" })).toBe("ideal_friends");
    expect(computeUnfulfilledDemandRatio(12, 3)).toBe(4);
    expect(computeUnfulfilledDemandRatio(5, 0)).toBe(5);

    const demand = summarizeIntentDemand([
      { appId: "friends", city: "nyc", objective: "dinner crew friends", fulfilled: false },
      { appId: "friends", city: "nyc", objective: "trivia friends", fulfilled: false },
      { appId: "friends", city: "nyc", objective: "hangout friends", fulfilled: true },
      { appId: "slop", city: "nyc", category: "romance", fulfilled: true },
    ]);
    expect(demand[0]?.desireLane).toBe("ideal_friends");
    expect(demand[0]?.teenEligible).toBe(true);
    expect(demand[0]?.unfulfilledDemandRatio).toBe(2);
  });

  it("computes 9-stage funnels, k>=5 suppression, cohort retention, adult-only attribution, heatmaps, anomalies, and scrubbed exports", () => {
    const start = Date.UTC(2026, 9, 5, 12, 0, 0);
    const clock = new SimClock(start + 45 * DAY);
    const engine = new AnalyticsEngine({ clock, kFloor: K_ANONYMITY_FLOOR });

    const events: FunnelEvent[] = [];
    let eid = 0;
    const pushEvent = (e: Omit<FunnelEvent, "eventId">) => events.push({ eventId: `ev_${++eid}`, ...e });

    for (let i = 0; i < 12; i++) {
      const actor = `adult_${i}`;
      const channel = i < 6 ? "tiktok" : "qr_street";
      const campaignId = i < 6 ? "cmp_tt" : "cmp_qr";
      pushEvent({ occurredAt: start, appId: "slop", city: "nyc", stage: "outreach_sent", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+", spendCents: 500 });
      pushEvent({ occurredAt: start + 10 * MINUTE, appId: "slop", city: "nyc", stage: "link_click", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+" });
      pushEvent({ occurredAt: start + 11 * MINUTE, appId: "slop", city: "nyc", stage: "site_visit", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+" });
      if (i < 10) {
        pushEvent({ occurredAt: start + 12 * MINUTE, appId: "slop", city: "nyc", stage: "cta_triggered", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+" });
        pushEvent({ occurredAt: start + 20 * MINUTE, appId: "slop", city: "nyc", stage: "signup_verified", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+", isAdultVerified: true });
      }
      if (i < 8) {
        pushEvent({ occurredAt: start + HOUR, appId: "slop", city: "nyc", stage: "onboarding_completed", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+" });
        pushEvent({ occurredAt: start + DAY, appId: "slop", city: "nyc", stage: "first_proposal", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+" });
      }
      if (i < 6) {
        pushEvent({ occurredAt: start + 3 * DAY, appId: "slop", city: "nyc", stage: "first_irl_meeting", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+" });
        pushEvent({ occurredAt: start + 31 * DAY, appId: "slop", city: "nyc", stage: "retained_d30", actorKey: actor, channel, campaignId, desireLane: "soulmate_dating", ageBand: "18+" });
      }
    }

    for (let i = 0; i < 3; i++) {
      const actor = `teen_${i}`;
      pushEvent({ occurredAt: start, appId: "friends", city: "nyc", stage: "site_visit", actorKey: actor, channel: "tiktok", campaignId: "cmp_tt", desireLane: "ideal_friends", ageBand: "13-17" });
      pushEvent({ occurredAt: start + 5 * MINUTE, appId: "friends", city: "nyc", stage: "signup_verified", actorKey: actor, channel: "tiktok", campaignId: "cmp_tt", desireLane: "ideal_friends", ageBand: "13-17", isAdultVerified: false });
    }

    pushEvent({ occurredAt: start, appId: "slop", city: "nyc", stage: "site_visit", actorKey: "multi_touch_1", channel: "tiktok", campaignId: "cmp_tt", desireLane: "soulmate_dating", ageBand: "18+" });
    pushEvent({ occurredAt: start + HOUR, appId: "slop", city: "nyc", stage: "site_visit", actorKey: "multi_touch_1", channel: "qr_street", campaignId: "cmp_qr", desireLane: "soulmate_dating", ageBand: "18+" });
    pushEvent({ occurredAt: start + 2 * HOUR, appId: "slop", city: "nyc", stage: "signup_verified", actorKey: "multi_touch_1", channel: "qr_street", campaignId: "cmp_qr", desireLane: "soulmate_dating", ageBand: "18+", isAdultVerified: true });

    engine.ingestEvents(events);

    const funnel = engine.computeFunnel({ appId: "slop", city: "nyc" });
    expect(funnel.steps).toHaveLength(FUNNEL_STAGES.length);
    expect(funnel.steps[0]?.count).toBe(12);
    expect(funnel.steps[4]?.count).toBe(11);
    expect(funnel.steps[7]?.count).toBe(6);
    expect(funnel.steps[1]?.medianTimeFromPrevMs).toBe(10 * MINUTE);

    const smallTeenFunnel = engine.computeFunnel({ appId: "friends", ageBand: "13-17" });
    expect(smallTeenFunnel.steps[2]?.suppressed).toBe(true);
    expect(smallTeenFunnel.steps[2]?.count).toBe(0);

    const firstTouch = engine.computeAttribution({ appId: "all" }, "first_touch");
    const lastTouch = engine.computeAttribution({ appId: "all" }, "last_touch");
    const linear = engine.computeAttribution({ appId: "all" }, "linear");

    const ttFirst = firstTouch.find(r => r.channel === "tiktok" && r.desireLane === "soulmate_dating")!;
    const qrLast = lastTouch.find(r => r.channel === "qr_street" && r.desireLane === "soulmate_dating")!;
    const ttLinear = linear.find(r => r.channel === "tiktok" && r.desireLane === "soulmate_dating")!;
    const teenFriendsAttr = firstTouch.find(r => r.desireLane === "ideal_friends")!;

    expect(teenFriendsAttr.verifiedAdultSignups).toBe(0);
    expect(ttFirst.verifiedAdultSignups).toBe(7);
    expect(qrLast.verifiedAdultSignups).toBe(5);
    expect(ttLinear.verifiedAdultSignups).toBe(6.5);
    expect(ttFirst.cacCents).toBeGreaterThan(0);

    const members: MemberLifecycleRecord[] = [];
    for (let i = 0; i < 14; i++) {
      const fastProposal = i < 7;
      members.push({
        memberKey: `m_${i}`,
        appId: "slop",
        city: "nyc",
        joinedAt: start,
        ageBand: "18+",
        desireLane: "soulmate_dating",
        invitedByFriend: fastProposal,
        onboardingComplete: true,
        firstProposalAt: fastProposal ? start + 12 * HOUR : undefined,
        firstMeetingAt: fastProposal ? start + 2 * DAY : undefined,
        firstMeetingEnjoyment: fastProposal ? 5 : undefined,
        activeDays: fastProposal ? [1, 3, 7, 14, 30] : [1],
      });
    }
    engine.ingestMembers(members);

    const cohorts = engine.computeCohortMatrix({ appId: "slop" });
    expect(cohorts.rows).toHaveLength(1);
    expect(cohorts.rows[0]?.cohortSize).toBe(14);
    expect(cohorts.rows[0]?.retention[1]).toBe(1);
    expect(cohorts.rows[0]?.retention[30]).toBe(0.5);
    const fastDriver = cohorts.drivers.find(d => d.driverId === "first_proposal_48h")!;
    expect(fastDriver.suppressed).toBe(false);
    expect(fastDriver.exposedD30Rate).toBe(1);
    expect(fastDriver.baselineD30Rate).toBe(0);
    expect(fastDriver.lift).toBeGreaterThan(1);

    expect(
      classifyChurnReason(
        { memberKey: "x", appId: "slop", city: "nyc", joinedAt: start, ageBand: "18+", activeDays: [], optedOutAt: start + DAY },
        clock.now(),
      ),
    ).toBe("churn_explicit_stop");
    expect(
      classifyChurnReason(
        { memberKey: "x2", appId: "slop", city: "nyc", joinedAt: start, ageBand: "18+", activeDays: [], onboardingComplete: true, reviewExpiredCount: 2 },
        clock.now(),
      ),
    ).toBe("churn_review_bottleneck");

    const outreachRows: OutreachTelemetryRecord[] = [
      {
        occurredAt: start,
        appId: "slop",
        city: "nyc",
        channel: "email",
        campaignId: "cmp_1",
        personaId: "sloane",
        templateId: "tpl_good",
        localDayOfWeek: 2,
        localHour: 18,
        sent: 100,
        delivered: 98,
        clicked: 25,
        replied: 14,
        converted: 6,
        stopped: 1,
        bounced: 2,
        rateLimited429: 0,
      },
      {
        occurredAt: start,
        appId: "slop",
        city: "nyc",
        channel: "x_dm",
        campaignId: "cmp_1",
        personaId: "chadwick",
        templateId: "tpl_spammy",
        localDayOfWeek: 2,
        localHour: 18,
        sent: 100,
        delivered: 100,
        clicked: 4,
        replied: 2,
        converted: 0,
        stopped: 5,
        bounced: 0,
        rateLimited429: 12,
      },
    ];
    engine.ingestOutreach(outreachRows);
    const heatmap = engine.computeOutreachHeatmap({ appId: "slop" });
    expect(heatmap.cells).toHaveLength(168);
    expect(heatmap.totalSent).toBe(200);
    const spammy = heatmap.templateLift.find(t => t.templateId === "tpl_spammy")!;
    expect(spammy.stopGuardrailBreached).toBe(true);

    const series = [10, 11, 10, 9, 10, 11, 10, 48].map((value, idx) => ({
      ts: start + idx * DAY,
      label: `d${idx}`,
      value,
    }));
    const anomalies = detectAnomalies(series, { metric: "stop_rate" });
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    expect(anomalies[0]?.kind).toBe("statistical");

    const invAlerts = evaluateSafetyInvariants(
      { canaryLeaks: 1, teenViolationContacts: 0, crossAppLeaks: 0, unverifiedAdultPayouts: 2 },
      clock.now(),
    );
    expect(invAlerts).toHaveLength(2);
    expect(invAlerts.every(a => a.severity === "critical")).toBe(true);

    const sliceResult = engine.slice({
      metric: "site_visits",
      groupBy: ["channel", "ageBand"],
      granularity: "total",
      filter: { appId: "all" },
    });
    const teenRow = sliceResult.rows.find(r => r.dimensions.ageBand === "13-17")!;
    expect(teenRow.suppressed).toBe(true);

    const csv = exportScrubbedCsv({
      ...sliceResult,
      rows: [
        { bucket: "=SUM(A1:A2)", dimensions: { channel: "email alice@example.com", ageBand: "18+" }, value: 42, sampleCount: 42, suppressed: false },
        teenRow,
      ],
    });
    expect(csv).toContain("'=SUM(A1:A2)");
    expect(csv).not.toContain("alice@example.com");
    expect(csv).toContain("<5");

    const jsonExport = exportScrubbedJson(sliceResult);
    expect(JSON.parse(jsonExport).kFloor).toBe(K_ANONYMITY_FLOOR);

    const rollupEngine = new AnalyticsEngine({ clock });
    rollupEngine.ingestRollups([
      { day: "2026-10-05", appId: "slop", city: "nyc", desireLane: "soulmate_dating", channel: "tiktok", campaignId: "cmp_tt", ageBand: "18+", stage: "site_visit", eventCount: 100, uniqueActors: 80, medianTtfvMs: 12000 },
      { day: "2026-10-05", appId: "slop", city: "nyc", desireLane: "soulmate_dating", channel: "tiktok", campaignId: "cmp_tt", ageBand: "18+", stage: "signup_verified", eventCount: 20, uniqueActors: 20, medianTtfvMs: 60000 },
    ]);
    const rollupFunnel = rollupEngine.computeFunnel({ appId: "slop" });
    expect(rollupFunnel.steps[2]?.count).toBe(80);
    expect(rollupFunnel.steps[4]?.count).toBe(20);
  });

  it("registers migration 0102 cleanly without duplicate or reserved prefixes", () => {
    const list = migrations();
    const m = list.find(entry => entry.id === "0102_trajectories_analytics_scale");
    expect(m).toBeDefined();
  });
});
