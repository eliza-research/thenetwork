import { DAY, HOUR, type Clock } from "../clock.ts";
import { maskPii } from "../pii.ts";
import {
  CHURN_REASON_CODES,
  COHORT_HORIZONS,
  FUNNEL_STAGES,
  K_ANONYMITY_FLOOR,
  type AnalyticsFilter,
  type AnomalyAlert,
  type AttributionModel,
  type AttributionRow,
  type ChurnReasonCode,
  type CohortHorizonDay,
  type CohortMatrix,
  type CohortRow,
  type DailyRollupRow,
  type DropOffReasonCount,
  type FunnelEvent,
  type FunnelResult,
  type FunnelStage,
  type FunnelStep,
  type MemberLifecycleRecord,
  type OutreachHeatmap,
  type OutreachHeatmapCell,
  type OutreachTelemetryRecord,
  type OutreachTemplateLift,
  type RetentionDriver,
  type SafetyInvariantCounters,
  type SliceDimension,
  type SliceGranularity,
  type SliceQuery,
  type SliceResult,
  type SliceRow,
  type TimeSeriesPoint,
} from "./types.ts";

const STOP_RATE_GUARDRAIL = 0.02;

function effectiveKFloor(requested?: number): number {
  return Math.max(K_ANONYMITY_FLOOR, requested ?? K_ANONYMITY_FLOOR);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function isoWeekStart(ms: number): string {
  const date = new Date(ms);
  const day = date.getUTCDay();
  const offset = (day + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
  return monday.toISOString().slice(0, 10);
}

function timeBucket(ms: number, granularity: SliceGranularity): string {
  if (granularity === "total") return "all";
  const iso = new Date(ms).toISOString();
  if (granularity === "hour") return `${iso.slice(0, 13)}:00Z`;
  if (granularity === "day") return iso.slice(0, 10);
  return isoWeekStart(ms);
}

function matchesFilter(
  item: {
    occurredAt: number;
    appId: string;
    city: string;
    desireLane?: string;
    channel?: string;
    campaignId?: string;
    entrySurface?: string;
    ageBand?: string;
  },
  filter: AnalyticsFilter,
): boolean {
  if (filter.appId && filter.appId !== "all" && item.appId !== filter.appId) return false;
  if (filter.city && item.city !== filter.city) return false;
  if (filter.desireLane && item.desireLane !== filter.desireLane) return false;
  if (filter.channel && item.channel !== filter.channel) return false;
  if (filter.campaignId && item.campaignId !== filter.campaignId) return false;
  if (filter.entrySurface && item.entrySurface !== filter.entrySurface) return false;
  if (filter.ageBand && item.ageBand !== filter.ageBand) return false;
  if (filter.fromMs !== undefined && item.occurredAt < filter.fromMs) return false;
  if (filter.toMs !== undefined && item.occurredAt > filter.toMs) return false;
  return true;
}

export function classifyChurnReason(member: MemberLifecycleRecord, nowMs: number): ChurnReasonCode {
  if (member.optedOutAt !== undefined) return "churn_explicit_stop";
  if (member.onboardingComplete === false && nowMs - member.joinedAt > 2 * DAY) {
    return "drop_onboarding_stall";
  }
  if (member.firstMeetingAt !== undefined && member.firstMeetingEnjoyment !== undefined && member.firstMeetingEnjoyment < 3) {
    return "churn_poor_first_meetup";
  }
  if ((member.unansweredProactive ?? 0) >= 2) {
    return "churn_two_unanswered_fatigue";
  }
  if ((member.bookedCancelledCount ?? 0) > 0 && member.firstMeetingAt === undefined) {
    return "churn_scheduling_friction";
  }
  if ((member.reviewExpiredCount ?? 0) > 0 && member.firstProposalAt === undefined) {
    return "churn_review_bottleneck";
  }
  if (member.firstProposalAt === undefined && nowMs - member.joinedAt >= 7 * DAY) {
    return "churn_cold_start_no_match";
  }
  if (member.firstMeetingAt !== undefined && (member.firstMeetingEnjoyment ?? 4) >= 4) {
    return "retained_core_value";
  }
  const hasRecentActivity = member.activeDays.some(d => d >= 7);
  return hasRecentActivity ? "retained_core_value" : "churn_cold_start_no_match";
}

export function evaluateSafetyInvariants(counters: SafetyInvariantCounters, nowMs: number): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];
  if (counters.canaryLeaks > 0) {
    alerts.push({
      id: `inv-canary-${nowMs}`,
      kind: "invariant",
      severity: "critical",
      metric: "canary_leaks",
      message: `Canary leak detected (${counters.canaryLeaks})`,
      observed: counters.canaryLeaks,
      expected: 0,
      zScore: Infinity,
      at: nowMs,
    });
  }
  if (counters.teenViolationContacts > 0) {
    alerts.push({
      id: `inv-teen-${nowMs}`,
      kind: "invariant",
      severity: "critical",
      metric: "teen_violation_contacts",
      message: `Minor policy contact violation (${counters.teenViolationContacts})`,
      observed: counters.teenViolationContacts,
      expected: 0,
      zScore: Infinity,
      at: nowMs,
    });
  }
  if (counters.crossAppLeaks > 0) {
    alerts.push({
      id: `inv-crossapp-${nowMs}`,
      kind: "invariant",
      severity: "critical",
      metric: "cross_app_leaks",
      message: `Cross-app leak detected (${counters.crossAppLeaks})`,
      observed: counters.crossAppLeaks,
      expected: 0,
      zScore: Infinity,
      at: nowMs,
    });
  }
  if (counters.unverifiedAdultPayouts > 0) {
    alerts.push({
      id: `inv-payout-${nowMs}`,
      kind: "invariant",
      severity: "critical",
      metric: "unverified_adult_payouts",
      message: `Unverified adult payout attempt (${counters.unverifiedAdultPayouts})`,
      observed: counters.unverifiedAdultPayouts,
      expected: 0,
      zScore: Infinity,
      at: nowMs,
    });
  }
  return alerts;
}

