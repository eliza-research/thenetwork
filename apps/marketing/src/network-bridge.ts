import { randomUUID } from "node:crypto";
import { getCity } from "../../../packages/core/src/cities.ts";
import { RealClock, type Clock } from "../../../packages/core/src/clock.ts";
import type { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import {
  evaluateQueuePressure,
  keyedContactHash,
  normalizeE164Phone,
} from "./policy.ts";
import type {
  BdDeal,
  BdVenueCandidate,
  BrandAppId,
  CityAppDemandSignal,
  ContactFenceVerdict,
  NetworkSupplyDemandSnapshot,
} from "./types.ts";

export type CostLedgerKind =
  | "llm"
  | "photo_rating"
  | "otp_verify"
  | "blooio_line"
  | "sms_fallback"
  | "other";

export interface CostLedgerWriteInput {
  id?: string;
  appId: BrandAppId;
  provider: string;
  kind: CostLedgerKind;
  quantity?: number;
  unitCostUsd?: number;
  costUsd: number;
  estimated?: boolean;
  detail?: Record<string, unknown>;
}

export interface VenueClosureSignal {
  venueId: string;
  city: string;
  name: string;
  status: string;
  closureReports: number;
}

export interface BdVenueCandidateOptions {
  neighborhood?: string;
  address?: string;
  category?: string;
  isBarOnly?: boolean;
  nowIso?: string;
}

export interface ContactFenceInput {
  phone?: string | null;
  phoneHash?: string | null;
  email?: string | null;
  todayIso?: string;
}

export interface ThrottleIntakeResult {
  paused: boolean;
  reason?: string;
  signal?: CityAppDemandSignal;
}

export interface NetworkBridgePing {
  ok: boolean;
  mode: "platform_pg" | "standalone_fallback";
  bridgeFunctionsPresent: boolean;
}

export interface NetworkCoreBridge {
  checkContactFence(input: ContactFenceInput): Promise<ContactFenceVerdict>;
  getDemandAndPressure(city?: string | null): Promise<CityAppDemandSignal[]>;
  getSupplyDemandK5(city?: string | null): Promise<NetworkSupplyDemandSnapshot>;
  shouldThrottleIntake(city: string, appId: BrandAppId): Promise<ThrottleIntakeResult>;
  getVenueClosureSignals(city?: string | null): Promise<VenueClosureSignal[]>;
  recordOperationalCost(entry: CostLedgerWriteInput): Promise<boolean>;
  recordCostLedgerEntry(entry: CostLedgerWriteInput): Promise<boolean>;
  ping(): Promise<NetworkBridgePing>;
}

const DEFAULT_REVIEW_BACKLOG_LIMIT = 20;
const DEFAULT_OUTBOUND_BACKLOG_LIMIT = 200;
const VALID_BRAND_APPS = new Set<BrandAppId>(["slop", "peon", "friends", "ntwrk"]);
const SIGNED_DEAL_STAGES = new Set<BdDeal["stage"]>([
  "contracted",
  "kit_shipped",
  "live",
  "audited",
]);
const BAR_ONLY_CATEGORIES = new Set([
  "cocktail_bar",
  "cocktail_lounge",
  "wine_bar",
  "bar",
  "nightclub",
  "speakeasy",
]);
const ALCOHOL_CATEGORIES = new Set([
  ...BAR_ONLY_CATEGORIES,
  "brewery",
  "brewery_garden",
  "wine_beer_patio",
]);

export function normalizePhoneSafe(raw: string): string | null {
  return normalizeE164Phone(raw);
}

export function hmacContactKey(
  kind: "phone" | "email" | "handle",
  raw: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  return keyedContactHash(kind, raw, env);
}

export function buildBdVenueCandidate(
  deal: BdDeal,
  opts: BdVenueCandidateOptions = {},
): BdVenueCandidate | null {
  if (deal.vertical === "peon") return null;
  if (!SIGNED_DEAL_STAGES.has(deal.stage)) return null;
  if (!deal.phoneCallbackVerified || !deal.contractHash || !deal.contractHash.trim()) {
    return null;
  }
  const vertical: BrandAppId = deal.vertical === "all" ? "friends" : deal.vertical;
  const cityCode = deal.city.trim().toLowerCase();
  if (!cityCode || !deal.venueName.trim()) return null;
  const citySpec = getCity(cityCode);
  const category = (opts.category ?? "community_space").trim().toLowerCase();
  const isBarOnly = Boolean(opts.isBarOnly || BAR_ONLY_CATEGORIES.has(category));
  const isAlcoholCentric = isBarOnly || ALCOHOL_CATEGORIES.has(category);
  const slug = deal.venueName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return {
    id: `bd-${cityCode}-${slug || deal.id.slice(0, 8)}`,
    dealId: deal.id,
    city: cityCode,
    platformActiveCity: Boolean(citySpec),
    neighborhood: opts.neighborhood?.trim() || citySpec?.neighborhoods[0]?.name || cityCode,
    name: deal.venueName.trim(),
    address: opts.address?.trim() || "",
    category,
    vertical,
    isPublic: true,
    allAges: false,
    ageMin: isBarOnly ? 21 : 18,
    isBarOnly,
    isAlcoholCentric,
    alcoholOptional: !isBarOnly,
    groupScore: 70,
    dateScore: 70,
    personaPriors: {},
    source: "marketing_bd_partner",
    contactEmail: deal.contactEmail,
    businessPhone: deal.businessPhone,
    contractHash: deal.contractHash,
    qrBatchId: deal.qrBatchId,
    createdAt: opts.nowIso ?? deal.updatedAt,
  };
}

function isPgUndefinedObjectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "42883" || code === "42P01" || code === "42501";
}

