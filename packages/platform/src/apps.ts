import { ADULT_AGE, MIN_MEMBER_AGE } from "../../core/src/policy.ts";
import {
  APP_IDS, APP_TO_DOMAIN, BRAND_DEFAULT_DOMAINS, DOMAIN_IDS, DOMAIN_LABELS, DOMAIN_TO_APP,
  isAppId, isBusinessDomain, isDatingDomain, isDomainId, isFriendshipDomain, toDomainId,
  type AppId, type DomainId,
} from "../../core/src/types.ts";
import { lookingForApps, type LookingForMention, type LookingForReading } from "../../core/src/generated/lineRouting.ts";
import {
  defaultDomainsForJoin, domainAllowedForAge,
  type Brand as MemberDomainBrand, type Domain as MemberDomain,
} from "../../core/src/generated/memberDomains.ts";
export {
  APP_IDS, APP_TO_DOMAIN, BRAND_DEFAULT_DOMAINS, DOMAIN_IDS, DOMAIN_LABELS, DOMAIN_TO_APP,
  isAppId, isBusinessDomain, isDatingDomain, isDomainId, isFriendshipDomain, toDomainId,
  type AppId, type DomainId,
};

// ---- Generic domains (dating, friendship, business) ----

const APP_TO_BRAND: Record<AppId, MemberDomainBrand> = {
  ntwrk: "NtwrkBrand",
  slop: "SlopBrand",
  peon: "PeonBrand",
  friends: "FriendsBrand",
};

const MEMBER_DOMAIN_TO_ID: Record<MemberDomain, DomainId> = {
  Dating: "dating",
  Friendship: "friendship",
  Business: "business",
};

const ID_TO_MEMBER_DOMAIN: Record<DomainId, MemberDomain> = {
  dating: "Dating",
  friendship: "Friendship",
  business: "Business",
};

export function toMemberDomain(domain: DomainId): MemberDomain {
  return ID_TO_MEMBER_DOMAIN[domain];
}

export function fromMemberDomain(domain: MemberDomain): DomainId {
  return MEMBER_DOMAIN_TO_ID[domain];
}

export function toMemberDomainBrand(app: AppId): MemberDomainBrand {
  return APP_TO_BRAND[app];
}

export function defaultDomainsForBrand(app: AppId, ageYears?: number | null): DomainId[] {
  if (ageYears === null || ageYears === undefined) return [...BRAND_DEFAULT_DOMAINS[app]];
  if (!Number.isFinite(ageYears)) return [];
  return defaultDomainsForJoin(APP_TO_BRAND[app], Math.floor(ageYears)).map(fromMemberDomain);
}

export function availableDomainsForAge(ageYears?: number | null): DomainId[] {
  if (ageYears === null || ageYears === undefined || !Number.isFinite(ageYears)) return [];
  const age = Math.floor(ageYears);
  return DOMAIN_IDS.filter(d => domainAllowedForAge(ID_TO_MEMBER_DOMAIN[d], age));
}

export interface DomainCommand {
  action: "enable" | "disable" | "list";
  domains: DomainId[];
}

const DOMAIN_LIST_PATTERNS = [
  /^(?:(?:show|list|view|check|get)\s+)?(?:my\s+)?(?:active\s+|enabled\s+)?domains$/,
  /^(?:what|which)\s+domains\b/,
];

const DOMAIN_DISABLE_CUE = /\b(?:disable|turn\s+off|switch\s+off|stop|pause|remove|opt\s+out(?:\s+of)?|leave|drop|deactivate|no\s+more)\b/;
const DOMAIN_ENABLE_CUE = /\b(?:enable|turn\s+on|switch\s+on|add|join|opt\s+in(?:\s+to)?|activate|start|resume|also\s+match(?:\s+me)?(?:\s+for)?|match\s+me(?:\s+for)?|sign\s+me\s+up(?:\s+for)?|include|open\s+up(?:\s+to)?)\b/;

const DOMAIN_ALIAS_PATTERNS: ReadonlyArray<{ domain: DomainId; re: RegExp }> = [
  { domain: "dating", re: /\b(?:dating|dates?|romance|romantic|slop(?:\.date|\s+date)?)\b/ },
  { domain: "friendship", re: /\b(?:friendships?|friends?(?:\.help|\s+help)?|social|hang\s*out)\b/ },
  { domain: "business", re: /\b(?:business|work|jobs?|hiring|hire|co[-\s]?founders?|career|recruiting|peon(?:\.biz|\s+biz)?)\b/ },
];

const PERSONAL_PAUSE_PREFIX_RE = /^(?:(?:please|can\s+you|could\s+you)\s+)?(?:pause|stop|resume)\s+me\b/;

