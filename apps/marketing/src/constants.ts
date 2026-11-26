// Single canonical source of operational defaults, proved policy/device constants,
// canonical 5-agent roster, compliance clauses, and hiring email templates for @thenetwork/marketing.

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
    appId: "ntwrk",
    provider: "chatgpt",
    failoverProvider: "claude",
    authMode: "cli",
    sessionRef: "sub:chatgpt:chadwick",
    dailyTurnCap: DEFAULT_DAILY_TURN_CAP,
    roleSummary:
      "The Network flagship connector — orchestrates NYC launches, event invitations, and Craigslist gig copy.",
    systemPrompt:
      "You are Chadwick, NYC social & hospitality connector for The Network (ntwrk.party). Speak concisely, never leak private contacts, and respect STOP opt-outs.",
  },
  {
    id: "agent-sloane",
    personaId: "sloane",
    displayName: "Sloane",
    appId: "slop",
    provider: "claude",
    failoverProvider: "chatgpt",
    authMode: "cli",
    sessionRef: "sub:claude:sloane",
    dailyTurnCap: DEFAULT_DAILY_TURN_CAP,
    roleSummary:
      "slop.date dating growth lead — negotiates NYC street-interview creators, West/East Village drops, and cocktail-bar partners.",
    systemPrompt:
      "You are Sloane, dating growth and creator-partnerships agent for slop.date (18+ only). Never contact minors, enforce FTC #Ad disclosure, and respect STOP opt-outs.",
  },
  {
    id: "agent-peon",
    personaId: "peon",
    displayName: "Peon",
    appId: "peon",
    provider: "gemini",
    failoverProvider: "claude",
    authMode: "cli",
    sessionRef: "sub:gemini:peon",
    dailyTurnCap: DEFAULT_DAILY_TURN_CAP,
    roleSummary:
      "peon.biz founder & builder scout — runs Flatiron/Union Sq & Midtown West activations plus HN/GitHub/arXiv outreach.",
    systemPrompt:
      "You are Peon, builder/career networking and OSS growth agent for peon.biz. Keep outreach authentic, never spam, and honor STOP immediately.",
  },
  {
    id: "agent-venn",
    personaId: "venn",
    displayName: "Venn",
    appId: "friends",
    provider: "claude",
    failoverProvider: "gemini",
    authMode: "cli",
    sessionRef: "sub:claude:venn",
    dailyTurnCap: DEFAULT_DAILY_TURN_CAP,
    roleSummary:
      "friends.help NYC community lead — partners with run clubs, supper clubs, and Williamsburg/Washington Sq activators.",
    systemPrompt:
      "You are Venn, NYC friend-group and local event community agent for friends.help. Coordinate local IRL events and honor STOP immediately.",
  },
  {
    id: "agent-operator",
    personaId: "operator",
    displayName: "The Operator",
    appId: "ntwrk",
    provider: "chatgpt",
    failoverProvider: "claude",
    authMode: "cli",
    sessionRef: "sub:chatgpt:operator",
    dailyTurnCap: DEFAULT_OPERATOR_TURN_CAP,
    roleSummary:
      "Cross-app ops coordinator — screens 18+ applicants, dispatches NYLL § 191-d agreements, audits proofs, and manages agency RFPs.",
    systemPrompt:
      "You are The Operator, campaign coordinator for The Network across ntwrk.party, slop.date, peon.biz, and friends.help. Enforce 18+ rules, budget caps, proof checks, and STOP fences.",
  },
] as const;

export const FTC_DISCLOSURE_CLAUSE =
  'FTC 16 CFR Part 255 (Mandatory): Include BOTH a clear spoken disclosure ("Sponsored by The Network") AND prominent on-screen text ("#Ad" or "Paid Partnership with The Network") in the first 3 seconds, plus enable the native platform Paid Partnership / Commercial Content toggle.';

export const NY_RELEASE_CLAUSE =
  "NY Civil Rights Law §§ 50–51 (Mandatory Commercial Release): Every recognizable featured interviewee must be 18+ and complete our written/mobile commercial likeness release before publication; blur or cut any unsigned person.";

export const ON_SITE_RELEASE_FORM_COPY =
  "I confirm I am at least 18 years old. Under New York Civil Rights Law §§ 50 and 51, I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview in organic and paid commercial advertising, social media, and promotional materials, with no additional compensation owed.";

export const ANTI_POSTING_NOTICE =
  "NYC Administrative Code § 10-119 (Zero Tolerance): Hand-to-hand sidewalk distribution only (keep >= 8 ft sidewalk clearance). NEVER paste, tape, glue, or post fliers on lampposts, utility poles, trees, mailboxes, or car windshields.";

