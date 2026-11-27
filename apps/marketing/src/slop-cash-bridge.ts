// Spec & preview bridge for future slop.cash integration (Node 26).
// STRICTLY DISABLED BY DEFAULT (inv_slop_cash_disabled):
//   - isEnabled() returns false unless BOTH env.MARKETING_SLOP_CASH_ENABLED === "1"
//     AND explicit configEnabled === true.
//   - settleHook() fails closed with SlopCashDisabledError when disabled, then delegates
//     spend, OSS task-kind, youngest-age, and proof checks to canonical ./policy.ts.
//   - Non-OSS consumer marketing tasks (street fliering, event activations, creators, agencies)
//     are permanently ineligible for slop.cash settlement.

import { RealClock } from "../../../packages/core/src/clock.ts";
import {
  DEFAULT_SLOP_CASH_CHAIN,
  DEFAULT_SLOP_CASH_REPO,
} from "./constants.ts";
import {
  assertSpendAuth,
  evaluateProofPolicy,
  isAdultReading,
  minAgeReading,
  PolicyViolationError,
} from "./policy.ts";
import type { MarketingStore } from "./store.ts";
import type {
  Campaign,
  Clock,
  MarketingTask,
  ProofSubmission,
  SlopCashHook,
  SlopCashHookState,
  SlopCashVaultChain,
} from "./types.ts";

export class SlopCashDisabledError extends Error {
  readonly code = "SLOP_CASH_DISABLED" as const;
  readonly invariant = "inv_slop_cash_disabled" as const;

  constructor(
    message = "slop.cash settlement is disabled (MARKETING_SLOP_CASH_ENABLED=0). Street/creator payouts must use fiat rails.",
  ) {
    super(message);
    this.name = "SlopCashDisabledError";
  }
}

export type SlopCashScoreBand =
  | { band: "Micro"; points: 10 }
  | { band: "Small"; points: 30 }
  | { band: "Medium"; points: 90 }
  | { band: "Large"; points: 240 }
  | { band: "XL"; points: 450 }
  | { band: "Exceptional"; points: 750 };

export interface SlopCashBridgeOptions {
  env?: Record<string, string | undefined>;
  configEnabled?: boolean;
  clock?: Clock;
  defaultRepoSlug?: string;
  defaultVaultChain?: SlopCashVaultChain;
  store?: MarketingStore;
}

export interface SlopCashStatus {
  enabled: boolean;
  envFlag: "MARKETING_SLOP_CASH_ENABLED";
  envEnabled: boolean;
  configEnabled: boolean;
  reason: string;
  allowedTaskKinds: readonly ["oss_dev_bounty"];
  supportedChains: readonly SlopCashVaultChain[];
}

export interface SlopCashOutcomeSchema {
  schemaVersion: "slop.cash/manifest/v1-preview";
  repoSlug: string;
  issueNumber: number | null;
  vaultChain: SlopCashVaultChain;
  asset: "USDC" | "USDG";
  grossUsdcCents: number;
  protocolFeeCents: number;
  netPayoutCents: number;
  scoreBand: SlopCashScoreBand;
  proofEvidenceUrl: string | null;
  proofVerified: boolean;
  eligibleForSlopCash: boolean;
  ineligibilityReason: string | null;
}

export interface SlopCashPreview {
  hook: SlopCashHook;
  outcome: SlopCashOutcomeSchema;
  settlementBlocked: boolean;
  blockReason: string | null;
}

export interface SettleSlopCashInput {
  campaign: Campaign;
  task: MarketingTask;
  proof?: ProofSubmission | null;
  workerAge?: number | null;
  workerBanned?: boolean;
  repoSlug?: string;
  issueNumber?: number | null;
  vaultChain?: SlopCashVaultChain;
}

export interface SettleSlopCashResult {
  settled: boolean;
  hook: SlopCashHook;
  outcome: SlopCashOutcomeSchema;
  reason: string;
}