export function parseDomainCommand(text: string): DomainCommand | null {
  const norm = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s.'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?.!]+$/, "");
  if (!norm) return null;
  if (DOMAIN_LIST_PATTERNS.some(re => re.test(norm))) {
    return { action: "list", domains: [] };
  }
  if (PERSONAL_PAUSE_PREFIX_RE.test(norm)) return null;
  const hasDisable = DOMAIN_DISABLE_CUE.test(norm);
  const hasEnable = DOMAIN_ENABLE_CUE.test(norm);
  if (!hasDisable && !hasEnable) return null;
  const action: "enable" | "disable" = hasDisable ? "disable" : "enable";
  const matched: Array<{ domain: DomainId; index: number }> = [];
  if (/\b(?:all\s+domains|all\s+three|everything)\b/.test(norm)) {
    return { action, domains: [...DOMAIN_IDS] };
  }
  const domainScan = norm.replace(/\b(?:at|from|after|before)\s+work\b/g, " ");
  for (const { domain, re } of DOMAIN_ALIAS_PATTERNS) {
    const m = re.exec(domainScan);
    if (m) matched.push({ domain, index: m.index });
  }
  if (!matched.length) return null;
  matched.sort((a, b) => a.index - b.index);
  return { action, domains: matched.map(m => m.domain) };
}

// ---- Brand frontends (slop.date, peon.biz, friends.help, ntwrk.party) ----

export type JoinMode = "invite" | "open" | "waitlist";

/** The member-facing words of one app. Every text here needs the CONTRIBUTING.md 3.5 videos when it changes. */
export interface AppBrand {
  /** How the agent names itself. */
  agentName: string;
  stop: string;
  start: string;
  help: string;
  /** The polite answer when a person tries to join an invite-only app on its site. */
  inviteOnly: string;
  /** The one reply to a person who sent STOP and then texts again (at most once in 30 days): how to resume. */
  stoppedHint: string;
  /** The kind decline for a person under the join age. Says nothing more than needed. */
  underAge: string;
}

/** The SMS opt-in wording a site shows next to the consent box. A join stores the text and its version, never what the client sent. */
export interface ConsentText { version: string; text: string }

export interface AppInfo {
  id: AppId;
  name: string;
  domain: string;
  joinMode: JoinMode;
  minJoinAge: number;
  minMatchAge: number;
  brand: AppBrand;
  consent: ConsentText;
}

/** The line in every app's onboarding (founder decision 2). */
export const POWERED_BY = "All of these apps are powered by The Network.";
/** The one support address for every app: only ntwrk.party receives mail (MX), and every site and SKILL.md names it. */
export const SUPPORT_EMAIL = "help@ntwrk.party";
const CONSENT_VERSION = "2026-10-08";
const consentText = (sender: string, what: string) =>
  `I agree to receive recurring text messages from ${sender} at this number: ${what}. Message frequency varies. Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase.`;

function brand(name: string, domain: string, agentName: string, what: string, minJoinAge: number): AppBrand {
  return {
    agentName,
    stop: `You're unsubscribed and won't get more messages from any app on this number. Reply START to resume ${name}.`,
    start: `You're back on ${name}. Reply STOP anytime to stop all messages, HELP for help.`,
    help: `${name}: ${what} Message frequency varies. Reply STOP to stop all messages on this number, or "leave ${domain}" to leave ${name} only. Help: ${SUPPORT_EMAIL}`,
    inviteOnly: `${name} is invite-only right now. If a member invites you, you can join then.`,
    stoppedHint: `You're unsubscribed from ${name}, so I can't reply. Reply START to resume.`,
    underAge: `Thanks for your interest in ${name}. You need to be at least ${minJoinAge} to join, so we can't sign you up.`,
  };
}

