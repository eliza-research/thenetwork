import { LeakGuard } from "../../../packages/core/src/guard.ts";
import { requireCityPack } from "./city-registry.ts";
import { BRAND_DOMAINS, marketingLeakAllowlist } from "./constants.ts";
import { defaultDesireLaneForApp, type DesireLaneId } from "./desire-lanes.ts";
import type { BrandAppId, PersonaId } from "./types.ts";

export const VIDEO_FACTORY_STAGES = [
  "trend",
  "script",
  "voice_render",
  "qa",
  "published",
  "measured",
  "killed",
] as const;

export type VideoStage = (typeof VIDEO_FACTORY_STAGES)[number];

export type VideoProductionTier = 1 | 2 | 3;

export type VideoRetentionVerdict = "pending" | "scale" | "hold" | "kill_rewrite";

export interface PersonaVideoBible {
  readonly personaId: PersonaId;
  readonly displayName: string;
  readonly appId: BrandAppId;
  readonly defaultDesireLane: DesireLaneId;
  readonly domain: string;
  readonly accentToken: string;
  readonly visualIdentity: string;
  readonly voiceProfile: string;
  readonly defaultVoiceId: string;
  readonly audioSting: string;
  readonly comedicAngle: string;
  readonly primaryCtaKeyword: string;
  readonly forbiddenPatterns: readonly RegExp[];
  readonly safetyRules: readonly string[];
}

export interface VideoScriptManifest {
  readonly id: string;
  readonly personaId: PersonaId;
  readonly appId: BrandAppId;
  readonly desireLane?: DesireLaneId;
  readonly city?: string;
  readonly productionTier: VideoProductionTier;
  readonly title: string;
  readonly durationSec: number;
  readonly hookText: string;
  readonly visualBeats: readonly string[];
  readonly dialogue: string;
  readonly punchline: string;
  readonly ctaText: string;
  readonly sponsored: boolean;
  readonly ftcDisclosureText: string | null;
  readonly estimatedRenderCents: number;
}