function isoDatePart(iso: string): string {
  return iso.slice(0, 10);
}

export class NullNetworkCoreBridge implements NetworkCoreBridge {
  private readonly clock: Clock;

  constructor(clock: Clock = new RealClock()) {
    this.clock = clock;
  }

  checkContactFence(): Promise<ContactFenceVerdict> {
    return Promise.resolve({
      allowed: true,
      banned: false,
      globallyStopped: false,
      knownMinor: false,
      recycledHold: false,
      source: "standalone_fallback",
    });
  }

  getDemandAndPressure(): Promise<CityAppDemandSignal[]> {
    return Promise.resolve([]);
  }

  getSupplyDemandK5(): Promise<NetworkSupplyDemandSnapshot> {
    return Promise.resolve({
      capturedAt: new Date(this.clock.now()).toISOString(),
      source: "standalone_fallback",
      signals: [],
      anyQueuePressurePaused: false,
      anyLineRestricted: false,
    });
  }

  shouldThrottleIntake(): Promise<ThrottleIntakeResult> {
    return Promise.resolve({ paused: false });
  }

  getVenueClosureSignals(): Promise<VenueClosureSignal[]> {
    return Promise.resolve([]);
  }

  recordOperationalCost(): Promise<boolean> {
    return Promise.resolve(false);
  }

  recordCostLedgerEntry(): Promise<boolean> {
    return Promise.resolve(false);
  }

  ping(): Promise<NetworkBridgePing> {
    return Promise.resolve({
      ok: true,
      mode: "standalone_fallback",
      bridgeFunctionsPresent: false,
    });
  }
}

export interface PgNetworkCoreBridgeOptions {
  sql: SQL;
  clock?: Clock;
  env?: Record<string, string | undefined>;
  reviewBacklogLimit?: number;
  outboundBacklogLimit?: number;
}

interface ContactFenceRow {
  banned: boolean;
  globally_stopped: boolean;
  known_minor: boolean;
  recycled_hold: boolean;
  reason: string | null;
}

interface SupplyDemandRow {
  app_id: string;
  city: string;
  active_adult_bucket: number;
  matching_enabled: boolean;
  open_review_count: number;
  overdue_review_count: number;
  outbound_waiting_count: number;
  line_restricted: boolean;
  closed_venue_count: number;
}

