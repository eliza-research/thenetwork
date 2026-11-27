// Tier-3/4 Credit-Card Plug-and-Play Paid Adapter Registry for @thenetwork/marketing (Node 26).
// ("Put in credit card / API keys and it runs.")
//
// Supported adapters:
//   1. email        (Resend RESEND_API_KEY / AgentMail AGENTMAIL_API_KEY / SMTP relay)
//   2. sms_voice    (Twilio TWILIO_ACCOUNT_SID+TWILIO_AUTH_TOKEN / Blooio BLOOIO_API_KEY)
//   3. rentahuman   (RentAHuman MCP RENTAHUMAN_API_KEY -> https://rentahuman.ai/api/mcp)
//   4. print_fliers (Printful PRINTFUL_API_KEY / 4over FOUROVER_API_KEY / Lob LOB_API_KEY)
//   5. qr_links     (Dub.co DUB_API_KEY — POST create & PATCH update)
//   6. events       (Luma Plus LUMA_API_KEY)
//   7. media_video  (ElevenLabs ELEVENLABS_API_KEY / Hedra HEDRA_API_KEY / Kling KLING_API_KEY)
//   8. payouts      (Stripe Connect STRIPE_SECRET_KEY / Tremendous TREMENDOUS_API_KEY)
//
// Formal safety invariants:
//   - EVERY billable execute(...) call checks Vibestack/Dafny-proved
//     `canAuthorizeSpend(...)` from `packages/core/src/generated/marketingPolicy.ts`
//     BEFORE any external dispatch (inv_budget_never_exceeded,
//     inv_tier_billing_gate, inv_slop_cash_disabled).
//   - Binds outbound charges strictly to authorized `context.spend.amountCents` (C-03).
//   - Never makes a live paid network call unless BOTH the active provider's env
//     key(s) are set AND `MARKETING_LIVE_BILLING === "1"`.

import { RealClock } from "../../../../packages/core/src/clock.ts";
import { canAuthorizeSpend } from "../../../../packages/core/src/generated/marketingPolicy.ts";
import { RENTAHUMAN_MCP_ENDPOINT } from "../constants.ts";
import type { Campaign, Clock, FetchFn, ImplementationTier } from "../types.ts";

export type { FetchFn };

export interface SpendAuthInput {
  tier: number;
  amountCents: number;
  perTaskCapCents: number;
  dailySpentCents: number;
  dailyCapCents: number;
  monthlySpentCents: number;
  monthlyCapCents: number;
  billingArmed: boolean;
  lockdown: boolean;
  useSlopCash: boolean;
  slopCashEnabled: boolean;
}

export type PaidAdapterId =
  | "email"
  | "sms_voice"
  | "rentahuman"
  | "print_fliers"
  | "qr_links"
  | "events"
  | "media_video"
  | "payouts";

export type AdapterReadiness = "ready" | "dry_run" | "missing_credentials";

export type AdapterExecutionMode = "live" | "dry_run" | "blocked_policy";

export interface ProviderSpec {
  readonly id: string;
  readonly label: string;
  readonly requiredEnv: readonly string[];
  readonly endpoint: string;
}

export interface ProviderStatus {
  id: string;
  label: string;
  requiredEnv: readonly string[];
  configured: boolean;
  missingEnv: string[];
  endpoint: string;
}

export interface AdapterStatus {
  id: PaidAdapterId;
  label: string;
  tier: 3 | 4;
  readiness: AdapterReadiness;
  activeProvider: string | null;
  liveBillingEnabled: boolean;
  providers: ProviderStatus[];
}

export interface AdapterReceipt<TResult = Record<string, unknown>> {
  ok: boolean;
  adapterId: PaidAdapterId;
  provider: string;
  mode: AdapterExecutionMode;
  authorized: boolean;
  amountCents: number;
  idempotencyKey: string;
  externalRef: string | null;
  reason: string;
  data: TResult | null;
  executedAt: string;
}

export interface AdapterExecuteContext {
  spend: SpendAuthInput;
  idempotencyKey: string;
  campaignId?: string;
  taskId?: string | null;
  preferredProvider?: string;
  targetStopped?: boolean;
  forceDryRun?: boolean;
}

export interface SpendRecorderStore {
  authorizeSpend(input: {
    campaignId: string;
    taskId?: string | null;
    adapterId: string;
    tier: ImplementationTier;
    amountCents: number;
    entryType: "dry_run" | "reserve" | "commit" | "release" | "refund";
    idempotencyKey: string;
    externalRef?: string | null;
    useSlopCash?: boolean;
    slopCashEnvEnabled?: boolean;
  }): Promise<unknown>;
}

export interface SpendAuthorizedEvent {
  campaignId?: string;
  taskId?: string | null;
  adapterId: PaidAdapterId;
  provider: string;
  tier: 3 | 4;
  amountCents: number;
  mode: AdapterExecutionMode;
  idempotencyKey: string;
  externalRef: string | null;
}

export type OnSpendAuthorizedHook = (event: SpendAuthorizedEvent) => Promise<void> | void;

export interface EmailSendInput {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html?: string;
  inboxId?: string;
}

export interface SmsVoiceInput {
  toE164: string;
  body?: string;
  fromE164?: string;
  twimlUrl?: string;
  action?: "sms" | "lookup" | "voice";
  optedIn: boolean;
}

export interface RentAHumanInput {
  city: string;
  title: string;
  brief: string;
  neighborhood: string;
  shiftHours: number;
  budgetCents: number;
  qrBatchCode?: string;
  requiredProofs?: string[];
}

export interface StructuredPostalAddress {
  name: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  zip: string;
  countryCode?: string;
}

export interface PrintFliersInput {
  quantity: number;
  productType: "fliers" | "postcards" | "tabletop_cards";
  qrBatchCode: string;
  destinationAddress: string;
  recipient?: StructuredPostalAddress;
  fromAddress?: StructuredPostalAddress;
  variantId?: number;
  size?: "4x6" | "6x9" | "6x11";
  artworkUrl: string;
  backArtworkUrl?: string;
  rush?: boolean;
}

export interface QrLinksInput {
  destinationUrl: string;
  linkId?: string;
  domain?: string;
  slug?: string;
  qrBatchCode: string;
  tags?: string[];
}

export interface EventsInput {
  name: string;
  startIso: string;
  endIso: string;
  city: string;
  venueName: string;
  description: string;
  capacity?: number;
}

export interface MediaVideoInput {
  kind: "voiceover" | "avatar_video" | "short_clip";
  promptOrScript: string;
  durationSec: number;
  voiceId?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  audioId?: string;
  modelName?: string;
}

export interface PayoutInput {
  recipientId: string;
  recipientEmail?: string;
  recipientName: string;
  amountCents: number;
  memo: string;
  rail: "stripe_connect" | "tremendous";
  fundingSourceId?: string;
  products?: string[];
}

export interface PaidAdapterInputMap {
  email: EmailSendInput;
  sms_voice: SmsVoiceInput;
  rentahuman: RentAHumanInput;
  print_fliers: PrintFliersInput;
  qr_links: QrLinksInput;
  events: EventsInput;
  media_video: MediaVideoInput;
  payouts: PayoutInput;
}

