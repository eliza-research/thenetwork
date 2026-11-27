import { RealClock } from "../../../packages/core/src/clock.ts";
import { computeBanditAllocations, toAllocatorBanditArm } from "./bandit.ts";
import { banditMaxStopRateBps } from "./constants.ts";
import type { NetworkCoreBridge } from "./network-bridge.ts";
import { evaluateQueuePressure, isDeviceLeaseHeldByOther } from "./policy.ts";
import type {
  BanditArm,
  BrandAppId,
  Campaign,
  CityAppDemandSignal,
  Clock,
  DeviceNode,
  HumanPartner,
  OutreachMessage,
  RiskDial,
} from "./types.ts";

export interface CampaignStopStats {
  contactedHumans: number;
  stoppedHumans: number;
  stopRateBps: number;
}

export interface BanditArmBatchUpdate {
  id: string;
  alpha: number;
  beta: number;
  weight: number;
  status: BanditArm["status"];
}

export interface AutopilotStore {
  listCampaigns(filter?: { status?: Campaign["status"] }): Promise<Campaign[]>;
  setRiskDial(id: string, riskDial: RiskDial, billingArmed?: boolean): Promise<Campaign>;
  listDevices(): Promise<DeviceNode[]>;
  releaseDeviceLease(id: string, leaseHolder?: string): Promise<DeviceNode>;
  listOutreachMessages(filter?: { campaignId?: string }): Promise<OutreachMessage[]>;
  listHumans(filter?: { city?: string }): Promise<HumanPartner[]>;
  resetDailyCounters(): Promise<void>;
  getCampaignStopStats?(campaignId: string): Promise<CampaignStopStats>;
  listBanditArms?(campaignId: string): Promise<BanditArm[]>;
  upsertBanditArm?(arm: Omit<BanditArm, "id" | "updatedAt"> & { id?: string }): Promise<BanditArm>;
  updateBanditArmsBatch?(updates: readonly BanditArmBatchUpdate[]): Promise<BanditArm[]>;
}

export type DaemonEventType =
  | "daemon_started"
  | "daemon_stopped"
  | "tick_completed"
  | "daily_reset"
  | "risk_dial_lockdown"
  | "device_lease_swept"
  | "bandit_rebalanced"
  | "queue_pressure_paused"
  | "queue_pressure_resumed"
  | "tick_error";

export interface DaemonEvent {
  readonly type: DaemonEventType;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
}

export interface DaemonCampaignTickSummary {
  readonly campaignId: string;
  readonly slug: string;
  readonly stopRateBps: number;
  readonly stopSpikeTriggeredLockdown: boolean;
  readonly queuePressurePaused: boolean;
  readonly queuePressureReason: string | null;
  readonly banditArmsRebalanced: number;
  readonly customTickExecuted: boolean;
}

export interface DaemonTickReport {
  readonly tickNumber: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly utcDay: string;
  readonly dailyResetExecuted: boolean;
  readonly expiredLeasesSwept: number;
  readonly queuePressurePausedCount: number;
  readonly campaignsProcessed: readonly DaemonCampaignTickSummary[];
  readonly errors: readonly string[];
}

export interface DaemonStatusSnapshot {
  readonly running: boolean;
  readonly inFlight: boolean;
  readonly intervalMs: number;
  readonly tickCount: number;
  readonly lastResetUtcDay: string | null;
  readonly startedAt: string | null;
  readonly lastTickAt: string | null;
  readonly pausedQueues: Readonly<Record<string, string>>;
  readonly lastTickReport: DaemonTickReport | null;
}