interface VenueClosureRow {
  id: string;
  city: string;
  name: string;
  status: string;
  closure_reports: number;
}

export class PgNetworkCoreBridge implements NetworkCoreBridge {
  private readonly sql: SQL;
  private readonly clock: Clock;
  private readonly env: Record<string, string | undefined>;
  private readonly reviewBacklogLimit: number;
  private readonly outboundBacklogLimit: number;
  private hasCostLedgerCache: boolean | null = null;

  constructor(options: PgNetworkCoreBridgeOptions) {
    this.sql = options.sql;
    this.clock = options.clock ?? new RealClock();
    this.env = options.env ?? process.env;
    this.reviewBacklogLimit = options.reviewBacklogLimit ?? DEFAULT_REVIEW_BACKLOG_LIMIT;
    this.outboundBacklogLimit = options.outboundBacklogLimit ?? DEFAULT_OUTBOUND_BACKLOG_LIMIT;
  }

  async checkContactFence(input: ContactFenceInput): Promise<ContactFenceVerdict> {
    const e164 = input.phone ? normalizeE164Phone(input.phone) : null;
    const phoneHash =
      input.phoneHash?.trim() ||
      (e164 ? keyedContactHash("phone", e164, this.env) : null);
    const emailHash = input.email ? keyedContactHash("email", input.email, this.env) : null;

    const rawEnv = (this.env.MARKETING_ENV ?? this.env.NODE_ENV ?? "dev").trim().toLowerCase();
    const failClosedOnMissingBridge = rawEnv === "production" || rawEnv === "staging";

    if (!phoneHash && !e164) {
      if (emailHash) {
        try {
          const rows = (await this.sql`
            select reason, is_minor
            from marketing.contact_suppression
            where contact_hash = ${emailHash}
            limit 1
          `) as Array<{ reason: string; is_minor: boolean }>;
          const suppressed = rows[0];
          if (suppressed) {
            return {
              allowed: false,
              banned: !suppressed.is_minor,
              globallyStopped: suppressed.reason.includes("stop"),
              knownMinor: suppressed.is_minor,
              recycledHold: false,
              reason: suppressed.reason,
              source: "platform_pg",
            };
          }
        } catch (err) {
          if (!isPgUndefinedObjectError(err) || failClosedOnMissingBridge) {
            return {
              allowed: false,
              banned: false,
              globallyStopped: false,
              knownMinor: false,
              recycledHold: false,
              reason: isPgUndefinedObjectError(err)
                ? "bridge_unavailable_fail_closed"
                : "bridge_error_fail_closed",
              source: "platform_pg",
            };
          }
        }
      }
      return {
        allowed: true,
        banned: false,
        globallyStopped: false,
        knownMinor: false,
        recycledHold: false,
        source: "standalone_fallback",
      };
    }

    const today = isoDatePart(input.todayIso ?? new Date(this.clock.now()).toISOString());
    try {
      const rows = (await this.sql`
        select banned, globally_stopped, known_minor, recycled_hold, reason
        from marketing.contact_fence(${phoneHash}, ${e164}, ${today}::date)
      `) as ContactFenceRow[];
      const row = rows[0];
      if (!row) {
        return {
          allowed: true,
          banned: false,
          globallyStopped: false,
          knownMinor: false,
          recycledHold: false,
          source: "platform_pg",
        };
      }
      const allowed =
        !row.banned && !row.globally_stopped && !row.known_minor && !row.recycled_hold;
      return {
        allowed,
        banned: Boolean(row.banned),
        globallyStopped: Boolean(row.globally_stopped),
        knownMinor: Boolean(row.known_minor),
        recycledHold: Boolean(row.recycled_hold),
        reason: row.reason ?? undefined,
        source: "platform_pg",
      };
    } catch (err) {
      if (isPgUndefinedObjectError(err) && !failClosedOnMissingBridge) {
        return {
          allowed: true,
          banned: false,
          globallyStopped: false,
          knownMinor: false,
          recycledHold: false,
          source: "standalone_fallback",
        };
      }
      return {
        allowed: false,
        banned: false,
        globallyStopped: false,
        knownMinor: false,
        recycledHold: false,
        reason: isPgUndefinedObjectError(err)
          ? "bridge_unavailable_fail_closed"
          : "bridge_error_fail_closed",
        source: "platform_pg",
      };
    }
  }