export const APPS: Record<AppId, AppInfo> = {
  ntwrk: {
    id: "ntwrk", name: "The Network", domain: "ntwrk.party", joinMode: "invite", minJoinAge: MIN_MEMBER_AGE, minMatchAge: ADULT_AGE,
    brand: brand("The Network", "ntwrk.party", "the Network's agent", "messages about people, plans, and events you asked for.", MIN_MEMBER_AGE),
    consent: { version: CONSENT_VERSION, text: consentText("The Network", "replies, introductions and plans I ask for, reminders, and occasional suggestions") },
  },
  slop: {
    id: "slop", name: "slop", domain: "slop.date", joinMode: "open", minJoinAge: MIN_MEMBER_AGE, minMatchAge: ADULT_AGE,
    brand: brand("slop", "slop.date", "slop's matchmaker", "dating introductions you asked for, only with mutual opt-in.", MIN_MEMBER_AGE),
    consent: { version: CONSENT_VERSION, text: consentText("slop.date", "questions from the matchmaker, introductions I agree to, date plans and reminders") },
  },
  peon: {
    id: "peon", name: "peon", domain: "peon.biz", joinMode: "open", minJoinAge: MIN_MEMBER_AGE, minMatchAge: ADULT_AGE,
    brand: brand("peon", "peon.biz", "peon's recruiter", "job and hiring introductions you asked for.", MIN_MEMBER_AGE),
    consent: { version: CONSENT_VERSION, text: consentText("peon.biz", "questions about work or hiring, waitlist updates, introductions I agree to, and scheduling reminders") },
  },
  friends: {
    id: "friends", name: "friends", domain: "friends.help", joinMode: "open", minJoinAge: MIN_MEMBER_AGE, minMatchAge: ADULT_AGE,
    brand: brand("friends", "friends.help", "friends.help's planner", "friends and plans in your city that you asked for.", MIN_MEMBER_AGE),
    consent: { version: CONSENT_VERSION, text: consentText("friends.help", "questions about what I like to do, invitations to plans, plan details and reminders") },
  },
};

/** The whole first message that names an app on the shared line ("slop", "slop.date", "join slop"). Data, so a line table can extend it. */
export const APP_KEYWORDS: Record<AppId, readonly string[]> = Object.fromEntries(
  APP_IDS.map(a => [a, [a, APPS[a].domain, `www.${APPS[a].domain}`]]),
) as unknown as Record<AppId, readonly string[]>;

/** The app a whole message names (keyword routing on the shared line), or undefined. A word inside a sentence never counts. */
export function keywordApp(text: string, apps: Record<AppId, Pick<AppInfo, "id" | "domain">> = APPS): AppId | undefined {
  const t = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}. ]+/gu, " ").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const bare = t.replace(/^join /, "");
  for (const a of Object.values(apps)) if (bare === a.id || bare === a.domain || bare === `www.${a.domain}`) return a.id;
  // The Network by name ("the network", "network") joins ntwrk like its keyword.
  if ((bare === "the network" || bare === "network") && "ntwrk" in apps) return "ntwrk";
  return undefined;
}