export const MTA_EXCLUSION_NOTICE =
  "21 NYCRR § 1050.6: Commercial flyers are strictly prohibited inside MTA subway stations, mezzanines, and platforms. Stay on outdoor public sidewalks at least 20 ft outside entrances.";

export const MARKETING_EMAIL_TEMPLATES: Record<EmailTemplateId, AutomatedEmailTemplate> = {
  craigslist_gig_post: {
    id: "craigslist_gig_post",
    title: "Craigslist NYC Gig Post (evg/lbg Street Team)",
    channel: "craigslist",
    subjectTemplate:
      "$22/hr + Bonus — NYC Hand-to-Hand Flier & App Launch Street Team (4-Hr Shift, {{NEIGHBORHOOD}})",
    bodyTemplate: [
      "We are hiring outgoing, reliable 18+ NYC locals for paid 4-hour street-team shifts promoting a new NYC social and dating network (ntwrk.party / slop.date / friends.help).",
      "",
      "SHIFT DETAILS:",
      "- Date & Time: {{SHIFT_DATE}}, {{START_TIME}} - {{END_TIME}} (4 hours)",
      "- Location: Public sidewalks near {{LANDMARK_AND_NEIGHBORHOOD}}",
      "- Pay: $22/hr guaranteed base ($88 per 4-hr shift) PLUS $2 bonus for every verified NYC 18+ signup scanned from your unique batch QR code.",
      "- Payout: Paid via Stripe / direct deposit within 48 hours of verified shift completion (written NYLL § 191-d contractor agreement provided before shift).",
      "",
      "DUTIES & STRICT RULES:",
      "- Hand fliers directly person-to-person to willing adult pedestrians and give a friendly 10-second pitch.",
      `- ${ANTI_POSTING_NOTICE}`,
      `- ${MTA_EXCLUSION_NOTICE}`,
      "- Submit 3 timestamped GPS check-in photos (shift start, midpoint, end) via our check-in link.",
      "",
      "REQUIREMENTS:",
      `- Must be ${marketingAdultAge}+ with valid US tax/payout eligibility (1099 contractor, W-9 via Stripe).`,
      "- Smartphone with working camera and GPS.",
      "- Friendly, clear English communicator who shows up on time.",
      "",
      "HOW TO APPLY (REQUIRED):",
      'Reply to this email and start your first line with your closest NYC subway stop + "NYC 18+ CONFIRMED". Include:',
      "1. Your first name and neighborhood",
      "2. 1-2 sentences on any promo, hospitality, sales, or street-team experience",
      "3. Confirm you can make {{SHIFT_DATE}} {{START_TIME}}-{{END_TIME}}",
      "",
      'Replies missing the subway stop + "NYC 18+ CONFIRMED" line are automatically skipped.',
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
      "NYC Admin Code § 10-119 anti-posting ban",
      "21 NYCRR § 1050.6 MTA subway commercial flyer ban",
      "NYLL § 191-d written contractor disclosure",
    ],
  },

  applicant_screening_hire_reply: {
    id: "applicant_screening_hire_reply",
    title: "Automated Email Screening, Hiring & NYLL § 191-d Reply",
    channel: "email",
    subjectTemplate: "Re: {{ORIGINAL_SUBJECT}} — Shift Offer & Quick Confirmation ({{SHIFT_ID}})",
    bodyTemplate: [
      "Hi {{FIRST_NAME}},",
      "",
      "Thanks for applying. You passed our initial screen for the {{SHIFT_DATE}} ({{START_TIME}}-{{END_TIME}}) NYC street-team shift at {{LANDMARK_AND_NEIGHBORHOOD}}.",
      "",
      "YOUR CONTRACT TERMS (NYLL § 191-d Written Summary):",
      "- Role: Independent Contractor — Legal Hand-to-Hand Flier Distribution (Batch QR #{{BATCH_ID}})",
      "- Base Compensation: $88.00 flat for completed 4-hour shift ($22/hr)",
      "- Performance Bonus: +$2.00 per unique verified NYC 18+ signup from Batch QR #{{BATCH_ID}} above 6 signups (capped at +$80/shift)",
      "- Payment Method & Due Date: Stripe Connect direct deposit within 48 hours of approved proof-of-work (no later than 15 days after shift completion, well inside the 30-day NYLL § 191-d statutory limit)",
      "- Mandatory Compliance: 18+ confirmed; hand-to-hand on public sidewalks only (8ft clear path); zero posting on poles/trees/cars (NYC Admin Code § 10-119); zero subway interior distribution (21 NYCRR § 1050.6).",
      "",
      "LOCK YOUR SHIFT IN 2 MINUTES:",
      "1. Review & e-sign the NYLL § 191-d contractor agreement + set up instant payout here: {{ONBOARDING_AND_CONTRACT_URL}}",
      '2. Reply "CONFIRMED" to this email once signed.',
      "",
      "CHECK-IN & FLIER PICKUP PROTOCOL:",
      "- You will receive an automated confirmation ping 24 hours and 3 hours before shift start. You must reply YES by {{T_MINUS_3H_TIME}} or the shift automatically moves to our standby bench.",
      "- Flier pickup: {{PICKUP_INSTRUCTIONS_OR_COURIER_HANDOFF}}",
      "- Upload your 3 timestamped GPS check-in photos (Start / Mid / End) here: {{PROOF_UPLOAD_URL}}",
      "",
      "Reply with any logistics question — our ops system monitors this inbox 24/7.",
      "",
      "Best,",
      "NYC Field Ops | The Network",
      "ops-nyc@ntwrk.party",
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
      "NYLL § 191-d itemized written contract & <=15d payout SLA",
      "18+ confirmed age gate",
      "NYC Admin Code § 10-119 & 21 NYCRR § 1050.6 compliance",
    ],
  },

  agency_rfp: {
    id: "agency_rfp",
    title: "Vetted NYC Agency RFP & Zero-Call Direct Booking Email",
    channel: "email",
    subjectTemplate:
      "NYC Street-Team Quote & Direct Booking Request — {{TARGET_DATES}} ({{HEADCOUNT}} W-2 Staff, 4-Hr Shift)",
    bodyTemplate: [
      "Hello {{AGENCY_NAME}} Team,",
      "",
      "We are booking a compliant, insured W-2 street-team activation in New York City and would like to confirm availability and book directly over email (no discovery call needed).",
      "",
      "ACTIVATION BRIEF:",
      "- Brand: The Network (ntwrk.party / slop.date / friends.help) — 18+ NYC social & dating platform",
      "- City & Zones: {{NEIGHBORHOODS}} (outdoor public sidewalks only; zero tables, tents, or sound; zero MTA subway interiors; zero posting on poles/property)",
      "- Dates & Shift Length: {{TARGET_DATES}}, {{SHIFT_HOURS}} (4 hours)",
      "- Staffing Needed: {{HEADCOUNT}} energetic, outgoing W-2 Brand Ambassadors (21+ preferred, 18+ mandatory)",
      '- Collateral: We will supply pre-printed 4x6" postcards with unique batch QR codes (delivered to your NYC office or local courier handoff)',
      "- Required Proof of Work: GPS clock-in/out logs + start, midpoint, and end timestamped photos from each ambassador + leftover flier count",
      "",
      "PLEASE REPLY WITH:",
      "1. All-in hourly client bill rate per W-2 ambassador (confirming CGL + Workers' Comp COI included)",
      "2. Total itemized quote including any management, rush, or minimum fees",
      "3. Confirmation that we can approve via email SOW and pay immediately via credit card or Stripe/ACH invoice",
      "",
      "If the quote fits our budget cap (${{BUDGET_CAP}}), we will issue immediate email approval and submit payment today.",
      "",
      "Thank you,",
      "Campaign Ops | The Network",
      "ops-nyc@ntwrk.party",
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
      "100% W-2 + CGL + Workers' Comp confirmation",
      "18+ mandatory ambassador age floor",
      "Outdoor public sidewalks only; zero posting; zero MTA subway interiors",
    ],
  },

  creator_street_interview_brief: {
    id: "creator_street_interview_brief",
    title: "NYC Street-Interview Creator Brief (FTC #Ad + NY Civil Rights Law §§ 50-51)",
    channel: "email",
    subjectTemplate:
      "Paid NYC Street-Interview Collab (${{FLAT_FEE}} Flat + $2.50/Signup Bonus) — {{CREATOR_NAME}}",
    bodyTemplate: [
      "Hi {{CREATOR_NAME}},",
      "",
      "We love your NYC street-interview videos — especially {{RECENT_VIDEO_TITLE}}. We want to sponsor a 60-90 second NYC street-interview piece for The Network (ntwrk.party / slop.date / friends.help), an AI-powered real-world social and dating network launching across NYC.",
      "",
      "THE CONCEPT (AUTHENTIC VOX-POP, ZERO SCRIPTED ACTORS):",
      "- Shoot location: Public sidewalk in {{NEIGHBORHOOD}} (handheld camera + lav/shotgun mic only — zero light stands or C-stands so no MOME permit needed).",
      '- Hook ideas: "What\'s your worst NYC dating app story — would you let an AI agent set up a real-world match instead?" OR "Would you let an AI find you 3 real NYC friends this weekend?"',
      "- On-camera proof: Have 3+ real 18+ interviewees scan your unique QR card live on camera and react to the quick onboarding flow.",
      "",
      "DELIVERABLES & COMPENSATION (NYLL § 191-d Written Terms):",
      "- Deliverables:",
      "  1. 1 main edited video (60-90s) published publicly on {{PRIMARY_PLATFORM}}",
      "  2. 2 vertical cutdowns (20-35s) + raw clips uploaded to our folder (perpetual organic + paid social usage rights included)",
      "  3. Unique QR card shown clearly on screen + unique link ({{CREATOR_SHORTLINK}}) pinned in top comment & bio for 30 days",
      "- Fee: ${{FLAT_FEE}} guaranteed flat fee paid within 48 hours of approved publication + $2.50 bonus per verified 18+ NYC signup from your unique link/QR (bonus capped at +${{BONUS_CAP}}, settled at Day 14).",
      "",
      "MANDATORY LEGAL & COMPLIANCE REQUIREMENTS (NON-NEGOTIABLE):",
      `1. ${FTC_DISCLOSURE_CLAUSE}`,
      `2. ${NY_RELEASE_CLAUSE} Mobile release QR: {{RELEASE_FORM_URL}}`,
      "3. Age Floor: Do not film or onboard anyone under 18.",
      "",
      "ON-SITE MOBILE RELEASE TEXT (NY Civil Rights Law §§ 50-51):",
      `"${ON_SITE_RELEASE_FORM_COPY}"`,
      "",
      "ACCEPT & LOCK IN:",
      "Sign the clickwrap creator agreement and set up instant Stripe/Passionfroot payout here: {{CREATOR_CONTRACT_URL}}",
      "Target publish date: {{TARGET_PUBLISH_DATE}}.",
      "",
      "Best,",
      "Creator Partnerships | The Network",
      "ops-nyc@ntwrk.party",
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
      "FTC 16 CFR Part 255 spoken + on-screen #Ad disclosure",
      "NY Civil Rights Law §§ 50-51 written commercial likeness releases",
      "NYC MOME handheld-only sidewalk filming rules",
      "18+ creator and interviewee floor",
    ],
  },

  proof_of_work_reminder: {
    id: "proof_of_work_reminder",
    title: "Automated Proof-of-Work Verification & Fast Payout Reminder",
    channel: "email",
    subjectTemplate: "Action Required for 48-Hr Payout — Submit Proof for {{TASK_TITLE}} ({{BATCH_ID}})",
    bodyTemplate: [
      "Hi {{FIRST_NAME}},",
      "",
      "Thanks for completing your NYC activation for The Network ({{TASK_TITLE}}, Batch #{{BATCH_ID}}).",
      "",
      "To trigger automatic Stripe payout within 48 hours (well inside our NYLL § 191-d SLA), please upload all required verification items here: {{PROOF_UPLOAD_URL}}",
      "",
      "REQUIRED PROOF CHECKLIST:",
      "- Street Teams & Event Activators:",
      "  1. Timestamped GPS check-in photos (Start / Midpoint / End) within the assigned NYC zone",
      "  2. Photo of remaining flier stack / QR card at end of shift",
      "- Street-Interview Creators:",
      "  1. Live public URL of the published main video (60-90s)",
      "  2. Folder link with 2 vertical cutdowns (20-35s) + raw clips",
      "  3. Confirmation of spoken + on-screen FTC #Ad / Paid Partnership disclosure (16 CFR Part 255)",
      "  4. Signed 18+ NY Civil Rights Law §§ 50-51 mobile releases matching every recognizable interviewee",
      "",
      "Once our automated verifier confirms your submission, your base payout (${{BASE_PAY_USD}}) releases immediately and verified 18+ signup bonuses for Batch #{{BATCH_ID}} settle on schedule.",
      "",
      "Questions or upload issue? Reply directly to this thread.",
      "",
      "Best,",
      "Verification & Payouts | The Network",
      "ops-nyc@ntwrk.party",
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
      "FTC 16 CFR Part 255 disclosure audit",
      "NY Civil Rights Law §§ 50-51 release audit",
      "NYLL § 191-d timely payout SLA",
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
  const replaceTokens = (input: string) =>
    input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, key: string) =>
      variables[key] !== undefined ? variables[key] : full,
    );
  return {
    subject: replaceTokens(tpl.subjectTemplate),
    body: replaceTokens(tpl.bodyTemplate),
    missingVariables,
  };
}