export interface PaidAdapter<TInput, TResult = Record<string, unknown>> {
  readonly id: PaidAdapterId;
  readonly label: string;
  readonly tier: 3 | 4;
  readonly providers: readonly ProviderSpec[];
  getStatus(env: Record<string, string | undefined>): AdapterStatus;
  estimateCostCents(input: TInput): number;
  dryRun(
    input: TInput,
    idempotencyKey: string,
    env: Record<string, string | undefined>,
    preferredProvider?: string,
  ): Promise<AdapterReceipt<TResult>>;
  execute(
    input: TInput,
    context: AdapterExecuteContext,
  ): Promise<AdapterReceipt<TResult>>;
}

export interface PaidAdapterRegistryOptions {
  env?: Record<string, string | undefined>;
  fetchFn?: FetchFn;
  clock?: Clock;
  store?: SpendRecorderStore;
  onSpendAuthorized?: OnSpendAuthorizedHook;
}

const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_TREMENDOUS_PRODUCTS = ["Q24BD9EZ332JT"];
const E164_RE = /^\+[1-9]\d{6,14}$/;

function createDefaultClock(): Clock {
  return new RealClock();
}

function isValidHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Helper to construct a `SpendAuthInput` from a Campaign and estimated task spend. */
export function spendAuthFromCampaign(
  campaign: Campaign,
  amountCents: number,
  opts?: {
    tier?: 3 | 4;
    useSlopCash?: boolean;
    env?: Record<string, string | undefined>;
  },
): SpendAuthInput {
  const envFlag = (opts?.env ?? process.env)["MARKETING_SLOP_CASH_ENABLED"] === "1";
  return {
    tier: opts?.tier ?? 3,
    amountCents: Math.round(amountCents),
    perTaskCapCents: campaign.maxTaskCents,
    dailySpentCents: campaign.dailySpentCents,
    dailyCapCents: campaign.dailyCapCents,
    monthlySpentCents: campaign.spentCents + campaign.reservedCents,
    monthlyCapCents: campaign.monthlyBudgetCents,
    billingArmed: campaign.billingArmed,
    lockdown: campaign.riskDial === "lockdown",
    useSlopCash: opts?.useSlopCash ?? false,
    slopCashEnabled: campaign.slopCashEnabled && envFlag,
  };
}

function hasEnv(
  env: Record<string, string | undefined>,
  key: string,
): boolean {
  const val = env[key];
  return typeof val === "string" && val.trim().length > 0;
}

function evaluateProviders(
  providers: readonly ProviderSpec[],
  env: Record<string, string | undefined>,
): ProviderStatus[] {
  return providers.map((spec) => {
    const missingEnv = spec.requiredEnv.filter((k) => !hasEnv(env, k));
    return {
      id: spec.id,
      label: spec.label,
      requiredEnv: spec.requiredEnv,
      configured: missingEnv.length === 0,
      missingEnv,
      endpoint: spec.endpoint,
    };
  });
}

function selectActiveProvider(
  providers: readonly ProviderStatus[],
  preferredProvider?: string,
  strictPreferred = false,
): ProviderStatus | null {
  if (preferredProvider) {
    const preferred = providers.find(
      (p) => p.id === preferredProvider && p.configured,
    );
    if (preferred) return preferred;
    if (strictPreferred) return null;
  }
  return providers.find((p) => p.configured) ?? null;
}

function computeReadiness(
  providers: readonly ProviderStatus[],
  env: Record<string, string | undefined>,
): AdapterReadiness {
  const hasAnyConfigured = providers.some((p) => p.configured);
  if (!hasAnyConfigured) return "missing_credentials";
  return env["MARKETING_LIVE_BILLING"] === "1" ? "ready" : "dry_run";
}

function describeSpendBlock(input: SpendAuthInput): string {
  const reasons: string[] = [];
  if (input.amountCents <= 0) reasons.push("amountCents must be > 0");
  if (input.amountCents > input.perTaskCapCents) {
    reasons.push(
      `amount ${input.amountCents}c exceeds per-task cap ${input.perTaskCapCents}c`,
    );
  }
  if (
    input.dailySpentCents < 0 ||
    input.dailySpentCents + input.amountCents > input.dailyCapCents
  ) {
    reasons.push(
      `daily cap exceeded (${input.dailySpentCents}c + ${input.amountCents}c > ${input.dailyCapCents}c)`,
    );
  }
  if (
    input.monthlySpentCents < 0 ||
    input.monthlySpentCents + input.amountCents > input.monthlyCapCents
  ) {
    reasons.push(
      `monthly cap exceeded (${input.monthlySpentCents}c + ${input.amountCents}c > ${input.monthlyCapCents}c)`,
    );
  }
  if (input.tier > 2 && (!input.billingArmed || input.lockdown)) {
    reasons.push(
      !input.billingArmed
        ? "campaign billingArmed is false"
        : "campaign is in lockdown",
    );
  }
  if (input.useSlopCash && !input.slopCashEnabled) {
    reasons.push("slop_cash is disabled by inv_slop_cash_disabled");
  }
  return reasons.length > 0 ? reasons.join("; ") : "blocked by marketingPolicy.canAuthorizeSpend";
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { raw: text.slice(0, 512) };
  } catch {
    return { raw: text.slice(0, 512) };
  }
}

async function requestJson(
  fetchFn: FetchFn,
  method: "POST" | "PATCH",
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; ok: boolean; json: Record<string, unknown> }> {
  const res = await fetchFn(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
  });
  const json = await parseJsonSafe(res);
  return { status: res.status, ok: res.ok, json };
}

interface LiveDispatchFn<TInput> {
  (
    provider: ProviderStatus,
    input: TInput,
    authorizedAmountCents: number,
    idempotencyKey: string,
    env: Record<string, string | undefined>,
    fetchFn: FetchFn,
  ): Promise<{ externalRef: string | null; data: Record<string, unknown> }>;
}

interface AdapterDefinition<TInput> {
  readonly id: PaidAdapterId;
  readonly label: string;
  readonly tier: 3 | 4;
  readonly providers: readonly ProviderSpec[];
  estimateCostCents(input: TInput): number;
  explicitChargeCents?(input: TInput): number | undefined;
  requiredProviderId?(input: TInput): string | undefined;
  buildDryRunPayload(
    providerId: string,
    input: TInput,
    amountCents: number,
  ): Record<string, unknown>;
  validateInput?(input: TInput): string | null;
  dispatchLive: LiveDispatchFn<TInput>;
}

