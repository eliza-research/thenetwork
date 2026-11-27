import { brandFor, supportEmail } from "../../../packages/core/src/generated/brandIdentity.ts";
import {
  deviceBatteryMax,
  deviceBatteryMin,
  deviceTempMaxC,
  deviceTempMinC,
} from "../../../packages/core/src/generated/marketingDevice.ts";
import {
  banditMaxStopRateBps,
  consumerLifetimeBonusCapCents,
  marketingAdultAge,
  marketingMaxAge,
  mvnoBonusCapCents,
  w9AnnualThresholdCents,
} from "../../../packages/core/src/generated/marketingPolicy.ts";
import type { DesireLaneId } from "./desire-lanes.ts";
import type {
  AgentAuthMode,
  BrandAppId,
  PersonaId,
  SubscriptionProvider,
  SupportedCity,
} from "./types.ts";

export type EmailTemplateId =
  | "craigslist_gig_post"
  | "applicant_screening_hire_reply"
  | "agency_rfp"
  | "creator_street_interview_brief"
  | "proof_of_work_reminder";

export interface CanonicalAgentSpec {
  id: string;
  personaId: PersonaId;
  displayName: string;
  appId: BrandAppId;
  primaryDesireLane: DesireLaneId;
  provider: SubscriptionProvider;
  failoverProvider: SubscriptionProvider;
  authMode: AgentAuthMode;
  sessionRef: string;
  dailyTurnCap: number;
  roleSummary: string;
  systemPrompt: string;
}

export interface AutomatedEmailTemplate {
  id: EmailTemplateId;
  title: string;
  channel: "craigslist" | "email";
  subjectTemplate: string;
  bodyTemplate: string;
  requiredVariables: readonly string[];
  legalGuardrails: readonly string[];
}

export {
  banditMaxStopRateBps,
  consumerLifetimeBonusCapCents,
  deviceBatteryMax,
  deviceBatteryMin,
  deviceTempMaxC,
  deviceTempMinC,
  marketingAdultAge,
  marketingMaxAge,
  mvnoBonusCapCents,
  w9AnnualThresholdCents,
};

export const BRAND_DOMAINS: Readonly<Record<BrandAppId, string>> = {
  ntwrk: brandFor("Ntwrk").domain,
  slop: brandFor("Slop").domain,
  peon: brandFor("Peon").domain,
  friends: brandFor("Friends").domain,
};

export const BRAND_SHORT_DOMAINS: Readonly<Record<BrandAppId, string>> = {
  ntwrk: `go.${BRAND_DOMAINS.ntwrk}`,
  slop: `go.${BRAND_DOMAINS.slop}`,
  peon: `go.${BRAND_DOMAINS.peon}`,
  friends: `go.${BRAND_DOMAINS.friends}`,
};

export const DEFAULT_SUPPORT_EMAIL = supportEmail;
export const DEFAULT_MARKETING_OPS_BASE_URL = `https://ops.${BRAND_DOMAINS.ntwrk}`;
export const DEFAULT_MARKETING_OPS_HOST = `ops.${BRAND_DOMAINS.ntwrk}`;
export const DEFAULT_OPS_EMAIL = `ops@${BRAND_DOMAINS.ntwrk}`;

export function resolveMarketingOpsBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.MARKETING_OPS_BASE_URL?.trim();
  if (configured && /^https:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, "");
  }
  return DEFAULT_MARKETING_OPS_BASE_URL;
}

export function buildOpsReleaseUrl(
  batchCode: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return `${resolveMarketingOpsBaseUrl(env)}/release?batch=${encodeURIComponent(batchCode)}`;
}

export function buildOpsContractUrl(
  batchCode: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return `${resolveMarketingOpsBaseUrl(env)}/contractor-terms?batch=${encodeURIComponent(batchCode)}`;
}

export function buildOpsProofUploadUrl(
  batchCode: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return `${resolveMarketingOpsBaseUrl(env)}/proofs/upload?batch=${encodeURIComponent(batchCode)}`;
}