export interface MarketingAutopilotDaemonOptions {
  readonly store: AutopilotStore;
  readonly clock?: Clock;
  readonly bridge?: Pick<NetworkCoreBridge, "getDemandAndPressure">;
  readonly intervalMs?: number;
  readonly minStopSamples?: number;
  readonly maxStopRateBps?: number;
  readonly reviewBacklogLimit?: number;
  readonly outboundBacklogLimit?: number;
  readonly hysteresisResumeRatio?: number;
  readonly runCampaignTick?: (campaign: Campaign) => Promise<void>;
  readonly onEvent?: (event: DaemonEvent) => void;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_MIN_STOP_SAMPLES = 20;
const DEFAULT_REVIEW_BACKLOG_LIMIT = 50;
const DEFAULT_OUTBOUND_BACKLOG_LIMIT = 250;
const DEFAULT_HYSTERESIS_RESUME_RATIO = 0.8;
const ALL_BRAND_APPS: readonly BrandAppId[] = ["slop", "peon", "friends", "ntwrk"];

function utcDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function queueKey(city: string, appId: BrandAppId): string {
  return `${city.trim().toLowerCase()}:${appId}`;
}

export class MarketingAutopilotDaemon {
  private readonly store: AutopilotStore;
  private readonly clock: Clock;
  private readonly bridge?: Pick<NetworkCoreBridge, "getDemandAndPressure">;
  private readonly intervalMs: number;
  private readonly minStopSamples: number;
  private readonly maxStopRateBps: number;
  private readonly reviewBacklogLimit: number;
  private readonly outboundBacklogLimit: number;
  private readonly hysteresisResumeRatio: number;
  private readonly runCampaignTick?: (campaign: Campaign) => Promise<void>;
  private readonly onEvent?: (event: DaemonEvent) => void;

  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlightTick: Promise<DaemonTickReport> | null = null;
  private tickCount = 0;
  private lastResetUtcDay: string | null = null;
  private startedAt: string | null = null;
  private lastTickAt: string | null = null;
  private lastTickReport: DaemonTickReport | null = null;
  private readonly pausedQueues = new Map<string, string>();

  constructor(opts: MarketingAutopilotDaemonOptions) {
    this.store = opts.store;
    this.clock = opts.clock ?? new RealClock();
    this.bridge = opts.bridge;
    this.intervalMs = Math.max(250, Math.floor(opts.intervalMs ?? DEFAULT_INTERVAL_MS));
    this.minStopSamples = Math.max(1, Math.floor(opts.minStopSamples ?? DEFAULT_MIN_STOP_SAMPLES));
    this.maxStopRateBps = Math.max(1, Math.floor(opts.maxStopRateBps ?? banditMaxStopRateBps));
    this.reviewBacklogLimit = Math.max(
      1,
      Math.floor(opts.reviewBacklogLimit ?? DEFAULT_REVIEW_BACKLOG_LIMIT),
    );
    this.outboundBacklogLimit = Math.max(
      1,
      Math.floor(opts.outboundBacklogLimit ?? DEFAULT_OUTBOUND_BACKLOG_LIMIT),
    );
    const ratio = opts.hysteresisResumeRatio ?? DEFAULT_HYSTERESIS_RESUME_RATIO;
    this.hysteresisResumeRatio = Number.isFinite(ratio)
      ? Math.max(0.1, Math.min(0.99, ratio))
      : DEFAULT_HYSTERESIS_RESUME_RATIO;
    this.runCampaignTick = opts.runCampaignTick;
    this.onEvent = opts.onEvent;
  }

  private emit(type: DaemonEventType, payload: Record<string, unknown>): void {
    if (!this.onEvent) return;
    this.onEvent({
      type,
      timestamp: new Date(this.clock.now()).toISOString(),
      payload,
    });
  }

  getStatus(): DaemonStatusSnapshot {
    return {
      running: this.running,
      inFlight: this.inFlightTick !== null,
      intervalMs: this.intervalMs,
      tickCount: this.tickCount,
      lastResetUtcDay: this.lastResetUtcDay,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      pausedQueues: Object.fromEntries(this.pausedQueues.entries()),
      lastTickReport: this.lastTickReport,
    };
  }

