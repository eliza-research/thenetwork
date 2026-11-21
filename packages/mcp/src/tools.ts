// The tools. app_info and start_signup need no sign-in and return public facts only.
// check_status and get_updates need membership:read and return only the signed-in person's own state
// or updates in the one app the client is bound to. No tool takes a phone number, a code or an age, and every
// input schema refuses properties it does not list.
import {
  initial as initialDraftPreparation, signupDraftDeadline, signupDraftLifetimeMs,
  signupDraftRequestAllowed, step as stepDraftPreparation,
} from "../../core/src/generated/mcpSignupDraft.ts";
import {
  type Connection, type GrantOwnerDecision, type MemberStatus, type NextStep, type Scope as ConnectorScope, type ToolName as ConnectorTool,
  canCallCheckStatus, canCallGetUpdates, canCallPrepareSignup, canCallPublicTool, canCallReadProfile, canCallSubmitProfile, grantCovers,
  decideGrantOwner, initial as connectionInitial, nextStepFor, scopeFor, toolAllowedFor, toolListed,
} from "../../core/src/generated/connectorTools.ts";
import { publicSignupUsesBrowser } from "../../core/src/generated/siteEnrollment.ts";
import { profileSubmissionAccepted } from "../../core/src/generated/mcpProfileSubmission.ts";
import { appsOn, connectorApp, connectorSurface, type McpApp, type McpAppId, type Surface } from "./apps.ts";
import type { AssistantKind, PlatformHooks, PublicStatus, SavedProfileFields } from "./hooks.ts";
import type { Grant, Scope, OAuthStore, SignupDraftFields } from "./store.ts";
import { outputLeaks, passesOutputGate } from "./leaks.ts";