export function marketingLeakAllowlist(
  extra: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const opsBase = resolveMarketingOpsBaseUrl(env);
  let opsHost: string;
  try {
    opsHost = new URL(opsBase).hostname;
  } catch {
    opsHost = DEFAULT_MARKETING_OPS_HOST;
  }
  return Array.from(
    new Set<string>([
      BRAND_DOMAINS.ntwrk,
      BRAND_DOMAINS.slop,
      BRAND_DOMAINS.peon,
      BRAND_DOMAINS.friends,
      BRAND_SHORT_DOMAINS.ntwrk,
      BRAND_SHORT_DOMAINS.slop,
      BRAND_SHORT_DOMAINS.peon,
      BRAND_SHORT_DOMAINS.friends,
      opsHost,
      DEFAULT_SUPPORT_EMAIL,
      DEFAULT_OPS_EMAIL,
      ...extra,
    ]),
  );
}

export const DEFAULT_MONTHLY_BUDGET_CENTS = 1_000_000;
export const DEFAULT_DAILY_CAP_CENTS = 100_000;
export const DEFAULT_MAX_TASK_CENTS = 150_000;
export const DEFAULT_DAILY_OUTREACH_CAP = 50;
export const DEFAULT_DAILY_TURN_CAP = 60;
export const DEFAULT_OPERATOR_TURN_CAP = 80;
export const DEFAULT_BANDIT_MAX_CPA_CENTS = 2_125;

export const DEFAULT_SLOP_CASH_REPO = "eliza-research/thenetwork";
export const DEFAULT_SLOP_CASH_CHAIN = "base" as const;

export const DEFAULT_MARKETING_HOST = "127.0.0.1";
export const DEFAULT_MARKETING_PORT = 4949;

export const RENTAHUMAN_MCP_ENDPOINT = "https://rentahuman.ai/api/mcp";
export const RENTAHUMAN_BUYER_FEE_RATE = 0.18;

export const SUPPORTED_CITIES: readonly SupportedCity[] = [
  "nyc",
  "sf",
  "la",
  "chicago",
  "miami",
  "austin",
  "london",
] as const;

export const SUPPORTED_SUBSCRIPTION_PROVIDERS: readonly SubscriptionProvider[] = [
  "chatgpt",
  "claude",
  "gemini",
  "surplus",
] as const;

export const FALLBACK_PROVIDER_ORDER: readonly SubscriptionProvider[] = [
  "claude",
  "chatgpt",
  "gemini",
  "surplus",
] as const;

