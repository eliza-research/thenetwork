// Tier-4 zero-human-intervention hiring, agency booking, creator recruitment,
// outbound outreach gating, and deterministic proof-of-work verification engine (Node 26).
// All outreach is gated by proved marketingPolicy.canSendOutreach, all proof approvals
// by marketingPolicy.canApproveProof, and all payouts by marketingPolicy.canAuthorizeSpend.

import { RealClock } from "../../../packages/core/src/clock.ts";
import {
  adultParticipantAge,
  canApproveProof,
  canAuthorizeSpend,
  canSendOutreach,
} from "../../../packages/core/src/generated/marketingPolicy.ts";
import { LeakGuard } from "../../../packages/core/src/guard.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
import { PolicyViolationError, type MarketingStore } from "./store.ts";
import type {
  BudgetEntry,
  Campaign,
  Clock,
  HumanPartner,
  ImplementationTier,
  MarketingTask,
  OutreachChannel,
  OutreachMessage,
  ProofKind,
  ProofSubmission,
  TaskKind,
} from "./types.ts";

export type HiringRole =
  | "street_fliering"
  | "event_activation"
  | "creator_video"
  | "agency_booking"
  | "rentahuman_courier";

export interface HiringPacketOptions {
  neighborhood?: string;
  shiftDate?: string;
  shiftHours?: string;
  qrBatchCode?: string;
  shortLink?: string;
  releaseFormUrl?: string;
  contractUrl?: string;
  targetBrand?: string;
}

export interface HiringPacket {
  role: HiringRole;
  city: string;
  budgetCents: number;
  craigslistPost: {
    category: "evg" | "lbg" | "tlg" | "crg";
    title: string;
    body: string;
    filterToken: string;
    estimatedPostFeeCents: number;
  };
  rentAHumanPayload: {
    endpoint: "https://rentahuman.ai/api/mcp";
    tool: "create_bounty";
    params: {
      title: string;
      city: string;
      payoutUsd: number;
      buyerFeeUsd: number;
      totalEscrowUsd: number;
      description: string;
      requiredProofs: string[];
    };
  };
  agencyRfpEmail: {
    subject: string;
    body: string;
    targetAgencies: readonly string[];
  };
  creatorBrief: {
    subject: string;
    body: string;
    deliverables: readonly string[];
    ftcClause: string;
    releaseClause: string;
    nyll191dTerms: string;
  };
  compliance: {
    adultAgeFloor: 18;
    ftcDisclosureRequired: true;
    nyCivilRightsReleaseRequired: boolean;
    nyll191dClickwrapIncluded: true;
    localLaborNote: string;
    antiPostingNotice: string;
    mtaExclusionNotice: string;
  };
}

export interface ApplicantScreenInput {
  humanId?: string;
  replyText: string;
  statedAge: number | null;
  city: string;
  filterToken: string;
  hasPriorExperience?: boolean;
  hasIntroClip?: boolean;
}

export interface ApplicantScreenResult {
  passed: boolean;
  optedOut: boolean;
  score: number;
  decision: "auto_hire" | "standby_bench" | "rejected_underage" | "rejected_opt_out" | "rejected_low_score";
  reasons: string[];
}

export interface QueueOutreachInput {
  campaignId: string;
  agentId: string;
  humanId: string;
  channelAccountId?: string | null;
  channel: OutreachChannel;
  tier?: ImplementationTier;
  subject?: string | null;
  bodyText: string;
  dailyOutreachCap?: number;
}

export interface OutreachTransport {
  send(req: {
    message: OutreachMessage;
    human: HumanPartner;
    campaign: Campaign;
  }): Promise<{ ok: boolean; externalRef?: string; error?: string }>;
}

export interface DispatchOutreachResult {
  campaignId: string;
  liveMode: boolean;
  sent: number;
  dryRun: number;
  blockedStop: number;
  blockedPolicy: number;
  failed: number;
  messages: OutreachMessage[];
}