export interface VideoAsset {
  readonly id: string;
  readonly campaignId: string;
  readonly personaId: PersonaId;
  readonly appId: BrandAppId;
  readonly desireLane: DesireLaneId;
  readonly city?: string;
  readonly productionTier: VideoProductionTier;
  readonly stage: VideoStage;
  readonly script: VideoScriptManifest;
  readonly safetyLintPass: boolean;
  readonly safetyLintErrors: readonly string[];
  readonly qaApproved: boolean;
  readonly renderRef: string | null;
  readonly renderCostCents: number;
  readonly publishedUrls: readonly string[];
  readonly retentionVerdict: VideoRetentionVerdict;
  readonly scheduledDay: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VideoScriptLintResult {
  readonly pass: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly leakReasons: readonly string[];
}

export interface VideoStageTransitionResult {
  readonly ok: boolean;
  readonly asset: VideoAsset;
  readonly reason?: string;
}

export interface VideoRetentionMetrics {
  readonly views72h: number;
  readonly hold3sRate: number;
  readonly avgWatchPct: number;
  readonly sharesAndSaves: number;
  readonly commentKeywordRate: number;
  readonly verifiedAdultJoins: number;
  readonly totalSpendCents: number;
  readonly targetCpaCents?: number;
}

export interface VideoRetentionEvaluation {
  readonly verdict: VideoRetentionVerdict;
  readonly score: number;
  readonly sharesPer1k: number;
  readonly cpaCents: number | null;
  readonly reasons: readonly string[];
  readonly recommendedBanditAction: "scale" | "maintain" | "kill_and_rewrite";
}

export interface WeeklyVideoPacingReport {
  readonly targetPerWeek: number;
  readonly producedCount: number;
  readonly publishedCount: number;
  readonly measuredCount: number;
  readonly killedCount: number;
  readonly completionPct: number;
  readonly onTrack: boolean;
  readonly byPersona: Record<PersonaId, number>;
  readonly byTier: Record<VideoProductionTier, number>;
  readonly tierSharePct: Record<VideoProductionTier, number>;
  readonly totalRenderCostCents: number;
  readonly avgCostPerVideoCents: number;
}

const GLOBAL_FORBIDDEN_SCRIPT_PATTERNS: ReadonlyArray<{
  readonly code: string;
  readonly pattern: RegExp;
  readonly message: string;
}> = [
  {
    code: "clef_secrecy_violation",
    pattern: /\b(clef\s*score|clef\s*rating|attractiveness\s*score|looks\s*rating|appearance\s*facet|rated\s+a\s+[0-9](\.[0-9])?\/10)\b/i,
    message: "Scripts must never reveal or joke about internal Clef or looks ratings.",
  },
  {
    code: "minor_targeting_violation",
    pattern: /\b(high\s*school(er)?s?|high\s*school\s*(?:freshman|sophomore|junior|senior|student)|under\s*18|1[3-7]\s*y\/?o|16[\s-]year[\s-]old|17[\s-]year[\s-]old|turning\s+18|middle\s*school(er)?s?|prom\s*date|teen\s*dating)\b/i,
    message: "Scripts must never target minors or high-school audiences (strict 18+ floor).",
  },
  {
    code: "deceptive_ai_denial",
    pattern: /\b(not\s+a\s+bot|not\s+an?\s+ai|100%\s+real\s+human|i\s+am\s+a\s+real\s+person)\b/i,
    message: "Persona accounts must never deny being AI or pretend to be a real human.",
  },
  {
    code: "raw_phone_number_exposure",
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    message: "Never embed raw phone numbers in scripts; route via go.<brand> Turnstile QR or SKILL.md.",
  },
  {
    code: "forbidden_gimmick_hardware",
    pattern: /\b(wearable\s*billboard|led\s*backpack|led\s*vest|qr\s*backpack|portable\s*receipt\s*printer|thermal\s*printer\s*citation|smart\s*glasses)\b/i,
    message: "Hardware gimmicks are disallowed; keep formats to real humans, QR fliers, and clean screen UI.",
  },
];

const VENN_ROMANCE_FRAMING_PATTERN =
  /\b(hot\s*singles|hookup|blind\s*date|romantic\s*match|situationship|dating\s*app|swipe\s*right|find\s*a\s*girlfriend|find\s*a\s*boyfriend)\b/i;

export const PERSONA_VIDEO_BIBLES: Readonly<Record<PersonaId, PersonaVideoBible>> = {
  chadwick: {
    personaId: "chadwick",
    displayName: "Chadwick",
    appId: "slop",
    defaultDesireLane: "soulmate_dating",
    domain: BRAND_DOMAINS.slop,
    accentToken: "slop-chartreuse",
    visualIdentity:
      "Stylized matte acid-chartreuse 3D felt heart-creature puppet in Remotion PIP corner + handheld 9:16 selfie-cam clips.",
    voiceProfile: "Crisp, fast-talking blunt wingman with dry warmth and zero cringe.",
    defaultVoiceId: "voice-chadwick-v1",
    audioSting: "imessage-swoosh-06s",
    comedicAngle:
      "Roasting swipe-app burnout, three-week pen-pal chats, and late-night texting habits.",
    primaryCtaKeyword: "SLOP",
    forbiddenPatterns: [/\b(peon\.biz|friends\.help|ntwrk\.party)\b/i],
    safetyRules: [
      "Strictly 18+ adult dating only.",
      "Zero real unconsented people or member chats.",
      "Never mention internal Clef or attractiveness scores.",
      "Preserve slop.date brand isolation.",
    ],
  },
  sloane: {
    personaId: "sloane",
    displayName: "Sloane",
    appId: "slop",
    defaultDesireLane: "soulmate_dating",
    domain: BRAND_DOMAINS.slop,
    accentToken: "slop-chartreuse",
    visualIdentity:
      "Expressive stylized 2D/3D illustrated bestie avatar on stark B&W with clean iMessage and dossier stamp UI renders.",
    voiceProfile: "Dry, observant, sharp-witted friend with calm deadpan timing.",
    defaultVoiceId: "voice-sloane-v1",
    audioSting: "imessage-swoosh-06s",
    comedicAngle:
      "Forensic dating-app case files, unsent late-night drafts, and rescuing adults from endless pen-pal matches.",
    primaryCtaKeyword: "SLOP",
    forbiddenPatterns: [/\b(peon\.biz|friends\.help|ntwrk\.party)\b/i],
    safetyRules: [
      "Strictly 18+ adult dating only.",
      "Consented or synthetic profiles only.",
      "Zero Clef ratings or guaranteed-date claims.",
      "100% gender-neutral terms and pricing.",
    ],
  },
  peon: {
    personaId: "peon",
    displayName: "Peon",
    appId: "peon",
    defaultDesireLane: "money_work",
    domain: BRAND_DOMAINS.peon,
    accentToken: "peon-orange",
    visualIdentity:
      "Animated talking safety-orange necktie cubicle puppet paired with Remotion screen parodies of corporate job posts.",
    voiceProfile: "Weary deadpan baritone anti-LinkedIn fixer.",
    defaultVoiceId: "voice-peon-fixer-v1",
    audioSting: "slack-ping-06s",
    comedicAngle:
      "Translating corporate jargon into plain English, mocking ghost jobs, and skipping 8-round hiring theater.",
    primaryCtaKeyword: "PEON",
    forbiddenPatterns: [
      /\b(slop\.date|friends\.help|ntwrk\.party)\b/i,
      /\b(dating\s*profile|first\s*date|romantic)\b/i,
    ],
    safetyRules: [
      "Candidates never pay a fee.",
      "Strict slop != peon air-gap: zero dating signal references.",
      "Never collect or joke about protected-class attributes or SSNs.",
    ],
  },
  venn: {
    personaId: "venn",
    displayName: "Venn",
    appId: "friends",
    defaultDesireLane: "ideal_friends",
    domain: BRAND_DOMAINS.friends,
    accentToken: "friends-green",
    visualIdentity:
      "Animated forest-and-bright-green overlapping Venn-circle puppet with carabiner + dead group-chat UI interventions.",
    voiceProfile: "Warm, grounded social director who actually gets plans onto calendars.",
    defaultVoiceId: "voice-venn-social-v1",
    audioSting: "bicycle-bell-06s",
    comedicAngle:
      "Exposing the 'we should hang soon!' lie, reviving stale plans, and seating 3-to-6-person groups that actually click.",
    primaryCtaKeyword: "FRIENDS",
    forbiddenPatterns: [
      /\b(slop\.date|peon\.biz|ntwrk\.party)\b/i,
      VENN_ROMANCE_FRAMING_PATTERN,
    ],
    safetyRules: [
      "Strict platonic framing (ROMANCE_FRAMING filter active).",
      "Public commercial venues only; groups of 3-6 adults.",
      "Never expose real RSVP rosters or private addresses.",
    ],
  },
  operator: {
    personaId: "operator",
    displayName: "The Operator",
    appId: "ntwrk",
    defaultDesireLane: "elite_serendipity",
    domain: BRAND_DOMAINS.ntwrk,
    accentToken: "network-ink",
    visualIdentity:
      "Pure monochrome Host Grotesk kinetic typography, minimalist 3-bubble iMessage cinema, and B&W city architectural B-roll.",
    voiceProfile: "Calm, understated concierge with quiet authority.",
    defaultVoiceId: "voice-operator-mono-v1",
    audioSting: "cello-pluck-06s",
    comedicAngle:
      "Quiet absurdity of $5,000 networking clubs vs. one high-trust, double-opt-in text introduction.",
    primaryCtaKeyword: "NTWRK",
    forbiddenPatterns: [/\b(slop\.date|peon\.biz|friends\.help)\b/i],
    safetyRules: [
      "Invite-only framing on web.",
      "Never disclose member identities without mutual consent.",
      "Zero paid/transactional access claims or cash vouch bounties.",
    ],
  },
};

export const STARTER_COMEDY_SCRIPTS: readonly VideoScriptManifest[] = [
  {
    id: "script-chadwick-01",
    personaId: "chadwick",
    appId: "slop",
    desireLane: "soulmate_dating",
    productionTier: 1,
    title: "The 400-Swipe Receipt",
    durationSec: 28,
    hookText: "I pulled my client's screen-time receipt for dating apps this week. Eleven hours. Zero dates.",
    visualBeats: [
      "Clean receipt graphic printing: 412 swipes, 9 matches, 6 'hey how was your weekend', 0 actual coffees.",
      "Chadwick stamps the receipt DENIED in chartreuse.",
      "Cut to one quiet double-opt-in confirmation card for Thursday drinks.",
    ],
    dialogue:
      "You spent a part-time job swiping through strangers just to ask six people how their weekend was and never meet one of them.",
    punchline:
      "Delete the slot machine. Tell your AI what you actually want, wait for both sides to say yes, and show up Thursday in West Village.",
    ctaText: "Comment SLOP or visit go.slop.date (18+).",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 85,
  },
  {
    id: "script-chadwick-02",
    personaId: "chadwick",
    appId: "slop",
    desireLane: "soulmate_dating",
    productionTier: 2,
    title: "11:42 PM 'wyd' Emergency Intercept",
    durationSec: 27,
    hookText: "PUT THE THUMB DOWN. DO NOT HIT SEND ON 'WYD.'",
    visualBeats: [
      "Fake incoming call card: YOUR AI MATCHMAKER (URGENT).",
      "Split screen showing draft 'hey wyd' at 11:42 PM.",
      "Draft clears and swaps to confirmed Friday 7:30 PM bar invite.",
    ],
    dialogue:
      "It is 11:42 PM on a Thursday. You are not mysterious, you are bored in East Village eating dry pretzels. Sending 'wyd' revokes your dating privileges.",
    punchline:
      "Stop texting three-week pen pals and show up to a real West Village table when both sides say yes.",
    ctaText: "Visit go.slop.date or comment SLOP (18+).",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 310,
  },
  {
    id: "script-sloane-01",
    personaId: "sloane",
    appId: "slop",
    desireLane: "soulmate_dating",
    productionTier: 2,
    title: "Matchmaker Case File #19: The 3-Podcast Guy",
    durationSec: 29,
    hookText:
      "People ask why my AI matchmaker sends one intro a week. Let me show you who I filtered out.",
    visualBeats: [
      "Stark B&W dossier stamped CASE FILE #19 — PASSED.",
      "Red stamps on '33 | Still figuring it out', 'hosts 3 podcasts', 'never suggests a time'.",
      "Clean warm confirmation for Tuesday wine in Williamsburg.",
    ],
    dialogue:
      "Thirty-three and still figuring out his goals — sir, you are not a stealth startup. Three podcasts is not a hobby, it is a cry for an editor.",
    punchline:
      "Meanwhile I quietly found you a 31-year-old architect in Williamsburg who reads physical books and already confirmed Tuesday wine.",
    ctaText: "Comment SLOP or head to go.slop.date (18+ free).",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 320,
  },
  {
    id: "script-sloane-02",
    personaId: "sloane",
    appId: "slop",
    desireLane: "soulmate_dating",
    productionTier: 1,
    title: "The Unsent Draft",
    durationSec: 27,
    hookText: "You are about to text someone 'hope you are well' after four months of silence. Put the phone down.",
    visualBeats: [
      "Clean Remotion synthetic text thread with blinking cursor on 'hey random question...'.",
      "Sloane quietly locks the draft and swaps in one verified Thursday intro.",
      "Minimal chartreuse confirmation card: both sides opted in.",
    ],
    dialogue:
      "You do not actually miss him — you just hate the idea of starting from zero on another app. That is why you keep recycling old threads.",
    punchline:
      "No swiping through 400 strangers to move on. One vetted double-opt-in intro when someone genuinely fits.",
    ctaText: "Send this to the friend with a draft open. Comment SLOP or visit go.slop.date (18+).",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 80,
  },
  {
    id: "script-peon-01",
    personaId: "peon",
    appId: "peon",
    desireLane: "money_work",
    productionTier: 1,
    title: "Translating Corporate Posts Into English",
    durationSec: 29,
    hookText: "Let us translate today's top corporate hype post so you keep your brain cells.",
    visualBeats: [
      "Orange-tie puppet at grey cubicle desk over synthetic corporate feed post.",
      "Glitch-rewrite overlays in safety orange Host Grotesk.",
      "Feed crumples into clean peon.biz double-opt-in intro card.",
    ],
    dialogue:
      "Fast-paced family wearing many hats means zero docs. Competitive comp means vibes. Entry-level rockstar with 8 years of Kubernetes — Kubernetes is barely twelve.",
    punchline:
      "Stop applying into ATS black holes. Get reviewed double-opt-in intros straight to real hiring teams.",
    ctaText: "Candidates never pay a cent. Comment PEON or visit go.peon.biz.",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 85,
  },
  {
    id: "script-peon-02",
    personaId: "peon",
    appId: "peon",
    desireLane: "money_work",
    productionTier: 2,
    title: "Getting Hired Without Touching Easy Apply",
    durationSec: 28,
    hookText:
      "Day 1 of getting my friend Dan a real engineering role without writing 'thrilled to announce' once.",
    visualBeats: [
      "Puppet shredding 347 automated Sunday-3AM rejection emails.",
      "Giant orange buzzer labeled NO 7-ROUND TRIVIA.",
      "Double-opt-in founder coffee intro confirmed in SoHo / Nolita.",
    ],
    dialogue:
      "Dan sent 347 Easy Applies and got 347 bot rejections. So I took his real shipped work, paired him with two SoHo / Nolita founders, and sent one text.",
    punchline: "Zero cover letters. Zero re-typing your own PDF into broken portals.",
    ctaText: "Drop your worst application story and comment PEON or visit go.peon.biz.",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 330,
  },
  {
    id: "script-venn-01",
    personaId: "venn",
    appId: "friends",
    desireLane: "ideal_friends",
    productionTier: 1,
    title: "The 'We Should Hang Out Soon' Lie Detector",
    durationSec: 28,
    hookText: "STOP SAYING 'WE SHOULD TOTALLY HANG OUT SOON.' YOU ARE LYING TO EACH OTHER.",
    visualBeats: [
      "Green Venn puppet opens dead group chat titled Brunch Soon!! (4 months stale).",
      "Circles three classic excuses in bright green.",
      "Thursday 7 PM Williamsburg dumpling table locks in for 4 real people.",
    ],
    dialogue:
      "It has been 118 days. Nobody is grabbing coffee. It is Friday night and you are staring at a ceiling fan eating cold leftovers.",
    punchline:
      "So I matched you with three Williamsburg locals who like climbing and cheap dumplings and put a public table on the calendar Thursday at 7.",
    ctaText: "Comment FRIENDS or visit go.friends.help — solo or bring 2 friends.",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 85,
  },
  {
    id: "script-venn-02",
    personaId: "venn",
    appId: "friends",
    desireLane: "ideal_friends",
    productionTier: 2,
    title: "Why Dinner With Six Strangers Usually Flops",
    durationSec: 28,
    hookText: "Most stranger dinners fail before the appetizers arrive because nobody thought about the mix.",
    visualBeats: [
      "Venn puppet arranging 6 seats on a clean green tabletop diagram.",
      "Cards land on seats: one storyteller, one sharp listener, two neighborhood regulars, two people new in town.",
      "Green stamp: FREE TO JOIN — PUBLIC VENUE.",
    ],
    dialogue:
      "Random seating puts six quiet people at one table and six people talking over each other at the next. We match the whole table so nobody feels like the odd seat out.",
    punchline: "Zero subscription fee. Just 3-to-6-person plans at real neighborhood spots in New York City.",
    ctaText: "Which seat are you? Comment FRIENDS or visit go.friends.help.",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 325,
  },
  {
    id: "script-operator-01",
    personaId: "operator",
    appId: "ntwrk",
    desireLane: "elite_serendipity",
    productionTier: 1,
    title: "The $5,000 Networking Club vs. One Text",
    durationSec: 30,
    hookText: "You paid $5,000 for a private founders club.",
    visualBeats: [
      "Stark monochrome Host Grotesk text on black.",
      "Moody B&W B-roll of plastic wine cups and awkward name-tag lanyards.",
      "Hard cut to white screen with 3 minimalist black iMessage bubbles.",
    ],
    dialogue:
      "And you spent two hours holding lukewarm wine in a hotel ballroom dodging pitches.",
    punchline:
      "Thursday, 8pm, West Village. Six seats: people actually building things in New York City. Zero pitching. Both sides opt in before anyone meets.",
    ctaText: "ntwrk.party — Invite-only on web. Ask someone inside.",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 95,
  },
  {
    id: "script-operator-02",
    personaId: "operator",
    appId: "ntwrk",
    desireLane: "elite_serendipity",
    productionTier: 1,
    title: "What Do You Actually Want?",
    durationSec: 29,
    hookText: "Most people can list ten apps on their phone and still cannot name who they want to meet this year.",
    visualBeats: [
      "Monochrome typography beats: THE RIGHT WORK. REAL FRIENDS. SOMEONE YOU ACTUALLY WANT TO BE WITH.",
      "Quiet evening street B-roll in New York City transitioning into a single text thread.",
      "Clean card: ONE NETWORK. CITY BY CITY. DOUBLE OPT-IN.",
    ],
    dialogue:
      "You do not need another feed. You need the right co-founder, a better table on Thursday night, or the one introduction that changes your year.",
    punchline:
      "We are building New York City first, then city by city — quietly connecting people to exactly what they want in life.",
    ctaText: "ntwrk.party — Reviewed. Private. Double opt-in.",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 110,
  },
];

export const EXTENDED_COMEDY_SCRIPTS: readonly VideoScriptManifest[] = [
  {
    id: "script-operator-03",
    personaId: "operator",
    appId: "ntwrk",
    desireLane: "cofounder_venture",
    productionTier: 3,
    title: "I Know a Guy",
    durationSec: 29,
    hookText:
      "At 2:14 PM Tuesday, a founder texted that she needed a hardware acoustics engineer before Friday.",
    visualBeats: [
      "Moody B&W rainy SoHo / Nolita sidewalk shot.",
      "Minimalist 5-node network graph lighting up 2 hops across New York City.",
      "Timestamp cards: 2:14 PM ASK -> 2:19 PM MATCH -> 2:41 PM DOUBLE OPT-IN -> 4:00 PM COFFEE.",
    ],
    dialogue:
      "No job post. No cold outreach. One member vouched for an audio engineer two blocks away between studio sessions. Both said yes. They met at four.",
    punchline: "Money buys ads. It does not buy trust. That is what a network is for.",
    ctaText: "Build your network at ntwrk.party — Free. Reviewed. Double opt-in.",
    sponsored: false,
    ftcDisclosureText: null,
    estimatedRenderCents: 850,
  },
];

export function localizeVideoScriptForCity(
  script: VideoScriptManifest,
  cityCode: string,
): VideoScriptManifest {
  const pack = requireCityPack(cityCode);
  const primaryHood = pack.corridors[0]?.neighborhood ?? pack.label;
  const secondHood = pack.corridors[1]?.neighborhood ?? primaryHood;
  const thirdHood = pack.corridors[2]?.neighborhood ?? secondHood;
  const fourthHood = pack.corridors[3]?.neighborhood ?? primaryHood;

  if (pack.code === "nyc") {
    return {
      ...script,
      city: pack.code,
      visualBeats: [...script.visualBeats],
    };
  }

  const swapText = (text: string): string =>
    text
      .replace(
        /We are building New York City first, then city by city/g,
        `We started in New York City and are expanding to ${pack.label} next`,
      )
      .replace(/(?<!started in )New York City/g, pack.label)
      .replace(/West Village/g, primaryHood)
      .replace(/SoHo \/ Nolita/g, secondHood)
      .replace(/Williamsburg/g, thirdHood)
      .replace(/East Village/g, fourthHood);

  return {
    ...script,
    id: `${script.id}-${pack.code}`,
    city: pack.code,
    title: swapText(script.title),
    hookText: swapText(script.hookText),
    visualBeats: script.visualBeats.map(swapText),
    dialogue: swapText(script.dialogue),
    punchline: swapText(script.punchline),
    ctaText: swapText(script.ctaText),
  };
}

export function buildStarterScriptsForCity(cityCode: string): VideoScriptManifest[] {
  const pack = requireCityPack(cityCode);
  return STARTER_COMEDY_SCRIPTS.map((script) => localizeVideoScriptForCity(script, pack.code));
}

const VIDEO_CTA_REGEX_CACHE = new Map<string, RegExp>();
let defaultVideoLeakGuard: LeakGuard | null = null;

function getDefaultVideoLeakGuard(): LeakGuard {
  if (!defaultVideoLeakGuard) {
    defaultVideoLeakGuard = new LeakGuard({
      contacts: true,
      canaryShapes: true,
      allow: [...marketingLeakAllowlist()],
    });
  }
  return defaultVideoLeakGuard;
}

function getCtaKeywordRegex(keyword: string): RegExp {
  let cached = VIDEO_CTA_REGEX_CACHE.get(keyword);
  if (!cached) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cached = new RegExp(`\\b${escaped}\\b`, "i");
    VIDEO_CTA_REGEX_CACHE.set(keyword, cached);
  }
  return cached;
}