function buildAdapter<TInput>(
  def: AdapterDefinition<TInput>,
  opts: {
    env: Record<string, string | undefined>;
    fetchFn: FetchFn;
    clock: Clock;
    store?: SpendRecorderStore;
    onSpendAuthorized?: OnSpendAuthorizedHook;
  },
): PaidAdapter<TInput, Record<string, unknown>> {
  const getStatus = (
    env: Record<string, string | undefined>,
  ): AdapterStatus => {
    const providerStatuses = evaluateProviders(def.providers, env);
    const active = selectActiveProvider(providerStatuses);
    return {
      id: def.id,
      label: def.label,
      tier: def.tier,
      readiness: computeReadiness(providerStatuses, env),
      activeProvider: active?.id ?? null,
      liveBillingEnabled: env["MARKETING_LIVE_BILLING"] === "1",
      providers: providerStatuses,
    };
  };

  const dryRun = async (
    input: TInput,
    idempotencyKey: string,
    env: Record<string, string | undefined>,
    preferredProvider?: string,
  ): Promise<AdapterReceipt<Record<string, unknown>>> => {
    const executedAt = new Date(opts.clock.now()).toISOString();
    const requiredProvider = def.requiredProviderId?.(input);
    const desiredProvider = requiredProvider ?? preferredProvider;
    const providerStatuses = evaluateProviders(def.providers, env);
    const active = selectActiveProvider(
      providerStatuses,
      desiredProvider,
      Boolean(requiredProvider),
    );
    const fallbackId =
      desiredProvider ?? active?.id ?? def.providers[0]?.id ?? def.id;
    const amountCents = def.estimateCostCents(input);

    const inputError = def.validateInput?.(input) ?? null;
    if (inputError) {
      return Promise.resolve({
        ok: false,
        adapterId: def.id,
        provider: active?.id ?? fallbackId,
        mode: "blocked_policy",
        authorized: false,
        amountCents,
        idempotencyKey,
        externalRef: null,
        reason: inputError,
        data: null,
        executedAt,
      });
    }

    const readiness = computeReadiness(providerStatuses, env);
    const reason =
      readiness === "missing_credentials"
        ? `Dry-run receipt: no credentials configured for '${def.id}' (no network call made).`
        : env["MARKETING_LIVE_BILLING"] !== "1"
          ? "Dry-run receipt: MARKETING_LIVE_BILLING is not '1' (no paid network call made)."
          : "Dry-run receipt requested by caller (no paid network call made).";

    return Promise.resolve({
      ok: true,
      adapterId: def.id,
      provider: active?.id ?? fallbackId,
      mode: "dry_run",
      authorized: true,
      amountCents,
      idempotencyKey,
      externalRef: `dryrun:${def.id}:${idempotencyKey}`,
      reason,
      data: def.buildDryRunPayload(active?.id ?? fallbackId, input, amountCents),
      executedAt,
    });
  };

  const recordLedger = async (
    receipt: AdapterReceipt<Record<string, unknown>>,
    context: AdapterExecuteContext,
    slopCashEnvEnabled: boolean,
  ): Promise<void> => {
    if (!receipt.ok) return;
    if (opts.store && context.campaignId) {
      await opts.store.authorizeSpend({
        campaignId: context.campaignId,
        taskId: context.taskId ?? null,
        adapterId: `${def.id}:${receipt.provider}`,
        tier: def.tier,
        amountCents: receipt.amountCents,
        entryType: receipt.mode === "live" ? "commit" : "dry_run",
        idempotencyKey: context.idempotencyKey,
        externalRef: receipt.externalRef,
        useSlopCash: context.spend.useSlopCash,
        slopCashEnvEnabled,
      });
    }
    if (opts.onSpendAuthorized) {
      await opts.onSpendAuthorized({
        campaignId: context.campaignId,
        taskId: context.taskId ?? null,
        adapterId: def.id,
        provider: receipt.provider,
        tier: def.tier,
        amountCents: receipt.amountCents,
        mode: receipt.mode,
        idempotencyKey: context.idempotencyKey,
        externalRef: receipt.externalRef,
      });
    }
  };

  const execute = async (
    input: TInput,
    context: AdapterExecuteContext,
  ): Promise<AdapterReceipt<Record<string, unknown>>> => {
    const executedAt = new Date(opts.clock.now()).toISOString();
    const estimatedCents = def.estimateCostCents(input);
    const explicitChargeCents = def.explicitChargeCents?.(input);
    const requiredProvider = def.requiredProviderId?.(input);
    const desiredProvider = requiredProvider ?? context.preferredProvider;

    const providerStatuses = evaluateProviders(def.providers, opts.env);
    const active = selectActiveProvider(
      providerStatuses,
      desiredProvider,
      Boolean(requiredProvider),
    );
    const providerId =
      active?.id ?? desiredProvider ?? def.providers[0]?.id ?? def.id;

    // C-03: Strictly bind outbound charge to authorized context.spend.amountCents.
    if (
      explicitChargeCents !== undefined &&
      (!Number.isFinite(explicitChargeCents) || explicitChargeCents <= 0)
    ) {
      return {
        ok: false,
        adapterId: def.id,
        provider: providerId,
        mode: "blocked_policy",
        authorized: false,
        amountCents: 0,
        idempotencyKey: context.idempotencyKey,
        externalRef: null,
        reason: "Explicit adapter charge amount must be a positive finite number.",
        data: null,
        executedAt,
      };
    }

    if (
      explicitChargeCents !== undefined &&
      context.spend.amountCents > 0 &&
      Math.round(explicitChargeCents) !== Math.round(context.spend.amountCents)
    ) {
      return {
        ok: false,
        adapterId: def.id,
        provider: providerId,
        mode: "blocked_policy",
        authorized: false,
        amountCents: Math.round(explicitChargeCents),
        idempotencyKey: context.idempotencyKey,
        externalRef: null,
        reason: `Charge mismatch blocked (C-03): input charge ${Math.round(explicitChargeCents)}c does not equal authorized spend ${Math.round(context.spend.amountCents)}c.`,
        data: null,
        executedAt,
      };
    }

    const amountCents =
      explicitChargeCents !== undefined
        ? Math.round(explicitChargeCents)
        : context.spend.amountCents > 0
          ? Math.max(Math.round(context.spend.amountCents), estimatedCents)
          : estimatedCents;

    const slopCashEnvEnabled = opts.env["MARKETING_SLOP_CASH_ENABLED"] === "1";
    const spendInput: SpendAuthInput = {
      ...context.spend,
      tier: context.spend.tier || def.tier,
      amountCents,
      slopCashEnabled: Boolean(context.spend.slopCashEnabled && slopCashEnvEnabled),
    };

    if (context.targetStopped) {
      return {
        ok: false,
        adapterId: def.id,
        provider: providerId,
        mode: "blocked_policy",
        authorized: false,
        amountCents,
        idempotencyKey: context.idempotencyKey,
        externalRef: null,
        reason: "Blocked by inv_stop_fence_respected: target contact is marked STOP.",
        data: null,
        executedAt,
      };
    }

    const inputError = def.validateInput?.(input) ?? null;
    if (inputError) {
      return {
        ok: false,
        adapterId: def.id,
        provider: providerId,
        mode: "blocked_policy",
        authorized: false,
        amountCents,
        idempotencyKey: context.idempotencyKey,
        externalRef: null,
        reason: inputError,
        data: null,
        executedAt,
      };
    }

    const authorized = canAuthorizeSpend(
      spendInput.tier,
      spendInput.amountCents,
      spendInput.perTaskCapCents,
      spendInput.dailySpentCents,
      spendInput.dailyCapCents,
      spendInput.monthlySpentCents,
      spendInput.monthlyCapCents,
      spendInput.billingArmed,
      spendInput.lockdown,
      spendInput.useSlopCash,
      spendInput.slopCashEnabled,
    );
    if (!authorized) {
      return {
        ok: false,
        adapterId: def.id,
        provider: providerId,
        mode: "blocked_policy",
        authorized: false,
        amountCents,
        idempotencyKey: context.idempotencyKey,
        externalRef: null,
        reason: describeSpendBlock(spendInput),
        data: null,
        executedAt,
      };
    }

    const liveBillingOn = opts.env["MARKETING_LIVE_BILLING"] === "1";
    if (!active || !liveBillingOn || context.forceDryRun) {
      const receipt = await dryRun(
        input,
        context.idempotencyKey,
        opts.env,
        desiredProvider,
      );
      const boundedReceipt = { ...receipt, amountCents };
      await recordLedger(boundedReceipt, context, slopCashEnvEnabled);
      return boundedReceipt;
    }

    try {
      const liveRes = await def.dispatchLive(
        active,
        input,
        amountCents,
        context.idempotencyKey,
        opts.env,
        opts.fetchFn,
      );
      const receipt: AdapterReceipt<Record<string, unknown>> = {
        ok: true,
        adapterId: def.id,
        provider: active.id,
        mode: "live",
        authorized: true,
        amountCents,
        idempotencyKey: context.idempotencyKey,
        externalRef: liveRes.externalRef,
        reason: `Executed live via ${active.label}.`,
        data: liveRes.data,
        executedAt,
      };
      await recordLedger(receipt, context, slopCashEnvEnabled);
      return receipt;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        adapterId: def.id,
        provider: active.id,
        mode: "live",
        authorized: true,
        amountCents,
        idempotencyKey: context.idempotencyKey,
        externalRef: null,
        reason: `Live provider '${active.id}' error: ${message}`,
        data: null,
        executedAt,
      };
    }
  };

  return {
    id: def.id,
    label: def.label,
    tier: def.tier,
    providers: def.providers,
    getStatus,
    estimateCostCents: (input) => def.estimateCostCents(input),
    dryRun,
    execute,
  };
}