export interface SubmitProofInput {
  taskId: string;
  proofKind: ProofKind;
  evidenceUrl?: string | null;
  checkinMediaHashes?: string[];
  qrScansCount?: number;
  verifiedSignupsCount?: number;
  ftcDisclosed: boolean;
  geoTimeValid: boolean;
  likenessReleaseOk?: boolean;
  shiftDone?: boolean;
  workerAge?: number | null;
  verifierNotes?: string | null;
  authorizePayout?: boolean;
  payoutAdapterId?: string;
  payoutIdempotencyKey?: string;
  slopCashEnvEnabled?: boolean;
}

export interface SubmitProofResult {
  proof: ProofSubmission;
  task: MarketingTask;
  approved: boolean;
  rejectionReason?: string;
  payoutAuthorized: boolean;
  payoutError?: string;
  budgetEntry?: BudgetEntry;
  campaign?: Campaign;
}

export interface CrowdsourcingEngineOptions {
  store: MarketingStore;
  clock?: Clock;
  env?: Record<string, string | undefined>;
  transport?: OutreachTransport;
  leakGuard?: LeakGuard;
}

const NYC_VETTED_AGENCIES: readonly string[] = [
  "Kinetic Events Staffing (info@kineticevents.com)",
  "Street Teams Co (hello@streetteamsco.com)",
  "Broadway Crew (info@broadwaycrew.com)",
  "Victory Agency (info@victory-agency.com)",
  "Oppizi NYC (contact@oppizi.com)",
  "The PUSH Agency (sales@yourpush.com)",
  "Mustard Lane (kristal@mustardlane.com)",
];

const FTC_DISCLOSURE_CLAUSE =
  'FTC 16 CFR Part 255 (Mandatory): Include BOTH a clear spoken disclosure ("Sponsored by The Network") AND prominent on-screen text ("#Ad" or "Paid Partnership with The Network") in the first 3 seconds, plus enable the native platform Paid Partnership / Commercial Content toggle.';

const NY_RELEASE_CLAUSE =
  "NY Civil Rights Law §§ 50–51 (Mandatory Commercial Release): Every recognizable featured interviewee must be 18+ and complete our written/mobile commercial likeness release before publication; blur or cut any unsigned person.";

const ANTI_POSTING_NOTICE =
  "NYC Administrative Code § 10-119 (Zero Tolerance): Hand-to-hand sidewalk distribution only (keep >= 8 ft sidewalk clearance). NEVER paste, tape, glue, or post fliers on lampposts, utility poles, trees, mailboxes, or car windshields.";

const MTA_EXCLUSION_NOTICE =
  "21 NYCRR § 1050.6: Commercial flyers are strictly prohibited inside MTA subway stations, mezzanines, and platforms. Stay on outdoor public sidewalks at least 20 ft outside entrances.";

function localLaborRuleForCity(city: string): string {
  const c = city.trim().toLowerCase();
  if (c === "sf" || c === "la") {
    return "California AB5 & CA Civ Code § 3344: Use W-2 agency/platform staffing for hourly street teams and written commercial likeness releases for all filmed participants.";
  }
  if (c === "london") {
    return "UK Schedule 3A Environmental Protection Act 1990: Obtain borough Free Printed Matter Distribution Licences before any hand-to-hand fliering; ASA/CAP #Ad disclosure required.";
  }
  if (c === "chicago") {
    return "IL Freelance Worker Protection Act & 765 ILCS 1075: Written contract with <=30d payout SLA and written commercial publicity releases required.";
  }
  if (c === "miami") {
    return "Miami Beach Code Ch. 46 & FL Stat. § 540.08: Avoid restricted commercial handbill resort zones; written commercial likeness releases required.";
  }
  return "NYLL § 191-d (Freelance Isn't Free Act): Written itemized clickwrap terms retained 6 years; payout within 48 hours of approved proof (hard SLA <= 15 days, statutory ceiling 30 days).";
}

function formatUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

export class CrowdsourcingEngine {
  private readonly store: MarketingStore;
  private readonly clock: Clock;
  private readonly env: Record<string, string | undefined>;
  private readonly transport?: OutreachTransport;
  private readonly leakGuard: LeakGuard;

