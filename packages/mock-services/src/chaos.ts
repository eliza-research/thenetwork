import { hash32, Rng } from "@thenetwork/core";
import type { MockServiceName } from "./state.ts";

export type ChaosFaultKind =
  | { kind: "latency"; medianMs: number; sigma?: number }
  | { kind: "http_error"; status: number; body?: Record<string, unknown>; retryAfterSec?: number }
  | { kind: "rate_limit_spike"; multiplier: number; retryAfterSec: number }
  | { kind: "shadowban_wave"; reachMultiplier: number; accounts?: string[] }
  | { kind: "captcha_wave"; probability: number }
  | { kind: "account_lock"; accounts: string[] }
  | { kind: "blooio_safety"; action: "reply_only" | "new_conversations_paused" | "account_review" }
  | { kind: "email_bounce_storm"; hardBounceRate: number; spamComplaintRate: number }
  | { kind: "tcp_drop" }
  | { kind: "malformed_json" };

export interface ChaosRule {
  id: string;
  service: MockServiceName | "*";
  pathPattern?: string;
  probability: number;
  fault: ChaosFaultKind;
  startsAtSimMs?: number;
  expiresAtSimMs?: number;
  enabled: boolean;
}

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  used: number;
  resetAtSec: number;
  resetAfterSec: number;
  retryAfterSec: number;
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  consume(
    bucketKey: string,
    nowMs: number,
    config: RateLimitConfig,
    cost = 1,
  ): RateLimitResult {
    const windowStart = nowMs - config.windowMs;
    const prev = this.buckets.get(bucketKey) ?? [];
    const active = prev.filter((ts) => ts > windowStart);
    const limit = Math.max(1, Math.floor(config.limit));
    const resetAtMs = active.length > 0 ? active[0]! + config.windowMs : nowMs + config.windowMs;
    const resetAfterSec = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
    const resetAtSec = Math.ceil(resetAtMs / 1000);

    if (active.length + cost > limit) {
      this.buckets.set(bucketKey, active);
      return {
        allowed: false,
        limit,
        remaining: 0,
        used: active.length,
        resetAtSec,
        resetAfterSec,
        retryAfterSec: resetAfterSec,
      };
    }

    for (let i = 0; i < cost; i += 1) {
      active.push(nowMs);
    }
    this.buckets.set(bucketKey, active);

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - active.length),
      used: active.length,
      resetAtSec,
      resetAfterSec,
      retryAfterSec: 0,
    };
  }

  reset(prefix?: string): void {
    if (!prefix) {
      this.buckets.clear();
      return;
    }
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) this.buckets.delete(key);
    }
  }
}

function matchesPath(pattern: string | undefined, path: string): boolean {
  if (!pattern || pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return path === pattern || path.startsWith(pattern);
}

export class ChaosEngine {
  private readonly rules = new Map<string, ChaosRule>();
  private readonly limiter = new SlidingWindowRateLimiter();
  private evalCounter = 0;

  listRules(): ChaosRule[] {
    return [...this.rules.values()];
  }

  upsertRule(rule: ChaosRule): ChaosRule {
    this.rules.set(rule.id, { ...rule });
    return rule;
  }

  replaceRules(rules: readonly ChaosRule[]): ChaosRule[] {
    this.rules.clear();
    for (const r of rules) {
      this.rules.set(r.id, { ...r });
    }
    return this.listRules();
  }

  deleteRule(id: string): boolean {
    return this.rules.delete(id);
  }

  clear(): void {
    this.rules.clear();
    this.limiter.reset();
    this.evalCounter = 0;
  }

  resetRateLimits(prefix?: string): void {
    this.limiter.reset(prefix);
  }

  activeRulesFor(service: MockServiceName, path: string, nowMs: number): ChaosRule[] {
    const matched: ChaosRule[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      if (rule.service !== "*" && rule.service !== service) continue;
      if (!matchesPath(rule.pathPattern, path)) continue;
      if (rule.startsAtSimMs !== undefined && nowMs < rule.startsAtSimMs) continue;
      if (rule.expiresAtSimMs !== undefined && nowMs > rule.expiresAtSimMs) continue;
      matched.push(rule);
    }
    return matched;
  }

  checkRateLimit(
    sessionId: string,
    service: MockServiceName,
    bucketSuffix: string,
    path: string,
    nowMs: number,
    baseConfig: RateLimitConfig,
  ): { result: RateLimitResult; chaosRuleId?: string } {
    const rules = this.activeRulesFor(service, path, nowMs);
    let effectiveLimit = baseConfig.limit;
    let overrideRetryAfter: number | undefined;
    let chaosRuleId: string | undefined;

    for (const r of rules) {
      if (r.fault.kind === "rate_limit_spike") {
        effectiveLimit = Math.max(1, Math.floor(baseConfig.limit / Math.max(1, r.fault.multiplier)));
        overrideRetryAfter = r.fault.retryAfterSec;
        chaosRuleId = r.id;
      }
    }

    const res = this.limiter.consume(
      `${sessionId}:${service}:${bucketSuffix}`,
      nowMs,
      { limit: effectiveLimit, windowMs: baseConfig.windowMs },
    );

    if (!res.allowed && overrideRetryAfter !== undefined) {
      return {
        result: { ...res, retryAfterSec: overrideRetryAfter, resetAfterSec: overrideRetryAfter },
        chaosRuleId,
      };
    }
    return { result: res, chaosRuleId: !res.allowed ? chaosRuleId : undefined };
  }

  evaluateHttpFault(
    service: MockServiceName,
    path: string,
    nowMs: number,
    seed: number,
  ): { rule: ChaosRule; delayMs?: number } | null {
    const rules = this.activeRulesFor(service, path, nowMs);
    for (const rule of rules) {
      const k = rule.fault.kind;
      if (
        k !== "latency" &&
        k !== "http_error" &&
        k !== "tcp_drop" &&
        k !== "malformed_json"
      ) {
        continue;
      }
      this.evalCounter += 1;
      const rng = new Rng(hash32("chaos", seed, rule.id, service, path, this.evalCounter));
      if (!rng.bool(Math.max(0, Math.min(1, rule.probability)))) continue;
      if (rule.fault.kind === "latency") {
        const sigma = rule.fault.sigma ?? 0.25;
        const delayMs = Math.max(1, Math.round(rng.logNormal(rule.fault.medianMs, sigma)));
        return { rule, delayMs };
      }
      return { rule };
    }
    return null;
  }

  domainFaultOf<K extends ChaosFaultKind["kind"]>(
    service: MockServiceName,
    path: string,
    nowMs: number,
    kind: K,
  ): { rule: ChaosRule; fault: Extract<ChaosFaultKind, { kind: K }> } | null {
    const rules = this.activeRulesFor(service, path, nowMs);
    for (const rule of rules) {
      if (rule.fault.kind === kind) {
        return { rule, fault: rule.fault as Extract<ChaosFaultKind, { kind: K }> };
      }
    }
    return null;
  }
}