export function lintVideoScript(
  script: VideoScriptManifest,
  leakGuard?: LeakGuard,
): VideoScriptLintResult {
  const bible = PERSONA_VIDEO_BIBLES[script.personaId];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (script.appId !== bible.appId) {
    errors.push(
      `persona_app_mismatch: ${script.personaId} owns '${bible.appId}', not '${script.appId}'.`,
    );
  }

  if (script.durationSec < 15 || script.durationSec > 90) {
    errors.push(`invalid_duration: ${script.durationSec}s must be between 15s and 90s.`);
  }

  const combinedText = [
    script.title,
    script.hookText,
    ...script.visualBeats,
    script.dialogue,
    script.punchline,
    script.ctaText,
    script.ftcDisclosureText ?? "",
  ].join("\n");

  for (const rule of GLOBAL_FORBIDDEN_SCRIPT_PATTERNS) {
    if (rule.pattern.test(combinedText)) {
      errors.push(`${rule.code}: ${rule.message}`);
    }
  }

  for (const forbidden of bible.forbiddenPatterns) {
    if (forbidden.test(combinedText)) {
      errors.push(
        `brand_isolation_violation: ${bible.displayName} script matched forbidden pattern ${forbidden.source}.`,
      );
    }
  }

  const otherDomains = (Object.entries(BRAND_DOMAINS) as Array<[BrandAppId, string]>)
    .filter(([app]) => app !== bible.appId)
    .map(([, domain]) => domain);
  for (const foreignDomain of otherDomains) {
    if (combinedText.toLowerCase().includes(foreignDomain)) {
      errors.push(
        `cross_brand_domain_bleed: ${bible.domain} script references '${foreignDomain}'.`,
      );
    }
  }

  if (script.sponsored) {
    const ftc = script.ftcDisclosureText ?? "";
    const hasTag = /(#ad|paid partnership|sponsored by)/i.test(`${ftc} ${combinedText}`);
    if (!hasTag) {
      errors.push(
        "missing_ftc_disclosure: Sponsored video must include explicit '#Ad', 'Paid Partnership', or 'Sponsored by' disclosure.",
      );
    }
  } else {
    const hasAffiliationCue =
      combinedText.toLowerCase().includes(bible.domain) ||
      /\b(ai\s+(?:matchmaker|agent|persona)|the\s+network|#ad|paid\s+partnership|sponsored\s+by)\b/i.test(
        `${script.ftcDisclosureText ?? ""} ${combinedText}`,
      );
    if (!hasAffiliationCue) {
      warnings.push(
        `missing_ai_or_brand_disclosure: Persona video should disclose AI/brand affiliation (${bible.domain} or AI agent disclosure).`,
      );
    }
  }

  const hasCta =
    combinedText.toLowerCase().includes(bible.domain) ||
    combinedText.includes("SKILL.md") ||
    getCtaKeywordRegex(bible.primaryCtaKeyword).test(script.ctaText);
  if (!hasCta) {
    warnings.push(
      `missing_primary_cta: CTA does not mention ${bible.domain}, SKILL.md, or keyword '${bible.primaryCtaKeyword}'.`,
    );
  }

  const guard = leakGuard ?? getDefaultVideoLeakGuard();
  const leakReasons = guard.check(combinedText);
  for (const reason of leakReasons) {
    errors.push(`leak_guard: ${reason}`);
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
    leakReasons,
  };
}

const ALLOWED_STAGE_TRANSITIONS: Readonly<Record<VideoStage, readonly VideoStage[]>> = {
  trend: ["script", "killed"],
  script: ["voice_render", "killed"],
  voice_render: ["qa", "killed"],
  qa: ["published", "script", "killed"],
  published: ["measured", "killed"],
  measured: ["killed"],
  killed: [],
};

export function canTransitionVideoStage(
  from: VideoStage,
  to: VideoStage,
  ctx: { readonly safetyLintPass: boolean; readonly qaApproved: boolean },
): { readonly allowed: boolean; readonly reason?: string } {
  if (from === to) {
    return { allowed: false, reason: `already_in_stage_${from}` };
  }
  const allowedNext = ALLOWED_STAGE_TRANSITIONS[from];
  if (!allowedNext.includes(to)) {
    return { allowed: false, reason: `illegal_transition_${from}_to_${to}` };
  }
  if (to === "voice_render" && !ctx.safetyLintPass) {
    return { allowed: false, reason: "safety_lint_required_before_voice_render" };
  }
  if (to === "published" && (!ctx.safetyLintPass || !ctx.qaApproved)) {
    return { allowed: false, reason: "safety_lint_and_qa_approval_required_before_publish" };
  }
  return { allowed: true };
}

export function createVideoAssetFromScript(
  campaignId: string,
  script: VideoScriptManifest,
  nowIso: string,
  opts?: { readonly id?: string; readonly scheduledDay?: string | null; readonly leakGuard?: LeakGuard },
): VideoAsset {
  const lint = lintVideoScript(script, opts?.leakGuard);
  return {
    id: opts?.id ?? `${campaignId}:${script.id}`,
    campaignId,
    personaId: script.personaId,
    appId: script.appId,
    desireLane: script.desireLane ?? defaultDesireLaneForApp(script.appId),
    city: script.city,
    productionTier: script.productionTier,
    stage: "script",
    script,
    safetyLintPass: lint.pass,
    safetyLintErrors: lint.errors,
    qaApproved: false,
    renderRef: null,
    renderCostCents: script.estimatedRenderCents,
    publishedUrls: [],
    retentionVerdict: "pending",
    scheduledDay: opts?.scheduledDay ?? null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function advanceVideoAssetStage(
  asset: VideoAsset,
  nextStage: VideoStage,
  nowIso: string,
  opts?: {
    readonly qaApproved?: boolean;
    readonly renderRef?: string | null;
    readonly renderCostCents?: number;
    readonly publishedUrls?: readonly string[];
    readonly retentionVerdict?: VideoRetentionVerdict;
    readonly leakGuard?: LeakGuard;
  },
): VideoStageTransitionResult {
  const lint = lintVideoScript(asset.script, opts?.leakGuard);
  const nextQaApproved = opts?.qaApproved ?? asset.qaApproved;
  const check = canTransitionVideoStage(asset.stage, nextStage, {
    safetyLintPass: lint.pass,
    qaApproved: nextQaApproved,
  });

  if (!check.allowed) {
    return {
      ok: false,
      asset: {
        ...asset,
        safetyLintPass: lint.pass,
        safetyLintErrors: lint.errors,
      },
      reason: check.reason,
    };
  }

  return {
    ok: true,
    asset: {
      ...asset,
      stage: nextStage,
      safetyLintPass: lint.pass,
      safetyLintErrors: lint.errors,
      qaApproved: nextQaApproved,
      renderRef: opts?.renderRef !== undefined ? opts.renderRef : asset.renderRef,
      renderCostCents: opts?.renderCostCents ?? asset.renderCostCents,
      publishedUrls: opts?.publishedUrls ? [...opts.publishedUrls] : asset.publishedUrls,
      retentionVerdict: opts?.retentionVerdict ?? asset.retentionVerdict,
      updatedAt: nowIso,
    },
  };
}

export function evaluateVideoRetention(
  metrics: VideoRetentionMetrics,
): VideoRetentionEvaluation {
  const targetCpa = metrics.targetCpaCents ?? 858;
  const views = Math.max(0, Math.floor(metrics.views72h));
  const sharesPer1k = views > 0 ? Number(((metrics.sharesAndSaves / views) * 1000).toFixed(2)) : 0;
  const cpaCents =
    metrics.verifiedAdultJoins > 0
      ? Math.round(metrics.totalSpendCents / metrics.verifiedAdultJoins)
      : null;

  const reasons: string[] = [];
  let score = 0;

  if (metrics.hold3sRate >= 0.7) {
    score += 35;
    reasons.push("strong_3s_hook_hold_gte_70pct");
  } else if (metrics.hold3sRate >= 0.5) {
    score += 18;
  } else {
    reasons.push("weak_3s_hook_hold_lt_50pct");
  }

  if (metrics.avgWatchPct >= 90) {
    score += 25;
    reasons.push("high_rewatch_duration_gte_90pct");
  } else if (metrics.avgWatchPct >= 65) {
    score += 12;
  } else {
    reasons.push("mid_video_drop_off_lt_65pct");
  }

  if (sharesPer1k >= 25) {
    score += 20;
    reasons.push("viral_share_save_velocity_gte_25_per_1k");
  } else if (sharesPer1k >= 10) {
    score += 10;
  }

  if (metrics.commentKeywordRate >= 0.015) {
    score += 20;
    reasons.push("strong_comment_keyword_conversion_gte_1_5pct");
  } else if (metrics.commentKeywordRate >= 0.005) {
    score += 10;
  }

  const severeCpaMiss = cpaCents !== null && cpaCents > Math.round(targetCpa * 2.5);
  if (severeCpaMiss) {
    reasons.push(`cpa_exceeded_2_5x_target (${cpaCents}c > ${Math.round(targetCpa * 2.5)}c)`);
  } else if (cpaCents !== null && cpaCents <= targetCpa) {
    reasons.push(`efficient_cpa_le_target (${cpaCents}c <= ${targetCpa}c)`);
  }

  if (metrics.hold3sRate < 0.5 || severeCpaMiss) {
    return {
      verdict: "kill_rewrite",
      score,
      sharesPer1k,
      cpaCents,
      reasons,
      recommendedBanditAction: "kill_and_rewrite",
    };
  }

  if (
    score >= 70 ||
    (metrics.hold3sRate >= 0.7 && metrics.avgWatchPct >= 90) ||
    sharesPer1k >= 25 ||
    metrics.commentKeywordRate >= 0.015
  ) {
    return {
      verdict: "scale",
      score,
      sharesPer1k,
      cpaCents,
      reasons,
      recommendedBanditAction: "scale",
    };
  }

  return {
    verdict: "hold",
    score,
    sharesPer1k,
    cpaCents,
    reasons,
    recommendedBanditAction: "maintain",
  };
}

export function computeWeeklyVideoPacing(
  assets: readonly VideoAsset[],
  opts?: { readonly targetPerWeek?: number },
): WeeklyVideoPacingReport {
  const targetPerWeek = Math.max(1, Math.floor(opts?.targetPerWeek ?? 30));
  const byPersona: Record<PersonaId, number> = {
    chadwick: 0,
    sloane: 0,
    peon: 0,
    venn: 0,
    operator: 0,
  };
  const byTier: Record<VideoProductionTier, number> = {
    1: 0,
    2: 0,
    3: 0,
  };

  let producedCount = 0;
  let publishedCount = 0;
  let measuredCount = 0;
  let killedCount = 0;
  let totalRenderCostCents = 0;

  for (const asset of assets) {
    byPersona[asset.personaId] += 1;
    byTier[asset.productionTier] += 1;
    totalRenderCostCents += Math.max(0, asset.renderCostCents);

    if (asset.stage === "killed") {
      killedCount += 1;
    } else {
      producedCount += 1;
    }
    if (asset.stage === "published" || asset.stage === "measured") {
      publishedCount += 1;
    }
    if (asset.stage === "measured") {
      measuredCount += 1;
    }
  }

  const totalAssets = assets.length;
  const tierSharePct: Record<VideoProductionTier, number> = {
    1: totalAssets > 0 ? Math.round((byTier[1] / totalAssets) * 100) : 0,
    2: totalAssets > 0 ? Math.round((byTier[2] / totalAssets) * 100) : 0,
    3: totalAssets > 0 ? Math.round((byTier[3] / totalAssets) * 100) : 0,
  };

  const completionPct = Math.min(100, Math.round((producedCount / targetPerWeek) * 100));

  return {
    targetPerWeek,
    producedCount,
    publishedCount,
    measuredCount,
    killedCount,
    completionPct,
    onTrack: producedCount >= targetPerWeek,
    byPersona,
    byTier,
    tierSharePct,
    totalRenderCostCents,
    avgCostPerVideoCents: totalAssets > 0 ? Math.round(totalRenderCostCents / totalAssets) : 0,
  };
}