  constructor(opts: CrowdsourcingEngineOptions) {
    this.store = opts.store;
    this.clock = opts.clock ?? opts.store.clock ?? new RealClock();
    this.env = opts.env ?? process.env;
    this.transport = opts.transport;
    this.leakGuard = opts.leakGuard ?? new LeakGuard({ contacts: false });
  }

  buildHiringPacket(
    role: HiringRole | TaskKind,
    city: string,
    budgetCents: number,
    opts: HiringPacketOptions = {},
  ): HiringPacket {
    if (budgetCents <= 0) {
      throw new PolicyViolationError(
        "INVALID_BUDGET",
        "inv_budget_never_exceeded",
        "Hiring packet budgetCents must be positive.",
      );
    }

    const normalizedRole: HiringRole =
      role === "event_activation" ||
      role === "creator_video" ||
      role === "agency_booking" ||
      role === "rentahuman_courier"
        ? role
        : "street_fliering";

    const cityCode = city.trim().toLowerCase() || "nyc";
    const cityLabel = cityCode === "nyc" ? "New York City" : city.toUpperCase();
    const neighborhood = opts.neighborhood ?? (cityCode === "nyc" ? "Union Square / West Village" : "Downtown Core");
    const shiftDate = opts.shiftDate ?? new Date(this.clock.now() + 48 * 3_600_000).toISOString().slice(0, 10);
    const shiftHours = opts.shiftHours ?? "1:00 PM – 5:00 PM (4 hours)";
    const qrBatchCode = opts.qrBatchCode ?? `${cityCode.toUpperCase()}-001`;
    const shortLink = opts.shortLink ?? `https://ntwrk.party/?b=${qrBatchCode}`;
    const releaseFormUrl = opts.releaseFormUrl ?? `https://ntwrk.party/release?batch=${qrBatchCode}`;
    const contractUrl = opts.contractUrl ?? `https://ntwrk.party/contractor-terms?batch=${qrBatchCode}`;
    const targetBrand = opts.targetBrand ?? "The Network (ntwrk.party / slop.date / peon.biz / friends.help)";
    const budgetUsd = formatUsd(budgetCents);

    const filterToken = `${cityCode.toUpperCase()} 18+ CONFIRMED`;
    const localLaborNote = localLaborRuleForCity(cityCode);

    const nyll191dTerms = [
      `NYLL § 191-d Written Clickwrap Terms (${cityLabel}):`,
      `- Itemized Role: ${normalizedRole} (${neighborhood}, Batch ${qrBatchCode})`,
      `- Guaranteed Base Compensation: $${budgetUsd} USD (fiat via Stripe Connect Express or Tremendous; $0 upfront worker fee)`,
      `- Payment Due Date: Within 48 hours of approved proof-of-work (hard SLA <= 15 days, well within the 30-day statutory cap)`,
      `- Mandatory Age Floor: Contractor confirms age 18+ with valid US payout eligibility (1099 / W-9).`,
      `- Record Retention: Clickwrap acceptance stored for 6 years (${contractUrl}).`,
    ].join("\n");

    const clCategory: "evg" | "lbg" | "tlg" | "crg" =
      normalizedRole === "creator_video"
        ? "tlg"
        : normalizedRole === "event_activation"
          ? "evg"
          : "lbg";

    const craigslistTitle =
      normalizedRole === "creator_video"
        ? `$${budgetUsd} Flat + Bonus — ${cityLabel} Street-Interview Video Creator (18+, ${neighborhood})`
        : normalizedRole === "event_activation"
          ? `$30/hr + Bonus — ${cityLabel} Live Event Activator (${neighborhood}, 18+)`
          : `$22/hr + Bonus — ${cityLabel} Hand-to-Hand Flier Street Team (${neighborhood}, 18+)`;

    const craigslistBody = [
      `We are hiring reliable 18+ ${cityLabel} locals for a paid ${normalizedRole.replaceAll("_", " ")} engagement promoting ${targetBrand}.`,
      "",
      `DETAILS:`,
      `- Date & Time: ${shiftDate}, ${shiftHours}`,
      `- Location: Public sidewalks near ${neighborhood}`,
      `- Budget / Pay: $${budgetUsd} total engagement cap (paid in USD via Stripe / Tremendous within 48 hours of verified proof).`,
      `- Tracking: Serialized QR Batch ${qrBatchCode} (${shortLink})`,
      "",
      `COMPLIANCE & PROOF RULES:`,
      `- ${ANTI_POSTING_NOTICE}`,
      `- ${MTA_EXCLUSION_NOTICE}`,
      `- ${localLaborNote}`,
      `- Must submit timestamped GPS check-in photos (Start, Midpoint, End) and maintain 18+ age verification.`,
      normalizedRole === "creator_video" ? `- ${FTC_DISCLOSURE_CLAUSE}` : "",
      normalizedRole === "creator_video" ? `- ${NY_RELEASE_CLAUSE}` : "",
      "",
      `HOW TO APPLY (REQUIRED):`,
      `Start your first line with your closest transit stop + "${filterToken}". Replies missing this line are skipped automatically.`,
    ]
      .filter((line) => line !== "")
      .join("\n");

    const rahPayoutCents = Math.max(100, Math.floor(budgetCents / 1.18));
    const rahFeeCents = Math.max(0, budgetCents - rahPayoutCents);
    const rentAHumanPayload = {
      endpoint: "https://rentahuman.ai/api/mcp" as const,
      tool: "create_bounty" as const,
      params: {
        title: `${cityLabel} ${normalizedRole.replaceAll("_", " ")} (${neighborhood} — ${qrBatchCode})`,
        city: cityLabel,
        payoutUsd: Number(formatUsd(rahPayoutCents)),
        buyerFeeUsd: Number(formatUsd(rahFeeCents)),
        totalEscrowUsd: Number(formatUsd(rahPayoutCents + rahFeeCents)),
        description: `${craigslistBody}\n\n${nyll191dTerms}`,
        requiredProofs:
          normalizedRole === "creator_video"
            ? [
                "Live public video URL (YouTube/TikTok/IG)",
                "FTC #Ad spoken + on-screen disclosure in first 3 seconds",
                `Signed 18+ NY Civil Rights Law §§ 50-51 releases (${releaseFormUrl})`,
                `Unique batch QR ${qrBatchCode} shown on screen and pinned`,
              ]
            : [
                "3 timestamped GPS check-in photos (Start, Midpoint, End)",
                "Remaining flier stack count photo",
                `Active QR Batch ${qrBatchCode} scan verification`,
              ],
      },
    };

    const agencyRfpEmail = {
      subject: `${cityLabel} Street-Team Quote & Direct Booking Request — ${shiftDate} (Budget Cap $${budgetUsd})`,
      body: [
        `Hello Agency Team,`,
        "",
        `We are booking a compliant, insured W-2 street-team activation in ${cityLabel} and would like to confirm availability and book directly over email.`,
        "",
        `ACTIVATION BRIEF:`,
        `- Brand: ${targetBrand} (18+ social, dating, and work network)`,
        `- Zone & Schedule: ${neighborhood}, ${shiftDate}, ${shiftHours}`,
        `- Hard Budget Cap: $${budgetUsd} USD all-in (credit card / Stripe / ACH invoice)`,
        `- Collateral: Pre-printed 4x6" postcards with serialized QR Batch ${qrBatchCode}`,
        `- Compliance: ${ANTI_POSTING_NOTICE} ${MTA_EXCLUSION_NOTICE}`,
        `- Required Proof: GPS clock-in/out logs + start/mid/end timestamped photos + remaining count.`,
        "",
        `Please reply with your all-in W-2 hourly rate (CGL + Workers' Comp included) and total itemized quote.`,
      ].join("\n"),
      targetAgencies: NYC_VETTED_AGENCIES,
    };

    const creatorDeliverables: readonly string[] = [
      "1 main edited street-interview video (60-90s) published publicly on YouTube/TikTok/IG featuring 3+ verified 18+ interviewees",
      "2 vertical cutdowns (20-35s) + raw unedited clips uploaded with commercial usage rights",
      `Serialized QR card (${qrBatchCode}) shown on screen + pinned link (${shortLink}) for 30 days`,
      "Mandatory FTC #Ad spoken and on-screen disclosure within first 3 seconds + Paid Partnership toggle",
      `Signed 18+ NY Civil Rights Law §§ 50-51 mobile commercial releases (${releaseFormUrl}) for every recognizable interviewee`,
    ];

    const creatorBrief = {
      subject: `Paid ${cityLabel} Street-Interview Collab ($${budgetUsd} Cap) — ${targetBrand}`,
      body: [
        `Hi Creator,`,
        "",
        `We want to sponsor an authentic handheld ${cityLabel} street-interview video in ${neighborhood} for ${targetBrand}.`,
        `Handheld camera + clip-on/shotgun mic only on public sidewalks (no ground stands/lights, >= 8 ft clearance).`,
        "",
        `DELIVERABLES:`,
        ...creatorDeliverables.map((d, i) => `${i + 1}. ${d}`),
        "",
        FTC_DISCLOSURE_CLAUSE,
        NY_RELEASE_CLAUSE,
        "",
        nyll191dTerms,
      ].join("\n"),
      deliverables: creatorDeliverables,
      ftcClause: FTC_DISCLOSURE_CLAUSE,
      releaseClause: NY_RELEASE_CLAUSE,
      nyll191dTerms,
    };

    return {
      role: normalizedRole,
      city: cityCode,
      budgetCents,
      craigslistPost: {
        category: clCategory,
        title: craigslistTitle,
        body: craigslistBody,
        filterToken,
        estimatedPostFeeCents: cityCode === "nyc" || cityCode === "sf" || cityCode === "la" ? 1_000 : 700,
      },
      rentAHumanPayload,
      agencyRfpEmail,
      creatorBrief,
      compliance: {
        adultAgeFloor: 18,
        ftcDisclosureRequired: true,
        nyCivilRightsReleaseRequired: normalizedRole === "creator_video",
        nyll191dClickwrapIncluded: true,
        localLaborNote,
        antiPostingNotice: ANTI_POSTING_NOTICE,
        mtaExclusionNotice: MTA_EXCLUSION_NOTICE,
      },
    };
  }

