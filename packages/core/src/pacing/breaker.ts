import type { Clock } from "../clock.ts";

export type BreakerState = "closed" | "open" | "half_open";

export type BreakerSignalKind =
  | "http_error"
  | "hard_bounce"
  | "spam_complaint"
  | "stop_rate"
  | "blooio_safety"
  | "queue_pressure"
  | "manual_kill";

export interface BreakerThresholds {
  readonly errorRateThreshold?: number;
  readonly minErrorSamples?: number;
  readonly consecutiveServerErrors?: number;
  readonly hardBounceRateThreshold?: number;
  readonly minBounceSamples?: number;
  readonly spamComplaintWarnRate?: number;
  readonly spamComplaintOpenRate?: number;
  readonly minComplaintSamples?: number;
  readonly stopRateBpsThreshold?: number;
  readonly minStopSamples?: number;
  readonly baseCooldownMs?: number;
  readonly maxCooldownMs?: number;
  readonly halfOpenProbesRequired?: number;
}

export interface BreakerWindowCounters {
  readonly attempts: number;
  readonly errors: number;
  readonly delivered: number;
  readonly hardBounces: number;
  readonly spamComplaints: number;
  readonly stops: number;
}

export interface BreakerSnapshot {
  readonly scopeKey: string;
  readonly state: BreakerState;
  readonly openedAtMs: number | null;
  readonly cooldownUntilMs: number | null;
  readonly tripCount: number;
  readonly tripReason: string | null;
  readonly tripSignal: BreakerSignalKind | null;
  readonly requiresManualReset: boolean;
  readonly throttled: boolean;
  readonly consecutive5xx: number;
  readonly halfOpenSuccesses: number;
  readonly halfOpenProbeInFlight: boolean;
  readonly activeSafetySignals: readonly string[];
  readonly window: BreakerWindowCounters;
}

export interface BreakerDeliveryOutcome {
  readonly ok: boolean;
  readonly status?: number;
  readonly hardBounce?: boolean;
  readonly spamComplaint?: boolean;
  readonly stopped?: boolean;
}

export interface BreakerDispatchCheck {
  readonly allowed: boolean;
  readonly state: BreakerState;
  readonly throttled: boolean;
  readonly waitMs: number;
  readonly reason?: string;
}

export class MultiSignalCircuitBreaker {
  private readonly clock: Clock;
  private readonly scopeKey: string;
  private readonly errorRateThreshold: number;
  private readonly minErrorSamples: number;
  private readonly consecutiveServerErrors: number;
  private readonly hardBounceRateThreshold: number;
  private readonly minBounceSamples: number;
  private readonly spamComplaintWarnRate: number;
  private readonly spamComplaintOpenRate: number;
  private readonly minComplaintSamples: number;
  private readonly stopRateBpsThreshold: number;
  private readonly minStopSamples: number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly halfOpenProbesRequired: number;

  private state: BreakerState;
  private openedAtMs: number | null;
  private cooldownUntilMs: number | null;
  private tripCount: number;
  private tripReason: string | null;
  private tripSignal: BreakerSignalKind | null;
  private requiresManualReset: boolean;
  private throttled: boolean;
  private consecutive5xx: number;
  private halfOpenSuccesses: number;
  private halfOpenProbeInFlight: boolean;
  private readonly activeSafetySignals: Set<string>;
  private window: {
    attempts: number;
    errors: number;
    delivered: number;
    hardBounces: number;
    spamComplaints: number;
    stops: number;
  };