export const CANONICAL_MARKETING_AGENTS: readonly CanonicalAgentSpec[] = [
  {
    id: "agent-chadwick",
    personaId: "chadwick",
    displayName: "Chadwick",
    appId: "slop",
    primaryDesireLane: "soulmate_dating",
    provider: "chatgpt",
    failoverProvider: "claude",
    authMode: "cli",
    sessionRef: "sub:chatgpt:chadwick",
    dailyTurnCap: DEFAULT_DAILY_TURN_CAP,
    roleSummary:
      "slop.date anti-swipe wingman — leads local dating comedy shorts, nightlife bar activations, and street-interview drops across launch cities.",
    systemPrompt: `You are Chadwick, charismatic anti-swipe wingman for ${BRAND_DOMAINS.slop} (18+ adult dating only). Never contact minors, never reference internal appearance scores, enforce FTC #Ad disclosure, and respect STOP opt-outs immediately.`,
  },
  {
    id: "agent-sloane",
    personaId: "sloane",
    displayName: "Sloane",
    appId: "slop",
    primaryDesireLane: "soulmate_dating",
    provider: "claude",
    failoverProvider: "chatgpt",
    authMode: "cli",
    sessionRef: "sub:claude:sloane",
    dailyTurnCap: DEFAULT_DAILY_TURN_CAP,
    roleSummary:
      "slop.date dating growth lead — negotiates high-taste street-interview creators, wine-bar partners, and Nominate-a-Friend loops across cities.",
    systemPrompt: `You are Sloane, sharp dating growth and creator-partnerships lead for ${BRAND_DOMAINS.slop} (18+ only). Never contact minors, keep pricing 100% gender-neutral, enforce FTC #Ad disclosure, and respect STOP opt-outs immediately.`,
  },
  {
    id: "agent-peon",
    personaId: "peon",
    displayName: "Peon",
    appId: "peon",
    primaryDesireLane: "money_work",
    provider: "gemini",
    failoverProvider: "claude",
    authMode: "cli",
    sessionRef: "sub:gemini:peon",
    dailyTurnCap: DEFAULT_DAILY_TURN_CAP,
    roleSummary:
      "peon.biz career, money & builder scout — runs founder-corridor activations, OSS/GitHub/arXiv/HN outreach, and co-founder/employer partnerships.",
    systemPrompt: `You are Peon, candid work, money, and builder-growth agent for ${BRAND_DOMAINS.peon}. Maintain strict separation from dating data, never charge candidates, keep outreach authentic, and honor STOP immediately.`,
  },
  {
    id: "agent-venn",
    personaId: "venn",
    displayName: "Venn",
    appId: "friends",
    primaryDesireLane: "ideal_friends",
    provider: "claude",
    failoverProvider: "gemini",
    authMode: "cli",
    sessionRef: "sub:claude:venn",
    dailyTurnCap: DEFAULT_DAILY_TURN_CAP,
    roleSummary:
      "friends.help local community director — partners with run clubs, supper clubs, game cafes, and neighborhood hosts for 3+3 real-world friendships.",
    systemPrompt: `You are Venn, energetic platonic friendship and local community agent for ${BRAND_DOMAINS.friends}. Keep all framing strictly platonic, meet in public venues only, never run paid marketing toward minors, and honor STOP immediately.`,
  },
  {
    id: "agent-operator",
    personaId: "operator",
    displayName: "The Operator",
    appId: "ntwrk",
    primaryDesireLane: "elite_serendipity",
    provider: "chatgpt",
    failoverProvider: "claude",
    authMode: "cli",
    sessionRef: "sub:chatgpt:operator",
    dailyTurnCap: DEFAULT_OPERATOR_TURN_CAP,
    roleSummary:
      "Cross-city concierge & ops coordinator — curates 6-seat VIP salons, screens 18+ local connectors, dispatches city-compliant agreements, audits proofs, and manages agency RFPs.",
    systemPrompt: `You are The Operator, high-trust concierge and campaign coordinator for The Network (${BRAND_DOMAINS.ntwrk}, ${BRAND_DOMAINS.slop}, ${BRAND_DOMAINS.peon}, ${BRAND_DOMAINS.friends}). Enforce 18+ paid floors, city-specific labor/filming laws, budget caps, proof verification, and global STOP fences.`,
  },
] as const;

export const FTC_DISCLOSURE_CLAUSE =
  'FTC 16 CFR Part 255 / Local Ad Disclosure: Include BOTH a clear spoken disclosure ("Sponsored by The Network") AND prominent on-screen text ("#Ad" or "Paid Partnership with The Network") in the first 3 seconds, plus enable the native platform Paid Partnership / Commercial Content toggle.';

export const NY_RELEASE_CLAUSE =
  "NY Civil Rights Law §§ 50–51 (Commercial Likeness Release): Every recognizable featured interviewee must be 18+ and complete our 10-second mobile commercial likeness release before publication; blur or cut any unsigned person.";

export const ON_SITE_RELEASE_FORM_COPY =
  "I confirm I am at least 18 years old. Under applicable commercial publicity law (including NY Civil Rights Law §§ 50–51, CA Civil Code § 3344, and equivalent local statutes), I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview in organic and paid social and promotional materials, with no additional compensation owed.";

export const ANTI_POSTING_NOTICE =
  "NYC Administrative Code § 10-119: Hand-to-hand sidewalk distribution only (keep >= 8 ft clear path). Never tape, glue, or post fliers on lampposts, poles, trees, mailboxes, or car windshields.";

export const MTA_EXCLUSION_NOTICE =
  "21 NYCRR § 1050.6: Commercial flyers are strictly prohibited inside MTA subway stations, mezzanines, and platforms. Stay on outdoor public sidewalks at least 20 ft outside entrances.";