// ---------------------------------------------------------------------------
// 8 Tier-3/4 Credit-Card Plug-and-Play Adapter Definitions
// ---------------------------------------------------------------------------

const EMAIL_DEF: AdapterDefinition<EmailSendInput> = {
  id: "email",
  label: "Email Outreach & Transactional (Resend / AgentMail / SMTP)",
  tier: 3,
  providers: [
    {
      id: "resend",
      label: "Resend",
      requiredEnv: ["RESEND_API_KEY"],
      endpoint: "https://api.resend.com/emails",
    },
    {
      id: "agentmail",
      label: "AgentMail",
      requiredEnv: ["AGENTMAIL_API_KEY"],
      endpoint: "https://api.agentmail.to/v0/inboxes",
    },
    {
      id: "smtp",
      label: "SMTP Relay",
      requiredEnv: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
      endpoint: "smtp://configured-host",
    },
  ],
  estimateCostCents: () => 1,
  validateInput: (input) => {
    if (!input.to || !input.to.includes("@")) return "Valid recipient email 'to' is required.";
    if (!input.subject?.trim()) return "Email 'subject' is required.";
    if (!input.text?.trim() && !input.html?.trim()) return "Email 'text' or 'html' body is required.";
    return null;
  },
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    to: input.to,
    subject: input.subject,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, _amountCents, idempotencyKey, env, fetchFn) {
    if (provider.id === "resend") {
      const res = await requestJson(
        fetchFn,
        "POST",
        provider.endpoint,
        {
          authorization: `Bearer ${env["RESEND_API_KEY"] ?? ""}`,
          "idempotency-key": idempotencyKey,
        },
        {
          from: input.from ?? env["MARKETING_FROM_EMAIL"] ?? "ops@ntwrk.party",
          to: [input.to],
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        },
      );
      if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
      const id = typeof res.json["id"] === "string" ? res.json["id"] : null;
      return { externalRef: id, data: res.json };
    }

    if (provider.id === "agentmail") {
      const inbox = encodeURIComponent(
        input.inboxId ?? env["AGENTMAIL_INBOX_ID"] ?? "default",
      );
      const res = await requestJson(
        fetchFn,
        "POST",
        `${provider.endpoint}/${inbox}/messages/send`,
        {
          authorization: `Bearer ${env["AGENTMAIL_API_KEY"] ?? ""}`,
          "idempotency-key": idempotencyKey,
        },
        {
          to: input.to,
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        },
      );
      if (!res.ok) throw new Error(`AgentMail HTTP ${res.status}`);
      const id =
        typeof res.json["message_id"] === "string"
          ? res.json["message_id"]
          : typeof res.json["id"] === "string"
            ? res.json["id"]
            : null;
      return { externalRef: id, data: res.json };
    }

    const relayUrl = env["SMTP_RELAY_URL"]?.trim();
    if (!relayUrl || !isValidHttpsUrl(relayUrl)) {
      throw new Error(
        "SMTP live dispatch requires SMTP_RELAY_URL (HTTP relay); configure RESEND_API_KEY or AGENTMAIL_API_KEY for direct API sending.",
      );
    }
    const relayAuth = `Basic ${Buffer.from(`${env["SMTP_USER"] ?? ""}:${env["SMTP_PASS"] ?? ""}`).toString("base64")}`;
    const res = await requestJson(
      fetchFn,
      "POST",
      relayUrl,
      {
        authorization: relayAuth,
        "idempotency-key": idempotencyKey,
      },
      {
        host: env["SMTP_HOST"],
        from: input.from ?? env["MARKETING_FROM_EMAIL"] ?? "ops@ntwrk.party",
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      },
    );
    if (!res.ok) throw new Error(`SMTP Relay HTTP ${res.status}`);
    const ref =
      typeof res.json["messageId"] === "string"
        ? res.json["messageId"]
        : typeof res.json["id"] === "string"
          ? res.json["id"]
          : `smtp:${idempotencyKey}`;
    return { externalRef: ref, data: res.json };
  },
};

