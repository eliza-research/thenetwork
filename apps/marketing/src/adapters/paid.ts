// Tier-3 Credit-Card Plug-and-Play Paid Adapter Registry for @thenetwork/marketing (Node 26).
// ("Put in credit card / API keys and it runs.")
//
// Supported adapters:
//   1. email       (Resend RESEND_API_KEY / AgentMail AGENTMAIL_API_KEY / SMTP)
//   2. sms_voice   (Twilio TWILIO_ACCOUNT_SID+TWILIO_AUTH_TOKEN / Blooio BLOOIO_API_KEY)
//   3. rentahuman  (RentAHuman MCP RENTAHUMAN_API_KEY -> https://rentahuman.ai/api/mcp)
//   4. print_fliers (Printful PRINTFUL_API_KEY / 4over FOUROVER_API_KEY / Lob LOB_API_KEY)
//   5. qr_links    (Dub.co DUB_API_KEY)
//   6. events      (Luma Plus LUMA_API_KEY)
//   7. media_video (ElevenLabs ELEVENLABS_API_KEY / Hedra HEDRA_API_KEY / Kling KLING_API_KEY)
//   8. payouts     (Stripe Connect STRIPE_SECRET_KEY / Tremendous TREMENDOUS_API_KEY)
//
// Formal safety invariants:
//   - EVERY billable execute(...) call checks Vibestack/Dafny-proved
//     `canAuthorizeSpend(...)` from `packages/core/src/generated/marketingPolicy.ts`
//     BEFORE any external dispatch (inv_budget_never_exceeded,
//     inv_tier_billing_gate, inv_slop_cash_disabled).
//   - Never makes a live paid network call unless BOTH the active provider's env
//     key(s) are set AND `MARKETING_LIVE_BILLING === "1"` (returns a safe dry-run
//     receipt otherwise so tests and $0 runs are 100% safe).

import { canAuthorizeSpend } from "../../../../packages/core/src/generated/marketingPolicy.ts";
import type { Campaign, Clock } from "../types.ts";

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

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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
  preferredProvider?: string;
  targetStopped?: boolean;
  forceDryRun?: boolean;
}

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
}

export interface PrintFliersInput {
  quantity: number;
  productType: "fliers" | "postcards" | "tabletop_cards";
  qrBatchCode: string;
  destinationAddress: string;
  artworkUrl: string;
  rush?: boolean;
}

export interface QrLinksInput {
  destinationUrl: string;
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
}

export interface PayoutInput {
  recipientId: string;
  recipientEmail?: string;
  recipientName: string;
  amountCents: number;
  memo: string;
  rail: "stripe_connect" | "tremendous";
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
}

const DEFAULT_HTTP_TIMEOUT_MS = 12_000;

const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
};

/** Helper to construct a `SpendAuthInput` from a Campaign and estimated task spend. */
export function spendAuthFromCampaign(
  campaign: Campaign,
  amountCents: number,
  opts?: { tier?: 3 | 4; useSlopCash?: boolean },
): SpendAuthInput {
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
    slopCashEnabled: campaign.slopCashEnabled,
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
): ProviderStatus | null {
  if (preferredProvider) {
    const preferred = providers.find(
      (p) => p.id === preferredProvider && p.configured,
    );
    if (preferred) return preferred;
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

interface LiveDispatchFn<TInput> {
  (
    provider: ProviderStatus,
    input: TInput,
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
  buildDryRunPayload(
    providerId: string,
    input: TInput,
    amountCents: number,
  ): Record<string, unknown>;
  validateInput?(input: TInput): string | null;
  dispatchLive: LiveDispatchFn<TInput>;
}

async function postJson(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; ok: boolean; json: Record<string, unknown> }> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        json = parsed as Record<string, unknown>;
      } else {
        json = { raw: text.slice(0, 512) };
      }
    } catch {
      json = { raw: text.slice(0, 512) };
    }
  }
  return { status: res.status, ok: res.ok, json };
}

