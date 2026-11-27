import { fenceUntrusted } from "./fence.ts";
import {
  canApproveExternalEventRsvp,
  canInviteExternalEventAttendee,
  canPublishExternalEvent,
  computeApprovedExternalCap,
  evaluateExternalEventT24Quorum,
  externalEventSourceHostNative,
  externalEventSourceMemberSubmittedPublic,
  externalEventSourceOfficialApi,
  isSanctionedExternalEventSource,
  type ApproveExternalEventRsvpInput,
  type InviteExternalEventAttendeeInput,
  type PublishExternalEventInput,
} from "./generated/externalEventBridge.ts";
import { textVariants } from "./guard.ts";
import { canBeMatched, isMinor, relayMinorAge, relayMinorEstimate } from "./policy.ts";
import { clampSms, cleanPhrase, formatCrowdExpectation, validateOutboundSms } from "./smsCopy.ts";
import type { CityId } from "./types.ts";

export const LUMA_API_BASE = "https://public-api.luma.com";
export const MEETUP_GRAPHQL_ENDPOINT = "https://api.meetup.com/gql-ext";

export type ExternalEventSource =
  | "host_native"
  | "official_api"
  | "member_submitted_public"
  | "scraped";

export type ExternalEventPlatform = "luma" | "meetup" | "partiful";

export type ExternalCrowdMode = "dense_curated" | "mixed_impromptu" | "sparse_anchor";

export type ExternalQuorumDecision = "go" | "cancel_no_anchor" | "cancel_low_quorum";

export type ExternalRsvpStatus = "approved" | "pending_approval" | "waitlist" | "declined";

export interface ExternalEventDraft {
  id: string;
  city: CityId;
  platform: ExternalEventPlatform;
  source: ExternalEventSource;
  title: string;
  interest: string;
  description: string;
  venueName: string;
  venueAddress: string;
  arrivalLandmark: string;
  isPublicVenue: boolean;
  venueWalkInCapacity: number;
  startIso: string;
  endIso: string;
  timezone: string;
  anchorFirstName: string;
  confirmedNetworkAnchors: number;
  confirmedNetworkTotal: number;
  targetRoomSize: number;
  reviewApproved?: boolean;
  humanReviewApproved?: boolean;
  allParticipantsAdult: boolean;
  hideGuestList: boolean;
  approvalRequired: boolean;
  externalCrowdDisclosed: boolean;
  coverPrompt?: string;
}

export interface ScreeningQuestionSpec {
  id: string;
  label: string;
  required: boolean;
  kind: "adult_18_plus" | "interest_screening";
}