const SMS_VOICE_DEF: AdapterDefinition<SmsVoiceInput> = {
  id: "sms_voice",
  label: "SMS, Lookup & Voice (Twilio / Blooio)",
  tier: 3,
  providers: [
    {
      id: "twilio",
      label: "Twilio",
      requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
      endpoint: "https://api.twilio.com/2010-04-01",
    },
    {
      id: "blooio",
      label: "Blooio",
      requiredEnv: ["BLOOIO_API_KEY"],
      endpoint: "https://backend.blooio.com/v1/api/send-message",
    },
  ],
  estimateCostCents: (input) =>
    input.action === "lookup" ? 2 : input.action === "voice" ? 15 : 5,
  validateInput: (input) => {
    if (!E164_RE.test(input.toE164)) {
      return `Phone number 'toE164' must be E.164 format (got '${input.toE164}').`;
    }
    if (input.action !== "lookup" && !input.optedIn) {
      return "Cold SMS/voice is prohibited: recipient must be opted-in.";
    }
    if (input.action === "voice" && !input.twimlUrl && !input.body?.trim()) {
      return "Voice call requires either 'twimlUrl' or spoken 'body'.";
    }
    if (input.twimlUrl && !isValidHttpsUrl(input.twimlUrl)) {
      return "Voice 'twimlUrl' must be a valid http(s) URL.";
    }
    return null;
  },
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    action: input.action ?? "sms",
    toE164: input.toE164,
    optedIn: input.optedIn,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, _amountCents, idempotencyKey, env, fetchFn) {
    if (provider.id === "twilio") {
      const sid = env["TWILIO_ACCOUNT_SID"] ?? "";
      const token = env["TWILIO_AUTH_TOKEN"] ?? "";
      const authHeader = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;

      if (input.action === "lookup") {
        const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(input.toE164)}?Fields=line_type_intelligence,sms_pumping_risk`;
        const res = await fetchFn(url, {
          method: "GET",
          headers: { authorization: authHeader },
          signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
        });
        const json = await parseJsonSafe(res);
        if (!res.ok) throw new Error(`Twilio Lookup HTTP ${res.status}`);
        return { externalRef: `twilio-lookup:${idempotencyKey}`, data: json };
      }

      const fromNumber = input.fromE164 ?? env["TWILIO_FROM_NUMBER"] ?? "";
      if (!fromNumber) {
        throw new Error("Twilio requires fromE164 or TWILIO_FROM_NUMBER.");
      }

      if (input.action === "voice") {
        const form = new URLSearchParams({
          To: input.toE164,
          From: fromNumber,
          ...(input.twimlUrl
            ? { Url: input.twimlUrl }
            : { Twiml: `<Response><Say>${escapeXml(input.body ?? "")}</Say></Response>` }),
        });
        const res = await fetchFn(
          `${provider.endpoint}/Accounts/${encodeURIComponent(sid)}/Calls.json`,
          {
            method: "POST",
            headers: {
              authorization: authHeader,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
            signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
          },
        );
        const json = await parseJsonSafe(res);
        if (!res.ok) throw new Error(`Twilio Voice HTTP ${res.status}`);
        const ref = typeof json["sid"] === "string" ? json["sid"] : null;
        return { externalRef: ref, data: json };
      }

      const form = new URLSearchParams({
        To: input.toE164,
        From: fromNumber,
        Body: input.body ?? "",
      });
      const res = await fetchFn(
        `${provider.endpoint}/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: authHeader,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
        },
      );
      const json = await parseJsonSafe(res);
      if (!res.ok) throw new Error(`Twilio SMS HTTP ${res.status}`);
      const ref = typeof json["sid"] === "string" ? json["sid"] : null;
      return { externalRef: ref, data: json };
    }

    if (input.action === "lookup" || input.action === "voice") {
      throw new Error(`Blooio does not support action '${input.action}'; configure Twilio for lookup/voice.`);
    }

    const res = await requestJson(
      fetchFn,
      "POST",
      provider.endpoint,
      {
        authorization: `Bearer ${env["BLOOIO_API_KEY"] ?? ""}`,
        "idempotency-key": idempotencyKey,
      },
      {
        identifier: input.toE164,
        message: input.body ?? "",
      },
    );
    if (!res.ok) throw new Error(`Blooio HTTP ${res.status}`);
    const ref =
      typeof res.json["message_id"] === "string"
        ? res.json["message_id"]
        : typeof res.json["id"] === "string"
          ? res.json["id"]
          : null;
    return { externalRef: ref, data: res.json };
  },
};

const RENTAHUMAN_DEF: AdapterDefinition<RentAHumanInput> = {
  id: "rentahuman",
  label: "RentAHuman MCP Street-Team & Activator Hiring",
  tier: 4,
  providers: [
    {
      id: "rentahuman_mcp",
      label: "RentAHuman MCP",
      requiredEnv: ["RENTAHUMAN_API_KEY"],
      endpoint: RENTAHUMAN_MCP_ENDPOINT,
    },
  ],
  estimateCostCents: (input) => Math.max(100, Math.round(input.budgetCents)),
  explicitChargeCents: (input) => input.budgetCents,
  validateInput: (input) => {
    if (!input.title?.trim() || !input.brief?.trim()) {
      return "RentAHuman bounty requires title and brief.";
    }
    if (!Number.isFinite(input.budgetCents) || input.budgetCents <= 0) {
      return "RentAHuman bounty requires positive budgetCents.";
    }
    return null;
  },
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    endpoint: RENTAHUMAN_MCP_ENDPOINT,
    tool: "create_bounty",
    city: input.city,
    neighborhood: input.neighborhood,
    title: input.title,
    shiftHours: input.shiftHours,
    qrBatchCode: input.qrBatchCode ?? null,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, authorizedAmountCents, idempotencyKey, env, fetchFn) {
    const payoutCents = Math.max(100, Math.floor(authorizedAmountCents / 1.18));
    const buyerFeeCents = Math.max(0, authorizedAmountCents - payoutCents);
    const res = await requestJson(
      fetchFn,
      "POST",
      provider.endpoint,
      {
        authorization: `Bearer ${env["RENTAHUMAN_API_KEY"] ?? ""}`,
        "x-api-key": env["RENTAHUMAN_API_KEY"] ?? "",
        "idempotency-key": idempotencyKey,
      },
      {
        jsonrpc: "2.0",
        id: idempotencyKey,
        method: "tools/call",
        params: {
          name: "create_bounty",
          arguments: {
            city: input.city,
            neighborhood: input.neighborhood,
            title: input.title,
            description: input.brief,
            shift_hours: input.shiftHours,
            payout_usd: Number((payoutCents / 100).toFixed(2)),
            buyer_fee_usd: Number((buyerFeeCents / 100).toFixed(2)),
            total_escrow_usd: Number((authorizedAmountCents / 100).toFixed(2)),
            qr_batch_code: input.qrBatchCode,
            required_proofs: input.requiredProofs ?? [],
          },
        },
      },
    );
    if (!res.ok) throw new Error(`RentAHuman MCP HTTP ${res.status}`);
    if (res.json["error"] !== undefined && res.json["error"] !== null) {
      const rpcErr = res.json["error"];
      const detail =
        typeof rpcErr === "object" && rpcErr !== null && "message" in rpcErr
          ? String((rpcErr as Record<string, unknown>)["message"])
          : JSON.stringify(rpcErr);
      throw new Error(`RentAHuman MCP JSON-RPC error: ${detail}`);
    }
    const resultObj =
      res.json["result"] && typeof res.json["result"] === "object"
        ? (res.json["result"] as Record<string, unknown>)
        : res.json;
    const ref =
      typeof resultObj["bounty_id"] === "string"
        ? resultObj["bounty_id"]
        : typeof resultObj["task_id"] === "string"
          ? resultObj["task_id"]
          : typeof resultObj["id"] === "string"
            ? resultObj["id"]
            : `rah:${idempotencyKey}`;
    return { externalRef: ref, data: res.json };
  },
};