export function lookingForReading(text: string): LookingForReading {
  // "I work at a bank" describes the person, not what they want.
  const t = ` ${text.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[,;.!?]+/g, " , ").replace(/[^\p{L}', ]+/gu, " ").replace(/\s+/g, " ")} `
    .replace(/ (i|i'm|im|i am) (work|working|worked|date|dating|dated) /g, " ");
  const friends = "friends?|friendship|friendships|new people|people to hang out with|hanging out|hang out|social life|crew";
  const dating = "dating|date|dates|for love|find love|in love|romance|romantic|relationship|partner|boyfriend|girlfriend";
  const work = "work|business|job|jobs|hiring|hire|cofounders?|co-founders?|career|employment|recruiting|clients|gigs?";
  const all = "all apps|all of (?:them|it|these|the apps)|everything|all three|anything (?:but|except)";
  const namesAll = new RegExp(` (?:${all}) `).test(t);
  const neg = "not|no|never|nothing|none|neither|nor|without|except|excluding|other than|minus|don't want|dont want|do not want|don't need|dont need";
  const negBut = `anything but|everything but|all but${namesAll ? "|but" : ""}`;
  const stops = "but|just|only|though|however|instead|rather|yes|yeah|yep|maybe|so|also";
  const clause = `(?: (?!(?:,|${stops}) )\\S+)*`;
  const butClause = `(?: (?!(?:,|${stops}|mostly|mainly|especially|particularly|primarily|ideally|preferably) )\\S+)*`;
  const list = `(?: , (?:or|nor)${clause})*`;
  const after = "no|nope|nah|never|not really|no thanks|not for me";
  const refused = (words: string) => new RegExp(` (?:(?:${neg})${clause}|(?:${negBut})${butClause})${list} (?:${words}) `).test(t);
  const mention = (words: string): LookingForMention =>
    refused(words) || new RegExp(` (?:${words}) (?:, )?(?:${after}) (?:,|$)`).test(t)
      ? "MentionRefused" : new RegExp(` (?:${words}) `).test(t) ? "MentionWanted" : "MentionAbsent";
  return {
    friends: mention(friends),
    dating: mention(dating),
    work: mention(work),
    everything: namesAll && !refused(all),
  };
}

export const lookingFor = (text: string): AppId[] => lookingForApps(lookingForReading(text)).filter(isAppId);

export function lookingForDomains(text: string): DomainId[] {
  const out: DomainId[] = [];
  for (const app of lookingFor(text)) {
    const domain = APP_TO_DOMAIN[app];
    if (domain && !out.includes(domain)) out.push(domain);
  }
  return out;
}

/** The network id for an app and a city: network.network_state.id and platform.networks.id. */
export const networkId = (app: AppId, city: string) => `${app}:${city}`;

/** A legacy network id ('nyc') belongs to ntwrk. */
export function parseNetworkId(id: string): { app: AppId; city: string } | undefined {
  if (!id.includes(":")) return { app: "ntwrk", city: id };
  const [app, city] = id.split(":");
  return isAppId(app) && city ? { app, city } : undefined;
}

/**
 * The Cloudflare Pages project of each site (founder decision 8). Its production name
 * <project>.pages.dev serves the site before (and besides) its own domain, so it is a host of that app.
 * Preview deployments (<hash>.<project>.pages.dev) are never hosts: they must not reach production.
 */
export const PAGES_PROJECT: Record<AppId, string> = { ntwrk: "ntwrk-party", slop: "slop-date", peon: "peon-biz", friends: "friends-help" };

/** Explicit staging authorities. Never inferred from visitor headers or used in production builds. */
export function stagingSiteOrigins(env: Record<string, string | undefined> = process.env): Partial<Record<AppId, string>> {
  const raw = env.STAGING_SITE_ORIGINS?.trim();
  if (!raw) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("STAGING_SITE_ORIGINS must be a JSON object"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("STAGING_SITE_ORIGINS must be a JSON object");
  const entries = Object.entries(value);
  if (!entries.length) return {};
  if (env.PLATFORM_ENV !== "staging" || env.DEPLOY_TARGET === "production") throw new Error("STAGING_SITE_ORIGINS is for explicit staging only");
  const out: Partial<Record<AppId, string>> = {}, hosts = new Set<string>();
  const canonical = new Set(APP_IDS.flatMap(id => [APPS[id].domain, `www.${APPS[id].domain}`, `${PAGES_PROJECT[id]}.pages.dev`]));
  for (const [id, rawOrigin] of entries) {
    if (!isAppId(id) || typeof rawOrigin !== "string") throw new Error("STAGING_SITE_ORIGINS must map known apps to HTTPS origins");
    let u: URL;
    try { u = new URL(rawOrigin); } catch { throw new Error("STAGING_SITE_ORIGINS needs exact HTTPS origins"); }
    if (u.protocol !== "https:" || rawOrigin !== u.origin || u.username || u.password || u.hostname.includes("*") || u.hostname.endsWith(".") || canonical.has(u.hostname) || hosts.has(u.hostname)) throw new Error("STAGING_SITE_ORIGINS needs unique, non-production, exact HTTPS origins");
    hosts.add(u.hostname); out[id] = u.origin;
  }
  return out;
}

/** Every production host name of an app's site: its domain, www, and its Pages production name. */
export const siteHosts = (a: AppId, env?: Record<string, string | undefined>): string[] => {
  const stage = env ? stagingSiteOrigins(env)[a] : undefined;
  return stage ? [new URL(stage).hostname] : [APPS[a].domain, `www.${APPS[a].domain}`, `${PAGES_PROJECT[a]}.pages.dev`];
};

/** Host header -> app in production and staging: the four domains, their www names and their Pages names. Never a localhost name. */
export const DEFAULT_HOST_MAP: Record<string, AppId> = Object.fromEntries(
  APP_IDS.flatMap(a => siteHosts(a).map(h => [h, a])),
) as Record<string, AppId>;

/** Dev only: the production names plus the local site ports (ntwrk 5101, slop 5102, peon 5103, friends 5104). */
export const DEV_HOST_MAP: Record<string, AppId> = {
  ...DEFAULT_HOST_MAP,
  ...Object.fromEntries(APP_IDS.flatMap((a, i) => [[`localhost:${5101 + i}`, a], [`127.0.0.1:${5101 + i}`, a]])),
};

export function appForHost(host: string | null | undefined, map: Record<string, AppId> = DEFAULT_HOST_MAP): AppId | undefined {
  if (!host) return undefined;
  return map[host.trim().toLowerCase().replace(/\.$/, "")];
}

/** Public facts about an app (GET /api/app): the join keyword, the ages and the opt-in wording the site must show. */
export const publicAppInfo = (a: AppInfo) => ({
  id: a.id, name: a.name, domain: a.domain, joinMode: a.joinMode, minJoinAge: a.minJoinAge, minMatchAge: a.minMatchAge,
  keywords: [...APP_KEYWORDS[a.id]], poweredBy: POWERED_BY, consent: a.consent,
});
