// The tools. app_info and start_signup need no sign-in and return public facts only.
// check_status and get_updates need membership:read and return only the signed-in person's own state
// or updates in the one app the client is bound to. No tool takes a phone number, a code, a name or an age, and every
// input schema refuses properties it does not list.
import { appsOn, type McpApp, type McpAppId, type Surface } from "./apps.ts";
import type { AssistantKind, PlatformHooks, PublicStatus } from "./hooks.ts";
import type { Grant, Scope } from "./store.ts";
import { outputLeaks } from "./leaks.ts";

export const TOOL_NAMES = ["app_info", "start_signup", "check_status", "submit_profile", "get_updates"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const TOOL_SCOPE: Record<ToolName, Scope | null> = { app_info: null, start_signup: null, check_status: "membership:read", submit_profile: "profile:write", get_updates: "membership:read" };
/** An update reference from a Network text (packages/notify task tokens): a pointer, never a credential. */
export const UPDATE_TOKEN = /^T-[2-9A-HJKMNP-TV-Z]{6}$/;
/** The longest profile text the assistant may submit (a few short paragraphs). */
export const PROFILE_MAX_CHARS = 1200;

/** Server instructions. The rules are in the first 512 characters (OpenAI shows only those). */
export const INSTRUCTIONS =
  "Helps a person learn about apps powered by The Network and sign themselves up. Never ask for, accept or relay a phone number or a verification code. " +
  "Never sign anyone up and never message anyone. start_signup returns a link the person opens and completes themselves. check_status works only after the person signs in " +
  "on the app's own page, and shows only their own status in that one app. submit_profile sends that app what the person chose to tell you about themselves. No tool returns anything about other people or other apps.";

const annotations = (title: string) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export function toolDefs(apps: Record<McpAppId, McpApp>, surface: Surface, host: McpApp) {
  const ids = appsOn(apps, surface).map(a => a.id);
  const appProp = (description: string) => ({ type: "string", enum: ids, description });
  const noauth = [{ type: "noauth" }];
  const oauth = [{ type: "oauth2", scopes: ["membership:read"] }];
  return [
    {
      name: "app_info",
      title: "About the apps",
      description: "Public facts about one app powered by The Network, or about all of them: what it is for, who can join, how a person joins, and links to its privacy, terms and safety pages. Never returns anything about a person.",
      inputSchema: { type: "object", properties: { app: appProp("One app. Leave it out for all apps.") }, additionalProperties: false },
      annotations: annotations("About the apps"),
      securitySchemes: noauth,
      _meta: { securitySchemes: noauth },
    },
    {
      name: "start_signup",
      title: "Get the sign-up link",
      description: "Returns the link and the text keyword a person uses to sign themselves up for one app, with plain instructions to give them. It does not sign anyone up and takes no personal details.",
      inputSchema: { type: "object", properties: { app: appProp("The app to join.") }, required: ["app"], additionalProperties: false },
      annotations: annotations("Get the sign-up link"),
      securitySchemes: noauth,
      _meta: { securitySchemes: noauth },
    },
    {
      name: "check_status",
      title: `My ${host.name} status`,
      description: `After the person signs in on ${host.domain} and allows access, returns their own status in ${host.name} only (not joined, invited, onboarding, active, stopped or on hold) and what to do next. Never returns anything about other people or other apps.`,
      inputSchema: { type: "object", properties: { app: { type: "string", enum: [host.id], description: `Optional. Always ${host.id}: this connection covers ${host.name} only.` } }, additionalProperties: false },
      annotations: annotations(`My ${host.name} status`),
      securitySchemes: oauth,
      _meta: { securitySchemes: oauth },
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
      annotations: { title: `Send my profile to ${host.name}`, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      securitySchemes: [{ type: "oauth2", scopes: ["profile:write"] }],
      _meta: { securitySchemes: [{ type: "oauth2", scopes: ["profile:write"] }] },
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
      annotations: annotations(`My ${host.name} updates`),
      securitySchemes: oauth,
      _meta: { securitySchemes: oauth },
    },
  ];
}

export type ToolOutcome =
  | { kind: "ok"; data: Record<string, unknown> | Record<string, unknown>[] | { apps: unknown[] } }
  | { kind: "error"; message: string }
  /** The grant no longer matches the person who owns the phone: answer 401 like an invalid token. */
  | { kind: "invalid_grant" };

const NOT_AVAILABLE = "That app is not available here.";

/** Validate the arguments against the tool's schema: only listed properties, enum values only. */
/**
 * A phone number, an email address or a verification code in the profile text: refused, never stored.
 * A standalone 5-digit US zip ("11211") is fine, as are age ranges ("25-35") next to it. Refused: an
 * email; any run of digits and separators with 7 or more digits (a phone, "(415) 555-0102"); a
 * 4-digit or 6- to 10-digit number (a code).
 */
export function contactOrCode(text: string): boolean {
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) return true;
  for (const m of text.matchAll(/(?<![\w])\+?[\d(][\d\s().-]*\d(?![\w])/g)) {
    const run = m[0];
    const tokens = run.trim().split(/\s+/);
    // Zips and short numbers ("11211", "25-35", "5"), as long as the short ones could not spell a phone.
    const ok = tokens.every(t => /^\d{5}$/.test(t) || /^\d{1,3}(?:-\d{1,3})?$/.test(t))
      && tokens.filter(t => !/^\d{5}$/.test(t)).join("").replace(/\D/g, "").length < 7;
    if (ok) continue;
    if (run.replace(/\D/g, "").length >= 7) return true;
    if (tokens.some(t => /^\(?\d{4}\)?$|^\(?\d{6,10}\)?$/.test(t.replace(/[.-]$/, "")))) return true;
  }
  return false;
}

export function checkArgs(name: ToolName, args: unknown, enumIds: string[], host: McpApp): { ok: true; app?: string; about?: string; token?: string } | { ok: false; message: string } {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return { ok: false, message: "Arguments must be an object." };
  const a = args as Record<string, unknown>;
  const extra = Object.keys(a).filter(k => k !== "app" && !(name === "submit_profile" && k === "about") && !(name === "get_updates" && k === "update_token"));
  // Refuse, never ignore: a phone, a code, a name or an age is never accepted by any tool.
  if (extra.length) return { ok: false, message: `This tool does not take ${extra.map(k => `"${k.slice(0, 40)}"`).join(", ")}. It never takes phone numbers, codes or personal details.` };
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
  if (name === "check_status" && a.app !== host.id) return { ok: false, message: `This connection covers ${host.name} only. To check another app, connect to that app's own site.` };
  if (name !== "check_status" && !enumIds.includes(a.app)) return { ok: false, message: NOT_AVAILABLE };
  return { ok: true, app: a.app };
}

function publicInfo(a: McpApp, surface: Surface) {
  return {
    id: a.id, name: a.name, site: a.links.site, what: a.what,
    powered_by: "All of these apps are powered by The Network (https://ntwrk.party).",
    join: {
      mode: a.joinMode,
      url: `${a.links.join}?via=agent`,
      keyword: a.keyword,
      how: a.keyword
        ? `The person texts "${a.keyword}" as their first message to The Network's line, or opens ${a.links.join} and verifies their own phone there.`
        : `The person texts The Network's line with no keyword, or opens ${a.links.join}. The agent asks what they are looking for (${surface === "openai" ? "friends or work" : "friends, dating or work"}) and adds the right apps.`,
    },
    ages: { join: a.ages.join, matching: a.ages.match },
    adults_only: a.adultsOnly,
    stop: "Texting STOP on the shared line stops every app. \"leave " + a.domain + "\" (or the leave button on the site) stops this app only.",
    consent_rules: [
      "Nobody is introduced unless both people say yes.",
      "Nothing crosses from one app to another unless the person shares it.",
      "The person signs themselves up and types their own code on the site. An assistant never handles the code.",
    ],
    links: { privacy: a.links.privacy, terms: a.links.terms, sms_terms: a.links.smsTerms, safety: a.links.safety, settings: a.links.settings, support: a.links.support },
  };
}

const NEXT: Record<PublicStatus, (a: McpApp) => string> = {
  not_joined: a => `Not joined. To join, open ${a.links.join} and sign up there.`,
  invited: a => `Invited. To accept, open ${a.links.join} or reply to the invitation text.`,
  waitlisted: a => `On the waitlist: ${a.name} is invite-only for now. A member or the team can invite the person.`,
  onboarding: () => "Joining is not finished. Reply to the last text from the agent to finish.",
  active: () => "Active. Nothing to do. The agent texts when it has something worth the person's time.",
  stopped: a => `Messages are stopped. To start again, text START to the line or open ${a.links.settings}.`,
  on_hold: a => `On hold. The person should open ${a.links.settings} or email ${a.links.support.replace("mailto:", "")}.`,
};

export interface CallContext {
  apps: Record<McpAppId, McpApp>;
  surface: Surface;
  host: McpApp;
  hooks: PlatformHooks;
  grant: Grant | null;
  /** Which assistant the OAuth client is (by its redirect hosts): chatgpt, claude, grok, or web. */
  assistant?: AssistantKind;
}

/**
 * Whether a grant still belongs to the number's person. A different person now means a new owner
 * after staff review. A grant made while the number had no person never follows a person created
 * later (who may be someone else): it is dead, and the person connects again (audit: null-person grant).
 */
export function grantStillTheirs(atConsent: string | null, now: string | null): boolean {
  return atConsent === null ? now === null : now === atConsent;
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
          app: a.id, url: `${a.links.join}?via=agent`, keyword: a.keyword,
          instructions_for_person: `Open ${a.links.join}?via=agent yourself and enter your own phone number. ` +
            `A code arrives by text: type it on that page only. Never share the code with anyone, including this assistant.` +
            (a.keyword ? ` Or text "${a.keyword}" as your first message to The Network's line.` : ""),
          ages: { join: a.ages.join, matching: a.ages.match },
        },
      };
    }
    case "check_status": {
      const g = c.grant;
      if (!g) return { kind: "invalid_grant" };
      const now = await c.hooks.personForKey(g.phoneKey);
      if (!grantStillTheirs(g.personId, now)) return { kind: "invalid_grant" };
      const status: PublicStatus = now === null ? "not_joined" : await c.hooks.status(now, g.app);
      const a = c.apps[g.app];
      return { kind: "ok", data: { app: a.id, status, next_step: NEXT[status](a), manage_url: a.links.settings } };
    }
    case "submit_profile": {
      const g = c.grant;
      if (!g) return { kind: "invalid_grant" };
      const now = await c.hooks.personForKey(g.phoneKey);
      if (!grantStillTheirs(g.personId, now)) return { kind: "invalid_grant" };
      const a = c.apps[g.app];
      if (!c.hooks.submitProfile) return { kind: "error", message: "Profiles cannot be sent here yet." };
      const status: PublicStatus = now === null ? "not_joined" : await c.hooks.status(now, g.app);
      // Only a joined, live member: the profile never creates a member and never reaches a stopped or held one.
      if (now === null || (status !== "active" && status !== "onboarding")) return { kind: "ok", data: { app: a.id, submitted: false, status, next_step: NEXT[status](a) } };
      const r = await c.hooks.submitProfile(now, g.app, g.phoneKey, chk.about!);
      if (r !== "accepted") return { kind: "ok", data: { app: a.id, submitted: false, status: "not_joined", next_step: NEXT.not_joined(a) } };
      return { kind: "ok", data: { app: a.id, submitted: true, next_step: `${a.name} has it. It may text the person a short question or two.` } };
    }
    case "get_updates": {
      const g = c.grant;
      if (!g) return { kind: "invalid_grant" };
      const now = await c.hooks.personForKey(g.phoneKey);
      if (!grantStillTheirs(g.personId, now)) return { kind: "invalid_grant" };
      const a = c.apps[g.app];
      if (!c.hooks.updates) return { kind: "error", message: "Updates are not available here yet." };
      // Someone else's reference, an unknown one or an expired one reads as "nothing new", like an empty inbox.
      // The output leak gate: a summary with a phone, email, internal id or timestamp is withheld (leaks.ts).
      const updates = now === null ? [] : (await c.hooks.updates(now, g.app, c.assistant ?? "web", chk.token)).filter(u => outputLeaks(u.summary).length === 0);
      return { kind: "ok", data: { app: a.id, updates, next_step: updates.length ? "Tell the person briefly. They answer by replying to the text." : `Nothing new from ${a.name}.` } };
    }
  }
}