const DEFAULT_TEMPLATE_FALLBACKS: Readonly<Record<string, string>> = {
  CITY_LABEL: "your city",
  CITY_CODE: "LOCAL",
  DESIRE_PROMISE: "great friends, real dates, and dream work",
  HOURLY_RATE_LABEL: "$22/hr",
  BASE_SHIFT_PAY: "$88",
  BONUS_PER_SIGNUP: "$2",
  BONUS_CAP_SHIFT: "$80",
  OPS_EMAIL: DEFAULT_OPS_EMAIL,
  SENDER_NAME: "The Network Field Team",
  LOCAL_LABOR_STATUTE: "written itemized contractor terms (paid within 48 hours of verified completion, hard SLA <= 15 days)",
  LOCAL_ANTI_POSTING: "Hand-to-hand distribution to willing adults on public sidewalks only; never tape, paste, or leave fliers on poles, trees, or cars.",
  LOCAL_TRANSIT_RULE: "Stay on outdoor public sidewalks outside transit station entrances and private property.",
  LOCAL_RELEASE_STATUTE: "Written 18+ commercial likeness release via our 10-second mobile QR for every recognizable interviewee.",
  LOCAL_FILMING_NOTE: "handheld camera + lav/shotgun mic on public sidewalks (zero stands or sidewalk obstruction)",
  CREATOR_QUESTION: "If you could meet ONE person in this city this week who would genuinely change your year—friend, partner, or collaborator—who would it be?",
};