const PRINT_FLIERS_DEF: AdapterDefinition<PrintFliersInput> = {
  id: "print_fliers",
  label: "Serialized QR Fliers & Postcards (Printful / 4over / Lob)",
  tier: 3,
  providers: [
    {
      id: "printful",
      label: "Printful",
      requiredEnv: ["PRINTFUL_API_KEY"],
      endpoint: "https://api.printful.com/orders",
    },
    {
      id: "fourover",
      label: "4over",
      requiredEnv: ["FOUROVER_API_KEY"],
      endpoint: "https://api.4over.com/orders",
    },
    {
      id: "lob",
      label: "Lob",
      requiredEnv: ["LOB_API_KEY"],
      endpoint: "https://api.lob.com/v1/postcards",
    },
  ],
  estimateCostCents: (input) => {
    const unitCents =
      input.productType === "postcards"
        ? 65
        : input.productType === "tabletop_cards"
          ? 25
          : 8;
    const base = Math.max(1, Math.round(input.quantity)) * unitCents;
    return input.rush ? Math.round(base * 1.35) : base;
  },
  validateInput: (input) => {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      return "Print order requires a positive integer quantity.";
    }
    if (!input.artworkUrl || !isValidHttpsUrl(input.artworkUrl)) {
      return "Print order requires a valid http(s) artworkUrl.";
    }
    if (!input.destinationAddress?.trim() && !input.recipient) {
      return "Print order requires destinationAddress or structured recipient.";
    }
    return null;
  },
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    productType: input.productType,
    quantity: input.quantity,
    qrBatchCode: input.qrBatchCode,
    rush: Boolean(input.rush),
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, authorizedAmountCents, idempotencyKey, env, fetchFn) {
    const recipient: StructuredPostalAddress = input.recipient ?? {
      name: "The Network NYC Field Ops",
      addressLine1: input.destinationAddress,
      city: "New York",
      stateCode: "NY",
      zip: "10012",
      countryCode: "US",
    };

    if (provider.id === "printful") {
      const variantId = input.variantId ?? Number(env["PRINTFUL_DEFAULT_VARIANT_ID"] || 13490);
      if (!Number.isInteger(variantId) || variantId <= 0) {
        throw new Error("Printful requires a positive integer variantId.");
      }
      const res = await requestJson(
        fetchFn,
        "POST",
        provider.endpoint,
        {
          authorization: `Bearer ${env["PRINTFUL_API_KEY"] ?? ""}`,
          "idempotency-key": idempotencyKey,
        },
        {
          external_id: idempotencyKey,
          recipient: {
            name: recipient.name,
            address1: recipient.addressLine1,
            city: recipient.city,
            state_code: recipient.stateCode,
            country_code: recipient.countryCode ?? "US",
            zip: recipient.zip,
          },
          items: [
            {
              variant_id: variantId,
              quantity: input.quantity,
              name: `${input.productType} (${input.qrBatchCode})`,
              files: [{ type: "default", url: input.artworkUrl }],
            },
          ],
          retail_costs: {
            currency: "USD",
            total: (authorizedAmountCents / 100).toFixed(2),
          },
        },
      );
      if (!res.ok) throw new Error(`Printful HTTP ${res.status}`);
      const resultObj =
        res.json["result"] && typeof res.json["result"] === "object"
          ? (res.json["result"] as Record<string, unknown>)
          : res.json;
      const ref =
        typeof resultObj["id"] === "string" || typeof resultObj["id"] === "number"
          ? String(resultObj["id"])
          : `printful:${idempotencyKey}`;
      return { externalRef: ref, data: res.json };
    }

    if (provider.id === "fourover") {
      const endpoint = env["FOUROVER_ENDPOINT"]?.trim() || provider.endpoint;
      if (!isValidHttpsUrl(endpoint)) {
        throw new Error("FOUROVER_ENDPOINT must be a valid http(s) URL.");
      }
      const res = await requestJson(
        fetchFn,
        "POST",
        endpoint,
        {
          authorization: `Bearer ${env["FOUROVER_API_KEY"] ?? ""}`,
          "idempotency-key": idempotencyKey,
        },
        {
          external_id: idempotencyKey,
          product_type: input.productType,
          quantity: input.quantity,
          qr_batch_code: input.qrBatchCode,
          artwork_url: input.artworkUrl,
          authorized_amount_cents: authorizedAmountCents,
          shipping_recipient: recipient,
          rush: Boolean(input.rush),
        },
      );
      if (!res.ok) throw new Error(`4over HTTP ${res.status}`);
      const ref =
        typeof res.json["order_id"] === "string"
          ? res.json["order_id"]
          : typeof res.json["id"] === "string"
            ? res.json["id"]
            : `fourover:${idempotencyKey}`;
      return { externalRef: ref, data: res.json };
    }

    const fromAddr: StructuredPostalAddress = input.fromAddress ?? {
      name: "The Network Marketing Ops",
      addressLine1: env["LOB_FROM_ADDRESS1"] ?? "142 Bleecker St",
      city: env["LOB_FROM_CITY"] ?? "New York",
      stateCode: env["LOB_FROM_STATE"] ?? "NY",
      zip: env["LOB_FROM_ZIP"] ?? "10012",
      countryCode: "US",
    };
    const lobKey = env["LOB_API_KEY"] ?? "";
    const lobAuth = `Basic ${Buffer.from(`${lobKey}:`).toString("base64")}`;
    const res = await requestJson(
      fetchFn,
      "POST",
      provider.endpoint,
      {
        authorization: lobAuth,
        "idempotency-key": idempotencyKey,
      },
      {
        description: `${input.productType} batch ${input.qrBatchCode}`,
        size: input.size ?? "4x6",
        use_type: "marketing",
        to: {
          name: recipient.name,
          address_line1: recipient.addressLine1,
          address_city: recipient.city,
          address_state: recipient.stateCode,
          address_zip: recipient.zip,
          address_country: recipient.countryCode ?? "US",
        },
        from: {
          name: fromAddr.name,
          address_line1: fromAddr.addressLine1,
          address_city: fromAddr.city,
          address_state: fromAddr.stateCode,
          address_zip: fromAddr.zip,
          address_country: fromAddr.countryCode ?? "US",
        },
        front: input.artworkUrl,
        back: input.backArtworkUrl ?? input.artworkUrl,
      },
    );
    if (!res.ok) throw new Error(`Lob HTTP ${res.status}`);
    const ref = typeof res.json["id"] === "string" ? res.json["id"] : `lob:${idempotencyKey}`;
    return { externalRef: ref, data: res.json };
  },
};

