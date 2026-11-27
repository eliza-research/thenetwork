// The tools. app_info and start_signup need no sign-in and return public facts only.
// check_status and get_updates need membership:read and return only the signed-in person's own state
// or updates in the one app the client is bound to. No tool takes a phone number, a code or an age, and every
// input schema refuses properties it does not list. prepare_signup alone takes approved Join name/home city.
import {
  initial as initialDraftPreparation, signupDraftDeadline, signupDraftLifetimeMs,
  signupDraftRequestAllowed, step as stepDraftPreparation,
} from "../../core/src/generated/mcpSignupDraft.ts";
import {
  type Connection, type GrantOwnerDecision, type MemberStatus, type NextStep, type Scope as ConnectorScope, type ToolName as ConnectorTool,
  callLookingForTool, callPhotoTool, canCallCheckStatus, canCallGetUpdates, canCallLookingForTool, canCallPhotoTool, canCallPrepareSignup, canCallPublicTool, canCallReadProfile, canCallSubmitProfile, grantCovers,
  decideGrantOwner, initial as connectionInitial, nextStepFor, resultShowsLookingFor, scopeFor, signInSite, toolAllowedFor, toolListed,
} from "../../core/src/generated/connectorTools.ts";
import { publicSignupUsesBrowser } from "../../core/src/generated/siteEnrollment.ts";
import { minorNoticeFor, type MinorNotice } from "../../core/src/generated/textEnrollment.ts";
import { photoSlotsMax } from "../../core/src/generated/photoRelayItem.ts";
import { profileSubmissionAccepted } from "../../core/src/generated/mcpProfileSubmission.ts";
import { appsOn, connectorApp, connectorSurface, DATING_AGE_RULE, type McpApp, type McpAppId, type Surface, WORK_AGE_RULE } from "./apps.ts";
import type { AssistantKind, LeakContext, LookingForEntry, LookingForResult, LookingForView, PhotoHoldingsView, PhotoRequestStatus, PlatformHooks, PublicStatus, PublicUpdate, SavedProfileFields } from "./hooks.ts";
import type { Grant, Scope, OAuthStore, SignupDraftFields } from "./store.ts";
import { CONTACT_PATTERNS, contactVariants } from "../../core/src/guard.ts";
import { isCity, LAUNCH_CITIES } from "../../core/src/types.ts";
import { outputLeaks, passesOutputGate } from "./leaks.ts";