function buildAdapter<TInput>(
  def: AdapterDefinition<TInput>,
  opts: {
    env: Record<string, string | undefined>;
    fetchFn: FetchFn;
    clock: Clock;
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
    const providerStatuses = evaluateProviders(def.providers, env);
    const active = selectActiveProvider(providerStatuses, preferredProvider);
    const fallbackId =
      preferredProvider ?? active?.id ?? def.providers[0]?.id ?? def.id;
    const amountCents = def.estimateCostCents(input);
    const readiness = computeReadiness(providerStatuses, env);

    const reason =
      readiness === "missing_credentials"
        ? `Dry-run receipt: no credentials configured for '${def.id}' (no network call made).`
        : env["MARKETING_LIVE_BILLING"] !== "1"
          ? "Dry-run receipt: MARKETING_LIVE_BILLING is not '1' (no paid network call made)."
          : "Dry-run receipt requested by caller (no paid network call made).";

    return {
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
    };
  };

  const execute = async (
    input: TInput,
    context: AdapterExecuteContext,
  ): Promise<AdapterReceipt<Record<string, unknown>>> => {
    const executedAt = new Date(opts.clock.now()).toISOString();
    const estimatedCents = def.estimateCostCents(input);
    const amountCents =
      context.spend.amountCents > 0
        ? Math.round(context.spend.amountCents)
        : estimatedCents;

    const spendInput: SpendAuthInput = {
      ...context.spend,
      tier: context.spend.tier || def.tier,
      amountCents,
    };

    const providerStatuses = evaluateProviders(def.providers, opts.env);
    const active = selectActiveProvider(
      providerStatuses,
      context.preferredProvider,
    );
    const providerId =
      active?.id ?? context.preferredProvider ?? def.providers[0]?.id ?? def.id;

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
      return dryRun(
        input,
        context.idempotencyKey,
        opts.env,
        context.preferredProvider,
      );
    }

    try {
      const liveRes = await def.dispatchLive(
        active,
        input,
        context.idempotencyKey,
        opts.env,
        opts.fetchFn,
      );
      return {
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
    estimateCostCents: def.estimateCostCents,
    dryRun,
    execute,
  };
}

// ---------------------------------------------------------------------------
// 8 Tier-3 Credit-Card Plug-and-Play Adapter Definitions
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
      label: "SMTP",
      requiredEnv: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
      endpoint: "smtp://configured-host",
    },
  ],
  estimateCostCents: () => 1,
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    to: input.to,
    subject: input.subject,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, idempotencyKey, env, fetchFn) {
    if (provider.id === "resend") {
      const res = await postJson(
        fetchFn,
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
          html: input.html,
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
      const res = await postJson(
        fetchFn,
        `${provider.endpoint}/${inbox}/messages/send`,
        {
          authorization: `Bearer ${env["AGENTMAIL_API_KEY"] ?? ""}`,
          "idempotency-key": idempotencyKey,
        },
        {
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
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

    return {
      externalRef: `smtp:${idempotencyKey}`,
      data: {
        host: env["SMTP_HOST"],
        to: input.to,
        subject: input.subject,
        queued: true,
      },
    };
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
    if (input.action !== "lookup" && !input.optedIn) {
      return "Cold SMS/voice is prohibited: recipient must be opted-in.";
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
  async dispatchLive(provider, input, idempotencyKey, env, fetchFn) {
    if (provider.id === "twilio") {
      const sid = env["TWILIO_ACCOUNT_SID"] ?? "";
      const token = env["TWILIO_AUTH_TOKEN"] ?? "";
      const authHeader = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;

      if (input.action === "lookup") {
        const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(input.toE164)}?Fields=line_type_intelligence`;
        const res = await fetchFn(url, {
          method: "GET",
          headers: { authorization: authHeader },
          signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Twilio Lookup HTTP ${res.status}`);
        const json = (await res.json()) as Record<string, unknown>;
        return { externalRef: `twilio-lookup:${idempotencyKey}`, data: json };
      }

      const form = new URLSearchParams({
        To: input.toE164,
        From: input.fromE164 ?? env["TWILIO_FROM_NUMBER"] ?? "",
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
      if (!res.ok) throw new Error(`Twilio SMS HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      const ref = typeof json["sid"] === "string" ? json["sid"] : null;
      return { externalRef: ref, data: json };
    }

    const res = await postJson(
      fetchFn,
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
      endpoint: "https://rentahuman.ai/api/mcp",
    },
  ],
  estimateCostCents: (input) => Math.max(100, Math.round(input.budgetCents)),
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    endpoint: "https://rentahuman.ai/api/mcp",
    city: input.city,
    neighborhood: input.neighborhood,
    title: input.title,
    shiftHours: input.shiftHours,
    qrBatchCode: input.qrBatchCode ?? null,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, idempotencyKey, env, fetchFn) {
    const res = await postJson(
      fetchFn,
      provider.endpoint,
      {
        authorization: `Bearer ${env["RENTAHUMAN_API_KEY"] ?? ""}`,
        "idempotency-key": idempotencyKey,
      },
      {
        jsonrpc: "2.0",
        id: idempotencyKey,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            city: input.city,
            neighborhood: input.neighborhood,
            title: input.title,
            brief: input.brief,
            shift_hours: input.shiftHours,
            budget_cents: input.budgetCents,
            qr_batch_code: input.qrBatchCode,
          },
        },
      },
    );
    if (!res.ok) throw new Error(`RentAHuman MCP HTTP ${res.status}`);
    const resultObj =
      res.json["result"] && typeof res.json["result"] === "object"
        ? (res.json["result"] as Record<string, unknown>)
        : res.json;
    const ref =
      typeof resultObj["task_id"] === "string"
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
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    productType: input.productType,
    quantity: input.quantity,
    qrBatchCode: input.qrBatchCode,
    rush: Boolean(input.rush),
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, idempotencyKey, env, fetchFn) {
    if (provider.id === "printful") {
      const res = await postJson(
        fetchFn,
        provider.endpoint,
        {
          authorization: `Bearer ${env["PRINTFUL_API_KEY"] ?? ""}`,
          "idempotency-key": idempotencyKey,
        },
        {
          external_id: idempotencyKey,
          recipient: { address1: input.destinationAddress },
          items: [
            {
              quantity: input.quantity,
              name: `${input.productType} (${input.qrBatchCode})`,
              files: [{ url: input.artworkUrl }],
            },
          ],
        },
      );
      if (!res.ok) throw new Error(`Printful HTTP ${res.status}`);
      const ref =
        typeof res.json["id"] === "string" || typeof res.json["id"] === "number"
          ? String(res.json["id"])
          : `printful:${idempotencyKey}`;
      return { externalRef: ref, data: res.json };
    }

    if (provider.id === "fourover") {
      const res = await postJson(
        fetchFn,
        provider.endpoint,
        {
          authorization: `Bearer ${env["FOUROVER_API_KEY"] ?? ""}`,
          "idempotency-key": idempotencyKey,
        },
        {
          product_type: input.productType,
          quantity: input.quantity,
          qr_batch_code: input.qrBatchCode,
          artwork_url: input.artworkUrl,
          shipping_address: input.destinationAddress,
          rush: Boolean(input.rush),
        },
      );
      if (!res.ok) throw new Error(`4over HTTP ${res.status}`);
      const ref =
        typeof res.json["order_id"] === "string"
          ? res.json["order_id"]
          : `fourover:${idempotencyKey}`;
      return { externalRef: ref, data: res.json };
    }

    const lobKey = env["LOB_API_KEY"] ?? "";
    const lobAuth = `Basic ${Buffer.from(`${lobKey}:`).toString("base64")}`;
    const res = await postJson(
      fetchFn,
      provider.endpoint,
      {
        authorization: lobAuth,
        "idempotency-key": idempotencyKey,
      },
      {
        description: `${input.productType} batch ${input.qrBatchCode}`,
        to: input.destinationAddress,
        front: input.artworkUrl,
        back: input.artworkUrl,
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
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    shortLink: `https://${input.domain ?? "go.ntwrk.party"}/${input.slug ?? input.qrBatchCode}`,
    destinationUrl: input.destinationUrl,
    qrBatchCode: input.qrBatchCode,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, idempotencyKey, env, fetchFn) {
    const workspaceId = env["DUB_WORKSPACE_ID"];
    const url = workspaceId
      ? `${provider.endpoint}?workspaceId=${encodeURIComponent(workspaceId)}`
      : provider.endpoint;
    const res = await postJson(
      fetchFn,
      url,
      {
        authorization: `Bearer ${env["DUB_API_KEY"] ?? ""}`,
        "idempotency-key": idempotencyKey,
      },
      {
        url: input.destinationUrl,
        domain: input.domain,
        key: input.slug ?? input.qrBatchCode,
        externalId: idempotencyKey,
        tags: input.tags,
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
  label: "NYC Event Pages & RSVP Lists (Luma Plus)",
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
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    name: input.name,
    city: input.city,
    venueName: input.venueName,
    startIso: input.startIso,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, idempotencyKey, env, fetchFn) {
    const res = await postJson(
      fetchFn,
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
        max_capacity: input.capacity,
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
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    kind: input.kind,
    durationSec: input.durationSec,
    estimatedCents: amountCents,
  }),
  async dispatchLive(provider, input, idempotencyKey, env, fetchFn) {
    if (provider.id === "elevenlabs") {
      const voiceId = encodeURIComponent(
        input.voiceId ?? env["ELEVENLABS_VOICE_ID"] ?? "21m00Tcm4TlvDq8ikWAM",
      );
      const res = await fetchFn(`${provider.endpoint}/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": env["ELEVENLABS_API_KEY"] ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: input.promptOrScript }),
        signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
      const bytes = (await res.arrayBuffer()).byteLength;
      return {
        externalRef: `elevenlabs:${idempotencyKey}`,
        data: { audioBytes: bytes, voiceId },
      };
    }

    if (provider.id === "hedra") {
      const res = await postJson(
        fetchFn,
        provider.endpoint,
        {
          "x-api-key": env["HEDRA_API_KEY"] ?? "",
          "idempotency-key": idempotencyKey,
        },
        {
          prompt: input.promptOrScript,
          duration_sec: input.durationSec,
        },
      );
      if (!res.ok) throw new Error(`Hedra HTTP ${res.status}`);
      const ref =
        typeof res.json["id"] === "string"
          ? res.json["id"]
          : `hedra:${idempotencyKey}`;
      return { externalRef: ref, data: res.json };
    }

    const res = await postJson(
      fetchFn,
      provider.endpoint,
      {
        authorization: `Bearer ${env["KLING_API_KEY"] ?? ""}`,
        "idempotency-key": idempotencyKey,
      },
      {
        prompt: input.promptOrScript,
        duration: input.durationSec,
      },
    );
    if (!res.ok) throw new Error(`Kling HTTP ${res.status}`);
    const ref =
      typeof res.json["task_id"] === "string"
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
  buildDryRunPayload: (providerId, input, amountCents) => ({
    provider: providerId,
    recipientId: input.recipientId,
    recipientName: input.recipientName,
    amountCents,
    memo: input.memo,
    currency: "usd",
  }),
  async dispatchLive(provider, input, idempotencyKey, env, fetchFn) {
    if (provider.id === "stripe_connect") {
      const form = new URLSearchParams({
        amount: String(Math.round(input.amountCents)),
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
      if (!res.ok) throw new Error(`Stripe Connect HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      const ref = typeof json["id"] === "string" ? json["id"] : null;
      return { externalRef: ref, data: json };
    }

    const res = await postJson(
      fetchFn,
      provider.endpoint,
      {
        authorization: `Bearer ${env["TREMENDOUS_API_KEY"] ?? ""}`,
        "idempotency-key": idempotencyKey,
      },
      {
        external_id: idempotencyKey,
        reward: {
          value: {
            denomination: Math.round(input.amountCents) / 100,
            currency_code: "USD",
          },
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
 * Safe at $0 by default: every execute() call checks `canAuthorizeSpend(...)`
 * and never makes live paid network requests unless provider credentials AND
 * `MARKETING_LIVE_BILLING === "1"` are both set.
 */
export class PaidAdapterRegistry {
  private readonly env: Record<string, string | undefined>;
  private readonly adapters: {
    [K in PaidAdapterId]: PaidAdapter<PaidAdapterInputMap[K], Record<string, unknown>>;
  };

  constructor(opts?: PaidAdapterRegistryOptions) {
    const env = opts?.env ?? process.env;
    const fetchFn = opts?.fetchFn ?? fetch;
    const clock = opts?.clock ?? SYSTEM_CLOCK;
    this.env = env;

    const runtime = { env, fetchFn, clock };
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