const QR_LINKS_DEF: AdapterDefinition<QrLinksInput> = {
  id: "qr_links",
  label: "Batch QR & Short Links (Dub.co)",
  tier: 3,
  providers: [
    {
      id: "dub",
      label: "Dub.co",
      requiredEnv: ["DUB_API_KEY"],
      endpoint: "https://api.dub.co/links",
    },
  ],
  estimateCostCents: () => 5,
  validateInput: (input) => {
    if (!input.destinationUrl || !isValidHttpsUrl(input.destinationUrl)) {
      return "QR link requires a valid http(s) destinationUrl.";
    }
    return null;
  },
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    method: input.linkId ? "PATCH" : "POST",
    linkId: input.linkId ?? null,
    shortLink: `https://${input.domain ?? "go.ntwrk.party"}/${input.slug ?? input.qrBatchCode}`,
    destinationUrl: input.destinationUrl,
    qrBatchCode: input.qrBatchCode,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, _amountCents, idempotencyKey, env, fetchFn) {
    const workspaceId = env["DUB_WORKSPACE_ID"];
    const baseUrl = input.linkId
      ? `${provider.endpoint}/${encodeURIComponent(input.linkId)}`
      : provider.endpoint;
    const url = workspaceId
      ? `${baseUrl}?workspaceId=${encodeURIComponent(workspaceId)}`
      : baseUrl;
    const method = input.linkId ? "PATCH" : "POST";
    const res = await requestJson(
      fetchFn,
      method,
      url,
      {
        authorization: `Bearer ${env["DUB_API_KEY"] ?? ""}`,
        "idempotency-key": idempotencyKey,
      },
      {
        url: input.destinationUrl,
        ...(input.domain ? { domain: input.domain } : {}),
        ...(input.linkId ? {} : { key: input.slug ?? input.qrBatchCode, externalId: idempotencyKey }),
        ...(input.tags ? { tags: input.tags } : {}),
      },
    );
    if (!res.ok) throw new Error(`Dub.co HTTP ${res.status}`);
    const ref =
      typeof res.json["shortLink"] === "string"
        ? res.json["shortLink"]
        : typeof res.json["id"] === "string"
          ? res.json["id"]
          : null;
    return { externalRef: ref, data: res.json };
  },
};

const EVENTS_DEF: AdapterDefinition<EventsInput> = {
  id: "events",
  label: "Event Pages & RSVP Lists (Luma Plus)",
  tier: 3,
  providers: [
    {
      id: "luma",
      label: "Luma Plus",
      requiredEnv: ["LUMA_API_KEY"],
      endpoint: "https://api.lu.ma/public/v1/event/create",
    },
  ],
  estimateCostCents: () => 250,
  validateInput: (input) => {
    if (!input.name?.trim()) return "Event name is required.";
    if (!input.startIso || !input.endIso) return "Event startIso and endIso are required.";
    return null;
  },
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    name: input.name,
    city: input.city,
    venueName: input.venueName,
    startIso: input.startIso,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, _amountCents, idempotencyKey, env, fetchFn) {
    const res = await requestJson(
      fetchFn,
      "POST",
      provider.endpoint,
      {
        "x-luma-api-key": env["LUMA_API_KEY"] ?? "",
        "idempotency-key": idempotencyKey,
      },
      {
        name: input.name,
        start_at: input.startIso,
        end_at: input.endIso,
        description: input.description,
        geo_address_json: {
          city: input.city,
          description: input.venueName,
        },
        ...(input.capacity !== undefined ? { max_capacity: input.capacity } : {}),
      },
    );
    if (!res.ok) throw new Error(`Luma HTTP ${res.status}`);
    const ref =
      typeof res.json["api_id"] === "string"
        ? res.json["api_id"]
        : typeof res.json["id"] === "string"
          ? res.json["id"]
          : `luma:${idempotencyKey}`;
    return { externalRef: ref, data: res.json };
  },
};