  isQueuePaused(city: string, appId: Campaign["appId"]): { paused: boolean; reason: string | null } {
    const normalizedCity = city.trim().toLowerCase();
    if (appId === "all") {
      for (const brand of ALL_BRAND_APPS) {
        const reason = this.pausedQueues.get(queueKey(normalizedCity, brand));
        if (reason) return { paused: true, reason };
      }
      return { paused: false, reason: null };
    }
    const reason = this.pausedQueues.get(queueKey(normalizedCity, appId));
    return reason ? { paused: true, reason } : { paused: false, reason: null };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const nowMs = this.clock.now();
    this.startedAt = new Date(nowMs).toISOString();
    if (this.lastResetUtcDay === null) {
      this.lastResetUtcDay = utcDayFromMs(nowMs);
    }
    this.emit("daemon_started", { intervalMs: this.intervalMs });
    this.scheduleNext();
  }

  async stop(drainTimeoutMs = 5_000): Promise<void> {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlightTick !== null) {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        this.inFlightTick.catch(() => undefined),
        new Promise<void>((resolve) => {
          timeoutHandle = setTimeout(resolve, Math.max(50, drainTimeoutMs));
          timeoutHandle.unref?.();
        }),
      ]);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    }
    this.emit("daemon_stopped", { tickCount: this.tickCount });
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tickNow().finally(() => {
        if (this.running) {
          this.scheduleNext();
        }
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async tickNow(): Promise<DaemonTickReport> {
    if (this.inFlightTick !== null) {
      return this.inFlightTick;
    }
    const task = this.executeTick();
    this.inFlightTick = task;
    try {
      return await task;
    } finally {
      if (this.inFlightTick === task) {
        this.inFlightTick = null;
      }
    }
  }

  private updateQueueBackpressure(signals: readonly CityAppDemandSignal[]): void {
    const reviewResumeCeiling = Math.floor(this.reviewBacklogLimit * this.hysteresisResumeRatio);
    const outboundResumeCeiling = Math.floor(
      this.outboundBacklogLimit * this.hysteresisResumeRatio,
    );

    for (const signal of signals) {
      const key = queueKey(signal.city, signal.appId);
      const wasPaused = this.pausedQueues.has(key);
      const decision = evaluateQueuePressure({
        lineRestricted: signal.lineRestricted,
        reviewOverdue: signal.overdueReviewCount,
        reviewOpen: signal.openReviewCount,
        reviewBacklogLimit: this.reviewBacklogLimit,
        outboundWaiting: signal.outboundWaitingCount,
        outboundBacklogLimit: this.outboundBacklogLimit,
      });

      if (signal.queuePressurePaused || decision.paused) {
        const reason = decision.reason ?? "queue_pressure_paused";
        this.pausedQueues.set(key, reason);
        if (!wasPaused) {
          this.emit("queue_pressure_paused", {
            city: signal.city,
            appId: signal.appId,
            reason,
            openReviewCount: signal.openReviewCount,
            overdueReviewCount: signal.overdueReviewCount,
            outboundWaitingCount: signal.outboundWaitingCount,
            lineRestricted: signal.lineRestricted,
          });
        }
      } else if (wasPaused) {
        const belowHysteresis =
          !signal.lineRestricted &&
          signal.overdueReviewCount === 0 &&
          signal.openReviewCount < reviewResumeCeiling &&
          signal.outboundWaitingCount < outboundResumeCeiling;
        if (belowHysteresis) {
          this.pausedQueues.delete(key);
          this.emit("queue_pressure_resumed", {
            city: signal.city,
            appId: signal.appId,
            openReviewCount: signal.openReviewCount,
            outboundWaitingCount: signal.outboundWaitingCount,
            reviewResumeCeiling,
            outboundResumeCeiling,
          });
        }
      }
    }
  }

  private async executeTick(): Promise<DaemonTickReport> {
    const startMs = this.clock.now();
    const startedAt = new Date(startMs).toISOString();
    const utcDay = utcDayFromMs(startMs);
    const errors: string[] = [];
    let dailyResetExecuted = false;
    let expiredLeasesSwept = 0;

    if (this.lastResetUtcDay !== null && this.lastResetUtcDay !== utcDay) {
      try {
        await this.store.resetDailyCounters();
        dailyResetExecuted = true;
        this.lastResetUtcDay = utcDay;
        this.emit("daily_reset", { utcDay });
      } catch (err) {
        errors.push(`daily_reset: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (this.lastResetUtcDay === null) {
      this.lastResetUtcDay = utcDay;
    }

    if (this.bridge) {
      try {
        const signals = await this.bridge.getDemandAndPressure();
        this.updateQueueBackpressure(signals);
      } catch (err) {
        errors.push(`queue_pressure: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const devices = await this.store.listDevices();
      const nowMs = this.clock.now();
      for (const dev of devices) {
        if (dev.leaseHolder !== null && dev.leaseExpiresAt !== null) {
          const activeForeign = isDeviceLeaseHeldByOther(dev, "__daemon_sweep__", nowMs);
          if (!activeForeign) {
            await this.store.releaseDeviceLease(dev.id, dev.leaseHolder);
            expiredLeasesSwept += 1;
            this.emit("device_lease_swept", {
              deviceId: dev.id,
              previousHolder: dev.leaseHolder,
            });
          }
        }
      }
    } catch (err) {
      errors.push(`device_lease_sweep: ${err instanceof Error ? err.message : String(err)}`);
    }

    const campaignsProcessed: DaemonCampaignTickSummary[] = [];
    try {
      const activeCampaigns = await this.store.listCampaigns({ status: "active" });
      for (const campaign of activeCampaigns) {
        const summary = await this.processCampaign(campaign, utcDay, dailyResetExecuted, errors);
        campaignsProcessed.push(summary);
      }
    } catch (err) {
      errors.push(`list_campaigns: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.tickCount += 1;
    const finishedAt = new Date(this.clock.now()).toISOString();
    const queuePressurePausedCount = campaignsProcessed.filter(
      (c) => c.queuePressurePaused,
    ).length;
    const report: DaemonTickReport = {
      tickNumber: this.tickCount,
      startedAt,
      finishedAt,
      utcDay,
      dailyResetExecuted,
      expiredLeasesSwept,
      queuePressurePausedCount,
      campaignsProcessed,
      errors,
    };

    this.lastTickAt = finishedAt;
    this.lastTickReport = report;
    this.emit(errors.length > 0 ? "tick_error" : "tick_completed", {
      tickNumber: report.tickNumber,
      dailyResetExecuted,
      expiredLeasesSwept,
      queuePressurePausedCount,
      campaignsCount: campaignsProcessed.length,
      errorsCount: errors.length,
    });
    return report;
  }

  private async computeCampaignStopRate(
    campaign: Campaign,
  ): Promise<{ sampleCount: number; stopRateBps: number }> {
    if (typeof this.store.getCampaignStopStats === "function") {
      const stats = await this.store.getCampaignStopStats(campaign.id);
      return {
        sampleCount: stats.contactedHumans,
        stopRateBps: stats.stopRateBps,
      };
    }

    const [messages, humans] = await Promise.all([
      this.store.listOutreachMessages({ campaignId: campaign.id }),
      this.store.listHumans({ city: campaign.city }),
    ]);
    const sentOrBlocked = messages.filter(
      (m) =>
        m.status === "sent" ||
        m.status === "delivered" ||
        m.status === "replied" ||
        m.status === "blocked_stop",
    );
    const stoppedMessages = messages.filter((m) => m.status === "blocked_stop").length;
    const stoppedHumans = humans.filter((h) => h.stopped).length;
    const denominator = Math.max(sentOrBlocked.length, humans.length);
    const numerator = Math.max(stoppedMessages, stoppedHumans);
    return {
      sampleCount: denominator,
      stopRateBps: denominator > 0 ? Math.round((numerator / denominator) * 10_000) : 0,
    };
  }

  private async processCampaign(
    campaign: Campaign,
    utcDay: string,
    applyWeeklyDecay: boolean,
    errors: string[],
  ): Promise<DaemonCampaignTickSummary> {
    let currentCampaign = campaign;
    let stopRateBps = 0;
    let stopSpikeTriggeredLockdown = false;
    let banditArmsRebalanced = 0;
    let customTickExecuted = false;

    const pressure = this.isQueuePaused(currentCampaign.city, currentCampaign.appId);

    try {
      const stats = await this.computeCampaignStopRate(campaign);
      if (stats.sampleCount >= this.minStopSamples) {
        stopRateBps = stats.stopRateBps;
        if (stopRateBps > this.maxStopRateBps && currentCampaign.riskDial !== "lockdown") {
          currentCampaign = await this.store.setRiskDial(campaign.id, "lockdown", false);
          stopSpikeTriggeredLockdown = true;
          this.emit("risk_dial_lockdown", {
            campaignId: campaign.id,
            slug: campaign.slug,
            stopRateBps,
            thresholdBps: this.maxStopRateBps,
          });
        }
      }
    } catch (err) {
      errors.push(`stop_check(${campaign.id}): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (
      currentCampaign.riskDial !== "lockdown" &&
      !pressure.paused &&
      this.store.listBanditArms &&
      (this.store.updateBanditArmsBatch || this.store.upsertBanditArm)
    ) {
      try {
        const storedArms = await this.store.listBanditArms(campaign.id);
        if (storedArms.length > 0) {
          const allocatorArms = storedArms.map((arm) =>
            toAllocatorBanditArm(arm, currentCampaign),
          );
          const remainingCents = Math.max(
            0,
            currentCampaign.monthlyBudgetCents -
              currentCampaign.spentCents -
              currentCampaign.reservedCents,
          );
          const result = computeBanditAllocations({
            campaignId: campaign.id,
            arms: allocatorArms,
            availableCents: remainingCents,
            seed: `${campaign.id}:${utcDay}:${this.tickCount + 1}`,
            nowIso: new Date(this.clock.now()).toISOString(),
            riskDial: currentCampaign.riskDial,
            billingArmed: currentCampaign.billingArmed,
            weeksElapsed: applyWeeklyDecay ? 1 / 7 : 0,
          });

          const batchUpdates: BanditArmBatchUpdate[] = [];
          for (const updated of result.arms) {
            const orig = storedArms.find(
              (a) => a.id === updated.id || a.armKey === updated.armKey,
            );
            const mappedStatus: BanditArm["status"] =
              updated.state === "halted_safety" || updated.state === "auto_killed"
                ? "killed"
                : updated.state === "paused_low_roi"
                  ? "paused"
                  : "active";
            const weight = Number((updated.allocatedShareBps / 10_000).toFixed(4));
            if (orig && this.store.updateBanditArmsBatch) {
              batchUpdates.push({
                id: orig.id,
                alpha: updated.alpha,
                beta: updated.beta,
                weight,
                status: mappedStatus,
              });
            } else if (this.store.upsertBanditArm) {
              await this.store.upsertBanditArm({
                id: orig?.id ?? updated.id,
                campaignId: campaign.id,
                armKey: updated.armKey,
                label: updated.label,
                track: orig?.track ?? updated.track,
                desireLane: orig?.desireLane ?? updated.desireLane ?? null,
                alpha: updated.alpha,
                beta: updated.beta,
                weight,
                spendCents: updated.spentCents,
                signups: updated.verifiedT2Joins,
                verifiedOutcomes: updated.verifiedT3Matches,
                stopEvents: updated.stopCount,
                totalContacts: updated.exposures,
                status: mappedStatus,
              });
            }
            banditArmsRebalanced += 1;
          }

          if (batchUpdates.length > 0 && this.store.updateBanditArmsBatch) {
            await this.store.updateBanditArmsBatch(batchUpdates);
          }

          this.emit("bandit_rebalanced", {
            campaignId: campaign.id,
            armsCount: banditArmsRebalanced,
            totalAllocatedCents: result.totalAllocatedCents,
          });
        }
      } catch (err) {
        errors.push(`bandit(${campaign.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (currentCampaign.riskDial !== "lockdown" && !pressure.paused && this.runCampaignTick) {
      try {
        await this.runCampaignTick(currentCampaign);
        customTickExecuted = true;
      } catch (err) {
        errors.push(`campaign_tick(${campaign.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      campaignId: campaign.id,
      slug: campaign.slug,
      stopRateBps,
      stopSpikeTriggeredLockdown,
      queuePressurePaused: pressure.paused,
      queuePressureReason: pressure.reason,
      banditArmsRebalanced,
      customTickExecuted,
    };
  }
}
