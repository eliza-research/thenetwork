import type { Clock } from "../clock.ts";

export interface AimdConfig {
  readonly minConcurrency?: number;
  readonly maxConcurrency: number;
  readonly initialConcurrency?: number;
  readonly additiveStep?: number;
  readonly decreaseFactor?: number;
  readonly healthyWindow?: number;
  readonly baselineLatencyMs?: number;
  readonly latencyMultiplier?: number;
  readonly lowRemainingRatio?: number;
  readonly lowRemainingFloor?: number;
}

export interface AimdFeedback {
  readonly ok: boolean;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly retryAfterMs?: number;
  readonly retryAfterHeader?: string | null;
  readonly rateLimitRemaining?: number;
  readonly rateLimitLimit?: number;
  readonly rateLimitResetAtMs?: number;
}

export interface AimdSnapshot {
  readonly concurrency: number;
  readonly paceMultiplier: number;
  readonly healthyStreak: number;
  readonly nextAllowedAtMs: number;
  readonly lastUpdatedAtMs: number;
}

export interface AimdDispatchWindow {
  readonly allowed: boolean;
  readonly waitMs: number;
  readonly concurrency: number;
  readonly paceMultiplier: number;
}

export function parseRetryAfterHeader(
  value: string | null | undefined,
  nowMs: number,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : undefined;
  }
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) return undefined;
  return Math.max(0, parsedMs - nowMs);
}

export class AimdController {
  private readonly clock: Clock;
  private readonly minConcurrency: number;
  private readonly maxConcurrency: number;
  private readonly additiveStep: number;
  private readonly decreaseFactor: number;
  private readonly healthyWindow: number;
  private readonly baselineLatencyMs: number;
  private readonly latencyMultiplier: number;
  private readonly lowRemainingRatio: number;
  private readonly lowRemainingFloor: number;

  private concurrency: number;
  private paceMultiplier: number;
  private healthyStreak: number;
  private nextAllowedAtMs: number;
  private lastUpdatedAtMs: number;

  constructor(opts: {
    readonly clock: Clock;
    readonly config: AimdConfig;
    readonly initial?: Partial<AimdSnapshot>;
  }) {
    this.clock = opts.clock;
    this.minConcurrency = Math.max(1, Math.floor(opts.config.minConcurrency ?? 1));
    this.maxConcurrency = Math.max(this.minConcurrency, Math.floor(opts.config.maxConcurrency));
    this.additiveStep = Math.max(1, Math.floor(opts.config.additiveStep ?? 1));
    const factor = opts.config.decreaseFactor ?? 0.5;
    this.decreaseFactor = Number.isFinite(factor) ? Math.max(0.1, Math.min(0.95, factor)) : 0.5;
    this.healthyWindow = Math.max(1, Math.floor(opts.config.healthyWindow ?? 10));
    this.baselineLatencyMs = Math.max(50, opts.config.baselineLatencyMs ?? 1500);
    this.latencyMultiplier = Math.max(1.1, opts.config.latencyMultiplier ?? 2.0);
    this.lowRemainingRatio = Math.max(0.01, Math.min(0.5, opts.config.lowRemainingRatio ?? 0.1));
    this.lowRemainingFloor = Math.max(0, Math.floor(opts.config.lowRemainingFloor ?? 2));

    const startConcurrency = opts.initial?.concurrency ?? opts.config.initialConcurrency ?? this.minConcurrency;
    this.concurrency = Math.max(this.minConcurrency, Math.min(this.maxConcurrency, Math.floor(startConcurrency)));
    this.paceMultiplier = Math.max(0.1, Math.min(1, opts.initial?.paceMultiplier ?? 1));
    this.healthyStreak = Math.max(0, Math.floor(opts.initial?.healthyStreak ?? 0));
    this.nextAllowedAtMs = opts.initial?.nextAllowedAtMs ?? 0;
    this.lastUpdatedAtMs = opts.initial?.lastUpdatedAtMs ?? this.clock.now();
  }

  canDispatch(): AimdDispatchWindow {
    const nowMs = this.clock.now();
    const waitMs = Math.max(0, this.nextAllowedAtMs - nowMs);
    return {
      allowed: waitMs === 0,
      waitMs,
      concurrency: this.concurrency,
      paceMultiplier: this.paceMultiplier,
    };
  }

  record(feedback: AimdFeedback): AimdSnapshot {
    const nowMs = this.clock.now();
    this.lastUpdatedAtMs = nowMs;

    const retryFromHeader = parseRetryAfterHeader(feedback.retryAfterHeader, nowMs);
    const retryMs = Math.max(feedback.retryAfterMs ?? 0, retryFromHeader ?? 0);
    if (retryMs > 0) {
      this.nextAllowedAtMs = Math.max(this.nextAllowedAtMs, nowMs + retryMs);
    }
    if (
      typeof feedback.rateLimitRemaining === "number" &&
      feedback.rateLimitRemaining <= 0 &&
      typeof feedback.rateLimitResetAtMs === "number" &&
      Number.isFinite(feedback.rateLimitResetAtMs)
    ) {
      this.nextAllowedAtMs = Math.max(this.nextAllowedAtMs, feedback.rateLimitResetAtMs);
    }

    const isServerOrRateError =
      !feedback.ok &&
      (feedback.status === undefined || feedback.status === 429 || feedback.status >= 500);
    const isLatencySpike =
      typeof feedback.latencyMs === "number" &&
      Number.isFinite(feedback.latencyMs) &&
      feedback.latencyMs > this.baselineLatencyMs * this.latencyMultiplier;
    const isLowHeadroom =
      typeof feedback.rateLimitRemaining === "number" &&
      Number.isFinite(feedback.rateLimitRemaining) &&
      (feedback.rateLimitRemaining <= this.lowRemainingFloor ||
        (typeof feedback.rateLimitLimit === "number" &&
          feedback.rateLimitLimit > 0 &&
          feedback.rateLimitRemaining / feedback.rateLimitLimit < this.lowRemainingRatio));

    if (isServerOrRateError || isLatencySpike || isLowHeadroom) {
      this.concurrency = Math.max(
        this.minConcurrency,
        Math.floor(this.concurrency * this.decreaseFactor),
      );
      this.paceMultiplier = Math.max(
        0.1,
        Number((this.paceMultiplier * this.decreaseFactor).toFixed(4)),
      );
      this.healthyStreak = 0;
      return this.snapshot();
    }

    if (feedback.ok) {
      this.healthyStreak += 1;
      if (this.healthyStreak >= this.healthyWindow) {
        this.concurrency = Math.min(this.maxConcurrency, this.concurrency + this.additiveStep);
        this.paceMultiplier = Math.min(1, Number((this.paceMultiplier + 0.05).toFixed(4)));
        this.healthyStreak = 0;
      }
    }

    return this.snapshot();
  }

  snapshot(): AimdSnapshot {
    return {
      concurrency: this.concurrency,
      paceMultiplier: this.paceMultiplier,
      healthyStreak: this.healthyStreak,
      nextAllowedAtMs: this.nextAllowedAtMs,
      lastUpdatedAtMs: this.lastUpdatedAtMs,
    };
  }
}
