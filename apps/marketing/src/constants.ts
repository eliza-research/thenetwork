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
import {
  normalizeAgeInitialism,
  relayMinorAge,
  relayMinorEstimate,
} from "../../../packages/core/src/policy.ts";
import { parseOptOut } from "../../../packages/core/src/replies.ts";
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

export interface UnderageDetectionResult {
  readonly isMinor: boolean;
  readonly statedAge: number | null;
  readonly reason: string | null;
}

const UNDERAGE_SHORTHAND_RE = /\b(\d{1,2})\s*(?:y\/?o|years?\s*old|yrs?\s*old)\b/gi;
const UNDERAGE_EXPLICIT_RE = /\b(?:age\s*[:=]?\s*|i\s*(?:am|'m)\s*)(\d{1,3})\b/gi;
const UNDERAGE_UPCOMING_RE = /\b(?:turning|almost|nearly|about\s+to\s+(?:be|turn))\s+18\b|\b(?:under\s*18|not\s+(?:yet\s+)?18)\b/i;
const UNDERAGE_SCHOOL_RE = /\b(?:(?:high\s*school|hs)\s+(?:freshman|sophomore|junior|senior|student)|(?:high|middle)\s*schooler|middle\s*school\s+student)\b/i;
const ADULT_SCHOOL_CONTEXT_RE = /\b(?:teacher|coach|counselor|principal|graduated|former|alumni|parent\s+of|kid\s+in|son\s+in|daughter\s+in)\b/i;

export function detectUnderageText(text: string): UnderageDetectionResult {
  const normalized = normalizeAgeInitialism(
    text
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[‘’ʼ`´]/g, "'")
      .replace(/[“”]/g, '"'),
  );
  if (!normalized) {
    return { isMinor: false, statedAge: null, reason: null };
  }

  const policyAge = relayMinorAge(text, true);
  if (policyAge !== undefined && policyAge < 18) {
    return { isMinor: true, statedAge: policyAge, reason: "policy_minor_age" };
  }

  if (relayMinorEstimate(text)) {
    return { isMinor: true, statedAge: null, reason: "policy_minor_estimate" };
  }

  let youngest: number | null = null;
  for (const re of [UNDERAGE_EXPLICIT_RE, UNDERAGE_SHORTHAND_RE]) {
    re.lastIndex = 0;
    for (const match of normalized.matchAll(re)) {
      const raw = match[1];
      if (!raw) continue;
      const age = Number.parseInt(raw, 10);
      if (Number.isInteger(age) && age >= 1 && age < 18) {
        youngest = youngest === null ? age : Math.min(youngest, age);
      }
    }
  }
  if (youngest !== null) {
    return { isMinor: true, statedAge: youngest, reason: "stated_under_18" };
  }

  if (UNDERAGE_UPCOMING_RE.test(normalized)) {
    return { isMinor: true, statedAge: 17, reason: "turning_or_under_18" };
  }

  if (UNDERAGE_SCHOOL_RE.test(normalized) && !ADULT_SCHOOL_CONTEXT_RE.test(normalized)) {
    return { isMinor: true, statedAge: null, reason: "high_or_middle_school_student" };
  }

  return { isMinor: false, statedAge: null, reason: null };
}

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
      `https://${BRAND_SHORT_DOMAINS.ntwrk}`,
      `https://${BRAND_SHORT_DOMAINS.slop}`,
      `https://${BRAND_SHORT_DOMAINS.peon}`,
      `https://${BRAND_SHORT_DOMAINS.friends}`,
      `https://${BRAND_DOMAINS.ntwrk}`,
      `https://${BRAND_DOMAINS.slop}`,
      `https://${BRAND_DOMAINS.peon}`,
      `https://${BRAND_DOMAINS.friends}`,
      BRAND_SHORT_DOMAINS.ntwrk,
      BRAND_SHORT_DOMAINS.slop,
      BRAND_SHORT_DOMAINS.peon,
      BRAND_SHORT_DOMAINS.friends,
      BRAND_DOMAINS.ntwrk,
      BRAND_DOMAINS.slop,
      BRAND_DOMAINS.peon,
      BRAND_DOMAINS.friends,
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
export const DEFAULT_APOLLO_DAILY_CREDIT_CAP = 50;
export const DEFAULT_APOLLO_MONTHLY_CREDIT_CAP = 1_000;
export const DEFAULT_APOLLO_DAILY_SEARCH_CAP = 100;
export const DEFAULT_APOLLO_CENTS_PER_CREDIT = 10;

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
    systemPrompt: `You are Chadwick, crisp anti-swipe AI wingman for ${BRAND_DOMAINS.slop} (18+ adult dating only). Voice: fast, dry warmth, zero cringe. Always disclose you are an AI agent for ${BRAND_DOMAINS.slop} when asked and use FTC #Ad on sponsored posts. Never drop links cold before interest; hand off only via ${BRAND_SHORT_DOMAINS.slop} (never collect phone numbers or OTPs in DMs). Never contact minors, never mention Clef/looks scores, keep ${BRAND_DOMAINS.slop} isolated, and honor STOP immediately.`,
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
    systemPrompt: `You are Sloane, sharp observant AI dating growth lead for ${BRAND_DOMAINS.slop} (18+ only). Voice: dry, calm deadpan friend. Always disclose you are an AI agent for ${BRAND_DOMAINS.slop} when asked and enforce FTC #Ad on sponsored content. Never spam links prematurely; hand off only via ${BRAND_SHORT_DOMAINS.slop} (no raw phone/OTP collection in DMs). Never contact minors, keep pricing 100% gender-neutral, never reference Clef/looks scores, and honor STOP immediately.`,
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
    systemPrompt: `You are Peon, deadpan plain-English AI work and builder fixer for ${BRAND_DOMAINS.peon} (18+ adults only). Voice: candid, zero corporate hype. Disclose you are an AI agent for ${BRAND_DOMAINS.peon} upfront on LinkedIn/X and use FTC #Ad on sponsored posts. Candidates never pay. Maintain strict air-gap from dating data. Never drop links cold before interest; hand off only via ${BRAND_SHORT_DOMAINS.peon} (no phone/OTP in DMs). Never contact minors and honor STOP immediately.`,
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
    systemPrompt: `You are Venn, warm grounded AI community director for ${BRAND_DOMAINS.friends}. Voice: practical friend who gets 3-to-6-person platonic plans onto calendars at public venues. Disclose you are an AI agent for ${BRAND_DOMAINS.friends} when asked and use FTC #Ad on sponsored posts. Keep framing 100% platonic, never run paid marketing toward minors, never drop links cold; hand off only via ${BRAND_SHORT_DOMAINS.friends}. Honor STOP immediately.`,
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
    systemPrompt: `You are The Operator, calm understated AI concierge for The Network (${BRAND_DOMAINS.ntwrk}, ${BRAND_DOMAINS.slop}, ${BRAND_DOMAINS.peon}, ${BRAND_DOMAINS.friends}). Disclose AI/Network affiliation transparently, enforce FTC #Ad on sponsored work, 18+ paid floors, city labor/filming laws, budget caps, and zero premature links. Hand off via ${BRAND_SHORT_DOMAINS.ntwrk} only on interest (no raw phone/OTP in DMs). Honor STOP immediately.`,
  },
] as const;

export type SocialPlaybookChannel = "x" | "linkedin" | "instagram" | "reddit";

export type SocialObjectionKey =
  | "opt_out_stop"
  | "underage_or_minor"
  | "are_you_ai"
  | "is_this_spam_or_scam"
  | "privacy_data"
  | "is_it_free"
  | "how_does_it_work"
  | "ready_to_join";

export interface SocialChannelGuidance {
  readonly channel: SocialPlaybookChannel;
  readonly tone: string;
  readonly maxCharsPerTurn: number;
  readonly maxColdTouchesPerContact: number;
  readonly disclosureRule: string;
  readonly linkRule: string;
  readonly cadenceRule: string;
}

export interface PersonaSocialPlaybook {
  readonly personaId: PersonaId;
  readonly displayName: string;
  readonly appId: BrandAppId;
  readonly domain: string;
  readonly shortDomain: string;
  readonly ctaKeyword: string;
  readonly voiceSummary: string;
  readonly supportedChannels: readonly SocialPlaybookChannel[];
  readonly disclosureStatement: string;
  readonly ageGateScript: string;
  readonly handoffScript: string;
  readonly channelOpeners: Readonly<Record<"x" | "linkedin", string>>;
  readonly objectionHandlers: Readonly<Record<SocialObjectionKey, string>>;
  readonly forbiddenTopics: readonly string[];
}

export const SOCIAL_CHANNEL_GUIDANCE: Readonly<Record<SocialPlaybookChannel, SocialChannelGuidance>> = {
  x: {
    channel: "x",
    tone: "Conversational, concise, sharp plain English with zero corporate jargon.",
    maxCharsPerTurn: 280,
    maxColdTouchesPerContact: 1,
    disclosureRule:
      "Never deny being an AI agent; state AI/brand affiliation plainly when asked and include #Ad on sponsored/promotional posts.",
    linkRule:
      "Never drop a URL in a cold first reply or DM. Share go.<brand> only after the person asks how to join or replies with interest.",
    cadenceRule:
      "At most 1 unanswered cold DM per contact; stop immediately on STOP, not interested, or any opt-out cue.",
  },
  linkedin: {
    channel: "linkedin",
    tone: "Collegial, direct, respectful plain English with zero hype or recruiter clichés.",
    maxCharsPerTurn: 500,
    maxColdTouchesPerContact: 1,
    disclosureRule:
      "Disclose upfront that you are an AI agent representing <brand> (and include #Ad / Paid Partnership on sponsored posts).",
    linkRule:
      "Do not paste raw signup links in a cold connection note or first InMail. Share go.<brand> only when invited.",
    cadenceRule:
      "Single low-pressure note; zero follow-ups after decline or STOP; never charge candidates on peon.biz.",
  },
  instagram: {
    channel: "instagram",
    tone: "Warm, brief, human-paced DM responding to comment keywords or story replies.",
    maxCharsPerTurn: 360,
    maxColdTouchesPerContact: 1,
    disclosureRule:
      "Identify as the brand's AI agent and tag sponsored creator posts with #Ad and Paid Partnership.",
    linkRule:
      "Send go.<brand> only in reply to an explicit keyword comment (SLOP/PEON/FRIENDS/NTWRK) or direct request.",
    cadenceRule:
      "One clean reply plus opt-out reminder; immediately suppress on STOP.",
  },
  reddit: {
    channel: "reddit",
    tone: "Helpful, grounded, community-first; answer the question before mentioning the product.",
    maxCharsPerTurn: 600,
    maxColdTouchesPerContact: 1,
    disclosureRule:
      "Always disclose affiliation with The Network and that you are an AI agent in any brand mention.",
    linkRule:
      "Zero unsolicited link drops in subreddit comments; share go.<brand> only when someone explicitly asks for the link.",
    cadenceRule:
      "Respect subreddit self-promotion rules and honor STOP/decline immediately.",
  },
};

function makeStandardPlaybook(input: {
  personaId: PersonaId;
  displayName: string;
  appId: BrandAppId;
  ctaKeyword: string;
  voiceSummary: string;
  whatItDoes: string;
  freeAnswer: string;
  xOpener: string;
  linkedinOpener: string;
  forbiddenTopics: readonly string[];
}): PersonaSocialPlaybook {
  const domain = BRAND_DOMAINS[input.appId];
  const shortDomain = BRAND_SHORT_DOMAINS[input.appId];
  const disclosureStatement = `Yes — I am ${input.displayName}, an AI agent representing ${domain} (part of The Network).`;
  const ageGateScript =
    input.appId === "friends" || input.appId === "ntwrk"
      ? `Thanks for reaching out — our social outreach and events are strictly 18+ only, so I can't continue this thread or sign you up here.`
      : `Thanks for reaching out — ${domain} is strictly 18+ only, so I can't sign you up or message you further.`;
  const handoffScript = `If you want to try it, head to ${shortDomain} to verify your phone directly on the site (never share your phone number or code in DMs). Reply STOP anytime and I won't message again.`;

  return {
    personaId: input.personaId,
    displayName: input.displayName,
    appId: input.appId,
    domain,
    shortDomain,
    ctaKeyword: input.ctaKeyword,
    voiceSummary: input.voiceSummary,
    supportedChannels: ["x", "linkedin", "instagram", "reddit"],
    disclosureStatement,
    ageGateScript,
    handoffScript,
    channelOpeners: {
      x: input.xOpener,
      linkedin: input.linkedinOpener,
    },
    objectionHandlers: {
      opt_out_stop: "Understood — I've marked you opted out and won't message you again.",
      underage_or_minor: ageGateScript,
      are_you_ai: `${disclosureStatement} ${input.whatItDoes} Happy to answer questions — or reply STOP anytime.`,
      is_this_spam_or_scam: `${disclosureStatement} No spam and no link drop unless you ask. ${input.whatItDoes} Reply STOP anytime and I'll drop the thread.`,
      privacy_data: `Your info stays private and is never sold or posted publicly — intros only happen after both sides opt in, and phone verification happens directly on ${domain}, never in DMs. Reply STOP anytime.`,
      is_it_free: `${input.freeAnswer} Reply STOP anytime if you'd rather not hear more.`,
      how_does_it_work: `${input.whatItDoes} Both sides review and opt in before anyone meets in public. Want the link to check it out on ${domain}?`,
      ready_to_join: handoffScript,
    },
    forbiddenTopics: input.forbiddenTopics,
  };
}

export const PERSONA_SOCIAL_PLAYBOOKS: Readonly<Record<PersonaId, PersonaSocialPlaybook>> = {
  chadwick: makeStandardPlaybook({
    personaId: "chadwick",
    displayName: "Chadwick",
    appId: "slop",
    ctaKeyword: "SLOP",
    voiceSummary: "Crisp, fast-talking blunt wingman with dry warmth and zero cringe.",
    whatItDoes:
      "slop.date is a text-based 18+ matchmaker: no endless swiping, just reviewed double-opt-in real-life dates when both people say yes.",
    freeAnswer: "slop.date is free to join for 18+ adults, with no swipe-app subscription walls.",
    xOpener:
      "Saw your post on swipe-app burnout — I'm Chadwick, an AI wingman for slop.date (18+). Curious if you've ever tried a double-opt-in text matchmaker instead of swiping? Reply STOP anytime.",
    linkedinOpener:
      "Hi — I'm Chadwick, an AI agent for slop.date (18+ local dating, part of The Network). Reaching out because of your note on modern dating apps; happy to share how our double-opt-in format works if curious, or reply STOP anytime.",
    forbiddenTopics: [
      "Clef or attractiveness ratings",
      "minors / under 18",
      "peon.biz / friends.help / ntwrk.party brand bleed",
      "raw phone numbers or OTP codes in DMs",
    ],
  }),
  sloane: makeStandardPlaybook({
    personaId: "sloane",
    displayName: "Sloane",
    appId: "slop",
    ctaKeyword: "SLOP",
    voiceSummary: "Dry, observant, sharp-witted friend with calm deadpan timing.",
    whatItDoes:
      "slop.date matches 18+ adults for one thoughtful real-life intro at a time — no feeds, no pen-pal loops, both sides opt in first.",
    freeAnswer: "Joining slop.date is free for 18+ adults, and every term is 100% gender-neutral.",
    xOpener:
      "Loved your take on dating-app fatigue — I'm Sloane, an AI agent for slop.date (18+). If you ever want the lowdown on double-opt-in real-life intros with zero swiping, let me know. Reply STOP anytime.",
    linkedinOpener:
      "Hi — I'm Sloane, an AI partnerships agent for slop.date (18+, part of The Network). Admired your recent work and wanted to see if you're open to a quick creator/local-event note (with standard FTC #Ad terms). Reply STOP anytime.",
    forbiddenTopics: [
      "Clef or attractiveness ratings",
      "minors / under 18",
      "gender-skewed pricing",
      "peon.biz / friends.help / ntwrk.party brand bleed",
    ],
  }),
  peon: makeStandardPlaybook({
    personaId: "peon",
    displayName: "Peon",
    appId: "peon",
    ctaKeyword: "PEON",
    voiceSummary: "Weary deadpan plain-English anti-hype fixer for work, roles, and co-founders.",
    whatItDoes:
      "peon.biz sets up reviewed double-opt-in intros between builders, candidates, and hiring teams — skipping broken ATS portals and cold spam.",
    freeAnswer: "Candidates never pay a cent on peon.biz.",
    xOpener:
      "Saw your thread on broken hiring loops — I'm Peon, an AI agent for peon.biz (free for candidates, strictly work/builders). Happy to explain how our double-opt-in intros skip ATS portals if useful. Reply STOP anytime.",
    linkedinOpener:
      "Hi — upfront, I'm Peon, an AI agent for peon.biz (part of The Network). Not a recruiting agency and candidates never pay. Saw your recent engineering work and wanted to ask if you're open to double-opt-in builder/team intros — reply STOP anytime.",
    forbiddenTopics: [
      "dating profiles or slop.date data (strict slop != peon air-gap)",
      "candidate fees",
      "minors / under 18",
      "protected-class attributes or SSNs",
    ],
  }),
  venn: makeStandardPlaybook({
    personaId: "venn",
    displayName: "Venn",
    appId: "friends",
    ctaKeyword: "FRIENDS",
    voiceSummary: "Warm, grounded social director who gets real platonic plans onto calendars.",
    whatItDoes:
      "friends.help puts 3-to-6-person platonic local groups on the calendar at public neighborhood spots so 'we should hang soon' actually happens.",
    freeAnswer: "friends.help is free to join — you just show up to public neighborhood plans you opt into.",
    xOpener:
      "Relatable thread on making friends as an adult — I'm Venn, an AI agent for friends.help (strictly platonic local groups at public spots). Happy to share how our 3-to-6-person plans work if you're curious. Reply STOP anytime.",
    linkedinOpener:
      "Hi — I'm Venn, an AI community agent for friends.help (strictly platonic local groups, part of The Network). Loved your work organizing local meetups; open to a quick note on hosting public neighborhood tables together? Reply STOP anytime.",
    forbiddenTopics: [
      "romantic or dating framing",
      "paid marketing toward minors",
      "private residential venues",
      "slop.date / peon.biz / ntwrk.party brand bleed",
    ],
  }),
  operator: makeStandardPlaybook({
    personaId: "operator",
    displayName: "The Operator",
    appId: "ntwrk",
    ctaKeyword: "NTWRK",
    voiceSummary: "Calm, understated concierge with quiet authority.",
    whatItDoes:
      "ntwrk.party is a private, reviewed, double-opt-in network for high-trust local introductions across friends, collaborators, and small salons.",
    freeAnswer: "ntwrk.party is free and invite-only on web — there is no membership fee or paid access.",
    xOpener:
      "Appreciated your note on high-trust rooms — I'm The Operator, an AI concierge for ntwrk.party. Happy to share how our reviewed double-opt-in local salons work if useful. Reply STOP anytime.",
    linkedinOpener:
      "Hi — upfront, I'm The Operator, an AI concierge for ntwrk.party (The Network). Read your recent work and wanted to ask if you're open to an off-the-record 6-seat local dinner invite (no pitching, no fees). Reply STOP anytime.",
    forbiddenTopics: [
      "paid access or cash vouch bounties",
      "disclosing member identities without consent",
      "minors / under 18 in paid outreach",
      "raw phone numbers or OTP codes in DMs",
    ],
  }),
};

export function getPersonaSocialPlaybook(personaId: PersonaId): PersonaSocialPlaybook {
  return PERSONA_SOCIAL_PLAYBOOKS[personaId];
}

export function buildSocialPlaybookBrief(
  personaId: PersonaId,
  channel: SocialPlaybookChannel,
): string {
  const playbook = PERSONA_SOCIAL_PLAYBOOKS[personaId];
  const guide = SOCIAL_CHANNEL_GUIDANCE[channel];
  return [
    `[Channel Playbook: ${channel.toUpperCase()} | Persona: ${playbook.displayName} (${playbook.domain})]`,
    `Voice: ${playbook.voiceSummary} Channel tone: ${guide.tone}`,
    `Disclosure: ${guide.disclosureRule} Standard disclosure: "${playbook.disclosureStatement}"`,
    `Links & Handoff: ${guide.linkRule} When ready: "${playbook.handoffScript}"`,
    `Cadence & Safety: ${guide.cadenceRule} Under-18 refusal: "${playbook.ageGateScript}"`,
    `Forbidden: ${playbook.forbiddenTopics.join("; ")}.`,
  ].join("\n");
}

export function isSocialPlaybookChannel(
  channel: string | null | undefined,
): channel is SocialPlaybookChannel {
  return (
    channel === "x" ||
    channel === "linkedin" ||
    channel === "instagram" ||
    channel === "reddit"
  );
}

const OBJECTION_AI_RE = /\b(are\s+you\s+(?:an?\s+)?(?:ai|bot|robot|automated|human|real)|is\s+this\s+(?:an?\s+)?(?:ai|bot|automated)|bot\?|ai\?)\b/i;
const OBJECTION_SPAM_RE = /\b(spam|scam|mlm|pyramid|phishing|legit|fake|sketchy|cold\s+pitch)\b/i;
const OBJECTION_PRIVACY_RE = /\b(privacy|data|sell\s+my\s+info|phone\s+number|scrape|tracking|private)\b/i;
const OBJECTION_FREE_RE = /\b(how\s+much|cost|price|pricing|pay|free|subscription|fee)\b/i;
const OBJECTION_READY_RE = /\b(send\s+(?:the\s+)?link|link\??|sign\s+me\s+up|where\s+do\s+i\s+join|i(?:'m|\s+am)\s+in|i(?:'m|\s+am)\s+down|interested|count\s+me\s+in|SLOP|PEON|FRIENDS|NTWRK)\b/i;
const OBJECTION_HOW_RE = /\b(how\s+does\s+(?:it|this)\s+work|what\s+is\s+(?:it|this)|tell\s+me\s+more|more\s+info)\b/i;

export function matchSocialObjection(inboundText: string): SocialObjectionKey | null {
  const trimmed = inboundText.trim();
  if (!trimmed) return null;

  const optOut = parseOptOut(trimmed);
  if (
    optOut.match !== "none" ||
    /\b(unsubscribe|leave\s+me\s+alone|do\s+not\s+contact|don't\s+message|stop\s+messaging|remove\s+me|not\s+interested)\b/i.test(
      trimmed,
    )
  ) {
    return "opt_out_stop";
  }

  if (detectUnderageText(trimmed).isMinor) {
    return "underage_or_minor";
  }

  if (OBJECTION_AI_RE.test(trimmed)) return "are_you_ai";
  if (OBJECTION_SPAM_RE.test(trimmed)) return "is_this_spam_or_scam";
  if (OBJECTION_PRIVACY_RE.test(trimmed)) return "privacy_data";
  if (OBJECTION_FREE_RE.test(trimmed)) return "is_it_free";
  if (OBJECTION_READY_RE.test(trimmed)) return "ready_to_join";
  if (OBJECTION_HOW_RE.test(trimmed)) return "how_does_it_work";
  return null;
}

export interface SocialPlaybookReplyResult {
  readonly personaId: PersonaId;
  readonly channel: SocialPlaybookChannel;
  readonly objection: SocialObjectionKey | null;
  readonly reply: string;
  readonly shouldSuppress: boolean;
  readonly isMinor: boolean;
  readonly includesLink: boolean;
  readonly disclosedAi: boolean;
}

export function renderSocialPlaybookReply(
  personaId: PersonaId,
  channel: SocialPlaybookChannel,
  inboundText: string,
): SocialPlaybookReplyResult {
  const playbook = PERSONA_SOCIAL_PLAYBOOKS[personaId];
  const objection = matchSocialObjection(inboundText);
  const reply =
    objection !== null
      ? playbook.objectionHandlers[objection]
      : channel === "linkedin"
        ? playbook.channelOpeners.linkedin
        : playbook.channelOpeners.x;
  const shouldSuppress = objection === "opt_out_stop" || objection === "underage_or_minor";
  const isMinor = objection === "underage_or_minor";
  const includesLink =
    /https?:\/\//i.test(reply) ||
    reply.toLowerCase().includes(playbook.shortDomain.toLowerCase());
  const disclosedAi = /\bAI\b/i.test(reply);

  return {
    personaId,
    channel,
    objection,
    reply,
    shouldSuppress,
    isMinor,
    includesLink,
    disclosedAi,
  };
}

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
      "We are launching The Network in {{CITY_LABEL}}—connecting people in real life without swipe apps or cold DMs ({{DESIRE_PROMISE}}).",
      "",
      "THE IDEA (CANDID VOX-POP, ZERO ACTORS):",
      "- Location: Public sidewalk in {{NEIGHBORHOOD}} ({{LOCAL_FILMING_NOTE}}).",
      '- Question to explore: "{{CREATOR_QUESTION}}"',
      "- On-camera moment: Have 3+ willing 18+ locals try your custom batch QR card live on camera and capture their unfiltered reaction.",
      "",
      "DELIVERABLES & PAY:",
      "- 1 edited main piece (60-90s) on {{PRIMARY_PLATFORM}} + 2 short vertical cutdowns (20-35s) + raw clips, with your short link pinned for 30 days.",
      "- ${{FLAT_FEE}} guaranteed flat fee paid within 48 hours of approved publish + $2.50 per verified 18+ local signup (capped at +${{BONUS_CAP}}, settled Day 14).",
      "- Target publish date: {{TARGET_PUBLISH_DATE}}.",
      "",
      "CLEAN COMPLIANCE (SENT IN STAGE-2 CLICKWRAP ONCE YOU REPLY):",
      "- 18+ interviewees only, standard #Ad / Paid Partnership disclosure, and our 10-second mobile release QR for recognizable interviewees ({{LOCAL_RELEASE_STATUTE}}).",
      "",
      "If this fits your style, just reply with a quick yes and I will send over the 1-page agreement, custom short link ({{CREATOR_SHORTLINK}}), and mobile release QR right away. Zero pressure if your calendar is full.",
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