  constructor(opts: {
    readonly clock: Clock;
    readonly scopeKey: string;
    readonly thresholds?: BreakerThresholds;
    readonly initial?: BreakerSnapshot;
  }) {
    this.clock = opts.clock;
    this.scopeKey = opts.scopeKey;
    this.errorRateThreshold = opts.thresholds?.errorRateThreshold ?? 0.1;
    this.minErrorSamples = Math.max(1, opts.thresholds?.minErrorSamples ?? 10);
    this.consecutiveServerErrors = Math.max(1, opts.thresholds?.consecutiveServerErrors ?? 5);
    this.hardBounceRateThreshold = opts.thresholds?.hardBounceRateThreshold ?? 0.02;
    this.minBounceSamples = Math.max(1, opts.thresholds?.minBounceSamples ?? 50);
    this.spamComplaintWarnRate = opts.thresholds?.spamComplaintWarnRate ?? 0.001;
    this.spamComplaintOpenRate = opts.thresholds?.spamComplaintOpenRate ?? 0.003;
    this.minComplaintSamples = Math.max(1, opts.thresholds?.minComplaintSamples ?? 100);
    this.stopRateBpsThreshold = opts.thresholds?.stopRateBpsThreshold ?? 300;
    this.minStopSamples = Math.max(1, opts.thresholds?.minStopSamples ?? 20);
    this.baseCooldownMs = Math.max(1000, opts.thresholds?.baseCooldownMs ?? 60_000);
    this.maxCooldownMs = Math.max(this.baseCooldownMs, opts.thresholds?.maxCooldownMs ?? 900_000);
    this.halfOpenProbesRequired = Math.max(1, opts.thresholds?.halfOpenProbesRequired ?? 3);

    const init = opts.initial;
    this.state = init?.state ?? "closed";
    this.openedAtMs = init?.openedAtMs ?? null;
    this.cooldownUntilMs = init?.cooldownUntilMs ?? null;
    this.tripCount = init?.tripCount ?? 0;
    this.tripReason = init?.tripReason ?? null;
    this.tripSignal = init?.tripSignal ?? null;
    this.requiresManualReset = init?.requiresManualReset ?? false;
    this.throttled = init?.throttled ?? false;
    this.consecutive5xx = init?.consecutive5xx ?? 0;
    this.halfOpenSuccesses = init?.halfOpenSuccesses ?? 0;
    this.halfOpenProbeInFlight = init?.halfOpenProbeInFlight ?? false;
    this.activeSafetySignals = new Set(init?.activeSafetySignals ?? []);
    this.window = {
      attempts: init?.window.attempts ?? 0,
      errors: init?.window.errors ?? 0,
      delivered: init?.window.delivered ?? 0,
      hardBounces: init?.window.hardBounces ?? 0,
      spamComplaints: init?.window.spamComplaints ?? 0,
      stops: init?.window.stops ?? 0,
    };
  }

  canDispatch(): BreakerDispatchCheck {
    const nowMs = this.clock.now();
    if (this.activeSafetySignals.size > 0) {
      return {
        allowed: false,
        state: "open",
        throttled: true,
        waitMs: this.cooldownUntilMs !== null ? Math.max(0, this.cooldownUntilMs - nowMs) : this.baseCooldownMs,
        reason: this.tripReason ?? [...this.activeSafetySignals][0],
      };
    }

    if (this.state === "closed") {
      return { allowed: true, state: "closed", throttled: this.throttled, waitMs: 0 };
    }

    if (this.state === "open") {
      if (this.requiresManualReset) {
        return {
          allowed: false,
          state: "open",
          throttled: true,
          waitMs: this.maxCooldownMs,
          reason: this.tripReason ?? "manual_reset_required",
        };
      }
      const until = this.cooldownUntilMs ?? nowMs;
      if (nowMs < until) {
        return {
          allowed: false,
          state: "open",
          throttled: true,
          waitMs: until - nowMs,
          reason: this.tripReason ?? "circuit_open",
        };
      }
      this.state = "half_open";
      this.halfOpenSuccesses = 0;
      this.halfOpenProbeInFlight = true;
      return { allowed: true, state: "half_open", throttled: true, waitMs: 0 };
    }

    if (this.halfOpenProbeInFlight) {
      return {
        allowed: false,
        state: "half_open",
        throttled: true,
        waitMs: 1000,
        reason: "half_open_probe_in_flight",
      };
    }

    this.halfOpenProbeInFlight = true;
    return { allowed: true, state: "half_open", throttled: true, waitMs: 0 };
  }

  recordDelivery(outcome: BreakerDeliveryOutcome): BreakerSnapshot {
    const isHttpFailure =
      !outcome.ok &&
      (outcome.status === undefined || outcome.status === 429 || outcome.status >= 500);

    this.window.attempts += 1;
    if (isHttpFailure) {
      this.window.errors += 1;
      if (outcome.status === undefined || outcome.status >= 500) {
        this.consecutive5xx += 1;
      }
    } else if (outcome.ok) {
      this.window.delivered += 1;
      this.consecutive5xx = 0;
    }

    if (outcome.hardBounce) this.window.hardBounces += 1;
    if (outcome.spamComplaint) this.window.spamComplaints += 1;
    if (outcome.stopped) this.window.stops += 1;

    if (this.state === "half_open") {
      this.halfOpenProbeInFlight = false;
      if (isHttpFailure || outcome.hardBounce || outcome.spamComplaint) {
        this.trip("http_error", "half_open_probe_failed", false);
        return this.snapshot();
      }
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenProbesRequired) {
        this.state = "closed";
        this.openedAtMs = null;
        this.cooldownUntilMs = null;
        this.tripReason = null;
        this.tripSignal = null;
        this.tripCount = 0;
        this.halfOpenSuccesses = 0;
        this.consecutive5xx = 0;
        this.window = {
          attempts: 0,
          errors: 0,
          delivered: 0,
          hardBounces: 0,
          spamComplaints: 0,
          stops: 0,
        };
      }
      return this.snapshot();
    }

