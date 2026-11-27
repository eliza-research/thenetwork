import { randomBytes } from "node:crypto";
import { RealClock, type Clock } from "../../../packages/core/src/clock.ts";
import {
  AnalyticsEngine,
  detectAnomalies,
  evaluateSafetyInvariants,
  exportScrubbedCsv,
} from "../../../packages/core/src/analytics/engine.ts";
import type {
  AnalyticsFilter,
  AnomalyAlert,
  AttributionModel,
  AttributionRow,
  CohortMatrix,
  FunnelEvent,
  FunnelResult,
  FunnelStage,
  MemberLifecycleRecord,
  OutreachHeatmap,
  OutreachTelemetryRecord,
  SafetyInvariantCounters,
  SliceQuery,
  SliceResult,
  TimeSeriesPoint,
} from "../../../packages/core/src/analytics/types.ts";
import { MemoryHotCache } from "../../../packages/core/src/analytics/cache.ts";
import {
  MemoryTrajectoryBlobStore,
  MemoryTrajectoryManifestStore,
  trajectoryBlobStoreFromEnv,
} from "../../../packages/core/src/trajectory/blob-store.ts";
import { MemoryTrajectoryKeyRing } from "../../../packages/core/src/trajectory/keyring.ts";
import type {
  DecryptedTrajectorySpan,
  TrajectoryBlobStore,
  TrajectoryManifestRow,
  TrajectoryQuery,
  TrajectorySpan,
  TrajectoryStorageDriver,
} from "../../../packages/core/src/trajectory/types.ts";
import { BufferedTrajectoryWriter } from "../../../packages/core/src/trajectory/writer.ts";
import type { UnifiedFunnelEvent } from "../../../packages/sim/src/unifiedWorld.ts";
import type { MarketingStore } from "./store.ts";
import type { AttributionEvent, OutreachMessage } from "./types.ts";

function mapAttributionToFunnelStage(kind: AttributionEvent["eventKind"]): FunnelStage | null {
  switch (kind) {
    case "outreach_sent":
      return "outreach_sent";
    case "outreach_replied":
    case "link_click":
      return "link_click";
    case "site_visit":
    case "qr_scan":
    case "video_view":
      return "site_visit";
    case "cta_triggered":
    case "signup_started":
      return "cta_triggered";
    case "signup_verified_adult":
      return "signup_verified";
    case "onboarding_completed":
      return "onboarding_completed";
    case "first_proposal_received":
    case "first_match_accepted":
    case "t3_match_verified":
    case "intro_or_hire_unlocked":
      return "first_proposal";
    case "irl_meeting_confirmed":
      return "first_irl_meeting";
    case "second_meetup_retained":
      return "retained_d30";
    default:
      return null;
  }
}

function mapSimStageToFunnelStage(stage: UnifiedFunnelEvent["stage"]): FunnelStage | null {
  switch (stage) {
    case "outreach_sent":
      return "outreach_sent";
    case "prospect_reply":
    case "link_click":
      return "link_click";
    case "site_visit":
    case "qr_scan":
      return "site_visit";
    case "signup_started":
      return "cta_triggered";
    case "signup_verified_adult":
      return "signup_verified";
    case "first_match_accepted":
      return "first_proposal";
    case "irl_meeting_confirmed":
      return "first_irl_meeting";
    case "second_meetup_retained":
      return "retained_d30";
    default:
      return null;
  }
}

export class MarketingAnalyticsRuntime {
  readonly clock: Clock;
  readonly cache: MemoryHotCache;
  readonly trajectoryWriter: BufferedTrajectoryWriter;
  readonly manifestStore: MemoryTrajectoryManifestStore;
  readonly driver: TrajectoryStorageDriver;

  private readonly store: MarketingStore;
  private readonly liveEvents: FunnelEvent[] = [];
  private readonly liveOutreach: OutreachTelemetryRecord[] = [];
  private readonly liveMembers = new Map<string, MemberLifecycleRecord>();
  private readonly safetyCounters: SafetyInvariantCounters = {
    canaryLeaks: 0,
    teenViolationContacts: 0,
    crossAppLeaks: 0,
    unverifiedAdultPayouts: 0,
  };

