import {
  buildDatingOpenerScript,
  buildFriendsMeetupOpenerScript,
  containsUrlOrBrandSpam,
} from "../../../packages/core/src/externalMatchmaker.ts";
import {
  detectExternalPromptInjection,
  parseAdult18PlusAnswer,
  scrubPartifulTelecomCopy,
} from "../../../packages/core/src/externalEvents.ts";
import { RealClock } from "../../../packages/core/src/clock.ts";
import type { LeakGuard } from "../../../packages/core/src/guard.ts";
import { requireCityPack } from "./city-registry.ts";
import { marketingLeakAllowlist } from "./constants.ts";
import type { NetworkCoreBridge } from "./network-bridge.ts";
import {
  createMarketingLeakGuard,
  evaluateContactHygiene,
  evaluatePlatformTouchPolicy,
  isLocalQuietHours,
  keyedContactHash,
  MAX_PLATFORM_REPORT_RISK,
} from "./policy.ts";
import type { MarketingStore } from "./store.ts";
import {
  CANONICAL_OUTREACH_PLATFORMS,
  type CanonicalOutreachPlatform,
  type Clock,
  type PlatformInteractionOutcome,
  type PlatformInteractionRecord,
} from "./types.ts";

export { CANONICAL_OUTREACH_PLATFORMS, type CanonicalOutreachPlatform };

export type PlatformCategory = "social" | "dating" | "events";

export type PlatformExecutionMode =
  | "official_api"
  | "human_operated"
  | "human_assisted"
  | "agent_draft_human_approve";

export interface PlatformPlaybookSpec {
  readonly platform: CanonicalOutreachPlatform;
  readonly category: PlatformCategory;
  readonly executionMode: PlatformExecutionMode;
  readonly dailyOutboundCap: number;
  readonly coldDmAllowed: boolean;
  readonly coldCooldownDays: number;
  readonly requiresLinkFreeFirstTouch: boolean;
  readonly maxFirstTouchWords: number;
  readonly requiresUpfrontRoleDisclosure: boolean;
  readonly requiresCarrierScrub: boolean;
  readonly enforcePlatonicOnBff: boolean;
  readonly degradeNegativeRatePct: number;
  readonly suspendNegativeRatePct: number;
  readonly valueFirstRule: string;
}