export function detectAnomalies(
  series: readonly TimeSeriesPoint[],
  options: { metric: string; alpha?: number; zThreshold?: number; minWindow?: number },
): AnomalyAlert[] {
  const alpha = options.alpha ?? 0.3;
  const zThreshold = options.zThreshold ?? 3.0;
  const minWindow = Math.max(3, options.minWindow ?? 5);
  if (series.length <= minWindow) return [];

  const sorted = [...series].sort((a, b) => a.ts - b.ts);
  let ewma = sorted[0]!.value;
  const alerts: AnomalyAlert[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const point = sorted[i]!;
    if (i >= minWindow) {
      const windowSlice = sorted.slice(Math.max(0, i - 14), i).map(p => p.value);
      const mean = windowSlice.reduce((sum, v) => sum + v, 0) / windowSlice.length;
      const variance = windowSlice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / windowSlice.length;
      const stdDev = Math.sqrt(variance);
      const expected = 0.5 * ewma + 0.5 * mean;
      const denominator = stdDev > 1e-9 ? stdDev : Math.max(1e-6, Math.abs(expected) * 0.05);
      const zScore = (point.value - expected) / denominator;

      if (Math.abs(zScore) >= zThreshold) {
        alerts.push({
          id: `anom-${options.metric}-${point.ts}`,
          kind: "statistical",
          severity: Math.abs(zScore) >= zThreshold + 1.5 ? "critical" : "warn",
          metric: options.metric,
          message: `${options.metric} deviated ${zScore > 0 ? "above" : "below"} baseline (${point.value} vs ${round4(expected)}, z=${round4(zScore)})`,
          observed: point.value,
          expected: round4(expected),
          zScore: round4(zScore),
          at: point.ts,
        });
      }
    }
    ewma = alpha * point.value + (1 - alpha) * ewma;
  }

  return alerts;
}

function sanitizeCsvCell(raw: unknown): string {
  const text = maskPii(String(raw ?? ""));
  const formulaSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(formulaSafe)) {
    return `"${formulaSafe.replaceAll('"', '""')}"`;
  }
  return formulaSafe;
}