    if (this.consecutive5xx >= this.consecutiveServerErrors) {
      this.trip("http_error", `consecutive_5xx_${this.consecutive5xx}`, false);
      return this.snapshot();
    }

    if (
      this.window.attempts >= this.minErrorSamples &&
      this.window.errors / this.window.attempts >= this.errorRateThreshold
    ) {
      this.trip("http_error", "http_error_rate_exceeded", false);
      return this.snapshot();
    }

    const totalCompleted = Math.max(this.window.attempts, this.window.delivered);
    if (
      totalCompleted >= this.minBounceSamples &&
      this.window.hardBounces / totalCompleted > this.hardBounceRateThreshold
    ) {
      this.trip("hard_bounce", "hard_bounce_rate_exceeded", true);
      return this.snapshot();
    }

    if (totalCompleted >= this.minComplaintSamples) {
      const complaintRate = this.window.spamComplaints / totalCompleted;
      if (complaintRate >= this.spamComplaintOpenRate) {
        this.trip("spam_complaint", "spam_complaint_hard_ceiling", true);
        return this.snapshot();
      }
      if (complaintRate > this.spamComplaintWarnRate) {
        this.throttled = true;
      }
    }

    if (totalCompleted >= this.minStopSamples) {
      const stopBps = Math.round((this.window.stops / totalCompleted) * 10_000);
      if (stopBps > this.stopRateBpsThreshold) {
        this.trip("stop_rate", `stop_rate_${stopBps}_bps`, true);
        return this.snapshot();
      }
    }

    return this.snapshot();
  }

  recordSafetySignal(signal: {
    readonly kind: "blooio_safety" | "queue_pressure" | "manual_kill";
    readonly active: boolean;
    readonly reason: string;
  }): BreakerSnapshot {
    const tag = `${signal.kind}:${signal.reason}`;
    if (signal.active) {
      this.activeSafetySignals.add(tag);
      this.trip(signal.kind, signal.reason, signal.kind !== "queue_pressure");
    } else {
      for (const existing of [...this.activeSafetySignals]) {
        if (existing.startsWith(`${signal.kind}:`)) {
          this.activeSafetySignals.delete(existing);
        }
      }
      if (this.activeSafetySignals.size === 0 && !this.requiresManualReset && this.state === "open") {
        this.state = "closed";
        this.openedAtMs = null;
        this.cooldownUntilMs = null;
        this.tripReason = null;
        this.tripSignal = null;
        this.throttled = false;
      }
    }
    return this.snapshot();
  }

  reset(): BreakerSnapshot {
    this.state = "closed";
    this.openedAtMs = null;
    this.cooldownUntilMs = null;
    this.tripCount = 0;
    this.tripReason = null;
    this.tripSignal = null;
    this.requiresManualReset = false;
    this.throttled = false;
    this.consecutive5xx = 0;
    this.halfOpenSuccesses = 0;
    this.halfOpenProbeInFlight = false;
    this.activeSafetySignals.clear();
    this.window = {
      attempts: 0,
      errors: 0,
      delivered: 0,
      hardBounces: 0,
      spamComplaints: 0,
      stops: 0,
    };
    return this.snapshot();
  }

  private trip(signal: BreakerSignalKind, reason: string, manualReset: boolean): void {
    const nowMs = this.clock.now();
    this.tripCount += 1;
    const cooldownMs = Math.min(
      this.maxCooldownMs,
      this.baseCooldownMs * 2 ** Math.min(this.tripCount - 1, 10),
    );
    this.state = "open";
    this.openedAtMs = nowMs;
    this.cooldownUntilMs = nowMs + cooldownMs;
    this.tripSignal = signal;
    this.tripReason = reason;
    this.requiresManualReset = this.requiresManualReset || manualReset;
    this.throttled = true;
    this.halfOpenSuccesses = 0;
    this.halfOpenProbeInFlight = false;
  }

  snapshot(): BreakerSnapshot {
    return {
      scopeKey: this.scopeKey,
      state: this.state,
      openedAtMs: this.openedAtMs,
      cooldownUntilMs: this.cooldownUntilMs,
      tripCount: this.tripCount,
      tripReason: this.tripReason,
      tripSignal: this.tripSignal,
      requiresManualReset: this.requiresManualReset,
      throttled: this.throttled,
      consecutive5xx: this.consecutive5xx,
      halfOpenSuccesses: this.halfOpenSuccesses,
      halfOpenProbeInFlight: this.halfOpenProbeInFlight,
      activeSafetySignals: [...this.activeSafetySignals].sort(),
      window: { ...this.window },
    };
  }
}