  constructor(opts: {
    store: MarketingStore;
    clock?: Clock;
    env?: Record<string, string | undefined>;
  }) {
    this.store = opts.store;
    this.clock = opts.clock ?? opts.store.clock ?? new RealClock();
    this.cache = new MemoryHotCache({ clock: this.clock, maxEntries: 128 });
    this.manifestStore = new MemoryTrajectoryManifestStore();

    const env = opts.env ?? process.env;
    let blobStore: TrajectoryBlobStore;
    try {
      if (env.TRAJECTORY_STORAGE) {
        blobStore = trajectoryBlobStoreFromEnv(env);
      } else {
        blobStore = new MemoryTrajectoryBlobStore();
      }
    } catch {
      blobStore = new MemoryTrajectoryBlobStore();
    }
    this.driver = blobStore.kind;
    const masterKey =
      env.TRAJECTORY_MASTER_KEY?.trim() ||
      randomBytes(32).toString("hex");
    const keyRing = new MemoryTrajectoryKeyRing(masterKey);

    this.trajectoryWriter = new BufferedTrajectoryWriter({
      blobStore,
      manifestStore: this.manifestStore,
      keyRing,
      clock: this.clock,
      workerId: "marketing-api",
      flushIntervalMs: 0,
      maxBatchSpans: 50,
    });
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  ingestFunnelEvent(ev: FunnelEvent): void {
    this.liveEvents.push(ev);
    if (this.liveEvents.length > 10_000) {
      this.liveEvents.splice(0, this.liveEvents.length - 10_000);
    }
    if (ev.stage === "signup_verified" || ev.stage === "first_irl_meeting" || ev.stage === "retained_d30") {
      const existing: MemberLifecycleRecord = this.liveMembers.get(ev.actorKey) ?? {
        memberKey: ev.actorKey,
        appId: ev.appId,
        city: ev.city,
        desireLane: ev.desireLane,
        channel: ev.channel,
        campaignId: ev.campaignId,
        ageBand: ev.ageBand ?? "18+",
        joinedAt: ev.occurredAt,
        activeDays: [0],
      };
      if (ev.stage === "first_irl_meeting") {
        existing.firstMeetingAt = existing.firstMeetingAt ?? ev.occurredAt;
        existing.firstMeetingEnjoyment = 4;
        if (!existing.activeDays.includes(7)) existing.activeDays.push(7);
      }
      if (ev.stage === "retained_d30") {
        if (!existing.activeDays.includes(30)) existing.activeDays.push(30);
      }
      this.liveMembers.set(ev.actorKey, existing);
      while (this.liveMembers.size > 10_000) {
        const oldest = this.liveMembers.keys().next().value;
        if (oldest === undefined) break;
        this.liveMembers.delete(oldest);
      }
    }
    this.cache.clear();
  }

  ingestSimFunnelEvent(ev: UnifiedFunnelEvent): void {
    const stage = mapSimStageToFunnelStage(ev.stage);
    if (!stage) return;
    this.ingestFunnelEvent({
      eventId: `sim-${ev.seq}`,
      actorKey: ev.memberId ?? ev.actorId ?? `sim-actor-${ev.seq}`,
      stage,
      occurredAt: ev.ts,
      appId: ev.app,
      city: ev.city,
      desireLane: ev.desireLane,
      channel: ev.platform,
      campaignId: ev.armId,
      isAdultVerified: ev.isAdultVerified,
      spendCents: ev.costCents,
    });
    if (ev.stage === "outreach_sent" || ev.stage === "prospect_reply" || ev.stage === "opt_out_stop") {
      const d = new Date(ev.ts);
      this.ingestOutreachTelemetry({
        occurredAt: ev.ts,
        appId: ev.app,
        city: ev.city,
        channel: ev.platform,
        campaignId: ev.armId,
        localDayOfWeek: d.getUTCDay(),
        localHour: d.getUTCHours(),
        sent: ev.stage === "outreach_sent" ? 1 : 0,
        delivered: ev.stage === "outreach_sent" ? 1 : 0,
        clicked: 0,
        replied: ev.stage === "prospect_reply" ? 1 : 0,
        converted: 0,
        stopped: ev.stage === "opt_out_stop" ? 1 : 0,
        bounced: 0,
        rateLimited429: 0,
      });
    }
  }

  ingestOutreachTelemetry(record: OutreachTelemetryRecord): void {
    this.liveOutreach.push(record);
    if (this.liveOutreach.length > 10_000) {
      this.liveOutreach.splice(0, this.liveOutreach.length - 10_000);
    }
    this.cache.clear();
  }

  private async buildEngine(): Promise<{
    engine: AnalyticsEngine;
    commitEntries: Array<{ campaignId: string; adapterId: string; amountCents: number; occurredAt: number }>;
  }> {
    const engine = new AnalyticsEngine({ clock: this.clock });
    const [attrEvents, outreachMsgs, budgetEntries] = await Promise.all([
      this.store.listAttributionEvents({ limit: 1_000 }),
      this.store.listOutreachMessages({ limit: 1_000 }),
      this.store.listBudgetEntries({ limit: 1_000 }),
    ]);

    const funnelEvents: FunnelEvent[] = [...this.liveEvents];
    for (const ev of attrEvents) {
      const stage = mapAttributionToFunnelStage(ev.eventKind);
      if (!stage) continue;
      const occurredAt = Date.parse(ev.createdAt) || this.clock.now();
      const count = Math.max(1, Math.min(20, ev.count));
      const baseActor =
        typeof ev.metadata.actorKey === "string" && ev.metadata.actorKey.trim()
          ? ev.metadata.actorKey.trim()
          : `attr-${ev.id}`;
      const channel =
        typeof ev.metadata.channel === "string" && ev.metadata.channel.trim()
          ? ev.metadata.channel.trim()
          : ev.qrBatchCode
            ? "qr"
            : "web";
      for (let i = 0; i < count; i += 1) {
        funnelEvents.push({
          eventId: `${ev.id}-${i}`,
          actorKey: count === 1 ? baseActor : `${baseActor}-${i}`,
          stage,
          occurredAt,
          appId: ev.appId,
          city: ev.city,
          desireLane: ev.desireLane ?? undefined,
          channel,
          campaignId: ev.campaignId,
          isAdultVerified: ev.eventKind === "signup_verified_adult" ? true : undefined,
        });
      }
    }

    const commitEntries = budgetEntries
      .filter((b) => b.entryType === "commit")
      .map((b) => ({
        campaignId: b.campaignId,
        adapterId: b.adapterId,
        amountCents: b.amountCents,
        occurredAt: Date.parse(b.createdAt) || this.clock.now(),
      }));

    const outreachRecords: OutreachTelemetryRecord[] = [...this.liveOutreach];
    for (const msg of outreachMsgs) {
      outreachRecords.push(this.outreachMsgToRecord(msg));
    }

    engine.ingestEvents(funnelEvents);
    engine.ingestOutreach(outreachRecords);
    engine.ingestMembers([...this.liveMembers.values()]);
    return { engine, commitEntries };
  }

  private outreachMsgToRecord(msg: OutreachMessage): OutreachTelemetryRecord {
    const ts = Date.parse(msg.createdAt) || this.clock.now();
    const d = new Date(ts);
    const isSent = msg.status === "sent" || msg.status === "delivered" || msg.status === "replied";
    return {
      occurredAt: ts,
      appId: "ntwrk",
      city: "nyc",
      channel: msg.channel,
      campaignId: msg.campaignId,
      personaId: msg.agentId,
      localDayOfWeek: d.getUTCDay(),
      localHour: d.getUTCHours(),
      sent: isSent ? 1 : 0,
      delivered: msg.status === "delivered" || msg.status === "replied" ? 1 : 0,
      clicked: 0,
      replied: msg.status === "replied" ? 1 : 0,
      converted: 0,
      stopped: msg.status === "blocked_stop" ? 1 : 0,
      bounced: msg.status === "bounced" ? 1 : 0,
      rateLimited429: 0,
    };
  }

  async getFunnel(filter: AnalyticsFilter = {}): Promise<FunnelResult> {
    const key = `funnel:${JSON.stringify(filter)}`;
    const cached = await this.cache.get<FunnelResult>(key);
    if (cached) return cached;
    const { engine } = await this.buildEngine();
    const res = engine.computeFunnel(filter);
    await this.cache.set(key, res, 5_000);
    return res;
  }

  async getCohorts(filter: AnalyticsFilter = {}): Promise<CohortMatrix> {
    const key = `cohorts:${JSON.stringify(filter)}`;
    const cached = await this.cache.get<CohortMatrix>(key);
    if (cached) return cached;
    const { engine } = await this.buildEngine();
    const res = engine.computeCohortMatrix(filter);
    await this.cache.set(key, res, 5_000);
    return res;
  }

  async getAttribution(
    model: AttributionModel = "last_touch",
    filter: AnalyticsFilter = {},
  ): Promise<{ model: AttributionModel; rows: AttributionRow[] }> {
    const key = `attr:${model}:${JSON.stringify(filter)}`;
    const cached = await this.cache.get<{ model: AttributionModel; rows: AttributionRow[] }>(key);
    if (cached) return cached;
    const { engine, commitEntries } = await this.buildEngine();
    const baseRows = engine.computeAttribution(filter, model);
    const spendByCampaign = new Map<string, number>();
    for (const entry of commitEntries) {
      if (filter.campaignId && entry.campaignId !== filter.campaignId) continue;
      if (filter.fromMs !== undefined && entry.occurredAt < filter.fromMs) continue;
      if (filter.toMs !== undefined && entry.occurredAt > filter.toMs) continue;
      spendByCampaign.set(
        entry.campaignId,
        (spendByCampaign.get(entry.campaignId) ?? 0) + entry.amountCents,
      );
    }
    const rows = baseRows.map((row) => {
      const extraSpend = spendByCampaign.get(row.campaignId) ?? 0;
      if (extraSpend <= 0) return row;
      const spendCents = row.spendCents + extraSpend;
      return {
        ...row,
        spendCents,
        cacCents: row.verifiedAdultSignups > 0 ? Math.round(spendCents / row.verifiedAdultSignups) : null,
        costPerMeetingCents: row.firstMeetings > 0 ? Math.round(spendCents / row.firstMeetings) : null,
      };
    });
    const res = { model, rows };
    await this.cache.set(key, res, 5_000);
    return res;
  }

  async getHeatmap(filter: AnalyticsFilter = {}): Promise<OutreachHeatmap> {
    const key = `heatmap:${JSON.stringify(filter)}`;
    const cached = await this.cache.get<OutreachHeatmap>(key);
    if (cached) return cached;
    const { engine } = await this.buildEngine();
    const res = engine.computeOutreachHeatmap(filter);
    await this.cache.set(key, res, 5_000);
    return res;
  }

  async getTimeSeries(
    granularity: "hour" | "day" | "week" = "day",
    filter: AnalyticsFilter = {},
  ): Promise<{
    granularity: "hour" | "day" | "week";
    series: {
      visits: TimeSeriesPoint[];
      signups: TimeSeriesPoint[];
      spendCents: TimeSeriesPoint[];
      cpaCents: TimeSeriesPoint[];
      meetings: TimeSeriesPoint[];
      stops: TimeSeriesPoint[];
    };
  }> {
    const { engine, commitEntries } = await this.buildEngine();
    const toPoints = (slice: SliceResult): TimeSeriesPoint[] =>
      slice.rows.map((r) => ({
        ts: Date.parse(r.bucket.length === 10 ? `${r.bucket}T00:00:00.000Z` : r.bucket) || this.clock.now(),
        label: r.bucket,
        value: r.value,
      }));
    const visits = toPoints(engine.slice({ metric: "site_visits", granularity, filter }));
    const signups = toPoints(engine.slice({ metric: "verified_signups", granularity, filter }));
    const spendMap = new Map<string, number>();
    for (const p of toPoints(engine.slice({ metric: "spend_cents", granularity, filter }))) {
      spendMap.set(p.label, (spendMap.get(p.label) ?? 0) + p.value);
    }
    const bucketFor = (ms: number): string => {
      const iso = new Date(ms).toISOString();
      if (granularity === "hour") return `${iso.slice(0, 13)}:00Z`;
      if (granularity === "week") {
        const d = new Date(ms);
        const offset = (d.getUTCDay() + 6) % 7;
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset))
          .toISOString()
          .slice(0, 10);
      }
      return iso.slice(0, 10);
    };
    for (const entry of commitEntries) {
      if (filter.campaignId && entry.campaignId !== filter.campaignId) continue;
      if (filter.fromMs !== undefined && entry.occurredAt < filter.fromMs) continue;
      if (filter.toMs !== undefined && entry.occurredAt > filter.toMs) continue;
      const b = bucketFor(entry.occurredAt);
      spendMap.set(b, (spendMap.get(b) ?? 0) + entry.amountCents);
    }
    const spendCents: TimeSeriesPoint[] = [...spendMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({
        ts: Date.parse(label.length === 10 ? `${label}T00:00:00.000Z` : label) || this.clock.now(),
        label,
        value,
      }));
    const meetings = toPoints(engine.slice({ metric: "irl_meetings", granularity, filter }));
    const stops = toPoints(engine.slice({ metric: "stop_rate", granularity, filter }));
    const signupByLabel = new Map(signups.map((p) => [p.label, p.value]));
    const cpaCents: TimeSeriesPoint[] = spendCents.map((p) => {
      const s = signupByLabel.get(p.label) ?? 0;
      return {
        ts: p.ts,
        label: p.label,
        value: s > 0 ? Math.round(p.value / s) : 0,
      };
    });
    return {
      granularity,
      series: { visits, signups, spendCents, cpaCents, meetings, stops },
    };
  }

  async getAnomalies(filter: AnalyticsFilter = {}): Promise<{
    alerts: AnomalyAlert[];
    safety: SafetyInvariantCounters;
  }> {
    const ts = await this.getTimeSeries("day", filter);
    const alerts: AnomalyAlert[] = [
      ...evaluateSafetyInvariants(this.safetyCounters, this.clock.now()),
      ...detectAnomalies(ts.series.signups, { metric: "verified_signups" }),
      ...detectAnomalies(ts.series.cpaCents, { metric: "cpa_cents" }),
      ...detectAnomalies(ts.series.stops, { metric: "stop_rate" }),
    ];
    return {
      alerts,
      safety: { ...this.safetyCounters },
    };
  }

  async querySlice(query: SliceQuery): Promise<SliceResult> {
    const { engine } = await this.buildEngine();
    return engine.slice(query);
  }

  exportSliceCsv(result: SliceResult): string {
    return exportScrubbedCsv(result);
  }

  async listTrajectories(filter: TrajectoryQuery = {}): Promise<{
    traces: TrajectoryManifestRow[];
    hotTail: TrajectorySpan[];
    driver: TrajectoryStorageDriver;
  }> {
    await this.trajectoryWriter.flush().catch(() => undefined);
    const traces = await this.manifestStore.query(filter);
    const hotTail = this.trajectoryWriter.tailHot({
      app: filter.appId,
      traceId: filter.traceId,
      entityId: filter.entityId,
      kind: filter.kind,
      status: filter.status,
      limit: filter.limit ?? 50,
    });
    return { traces, hotTail, driver: this.driver };
  }

  async readTrace(traceId: string, decrypt: boolean): Promise<{
    traceId: string;
    manifest: TrajectoryManifestRow | null;
    spans: DecryptedTrajectorySpan[];
  }> {
    await this.trajectoryWriter.flush().catch(() => undefined);
    const manifest = (await this.manifestStore.getByTraceId("marketing", traceId)) ?? null;
    const spans = await this.trajectoryWriter.readTrace("marketing", traceId, { decrypt });
    return { traceId, manifest, spans };
  }

  async shutdown(): Promise<void> {
    await this.trajectoryWriter.shutdown().catch(() => undefined);
  }
}