export interface HttpRequestSpec {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface NormalizedExternalRsvpEvent {
  kind: "rsvp";
  platform: ExternalEventPlatform;
  source: ExternalEventSource;
  eventExternalId: string;
  guestExternalId: string;
  firstName: string;
  status: ExternalRsvpStatus;
  confirmedAdult18Plus: boolean;
  answeredScreeningQuestion: boolean;
  screeningAnswerText?: string;
  fencedScreeningAnswer?: string;
  injectionDetected?: boolean;
  occurredAtIso: string;
}

export interface NormalizedExternalCancellationEvent {
  kind: "cancellation";
  platform: ExternalEventPlatform;
  source: ExternalEventSource;
  eventExternalId: string;
  occurredAtIso: string;
}

export type NormalizedExternalEventWebhook =
  | NormalizedExternalRsvpEvent
  | NormalizedExternalCancellationEvent
  | { kind: "ignored"; platform: ExternalEventPlatform; rawType: string };

export interface PartifulEventKit {
  eventId: string;
  city: CityId;
  platform: "partiful";
  source: "host_native";
  humanAssistedOnly: true;
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  arrivalLandmark: string;
  startIso: string;
  endIso: string;
  timezone: string;
  screeningQuestions: ScreeningQuestionSpec[];
  coverPrompt: string;
  requiredToggles: {
    hideGuestList: true;
    approvalRequired: true;
    publicExplore: true;
  };
  tracking: {
    partifulUrl: string | null;
    status: "awaiting_url" | "active";
    confirmedNetworkTotal: number;
    approvedExternalCount: number;
    approvedExternalCap: number;
    plannedTotal: number;
  };
  scrubbedTerms: string[];
}

export interface PostEventInviteCopyParams {
  attendeeFirstName: string;
  eventTitle: string;
  venueName: string;
  anchorFirstName: string;
  inviteUrl: string;
}

export function externalEventSourceCode(source: ExternalEventSource): number {
  if (source === "host_native") return externalEventSourceHostNative;
  if (source === "official_api") return externalEventSourceOfficialApi;
  if (source === "member_submitted_public") return externalEventSourceMemberSubmittedPublic;
  return 3;
}

export function isSanctionedSource(source: ExternalEventSource): boolean {
  return isSanctionedExternalEventSource(externalEventSourceCode(source));
}

export function computeExternalApprovalCap(
  networkConfirmed: number,
  venueWalkInCapacity: number,
  targetRoomSize: number
): number {
  return computeApprovedExternalCap(networkConfirmed, venueWalkInCapacity, targetRoomSize);
}

export function checkPublishExternalEvent(draft: ExternalEventDraft): {
  allowed: boolean;
  approvedExternalCap: number;
  plannedTotal: number;
} {
  const externalCap = computeApprovedExternalCap(
    draft.confirmedNetworkTotal,
    draft.venueWalkInCapacity,
    draft.targetRoomSize
  );
  const plannedTotal = draft.confirmedNetworkTotal + externalCap;
  const input: PublishExternalEventInput = {
    confirmedNetworkAnchors: draft.confirmedNetworkAnchors,
    reviewApproved: Boolean(draft.reviewApproved ?? draft.humanReviewApproved),
    allParticipantsAdult: draft.allParticipantsAdult,
    isPublicVenue: draft.isPublicVenue,
    sourceSanctioned: isSanctionedExternalEventSource(externalEventSourceCode(draft.source)),
    hideGuestList: draft.hideGuestList,
    approvalRequired: draft.approvalRequired,
    externalCrowdDisclosed: draft.externalCrowdDisclosed,
    plannedTotal,
    venueWalkInCapacity: draft.venueWalkInCapacity,
  };
  return {
    allowed: canPublishExternalEvent(input),
    approvedExternalCap: externalCap,
    plannedTotal,
  };
}

export function checkExternalEventT24Quorum(
  confirmedNetworkAnchors: number,
  confirmedNetworkTotal: number,
  approvedExternalRsvps: number,
  hoursToStart: number
): ExternalQuorumDecision {
  return evaluateExternalEventT24Quorum(
    confirmedNetworkAnchors,
    confirmedNetworkTotal,
    approvedExternalRsvps,
    hoursToStart
  ) as ExternalQuorumDecision;
}

export function checkApproveExternalEventRsvp(input: ApproveExternalEventRsvpInput): boolean {
  return canApproveExternalEventRsvp(input);
}

export function checkInviteExternalEventAttendee(input: InviteExternalEventAttendeeInput): boolean {
  return canInviteExternalEventAttendee(input);
}

export function buildStandardScreeningQuestions(interest: string): ScreeningQuestionSpec[] {
  const cleanInterest = interest.trim() || "this meetup";
  return [
    {
      id: "adult_18_plus",
      label: "Confirming this is an 18+ adult meetup — are you 18 or older?",
      required: true,
      kind: "adult_18_plus",
    },
    {
      id: "interest_detail",
      label: `What are you most into around ${cleanInterest}, or what are you hoping to play/chat about?`,
      required: true,
      kind: "interest_screening",
    },
  ];
}

const TEXT_ENCODER = new TextEncoder();
const MAX_CACHED_HMAC_KEYS = 32;
const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

function getCachedHmacKey(secret: string): Promise<CryptoKey> {
  const cached = hmacKeyCache.get(secret);
  if (cached) return cached;
  if (hmacKeyCache.size >= MAX_CACHED_HMAC_KEYS) {
    const oldest = hmacKeyCache.keys().next().value;
    if (oldest !== undefined) hmacKeyCache.delete(oldest);
  }
  const keyPromise = crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  hmacKeyCache.set(secret, keyPromise);
  return keyPromise;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await getCachedHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, TEXT_ENCODER.encode(message));
  return toHex(sig);
}