export function exportScrubbedCsv(result: SliceResult): string {
  const headers = ["bucket", ...result.groupBy, "value", "sample_count", "suppressed"];
  const lines = [headers.join(",")];
  for (const row of result.rows) {
    const cells = [
      row.bucket,
      ...result.groupBy.map(dim => row.dimensions[dim] ?? "unknown"),
      row.suppressed ? "<5" : row.value,
      row.suppressed ? "<5" : row.sampleCount,
      row.suppressed ? "true" : "false",
    ];
    lines.push(cells.map(sanitizeCsvCell).join(","));
  }
  return lines.join("\n");
}

export function exportScrubbedJson(result: SliceResult): string {
  const scrubbed: SliceResult = {
    ...result,
    rows: result.rows.map(row => ({
      bucket: maskPii(row.bucket),
      dimensions: Object.fromEntries(Object.entries(row.dimensions).map(([k, v]) => [k, maskPii(v)])),
      value: row.suppressed ? 0 : row.value,
      sampleCount: row.suppressed ? 0 : row.sampleCount,
      suppressed: row.suppressed,
    })),
  };
  return JSON.stringify(scrubbed, null, 2);
}

export interface AnalyticsEngineOptions {
  clock: Clock;
  kFloor?: number;
}

export class AnalyticsEngine {
  private readonly clock: Clock;
  private readonly defaultKFloor: number;
  private readonly events: FunnelEvent[] = [];
  private readonly rollups: DailyRollupRow[] = [];
  private readonly members: MemberLifecycleRecord[] = [];
  private readonly outreach: OutreachTelemetryRecord[] = [];

  constructor(options: AnalyticsEngineOptions) {
    this.clock = options.clock;
    this.defaultKFloor = effectiveKFloor(options.kFloor);
  }

  ingestEvents(items: readonly FunnelEvent[]): void {
    for (const item of items) this.events.push(item);
  }

  ingestRollups(rows: readonly DailyRollupRow[]): void {
    for (const row of rows) this.rollups.push(row);
  }

  ingestMembers(items: readonly MemberLifecycleRecord[]): void {
    for (const item of items) this.members.push(item);
  }

  ingestOutreach(items: readonly OutreachTelemetryRecord[]): void {
    for (const item of items) this.outreach.push(item);
  }

  clear(): void {
    this.events.length = 0;
    this.rollups.length = 0;
    this.members.length = 0;
    this.outreach.length = 0;
  }