export const TOOL_NAMES = ["app_info", "start_signup", "check_status", "read_profile", "submit_profile", "get_updates", "prepare_signup",
  "list_looking_for", "pause_looking_for", "resume_looking_for", "my_photos", "photo_request"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const connectorTool: Record<ToolName, ConnectorTool> = {
  app_info: "AppInfoTool", start_signup: "StartSignupTool", check_status: "CheckStatusTool",
  read_profile: "ReadProfileTool", submit_profile: "SubmitProfileTool", get_updates: "GetUpdatesTool",
  prepare_signup: "PrepareSignupTool", list_looking_for: "ListLookingForTool", pause_looking_for: "PauseLookingForTool",
  resume_looking_for: "ResumeLookingForTool", my_photos: "MyPhotosTool", photo_request: "PhotoRequestTool",
};
const oauthScope: Record<ConnectorScope, Scope | null> = { NoScope: null, MembershipRead: "membership:read", ProfileWrite: "profile:write", ProfileRead: "profile:read", PhotosUse: "photos:use" };
/** The OAuth scope that each tool needs, from the generated `scopeFor` (spec/connectorTools.md, "Public tools need no sign-in"). */
export const TOOL_SCOPE = Object.fromEntries(TOOL_NAMES.map(t => [t, oauthScope[scopeFor(connectorTool[t])]])) as Record<ToolName, Scope | null>;

export const tokenCovers = (tool: ToolName, scopes: readonly Scope[]): boolean =>
  grantCovers(connectorTool[tool], scopes.includes("membership:read"), scopes.includes("profile:write"), scopes.includes("profile:read"), scopes.includes("photos:use"));

export function connectionOf(host: McpApp, surface: Surface, scopes: readonly Scope[] | null, sentToday = 0): Connection {
  return {
    ...connectionInitial, phase: scopes ? "Connected" : "Anonymous", host: connectorApp[host.id], surface: connectorSurface[surface],
    hasWrite: !!scopes?.includes("profile:write"), hasProfileRead: !!scopes?.includes("profile:read"), hasPhotos: !!scopes?.includes("photos:use"),
    profileApproved: true, profileSent: false, sentToday,
  };
}

export function canCallTool(c: Connection, tool: ToolName): boolean {
  switch (tool) {
    case "app_info": case "start_signup": return canCallPublicTool(c, connectorTool[tool]);
    case "check_status": return canCallCheckStatus(c);
    case "read_profile": return canCallReadProfile(c);
    case "get_updates": return canCallGetUpdates(c);
    case "submit_profile": return canCallSubmitProfile(c);
    case "prepare_signup": return canCallPrepareSignup(c);
    case "list_looking_for": case "pause_looking_for": case "resume_looking_for": return canCallLookingForTool(c, connectorTool[tool]);
    case "my_photos": case "photo_request": return canCallPhotoTool(c, connectorTool[tool]);
  }
}

const STANDING_REF = /^INT-[A-P]{12}$/;
export const STANDING_INPUT_REF = /^(?:INT-[A-P]{12}|I-[A-F0-9]{12})$/;

/** An update reference from a Network text (packages/notify task tokens): a pointer, never a credential. */
export const UPDATE_TOKEN = /^T-[2-9A-HJKMNP-TV-Z]{6}$/;
/** The longest profile text the assistant may submit (a few short paragraphs). */
export const PROFILE_MAX_CHARS = 1200;

/** Server instructions. Compact <= 500 chars so OpenAI's 512-char cutoff never truncates rules. */
export const INSTRUCTIONS =
  "Apps powered by The Network. Never ask for, accept or relay a phone number or a verification code. " +
  "Signup and consent happen in the browser. Never message others or expose other people or apps. " +
  "Public: app_info, start_signup. Signed-in (this app only): check_status, read_profile (when asked), " +
  "submit_profile (approved words, additive), get_updates (marks seen), prepare_signup (approved name/city; " +
  "person types birthday and ticks the text consent in the browser), list/pause/resume_looking_for.";

const PHOTO_INSTRUCTIONS =
  "On slop.date, my_photos lists metadata only; photo_request passes their words (confirm on phone).";

export function toolInstructions(apps: Record<McpAppId, McpApp>, surface: Surface, host: McpApp, site: McpApp = host): string {
  return toolDefs(apps, surface, host, site).some(tool => tool.name === "my_photos") ? `${INSTRUCTIONS} ${PHOTO_INSTRUCTIONS}` : INSTRUCTIONS;
}

const annotations = (title: string) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export function toolDefs(apps: Record<McpAppId, McpApp>, surface: Surface, host: McpApp, site: McpApp) {
  const ids = appsOn(apps, surface, host.id).map(a => a.id);
  const signInApp = signInSite(connectorApp[site.id], connectorApp[host.id]);
  const signIn = Object.values(apps).find(a => connectorApp[a.id] === signInApp) ?? site;
  const appProp = (description?: string) => (description ? { type: "string", enum: ids, description } : { type: "string", enum: ids });
  const ownAppInput = { type: "string", enum: [host.id] };
  // The security scheme of each tool, from its generated scope (spec/connectorTools.md, "Public tools need no sign-in").
  const schemes = (tool: ToolName) => {
    const scope = TOOL_SCOPE[tool];
    const list = scope ? [{ type: "oauth2", scopes: [scope] }] : [{ type: "noauth" }];
    return surface === "openai" ? { securitySchemes: list, _meta: { securitySchemes: list } } : { securitySchemes: list };
  };
  const text = { type: "string" };
  const nullableText = { type: ["string", "null"] };
  const obj = { type: "object" };
  const arrObj = { type: "array", items: obj };
  const arr = { type: "array" };
  const bool = { type: "boolean" };
  const object = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
    ({ type: "object", properties, required, additionalProperties: false });
  const appId = { enum: ids };
  const ownApp = { const: host.id };
  const joinMode = { enum: ["invite", "open", "waitlist"] };
  const status = { enum: Object.keys(memberStatus) };
  const publicApp = object({
    id: appId, name: text, site: text, what: text, powered_by: text,
    cities: arr, consent: obj, join: obj, ages: obj,
    adults_only: arr, stop: text, consent_rules: arr, links: obj,
  });
  const lookingForSchema = {
    type: "object",
    properties: { ref: text, status: { enum: ["active", "paused", "waiting_on_you", "open"] } },
    required: ["ref", "status"],
  };
  const lookingForInput = {
    type: "object",
    properties: { app: ownAppInput, ref: { type: "string", pattern: STANDING_INPUT_REF.source } },
    required: ["ref"], additionalProperties: false,
  };
  const lookingForChangeOutput = object({
    app: ownApp, changed: bool, item: { anyOf: [{ type: "null" }, obj] },
    reason: { enum: [null, "unknown_ref", "daily_limit", "closed", "posting", "adults_only", "texts_off", "not_member"] }, next_step: text,
  });
  const updateItem = { type: "object", properties: { summary: text, at: text, kind: text }, required: ["summary", "at", "kind"] };
  const changeAnnotations = (title: string) => ({ title, readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  return [
    {
      name: "app_info",
      description: "Public facts, cities, ages, consent and links.",
      inputSchema: { type: "object", properties: { app: appProp() }, additionalProperties: false },
      outputSchema: {
        type: "object",
        $defs: { a: publicApp },
        anyOf: [{ $ref: "#/$defs/a" }, object({ apps: { type: "array", items: { $ref: "#/$defs/a" } } })],
      },
      annotations: annotations("App info"),
      ...schemes("app_info"),
    },
    {
      name: "start_signup",
      description: "Public signup info, URL and keyword.",
      inputSchema: { type: "object", properties: { app: appProp() }, required: ["app"], additionalProperties: false },
      outputSchema: object({ app: appId, join_mode: joinMode, url: text, keyword: nullableText, instructions_for_person: text, ages: obj }),
      annotations: annotations("Signup"),
      ...schemes("start_signup"),
    },
    {
      name: "prepare_signup",
      description: `After allows access on ${signIn.domain}, saves firstName/homeCity 10m; person types birthday and ticks the text consent in browser.`,
      inputSchema: { type: "object", properties: { app: ownAppInput, firstName: { type: "string", minLength: 1, maxLength: 50 }, homeCity: { type: "string", enum: [...LAUNCH_CITIES] } }, required: ["firstName"], additionalProperties: false },
      outputSchema: object({ prepared: { type: "boolean", const: true }, app: ownApp, next_step: text }),
      annotations: { title: "Draft", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      ...schemes("prepare_signup"),
    },
    {
      name: "check_status",
      description: `After allows access on ${signIn.domain}, returns ${host.name} status.`,
      inputSchema: { type: "object", properties: { app: ownAppInput }, additionalProperties: false },
      outputSchema: object({ app: ownApp, status, next_step: text, manage_url: text }),
      annotations: annotations("Status"),
      ...schemes("check_status"),
    },
    {
      name: "read_profile",
      description: `Read saved ${host.name} profile and red lines when asked.`,
      inputSchema: { type: "object", properties: { app: ownAppInput }, additionalProperties: false },
      outputSchema: object({ app: ownApp, profile: { anyOf: [{ type: "null" }, obj] } }),
      annotations: annotations("Profile"),
      ...schemes("read_profile"),
    },
    {
      name: "submit_profile",
      description: `Send approved ${host.name} profile (interests, availability, dietary/sober/allergy/accessibility/sensory red lines). Additive.`,
      inputSchema: {
        type: "object",
        properties: {
          app: ownAppInput,
          about: { type: "string", minLength: 10, maxLength: PROFILE_MAX_CHARS, description: "Approved prose incl. dietary/sober/allergy/accessibility/sensory red lines." },
        },
        required: ["about"], additionalProperties: false,
      },
      outputSchema: object({
        app: ownApp, submitted: bool, status, looking_for: arrObj, check_with_person: arrObj, next_step: text, next_question: text,
      }, ["app", "submitted", "next_step"]),
      annotations: { title: "Submit", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      ...schemes("submit_profile"),
    },
    {
      name: "list_looking_for",
      description: `List active, paused and recent ${host.name} searches.`,
      inputSchema: { type: "object", properties: { app: ownAppInput }, additionalProperties: false },
      outputSchema: object({
        app: ownApp, looking_for: { type: "array", items: lookingForSchema }, closed_recently: arrObj, next_step: text,
      }),
      annotations: annotations("Searches"),
      ...schemes("list_looking_for"),
    },
    {
      name: "pause_looking_for",
      description: `Pause one ${host.name} ref after asked (SMS UNDO).`,
      inputSchema: lookingForInput,
      outputSchema: lookingForChangeOutput,
      annotations: changeAnnotations("Pause"),
      ...schemes("pause_looking_for"),
    },
    {
      name: "resume_looking_for",
      description: `Resume one paused ${host.name} ref after asked.`,
      inputSchema: lookingForInput,
      outputSchema: lookingForChangeOutput,
      annotations: changeAnnotations("Resume"),
      ...schemes("resume_looking_for"),
    },
    {
      name: "my_photos",
      description: `List ${host.name} photo metadata (no images/links).`,
      inputSchema: { type: "object", properties: { app: ownAppInput }, additionalProperties: false },
      outputSchema: object({ app: ownApp, text, photos: arrObj }),
      annotations: annotations("Photos"),
      ...schemes("my_photos"),
    },
    {
      name: "photo_request",
      description: `Pass words to send/name/take back a ${host.name} photo (SMS confirm).`,
      inputSchema: {
        type: "object",
        properties: {
          app: ownAppInput,
          words: { type: "string", minLength: 1, maxLength: PHOTO_WORDS_MAX },
        },
        required: ["words"], additionalProperties: false,
      },
      outputSchema: object({ app: ownApp, status: { enum: Object.keys(PHOTO_REQUEST_TEXT) }, text }),
      annotations: { title: "Photo", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      ...schemes("photo_request"),
    },
    {
      name: "get_updates",
      description: `After allows access on ${signIn.domain}, returns unseen ${host.name} updates and marks seen.`,
      inputSchema: {
        type: "object",
        properties: {
          app: ownAppInput,
          update_token: { type: "string", pattern: UPDATE_TOKEN.source },
        },
        additionalProperties: false,
      },
      outputSchema: object({ app: ownApp, updates: { type: "array", items: updateItem }, next_step: text }),
      // Reading marks items seen and every call updates the assistant's last-used time.
      annotations: { title: "Updates", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      ...schemes("get_updates"),
    },
  ].filter(t => toolListed(connectorApp[host.id], connectorSurface[surface], connectorTool[t.name as ToolName]));
}

type ToolResponse =
  | { kind: "ok"; data: Record<string, unknown> | Record<string, unknown>[] | { apps: unknown[] } }
  | { kind: "error"; message: string }
  /** The grant no longer matches the person who owns the phone: answer 401 like an invalid token. */
  | GrantRefusal;
export type ToolOutcome = ToolResponse | { kind: "profile_refusal"; read: () => Promise<ToolResponse> };

type GrantRefusal = { kind: "invalid_grant" } | { kind: "grant_held" } | { kind: "grant_unavailable" };

const NOT_AVAILABLE = "That app is not available here.";

const PHONE_PATTERNS = CONTACT_PATTERNS.filter(p => p.name === "phone");
const EMAIL_PATTERNS = CONTACT_PATTERNS.filter(p => p.name === "email" || p.name === "email_spelled");
const EMAIL_CUE = /[@＠﹫]|[\[\(\{<]\s*(?:at|\.)\s*[\]\)\}>]|(?:^|[\s_\[\(\{<])(?:dot|punto)(?:$|[\s_\]\)\}>])/i;
const SPELLED_CODE = /(?:\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b[\s.,/\-_]*){4,}/i;

function digitFold(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/\p{Nd}/gu, c => {
      if (c >= "0" && c <= "9") return c;
      const cp = c.codePointAt(0)!;
      let zero = cp;
      while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1)) && cp - zero < 9) zero--;
      return String((cp - zero) % 10);
    })
    .replace(/⃣/g, "")
    .replace(/[\u00b7\u2022\u2027\u2219\u22c5\u30fb\u3002]/g, ".");
}

function hasPattern(text: string, patterns: readonly { re: RegExp }[]): boolean {
  for (const { re } of patterns) {
    re.lastIndex = 0;
    const hit = re.test(text);
    re.lastIndex = 0;
    if (hit) return true;
  }
  return false;
}

/** Validate the arguments against the tool's schema: only listed properties, enum values only. */
/**
 * A phone number, an email address or a verification code in the profile text: refused, never stored.
 * A standalone 5-digit US zip ("11211", "(11237)") is fine, as are a separate age range
 * ("28-35") and distance ("5 miles"). Numeric runs with 7 or more digits are refused even
 * when letters touch them. Standalone runs with at least 4 digits are refused except one
 * zip or bounded age range. Thus "1990s" is text, but "12 34 56" is a code.
 */
export function contactOrCode(text: string): boolean {
  const folded = digitFold(text);
  const checkClosedEmail = EMAIL_CUE.test(text) || EMAIL_CUE.test(folded);
  for (const v of contactVariants(text)) {
    if (hasPattern(v, PHONE_PATTERNS)) return true;
    if ((checkClosedEmail || !v.includes("@")) && hasPattern(v, EMAIL_PATTERNS)) return true;
  }
  for (const s of [text, folded]) {
    if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(s)) return true;
    if (SPELLED_CODE.test(s)) return true;
    for (const m of s.matchAll(/\+?[\d(][\d\s().-]*\d/g)) {
      const run = m[0];
      const digits = run.replace(/\D/g, "").length;
      if (digits >= 7) return true;
      if (/^\(?\d{5}\)?$/.test(run) && text.includes(run)) continue;
      const range = /^(\d{1,3})-(\d{1,3})$/.exec(run);
      if (range && Number(range[1]) >= 1 && Number(range[1]) <= Number(range[2]) && Number(range[2]) <= 120) continue;
      const alone = !/\w/.test(s[m.index! - 1] ?? "") && !/\w/.test(s[m.index! + run.length] ?? "");
      if (alone && digits >= 4) return true;
    }
    if (/(?<![\w])(?:\d[\s/_]*){5}\d(?![\w])/.test(s)) return true;
  }
  return false;
}

const PHOTO_NUMBER_LIST = /\b(?:photos?|pics?|pictures?|numbers?)\s+#?([1-6](?:(?:\s*,\s*|\s+and\s+|\s*&\s*|\s+)#?[1-6])*)(?!\s*[\d(#])/gi;

function withoutPhotoNumbers(text: string): string {
  return text.replace(PHOTO_NUMBER_LIST, (all: string, list: string) => {
    const numbers = list.match(/[1-6]/g) ?? [];
    return new Set(numbers).size === numbers.length ? " " : all;
  });
}

export function checkArgs(name: ToolName, args: unknown, enumIds: string[], host: McpApp): { ok: true; app?: string; about?: string; token?: string; ref?: string; words?: string; draft?: SignupDraftFields } | { ok: false; message: string } {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return { ok: false, message: "Arguments must be an object." };
  const a = args as Record<string, unknown>;
  const changesLookingFor = name === "pause_looking_for" || name === "resume_looking_for";
  const extra = Object.keys(a).filter(k => k !== "app" && !(name === "submit_profile" && k === "about") && !(name === "get_updates" && k === "update_token") && !(name === "prepare_signup" && (k === "firstName" || k === "homeCity")) && !(changesLookingFor && k === "ref") && !(name === "photo_request" && k === "words"));
  if (extra.length) return { ok: false, message: `This tool does not take ${extra.map(k => `"${k.slice(0, 40)}"`).join(", ")}. It never takes phone numbers, codes or personal details.` };
  if (name === "prepare_signup") {
    if (!signupDraftRequestAllowed(host.id, a.app !== undefined, a.app === host.id)) return { ok: false, message: "This draft is not available for that app." };
    const firstName = typeof a.firstName === "string" ? a.firstName.trim() : "";
    if (!/^[\p{L}][\p{L}\p{M}'’-]{0,49}$/u.test(firstName) || contactOrCode(firstName) || (a.homeCity !== undefined && !isCity(a.homeCity))) return { ok: false, message: "Use only the approved first name and a supported home city." };
    return { ok: true, app: host.id, draft: { firstName, ...(isCity(a.homeCity) ? { homeCity: a.homeCity } : {}) } };
  }
  if (name === "submit_profile") {
    const about = typeof a.about === "string" ? a.about.trim() : "";
    if (about.length < 10 || about.length > PROFILE_MAX_CHARS) return { ok: false, message: `about must be 10 to ${PROFILE_MAX_CHARS} characters.` };
    if (contactOrCode(about)) return { ok: false, message: "Leave out phone numbers, codes and email addresses: the app never takes them from an assistant." };
    if (a.app !== undefined && a.app !== host.id) return { ok: false, message: `This connection covers ${host.name} only.` };
    return { ok: true, app: host.id, about };
  }
  if (name === "list_looking_for" || changesLookingFor) {
    if (a.app !== undefined && a.app !== host.id) return { ok: false, message: `This connection covers ${host.name} only.` };
    if (!changesLookingFor) return { ok: true, app: host.id };
    const ref = typeof a.ref === "string" ? a.ref.trim().toUpperCase() : "";
    if (!STANDING_INPUT_REF.test(ref)) return { ok: false, message: "ref must look like INT-DPJKAAMBLCNE, from list_looking_for." };
    return { ok: true, app: host.id, ref };
  }
  if (name === "my_photos" || name === "photo_request") {
    if (a.app !== undefined && a.app !== host.id) return { ok: false, message: `This connection covers ${host.name} only.` };
    if (name === "my_photos") return { ok: true, app: host.id };
    const words = typeof a.words === "string" ? a.words.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
    if (words.length < 1 || words.length > PHOTO_WORDS_MAX) return { ok: false, message: `words must be 1 to ${PHOTO_WORDS_MAX} characters: the person's own words.` };
    if (contactOrCode(withoutPhotoNumbers(words))) return { ok: false, message: "Leave out phone numbers, codes and email addresses." };
    return { ok: true, app: host.id, words };
  }
  if (name === "get_updates") {
    if (a.app !== undefined && a.app !== host.id) return { ok: false, message: `This connection covers ${host.name} only.` };
    if (a.update_token !== undefined && (typeof a.update_token !== "string" || !UPDATE_TOKEN.test(a.update_token.trim().toUpperCase())))
      return { ok: false, message: "update_token must look like T-7F3K9Q." };
    return { ok: true, app: host.id, ...(typeof a.update_token === "string" ? { token: a.update_token.trim().toUpperCase() } : {}) };
  }
  if (a.app === undefined) return name === "start_signup" ? { ok: false, message: "Say which app: " + enumIds.join(", ") + "." } : { ok: true };
  if (typeof a.app !== "string") return { ok: false, message: "app must be a string." };
  if (name === "check_status" || name === "read_profile") {
    if (a.app !== host.id) return { ok: false, message: `This connection covers ${host.name} only. To check another app, connect that app's own endpoint.` };
  } else if (!enumIds.includes(a.app)) return { ok: false, message: NOT_AVAILABLE };
  return { ok: true, app: a.app };
}

const publicSignupUrl = (a: McpApp) => publicSignupUsesBrowser(a.id) ? `${a.links.join}?via=agent` : `${a.links.site}/SKILL.md`;
const skillSignup = (a: McpApp) => `Read ${publicSignupUrl(a)} in your own agent. The app's browser confirms your phone during native connector authorization. Keep the verification code on that page.`;

function invitationGuidance(a: McpApp): string {
  return `${a.name} is invite-only. Ask a member who knows you, or the team, for an invitation. ` +
    `Use a forwarded invitation in the app's browser during connector authorization, or reply to the team's invitation text to accept. ` +
    `Already a member? Confirm your phone during connector authorization, then return to your agent.`;
}

function publicInfo(a: McpApp, dating: boolean) {
  return {
    id: a.id, name: a.name, site: a.links.site, what: a.what,
    powered_by: "All of these apps are powered by The Network (https://ntwrk.party).",
    cities: [...a.cities],
    consent: { text: a.consent.text, version: a.consent.version },
    join: {
      mode: a.joinMode,
      url: publicSignupUrl(a),
      keyword: a.keyword,
      how: a.joinMode === "invite" ? invitationGuidance(a) : a.keyword
        ? `The person texts "${a.keyword}" as their first message to The Network's line. ` + (publicSignupUsesBrowser(a.id)
          ? `They can also open ${publicSignupUrl(a)} and verify their own phone there.` : skillSignup(a))
        : `The person texts The Network's line with no keyword. The agent asks what they are looking for (${dating ? "friends, dating or work" : "friends or work"}) and adds the right apps. For a person aged 13 to 17, the agent never adds ${dating ? "dating or work" : "work"}, and the only introductions for people under 18 are friendship introductions on friends.help and ntwrk.party. ${skillSignup(a)}`,
    },
    ages: { join: a.ages.join, matching: a.ages.match },
    adults_only: dating ? a.adultsOnly : a.adultsOnly.map(rule => rule === DATING_AGE_RULE ? WORK_AGE_RULE : rule),
    stop: `Texting STOP on the shared line stops every app. To stop this app only, text "leave ${a.domain}".`,
    consent_rules: [
      "Nobody is introduced unless both people say yes.",
      "Nothing crosses from one app to another unless the person shares it.",
      "The person verifies their own phone in the app's browser. This connector must never receive the code.",
    ],
    links: { privacy: a.links.privacy, terms: a.links.terms, sms_terms: a.links.smsTerms, support: a.links.support },
  };
}

const memberStatus: Record<PublicStatus, MemberStatus> = { not_joined: "NotJoined", invited: "Invited", onboarding: "Onboarding", active: "Active", stopped: "Stopped", on_hold: "OnHold" };

const connectAgain = (a: McpApp) =>
  `disconnect ${a.name} in your agent's connector settings, then connect it again. On the connection page, choose Finish signup, enter your details, check the text message terms, then allow access.`;
const textKeyword = (a: McpApp) => (a.keyword ? ` Or text "${a.keyword}" as your first message to The Network's line.` : "");

const MINOR_SINGLE_PLAYER = "You are signed up. Since you're under 18, I won't introduce you to other members, but I can suggest public places and events.";

const MINOR_SIGNED_UP: Record<MinorNotice, string> = {
  MinorTeenFriendNotice: "You are signed up. People under 18 are introduced only for friendship, to people close to their age.",
  MinorBirthdayNotice: `${MINOR_SINGLE_PLAYER} If you tell me your birthday (month, day and year), I can look for friends close to your age.`,
  MinorSinglePlayerNotice: MINOR_SINGLE_PLAYER,
  MinorSlopNotice: "You are signed up. slop.date doesn't match anyone under 18 for dates. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.",
  MinorPeonNotice: "You are signed up. peon.biz doesn't match anyone under 18 for work. I can still help you myself. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.",
};

const NEXT_TEXT: Record<NextStep, (a: McpApp, minor: MinorNotice | undefined) => string> = {
  GetInvitation: a => `Not joined. ${a.name} is invite-only. With an invitation, ${connectAgain(a)} Enter the invitation on that page. ` +
    `Without one, ask a member who knows you, or the team, for an invitation.`,
  JoinOnSite: a => `Not joined. ${publicSignupUsesBrowser(a.id) ? `Open ${publicSignupUrl(a)} to sign up.` : `To finish signup, ${connectAgain(a)}`}${textKeyword(a)}`,
  AcceptInvitation: a => `Invited. Reply to the invitation text or ${publicSignupUsesBrowser(a.id) ? `open ${publicSignupUrl(a)}.` : connectAgain(a)}`,
  ReplyToLastText: () => "Joining is not finished. Reply to the last text from the agent to finish.",
  AlreadySignedUp: (_a, minor) => (minor ? MINOR_SIGNED_UP[minor] : "You are signed up."),
  TextStart: () => `Messages are stopped. To start again, text START to the line.`,
  EmailSupport: a => `On hold. The person should email ${a.links.support.replace("mailto:", "")}.`,
};

/** The next-step text for a status (spec/connectorTools.md, "The member status decides which member tool can act"). */
const nextStep = (status: PublicStatus, a: McpApp, minor?: MinorNotice): string => NEXT_TEXT[nextStepFor(memberStatus[status], a.joinMode === "invite")](a, minor);

export interface CallContext {
  apps: Record<McpAppId, McpApp>;
  surface: Surface;
  host: McpApp;
  hooks: PlatformHooks;
  grant: Grant | null;
  scopes: readonly Scope[];
  store: OAuthStore;
  now: number;
  log: (line: string) => void;
  /** Which assistant the OAuth client is (by its redirect hosts): chatgpt, claude, grok, or web. */
  assistant?: AssistantKind;
}

/** Resolve the current credential owner before admission, then again at member-tool use. */
export async function checkGrantOwner(hooks: PlatformHooks, grant: Grant): Promise<GrantOwnerDecision> {
  try {
    const current = await hooks.grantOwner(grant.phoneKey);
    return decideGrantOwner(true, current.held, current.personId === grant.personId);
  } catch {
    return decideGrantOwner(false, false, false);
  }
}

function grantOwnerRefusal(decision: GrantOwnerDecision): GrantRefusal | undefined {
  if (decision === "GrantOwnerChanged") return { kind: "invalid_grant" };
  if (decision === "GrantOwnerHeld") return { kind: "grant_held" };
  if (decision === "GrantOwnerUnavailable") return { kind: "grant_unavailable" };
}

/** Only bounded, safe text from the active app membership reaches the assistant. */
function savedProfileResult(fields: SavedProfileFields | undefined, forbidden: string[]) {
  if (!fields) return null;
  const safeText = (value: unknown, maxLength: number) => {
    if (typeof value !== "string" || value.length > maxLength) return null;
    const text = value.trim();
    const folded = digitFold(text);
    return text && !/\b\d{4,8}\b/.test(folded) && !contactOrCode(text)
      && !outputLeaks(text, { forbidden, contacts: true, sensitiveTerms: false }).length ? text : null;
  };
  const first_name = safeText(fields.firstName, 50);
  const about = safeText(fields.about, PROFILE_MAX_CHARS);
  const neighborhood = safeText(fields.neighborhood, 100);
  const home_region = isCity(fields.homeCity) ? fields.homeCity : null;
  const interests = Array.isArray(fields.interests)
    ? fields.interests.slice(0, 20).flatMap(value => { const text = safeText(value, 100); return text ? [text] : []; })
    : [];
  const red_lines = Array.isArray(fields.redLines)
    ? fields.redLines.slice(0, 20).flatMap(value => { const text = safeText(value, 60); return text ? [text] : []; })
    : [];
  if (!first_name && !about && !neighborhood && !home_region && !interests.length && !red_lines.length) return null;
  return { first_name, about, interests, neighborhood, home_region, ...(red_lines.length ? { red_lines } : {}) };
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const PHOTO_WORDS_MAX = 300;
const ADDED_ON = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_SHARE_STATES = new Set(["asked", "checking", "ready", "taken_back"] as const);
const PHOTO_PRIVATE = [/https?:\/\//i, /\bwww\./i, /\bp(?:h|ri|of|dr)_[a-z0-9]+/i, /\b[0-9a-f]{16,}\b/i, /\/photos\//i];

const PHOTO_LIST_TEXT = "These are the person's own photos, numbered from the oldest. You never see the photos. To name one, the person says \"call photo 2 beach\". To stop sharing one, \"take back photo 2\". To delete one, \"delete photo 2\".";
const PHOTO_UNAVAILABLE_TEXT = "Photos are not available for this person here.";
const PHOTO_REQUEST_TEXT: Record<PhotoRequestStatus, string> = {
  texted: "I texted the person the photo to check. They reply YES to that text to send it.",
  done: "Done. The person got the details by text.",
  refused: "That can't be done. The person can text MY PHOTOS to see their photos.",
  unavailable: PHOTO_UNAVAILABLE_TEXT,
};

function photoTextClean(value: string, forbidden: string[]): boolean {
  return !PHOTO_PRIVATE.some(re => re.test(value)) && outputLeaks(value, { forbidden, contacts: true, sensitiveTerms: false }).length === 0;
}

function shownPhotos(view: PhotoHoldingsView, forbidden: string[]) {
  return {
    text: photoTextClean(view.text, forbidden) ? view.text : PHOTO_LIST_TEXT,
    photos: view.photos
      .filter(p => Number.isInteger(p.number) && p.number >= 1 && p.number <= photoSlotsMax && ADDED_ON.test(p.addedOn))
      .map(p => ({
        number: p.number,
        name: p.name !== null && photoTextClean(p.name, forbidden) ? p.name : null,
        addedOn: p.addedOn,
        sharedWith: p.sharedWith.filter(x => PHOTO_SHARE_STATES.has(x.state) && photoTextClean(x.firstName, forbidden)).map(x => ({ firstName: x.firstName, state: x.state })),
      })),
  };
}

const lookingForItem = (e: LookingForEntry) => ({
  ref: e.ref, number: e.number, kind: e.kind, summary: e.summary, status: e.status, in_progress: e.inProgress, ends_on: e.endsAt === null ? null : isoDay(e.endsAt),
});

function shownLookingFor(view: LookingForView | undefined, forbidden: string[]) {
  const safe = (e: { ref: string; summary: string }) => STANDING_REF.test(e.ref) && outputLeaks(e.summary, { forbidden, contacts: false, sensitiveTerms: false }).length === 0;
  return {
    looking_for: (view?.entries ?? []).filter(safe).map(lookingForItem),
    closed_recently: (view?.closedRecently ?? []).filter(safe).map(e => ({ ref: e.ref, summary: e.summary, closed_on: isoDay(e.closedAt) })),
    check_with_person: (view?.checkWithPerson ?? []).filter(safe).map(e => ({ ref: e.ref, summary: e.summary, reason: e.reason })),
  };
}

async function resolveLeakContext(c: CallContext, g: Grant): Promise<{ forbidden: string[]; facts: string[]; allow: string[] }> {
  const base = [g.phoneKey, g.personId ?? ""].filter(Boolean);
  let extra: LeakContext | undefined;
  if (g.personId && c.hooks.leakContext) {
    try { extra = await c.hooks.leakContext(g.personId, g.app, g.phoneKey); } catch { /* fall back to base */ }
  }
  return {
    forbidden: [...new Set([...base, ...(extra?.forbidden ?? []).filter(Boolean)])],
    facts: (extra?.facts ?? []).filter(Boolean),
    allow: (extra?.allow ?? []).filter(Boolean),
  };
}

function formatPublicUpdate(u: PublicUpdate, gate: (text: string) => boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { summary: u.summary, at: u.at, kind: u.kind };
  if (typeof u.actionRequired === "boolean") out.action_required = u.actionRequired;
  if (typeof u.deadlineAt === "string" && u.deadlineAt) out.deadline_at = u.deadlineAt;
  if (typeof u.crowdType === "string" && u.crowdType && gate(u.crowdType)) out.crowd_type = u.crowdType;
  if (typeof u.venueName === "string" && u.venueName && gate(u.venueName)) out.venue_name = u.venueName;
  if (typeof u.pivotStatus === "string" && u.pivotStatus) out.pivot_status = u.pivotStatus;
  if (typeof u.city === "string" && isCity(u.city)) out.city = u.city;
  return out;
}

type LookingForRefusal = Extract<LookingForResult, { kind: "refused" }>["reason"];

const LOOKING_FOR_REFUSED: Record<LookingForRefusal, (a: McpApp) => string> = {
  unknown_ref: () => "That ref is not on the person's current list. Call list_looking_for again.",
  daily_limit: a => `No change: three changes were already made through assistants today. The person can text “pause <ref>” or “resume <ref>” to ${a.name}.`,
  closed: a => `No change: the person closed this one. If they want it again, they can tell ${a.name} by text.`,
  posting: a => `Job posts change only by text: the person texts “close my <title> post” to ${a.name}.`,
  adults_only: a => `No change. The person can text “resume <ref>” to ${a.name}.`,
  texts_off: a => `No change: texts are off for this number, so ${a.name} cannot confirm it.`,
  not_member: a => `No change: the person is not an active member of ${a.name}. Call check_status for the next step.`,
};

export async function callTool(name: ToolName, args: unknown, c: CallContext): Promise<ToolOutcome> {
  const listed = appsOn(c.apps, c.surface, c.host.id);
  const enumIds = listed.map(a => a.id);
  const dating = enumIds.includes("slop");
  const chk = checkArgs(name, args, enumIds, c.host);
  if (!chk.ok) return { kind: "error", message: chk.message };
  switch (name) {
    case "app_info": {
      if (chk.app) return { kind: "ok", data: publicInfo(c.apps[chk.app as McpAppId], dating) };
      return { kind: "ok", data: { apps: listed.map(a => publicInfo(a, dating)) } };
    }
    case "start_signup": {
      const a = c.apps[chk.app as McpAppId];
      return {
        kind: "ok",
        data: {
          app: a.id, join_mode: a.joinMode, url: publicSignupUrl(a), keyword: a.keyword,
          instructions_for_person: a.joinMode === "invite"
            ? `${invitationGuidance(a)} ${skillSignup(a)}`
            : (publicSignupUsesBrowser(a.id)
              ? `Open ${publicSignupUrl(a)} yourself and enter your own phone number. Never share the code. Enter it on that page.`
              : `${skillSignup(a)}`)
              + (a.keyword ? ` Or text "${a.keyword}" as your first message to The Network's line.` : ""),
          ages: { join: a.ages.join, matching: a.ages.match },
        },
      };
    }
    case "prepare_signup": {
      const g = c.grant, store = c.store;
      const connection = stepDraftPreparation(initialDraftPreparation, { type: "observeConnection", grantReady: !!g });
      if (connection.phase !== "CheckAge" || !g) return { kind: "invalid_grant" };
      const aged = stepDraftPreparation(connection, { type: "observeAge", allowed: await c.hooks.signupAgeAllowed(g.phoneKey, g.app, c.now) });
      if (aged.phase !== "CheckOwner") return { kind: "error", message: "We cannot save the signup draft. Check the joining requirements in this app's signup instructions." };
      const owner = await checkGrantOwner(c.hooks, g);
      const refusal = grantOwnerRefusal(owner);
      if (refusal) return refusal;
      const owned = stepDraftPreparation(aged, { type: "observeOwner", ownerMatches: owner === "GrantOwnerMatches" });
      if (owned.phase !== "CheckMembership") return { kind: "invalid_grant" };
      const status = g.personId === null ? "not_joined" : await c.hooks.status(g.personId, g.app, g.phoneKey);
      const member = stepDraftPreparation(owned, { type: "observeMembership", status });
      if (member.phase !== "WriteDraft") return { kind: "error", message: "This person already has a membership here. Use check_status for the next step." };
      const saved = await store.putSignupDraft({ grantId: g.id, app: g.app, phoneKey: g.phoneKey, fields: chk.draft!, expiresAt: signupDraftDeadline(c.now + signupDraftLifetimeMs, g.expiresAt) }, c.now);
      const written = stepDraftPreparation(member, { type: "observeWrite", saved });
      if (written.phase !== "RecheckAge") return { kind: "error", message: "This connection already saved a draft or is no longer valid. Follow this app's signup instructions in your agent." };
      const finished = stepDraftPreparation(written, { type: "observeAgeAfterWrite", allowed: await c.hooks.signupAgeAllowed(g.phoneKey, g.app, c.now) });
      if (finished.phase !== "Prepared") {
        await store.deleteSignupDrafts(g.phoneKey, g.app);
        return { kind: "error", message: "We cannot save the signup draft. Check the joining requirements in this app's signup instructions." };
      }
      const a = c.apps[g.app];
      return { kind: "ok", data: { prepared: true, app: g.app, next_step: `The draft is saved for ${signupDraftLifetimeMs / 60_000} minutes. To finish signup, ${connectAgain(a)} On that page, the person checks the approved details, types their own birthday and ticks the text consent. The agent never approves text consent.` } };
    }
    case "check_status": {
      const g = c.grant;
      if (!g) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      const status: PublicStatus = g.personId === null ? "not_joined" : await c.hooks.status(g.personId, g.app, g.phoneKey);
      const a = c.apps[g.app];
      const personId = g.personId;
      const notice = personId !== null && await c.hooks.minorMember(personId, g.phoneKey)
        ? (await c.hooks.minorNotice?.(personId, g.app, g.phoneKey)) ?? minorNoticeFor(a.id, false, false, false, true)
        : undefined;
      return { kind: "ok", data: { app: a.id, status, next_step: nextStep(status, a, notice), manage_url: a.links.support } };
    }
    case "read_profile": {
      const g = c.grant;
      if (!g || g.app !== c.host.id) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      try {
        const [fields, lc] = await Promise.all([
          g.personId ? c.hooks.readProfile(g.personId, g.app, g.phoneKey) : Promise.resolve(undefined),
          resolveLeakContext(c, g),
        ]);
        return { kind: "ok", data: { app: g.app, profile: savedProfileResult(fields, lc.forbidden) } };
      } catch {
        return { kind: "grant_unavailable" };
      }
    }
    case "submit_profile": {
      const g = c.grant;
      if (!g) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      const person = g.personId;
      const a = c.apps[g.app];
      const { submitProfile, profileSubmissionFingerprint } = c.hooks;
      const store = c.store;
      if (!submitProfile || !profileSubmissionFingerprint) return { kind: "error", message: "Profiles cannot be sent here." };
      const status: PublicStatus = person === null ? "not_joined" : await c.hooks.status(person, g.app, g.phoneKey);
      // Only a joined, live member: the profile never creates a member and never reaches a stopped or held one.
      if (person === null || !toolAllowedFor("SubmitProfileTool", memberStatus[status])) return { kind: "ok", data: { app: a.id, submitted: false, status, next_step: nextStep(status, a) } };
      const fingerprint = profileSubmissionFingerprint(g.app, g.id, chk.about!);
      const unresolved: ToolOutcome = { kind: "error", message: "The profile delivery is unconfirmed. Check your app status before making changes." };
      let nextQuestion: string | undefined;
      try {
        const claim = await store.claimProfileSubmission(g, fingerprint, c.now);
        if (claim === "ProfileClaimRefused") return { kind: "invalid_grant" };
        if (claim === "ProfileClaimPending") return unresolved;
        if (claim === "ProfileClaimStart") {
          const delivery = await submitProfile(person, g.app, g.phoneKey, chk.about!);
          const accepted = delivery === "accepted" || (typeof delivery === "object" && delivery.status === "accepted");
          if (typeof delivery === "object" && delivery.status === "accepted" && delivery.nextQuestion) nextQuestion = delivery.nextQuestion;
          const stored = await store.finishProfileSubmission(g.id, fingerprint, accepted);
          if (!accepted) {
            if (delivery === "stopped") {
              return { kind: "ok", data: { app: a.id, submitted: false, status: "stopped", next_step: nextStep("stopped", a) } };
            }
            // The handler verifies the current token before this reads membership after the refusal.
            return { kind: "profile_refusal", read: async () => {
              try {
                const current = await c.hooks.status(person, g.app, g.phoneKey);
                const next = toolAllowedFor("SubmitProfileTool", memberStatus[current])
                  ? "Profile delivery is unavailable. Check your app status before making changes."
                  : nextStep(current, a);
                return { kind: "ok", data: { app: a.id, submitted: false, status: current, next_step: next } };
              } catch {
                return { kind: "grant_unavailable" };
              }
            } };
          }
          if (!profileSubmissionAccepted(claim, true, stored)) return unresolved;
        }
      } catch {
        // If intake happened before a crash or storage error, leave the pending claim fenced.
        return unresolved;
      }
      const reads = resultShowsLookingFor(c.scopes.includes("profile:read"));
      const lc = await resolveLeakContext(c, g);
      const safeQuestion = nextQuestion && passesOutputGate(nextQuestion, { forbidden: lc.forbidden, facts: lc.facts, allow: lc.allow, contacts: true, canaryShapes: true, sensitiveTerms: false })
        ? nextQuestion : undefined;
      let view: LookingForView | undefined;
      try {
        view = await c.hooks.lookingFor?.(person, g.app, g.phoneKey);
      } catch (e) {
        c.log(`[mcp] ${g.app} submit_profile looking_for read failed grant=${g.id}: ${(e as Error).message}`);
        return { kind: "ok", data: { app: a.id, submitted: true, status, looking_for: [], check_with_person: [], ...(safeQuestion ? { next_question: safeQuestion } : {}),
          next_step: `${a.name} has it. What is active for the person could not be read now: call list_looking_for later to check. Change nothing unless they ask.` } };
      }
      const shown = shownLookingFor(view, lc.forbidden);
      return { kind: "ok", data: { app: a.id, submitted: true, status, looking_for: reads ? shown.looking_for : [], check_with_person: reads ? shown.check_with_person : [], ...(safeQuestion ? { next_question: safeQuestion } : {}),
        next_step: !shown.check_with_person.length ? `${a.name} has it. It may text the person a short question or two.`
          : reads ? `${a.name} has it. Some of it may not match what is active for the person: see check_with_person. Ask them about each one. Change nothing unless they ask.`
          : `${a.name} has it. Some of it may not match what is active for the person. Ask them to text “what am I looking for” to ${a.name} to check. Change nothing unless they ask.` } };
    }
    case "list_looking_for": {
      const g = c.grant;
      if (!g || g.app !== c.host.id) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      const a = c.apps[g.app];
      const hook = c.hooks.lookingFor;
      if (!hook) return { kind: "error", message: "This list is not available here." };
      const status: PublicStatus = g.personId === null ? "not_joined" : await c.hooks.status(g.personId, g.app, g.phoneKey);
      const connection = { ...connectionOf(c.host, c.surface, c.scopes), status: memberStatus[status] };
      if (g.personId === null || callLookingForTool(connection, "ListLookingForTool", true, false).lastResult === "LookingForUnavailable")
        return { kind: "ok", data: { app: a.id, looking_for: [], closed_recently: [], next_step: nextStep(status, a) } };
      let view: LookingForView | undefined;
      try {
        view = await hook(g.personId, g.app, g.phoneKey);
      } catch (e) {
        c.log(`[mcp] ${g.app} list_looking_for read failed grant=${g.id}: ${(e as Error).message}`);
        return { kind: "error", message: "The list cannot be read right now. Try again shortly." };
      }
      if (!view) {
        const current: PublicStatus = await c.hooks.status(g.personId, g.app, g.phoneKey);
        return { kind: "ok", data: { app: a.id, looking_for: [], closed_recently: [], next_step: nextStep(current, a) } };
      }
      const lc = await resolveLeakContext(c, g);
      const shown = shownLookingFor(view, lc.forbidden);
      return { kind: "ok", data: { app: a.id, looking_for: shown.looking_for, closed_recently: shown.closed_recently,
        next_step: shown.looking_for.length
          ? `Tell the person what is active. To pause one, call pause_looking_for after they ask. To close one for good, the person texts “close <ref>” to ${a.name}.`
          : `Nothing is active for the person in ${a.name}. If they want something, send it with submit_profile.` } };
    }
    case "pause_looking_for": case "resume_looking_for": {
      const g = c.grant;
      if (!g || g.app !== c.host.id) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      const a = c.apps[g.app];
      const hook = c.hooks.changeLookingFor;
      if (!hook) return { kind: "error", message: "Changes are not available here." };
      const status: PublicStatus = g.personId === null ? "not_joined" : await c.hooks.status(g.personId, g.app, g.phoneKey);
      const connection = { ...connectionOf(c.host, c.surface, c.scopes), status: memberStatus[status] };
      if (g.personId === null || callLookingForTool(connection, connectorTool[name], true, false).lastResult === "LookingForUnavailable")
        return { kind: "ok", data: { app: a.id, changed: false, item: null, reason: "not_member", next_step: nextStep(status, a) } };
      const change = name === "pause_looking_for" ? "pause" : "resume";
      let result: LookingForResult;
      try {
        result = await hook(g.personId, g.app, g.phoneKey, g.id, chk.ref!, change);
      } catch (e) {
        c.log(`[mcp] ${g.app} ${name} failed grant=${g.id}: ${(e as Error).message}`);
        return { kind: "error", message: "The change is unconfirmed. Call list_looking_for to check before trying again." };
      }
      if (result.kind === "refused")
        return { kind: "ok", data: { app: a.id, changed: false, item: null, reason: result.reason, next_step: LOOKING_FOR_REFUSED[result.reason](a) } };
      const lc = await resolveLeakContext(c, g);
      const [item] = resultShowsLookingFor(c.scopes.includes("profile:read"))
        ? shownLookingFor({ entries: [result.entry], closedRecently: [], checkWithPerson: [] }, lc.forbidden).looking_for : [];
      const changed = callLookingForTool(connection, connectorTool[name], true, result.kind === "applied").lastResult === "LookingForChanged";
      return { kind: "ok", data: { app: a.id, changed, item: item ?? null, reason: null,
        next_step: result.kind === "unchanged" ? "No change: it was already in that state."
          : change === "pause" ? `Paused. ${a.name} texted the person a confirmation. They can reply UNDO to turn it back on, or CLOSE to close it for good.`
          : `Turned back on. ${a.name} texted the person a confirmation.` } };
    }
    case "my_photos": case "photo_request": {
      const g = c.grant;
      if (!g || g.app !== c.host.id) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      const a = c.apps[g.app];
      const hook = name === "my_photos" ? c.hooks.photoHoldings : c.hooks.photoRequest;
      if (!hook) return { kind: "error", message: "Photos are not available here." };
      const status: PublicStatus = g.personId === null ? "not_joined" : await c.hooks.status(g.personId, g.app, g.phoneKey);
      const adult = g.personId !== null && !await c.hooks.minorMember(g.personId, g.phoneKey);
      const { forbidden } = await resolveLeakContext(c, g);
      const called = callPhotoTool({ ...connectionOf(c.host, c.surface, c.scopes), status: memberStatus[status] }, connectorTool[name], g.personId !== null, adult);
      if (g.personId === null || called.lastResult === "PhotoToolUnavailable") {
        const unavailable = toolAllowedFor(connectorTool[name], memberStatus[status]) ? PHOTO_UNAVAILABLE_TEXT : nextStep(status, a);
        return { kind: "ok", data: name === "my_photos" ? { app: a.id, text: unavailable, photos: [] } : { app: a.id, status: "unavailable", text: unavailable } };
      }
      if (name === "my_photos") {
        let view: PhotoHoldingsView | undefined;
        try {
          view = await c.hooks.photoHoldings!(g.personId, g.app, g.phoneKey);
        } catch (e) {
          c.log(`[mcp] ${g.app} my_photos read failed grant=${g.id}: ${(e as Error).message}`);
          return { kind: "error", message: "The photo list cannot be read right now. Try again shortly." };
        }
        if (!view) return { kind: "ok", data: { app: a.id, text: PHOTO_UNAVAILABLE_TEXT, photos: [] } };
        return { kind: "ok", data: { app: a.id, ...shownPhotos(view, forbidden) } };
      }
      try {
        const answer = await c.hooks.photoRequest!(g.personId, g.app, g.phoneKey, chk.words!);
        const text = answer.text && photoTextClean(answer.text, forbidden) ? answer.text : PHOTO_REQUEST_TEXT[answer.status];
        return { kind: "ok", data: { app: a.id, status: answer.status, text } };
      } catch (e) {
        c.log(`[mcp] ${g.app} photo_request failed grant=${g.id}: ${(e as Error).message}`);
        return { kind: "error", message: "The photo request is unconfirmed. The person can text MY PHOTOS to check before trying again." };
      }
    }
    case "get_updates": {
      const g = c.grant;
      if (!g) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      const a = c.apps[g.app];
      if (!c.hooks.updates) return { kind: "error", message: "Updates are not available here yet." };
      const lc = await resolveLeakContext(c, g);
      const gate = (summary: string) => passesOutputGate(summary, {
        forbidden: lc.forbidden, facts: lc.facts, allow: lc.allow, contacts: true, canaryShapes: true,
      });
      // Someone else's reference, an unknown one or an expired one reads as "nothing new", like an empty inbox.
      const rawUpdates = g.personId === null ? [] : await c.hooks.updates(g.personId, g.app, c.assistant ?? "web", chk.token, gate);
      const updates = rawUpdates.filter(u => gate(u.summary)).map(u => formatPublicUpdate(u, gate));
      return { kind: "ok", data: { app: a.id, updates, next_step: updates.length ? "Tell the person briefly. They answer by replying to the text." : `Nothing new from ${a.name}.` } };
    }
  }
}