function scoreBandForCents(amountCents: number): SlopCashScoreBand {
  if (amountCents <= 2_500) return { band: "Micro", points: 10 };
  if (amountCents <= 7_500) return { band: "Small", points: 30 };
  if (amountCents <= 20_000) return { band: "Medium", points: 90 };
  if (amountCents <= 50_000) return { band: "Large", points: 240 };
  if (amountCents <= 100_000) return { band: "XL", points: 450 };
  return { band: "Exceptional", points: 750 };
}

export class SlopCashBridge {
  private readonly env: Record<string, string | undefined>;
  private readonly configEnabled: boolean;
  private readonly clock: Clock;
  private readonly defaultRepoSlug: string;
  private readonly defaultVaultChain: SlopCashVaultChain;
  private readonly store?: MarketingStore;

  constructor(opts: SlopCashBridgeOptions = {}) {
    this.env = opts.env ?? process.env;
    this.configEnabled = opts.configEnabled === true;
    this.clock = opts.clock ?? opts.store?.clock ?? new RealClock();
    this.defaultRepoSlug = opts.defaultRepoSlug ?? DEFAULT_SLOP_CASH_REPO;
    this.defaultVaultChain = opts.defaultVaultChain ?? DEFAULT_SLOP_CASH_CHAIN;
    this.store = opts.store;
  }

  /**
   * Explicitly disabled by default. Returns true ONLY when BOTH
   * MARKETING_SLOP_CASH_ENABLED === "1" AND configEnabled === true.
   */
  isEnabled(): boolean {
    return this.env.MARKETING_SLOP_CASH_ENABLED === "1" && this.configEnabled;
  }

  status(): SlopCashStatus {
    const envEnabled = this.env.MARKETING_SLOP_CASH_ENABLED === "1";
    const enabled = this.isEnabled();
    const reason = enabled
      ? "Enabled by explicit MARKETING_SLOP_CASH_ENABLED=1 and config opt-in (campaign flag and oss_dev_bounty wall still enforced)."
      : !envEnabled && !this.configEnabled
        ? "Disabled by default: MARKETING_SLOP_CASH_ENABLED is not '1' and configEnabled is false."
        : !envEnabled
          ? "Disabled: MARKETING_SLOP_CASH_ENABLED is not '1'."
          : "Disabled: explicit configEnabled opt-in is false.";
    return {
      enabled,
      envFlag: "MARKETING_SLOP_CASH_ENABLED",
      envEnabled,
      configEnabled: this.configEnabled,
      reason,
      allowedTaskKinds: ["oss_dev_bounty"],
      supportedChains: ["base", "solana", "robinhood_4663"],
    };
  }

  previewHook(
    task: MarketingTask,
    proof?: ProofSubmission | null,
    opts: {
      repoSlug?: string;
      issueNumber?: number | null;
      vaultChain?: SlopCashVaultChain;
    } = {},
  ): SlopCashPreview {
    const repoSlug = opts.repoSlug ?? this.defaultRepoSlug;
    const vaultChain = opts.vaultChain ?? this.defaultVaultChain;
    const issueNumber = opts.issueNumber ?? null;
    const enabled = this.isEnabled();
    const eligible = task.taskKind === "oss_dev_bounty";
    const ineligibilityReason = eligible
      ? null
      : `Task kind '${task.taskKind}' is a consumer/IRL marketing task and must settle via USD fiat rails, never slop.cash.`;

    const grossUsdcCents = Math.max(0, task.amountCents);
    const protocolFeeCents = grossUsdcCents > 0 ? Math.ceil(grossUsdcCents / 50) : 0;
    const netPayoutCents = Math.max(0, grossUsdcCents - protocolFeeCents);
    const scoreBand = scoreBandForCents(grossUsdcCents);

    const hookState: SlopCashHookState = enabled && eligible ? "ready_for_sync" : "disabled_stub";
    const hook: SlopCashHook = {
      id: `preview:${task.id}`,
      taskId: task.id,
      repoSlug,
      issueNumber,
      vaultChain,
      estimatedUsdcCents: grossUsdcCents,
      hookState,
      externalTxHash: null,
      createdAt: new Date(this.clock.now()).toISOString(),
    };

    const outcome: SlopCashOutcomeSchema = {
      schemaVersion: "slop.cash/manifest/v1-preview",
      repoSlug,
      issueNumber,
      vaultChain,
      asset: vaultChain === "robinhood_4663" ? "USDG" : "USDC",
      grossUsdcCents,
      protocolFeeCents,
      netPayoutCents,
      scoreBand,
      proofEvidenceUrl: proof?.evidenceUrl ?? null,
      proofVerified: Boolean(task.proofVerified && proof?.verdict === "verified"),
      eligibleForSlopCash: eligible,
      ineligibilityReason,
    };

    const settlementBlocked = !enabled || !eligible;
    const blockReason = !enabled
      ? "SLOP_CASH_DISABLED"
      : !eligible
        ? "TASK_KIND_INELIGIBLE"
        : null;

    return {
      hook,
      outcome,
      settlementBlocked,
      blockReason,
    };
  }