export const MARKETING_EMAIL_TEMPLATES: Record<EmailTemplateId, AutomatedEmailTemplate> = {
  craigslist_gig_post: {
    id: "craigslist_gig_post",
    title: "Local Connector & Street-Team Casting Post (Stage 1 Human Pitch)",
    channel: "craigslist",
    subjectTemplate:
      "{{HOURLY_RATE_LABEL}} + Bonus — Outgoing {{CITY_LABEL}} Locals to Spark Real IRL Connections (4-Hr Shift, {{NEIGHBORHOOD}})",
    bodyTemplate: [
      "We are building The Network in {{CITY_LABEL}}—connecting people in real life to {{DESIRE_PROMISE}}, without endless swiping or cold apps.",
      "",
      "We are hiring warm, sharp, genuinely social 18+ {{CITY_LABEL}} locals for paid 4-hour street shifts near {{LANDMARK_AND_NEIGHBORHOOD}} on {{SHIFT_DATE}} ({{START_TIME}} - {{END_TIME}}).",
      "",
      "THE DEAL:",
      "- Pay: {{HOURLY_RATE_LABEL}} guaranteed base ({{BASE_SHIFT_PAY}} per 4-hr shift) PLUS {{BONUS_PER_SIGNUP}} for every verified 18+ local who joins from your personal QR card.",
      "- Fast payout: Paid via Stripe direct deposit within 48 hours of verified shift completion (clean 1-page written agreement sent before you start).",
      "- What you actually do: Start friendly 15-second conversations with willing adult pedestrians on public sidewalks and hand out clean cards—zero pushiness.",
      "",
      "WHO WE LOVE WORKING WITH:",
      "Actors, comics, bartenders, hosts, run-club captains, students (18+), and people who naturally light up a room.",
      "",
      "QUICK FIELD BASICS (FULL TERMS IN CLICKWRAP):",
      "- Must be 18+ with a GPS smartphone and valid payout eligibility.",
      "- {{LOCAL_ANTI_POSTING}}",
      "- {{LOCAL_TRANSIT_RULE}}",
      "- Snap 3 quick timestamped check-in photos (start, midpoint, end).",
      "",
      "HOW TO APPLY:",
      'Reply with your first name, your closest {{CITY_LABEL}} transit stop or neighborhood, 2 lines on what makes you great with strangers, and include "{{CITY_CODE}} 18+ CONFIRMED" plus confirmation you can make {{SHIFT_DATE}} {{START_TIME}}-{{END_TIME}}.',
    ].join("\n"),
    requiredVariables: [
      "NEIGHBORHOOD",
      "SHIFT_DATE",
      "START_TIME",
      "END_TIME",
      "LANDMARK_AND_NEIGHBORHOOD",
    ],
    legalGuardrails: [
      "18+ strict paid worker floor (inv_adult_only_paid)",
      "City-specific anti-posting and sidewalk clearance rule",
      "City-specific transit exclusion rule",
      "Written contractor agreement and <= 15d payout SLA in Stage 2 clickwrap",
    ],
  },

  applicant_screening_hire_reply: {
    id: "applicant_screening_hire_reply",
    title: "Shift Confirmation & Written Contractor Terms (Stage 2 Clickwrap)",
    channel: "email",
    subjectTemplate: "Re: {{ORIGINAL_SUBJECT}} — You're In for {{NEIGHBORHOOD}} ({{SHIFT_ID}})",
    bodyTemplate: [
      "Hi {{FIRST_NAME}},",
      "",
      "Loved your note—we would love to have you on the {{CITY_LABEL}} team for {{SHIFT_DATE}} ({{START_TIME}}-{{END_TIME}}) around {{LANDMARK_AND_NEIGHBORHOOD}}.",
      "",
      "WRITTEN TERMS SUMMARY ({{LOCAL_LABOR_STATUTE}}):",
      "- Role: Local Connector — Hand-to-Hand Public Sidewalk Distribution (Personal Batch QR #{{BATCH_ID}})",
      "- Base Pay: {{BASE_SHIFT_PAY}} flat for the completed 4-hour shift ({{HOURLY_RATE_LABEL}})",
      "- Bonus: +{{BONUS_PER_SIGNUP}} per unique verified 18+ signup from Batch QR #{{BATCH_ID}} above 6 signups (up to +{{BONUS_CAP_SHIFT}}/shift)",
      "- Payout: Stripe direct deposit within 48 hours of approved proof (hard SLA <= 15 days)",
      "- Field Rules: 18+ confirmed; {{LOCAL_ANTI_POSTING}} {{LOCAL_TRANSIT_RULE}}",
      "",
      "LOCK YOUR SPOT IN 2 MINUTES:",
      "1. Review and e-sign the 1-page agreement + connect Stripe payout here: {{ONBOARDING_AND_CONTRACT_URL}}",
      '2. Reply "CONFIRMED" once signed.',
      "",
      "SHIFT DAY LOGISTICS:",
      "- We send a quick check-in ping 24 hours and 3 hours before start. Reply YES by {{T_MINUS_3H_TIME}} so we hold your slot.",
      "- Card pickup: {{PICKUP_INSTRUCTIONS_OR_COURIER_HANDOFF}}",
      "- Upload your 3 quick GPS check-in photos (Start / Mid / End): {{PROOF_UPLOAD_URL}}",
      "",
      "Reply directly if anything comes up—happy to help.",
      "",
      "Best,",
      "{{SENDER_NAME}} | {{CITY_LABEL}}",
      "{{OPS_EMAIL}}",
    ].join("\n"),
    requiredVariables: [
      "ORIGINAL_SUBJECT",
      "SHIFT_ID",
      "FIRST_NAME",
      "SHIFT_DATE",
      "START_TIME",
      "END_TIME",
      "LANDMARK_AND_NEIGHBORHOOD",
      "BATCH_ID",
      "ONBOARDING_AND_CONTRACT_URL",
      "T_MINUS_3H_TIME",
      "PICKUP_INSTRUCTIONS_OR_COURIER_HANDOFF",
      "PROOF_UPLOAD_URL",
    ],
    legalGuardrails: [
      "City-compliant itemized written contract & <=15d payout SLA",
      "18+ confirmed age gate",
      "City anti-posting & transit compliance",
    ],
  },

  agency_rfp: {
    id: "agency_rfp",
    title: "Vetted Local Agency Direct Booking RFP",
    channel: "email",
    subjectTemplate:
      "{{CITY_LABEL}} Street-Team Quote & Direct Booking — {{TARGET_DATES}} ({{HEADCOUNT}} W-2 Staff, 4-Hr Shift)",
    bodyTemplate: [
      "Hello {{AGENCY_NAME}} Team,",
      "",
      "We are booking a compliant, insured W-2 street-team activation in {{CITY_LABEL}} and can approve and pay directly over email (no discovery call needed).",
      "",
      "ACTIVATION BRIEF:",
      `- Brand: The Network (${BRAND_DOMAINS.ntwrk} / ${BRAND_DOMAINS.slop} / ${BRAND_DOMAINS.friends} / ${BRAND_DOMAINS.peon}) — 18+ real-world connection network`,
      "- Zones: {{NEIGHBORHOODS}} ({{LOCAL_ANTI_POSTING}} {{LOCAL_TRANSIT_RULE}})",
      "- Dates & Shift: {{TARGET_DATES}}, {{SHIFT_HOURS}} (4 hours)",
      "- Staffing: {{HEADCOUNT}} warm, high-energy W-2 Brand Ambassadors (21+ preferred, 18+ mandatory)",
      '- Collateral: Pre-printed 4x6" postcards with unique batch QR codes delivered to your local office or shift lead',
      "- Proof of Work: GPS clock-in/out logs + start, midpoint, and end timestamped photos per ambassador + leftover stack count",
      "",
      "PLEASE REPLY WITH:",
      "1. All-in hourly client bill rate per W-2 ambassador (confirming CGL + Workers' Comp COI)",
      "2. Total itemized quote including any management, rush, or minimum fees",
      "3. Confirmation we can approve via email SOW and pay today by card or Stripe/ACH invoice",
      "",
      "If the quote sits inside our budget cap (${{BUDGET_CAP}}), we will issue immediate email approval today.",
      "",
      "Thank you,",
      "Campaign Ops | The Network ({{CITY_LABEL}})",
      "{{OPS_EMAIL}}",
    ].join("\n"),
    requiredVariables: [
      "AGENCY_NAME",
      "TARGET_DATES",
      "HEADCOUNT",
      "NEIGHBORHOODS",
      "SHIFT_HOURS",
      "BUDGET_CAP",
    ],
    legalGuardrails: [
      "100% W-2/PAYE + CGL + Workers' Comp confirmation",
      "18+ mandatory ambassador age floor",
      "City sidewalk, anti-posting, and transit compliance",
    ],
  },

  creator_street_interview_brief: {
    id: "creator_street_interview_brief",
    title: "High-Taste Street-Interview Creator Pitch (Stage 1 Human Outreach -> Stage 2 Clickwrap)",
    channel: "email",
    subjectTemplate:
      "Quick {{CITY_LABEL}} street film idea (${{FLAT_FEE}} + Bonus) — {{CREATOR_NAME}}",
    bodyTemplate: [
      "Hey {{CREATOR_NAME}},",
      "",
      'Loved the pacing and realness in "{{RECENT_VIDEO_TITLE}}"—you let real people surprise you instead of forcing a bit.',
      "",
      "We are launching The Network in {{CITY_LABEL}}—an AI matchmaker that skips swipe apps and cold DMs to connect people to what they actually want in real life ({{DESIRE_PROMISE}}).",
      "",
      "THE IDEA (CANDID VOX-POP, ZERO ACTORS):",
      "- Location: Public sidewalk in {{NEIGHBORHOOD}} ({{LOCAL_FILMING_NOTE}}).",
      '- Question to explore: "{{CREATOR_QUESTION}}"',
      "- On-camera moment: Have 3+ willing 18+ locals try your unique QR card ({{CREATOR_SHORTLINK}}) live on camera and capture their unfiltered reaction.",
      "",
      "DELIVERABLES & PAY:",
      "- 1 edited main piece (60-90s) on {{PRIMARY_PLATFORM}} + 2 short vertical cutdowns (20-35s) + raw clips, with your link pinned for 30 days.",
      "- ${{FLAT_FEE}} guaranteed flat fee paid within 48 hours of approved publish + $2.50 per verified 18+ local signup (capped at +${{BONUS_CAP}}, settled Day 14).",
      "- Target publish date: {{TARGET_PUBLISH_DATE}}.",
      "",
      "CLEAN COMPLIANCE (HANDLED IN OUR 1-PAGE CLICKWRAP):",
      "- 18+ interviewees only, standard #Ad / Paid Partnership disclosure, and our 10-second mobile release QR ({{RELEASE_FORM_URL}}) for recognizable interviewees ({{LOCAL_RELEASE_STATUTE}}).",
      "",
      "If you're into this, lock the slot and review the 1-page agreement + instant payout setup here: {{CREATOR_CONTRACT_URL}}",
      "",
      "Best,",
      "Creator Partnerships | The Network ({{CITY_LABEL}})",
      "{{OPS_EMAIL}}",
    ].join("\n"),
    requiredVariables: [
      "CREATOR_NAME",
      "RECENT_VIDEO_TITLE",
      "NEIGHBORHOOD",
      "PRIMARY_PLATFORM",
      "CREATOR_SHORTLINK",
      "FLAT_FEE",
      "BONUS_CAP",
      "RELEASE_FORM_URL",
      "CREATOR_CONTRACT_URL",
      "TARGET_PUBLISH_DATE",
    ],
    legalGuardrails: [
      "FTC 16 CFR Part 255 / local #Ad spoken + on-screen disclosure",
      "City-specific 18+ written commercial likeness release",
      "Handheld-only sidewalk filming compliance",
      "18+ creator and interviewee floor",
    ],
  },

  proof_of_work_reminder: {
    id: "proof_of_work_reminder",
    title: "Fast 48-Hr Payout & Proof Upload Note",
    channel: "email",
    subjectTemplate: "Quick upload for your 48-hr payout — {{TASK_TITLE}} ({{BATCH_ID}})",
    bodyTemplate: [
      "Hi {{FIRST_NAME}},",
      "",
      "Thanks for running {{TASK_TITLE}} (Batch #{{BATCH_ID}}) in {{CITY_LABEL}}.",
      "",
      "Drop your verification items here so Stripe triggers your ${{BASE_PAY_USD}} payout within 48 hours ({{LOCAL_LABOR_STATUTE}}): {{PROOF_UPLOAD_URL}}",
      "",
      "QUICK CHECKLIST:",
      "- Street & Event Shifts: 3 timestamped GPS check-in photos (Start / Mid / End) + photo of remaining card stack.",
      "- Creator Shoots: Live public video URL, folder link with 2 cutdowns + raw clips, spoken + on-screen #Ad confirmation, and signed 18+ mobile releases for recognizable interviewees.",
      "",
      "Base pay releases right after verification; verified 18+ signup bonuses for Batch #{{BATCH_ID}} settle on schedule.",
      "",
      "Reply anytime if an upload glitches.",
      "",
      "Best,",
      "Payouts & Verification | The Network",
      "{{OPS_EMAIL}}",
    ].join("\n"),
    requiredVariables: [
      "FIRST_NAME",
      "TASK_TITLE",
      "BATCH_ID",
      "PROOF_UPLOAD_URL",
      "BASE_PAY_USD",
    ],
    legalGuardrails: [
      "inv_proof_required_before_payout",
      "FTC / local ad disclosure audit",
      "18+ commercial likeness release audit",
      "Timely <= 15d payout SLA",
    ],
  },
};

export function renderMarketingEmailTemplate(
  templateId: EmailTemplateId,
  variables: Record<string, string>,
): { subject: string; body: string; missingVariables: string[] } {
  const tpl = MARKETING_EMAIL_TEMPLATES[templateId];
  const missingVariables = tpl.requiredVariables.filter(
    (key) => variables[key] === undefined || variables[key].trim() === "",
  );
  const merged: Record<string, string> = {
    ...DEFAULT_TEMPLATE_FALLBACKS,
    ...variables,
  };
  const replaceTokens = (input: string): string =>
    input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, key: string) =>
      merged[key] !== undefined ? merged[key] : full,
    );
  return {
    subject: replaceTokens(tpl.subjectTemplate),
    body: replaceTokens(tpl.bodyTemplate),
    missingVariables,
  };
}