export const PLATFORM_PLAYBOOKS: Readonly<Record<CanonicalOutreachPlatform, PlatformPlaybookSpec>> = {
  reddit: {
    platform: "reddit",
    category: "social",
    executionMode: "agent_draft_human_approve",
    dailyOutboundCap: 5,
    coldDmAllowed: false,
    coldCooldownDays: 14,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 90,
    requiresUpfrontRoleDisclosure: false,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 10,
    suspendNegativeRatePct: 20,
    valueFirstRule: "90/10 helpful local/craft replies with zero brand mention; DM only when OP explicitly asks.",
  },
  x: {
    platform: "x",
    category: "social",
    executionMode: "agent_draft_human_approve",
    dailyOutboundCap: 12,
    coldDmAllowed: false,
    coldCooldownDays: 14,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 55,
    requiresUpfrontRoleDisclosure: false,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 5,
    suspendNegativeRatePct: 10,
    valueFirstRule: "Specific public reply offering a real peer intro or insight; zero links; DM only after opt-in.",
  },
  linkedin: {
    platform: "linkedin",
    category: "social",
    executionMode: "human_assisted",
    dailyOutboundCap: 2,
    coldDmAllowed: true,
    coldCooldownDays: 14,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 60,
    requiresUpfrontRoleDisclosure: true,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 25,
    suspendNegativeRatePct: 40,
    valueFirstRule: "Human-sent <=220 char note with anti-recruiter disarm; zero calendar links or pitch decks.",
  },
  tinder: {
    platform: "tinder",
    category: "dating",
    executionMode: "human_operated",
    dailyOutboundCap: 8,
    coldDmAllowed: true,
    coldCooldownDays: 30,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 55,
    requiresUpfrontRoleDisclosure: true,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 30,
    suspendNegativeRatePct: 45,
    valueFirstRule: "Human-operated matchmaker persona with upfront bio + message-1 disclosure; zero links or brand names.",
  },
  bumble: {
    platform: "bumble",
    category: "dating",
    executionMode: "human_operated",
    dailyOutboundCap: 8,
    coldDmAllowed: true,
    coldCooldownDays: 30,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 55,
    requiresUpfrontRoleDisclosure: true,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: true,
    degradeNegativeRatePct: 30,
    suspendNegativeRatePct: 45,
    valueFirstRule: "Transparent Opening Move + immediate role disclosure on reply 1; strict platonic filter on BFF.",
  },
  hinge: {
    platform: "hinge",
    category: "dating",
    executionMode: "human_operated",
    dailyOutboundCap: 8,
    coldDmAllowed: true,
    coldCooldownDays: 30,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 45,
    requiresUpfrontRoleDisclosure: true,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 30,
    suspendNegativeRatePct: 45,
    valueFirstRule: "Prompt-specific comment only (zero blank likes) with upfront matchmaker disclosure; zero links.",
  },
  meetup: {
    platform: "meetup",
    category: "events",
    executionMode: "official_api",
    dailyOutboundCap: 3,
    coldDmAllowed: false,
    coldCooldownDays: 14,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 75,
    requiresUpfrontRoleDisclosure: false,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 5,
    suspendNegativeRatePct: 10,
    valueFirstRule: "Official Meetup GraphQL anchored events (<=15 cap, 18+ screening, T-24h quorum>=3) + organizer value notes; zero attendee DMs.",
  },
  eventbrite: {
    platform: "eventbrite",
    category: "events",
    executionMode: "human_assisted",
    dailyOutboundCap: 2,
    coldDmAllowed: false,
    coldCooldownDays: 14,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 75,
    requiresUpfrontRoleDisclosure: false,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 5,
    suspendNegativeRatePct: 10,
    valueFirstRule: "Sanctioned organizer listings + host table-fill value offers; zero attendee scraping or cold blasts.",
  },
  luma: {
    platform: "luma",
    category: "events",
    executionMode: "official_api",
    dailyOutboundCap: 4,
    coldDmAllowed: false,
    coldCooldownDays: 14,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 75,
    requiresUpfrontRoleDisclosure: false,
    requiresCarrierScrub: false,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 5,
    suspendNegativeRatePct: 10,
    valueFirstRule: "Official Luma API (hidden guest list, approval required) + host-to-host vetted guest intros; zero guest scraping.",
  },
  partiful: {
    platform: "partiful",
    category: "events",
    executionMode: "human_assisted",
    dailyOutboundCap: 2,
    coldDmAllowed: false,
    coldCooldownDays: 14,
    requiresLinkFreeFirstTouch: true,
    maxFirstTouchWords: 75,
    requiresUpfrontRoleDisclosure: false,
    requiresCarrierScrub: true,
    enforcePlatonicOnBff: false,
    degradeNegativeRatePct: 5,
    suspendNegativeRatePct: 10,
    valueFirstRule: "Human-assisted PartifulEventKit with mandatory SHAFT telecom scrubbing, hidden guest list, and approval gating.",
  },
};

export function getPlatformPlaybook(platform: CanonicalOutreachPlatform): PlatformPlaybookSpec {
  return PLATFORM_PLAYBOOKS[platform];
}

export interface ReportRiskEvaluationInput {
  readonly platform: CanonicalOutreachPlatform;
  readonly text: string;
  readonly subject?: string;
  readonly isBff?: boolean;
  readonly isFirstTouch?: boolean;
  readonly hasRecipientSpecificReference?: boolean;
  readonly explicitUrlRequested?: boolean;
  readonly leakGuard?: LeakGuard;
}

export interface ReportRiskEvaluationResult {
  readonly pass: boolean;
  readonly score: number;
  readonly maxAllowed: number;
  readonly hasUnsolicitedUrl: boolean;
  readonly flags: readonly string[];
  readonly leakReasons: readonly string[];
  readonly scrubbedText?: string;
  readonly scrubbedTerms?: readonly string[];
}

const PITCH_SLAP_PATTERN =
  /\b(check\s+out\s+(?:our|my)\s+app|limited\s+spots?|exclusive\s+community|sign\s+up\s+(?:today|now|here)|revolutioniz(?:e|ing)|pick\s+your\s+brain|synerg(?:y|ies)|quick\s+15[\s-]?min(?:ute)?\s+call|calendly|cal\.com|book\s+a\s+demo|referral\s+code|promo\s+code|act\s+now|free\s+trial|guaranteed\s+matches|opportunity\s+for\s+you)\b/i;