  computeFunnel(filter: AnalyticsFilter = {}): FunnelResult {
    const kFloor = effectiveKFloor(filter.kFloor ?? this.defaultKFloor);
    const sensitiveSlice = Boolean(filter.ageBand || filter.city || filter.desireLane);

    if (this.events.length === 0 && this.rollups.length > 0) {
      return this.computeFunnelFromRollups(filter, kFloor, sensitiveSlice);
    }

    const filtered = this.events.filter(e => matchesFilter(e, filter));
    const actorStages = new Map<string, Map<FunnelStage, number>>();
    const dropOffCounts = new Map<ChurnReasonCode, number>();

    for (const e of filtered) {
      let stageMap = actorStages.get(e.actorKey);
      if (!stageMap) {
        stageMap = new Map();
        actorStages.set(e.actorKey, stageMap);
      }
      const existing = stageMap.get(e.stage);
      if (existing === undefined || e.occurredAt < existing) {
        stageMap.set(e.stage, e.occurredAt);
      }
      if (e.churnReason) {
        dropOffCounts.set(e.churnReason, (dropOffCounts.get(e.churnReason) ?? 0) + 1);
      }
    }

    const nowMs = this.clock.now();
    const filteredMembers = this.members.filter(m =>
      matchesFilter({ occurredAt: m.joinedAt, appId: m.appId, city: m.city, desireLane: m.desireLane, channel: m.channel, campaignId: m.campaignId, ageBand: m.ageBand }, filter),
    );
    for (const member of filteredMembers) {
      const reason = classifyChurnReason(member, nowMs);
      dropOffCounts.set(reason, (dropOffCounts.get(reason) ?? 0) + 1);
    }

    const counts = new Map<FunnelStage, number>();
    const deltas = new Map<FunnelStage, number[]>();
    for (const stage of FUNNEL_STAGES) {
      counts.set(stage, 0);
      deltas.set(stage, []);
    }

    for (const stageMap of actorStages.values()) {
      for (let idx = 0; idx < FUNNEL_STAGES.length; idx++) {
        const stage = FUNNEL_STAGES[idx]!;
        const at = stageMap.get(stage);
        if (at === undefined) continue;
        counts.set(stage, (counts.get(stage) ?? 0) + 1);
        if (idx > 0) {
          const prevStage = FUNNEL_STAGES[idx - 1]!;
          const prevAt = stageMap.get(prevStage);
          if (prevAt !== undefined && at >= prevAt) {
            deltas.get(stage)!.push(at - prevAt);
          }
        }
      }
    }

    const firstNonZero = FUNNEL_STAGES.map(s => counts.get(s) ?? 0).find(c => c > 0) ?? 0;
    const steps: FunnelStep[] = FUNNEL_STAGES.map((stage, idx) => {
      const rawCount = counts.get(stage) ?? 0;
      const prevRaw = idx > 0 ? (counts.get(FUNNEL_STAGES[idx - 1]!) ?? 0) : rawCount;
      const suppressed = sensitiveSlice && rawCount > 0 && rawCount < kFloor;
      return {
        stage,
        count: suppressed ? 0 : rawCount,
        suppressed,
        conversionFromPrev: suppressed || prevRaw === 0 ? 0 : round4(rawCount / prevRaw),
        conversionFromStart: suppressed || firstNonZero === 0 ? 0 : round4(rawCount / firstNonZero),
        medianTimeFromPrevMs: suppressed ? null : median(deltas.get(stage)!),
      };
    });

    const totalDrops = [...dropOffCounts.values()].reduce((s, n) => s + n, 0);
    const dropOffReasons: DropOffReasonCount[] = CHURN_REASON_CODES
      .filter(code => (dropOffCounts.get(code) ?? 0) > 0)
      .map(reason => {
        const raw = dropOffCounts.get(reason) ?? 0;
        const suppressed = sensitiveSlice && raw < kFloor;
        return {
          reason,
          count: suppressed ? 0 : raw,
          share: suppressed || totalDrops === 0 ? 0 : round4(raw / totalDrops),
          suppressed,
        };
      })
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

    return { steps, dropOffReasons, totalActors: actorStages.size, kFloor };
  }

  private computeFunnelFromRollups(filter: AnalyticsFilter, kFloor: number, sensitiveSlice: boolean): FunnelResult {
    const counts = new Map<FunnelStage, number>();
    const medians = new Map<FunnelStage, number[]>();
    for (const s of FUNNEL_STAGES) {
      counts.set(s, 0);
      medians.set(s, []);
    }
    for (const row of this.rollups) {
      const occurredAt = Date.parse(`${row.day}T00:00:00Z`);
      if (
        !matchesFilter(
          {
            occurredAt,
            appId: row.appId,
            city: row.city,
            desireLane: row.desireLane ?? undefined,
            channel: row.channel ?? undefined,
            campaignId: row.campaignId ?? undefined,
            ageBand: row.ageBand,
          },
          filter,
        )
      ) {
        continue;
      }
      counts.set(row.stage, (counts.get(row.stage) ?? 0) + row.uniqueActors);
      if (row.medianTtfvMs !== null) medians.get(row.stage)!.push(row.medianTtfvMs);
    }
    const firstNonZero = FUNNEL_STAGES.map(s => counts.get(s) ?? 0).find(c => c > 0) ?? 0;
    const steps: FunnelStep[] = FUNNEL_STAGES.map((stage, idx) => {
      const raw = counts.get(stage) ?? 0;
      const prevRaw = idx > 0 ? (counts.get(FUNNEL_STAGES[idx - 1]!) ?? 0) : raw;
      const suppressed = sensitiveSlice && raw > 0 && raw < kFloor;
      return {
        stage,
        count: suppressed ? 0 : raw,
        suppressed,
        conversionFromPrev: suppressed || prevRaw === 0 ? 0 : round4(raw / prevRaw),
        conversionFromStart: suppressed || firstNonZero === 0 ? 0 : round4(raw / firstNonZero),
        medianTimeFromPrevMs: suppressed ? null : median(medians.get(stage)!),
      };
    });
    return { steps, dropOffReasons: [], totalActors: firstNonZero, kFloor };
  }