  async getDemandAndPressure(city?: string | null): Promise<CityAppDemandSignal[]> {
    const cityNorm = city?.trim().toLowerCase() || null;
    try {
      const rows = (await this.sql`
        select
          app_id,
          city,
          active_adult_bucket,
          matching_enabled,
          open_review_count,
          overdue_review_count,
          outbound_waiting_count,
          line_restricted,
          closed_venue_count
        from marketing.supply_demand_k5(${cityNorm})
      `) as SupplyDemandRow[];
      const signals: CityAppDemandSignal[] = [];
      for (const row of rows) {
        if (!VALID_BRAND_APPS.has(row.app_id as BrandAppId)) continue;
        const pressure = evaluateQueuePressure({
          lineRestricted: Boolean(row.line_restricted),
          reviewOverdue: Number(row.overdue_review_count) || 0,
          reviewOpen: Number(row.open_review_count) || 0,
          reviewBacklogLimit: this.reviewBacklogLimit,
          outboundWaiting: Number(row.outbound_waiting_count) || 0,
          outboundBacklogLimit: this.outboundBacklogLimit,
        });
        signals.push({
          appId: row.app_id as BrandAppId,
          city: row.city,
          activeAdultBucket: Number(row.active_adult_bucket) || 0,
          matchingEnabled: Boolean(row.matching_enabled),
          openReviewCount: Number(row.open_review_count) || 0,
          overdueReviewCount: Number(row.overdue_review_count) || 0,
          outboundWaitingCount: Number(row.outbound_waiting_count) || 0,
          lineRestricted: Boolean(row.line_restricted),
          closedVenueCount: Number(row.closed_venue_count) || 0,
          queuePressurePaused: pressure.paused,
        });
      }
      return signals;
    } catch (err) {
      if (isPgUndefinedObjectError(err)) return [];
      throw err;
    }
  }

  async getSupplyDemandK5(city?: string | null): Promise<NetworkSupplyDemandSnapshot> {
    const capturedAt = new Date(this.clock.now()).toISOString();
    try {
      const signals = await this.getDemandAndPressure(city);
      const present = await this.hasBridgeFunctions();
      return {
        capturedAt,
        source: present ? "platform_pg" : "standalone_fallback",
        signals,
        anyQueuePressurePaused: signals.some((s) => s.queuePressurePaused),
        anyLineRestricted: signals.some((s) => s.lineRestricted),
      };
    } catch (err) {
      if (isPgUndefinedObjectError(err)) {
        return {
          capturedAt,
          source: "standalone_fallback",
          signals: [],
          anyQueuePressurePaused: false,
          anyLineRestricted: false,
        };
      }
      throw err;
    }
  }

  async shouldThrottleIntake(city: string, appId: BrandAppId): Promise<ThrottleIntakeResult> {
    const cityNorm = city.trim().toLowerCase();
    const signals = await this.getDemandAndPressure(cityNorm);
    const match = signals.find((s) => s.appId === appId && s.city === cityNorm);
    if (!match) return { paused: false };
    const decision = evaluateQueuePressure({
      lineRestricted: match.lineRestricted,
      reviewOverdue: match.overdueReviewCount,
      reviewOpen: match.openReviewCount,
      reviewBacklogLimit: this.reviewBacklogLimit,
      outboundWaiting: match.outboundWaitingCount,
      outboundBacklogLimit: this.outboundBacklogLimit,
    });
    return {
      paused: decision.paused,
      reason: decision.reason,
      signal: match,
    };
  }