export const TOOL_NAMES = ["app_info", "start_signup", "check_status", "read_profile", "submit_profile", "get_updates", "prepare_signup"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
/** The generated name of each tool (spec/connectorTools.md, "Each surface lists only the apps it may offer"). */
export const connectorTool: Record<ToolName, ConnectorTool> = {
  app_info: "AppInfoTool", start_signup: "StartSignupTool", check_status: "CheckStatusTool",
  read_profile: "ReadProfileTool", submit_profile: "SubmitProfileTool", get_updates: "GetUpdatesTool",
  prepare_signup: "PrepareSignupTool",
};
/** The OAuth scope of each generated scope; a public tool needs none (spec/connectorTools.md, "Public tools need no sign-in"). */
const oauthScope: Record<ConnectorScope, Scope | null> = { NoScope: null, MembershipRead: "membership:read", ProfileWrite: "profile:write", ProfileRead: "profile:read" };
/** The OAuth scope that each tool needs, from the generated `scopeFor` (spec/connectorTools.md, "Public tools need no sign-in"). */
export const TOOL_SCOPE = Object.fromEntries(TOOL_NAMES.map(t => [t, oauthScope[scopeFor(connectorTool[t])]])) as Record<ToolName, Scope | null>;

/** Whether the token's scopes cover the tool (spec/connectorTools.md, "Public tools need no sign-in"). */
export const tokenCovers = (tool: ToolName, scopes: readonly Scope[]): boolean =>
  grantCovers(connectorTool[tool], scopes.includes("membership:read"), scopes.includes("profile:write"), scopes.includes("profile:read"));

/**
 * The model connection of one MCP request (spec/connectorTools.md, "what the shell owns"): connected with a token,
 * anonymous without one, with the profile write scope only when the token holds it, and with an approved profile
 * that is not sent yet (the agent owns the read-back). The platform reads the member status inside the tool.
 */
export function connectionOf(host: McpApp, surface: Surface, scopes: readonly Scope[] | null, sentToday = 0): Connection {
  return {
    ...connectionInitial, phase: scopes ? "Connected" : "Anonymous", host: connectorApp[host.id], surface: connectorSurface[surface],
    hasWrite: !!scopes?.includes("profile:write"), hasProfileRead: !!scopes?.includes("profile:read"),
    profileApproved: true, profileSent: false, sentToday,
  };
}

/** The generated guard of each tool call (spec/connectorTools.md). */
export function canCallTool(c: Connection, tool: ToolName): boolean {
  switch (tool) {
    case "app_info": case "start_signup": return canCallPublicTool(c, connectorTool[tool]);
    case "check_status": return canCallCheckStatus(c);
    case "read_profile": return canCallReadProfile(c);
    case "get_updates": return canCallGetUpdates(c);
    case "submit_profile": return canCallSubmitProfile(c);
    case "prepare_signup": return canCallPrepareSignup(c);
  }
}

/** An update reference from a Network text (packages/notify task tokens): a pointer, never a credential. */
export const UPDATE_TOKEN = /^T-[2-9A-HJKMNP-TV-Z]{6}$/;
/** The longest profile text the assistant may submit (a few short paragraphs). */
export const PROFILE_MAX_CHARS = 1200;

/** Server instructions. The rules are in the first 512 characters (OpenAI shows only those). */
export const INSTRUCTIONS =
  "Helps a person learn about apps powered by The Network and sign themselves up. Never ask for, accept or relay a phone number or a verification code. " +
  "The person completes signup and authorization themselves. Never send a message on their behalf. start_signup points to the app's published signup instructions. " +
  "check_status works only after the person signs in and authorizes access in that app's browser, and shows only their own status in that one app. submit_profile sends that app what the person chose to tell you about themselves. No tool returns anything about other people or other apps.";

const annotations = (title: string) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export function toolDefs(apps: Record<McpAppId, McpApp>, surface: Surface, host: McpApp) {
  const ids = appsOn(apps, surface).map(a => a.id);
  const appProp = (description: string) => ({ type: "string", enum: ids, description });
  // The security scheme of each tool, from its generated scope (spec/connectorTools.md, "Public tools need no sign-in").
  const schemes = (tool: ToolName) => {
    const scope = TOOL_SCOPE[tool];
    const list = scope ? [{ type: "oauth2", scopes: [scope] }] : [{ type: "noauth" }];
    return { securitySchemes: list, _meta: { securitySchemes: list } };
  };
  const text = { type: "string" };
  const nullableText = { type: ["string", "null"] };
  const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const appId = { type: "string", enum: ids };
  const ownApp = { type: "string", enum: [host.id] };
  const joinMode = { type: "string", enum: ["invite", "open", "waitlist"] };
  const ages = object({ join: { type: "integer" }, matching: { type: "integer" } });
  const status = { type: "string", enum: Object.keys(memberStatus) };
  const publicApp = object({
    id: appId, name: text, site: text, what: text, powered_by: text,
    join: object({ mode: joinMode, url: text, keyword: nullableText, how: text }),
    ages, adults_only: { type: "array", items: text }, stop: text,
    consent_rules: { type: "array", items: text },
    links: object({ privacy: text, terms: text, sms_terms: nullableText, support: text }),
  });
  return [
    {
      name: "app_info",
      title: "About the apps",
      description: "Public facts about one app powered by The Network, or about all of them: what it is for, who can join, how a person joins, and links to its privacy and terms pages. Never returns anything about a person.",
      inputSchema: { type: "object", properties: { app: appProp("One app. Leave it out for all apps.") }, additionalProperties: false },
      outputSchema: { type: "object", anyOf: [publicApp, object({ apps: { type: "array", items: publicApp } })] },
      annotations: annotations("About the apps"),
      ...schemes("app_info"),
    },
    {
      name: "start_signup",
      title: "Get signup instructions",
      description: "Returns one app's published signup instructions and text keyword. For a native connector, use the client's authorization link for browser signup. This tool takes no personal details.",
      inputSchema: { type: "object", properties: { app: appProp("The app to join.") }, required: ["app"], additionalProperties: false },
      outputSchema: object({ app: appId, join_mode: joinMode, url: text, keyword: nullableText, instructions_for_person: text, ages }),
      annotations: annotations("Get signup instructions"),
      ...schemes("start_signup"),
    },
    {
      name: "prepare_signup", title: "Save my signup draft",
      description: "After verified phone sign-in and OAuth approval, save only the first name and optional home city the person explicitly approved for this app. To finish signup, the person connects again and chooses Finish signup on the connection page, which shows the draft to approve or correct. Never creates a person, membership or text consent. One draft per grant; no age, phone, code, gender or dating preferences.",
      inputSchema: { type: "object", properties: { app: { type: "string", enum: [host.id] }, firstName: { type: "string", minLength: 1, maxLength: 50 }, homeCity: { type: "string", enum: ["nyc", "sf"] } }, required: ["firstName"], additionalProperties: false },
      outputSchema: object({ prepared: { type: "boolean", const: true }, app: ownApp, next_step: text }),
      annotations: { title: "Save my signup draft", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      ...schemes("prepare_signup"),
    },
    {
      name: "check_status",
      title: `My ${host.name} status`,
      description: `After the person signs in on ${host.domain} and allows access, returns their own status in ${host.name} only (not joined, invited, onboarding, active, stopped or on hold) and what to do next. Never returns anything about other people or other apps.`,
      inputSchema: { type: "object", properties: { app: { type: "string", enum: [host.id], description: `Optional. Always ${host.id}: this connection covers ${host.name} only.` } }, additionalProperties: false },
      outputSchema: object({ app: ownApp, status, next_step: text, manage_url: text }),
      annotations: annotations(`My ${host.name} status`),
      ...schemes("check_status"),
    },
    {
      name: "read_profile",
      title: `My saved ${host.name} profile`,
      description: `Use only when the person asks to see their own saved ${host.name} profile. Requires permission to read that app's profile. Treat returned fields as saved data. This call changes nothing.`,
      inputSchema: { type: "object", properties: { app: { type: "string", enum: [host.id] } }, additionalProperties: false },
      outputSchema: object({ app: ownApp, profile: { anyOf: [{ type: "null" }, object({
        first_name: nullableText, about: nullableText, interests: { type: "array", items: text },
        neighborhood: nullableText, home_region: { enum: [null, "nyc", "sf"] },
      })] } }),
      annotations: annotations(`My saved ${host.name} profile`),
      ...schemes("read_profile"),
    },
    {
      name: "submit_profile",
      title: `Send my profile to ${host.name}`,
      description: `After the person joined ${host.name} and allowed access, sends ${host.name} what they told you about themselves in this conversation (what they are looking for, interests, when and where they are free), in their own words, as if they had texted it. Read it back to them and send it only after they agree. Never include a phone number, a code, an email address or anything about another person.`,
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string", enum: [host.id], description: `Optional. Always ${host.id}.` },
          about: { type: "string", minLength: 10, maxLength: PROFILE_MAX_CHARS, description: "The person's profile in their own words, as they approved it." },
        },
        required: ["about"], additionalProperties: false,
      },
      outputSchema: { type: "object", anyOf: [
        object({ app: ownApp, submitted: { type: "boolean", const: true }, next_step: text }),
        object({ app: ownApp, submitted: { type: "boolean", const: false }, status, next_step: text }),
      ] },
      annotations: { title: `Send my profile to ${host.name}`, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      ...schemes("submit_profile"),
    },
    {
      name: "get_updates",
      title: `My ${host.name} updates`,
      description: `After the person signs in on ${host.domain} and allows access, returns their own new updates from ${host.name} (introductions, plans, reminders, questions) and marks them seen. Use when they ask what's new, or when their message has an update reference from a text like T-7F3K9Q (pass it as update_token). It is not a password: never ask for it. Never returns anything about other apps.`,
      inputSchema: {
        type: "object",
        properties: {
          app: { type: "string", enum: [host.id], description: `Optional. Always ${host.id}.` },
          update_token: { type: "string", pattern: UPDATE_TOKEN.source, description: "Optional. The update reference from a text, like T-7F3K9Q. Shows only that update." },
        },
        additionalProperties: false,
      },
      outputSchema: object({ app: ownApp, updates: { type: "array", items: object({ summary: text, at: text, kind: text }) }, next_step: text }),
      // Reading marks items seen and every call updates the assistant's last-used time.
      annotations: { title: `My ${host.name} updates`, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      ...schemes("get_updates"),
    },
  ].filter(t => toolListed(connectorApp[host.id], connectorSurface[surface], connectorTool[t.name as ToolName]));
}

export type ToolOutcome =
  | { kind: "ok"; data: Record<string, unknown> | Record<string, unknown>[] | { apps: unknown[] } }
  | { kind: "error"; message: string }
  /** The grant no longer matches the person who owns the phone: answer 401 like an invalid token. */
  | GrantRefusal;

type GrantRefusal = { kind: "invalid_grant" } | { kind: "grant_held" } | { kind: "grant_unavailable" };

const NOT_AVAILABLE = "That app is not available here.";

/** Validate the arguments against the tool's schema: only listed properties, enum values only. */
/**
 * A phone number, an email address or a verification code in the profile text: refused, never stored.
 * A standalone 5-digit US zip ("11211", "(11237)") is fine, as are a separate age range
 * ("28-35") and distance ("5 miles"). Numeric runs with 7 or more digits are refused even
 * when letters touch them. Standalone runs with at least 4 digits are refused except one
 * zip or bounded age range. Thus "1990s" is text, but "12 34 56" is a code.
 */
export function contactOrCode(text: string): boolean {
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) return true;
  // A phone touching letters or underscores is still a phone.
  for (const m of text.matchAll(/\+?[\d(][\d\s().-]*\d/g)) {
    const run = m[0];
    const digits = run.replace(/\D/g, "").length;
    if (digits >= 7) return true;
    if (/^\(?\d{5}\)?$/.test(run)) continue;
    const range = /^(\d{1,3})-(\d{1,3})$/.exec(run);
    if (range && Number(range[1]) >= 1 && Number(range[1]) <= Number(range[2]) && Number(range[2]) <= 120) continue;
    const alone = !/\w/.test(text[m.index! - 1] ?? "") && !/\w/.test(text[m.index! + run.length] ?? "");
    if (alone && digits >= 4) return true;
  }
  return false;
}

export function checkArgs(name: ToolName, args: unknown, enumIds: string[], host: McpApp): { ok: true; app?: string; about?: string; token?: string; draft?: SignupDraftFields } | { ok: false; message: string } {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return { ok: false, message: "Arguments must be an object." };
  const a = args as Record<string, unknown>;
  const extra = Object.keys(a).filter(k => k !== "app" && !(name === "submit_profile" && k === "about") && !(name === "get_updates" && k === "update_token") && !(name === "prepare_signup" && (k === "firstName" || k === "homeCity")));
  if (extra.length) return { ok: false, message: `This tool does not take ${extra.map(k => `"${k.slice(0, 40)}"`).join(", ")}. It never takes phone numbers, codes or personal details.` };
  if (name === "prepare_signup") {
    if (!signupDraftRequestAllowed(host.id, a.app !== undefined, a.app === host.id)) return { ok: false, message: "This draft is not available for that app." };
    const firstName = typeof a.firstName === "string" ? a.firstName.trim() : "";
    if (!/^[\p{L}][\p{L}\p{M}'’-]{0,49}$/u.test(firstName) || contactOrCode(firstName) || (a.homeCity !== undefined && a.homeCity !== "nyc" && a.homeCity !== "sf")) return { ok: false, message: "Use only the approved first name and a supported home city." };
    return { ok: true, app: host.id, draft: { firstName, ...(a.homeCity ? { homeCity: a.homeCity as "nyc" | "sf" } : {}) } };
  }
  if (name === "submit_profile") {
    const about = typeof a.about === "string" ? a.about.trim() : "";
    if (about.length < 10 || about.length > PROFILE_MAX_CHARS) return { ok: false, message: `about must be 10 to ${PROFILE_MAX_CHARS} characters.` };
    if (contactOrCode(about)) return { ok: false, message: "Leave out phone numbers, codes and email addresses: the app never takes them from an assistant." };
    if (a.app !== undefined && a.app !== host.id) return { ok: false, message: `This connection covers ${host.name} only.` };
    return { ok: true, app: host.id, about };
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
    if (a.app !== host.id) return { ok: false, message: `This connection covers ${host.name} only. To check another app, connect to that app's own site.` };
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

function publicInfo(a: McpApp, surface: Surface) {
  return {
    id: a.id, name: a.name, site: a.links.site, what: a.what,
    powered_by: "All of these apps are powered by The Network (https://ntwrk.party).",
    join: {
      mode: a.joinMode,
      url: publicSignupUrl(a),
      keyword: a.keyword,
      how: a.joinMode === "invite" ? invitationGuidance(a) : a.keyword
        ? `The person texts "${a.keyword}" as their first message to The Network's line. ` + (publicSignupUsesBrowser(a.id)
          ? `They can also open ${publicSignupUrl(a)} and verify their own phone there.` : skillSignup(a))
        : `The person texts The Network's line with no keyword. The agent asks what they are looking for (${surface === "openai" ? "friends or work" : "friends, dating or work"}) and adds the right apps. ${skillSignup(a)}`,
    },
    ages: { join: a.ages.join, matching: a.ages.match },
    adults_only: a.adultsOnly,
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

/** spec/connectorTools.md, "The member status decides which member tool can act": the join path from a live connection. */
const connectAgain = (a: McpApp) =>
  `disconnect ${a.name} in your agent's connector settings, then connect it again. On the connection page, choose Finish signup, check your details and the text message terms, then allow access.`;
const textKeyword = (a: McpApp) => (a.keyword ? ` Or text "${a.keyword}" as your first message to The Network's line.` : "");

const NEXT_TEXT: Record<NextStep, (a: McpApp) => string> = {
  GetInvitation: a => `Not joined. ${a.name} is invite-only. With an invitation, ${connectAgain(a)} Enter the invitation on that page. ` +
    `Without one, ask a member who knows you, or the team, for an invitation.`,
  JoinOnSite: a => `Not joined. ${publicSignupUsesBrowser(a.id) ? `Open ${publicSignupUrl(a)} to sign up.` : `To finish signup, ${connectAgain(a)}`}${textKeyword(a)}`,
  AcceptInvitation: a => `Invited. Reply to the invitation text or ${publicSignupUsesBrowser(a.id) ? `open ${publicSignupUrl(a)}.` : connectAgain(a)}`,
  ReplyToLastText: () => "Joining is not finished. Reply to the last text from the agent to finish.",
  AlreadySignedUp: () => "You are signed up.",
  TextStart: () => `Messages are stopped. To start again, text START to the line.`,
  EmailSupport: a => `On hold. The person should email ${a.links.support.replace("mailto:", "")}.`,
};

/** The next-step text for a status (spec/connectorTools.md, "The member status decides which member tool can act"). */
const nextStep = (status: PublicStatus, a: McpApp): string => NEXT_TEXT[nextStepFor(memberStatus[status], a.joinMode === "invite")](a);

export interface CallContext {
  apps: Record<McpAppId, McpApp>;
  surface: Surface;
  host: McpApp;
  hooks: PlatformHooks;
  grant: Grant | null;
  store?: OAuthStore;
  now?: number;
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
    const normalized = text.normalize("NFKC");
    return text && !/\b\d{4,8}\b/.test(normalized) && !contactOrCode(normalized)
      && !outputLeaks(text, { forbidden, contacts: true }).length ? text : null;
  };
  const first_name = safeText(fields.firstName, 50);
  const about = safeText(fields.about, PROFILE_MAX_CHARS);
  const neighborhood = safeText(fields.neighborhood, 100);
  const home_region = fields.homeCity === "nyc" || fields.homeCity === "sf" ? fields.homeCity : null;
  const interests = Array.isArray(fields.interests)
    ? fields.interests.slice(0, 20).flatMap(value => { const text = safeText(value, 100); return text ? [text] : []; })
    : [];
  return first_name || about || neighborhood || home_region || interests.length ? { first_name, about, interests, neighborhood, home_region } : null;
}

export async function callTool(name: ToolName, args: unknown, c: CallContext): Promise<ToolOutcome> {
  const enumIds = appsOn(c.apps, c.surface).map(a => a.id);
  const chk = checkArgs(name, args, enumIds, c.host);
  if (!chk.ok) return { kind: "error", message: chk.message };
  switch (name) {
    case "app_info": {
      if (chk.app) return { kind: "ok", data: publicInfo(c.apps[chk.app as McpAppId], c.surface) };
      return { kind: "ok", data: { apps: appsOn(c.apps, c.surface).map(a => publicInfo(a, c.surface)) } };
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
      const connection = stepDraftPreparation(initialDraftPreparation, { type: "observeConnection", grantReady: !!g && !!store && c.now !== undefined, guardReady: !!c.hooks.signupAgeAllowed });
      if (connection.phase === "GrantRefused" || !g || !store || c.now === undefined) return { kind: "invalid_grant" };
      if (connection.phase !== "CheckAge" || !c.hooks.signupAgeAllowed) return { kind: "error", message: "Drafts cannot be saved here. Follow this app's signup instructions in your agent." };
      const aged = stepDraftPreparation(connection, { type: "observeAge", allowed: await c.hooks.signupAgeAllowed(g.phoneKey, g.app) });
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
      const finished = stepDraftPreparation(member, { type: "observeWrite", saved });
      const a = c.apps[g.app];
      return finished.phase === "Prepared"
        ? { kind: "ok", data: { prepared: true, app: g.app, next_step: `The draft is saved for ${signupDraftLifetimeMs / 60_000} minutes. To finish signup, ${connectAgain(a)} The page shows the saved first name and home city to check.` } }
        : { kind: "error", message: "This connection already saved a draft or is no longer valid. Follow this app's signup instructions in your agent." };
    }
    case "check_status": {
      const g = c.grant;
      if (!g) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      const status: PublicStatus = g.personId === null ? "not_joined" : await c.hooks.status(g.personId, g.app, g.phoneKey);
      const a = c.apps[g.app];
      return { kind: "ok", data: { app: a.id, status, next_step: nextStep(status, a), manage_url: a.links.support } };
    }
    case "read_profile": {
      const g = c.grant;
      if (!g || g.app !== c.host.id) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      try {
        const fields = g.personId ? await c.hooks.readProfile?.(g.personId, g.app, g.phoneKey) : undefined;
        return { kind: "ok", data: { app: g.app, profile: savedProfileResult(fields, [g.phoneKey, g.personId ?? ""]) } };
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
      if (!submitProfile || !profileSubmissionFingerprint || !store || c.now === undefined) return { kind: "error", message: "Profiles cannot be sent here yet." };
      const status: PublicStatus = person === null ? "not_joined" : await c.hooks.status(person, g.app, g.phoneKey);
      // Only a joined, live member: the profile never creates a member and never reaches a stopped or held one.
      if (person === null || !toolAllowedFor("SubmitProfileTool", memberStatus[status])) return { kind: "ok", data: { app: a.id, submitted: false, status, next_step: nextStep(status, a) } };
      const fingerprint = profileSubmissionFingerprint(g.app, g.id, chk.about!);
      const unresolved: ToolOutcome = { kind: "error", message: "The profile delivery is unconfirmed. Check your app status before making changes." };
      try {
        const claim = await store.claimProfileSubmission(g, fingerprint, c.now);
        if (claim === "ProfileClaimRefused") return { kind: "invalid_grant" };
        if (claim === "ProfileClaimPending") return unresolved;
        if (claim === "ProfileClaimStart") {
          const delivery = await submitProfile(person, g.app, g.phoneKey, chk.about!);
          const accepted = delivery === "accepted";
          const stored = await store.finishProfileSubmission(g.id, fingerprint, accepted);
          if (!accepted) {
            const status = delivery === "stopped" ? "stopped" : "not_joined";
            return { kind: "ok", data: { app: a.id, submitted: false, status, next_step: nextStep(status, a) } };
          }
          if (!profileSubmissionAccepted(claim, true, stored)) return unresolved;
        }
      } catch {
        // If intake happened before a crash or storage error, leave the pending claim fenced.
        return unresolved;
      }
      return { kind: "ok", data: { app: a.id, submitted: true, next_step: `${a.name} has it. It may text the person a short question or two.` } };
    }
    case "get_updates": {
      const g = c.grant;
      if (!g) return { kind: "invalid_grant" };
      const refusal = grantOwnerRefusal(await checkGrantOwner(c.hooks, g));
      if (refusal) return refusal;
      const a = c.apps[g.app];
      if (!c.hooks.updates) return { kind: "error", message: "Updates are not available here yet." };
      // Someone else's reference, an unknown one or an expired one reads as "nothing new", like an empty inbox.
      const updates = g.personId === null ? [] : (await c.hooks.updates(g.personId, g.app, c.assistant ?? "web", chk.token, passesOutputGate)).filter(u => passesOutputGate(u.summary));
      return { kind: "ok", data: { app: a.id, updates, next_step: updates.length ? "Tell the person briefly. They answer by replying to the text." : `Nothing new from ${a.name}.` } };
    }
  }
}
