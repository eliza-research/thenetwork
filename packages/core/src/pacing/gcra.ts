import type { Clock } from "../clock.ts";

export type GcraLevel = "org" | "platform" | "account" | "campaign" | "recipient";

export interface GcraLimitSpec {
  readonly level: GcraLevel;
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly burst?: number;
}

export interface GcraStepResult {
  readonly allowed: boolean;
  readonly nextTatMs: number;
  readonly retryAfterMs: number;
}

export interface GcraDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  readonly blockedLevel?: GcraLevel;
  readonly blockedKey?: string;
  readonly nextTatByKey?: Readonly<Record<string, number>>;
}

export type GcraSnapshot = Readonly<Record<string, number>>;

export interface HierarchyBudgetInput {
  readonly org?: { readonly key?: string; readonly limit: number; readonly windowMs: number; readonly burst?: number };
  readonly platform?: { readonly key: string; readonly limit: number; readonly windowMs: number; readonly burst?: number };
  readonly account?: { readonly key: string; readonly limit: number; readonly windowMs: number; readonly burst?: number };
  readonly campaign?: { readonly key: string; readonly limit: number; readonly windowMs: number; readonly burst?: number };
  readonly recipient?: { readonly key: string; readonly limit: number; readonly windowMs: number; readonly burst?: number };
}

export function gcraStep(
  tatMs: number,
  nowMs: number,
  limit: number,
  windowMs: number,
  burst = 0,
  cost = 1,
): GcraStepResult {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
    return { allowed: false, nextTatMs: tatMs, retryAfterMs: Math.max(1000, Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 1000) };
  }
  const safeCost = Number.isFinite(cost) && cost > 0 ? cost : 1;
  const safeBurst = Number.isFinite(burst) && burst >= 0 ? burst : 0;
  const emissionIntervalMs = windowMs / limit;
  const toleranceMs = safeBurst * emissionIntervalMs;
  const incrementMs = safeCost * emissionIntervalMs;
  const baseMs = Math.max(tatMs, nowMs);
  const allowAtMs = baseMs - toleranceMs;
  if (nowMs < allowAtMs) {
    return {
      allowed: false,
      nextTatMs: tatMs,
      retryAfterMs: Math.max(1, Math.ceil(allowAtMs - nowMs)),
    };
  }
  return {
    allowed: true,
    nextTatMs: baseMs + incrementMs,
    retryAfterMs: 0,
  };
}

export function buildHierarchySpecs(input: HierarchyBudgetInput): GcraLimitSpec[] {
  const specs: GcraLimitSpec[] = [];
  if (input.recipient) {
    specs.push({
      level: "recipient",
      key: `recipient:${input.recipient.key}`,
      limit: input.recipient.limit,
      windowMs: input.recipient.windowMs,
      burst: input.recipient.burst,
    });
  }
  if (input.campaign) {
    specs.push({
      level: "campaign",
      key: `campaign:${input.campaign.key}`,
      limit: input.campaign.limit,
      windowMs: input.campaign.windowMs,
      burst: input.campaign.burst,
    });
  }
  if (input.account) {
    specs.push({
      level: "account",
      key: `account:${input.account.key}`,
      limit: input.account.limit,
      windowMs: input.account.windowMs,
      burst: input.account.burst,
    });
  }
  if (input.platform) {
    specs.push({
      level: "platform",
      key: `platform:${input.platform.key}`,
      limit: input.platform.limit,
      windowMs: input.platform.windowMs,
      burst: input.platform.burst,
    });
  }
  if (input.org) {
    specs.push({
      level: "org",
      key: `org:${input.org.key ?? "global"}`,
      limit: input.org.limit,
      windowMs: input.org.windowMs,
      burst: input.org.burst,
    });
  }
  return specs;
}

export class HierarchicalGcraLimiter {
  private readonly clock: Clock;
  private readonly tats = new Map<string, number>();

  constructor(opts: { readonly clock: Clock; readonly initialTats?: GcraSnapshot }) {
    this.clock = opts.clock;
    if (opts.initialTats) {
      this.restore(opts.initialTats);
    }
  }

  evaluate(specs: readonly GcraLimitSpec[], cost = 1): GcraDecision {
    const nowMs = this.clock.now();
    const pending: Record<string, number> = {};
    let maxRetryAfterMs = 0;
    let blockedLevel: GcraLevel | undefined;
    let blockedKey: string | undefined;

    for (const spec of specs) {
      const currentTat = pending[spec.key] ?? this.tats.get(spec.key) ?? nowMs;
      const step = gcraStep(currentTat, nowMs, spec.limit, spec.windowMs, spec.burst ?? 0, cost);
      if (!step.allowed) {
        if (step.retryAfterMs > maxRetryAfterMs) {
          maxRetryAfterMs = step.retryAfterMs;
          blockedLevel = spec.level;
          blockedKey = spec.key;
        }
      } else {
        pending[spec.key] = step.nextTatMs;
      }
    }

    if (blockedLevel !== undefined) {
      return {
        allowed: false,
        retryAfterMs: maxRetryAfterMs,
        blockedLevel,
        blockedKey,
      };
    }

    return {
      allowed: true,
      retryAfterMs: 0,
      nextTatByKey: pending,
    };
  }

  tryReserve(specs: readonly GcraLimitSpec[], cost = 1): GcraDecision {
    const decision = this.evaluate(specs, cost);
    if (decision.allowed && decision.nextTatByKey) {
      for (const [key, tat] of Object.entries(decision.nextTatByKey)) {
        this.tats.set(key, tat);
      }
    }
    return decision;
  }

  snapshot(): GcraSnapshot {
    const out: Record<string, number> = {};
    for (const [key, tat] of this.tats.entries()) {
      out[key] = tat;
    }
    return out;
  }

  restore(tats: GcraSnapshot): void {
    this.tats.clear();
    for (const [key, tat] of Object.entries(tats)) {
      if (typeof tat === "number" && Number.isFinite(tat)) {
        this.tats.set(key, tat);
      }
    }
  }

  prune(maxIdleMs = 86_400_000): number {
    const cutoff = this.clock.now() - Math.max(0, maxIdleMs);
    let removed = 0;
    for (const [key, tat] of this.tats.entries()) {
      if (tat < cutoff) {
        this.tats.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
