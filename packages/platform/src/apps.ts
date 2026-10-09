// The four apps on one backend (PRD 40; docs/research/2026-10-08-platform-architecture.md). Policy
// values here are the founder decisions of 2026-10-08 (AGENTS.md "Platform decisions") and match the
// platform.apps rows (migrations 0003 and 0007). Change them in one place: the database rows for a
// running server, this file for code that has no database (tests, the simulator).
//  - Join age 13 on every app; matching 18+ everywhere (minors are single-player).
//  - One line for every app: the first message routes by keyword (APP_KEYWORDS). With no keyword the
//    person joins The Network, which asks what they are looking for (LOOKING_FOR).
//  - STOP on the shared line stops every app; "leave <app>" leaves one.

export const APP_IDS = ["ntwrk", "slop", "peon", "friends"] as const;
export type AppId = (typeof APP_IDS)[number];
export const isAppId = (v: unknown): v is AppId => typeof v === "string" && (APP_IDS as readonly string[]).includes(v);

export type JoinMode = "invite" | "open" | "waitlist";

/** The member-facing words of one app. Every text here needs the CONTRIBUTING.md 3.5 videos when it changes. */
export interface AppBrand {
  /** How the agent names itself. */
  agentName: string;
  /** Reply to STOP (the shared line, STOP ALL, the site's stop button): every app on this number stops. */
  stop: string;
  /** Reply to STOP on this app's own line when PLATFORM_STOP_SCOPE=app: this app only. */
  stopApp: string;
  start: string;
  help: string;
  /** The polite answer when a person tries to join an invite-only app on its site. */
  inviteOnly: string;
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
/** The one support address for every app: only ntwrk.love receives mail (MX), and every site and SKILL.md names it. */
export const SUPPORT_EMAIL = "help@ntwrk.love";
const CONSENT_VERSION = "2026-10-08";
const consentText = (sender: string, what: string) =>
  `I agree to receive recurring text messages from ${sender} at this number: ${what}. Message frequency varies. Message and data rates may apply. Reply STOP to stop and HELP for help. Consent is not a condition of any purchase.`;

function brand(name: string, domain: string, agentName: string, what: string, minJoinAge: number): AppBrand {
  return {
    agentName,
    stop: `You're unsubscribed and won't get more messages from any app on this number. Reply START to resume ${name}.`,
    stopApp: `You're unsubscribed from ${name} and won't get more messages from it. Reply START to resume.`,
    start: `You're back on ${name}. Reply STOP anytime to stop all messages, HELP for help.`,
    help: `${name}: ${what} Message frequency varies. Reply STOP to stop all messages on this number, or "leave ${domain}" to leave ${name} only. Help: ${SUPPORT_EMAIL}`,
    inviteOnly: `${name} is invite-only right now. If a member invites you, you can join then.`,
    underAge: `Thanks for your interest in ${name}. You need to be at least ${minJoinAge} to join, so we can't sign you up.`,
  };
}

export const APPS: Record<AppId, AppInfo> = {
  ntwrk: {
    id: "ntwrk", name: "The Network", domain: "ntwrk.love", joinMode: "invite", minJoinAge: 13, minMatchAge: 18,
    brand: brand("The Network", "ntwrk.love", "the Network's agent", "messages about people, plans, and events you asked for.", 13),
    consent: { version: CONSENT_VERSION, text: consentText("The Network", "replies, introductions and plans I ask for, reminders, and occasional suggestions") },
  },
  slop: {
    id: "slop", name: "slop", domain: "slop.date", joinMode: "open", minJoinAge: 13, minMatchAge: 18,
    brand: brand("slop", "slop.date", "slop's matchmaker", "dating introductions you asked for, only with mutual opt-in.", 13),
    consent: { version: CONSENT_VERSION, text: consentText("slop.date", "questions from the matchmaker, introductions I agree to, date plans and reminders") },
  },
  peon: {
    id: "peon", name: "peon", domain: "peon.biz", joinMode: "open", minJoinAge: 13, minMatchAge: 18,
    brand: brand("peon", "peon.biz", "peon's recruiter", "job and hiring introductions you asked for.", 13),
    consent: { version: CONSENT_VERSION, text: consentText("peon.biz", "questions about work or hiring, waitlist updates, introductions I agree to, and scheduling reminders") },
  },
  friends: {
    id: "friends", name: "friends", domain: "friends.help", joinMode: "open", minJoinAge: 13, minMatchAge: 18,
    brand: brand("friends", "friends.help", "friends.help's planner", "friends and plans in New York City that you asked for.", 13),
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

/**
 * What a person who joined The Network with no keyword says they are looking for, as app ids
 * (founder decision 2: friends, dating, work). A negated word ("not dating") does not count.
 */
export function lookingFor(text: string): AppId[] {
  // "I work at a bank" describes the person, not what they want.
  const t = ` ${text.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}' ]+/gu, " ").replace(/\s+/g, " ")} `
    .replace(/ (i|i'm|im|i am) (work|working|worked|date|dating|dated) /g, " ");
  const neg = "(?:not|no|never|don't want|dont want|without)(?: \\S+){0,2} ";
  const want = (words: string) => new RegExp(` (${words}) `).test(t) && !new RegExp(` ${neg}(${words}) `).test(t);
  const out: AppId[] = [];
  if (want("friends?|friendship|friendships|new people|people to hang out with|hanging out|hang out|social life|crew")) out.push("friends");
  if (want("dating|date|dates|love|romance|romantic|relationship|a relationship|partner|boyfriend|girlfriend|someone to date")) out.push("slop");
  if (want("work|job|jobs|hiring|hire|career|employment|recruiting|a job|clients|gigs?")) out.push("peon");
  if (/ (all|all of (them|it|these)|everything|all three) /.test(t)) for (const a of ["friends", "slop", "peon"] as const) if (!out.includes(a)) out.push(a);
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
export const PAGES_PROJECT: Record<AppId, string> = { ntwrk: "ntwrk-love", slop: "slop-date", peon: "peon-biz", friends: "friends-help" };

/** Every production host name of an app's site: its domain, www, and its Pages production name. */
export const siteHosts = (a: AppId): string[] => [APPS[a].domain, `www.${APPS[a].domain}`, `${PAGES_PROJECT[a]}.pages.dev`];

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