  async screenApplicantReply(input: ApplicantScreenInput): Promise<ApplicantScreenResult> {
    const optOut = parseOptOut(input.replyText);
    if (optOut.match !== "none") {
      if (input.humanId) {
        await this.store.markHumanStopped(input.humanId, `applicant_opt_out_${optOut.match}`);
      }
      return {
        passed: false,
        optedOut: true,
        score: 0,
        decision: "rejected_opt_out",
        reasons: ["applicant_opted_out"],
      };
    }

    if (input.humanId && input.statedAge !== null) {
      await this.store.recordHumanAge(input.humanId, input.statedAge);
    }

    if (input.statedAge === null || !adultParticipantAge(input.statedAge)) {
      return {
        passed: false,
        optedOut: false,
        score: 0,
        decision: "rejected_underage",
        reasons: ["worker_must_be_18_plus"],
      };
    }

    const lower = input.replyText.toLowerCase();
    const reasons: string[] = [];
    let score = 0;

    if (lower.includes(input.filterToken.toLowerCase()) || /\b18\+\b/.test(lower)) {
      score += 25;
    } else {
      reasons.push("missing_filter_token");
    }

    if (
      lower.includes(input.city.toLowerCase()) ||
      /\b(nyc|manhattan|brooklyn|queens|bronx|subway|train)\b/i.test(lower)
    ) {
      score += 25;
    } else {
      reasons.push("missing_local_transit_confirmation");
    }

    if (
      input.hasPriorExperience ||
      /\b(promo|street team|ambassador|hospitality|sales|filming|youtube|tiktok|interview|events?)\b/i.test(lower)
    ) {
      score += 25;
    } else {
      reasons.push("missing_relevant_experience");
    }

    if (input.hasIntroClip || /\b(https?:\/\/|clip|reel|portfolio|video)\b/i.test(lower)) {
      score += 25;
    } else {
      reasons.push("missing_intro_clip");
    }

    if (score >= 75) {
      return { passed: true, optedOut: false, score, decision: "auto_hire", reasons };
    }
    if (score >= 60) {
      return { passed: true, optedOut: false, score, decision: "standby_bench", reasons };
    }
    return { passed: false, optedOut: false, score, decision: "rejected_low_score", reasons };
  }