const EXTERNAL_INJECTION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "ignore_instructions", re: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts?|rules|directives?)\b/i },
  { label: "system_prompt_exfil", re: /\b(?:system\s+prompt|developer\s+instructions?|reveal\s+(?:all\s+)?(?:(?:member|user|private)\s+){0,2}(?:phone|email|number|data|secret|pii|prompt)s?|dump\s+(?:all\s+)?(?:member|user|database|phone|pii))\b/i },
  { label: "role_override", re: /\b(?:you\s+are\s+now\s+(?:in\s+)?(?:admin|root|unrestricted|developer|dan)|jailbreak|override\s+(?:the\s+)?(?:safety|policy|rules|rubric|guard|filter)|bypass\s+(?:the\s+)?(?:safety|age|review|filter|guard))\b/i },
  { label: "review_manipulation", re: /\b(?:pre-?approved|already\s+approved|auto-?approve|approve\s+this\s+(?:rsvp|event|match|item|packet)|set\s+verdict\s+to\s+approve|output\s+["']?approve["']?)\b/i },
  { label: "delimiter_breakout", re: /<<<\s*(?:end\s+)?untrusted|<\|(?:im_start|im_end|system|assistant)\|>|\{\s*"verdict"\s*:/i },
];

/** Detect prompt-injection / exfiltration directives in untrusted external event or prospect text. */
export function detectExternalPromptInjection(text: string): string | null {
  if (!text || !text.trim()) return null;
  for (const variant of textVariants(text)) {
    for (const rule of EXTERNAL_INJECTION_PATTERNS) {
      if (rule.re.test(variant)) return rule.label;
    }
  }
  return null;
}

/** Wrap untrusted external event fields with a nonced fence before passing to any LLM or reviewer. */
export function fenceExternalEventText(text: string, label = "external_event"): string {
  return fenceUntrusted(text, label);
}

function extractFirstName(rawName: unknown): string {
  if (typeof rawName !== "string") return "";
  const cleaned = rawName.trim();
  if (!cleaned) return "";
  return cleaned.split(/\s+/)[0] ?? "";
}

const MINOR_EXPLICIT_RE =
  /\b(?:not\s+(?:yet\s+)?(?:18|an?\s+adult|of\s+age)|under\s*(?:18|age)|underage|minor|below\s*18|less\s+than\s*18|almost\s*18|nearly\s*18|turning\s*18|turn\s+18|be\s+18\s+(?:soon|next|in\b)|about\s+to\s+(?:be|turn)\s*18|high\s+school|middle\s+school|hs\s+(?:student|junior|senior|freshman|sophomore)|(?:\d{1,2}(?:st|nd|rd|th)|ninth|tenth|eleventh|twelfth)\s+grade)\b/i;
const SPELLED_MINOR_AGE_RE =
  /\b(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\b|(?:^|[\s,.:;-])(?:one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:y(?:ears?|rs?)?[\s-]*old|y\/?o)\b/i;
const FRACTIONAL_MINOR_AGE_RE = /(?:^|[^\d.])(?:1[0-7]|[1-9])\.\d+(?!\d)/;
const NEGATIVE_ANSWER_RE =
  /^(?:no|nope|nah|not\b|false\b|under\b)|\b(?:nope|nah)\b|\bno\b(?!\s+(?:dietary|allerg|problem|worries|issue|issues|restrictions|preference|preferences|limits|thanks|pressure|rush))/i;
const NON_AGE_AFTER_RE =
  /^\s*(?:am\b|pm\b|:\d|\/\d|(?:st|nd|rd|th)\b|min(?:s|utes?)?\b|hr(?:s)?\b|hours?\b|miles?\b|km\b|blocks?\b|dollars?\b|bucks?\b|decks?\b|cards?\b|games?\b|spots?\b|tickets?\b|seats?\b|friends?\b|people\b|persons?\b|players?\b|guests?\b|books?\b|cups?\b|years?\s+(?:ago|in|of)\b)/i;
const NON_AGE_BEFORE_RE =
  /(?:\$|#|@|\b(?:at|around|bringing|have|got|with|for|level|gen|edition|top|plus)\s*)$/i;

/**
 * Fail-closed adult 18+ screening parser backed by policy.ts (`canBeMatched`, `isMinor`,
 * `relayMinorAge`, `relayMinorEstimate`). Rejects minors, fractional/spelled minor ages,
 * negated/turning-18/high-school cues, and prompt injections while accepting `"18+"`/`"21+"`,
 * explicit adult ages (`"I'm 25"`), and benign tails like `"yes, no dietary restrictions"`.
 */
export function parseAdult18PlusAnswer(answer: unknown): boolean {
  if (typeof answer === "boolean") return answer;
  if (typeof answer === "number") return Number.isInteger(answer) && canBeMatched(answer) && !isMinor(answer);
  if (typeof answer !== "string") return false;
  const s = answer.trim().toLowerCase().replace(/[‘’ʼ`´]/g, "'");
  if (!s) return false;
  if (detectExternalPromptInjection(s)) return false;
  if (relayMinorAge(s, true) !== undefined || relayMinorEstimate(s)) return false;
  if (MINOR_EXPLICIT_RE.test(s) || SPELLED_MINOR_AGE_RE.test(s) || FRACTIONAL_MINOR_AGE_RE.test(s)) return false;
  if (NEGATIVE_ANSWER_RE.test(s)) return false;

  for (const match of s.matchAll(/(?<![a-z0-9.])(\d{1,3})(\+?)(?![a-z0-9.])/gi)) {
    const rawNum = Number(match[1]);
    const hasPlus = match[2] === "+";
    if (hasPlus) {
      if (!canBeMatched(rawNum) || isMinor(rawNum)) return false;
      continue;
    }
    const startIdx = match.index ?? 0;
    const endIdx = startIdx + match[0].length;
    const before = s.slice(Math.max(0, startIdx - 20), startIdx);
    const after = s.slice(endIdx, endIdx + 24);
    if (rawNum < 18) {
      if (NON_AGE_AFTER_RE.test(after) || NON_AGE_BEFORE_RE.test(before)) continue;
      return false;
    }
  }

  if (
    /^(?:yes|y|yeah|yep|yup|true|confirmed|adult|over\s*18|over\s*21|older\s+than\s*18|i(?:'m| am)\s+(?:over\s+)?(?:18\+|21\+|an?\s+adult)|yes,?\s*i(?:'m| am)\s+(?:over\s+)?(?:18\+|21\+)|(?:18|21)\+)(?=$|[\s,.:;!?)/-])/i.test(
      s
    )
  ) {
    return true;
  }

  const explicitAge = s.match(
    /(?:^(?:yes|y|yeah|yep|yup)?[\s,.:;-]*(?:i(?:'m| am)|im|age)?[\s:]*|^)(\d{2,3})(?:\s*(?:y(?:ears?|rs?)?[\s-]*old|y\/?o|\+))?(?=$|[\s,.:;!?)/-])/i
  );
  if (explicitAge) {
    const n = Number(explicitAge[1]);
    return canBeMatched(n) && !isMinor(n);
  }
  return false;
}

export function buildLumaCreateEventRequest(
  draft: ExternalEventDraft,
  apiKey: string
): { ok: true; request: HttpRequestSpec; approvedExternalCap: number; plannedTotal: number } | { ok: false; reason: string } {
  if (!apiKey.trim()) return { ok: false, reason: "missing_luma_api_key" };
  if (detectExternalPromptInjection(draft.title) || detectExternalPromptInjection(draft.description)) {
    return { ok: false, reason: "prompt_injection_detected" };
  }
  const gate = checkPublishExternalEvent(draft);
  if (!gate.allowed) return { ok: false, reason: "publish_gate_rejected" };
  const questions = buildStandardScreeningQuestions(draft.interest);
  const fullDescription = [
    draft.description.trim(),
    "",
    `Hosted by ${draft.anchorFirstName} via Friends / The Network.`,
    `Where to find us: ${draft.arrivalLandmark}. Everyone orders and pays their own tab at the counter.`,
  ].join("\n");

  return {
    ok: true,
    approvedExternalCap: gate.approvedExternalCap,
    plannedTotal: gate.plannedTotal,
    request: {
      url: `${LUMA_API_BASE}/v1/events/create`,
      method: "POST",
      headers: {
        "x-luma-api-key": apiKey,
        "content-type": "application/json",
      },
      body: {
        name: draft.title,
        start_at: draft.startIso,
        end_at: draft.endIso,
        timezone: draft.timezone,
        description_md: fullDescription,
        geo_address_json: {
          address: draft.venueAddress,
          description: `${draft.venueName} — ${draft.venueAddress}`,
        },
        require_rsvp_approval: true,
        show_guest_list: false,
        capacity: gate.plannedTotal,
        registration_questions: questions.map(q => ({
          id: q.id,
          label: q.label,
          required: q.required,
          question_type: "text",
        })),
      },
    },
  };
}

export function buildLumaUpdateGuestStatusRequest(
  eventApiId: string,
  guestApiId: string,
  status: ExternalRsvpStatus,
  apiKey: string
): HttpRequestSpec {
  return {
    url: `${LUMA_API_BASE}/v1/events/guests/update-status`,
    method: "POST",
    headers: {
      "x-luma-api-key": apiKey,
      "content-type": "application/json",
    },
    body: {
      event_api_id: eventApiId,
      guest_api_id: guestApiId,
      approval_status: status,
    },
  };
}

export interface VerifyLumaWebhookOptions {
  timestampHeader?: string | number | null;
  nowMs?: number;
  maxSkewMs?: number;
}

function parseWebhookTimestampMs(raw: string | number): number | undefined {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return undefined;
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function verifyLumaWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
  opts?: VerifyLumaWebhookOptions
): Promise<boolean> {
  if (!webhookSecret || !signatureHeader) return false;
  if (opts?.timestampHeader !== undefined) {
    if (opts.timestampHeader === null || opts.nowMs === undefined || !Number.isFinite(opts.nowMs)) return false;
    const tsMs = parseWebhookTimestampMs(opts.timestampHeader);
    if (tsMs === undefined) return false;
    const maxSkew = opts.maxSkewMs ?? 5 * 60_000;
    if (Math.abs(opts.nowMs - tsMs) > maxSkew) return false;
  }
  const cleaned = signatureHeader.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleaned)) return false;
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return constantTimeEqual(expected, cleaned);
}

function mapLumaApprovalStatus(raw: unknown): ExternalRsvpStatus {
  if (raw === "approved") return "approved";
  if (raw === "waitlist") return "waitlist";
  if (raw === "declined" || raw === "rejected") return "declined";
  return "pending_approval";
}

export function normalizeLumaWebhookEvent(
  payload: Record<string, unknown>,
  fallbackIso = ""
): NormalizedExternalEventWebhook {
  const type = typeof payload.type === "string" ? payload.type : "";
  const data = (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>;
  const occurredAtIso =
    typeof payload.created_at === "string"
      ? payload.created_at
      : typeof data.updated_at === "string"
        ? data.updated_at
        : fallbackIso;

  if (type === "event.cancellation") {
    const eventExternalId = String(data.event_api_id ?? data.api_id ?? "");
    return {
      kind: "cancellation",
      platform: "luma",
      source: "official_api",
      eventExternalId,
      occurredAtIso,
    };
  }

  if (type === "guest.registered" || type === "guest.updated") {
    const eventExternalId = String(data.event_api_id ?? "");
    const guestExternalId = String(data.api_id ?? data.guest_api_id ?? "");
    const answers = Array.isArray(data.registration_answers)
      ? (data.registration_answers as Array<Record<string, unknown>>)
      : [];

    let confirmedAdult18Plus = false;
    let interestAnswer = "";
    let injectionDetected = false;
    for (const a of answers) {
      const label = String(a.label ?? a.question_id ?? "").toLowerCase();
      const value = a.answer ?? a.value;
      if (typeof value === "string" && detectExternalPromptInjection(value)) {
        injectionDetected = true;
      }
      if (label.includes("18+") || label.includes("18 or older") || label.includes("adult_18_plus")) {
        confirmedAdult18Plus = parseAdult18PlusAnswer(value);
      } else if (typeof value === "string" && value.trim().length > 0) {
        interestAnswer = value.trim().slice(0, 240);
      }
    }

    const safeAnswer = interestAnswer || undefined;
    return {
      kind: "rsvp",
      platform: "luma",
      source: "official_api",
      eventExternalId,
      guestExternalId,
      firstName: extractFirstName(data.user_first_name ?? data.name),
      status: mapLumaApprovalStatus(data.approval_status),
      confirmedAdult18Plus: !injectionDetected && confirmedAdult18Plus,
      answeredScreeningQuestion: !injectionDetected && confirmedAdult18Plus && interestAnswer.length >= 2,
      screeningAnswerText: safeAnswer,
      fencedScreeningAnswer: safeAnswer ? fenceExternalEventText(safeAnswer, "luma_screening_answer") : undefined,
      ...(injectionDetected ? { injectionDetected: true } : {}),
      occurredAtIso,
    };
  }

  return { kind: "ignored", platform: "luma", rawType: type };
}

const MEETUP_CREATE_EVENT_MUTATION = `mutation CreateImpromptuEvent($input: CreateEventInput!) {
  createEvent(input: $input) {
    event {
      id
      title
      eventUrl
      status
      maxTickets
    }
    errors {
      code
      message
      field
    }
  }
}`;

const MEETUP_POLL_RSVPS_QUERY = `query PollEventRsvps($eventId: ID!) {
  event(id: $eventId) {
    id
    status
    rsvps(first: 50) {
      edges {
        node {
          id
          status
          updated
          member {
            id
            name
          }
          rsvpQuestionAnswer {
            answer
          }
        }
      }
    }
  }
}`;

function isoDurationMinutes(startIso: string, endIso: string): string {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  const mins = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? Math.max(60, Math.min(360, Math.round((endMs - startMs) / 60_000)))
    : 120;
  return `PT${mins}M`;
}

export function buildMeetupCreateEventRequest(
  draft: ExternalEventDraft,
  groupUrlname: string,
  oauthAccessToken: string,
  venueId?: string
): { ok: true; request: HttpRequestSpec; approvedExternalCap: number; plannedTotal: number } | { ok: false; reason: string } {
  if (!oauthAccessToken.trim() || !groupUrlname.trim()) {
    return { ok: false, reason: "missing_meetup_credentials" };
  }
  if (detectExternalPromptInjection(draft.title) || detectExternalPromptInjection(draft.description)) {
    return { ok: false, reason: "prompt_injection_detected" };
  }
  const gate = checkPublishExternalEvent(draft);
  if (!gate.allowed) return { ok: false, reason: "publish_gate_rejected" };
  const questions = buildStandardScreeningQuestions(draft.interest);
  const combinedQuestion = `${questions[0]!.label} Also: ${questions[1]!.label}`;
  const fullDescription = [
    draft.description.trim(),
    "",
    `Venue: ${draft.venueName} (${draft.venueAddress}).`,
    `How to find us: ${draft.arrivalLandmark}. Order your own food/drink at the counter.`,
    `Hosted by ${draft.anchorFirstName} via Friends / The Network (18+ adults only).`,
  ].join("\n");

  const input: Record<string, unknown> = {
    groupUrlname,
    title: draft.title,
    description: fullDescription,
    startDateTime: draft.startIso,
    duration: isoDurationMinutes(draft.startIso, draft.endIso),
    publishStatus: "PUBLISHED",
    question: combinedQuestion,
    howToFindUs: draft.arrivalLandmark,
    rsvpSettings: {
      rsvpLimit: gate.plannedTotal,
      guestLimit: 0,
    },
  };
  if (venueId) input.venueId = venueId;

  return {
    ok: true,
    approvedExternalCap: gate.approvedExternalCap,
    plannedTotal: gate.plannedTotal,
    request: {
      url: MEETUP_GRAPHQL_ENDPOINT,
      method: "POST",
      headers: {
        authorization: `Bearer ${oauthAccessToken}`,
        "content-type": "application/json",
      },
      body: {
        query: MEETUP_CREATE_EVENT_MUTATION,
        variables: { input },
      },
    },
  };
}

export function buildMeetupPollRsvpsRequest(eventId: string, oauthAccessToken: string): HttpRequestSpec {
  return {
    url: MEETUP_GRAPHQL_ENDPOINT,
    method: "POST",
    headers: {
      authorization: `Bearer ${oauthAccessToken}`,
      "content-type": "application/json",
    },
    body: {
      query: MEETUP_POLL_RSVPS_QUERY,
      variables: { eventId },
    },
  };
}

function mapMeetupRsvpStatus(raw: unknown): ExternalRsvpStatus {
  if (raw === "YES" || raw === "ATTENDING") return "approved";
  if (raw === "WAITLIST") return "waitlist";
  if (raw === "NO" || raw === "NOT_ATTENDING") return "declined";
  return "pending_approval";
}

export function normalizeMeetupRsvpPoll(
  responseData: Record<string, unknown>,
  fallbackIso = ""
): { eventExternalId: string; cancelled: boolean; rsvps: NormalizedExternalRsvpEvent[] } {
  const data = (responseData.data && typeof responseData.data === "object"
    ? responseData.data
    : responseData) as Record<string, unknown>;
  const event = (data.event && typeof data.event === "object" ? data.event : {}) as Record<string, unknown>;
  const eventExternalId = String(event.id ?? "");
  const cancelled = String(event.status ?? "").toUpperCase() === "CANCELLED";
  const rsvpsObj = (event.rsvps && typeof event.rsvps === "object" ? event.rsvps : {}) as Record<string, unknown>;
  const edges = Array.isArray(rsvpsObj.edges) ? (rsvpsObj.edges as Array<Record<string, unknown>>) : [];

  const rsvps: NormalizedExternalRsvpEvent[] = [];
  for (const edge of edges) {
    const node = (edge.node && typeof edge.node === "object" ? edge.node : {}) as Record<string, unknown>;
    const member = (node.member && typeof node.member === "object" ? node.member : {}) as Record<string, unknown>;
    const qObj = (node.rsvpQuestionAnswer && typeof node.rsvpQuestionAnswer === "object"
      ? node.rsvpQuestionAnswer
      : {}) as Record<string, unknown>;
    const rawAnswer = typeof qObj.answer === "string" ? qObj.answer.trim() : "";
    const injectionDetected = detectExternalPromptInjection(rawAnswer) !== null;
    const confirmedAdult18Plus = !injectionDetected && parseAdult18PlusAnswer(rawAnswer);
    const hasHobbyDetail =
      rawAnswer
        .replace(
          /^(?:(?:yes|y|yeah|yep|yup|i(?:'m| am)\s+)(?:[\s,.:;-]+)?)?(?:18\+|21\+|\d{2,3}\s*(?:y(?:ears?|rs?)?[\s-]*old|y\/?o)?|yes|y|yeah|yep|yup)(?=$|[\s,.:;!?)/-])[\s,.:;!?)/-]*/i,
          ""
        )
        .trim().length >= 3;
    const safeAnswer = rawAnswer ? rawAnswer.slice(0, 240) : undefined;

    rsvps.push({
      kind: "rsvp",
      platform: "meetup",
      source: "official_api",
      eventExternalId,
      guestExternalId: String(member.id ?? node.id ?? ""),
      firstName: extractFirstName(member.name),
      status: mapMeetupRsvpStatus(node.status),
      confirmedAdult18Plus,
      answeredScreeningQuestion: !injectionDetected && confirmedAdult18Plus && hasHobbyDetail,
      screeningAnswerText: safeAnswer,
      fencedScreeningAnswer: safeAnswer ? fenceExternalEventText(safeAnswer, "meetup_screening_answer") : undefined,
      ...(injectionDetected ? { injectionDetected: true } : {}),
      occurredAtIso: typeof node.updated === "string" ? node.updated : fallbackIso,
    });
  }

  return { eventExternalId, cancelled, rsvps };
}

const PARTIFUL_TELECOM_REWRITES: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /\bbar\s*crawl\b/gi, replacement: "neighborhood walk", label: "bar crawl" },
  { pattern: /\bpub\s*crawl\b/gi, replacement: "neighborhood walk", label: "pub crawl" },
  { pattern: /\bhappy\s*hour\b/gi, replacement: "evening hangout", label: "happy hour" },
  { pattern: /\bopen\s*bar\b/gi, replacement: "social hangout", label: "open bar" },
  { pattern: /\bcocktail\s*lounge\b/gi, replacement: "evening lounge", label: "cocktail lounge" },
  { pattern: /\bwine\s*bar\b/gi, replacement: "cozy cafe", label: "wine bar" },
  { pattern: /\bbeer\s*(?:hall|garden)\b/gi, replacement: "communal patio", label: "beer hall" },
  { pattern: /\b(?:brewery|breweries|taproom|taprooms)\b/gi, replacement: "neighborhood hangout", label: "brewery/taproom" },
  { pattern: /\b(?:cocktails?|mocktails?\s+and\s+cocktails?)\b/gi, replacement: "bites and refreshments", label: "cocktail" },
  { pattern: /\b(?:alcohol|booze|boozy|liquor|spirits|tequila|whiskey|vodka|bourbon|gin|rum|shots|drunk|drinks|beer|wine)\b/gi, replacement: "refreshments", label: "alcohol" },
  { pattern: /\b(?:cannabis|marijuana|weed|dispensary|edibles|thc|cbd|420|smoke\s*sesh|vape|vaping)\b/gi, replacement: "hangout", label: "cannabis" },
  { pattern: /\b(?:gambling|casino|sportsbook|betting|wager|poker|blackjack|roulette|slots)\b/gi, replacement: "tabletop games", label: "gambling" },
  { pattern: /\b(?:strip\s*club|lingerie|nsfw|xxx|hookup|hookups|fetish|bdsm|adult[\s-]*only)\b/gi, replacement: "18+ social", label: "adult_content" },
];

const PARTIFUL_LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  "$": "s",
  "!": "i",
  "|": "l",
};

const INNOCENT_ALNUM_TOKEN_RE = /^(?:\d+(?:am|pm|h|hr|hrs|min|st|nd|rd|th|yo|k|m|x)|[a-z]+\d{1,2}|\d{1,2}[a-z])$/i;

function decodeTelecomLeetTokens(text: string): string {
  return text.replace(/[a-zA-Z0-9@$!|]{3,}/g, rawToken => {
    const trailingMatch = rawToken.match(/[!|]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const token = trailing ? rawToken.slice(0, -trailing.length) : rawToken;
    if (token.length < 3 || !/[a-zA-Z]/.test(token) || !/[0134578@$!|]/.test(token)) return rawToken;
    if (INNOCENT_ALNUM_TOKEN_RE.test(token)) return rawToken;
    const decoded = token.replace(/[0134578@$!|]/g, ch => PARTIFUL_LEET_MAP[ch] ?? ch);
    for (const rule of PARTIFUL_TELECOM_REWRITES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(decoded)) {
        rule.pattern.lastIndex = 0;
        return `${decoded}${trailing}`;
      }
    }
    return rawToken;
  });
}

export function scrubPartifulTelecomCopy(text: string): { text: string; scrubbedTerms: string[] } {
  let out = decodeTelecomLeetTokens(text);
  const scrubbed: string[] = [];
  for (const rule of PARTIFUL_TELECOM_REWRITES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(out)) {
      rule.pattern.lastIndex = 0;
      scrubbed.push(rule.label);
      out = out.replace(rule.pattern, rule.replacement);
    }
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  return { text: out, scrubbedTerms: scrubbed };
}

export function buildPartifulEventKit(
  draft: ExternalEventDraft
): { ok: true; kit: PartifulEventKit } | { ok: false; reason: string } {
  if (detectExternalPromptInjection(draft.title) || detectExternalPromptInjection(draft.description)) {
    return { ok: false, reason: "prompt_injection_detected" };
  }
  const gate = checkPublishExternalEvent({
    ...draft,
    platform: "partiful",
    source: "host_native",
  });
  if (!gate.allowed) return { ok: false, reason: "publish_gate_rejected" };

  const titleScrub = scrubPartifulTelecomCopy(draft.title);
  const bodyScrub = scrubPartifulTelecomCopy(draft.description.trim());
  const fullDescription = [
    bodyScrub.text,
    `Meet at ${draft.venueName} (${draft.venueAddress}) — ${draft.arrivalLandmark}.`,
    `Order your own snacks/coffee at the counter. Hosted by ${draft.anchorFirstName} via Friends / The Network (18+).`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const coverPrompt =
    draft.coverPrompt?.trim() ||
    `Warm candid square editorial photo of a cozy ${draft.interest} neighborhood hangout in ${draft.city.toUpperCase()}, inviting lighting, no text overlay`;

  return {
    ok: true,
    kit: {
      eventId: draft.id,
      city: draft.city,
      platform: "partiful",
      source: "host_native",
      humanAssistedOnly: true,
      title: titleScrub.text,
      description: fullDescription,
      venueName: draft.venueName,
      venueAddress: draft.venueAddress,
      arrivalLandmark: draft.arrivalLandmark,
      startIso: draft.startIso,
      endIso: draft.endIso,
      timezone: draft.timezone,
      screeningQuestions: buildStandardScreeningQuestions(draft.interest),
      coverPrompt,
      requiredToggles: {
        hideGuestList: true,
        approvalRequired: true,
        publicExplore: true,
      },
      tracking: {
        partifulUrl: null,
        status: "awaiting_url",
        confirmedNetworkTotal: draft.confirmedNetworkTotal,
        approvedExternalCount: 0,
        approvedExternalCap: gate.approvedExternalCap,
        plannedTotal: gate.plannedTotal,
      },
      scrubbedTerms: [...new Set([...titleScrub.scrubbedTerms, ...bodyScrub.scrubbedTerms])],
    },
  };
}

export function attachPartifulUrl(
  kit: PartifulEventKit,
  partifulUrl: string
): { ok: true; kit: PartifulEventKit } | { ok: false; reason: string } {
  const trimmed = partifulUrl.trim();
  if (!/^https:\/\/(?:www\.)?partiful\.com\/e\/[A-Za-z0-9_-]{4,}$/.test(trimmed)) {
    return { ok: false, reason: "invalid_partiful_url" };
  }
  return {
    ok: true,
    kit: {
      ...kit,
      tracking: {
        ...kit.tracking,
        partifulUrl: trimmed,
        status: "active",
      },
    },
  };
}

export function buildCrowdExpectationCopy(
  mode: ExternalCrowdMode,
  params: { interest?: string; cityName?: string; platforms?: string } = {}
): string {
  if (mode === "dense_curated") {
    return formatCrowdExpectation("network_curated");
  }
  return formatCrowdExpectation("external_open", {
    interest: params.interest,
    cityName: params.cityName,
    platforms: params.platforms,
    sparseAnchor: mode === "sparse_anchor",
  });
}

export function buildPostEventExternalInviteMessage(
  gateInput: InviteExternalEventAttendeeInput,
  params: PostEventInviteCopyParams
): { ok: true; text: string } | { ok: false; reason: string } {
  if (!canInviteExternalEventAttendee(gateInput)) {
    return { ok: false, reason: "quality_gate_failed" };
  }
  const firstName = cleanPhrase(extractFirstName(params.attendeeFirstName)) || "there";
  const anchorName = cleanPhrase(extractFirstName(params.anchorFirstName)) || "Our host";
  const title = cleanPhrase(params.eventTitle).slice(0, 60);
  const venue = cleanPhrase(params.venueName).slice(0, 50);
  const url = params.inviteUrl.trim();
  const full = `Hey ${firstName}, thanks for coming to ${title} at ${venue}! ${anchorName} said you brought great energy. We run small local hangouts through The Network — if you'd like an invite for future ones, here's your link: ${url}. No pressure either way.`;
  const compact = `Hey ${firstName}, thanks for coming! ${anchorName} said you brought great energy. Here's your invite link for future small local hangouts: ${url}. No pressure either way.`;
  const text = clampSms(full, compact);
  const violations = validateOutboundSms(text, { contactAllow: url ? [url] : undefined });
  if (violations.length > 0) {
    return { ok: false, reason: `style_violation:${violations.join(",")}` };
  }
  return { ok: true, text };
}