const INTERNAL_RANKING_OR_CLEF_PATTERN =
  /\b(clef\s*score|clef\s*rating|attractiveness\s*score|looks\s*rating|rated\s+a\s+\d(?:\.\d)?\/10|league\s+tier|status\s+percentile|wealth\s+score)\b/i;

const MINOR_CUE_PATTERN =
  /\b(high\s*school(?:er)?s?|middle\s*school|under\s*18|15[\s-]?year[\s-]?old|16[\s-]?year[\s-]?old|17[\s-]?year[\s-]?old|prom\s*date|teen\s*dating)\b/i;

const ROLE_DISCLOSURE_PATTERN =
  /\b(matchmaker|setting\s+up|not\s+dating(?:\s+on\s+here)?\s+myself|not\s+looking\s+for\s+myself|not\s+recruiting|not\s+selling|organize\s+small)\b/i;

const ROMANCE_FRAMING_PATTERN =
  /\b(hot\s*singles|hookup|blind\s*date|romantic\s*match|situationship|swipe\s*right|find\s+a\s+(?:girlfriend|boyfriend))\b/i;

const RAW_URL_PATTERN = /https?:\/\/|\bwww\./i;

let cachedPlaybookLeakGuard: LeakGuard | null = null;

function getDefaultPlaybookLeakGuard(): LeakGuard {
  if (!cachedPlaybookLeakGuard) {
    cachedPlaybookLeakGuard = createMarketingLeakGuard(process.env, {
      allow: [...marketingLeakAllowlist()],
    });
  }
  return cachedPlaybookLeakGuard;
}

function countDraftWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function evaluateReportRisk(input: ReportRiskEvaluationInput): ReportRiskEvaluationResult {
  const spec = getPlatformPlaybook(input.platform);
  const fullText = [input.subject?.trim(), input.text.trim()].filter(Boolean).join("\n");
  const flags: string[] = [];
  let score = 0;

  const isFirstTouch = input.isFirstTouch !== false;
  const urlOrSpam = containsUrlOrBrandSpam(fullText) || RAW_URL_PATTERN.test(fullText);
  const hasUnsolicitedUrl = urlOrSpam && !input.explicitUrlRequested;

  if (hasUnsolicitedUrl && spec.requiresLinkFreeFirstTouch && isFirstTouch) {
    score += 40;
    flags.push("unsolicited_url_or_brand_spam");
  }

  if (MINOR_CUE_PATTERN.test(fullText) || (/\b1[3-7]\b/.test(fullText) && !parseAdult18PlusAnswer(fullText))) {
    score += 35;
    flags.push("minor_or_underage_cue");
  }

  if (detectExternalPromptInjection(fullText) !== null) {
    score += 40;
    flags.push("prompt_injection_detected");
  }

  if (INTERNAL_RANKING_OR_CLEF_PATTERN.test(fullText)) {
    score += 30;
    flags.push("internal_ranking_or_clef_leak");
  }

  const guard = input.leakGuard ?? getDefaultPlaybookLeakGuard();
  const leakReasons = guard.check(fullText);
  if (leakReasons.length > 0) {
    score += 30;
    for (const r of leakReasons) {
      flags.push(`leak_guard:${r}`);
    }
  }

  if (PITCH_SLAP_PATTERN.test(fullText)) {
    score += 25;
    flags.push("pitch_slap_or_hype_phrase");
  }

  if (spec.requiresUpfrontRoleDisclosure && isFirstTouch && !ROLE_DISCLOSURE_PATTERN.test(fullText)) {
    score += 20;
    flags.push("missing_upfront_role_disclosure");
  }

  if (input.hasRecipientSpecificReference === false) {
    score += 20;
    flags.push("generic_non_specific_opener");
  }

  const wordCount = countDraftWords(input.text);
  if (wordCount === 0) {
    score += 30;
    flags.push("empty_draft");
  } else if (isFirstTouch && wordCount > spec.maxFirstTouchWords) {
    score += 15;
    flags.push(`exceeds_word_limit (${wordCount} > ${spec.maxFirstTouchWords})`);
  }

  if (input.platform === "linkedin" && isFirstTouch && input.text.trim().length > 280) {
    score += 15;
    flags.push("linkedin_note_too_long");
  }

  if ((input.isBff && spec.enforcePlatonicOnBff) && ROMANCE_FRAMING_PATTERN.test(fullText)) {
    score += 35;
    flags.push("platonic_bff_romance_bleed");
  }

  const selfMatches = (fullText.match(/\b(i|i'm|im|we|we're|our|my)\b/gi) ?? []).length;
  const youMatches = (fullText.match(/\b(you|you're|your|yours)\b/gi) ?? []).length;
  if (wordCount >= 20 && selfMatches >= 5 && selfMatches > Math.max(1, youMatches) * 2) {
    score += 15;
    flags.push("self_centered_ratio");
  }

  let scrubbedText: string | undefined;
  let scrubbedTerms: string[] | undefined;
  if (spec.requiresCarrierScrub) {
    const scrubbed = scrubPartifulTelecomCopy(input.text);
    scrubbedText = scrubbed.text;
    scrubbedTerms = scrubbed.scrubbedTerms;
    if (scrubbed.scrubbedTerms.length > 0) {
      score += 25;
      flags.push(`partiful_shaft_terms:${scrubbed.scrubbedTerms.join(",")}`);
    }
  }

  const clampedScore = Math.min(100, score);
  return {
    pass: clampedScore <= MAX_PLATFORM_REPORT_RISK && leakReasons.length === 0,
    score: clampedScore,
    maxAllowed: MAX_PLATFORM_REPORT_RISK,
    hasUnsolicitedUrl,
    flags,
    leakReasons,
    ...(scrubbedText !== undefined ? { scrubbedText } : {}),
    ...(scrubbedTerms !== undefined ? { scrubbedTerms } : {}),
  };
}

export interface PlatformDraftInput {
  readonly platform: CanonicalOutreachPlatform;
  readonly city: string;
  readonly recipientName: string;
  readonly specificContext: string;
  readonly senderName?: string;
  readonly peerSummary?: string;
  readonly neighborhood?: string;
  readonly dayLabel?: string;
  readonly timeLabel?: string;
  readonly activity?: string;
  readonly mode?:
    | "public_reply"
    | "opt_in_dm"
    | "connection_note"
    | "matchmaker_opener"
    | "host_note"
    | "event_listing";
  readonly isBff?: boolean;
  readonly isReplyFollowup?: boolean;
}

export interface PlatformDraftResult {
  readonly platform: CanonicalOutreachPlatform;
  readonly executionMode: PlatformExecutionMode;
  readonly subject?: string;
  readonly body: string;
  readonly wordCount: number;
  readonly risk: ReportRiskEvaluationResult;
}

export function buildPlatformDraft(input: PlatformDraftInput): PlatformDraftResult {
  const pack = requireCityPack(input.city);
  const spec = getPlatformPlaybook(input.platform);
  const firstName = input.recipientName.trim().split(/\s+/)[0] || "there";
  const context = input.specificContext.trim().replace(/\.+$/, "");
  const hood = input.neighborhood?.trim() || pack.corridors[0]?.neighborhood || pack.label;
  const sender = input.senderName?.trim() || "The Operator";
  const peer = input.peerSummary?.trim() || `a vetted local peer in ${hood}`;
  const day = input.dayLabel?.trim() || "Thursday";
  const time = input.timeLabel?.trim() || "7pm";
  const activity = input.activity?.trim() || "coffee";

  let subject: string | undefined;
  let body: string;

  switch (input.platform) {
    case "reddit":
      body =
        input.mode === "opt_in_dm"
          ? `Hey ${firstName} — thanks for replying on the thread about ${context}. We keep a small 4-5 person 18+ hangout in ${hood} (${day} around ${time}, public cafe, pay your own tab). Happy to save you a spot if timing fits — zero pressure either way.`
          : `If you're looking for a low-key small group around ${context}, showing up to a consistent 4-5 person public hang in ${hood} beats giant mixers every time. I help organize a quiet 18+ table ${day} around ${time} — reply if you ever want details, totally fine to pass.`;
      break;
    case "x":
      body =
        input.mode === "opt_in_dm"
          ? `Awesome ${firstName} — quick context before connecting you: ${peer} is tackling ${context}. Still want me to put you both on a quick thread? Zero strings.`
          : `Really sharp point on ${context}. Know ${peer} working on the same problem in ${pack.label} — happy to intro you two if a 20-min coffee sounds useful.`;
      break;
    case "linkedin":
      body = `Hi ${firstName} — read your note on ${context}. Not recruiting or selling anything; happy to connect you with ${peer} in ${hood} if useful, zero pressure.`;
      break;
    case "tinder":
      body = buildDatingOpenerScript({
        prospectFirstName: firstName,
        cityName: pack.label,
        promptDetail: context,
        isReplyFollowup: input.isReplyFollowup,
      });
      break;
    case "bumble":
      body = input.isBff
        ? buildFriendsMeetupOpenerScript({
            prospectFirstName: firstName,
            hobbyOrNeighborhood: context,
            activity,
            neighborhood: hood,
            dayLabel: day,
            timeLabel: time,
          })
        : buildDatingOpenerScript({
            prospectFirstName: firstName,
            cityName: pack.label,
            promptDetail: context,
            isReplyFollowup: input.isReplyFollowup ?? true,
          });
      break;
    case "hinge":
      body = `Heads up ${firstName}: I'm a local ${pack.label} matchmaker (not dating myself) — your prompt about ${context} fits someone great I'm setting up. Open to an intro?`;
      break;
    case "meetup":
      subject = `${hood} ${activity} group`;
      body = `Hi ${firstName},\n\nSaw your ${hood} Meetup around ${context}. We have a few reliable 18+ locals in ${pack.label} who always show up and pay their own tab — happy to send 2-3 great regulars your way if you ever want fresh faces, zero strings.\n\n— ${sender}`;
      break;
    case "eventbrite":
      subject = `Small ${hood} regular crew`;
      body = `Hi ${firstName},\n\nCaught your ${hood} Eventbrite session on ${context} — love keeping the room small and real. If you ever want 4-6 reliable 18+ ${pack.label} regulars paying their own way on a quieter night, happy to send a great crew. Zero strings.\n\n— ${sender}`;
      break;
    case "luma":
      subject = `Seat note for your ${hood} salon`;
      body = `Hi ${firstName},\n\nSaw your ${hood} Luma session on ${context} — appreciate keeping it sharp and sales-free. If you ever have 1-2 open seats, I know ${peer} who would add a lot to the room. Happy to intro them anytime — zero strings.\n\n— ${sender}`;
      break;
    case "partiful": {
      const rawBody =
        input.mode === "event_listing"
          ? `Small 18+ neighborhood hangout in ${hood} (${day} ${time}) focused on ${context}. Public cafe, everyone grabs their own refreshments at the counter. Approval required to keep the table balanced.`
          : `Hi ${firstName}, saw your ${hood} gathering around ${context}. Happy to send 2 reliable 18+ locals who bring warm conversation and always show up on time if you ever want extra company — zero pressure.`;
      body = scrubPartifulTelecomCopy(rawBody).text;
      break;
    }
  }

  const risk = evaluateReportRisk({
    platform: input.platform,
    subject,
    text: body,
    isBff: input.isBff,
    isFirstTouch: true,
    hasRecipientSpecificReference: context.length >= 4,
  });

  return {
    platform: input.platform,
    executionMode: spec.executionMode,
    ...(subject ? { subject } : {}),
    body,
    wordCount: countDraftWords(body),
    risk,
  };
}

export type PlatformHealthStatus = "active" | "degraded" | "suspended";

export interface PlatformChannelHealth {
  readonly platform: CanonicalOutreachPlatform;
  readonly status: PlatformHealthStatus;
  readonly baseDailyCap: number;
  readonly effectiveDailyCap: number;
  readonly rollingWindowCount: number;
  readonly negativeCount: number;
  readonly negativeRatePct: number;
  readonly reportedCount: number;
  readonly sentToday: number;
  readonly reason?: string;
}

const NEGATIVE_OUTCOMES = new Set<PlatformInteractionOutcome>([
  "unmatched",
  "stopped",
  "reported",
]);

export function evaluatePlatformHealth(
  platform: CanonicalOutreachPlatform,
  interactions: readonly PlatformInteractionRecord[],
  nowMs: number,
): PlatformChannelHealth {
  const spec = getPlatformPlaybook(platform);
  const matching = interactions.filter((i) => i.platform === platform);
  const window = matching.slice(0, 20);
  const dayPrefix = new Date(nowMs).toISOString().slice(0, 10);
  const sentToday = matching.filter(
    (i) =>
      i.direction === "outbound" &&
      (i.outcome === "sent" || i.outcome === "dry_run" || i.outcome === "replied_positive") &&
      i.createdAt.slice(0, 10) === dayPrefix,
  ).length;

  const reportedCount = window.filter((i) => i.outcome === "reported").length;
  const negativeCount = window.filter((i) => NEGATIVE_OUTCOMES.has(i.outcome)).length;
  const negativeRatePct =
    window.length > 0 ? Math.round((negativeCount * 100) / window.length) : 0;

  if (reportedCount >= 2) {
    return {
      platform,
      status: "suspended",
      baseDailyCap: spec.dailyOutboundCap,
      effectiveDailyCap: 0,
      rollingWindowCount: window.length,
      negativeCount,
      negativeRatePct,
      reportedCount,
      sentToday,
      reason: "user_reports_circuit_breaker",
    };
  }
  if (window.length >= 10 && negativeRatePct >= spec.suspendNegativeRatePct) {
    return {
      platform,
      status: "suspended",
      baseDailyCap: spec.dailyOutboundCap,
      effectiveDailyCap: 0,
      rollingWindowCount: window.length,
      negativeCount,
      negativeRatePct,
      reportedCount,
      sentToday,
      reason: `negative_rate_${negativeRatePct}pct_exceeded_suspend_${spec.suspendNegativeRatePct}pct`,
    };
  }
  if (reportedCount === 1 || (window.length >= 10 && negativeRatePct >= spec.degradeNegativeRatePct)) {
    const degradedCap = Math.max(1, Math.floor(spec.dailyOutboundCap / 2));
    return {
      platform,
      status: "degraded",
      baseDailyCap: spec.dailyOutboundCap,
      effectiveDailyCap: degradedCap,
      rollingWindowCount: window.length,
      negativeCount,
      negativeRatePct,
      reportedCount,
      sentToday,
      reason: reportedCount === 1 ? "single_report_degraded_50pct" : `negative_rate_${negativeRatePct}pct_degraded`,
    };
  }

  return {
    platform,
    status: "active",
    baseDailyCap: spec.dailyOutboundCap,
    effectiveDailyCap: spec.dailyOutboundCap,
    rollingWindowCount: window.length,
    negativeCount,
    negativeRatePct,
    reportedCount,
    sentToday,
  };
}

export interface DispatchPlatformTouchInput {
  readonly store: MarketingStore;
  readonly bridge?: NetworkCoreBridge;
  readonly clock?: Clock;
  readonly env?: Record<string, string | undefined>;
  readonly campaignId?: string | null;
  readonly city: string;
  readonly platform: CanonicalOutreachPlatform;
  readonly channelAccountId?: string | null;
  readonly contactIdentifier: string;
  readonly identifierKind?: "email" | "phone" | "handle";
  readonly interactionKind: string;
  readonly subject?: string;
  readonly bodyText: string;
  readonly isCold?: boolean;
  readonly isBff?: boolean;
  readonly explicitUrlRequested?: boolean;
  readonly lockdown?: boolean;
  readonly dryRun?: boolean;
}

export interface DispatchPlatformTouchResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly contactHash: string | null;
  readonly risk: ReportRiskEvaluationResult;
  readonly health: PlatformChannelHealth;
  readonly interaction?: PlatformInteractionRecord;
}

export async function dispatchPlatformTouch(
  input: DispatchPlatformTouchInput,
): Promise<DispatchPlatformTouchResult> {
  const clock = input.clock ?? input.store.clock ?? new RealClock();
  const env = input.env ?? process.env;
  const nowMs = clock.now();
  const spec = getPlatformPlaybook(input.platform);
  const contactHash = keyedContactHash(
    input.identifierKind ?? "handle",
    input.contactIdentifier,
    env,
  );

  const recentInteractions = await input.store.listPlatformInteractions({
    platform: input.platform,
    limit: 50,
  });
  const health = evaluatePlatformHealth(input.platform, recentInteractions, nowMs);
  const risk = evaluateReportRisk({
    platform: input.platform,
    subject: input.subject,
    text: input.bodyText,
    isBff: input.isBff,
    isFirstTouch: input.isCold !== false,
    explicitUrlRequested: input.explicitUrlRequested,
  });

  if (!contactHash) {
    return {
      allowed: false,
      reason: "invalid_contact_identifier",
      contactHash: null,
      risk,
      health,
    };
  }

  const isCold = input.isCold !== false;
  if (isCold && !spec.coldDmAllowed && input.interactionKind.includes("dm")) {
    const interaction = await input.store.recordPlatformInteraction({
      campaignId: input.campaignId ?? null,
      platform: input.platform,
      channelAccountId: input.channelAccountId ?? null,
      contactHash,
      direction: "outbound",
      interactionKind: input.interactionKind,
      reportRiskScore: Math.max(risk.score, 40),
      outcome: "blocked_policy",
    });
    return {
      allowed: false,
      reason: `cold_dm_prohibited_on_${input.platform}`,
      contactHash,
      risk,
      health,
      interaction,
    };
  }

  const suppression = await input.store.isContactSuppressed(contactHash);
  let bridgeBlocked = false;
  let bridgeMinor = false;
  let bridgeStopped = false;
  let bridgeReason: string | undefined;
  if (input.bridge) {
    const verdict = await input.bridge.checkContactFence({
      ...(input.identifierKind === "email"
        ? { email: input.contactIdentifier }
        : input.identifierKind === "phone"
          ? { phone: input.contactIdentifier, phoneHash: contactHash }
          : { handleHash: contactHash }),
    });
    if (!verdict.allowed) {
      bridgeBlocked = true;
      bridgeMinor = verdict.knownMinor;
      bridgeStopped = verdict.globallyStopped;
      bridgeReason = verdict.reason;
    }
  }

  const isKnownMinor = Boolean(suppression?.isMinor) || bridgeMinor;
  const isStopped = bridgeStopped || Boolean(suppression?.reason.includes("stop"));
  const isBanned =
    (bridgeBlocked && !bridgeMinor && !bridgeStopped) ||
    Boolean(suppression && !suppression.isMinor && !suppression.reason.includes("stop"));

  const stats = await input.store.getContactTouchpointStats(contactHash, nowMs);
  const quiet = isLocalQuietHours(input.city, nowMs);
  const hygiene = evaluateContactHygiene({
    isStopped,
    isBanned,
    isKnownMinor,
    lockdown: Boolean(input.lockdown),
    isCold,
    isQuietHours: quiet,
    daysSinceCold: stats.daysSinceLastCold,
    coldTouches30d: stats.coldTouches30d,
    unansweredCold: stats.unansweredColdStreak,
    opTouchesToday: stats.opTouchesToday,
  });

  const cooldownOk =
    hygiene.allowed && (!isCold || stats.daysSinceLastCold >= spec.coldCooldownDays);
  const contactSafe = !isStopped && !isBanned && !isKnownMinor && !input.lockdown;

  const touchPolicy = evaluatePlatformTouchPolicy({
    sentToday: health.sentToday,
    effectiveDailyCap: health.effectiveDailyCap,
    reportRiskScore: risk.score,
    hasUnsolicitedUrl: risk.hasUnsolicitedUrl,
    requiresLinkFree: spec.requiresLinkFreeFirstTouch && isCold,
    contactSafe,
    cooldownAllowed: cooldownOk,
    channelSuspended: health.status === "suspended",
  });

  if (!touchPolicy.allowed || !risk.pass) {
    const outcome: PlatformInteractionOutcome =
      !risk.pass || risk.score > MAX_PLATFORM_REPORT_RISK ? "blocked_risk" : "blocked_policy";
    const interaction = await input.store.recordPlatformInteraction({
      campaignId: input.campaignId ?? null,
      platform: input.platform,
      channelAccountId: input.channelAccountId ?? null,
      contactHash,
      direction: "outbound",
      interactionKind: input.interactionKind,
      reportRiskScore: risk.score,
      outcome,
    });
    return {
      allowed: false,
      reason: bridgeReason ?? (!hygiene.allowed ? hygiene.reason : touchPolicy.reason) ?? "platform_touch_blocked",
      contactHash,
      risk,
      health,
      interaction,
    };
  }

  const interaction = await input.store.recordPlatformInteraction({
    campaignId: input.campaignId ?? null,
    platform: input.platform,
    channelAccountId: input.channelAccountId ?? null,
    contactHash,
    direction: "outbound",
    interactionKind: input.interactionKind,
    reportRiskScore: risk.score,
    outcome: input.dryRun !== false ? "dry_run" : "sent",
  });
  await input.store.recordContactTouchpoint({
    contactHash,
    campaignId: input.campaignId ?? null,
    surface: "platform",
    isCold,
    answered: false,
  });

  return {
    allowed: true,
    contactHash,
    risk,
    health,
    interaction,
  };
}