  async queueOutreach(input: QueueOutreachInput): Promise<OutreachMessage> {
    const leaks = this.leakGuard.check(input.bodyText);
    return this.store.createOutreachMessage({
      campaignId: input.campaignId,
      agentId: input.agentId,
      humanId: input.humanId,
      channelAccountId: input.channelAccountId ?? null,
      channel: input.channel,
      tier: input.tier ?? 1,
      subject: input.subject ?? null,
      bodySummary: input.bodyText,
      leakCheckPass: leaks.length === 0,
      desiredStatus: "queued",
      dailyOutreachCap: input.dailyOutreachCap,
    });
  }

  async dispatchPendingOutreach(
    campaignId: string,
    opts: { dailyOutreachCap?: number; dryRun?: boolean } = {},
  ): Promise<DispatchOutreachResult> {
    const campaign = await this.store.getCampaign(campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

    const queued = await this.store.listOutreachMessages({ campaignId, status: "queued" });
    const liveMode =
      !opts.dryRun && Boolean(this.transport) && this.env.MARKETING_LIVE_SEND === "1";
    const dailyCap = opts.dailyOutreachCap ?? 50;

    let sent = 0;
    let dryRun = 0;
    let blockedStop = 0;
    let blockedPolicy = 0;
    let failed = 0;
    const processed: OutreachMessage[] = [];

    for (const msg of queued) {
      const human = await this.store.getHuman(msg.humanId);
      if (!human) {
        const updated = await this.store.updateOutreachStatus(msg.id, "failed");
        failed += 1;
        processed.push(updated);
        continue;
      }

      const allowed = canSendOutreach(
        human.stopped,
        human.banned,
        campaign.riskDial === "lockdown",
        human.dailySendsToday,
        dailyCap,
      );

      if (human.stopped) {
        const updated = await this.store.updateOutreachStatus(msg.id, "blocked_stop");
        blockedStop += 1;
        processed.push(updated);
        continue;
      }

      if (!allowed || !msg.leakCheckPass) {
        const updated = await this.store.updateOutreachStatus(msg.id, "blocked_policy");
        blockedPolicy += 1;
        processed.push(updated);
        continue;
      }

      if (!liveMode || !this.transport) {
        const updated = await this.store.updateOutreachStatus(
          msg.id,
          "sent",
          `dry-run:${msg.id}`,
        );
        dryRun += 1;
        processed.push(updated);
        continue;
      }

      try {
        const res = await this.transport.send({ message: msg, human, campaign });
        if (res.ok) {
          const updated = await this.store.updateOutreachStatus(
            msg.id,
            "sent",
            res.externalRef ?? `live:${msg.id}`,
          );
          sent += 1;
          processed.push(updated);
        } else {
          const updated = await this.store.updateOutreachStatus(msg.id, "failed");
          failed += 1;
          processed.push(updated);
        }
      } catch {
        const updated = await this.store.updateOutreachStatus(msg.id, "failed");
        failed += 1;
        processed.push(updated);
      }
    }

    return {
      campaignId,
      liveMode,
      sent,
      dryRun,
      blockedStop,
      blockedPolicy,
      failed,
      messages: processed,
    };
  }

  async submitAndEvaluateProof(input: SubmitProofInput): Promise<SubmitProofResult> {
    const task = await this.store.getTask(input.taskId);
    if (!task) throw new Error(`Task not found: ${input.taskId}`);
    const campaign = await this.store.getCampaign(task.campaignId);
    if (!campaign) throw new Error(`Campaign not found: ${task.campaignId}`);
    const human = task.assigneeHumanId ? await this.store.getHuman(task.assigneeHumanId) : null;

    const workerAge = input.workerAge ?? task.assigneeAgeYears ?? human?.lowestAge ?? -1;
    const workerBanned = human?.banned ?? false;

    const evidenceUrl = input.evidenceUrl?.trim() || null;
    const hasEvidenceUrl = Boolean(evidenceUrl && /^https?:\/\//i.test(evidenceUrl));
    const verifiedSignupsOrShiftDone = Boolean(
      input.shiftDone ||
        (input.verifiedSignupsCount ?? 0) > 0 ||
        (input.qrScansCount ?? 0) > 0 ||
        (input.checkinMediaHashes?.length ?? 0) >= 2,
    );

    const proof = await this.store.createProof({
      taskId: task.id,
      proofKind: input.proofKind,
      evidenceUrl: hasEvidenceUrl ? evidenceUrl : null,
      checkinMediaHashes: input.checkinMediaHashes ?? [],
      qrScansCount: input.qrScansCount ?? 0,
      verifiedSignupsCount: input.verifiedSignupsCount ?? 0,
      ftcDisclosed: input.ftcDisclosed,
      geoTimeValid: input.geoTimeValid,
      likenessReleaseOk:
        input.proofKind === "creator_video" ? Boolean(input.likenessReleaseOk) : true,
      verifierNotes: input.verifierNotes ?? null,
    });

    const preApprove =
      canApproveProof(
        hasEvidenceUrl,
        input.ftcDisclosed,
        input.geoTimeValid,
        verifiedSignupsOrShiftDone,
        workerAge,
        workerBanned,
      ) && (input.proofKind !== "creator_video" || Boolean(input.likenessReleaseOk));

    const evaluation = await this.store.evaluateProof(proof.id, {
      workerAge,
      workerBanned,
      shiftDone: verifiedSignupsOrShiftDone,
      verifierNotes: input.verifierNotes ?? undefined,
    });

    const approved = preApprove && evaluation.approved;
    if (!approved) {
      return {
        proof: evaluation.proof,
        task: evaluation.task,
        approved: false,
        rejectionReason: evaluation.reason ?? "proof_rejected",
        payoutAuthorized: false,
      };
    }

    if (input.authorizePayout === false || evaluation.task.amountCents <= 0) {
      return {
        proof: evaluation.proof,
        task: evaluation.task,
        approved: true,
        payoutAuthorized: false,
      };
    }

    const slopCashEnvEnabled =
      input.slopCashEnvEnabled ?? this.env.MARKETING_SLOP_CASH_ENABLED === "1";
    const useSlopCash = evaluation.task.payoutRail === "slop_cash";
    const spendPrecheck = canAuthorizeSpend(
      evaluation.task.tier,
      evaluation.task.amountCents,
      campaign.maxTaskCents,
      campaign.dailySpentCents,
      campaign.dailyCapCents,
      campaign.spentCents + campaign.reservedCents,
      campaign.monthlyBudgetCents,
      campaign.billingArmed,
      campaign.riskDial === "lockdown",
      useSlopCash,
      campaign.slopCashEnabled && slopCashEnvEnabled,
    );
    if (!spendPrecheck) {
      return {
        proof: evaluation.proof,
        task: evaluation.task,
        approved: true,
        payoutAuthorized: false,
        payoutError: useSlopCash && !(campaign.slopCashEnabled && slopCashEnvEnabled)
          ? "SLOP_CASH_DISABLED: slop.cash settlement is disabled."
          : "SPEND_NOT_AUTHORIZED: payout rejected by proved marketingPolicy.canAuthorizeSpend.",
      };
    }

    const idempotencyKey =
      input.payoutIdempotencyKey ?? `payout:${evaluation.task.id}:${evaluation.proof.id}`;
    const adapterId =
      input.payoutAdapterId ??
      (useSlopCash
        ? "slop_cash"
        : evaluation.task.payoutRail === "fiat_tremendous"
          ? "payout_tremendous"
          : "payout_stripe");

    try {
      const paid = await this.store.markTaskPaid(evaluation.task.id, {
        adapterId,
        idempotencyKey,
        slopCashEnvEnabled,
      });
      return {
        proof: evaluation.proof,
        task: paid.task,
        approved: true,
        payoutAuthorized: true,
        budgetEntry: paid.entry,
        campaign: paid.campaign,
      };
    } catch (err) {
      const msg =
        err instanceof PolicyViolationError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        proof: evaluation.proof,
        task: evaluation.task,
        approved: true,
        payoutAuthorized: false,
        payoutError: msg,
      };
    }
  }
}