  /**
   * Fails closed with SlopCashDisabledError whenever disabled (the default), then
   * enforces proved marketingPolicy.canAuthorizeTaskSpend (including oss_dev_bounty),
   * youngest-age adult check, and proved proof verification via ./policy.ts.
   */
  async settleHook(input: SettleSlopCashInput): Promise<SettleSlopCashResult> {
    const slopCashEnabled = this.isEnabled() && input.campaign.slopCashEnabled;
    if (!slopCashEnabled) {
      throw new SlopCashDisabledError();
    }

    assertSpendAuth({
      campaign: input.campaign,
      tier: input.task.tier,
      amountCents: input.task.amountCents,
      useSlopCash: true,
      slopCashEnvEnabled: this.isEnabled(),
      taskKind: input.task.taskKind,
    });

    const workerAge = minAgeReading(input.workerAge, input.task.assigneeAgeYears) ?? -1;
    if (!isAdultReading(workerAge)) {
      throw new PolicyViolationError(
        "UNDERAGE_OR_UNKNOWN_WORKER",
        "inv_adult_only_paid",
        "slop.cash settlement requires a verified 18+ adult participant.",
      );
    }

    const proof = input.proof ?? null;
    const proofDecision =
      input.task.proofVerified && proof !== null && proof.verdict === "verified"
        ? evaluateProofPolicy({
            proof,
            workerAge,
            workerBanned: Boolean(input.workerBanned),
            shiftDone: true,
          })
        : { approved: false, reason: "proof_missing_or_unverified" };

    if (!proofDecision.approved) {
      throw new PolicyViolationError(
        "PROOF_NOT_VERIFIED",
        "inv_proof_required_before_payout",
        `slop.cash settlement requires a verified proof (${proofDecision.reason ?? "proof_not_verified"}).`,
      );
    }

    const preview = this.previewHook(input.task, proof, {
      repoSlug: input.repoSlug,
      issueNumber: input.issueNumber,
      vaultChain: input.vaultChain,
    });

    const persistedHook = this.store
      ? await this.store.upsertSlopCashHook({
          taskId: input.task.id,
          repoSlug: preview.hook.repoSlug,
          issueNumber: preview.hook.issueNumber,
          vaultChain: preview.hook.vaultChain,
          estimatedUsdcCents: preview.hook.estimatedUsdcCents,
          hookState: "manifest_submitted",
          enabled: true,
        })
      : { ...preview.hook, hookState: "manifest_submitted" as const };

    return {
      settled: false,
      hook: persistedHook,
      outcome: preview.outcome,
      reason:
        "Manifest prepared under explicit opt-in; on-chain ProjectEscrow settlement awaits UTC monthly close.",
    };
  }
}
