// The four apps on one backend (docs/research/2026-10-08-platform-architecture.md). Policy values
// here are the founder defaults of 2026-10-08 and match the platform.apps seed rows (migration
// 0003). Change them in one place: the database rows for a running server, this file for code
// that has no database (tests, the simulator).

export const APP_IDS = ["ntwrk", "slop", "peon", "buddies"] as const;
export type AppId = (typeof APP_IDS)[number];
export const isAppId = (v: unknown): v is AppId => typeof v === "string" && (APP_IDS as readonly string[]).includes(v);

export type JoinMode = "invite" | "open" | "waitlist";

/** The member-facing words of one app. Every text here needs the CONTRIBUTING.md 3.5 videos when it changes. */
export interface AppBrand {
  /** How the agent names itself. */
  agentName: string;
  /** Reply to STOP on this app's line: this app only, with the STOP ALL option. */
  stop: string;
  /** Reply to STOP ALL (or to STOP when PLATFORM_STOP_SCOPE=global). */
  stopAll: string;
  start: string;
  help: string;
  /** The polite answer when a person tries to join an invite-only app. */
  inviteOnly: string;
  /** The kind decline for a person under the join age. Says nothing more than needed. */
  underAge: string;
}

export interface AppInfo {
  id: AppId;
  name: string;
  domain: string;
  joinMode: JoinMode;
  minJoinAge: number;
  minMatchAge: number;
  brand: AppBrand;
}

const STOP_ALL = "Reply STOP ALL to stop every app.";
const support = (domain: string) => `help@${domain}`;

function brand(name: string, domain: string, agentName: string, what: string, minJoinAge: number): AppBrand {
  return {
    agentName,
    stop: `You're unsubscribed from ${name} and won't get more messages here. Other apps you use with this number are not affected. ${STOP_ALL} Reply START to resume.`,
    stopAll: `You're unsubscribed from every app on this number and won't get more messages. Reply START to resume ${name}.`,
    start: `You're back on ${name}. Reply STOP anytime to opt out, HELP for help.`,
    help: `${name}: ${what} Message frequency varies. Reply STOP to opt out of ${name}. ${STOP_ALL} Help: ${support(domain)}`,
    inviteOnly: `${name} is invite-only right now. If a member invites you, you can join then.`,
    underAge: `Thanks for your interest in ${name}. You need to be at least ${minJoinAge} to join, so we can't sign you up.`,
  };
}

export const APPS: Record<AppId, AppInfo> = {
  ntwrk: {
    id: "ntwrk", name: "The Network", domain: "ntwrk.love", joinMode: "invite", minJoinAge: 13, minMatchAge: 18,
    brand: brand("The Network", "ntwrk.love", "the Network's agent", "invite-only messages about people, plans, and events you asked for.", 13),
  },
  slop: {
    id: "slop", name: "slop", domain: "slop.date", joinMode: "open", minJoinAge: 18, minMatchAge: 18,
    brand: brand("slop", "slop.date", "slop's matchmaker", "dating introductions you asked for, only with mutual opt-in.", 18),
  },
  peon: {
    id: "peon", name: "peon", domain: "peon.biz", joinMode: "open", minJoinAge: 18, minMatchAge: 18,
    brand: brand("peon", "peon.biz", "peon's recruiter", "job and hiring introductions you asked for.", 18),
  },
  buddies: {
    id: "buddies", name: "buddies", domain: "buddies.nyc", joinMode: "open", minJoinAge: 18, minMatchAge: 18,
    brand: brand("buddies", "buddies.nyc", "your buddies.nyc friend", "friends and plans in New York City that you asked for.", 18),
  },
};

/** The network id for an app and a city: network.network_state.id and platform.networks.id. */
export const networkId = (app: AppId, city: string) => `${app}:${city}`;

/** A legacy network id ('nyc') belongs to ntwrk. */
export function parseNetworkId(id: string): { app: AppId; city: string } | undefined {
  if (!id.includes(":")) return { app: "ntwrk", city: id };
  const [app, city] = id.split(":");
  return isAppId(app) && city ? { app, city } : undefined;
}

/** Host header -> app. The production domains, their www names, and localhost ports 5101-5104 for dev. */
export const DEFAULT_HOST_MAP: Record<string, AppId> = {
  "ntwrk.love": "ntwrk", "www.ntwrk.love": "ntwrk",
  "slop.date": "slop", "www.slop.date": "slop",
  "peon.biz": "peon", "www.peon.biz": "peon",
  "buddies.nyc": "buddies", "www.buddies.nyc": "buddies",
  ...Object.fromEntries(APP_IDS.flatMap((a, i) => [[`localhost:${5101 + i}`, a], [`127.0.0.1:${5101 + i}`, a]])),
};

export function appForHost(host: string | null | undefined, map: Record<string, AppId> = DEFAULT_HOST_MAP): AppId | undefined {
  if (!host) return undefined;
  return map[host.trim().toLowerCase().replace(/\.$/, "")];
}

/** Public facts about an app (GET /api/app). */
export const publicAppInfo = (a: AppInfo) => ({ id: a.id, name: a.name, domain: a.domain, joinMode: a.joinMode, minJoinAge: a.minJoinAge });