  async getVenueClosureSignals(city?: string | null): Promise<VenueClosureSignal[]> {
    const cityNorm = city?.trim().toLowerCase() || null;
    try {
      const rows = (await this.sql`
        select id, city, name, status, closure_reports
        from platform.venues
        where status in ('suspect_closed', 'closed_temporary', 'closed_permanent')
          and (${cityNorm}::text is null or lower(city) = ${cityNorm})
        order by closure_reports desc, id asc
        limit 100
      `) as VenueClosureRow[];
      return rows.map((row) => ({
        venueId: row.id,
        city: row.city,
        name: row.name,
        status: row.status,
        closureReports: Number(row.closure_reports) || 0,
      }));
    } catch (err) {
      if (isPgUndefinedObjectError(err)) return [];
      return [];
    }
  }

  async recordOperationalCost(entry: CostLedgerWriteInput): Promise<boolean> {
    if (!Number.isFinite(entry.costUsd) || entry.costUsd < 0) return false;
    if (this.hasCostLedgerCache === null) {
      try {
        const reg = (await this.sql`select to_regclass('network.cost_ledger') as rel`) as Array<{
          rel: string | null;
        }>;
        this.hasCostLedgerCache = Boolean(reg[0]?.rel);
      } catch {
        this.hasCostLedgerCache = false;
      }
    }
    if (!this.hasCostLedgerCache) return false;

    const nowIso = new Date(this.clock.now()).toISOString();
    const day = isoDatePart(nowIso);
    const id = entry.id ?? `mkt-cost-${randomUUID()}`;
    const quantity = entry.quantity ?? 1;
    const unitCostUsd = entry.unitCostUsd ?? entry.costUsd;
    const detail = JSON.stringify({ source: "apps/marketing", ...(entry.detail ?? {}) });
    try {
      await this.sql`
        insert into network.cost_ledger (
          id, app_id, day, at, kind, provider, quantity, unit_cost_usd, cost_usd, estimated, detail
        ) values (
          ${id},
          ${entry.appId},
          ${day}::date,
          ${nowIso}::timestamptz,
          ${entry.kind},
          ${entry.provider},
          ${quantity},
          ${unitCostUsd},
          ${entry.costUsd},
          ${entry.estimated ?? false},
          ${detail}::jsonb
        )
        on conflict (id) do nothing
      `;
      return true;
    } catch (err) {
      if (isPgUndefinedObjectError(err)) {
        this.hasCostLedgerCache = false;
        return false;
      }
      return false;
    }
  }

  async recordCostLedgerEntry(entry: CostLedgerWriteInput): Promise<boolean> {
    return this.recordOperationalCost(entry);
  }

  private async hasBridgeFunctions(): Promise<boolean> {
    try {
      const rows = (await this.sql`
        select
          to_regprocedure('marketing.contact_fence(text,text,date)') as fence_fn,
          to_regprocedure('marketing.supply_demand_k5(text)') as supply_fn
      `) as Array<{ fence_fn: string | null; supply_fn: string | null }>;
      return Boolean(rows[0]?.fence_fn && rows[0]?.supply_fn);
    } catch {
      return false;
    }
  }

  async ping(): Promise<NetworkBridgePing> {
    try {
      await this.sql`select 1`;
      const bridgeFunctionsPresent = await this.hasBridgeFunctions();
      return {
        ok: true,
        mode: bridgeFunctionsPresent ? "platform_pg" : "standalone_fallback",
        bridgeFunctionsPresent,
      };
    } catch {
      return {
        ok: false,
        mode: "platform_pg",
        bridgeFunctionsPresent: false,
      };
    }
  }
}

export function createNetworkCoreBridge(
  options: {
    sql?: SQL | null;
    clock?: Clock;
    env?: Record<string, string | undefined>;
    reviewBacklogLimit?: number;
    outboundBacklogLimit?: number;
  } = {},
): NetworkCoreBridge {
  if (!options.sql) {
    return new NullNetworkCoreBridge(options.clock);
  }
  return new PgNetworkCoreBridge({
    sql: options.sql,
    clock: options.clock,
    env: options.env,
    reviewBacklogLimit: options.reviewBacklogLimit,
    outboundBacklogLimit: options.outboundBacklogLimit,
  });
}