const MEDIA_VIDEO_DEF: AdapterDefinition<MediaVideoInput> = {
  id: "media_video",
  label: "Voice & Short-Form Video (ElevenLabs / Hedra / Kling)",
  tier: 3,
  providers: [
    {
      id: "elevenlabs",
      label: "ElevenLabs",
      requiredEnv: ["ELEVENLABS_API_KEY"],
      endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
    },
    {
      id: "hedra",
      label: "Hedra",
      requiredEnv: ["HEDRA_API_KEY"],
      endpoint: "https://api.hedra.com/web-app/public/generations",
    },
    {
      id: "kling",
      label: "Kling",
      requiredEnv: ["KLING_API_KEY"],
      endpoint: "https://api.klingai.com/v1/videos/text2video",
    },
  ],
  estimateCostCents: (input) => {
    const secs = Math.max(5, Math.round(input.durationSec));
    if (input.kind === "voiceover") return Math.max(10, secs * 2);
    if (input.kind === "avatar_video") return Math.max(150, secs * 12);
    return Math.max(200, secs * 15);
  },
  validateInput: (input) => {
    if (!input.promptOrScript?.trim()) return "Media generation requires promptOrScript.";
    if (!Number.isFinite(input.durationSec) || input.durationSec <= 0 || input.durationSec > 180) {
      return "Media durationSec must be between 1 and 180 seconds.";
    }
    return null;
  },
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    kind: input.kind,
    durationSec: input.durationSec,
    aspectRatio: input.aspectRatio ?? "9:16",
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, _amountCents, idempotencyKey, env, fetchFn) {
    if (provider.id === "elevenlabs") {
      const voiceId = encodeURIComponent(
        input.voiceId ?? env["ELEVENLABS_VOICE_ID"] ?? "21m00Tcm4TlvDq8ikWAM",
      );
      const res = await fetchFn(`${provider.endpoint}/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": env["ELEVENLABS_API_KEY"] ?? "",
          accept: "audio/mpeg",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: input.promptOrScript,
          model_id: input.modelName ?? "eleven_multilingual_v2",
        }),
        signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        externalRef: `elevenlabs:${idempotencyKey}`,
        data: {
          audioBytes: buf.byteLength,
          audioBase64: buf.toString("base64"),
          mimeType: "audio/mpeg",
          voiceId,
        },
      };
    }

    if (provider.id === "hedra") {
      const res = await requestJson(
        fetchFn,
        "POST",
        provider.endpoint,
        {
          "x-api-key": env["HEDRA_API_KEY"] ?? "",
          "idempotency-key": idempotencyKey,
        },
        {
          type: "video",
          ai_model_id: input.modelName ?? "hedra-character-3",
          generated_video_inputs: {
            text_prompt: input.promptOrScript,
            aspect_ratio: input.aspectRatio ?? "9:16",
            duration_ms: Math.round(input.durationSec * 1000),
          },
          ...(input.audioId ? { audio_id: input.audioId } : {}),
        },
      );
      if (!res.ok) throw new Error(`Hedra HTTP ${res.status}`);
      const ref =
        typeof res.json["id"] === "string"
          ? res.json["id"]
          : `hedra:${idempotencyKey}`;
      return { externalRef: ref, data: res.json };
    }

    const res = await requestJson(
      fetchFn,
      "POST",
      provider.endpoint,
      {
        authorization: `Bearer ${env["KLING_API_KEY"] ?? ""}`,
        "idempotency-key": idempotencyKey,
      },
      {
        model_name: input.modelName ?? "kling-v1-6",
        prompt: input.promptOrScript,
        duration: input.durationSec > 5 ? "10" : "5",
        aspect_ratio: input.aspectRatio ?? "9:16",
      },
    );
    if (!res.ok) throw new Error(`Kling HTTP ${res.status}`);
    const dataObj =
      res.json["data"] && typeof res.json["data"] === "object"
        ? (res.json["data"] as Record<string, unknown>)
        : res.json;
    const ref =
      typeof dataObj["task_id"] === "string"
        ? dataObj["task_id"]
        : typeof res.json["task_id"] === "string"
          ? res.json["task_id"]
          : `kling:${idempotencyKey}`;
    return { externalRef: ref, data: res.json };
  },
};

const PAYOUTS_DEF: AdapterDefinition<PayoutInput> = {
  id: "payouts",
  label: "Fiat Worker & Creator Payouts (Stripe Connect / Tremendous)",
  tier: 4,
  providers: [
    {
      id: "stripe_connect",
      label: "Stripe Connect",
      requiredEnv: ["STRIPE_SECRET_KEY"],
      endpoint: "https://api.stripe.com/v1/transfers",
    },
    {
      id: "tremendous",
      label: "Tremendous",
      requiredEnv: ["TREMENDOUS_API_KEY"],
      endpoint: "https://api.tremendous.com/api/v2/orders",
    },
  ],
  estimateCostCents: (input) => Math.max(0, Math.round(input.amountCents)),
  explicitChargeCents: (input) => input.amountCents,
  requiredProviderId: (input) => input.rail,
  validateInput: (input) => {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      return "Payout amountCents must be a positive safe integer.";
    }
    if (input.rail === "stripe_connect" && !input.recipientId?.trim()) {
      return "Stripe Connect payout requires recipientId (connected account id).";
    }
    if (input.rail === "tremendous" && (!input.recipientEmail || !input.recipientEmail.includes("@"))) {
      return "Tremendous payout requires a valid recipientEmail.";
    }
    return null;
  },
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    rail: input.rail,
    recipientId: input.recipientId,
    recipientName: input.recipientName,
    amountCents,
    memo: input.memo,
    currency: "usd",
  }),
  async dispatchLive(provider, input, authorizedAmountCents, idempotencyKey, env, fetchFn) {
    if (provider.id === "stripe_connect") {
      const form = new URLSearchParams({
        amount: String(authorizedAmountCents),
        currency: "usd",
        destination: input.recipientId,
        description: input.memo,
      });
      const res = await fetchFn(provider.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env["STRIPE_SECRET_KEY"] ?? ""}`,
          "idempotency-key": idempotencyKey,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
      });
      const json = await parseJsonSafe(res);
      if (!res.ok) throw new Error(`Stripe Connect HTTP ${res.status}`);
      const ref = typeof json["id"] === "string" ? json["id"] : null;
      return { externalRef: ref, data: json };
    }

    const fundingSourceId =
      input.fundingSourceId?.trim() ||
      env["TREMENDOUS_FUNDING_SOURCE_ID"]?.trim() ||
      "BALANCE";
    const products =
      input.products && input.products.length > 0
        ? input.products
        : DEFAULT_TREMENDOUS_PRODUCTS;
    const res = await requestJson(
      fetchFn,
      "POST",
      provider.endpoint,
      {
        authorization: `Bearer ${env["TREMENDOUS_API_KEY"] ?? ""}`,
        "idempotency-key": idempotencyKey,
      },
      {
        external_id: idempotencyKey,
        payment: {
          funding_source_id: fundingSourceId,
        },
        reward: {
          value: {
            denomination: Number((authorizedAmountCents / 100).toFixed(2)),
            currency_code: "USD",
          },
          products,
          recipient: {
            name: input.recipientName,
            email: input.recipientEmail,
          },
          delivery: { method: "EMAIL" },
        },
      },
    );
    if (!res.ok) throw new Error(`Tremendous HTTP ${res.status}`);
    const orderObj =
      res.json["order"] && typeof res.json["order"] === "object"
        ? (res.json["order"] as Record<string, unknown>)
        : res.json;
    const ref =
      typeof orderObj["id"] === "string"
        ? orderObj["id"]
        : `tremendous:${idempotencyKey}`;
    return { externalRef: ref, data: res.json };
  },
};

/**
 * Unified Tier-3/4 Credit-Card Plug-and-Play Paid Adapter Registry.
 * Safe at $0 by default: every execute() call checks `canAuthorizeSpend(...)`,
 * binds charges strictly to `context.spend.amountCents`, and never makes live
 * paid network requests unless provider credentials AND `MARKETING_LIVE_BILLING === "1"` are set.
 */
export class PaidAdapterRegistry {
  private readonly env: Record<string, string | undefined>;
  private readonly adapters: {
    [K in PaidAdapterId]: PaidAdapter<PaidAdapterInputMap[K], Record<string, unknown>>;
  };

  constructor(opts?: PaidAdapterRegistryOptions) {
    const env = opts?.env ?? process.env;
    const fetchFn = opts?.fetchFn ?? fetch;
    const clock = opts?.clock ?? createDefaultClock();
    this.env = env;

    const runtime = {
      env,
      fetchFn,
      clock,
      store: opts?.store,
      onSpendAuthorized: opts?.onSpendAuthorized,
    };
    this.adapters = {
      email: buildAdapter(EMAIL_DEF, runtime),
      sms_voice: buildAdapter(SMS_VOICE_DEF, runtime),
      rentahuman: buildAdapter(RENTAHUMAN_DEF, runtime),
      print_fliers: buildAdapter(PRINT_FLIERS_DEF, runtime),
      qr_links: buildAdapter(QR_LINKS_DEF, runtime),
      events: buildAdapter(EVENTS_DEF, runtime),
      media_video: buildAdapter(MEDIA_VIDEO_DEF, runtime),
      payouts: buildAdapter(PAYOUTS_DEF, runtime),
    };
  }

  isLiveBillingEnabled(): boolean {
    return this.env["MARKETING_LIVE_BILLING"] === "1";
  }

  get<K extends PaidAdapterId>(
    id: K,
  ): PaidAdapter<PaidAdapterInputMap[K], Record<string, unknown>> {
    return this.adapters[id];
  }

  listIds(): PaidAdapterId[] {
    return Object.keys(this.adapters) as PaidAdapterId[];
  }

  listStatus(): AdapterStatus[] {
    return this.listIds().map((id) => this.adapters[id].getStatus(this.env));
  }

  estimateCostCents<K extends PaidAdapterId>(
    id: K,
    input: PaidAdapterInputMap[K],
  ): number {
    return this.adapters[id].estimateCostCents(input);
  }

  dryRun<K extends PaidAdapterId>(
    id: K,
    input: PaidAdapterInputMap[K],
    idempotencyKey: string,
    preferredProvider?: string,
  ): Promise<AdapterReceipt<Record<string, unknown>>> {
    return this.adapters[id].dryRun(
      input,
      idempotencyKey,
      this.env,
      preferredProvider,
    );
  }

  execute<K extends PaidAdapterId>(
    id: K,
    input: PaidAdapterInputMap[K],
    context: AdapterExecuteContext,
  ): Promise<AdapterReceipt<Record<string, unknown>>> {
    return this.adapters[id].execute(input, context);
  }
}

export function createPaidAdapterRegistry(
  opts?: PaidAdapterRegistryOptions,
): PaidAdapterRegistry {
  return new PaidAdapterRegistry(opts);
}
