import type { AppId } from "../types.ts";

export const K_ANONYMITY_FLOOR = 5;

export const FUNNEL_STAGES = [
  "outreach_sent",
  "link_click",
  "site_visit",
  "cta_triggered",
  "signup_verified",
  "onboarding_completed",
  "first_proposal",
  "first_irl_meeting",
  "retained_d30",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const CHURN_REASON_CODES = [
  "drop_pre_verify",
  "drop_onboarding_stall",
  "churn_cold_start_no_match",
  "churn_review_bottleneck",
  "churn_two_unanswered_fatigue",
  "churn_scheduling_friction",
  "churn_poor_first_meetup",
  "churn_explicit_stop",
  "retained_core_value",
] as const;

export type ChurnReasonCode = (typeof CHURN_REASON_CODES)[number];

export type AnalyticsAgeBand = "18+" | "13-17" | "unknown";

export type AttributionModel = "first_touch" | "last_touch" | "linear";

export type AnalyticsAppFilter = AppId | "all";

export interface FunnelEvent {
  eventId: string;
  occurredAt: number;
  appId: AppId;
  city: string;
  stage: FunnelStage;
  actorKey: string;
  channel?: string;
  campaignId?: string;
  armId?: string;
  qrCode?: string;
  desireLane?: string;
  entrySurface?: string;
  ageBand?: AnalyticsAgeBand;
  isAdultVerified?: boolean;
  spendCents?: number;
  revenueCents?: number;
  enjoyment?: number;
  churnReason?: ChurnReasonCode;
  metadata?: Record<string, string | number | boolean>;
}

export interface DailyRollupRow {
  day: string;
  appId: AppId;
  city: string;
  desireLane: string | null;
  channel: string | null;
  campaignId: string | null;
  ageBand: AnalyticsAgeBand;
  stage: FunnelStage;
  eventCount: number;
  uniqueActors: number;
  medianTtfvMs: number | null;
}

export interface MemberLifecycleRecord {
  memberKey: string;
  appId: AppId;
  city: string;
  joinedAt: number;
  ageBand: AnalyticsAgeBand;
  channel?: string;
  campaignId?: string;
  desireLane?: string;
  invitedByFriend?: boolean;
  onboardingComplete?: boolean;
  firstProposalAt?: number;
  firstMeetingAt?: number;
  firstMeetingEnjoyment?: number;
  activeDays: number[];
  optedOutAt?: number;
  unansweredProactive?: number;
  reviewExpiredCount?: number;
  bookedCancelledCount?: number;
}

export interface OutreachTelemetryRecord {
  occurredAt: number;
  appId: AppId;
  city: string;
  channel: string;
  campaignId?: string;
  personaId?: string;
  templateId?: string;
  desireLane?: string;
  localDayOfWeek: number;
  localHour: number;
  sent: number;
  delivered: number;
  clicked: number;
  replied: number;
  converted: number;
  stopped: number;
  bounced: number;
  rateLimited429: number;
}

export interface AnalyticsFilter {
  appId?: AnalyticsAppFilter;
  city?: string;
  desireLane?: string;
  channel?: string;
  campaignId?: string;
  entrySurface?: string;
  ageBand?: AnalyticsAgeBand;
  fromMs?: number;
  toMs?: number;
  kFloor?: number;
}

export interface FunnelStep {
  stage: FunnelStage;
  count: number;
  suppressed: boolean;
  conversionFromPrev: number;
  conversionFromStart: number;
  medianTimeFromPrevMs: number | null;
}

export interface DropOffReasonCount {
  reason: ChurnReasonCode;
  count: number;
  share: number;
  suppressed: boolean;
}

export interface FunnelResult {
  steps: FunnelStep[];
  dropOffReasons: DropOffReasonCount[];
  totalActors: number;
  kFloor: number;
}

export const COHORT_HORIZONS = [1, 3, 7, 14, 30] as const;

export type CohortHorizonDay = (typeof COHORT_HORIZONS)[number];

export interface CohortRow {
  cohortWeek: string;
  cohortSize: number;
  suppressed: boolean;
  retention: Record<CohortHorizonDay, number | null>;
}

export interface RetentionDriver {
  driverId: string;
  label: string;
  exposedCount: number;
  baselineCount: number;
  exposedD30Rate: number;
  baselineD30Rate: number;
  lift: number;
  suppressed: boolean;
}

export interface CohortMatrix {
  horizons: readonly CohortHorizonDay[];
  rows: CohortRow[];
  drivers: RetentionDriver[];
  kFloor: number;
}

export interface AttributionRow {
  channel: string;
  campaignId: string;
  desireLane: string;
  model: AttributionModel;
  spendCents: number;
  visits: number;
  verifiedAdultSignups: number;
  firstMeetings: number;
  retainedD30: number;
  cacCents: number | null;
  costPerMeetingCents: number | null;
  visitToAdultSignupRate: number;
  adultSignupToMeetingRate: number;
}

export interface OutreachHeatmapCell {
  dayOfWeek: number;
  hour: number;
  sent: number;
  delivered: number;
  clicked: number;
  replied: number;
  converted: number;
  stopped: number;
  bounced: number;
  rateLimited429: number;
  replyRate: number;
  clickRate: number;
  conversionRate: number;
  stopRate: number;
  bounceRate: number;
  rateLimit429Rate: number;
}

export interface OutreachTemplateLift {
  templateId: string;
  personaId: string;
  channel: string;
  sent: number;
  replyRate: number;
  conversionRate: number;
  stopRate: number;
  stopGuardrailBreached: boolean;
}

export interface OutreachHeatmap {
  cells: OutreachHeatmapCell[];
  templateLift: OutreachTemplateLift[];
  totalSent: number;
}

export interface TimeSeriesPoint {
  ts: number;
  label: string;
  value: number;
}

export type AnomalySeverity = "info" | "warn" | "critical";

export interface AnomalyAlert {
  id: string;
  kind: "statistical" | "invariant";
  severity: AnomalySeverity;
  metric: string;
  message: string;
  observed: number;
  expected: number;
  zScore: number;
  at: number;
}

export interface SafetyInvariantCounters {
  canaryLeaks: number;
  teenViolationContacts: number;
  crossAppLeaks: number;
  unverifiedAdultPayouts: number;
}

export type SliceMetric =
  | "site_visits"
  | "verified_signups"
  | "proposals"
  | "irl_meetings"
  | "retained_d30"
  | "spend_cents"
  | "outreach_sent"
  | "stop_rate";

export type SliceDimension =
  | "appId"
  | "city"
  | "desireLane"
  | "channel"
  | "campaignId"
  | "ageBand"
  | "entrySurface";

export type SliceGranularity = "hour" | "day" | "week" | "total";

export interface SliceQuery {
  metric: SliceMetric;
  groupBy?: SliceDimension[];
  granularity?: SliceGranularity;
  filter?: AnalyticsFilter;
}

export interface SliceRow {
  bucket: string;
  dimensions: Record<string, string>;
  value: number;
  sampleCount: number;
  suppressed: boolean;
}

export interface SliceResult {
  metric: SliceMetric;
  granularity: SliceGranularity;
  groupBy: SliceDimension[];
  rows: SliceRow[];
  kFloor: number;
}