  computeCohortMatrix(filter: AnalyticsFilter = {}): CohortMatrix {
    const kFloor = effectiveKFloor(filter.kFloor ?? this.defaultKFloor);
    const nowMs = this.clock.now();
    const filtered = this.members.filter(m =>
      matchesFilter(
        {
          occurredAt: m.joinedAt,
          appId: m.appId,
          city: m.city,
          desireLane: m.desireLane,
          channel: m.channel,
          campaignId: m.campaignId,
          ageBand: m.ageBand,
        },
        filter,
      ),
    );

    const byWeek = new Map<string, MemberLifecycleRecord[]>();
    for (const member of filtered) {
      const week = isoWeekStart(member.joinedAt);
      const list = byWeek.get(week) ?? [];
      list.push(member);
      byWeek.set(week, list);
    }

    const rows: CohortRow[] = [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohortWeek, list]) => {
        const suppressed = list.length < kFloor;
        const retention = {} as Record<CohortHorizonDay, number | null>;
        for (const day of COHORT_HORIZONS) {
          if (suppressed) {
            retention[day] = null;
            continue;
          }
          const eligible = list.filter(m => nowMs - m.joinedAt >= day * DAY);
          if (eligible.length === 0) {
            retention[day] = null;
            continue;
          }
          const active = eligible.filter(m => m.optedOutAt === undefined && m.activeDays.some(d => d >= day)).length;
          retention[day] = round4(active / eligible.length);
        }
        return {
          cohortWeek,
          cohortSize: suppressed ? 0 : list.length,
          suppressed,
          retention,
        };
      });

    const d30Eligible = filtered.filter(m => nowMs - m.joinedAt >= 30 * DAY);
    const isRetainedD30 = (m: MemberLifecycleRecord) => m.optedOutAt === undefined && m.activeDays.some(d => d >= 30);

    const driverDefs: { id: string; label: string; test: (m: MemberLifecycleRecord) => boolean }[] = [
      {
        id: "first_proposal_48h",
        label: "First proposal within 48h",
        test: m => m.firstProposalAt !== undefined && m.firstProposalAt - m.joinedAt <= 48 * HOUR,
      },
      {
        id: "positive_first_meetup",
        label: "Attended first meetup (enjoyment >= 4)",
        test: m => m.firstMeetingAt !== undefined && (m.firstMeetingEnjoyment ?? 0) >= 4,
      },
      {
        id: "invited_by_friend",
        label: "Joined via friend invitation",
        test: m => m.invitedByFriend === true,
      },
      {
        id: "no_match_7d",
        label: "No proposal in first 7 days",
        test: m => m.firstProposalAt === undefined || m.firstProposalAt - m.joinedAt > 7 * DAY,
      },
    ];

    const drivers: RetentionDriver[] = driverDefs.map(def => {
      const exposed = d30Eligible.filter(def.test);
      const baseline = d30Eligible.filter(m => !def.test(m));
      const suppressed = exposed.length < kFloor || baseline.length < kFloor;
      if (suppressed) {
        return {
          driverId: def.id,
          label: def.label,
          exposedCount: 0,
          baselineCount: 0,
          exposedD30Rate: 0,
          baselineD30Rate: 0,
          lift: 0,
          suppressed: true,
        };
      }
      const exposedRate = exposed.filter(isRetainedD30).length / exposed.length;
      const baselineRate = baseline.filter(isRetainedD30).length / baseline.length;
      const lift = baselineRate > 0 ? exposedRate / baselineRate : exposedRate > 0 ? 10 : 1;
      return {
        driverId: def.id,
        label: def.label,
        exposedCount: exposed.length,
        baselineCount: baseline.length,
        exposedD30Rate: round4(exposedRate),
        baselineD30Rate: round4(baselineRate),
        lift: round4(lift),
        suppressed: false,
      };
    });

    return { horizons: COHORT_HORIZONS, rows, drivers, kFloor };
  }

  computeAttribution(filter: AnalyticsFilter = {}, model: AttributionModel = "last_touch"): AttributionRow[] {
    const filtered = this.events.filter(e => matchesFilter(e, filter));
    const byActor = new Map<string, FunnelEvent[]>();
    const spendByKey = new Map<string, number>();

    const keyOf = (channel: string, campaignId: string, desireLane: string) => `${channel}|${campaignId}|${desireLane}`;

    for (const e of filtered) {
      const list = byActor.get(e.actorKey) ?? [];
      list.push(e);
      byActor.set(e.actorKey, list);
      if ((e.spendCents ?? 0) > 0) {
        const k = keyOf(e.channel ?? "direct", e.campaignId ?? "organic", e.desireLane ?? "unknown");
        spendByKey.set(k, (spendByKey.get(k) ?? 0) + (e.spendCents ?? 0));
      }
    }

    interface Acc {
      channel: string;
      campaignId: string;
      desireLane: string;
      visits: number;
      verifiedAdultSignups: number;
      firstMeetings: number;
      retainedD30: number;
    }

    const rows = new Map<string, Acc>();
    const ensure = (channel: string, campaignId: string, desireLane: string): Acc => {
      const k = keyOf(channel, campaignId, desireLane);
      let acc = rows.get(k);
      if (!acc) {
        acc = { channel, campaignId, desireLane, visits: 0, verifiedAdultSignups: 0, firstMeetings: 0, retainedD30: 0 };
        rows.set(k, acc);
      }
      return acc;
    };

    for (const events of byActor.values()) {
      events.sort((a, b) => a.occurredAt - b.occurredAt);
      const touches = events.filter(e => e.stage === "outreach_sent" || e.stage === "link_click" || e.stage === "site_visit");
      const visitTouches = events.filter(e => e.stage === "site_visit");
      for (const v of visitTouches) {
        ensure(v.channel ?? "direct", v.campaignId ?? "organic", v.desireLane ?? "unknown").visits += 1;
      }

      const creditTouches = touches.length > 0 ? touches : events.slice(0, 1);
      const weights = new Map<string, { channel: string; campaignId: string; desireLane: string; weight: number }>();

      if (model === "first_touch") {
        const t = creditTouches[0]!;
        const c = t.channel ?? "direct";
        const cmp = t.campaignId ?? "organic";
        const lane = t.desireLane ?? "unknown";
        weights.set(keyOf(c, cmp, lane), { channel: c, campaignId: cmp, desireLane: lane, weight: 1 });
      } else if (model === "last_touch") {
        const t = creditTouches[creditTouches.length - 1]!;
        const c = t.channel ?? "direct";
        const cmp = t.campaignId ?? "organic";
        const lane = t.desireLane ?? "unknown";
        weights.set(keyOf(c, cmp, lane), { channel: c, campaignId: cmp, desireLane: lane, weight: 1 });
      } else {
        const each = 1 / creditTouches.length;
        for (const t of creditTouches) {
          const c = t.channel ?? "direct";
          const cmp = t.campaignId ?? "organic";
          const lane = t.desireLane ?? "unknown";
          const k = keyOf(c, cmp, lane);
          const prev = weights.get(k);
          weights.set(k, { channel: c, campaignId: cmp, desireLane: lane, weight: (prev?.weight ?? 0) + each });
        }
      }

      const hasVerifiedAdultSignup = events.some(
        e => e.stage === "signup_verified" && e.isAdultVerified === true && e.ageBand !== "13-17",
      );
      const hasAdultMeeting = hasVerifiedAdultSignup && events.some(e => e.stage === "first_irl_meeting");
      const hasAdultRetained = hasVerifiedAdultSignup && events.some(e => e.stage === "retained_d30");

      for (const w of weights.values()) {
        const acc = ensure(w.channel, w.campaignId, w.desireLane);
        if (hasVerifiedAdultSignup) acc.verifiedAdultSignups += w.weight;
        if (hasAdultMeeting) acc.firstMeetings += w.weight;
        if (hasAdultRetained) acc.retainedD30 += w.weight;
      }
    }

    for (const k of spendByKey.keys()) {
      const [channel, campaignId, desireLane] = k.split("|");
      ensure(channel!, campaignId!, desireLane!);
    }

    return [...rows.entries()]
      .map(([k, acc]) => {
        const spendCents = spendByKey.get(k) ?? 0;
        const signups = round4(acc.verifiedAdultSignups);
        const meetings = round4(acc.firstMeetings);
        const retained = round4(acc.retainedD30);
        return {
          channel: acc.channel,
          campaignId: acc.campaignId,
          desireLane: acc.desireLane,
          model,
          spendCents,
          visits: acc.visits,
          verifiedAdultSignups: signups,
          firstMeetings: meetings,
          retainedD30: retained,
          cacCents: signups > 0 ? Math.round(spendCents / signups) : null,
          costPerMeetingCents: meetings > 0 ? Math.round(spendCents / meetings) : null,
          visitToAdultSignupRate: acc.visits > 0 ? round4(signups / acc.visits) : 0,
          adultSignupToMeetingRate: signups > 0 ? round4(meetings / signups) : 0,
        };
      })
      .sort((a, b) => b.verifiedAdultSignups - a.verifiedAdultSignups || b.visits - a.visits || a.channel.localeCompare(b.channel));
  }

  computeOutreachHeatmap(filter: AnalyticsFilter = {}): OutreachHeatmap {
    const filtered = this.outreach.filter(r => matchesFilter(r, filter));
    const grid = new Map<string, OutreachHeatmapCell>();
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        grid.set(`${dow}:${hour}`, {
          dayOfWeek: dow,
          hour,
          sent: 0,
          delivered: 0,
          clicked: 0,
          replied: 0,
          converted: 0,
          stopped: 0,
          bounced: 0,
          rateLimited429: 0,
          replyRate: 0,
          clickRate: 0,
          conversionRate: 0,
          stopRate: 0,
          bounceRate: 0,
          rateLimit429Rate: 0,
        });
      }
    }

    const templates = new Map<string, { templateId: string; personaId: string; channel: string; sent: number; delivered: number; replied: number; converted: number; stopped: number }>();
    let totalSent = 0;

    for (const r of filtered) {
      const dow = Math.max(0, Math.min(6, Math.trunc(r.localDayOfWeek)));
      const hour = Math.max(0, Math.min(23, Math.trunc(r.localHour)));
      const cell = grid.get(`${dow}:${hour}`)!;
      cell.sent += r.sent;
      cell.delivered += r.delivered;
      cell.clicked += r.clicked;
      cell.replied += r.replied;
      cell.converted += r.converted;
      cell.stopped += r.stopped;
      cell.bounced += r.bounced;
      cell.rateLimited429 += r.rateLimited429;
      totalSent += r.sent;

      const tId = r.templateId ?? "default";
      const pId = r.personaId ?? "system";
      const tk = `${tId}|${pId}|${r.channel}`;
      const t = templates.get(tk) ?? { templateId: tId, personaId: pId, channel: r.channel, sent: 0, delivered: 0, replied: 0, converted: 0, stopped: 0 };
      t.sent += r.sent;
      t.delivered += r.delivered;
      t.replied += r.replied;
      t.converted += r.converted;
      t.stopped += r.stopped;
      templates.set(tk, t);
    }

    const cells: OutreachHeatmapCell[] = [...grid.values()].map(c => {
      const denom = Math.max(1, c.delivered || c.sent);
      const sentDenom = Math.max(1, c.sent);
      return {
        ...c,
        replyRate: c.sent > 0 ? round4(c.replied / denom) : 0,
        clickRate: c.sent > 0 ? round4(c.clicked / denom) : 0,
        conversionRate: c.sent > 0 ? round4(c.converted / denom) : 0,
        stopRate: c.sent > 0 ? round4(c.stopped / denom) : 0,
        bounceRate: c.sent > 0 ? round4(c.bounced / sentDenom) : 0,
        rateLimit429Rate: c.sent > 0 ? round4(c.rateLimited429 / sentDenom) : 0,
      };
    });

    const templateLift: OutreachTemplateLift[] = [...templates.values()]
      .map(t => {
        const denom = Math.max(1, t.delivered || t.sent);
        const stopRate = t.sent > 0 ? round4(t.stopped / denom) : 0;
        return {
          templateId: t.templateId,
          personaId: t.personaId,
          channel: t.channel,
          sent: t.sent,
          replyRate: t.sent > 0 ? round4(t.replied / denom) : 0,
          conversionRate: t.sent > 0 ? round4(t.converted / denom) : 0,
          stopRate,
          stopGuardrailBreached: stopRate > STOP_RATE_GUARDRAIL,
        };
      })
      .sort((a, b) => b.conversionRate - a.conversionRate || b.replyRate - a.replyRate);

    return { cells, templateLift, totalSent };
  }

  slice(query: SliceQuery): SliceResult {
    const filter = query.filter ?? {};
    const kFloor = effectiveKFloor(filter.kFloor ?? this.defaultKFloor);
    const granularity: SliceGranularity = query.granularity ?? "day";
    const groupBy: SliceDimension[] = (query.groupBy ?? []).slice(0, 2);

    const getDim = (
      item: { appId?: string; city?: string; desireLane?: string; channel?: string; campaignId?: string; ageBand?: string; entrySurface?: string },
      dim: SliceDimension,
    ): string => item[dim] ?? "unknown";

    const accs = new Map<string, { bucket: string; dimensions: Record<string, string>; value: number; denom: number; sampleCount: number }>();
    const add = (bucket: string, dimensions: Record<string, string>, value: number, sampleCount: number, denom = 0) => {
      const dimKey = groupBy.map(d => `${d}=${dimensions[d] ?? "unknown"}`).join("|");
      const key = `${bucket}||${dimKey}`;
      const existing = accs.get(key) ?? { bucket, dimensions, value: 0, denom: 0, sampleCount: 0 };
      existing.value += value;
      existing.denom += denom;
      existing.sampleCount += sampleCount;
      accs.set(key, existing);
    };

    if (query.metric === "outreach_sent" || query.metric === "stop_rate") {
      for (const r of this.outreach.filter(x => matchesFilter(x, filter))) {
        const bucket = timeBucket(r.occurredAt, granularity);
        const dimensions = Object.fromEntries(groupBy.map(d => [d, getDim(r, d)]));
        if (query.metric === "outreach_sent") {
          add(bucket, dimensions, r.sent, r.sent);
        } else {
          add(bucket, dimensions, r.stopped, r.sent, Math.max(1, r.delivered || r.sent));
        }
      }
    } else {
      const stageForMetric: Partial<Record<SliceQuery["metric"], FunnelStage>> = {
        site_visits: "site_visit",
        verified_signups: "signup_verified",
        proposals: "first_proposal",
        irl_meetings: "first_irl_meeting",
        retained_d30: "retained_d30",
      };
      const targetStage = stageForMetric[query.metric];
      for (const e of this.events.filter(x => matchesFilter(x, filter))) {
        if (targetStage && e.stage !== targetStage) continue;
        const bucket = timeBucket(e.occurredAt, granularity);
        const dimensions = Object.fromEntries(groupBy.map(d => [d, getDim(e, d)]));
        const delta = query.metric === "spend_cents" ? (e.spendCents ?? 0) : 1;
        add(bucket, dimensions, delta, 1);
      }
    }

    const sensitiveSlice = groupBy.includes("ageBand") || Boolean(filter.ageBand) || groupBy.length >= 2;
    const rows: SliceRow[] = [...accs.values()]
      .map(acc => {
        const suppressed = sensitiveSlice && acc.sampleCount > 0 && acc.sampleCount < kFloor;
        const value = query.metric === "stop_rate" ? (acc.denom > 0 ? round4(acc.value / acc.denom) : 0) : acc.value;
        return {
          bucket: acc.bucket,
          dimensions: acc.dimensions,
          value: suppressed ? 0 : value,
          sampleCount: suppressed ? 0 : acc.sampleCount,
          suppressed,
        };
      })
      .sort((a, b) => a.bucket.localeCompare(b.bucket) || b.value - a.value);

    return {
      metric: query.metric,
      granularity,
      groupBy,
      rows,
      kFloor,
    };
  }
}
