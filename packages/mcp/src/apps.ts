// The public facts about each app that the MCP server may tell an agent (app_info, start_signup).
// Nothing here is about a person. The join mode and the ages come from the platform registry
// (packages/platform/src/apps.ts) when it has the app, so the server and the sites cannot drift.
import { APPS as PLATFORM_APPS, DOMAIN_IDS, isDomainId, PAGES_PROJECT, SUPPORT_EMAIL, type DomainId } from "@thenetwork/platform";
import { APP_IDS as MCP_APP_IDS, isAppId as isMcpAppId, LAUNCH_CITIES, type AppId as McpAppId, type CityId } from "../../core/src/types.ts";
import { type AppId as ConnectorApp, type Surface as ConnectorSurface, appListed, appOffered, hostBindsApp } from "../../core/src/generated/connectorTools.ts";
import { appEndpointPath, appOpenAiEndpointPath } from "../../core/src/generated/agentEntry.ts";
import { teenFriendApp } from "../../core/src/generated/matchLane.ts";

export { DOMAIN_IDS, isDomainId, MCP_APP_IDS, isMcpAppId, type DomainId, type McpAppId };

export type Surface = "full" | "openai";

/** The generated app name of each registry id (spec/connectorTools.md:9). */
export const connectorApp: Record<McpAppId, ConnectorApp> = { ntwrk: "Ntwrk", slop: "Slop", peon: "Peon", friends: "Friends" };

/** The generated surface name of each client surface (spec/connectorTools.md:9). */
export const connectorSurface: Record<Surface, ConnectorSurface> = { full: "FullSurface", openai: "OpenAiSurface" };

export interface McpApp {
  id: McpAppId;
  name: string;
  domain: string;
  /** One line: what the app is for. */
  what: string;
  /** The word a person texts first to join this app. null: no keyword (The Network as a whole). */
  keyword: string | null;
  joinMode: "invite" | "open" | "waitlist";
  ages: { join: number; match: number };
  /** Rules that apply to adults only, in plain words. */
  adultsOnly: string[];
  consent: { text: string; version: string };
  cities: readonly CityId[];
  links: { site: string; join: string; privacy: string; terms: string; smsTerms: string | null; support: string };
  openai: boolean;
}

const TEEN_FRIEND_RULE = "Matching is for adults 18 or older, except friendship introductions between people aged 13 to 18 born at most 2 years apart, after an automatic check approves each one.";
export const DATING_AGE_RULE = "Nobody under 18 is matched for dates or work on this app. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.";
export const WORK_AGE_RULE = "Nobody under 18 is matched for work on this app. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.";

function app(id: McpAppId, name: string, domain: string, what: string, keyword: string | null, extra: { adultsOnly?: string[]; smsTerms?: boolean }): McpApp {
  const p = PLATFORM_APPS[id];
  const site = `https://${domain}`;
  return {
    id, name, domain, what, keyword,
    joinMode: p.joinMode,
    ages: { join: p.minJoinAge, match: p.minMatchAge },
    adultsOnly: [teenFriendApp(id) ? TEEN_FRIEND_RULE : DATING_AGE_RULE, ...(extra.adultsOnly ?? [])],
    consent: { text: p.consent.text, version: p.consent.version },
    cities: LAUNCH_CITIES,
    links: {
      site, join: `${site}/join`, privacy: `${site}/privacy`, terms: `${site}/terms`,
      smsTerms: extra.smsTerms === false ? null : `${site}/terms#sms`,
      support: `mailto:${SUPPORT_EMAIL}`,
    },
    openai: appOffered(connectorSurface.openai, connectorApp[id]),
  };
}

/** The default registry: the four apps, all powered by The Network. */
export function defaultApps(): Record<McpAppId, McpApp> {
  return {
    ntwrk: app("ntwrk", "The Network", "ntwrk.party", "The home of every app below: an agent you text that helps with people, plans and events you ask for.", null, { smsTerms: false }),
    slop: app("slop", "slop.date", "slop.date", "Dating by text message. A matchmaker suggests one person now and then, and nobody is introduced unless both say yes.", "slop", {
      adultsOnly: ["Photos and any rating of looks are for adults (18+) only; the stated age counts (no ID check). They are never asked of, stored for or shown to anyone under 18."],
    }),
    peon: app("peon", "peon.biz", "peon.biz", "Work and hiring by text message. It introduces people looking for work to people hiring, and a person makes every decision.", "peon", {}),
    friends: app("friends", "friends.help", "friends.help", "Friends and plans in NYC, SF, LA, Chicago and Miami by text message, in small groups at public places.", "friends", {}),
  };
}

/** The apps that a connection to one app's endpoint on a surface may name, in registry order (spec/connectorTools.md:16). */
export const appsOn = (apps: Record<McpAppId, McpApp>, surface: Surface, host: McpAppId): McpApp[] =>
  MCP_APP_IDS.map(id => apps[id]).filter(a => a && appListed(connectorSurface[surface], connectorApp[host], connectorApp[a.id]));

/** The matching domains that a connection on a surface may advertise or manage (never dating on non-dating OpenAI surfaces). */
export const domainsOn = (surface: Surface, host: McpAppId): DomainId[] =>
  appListed(connectorSurface[surface], connectorApp[host], connectorApp.slop)
    ? [...DOMAIN_IDS]
    : DOMAIN_IDS.filter(d => d !== "dating");

/** The default Host header map: each domain, its www name and its Pages name. Dev ports are added by the caller. */
export function defaultHostMap(apps: Record<McpAppId, McpApp>): Record<string, McpAppId> {
  const out: Record<string, McpAppId> = {};
  for (const a of Object.values(apps)) {
    out[a.domain] = a.id; out[`www.${a.domain}`] = a.id;
    // The site's Cloudflare Pages production name (founder decision 8) serves the same app.
    const project = (PAGES_PROJECT as Record<string, string | undefined>)[a.id];
    if (project) out[`${project}.pages.dev`] = a.id;
  }
  return out;
}

/** Local dev: the site ports 5101-5104 in the order the sites use (scripts/sites-dev.ts). */
export const devHostMap = (): Record<string, McpAppId> =>
  Object.fromEntries(MCP_APP_IDS.flatMap((a, i) => [[`localhost:${5101 + i}`, a], [`127.0.0.1:${5101 + i}`, a]]));

export function mcpPath(host: McpAppId, app: McpAppId, surface: Surface): string | undefined {
  if (!hostBindsApp(connectorApp[host], connectorApp[app])) return undefined;
  const key = app === host ? connectorApp.ntwrk : connectorApp[app];
  return surface === "openai" ? appOpenAiEndpointPath(key) : appEndpointPath(key);
}

export function appAtPath(host: McpAppId, path: string): { app: McpAppId; surface: Surface } | undefined {
  const m = /^\/mcp(?:\/([a-z]+))?(\/openai)?$/.exec(path);
  if (!m) return undefined;
  const surface: Surface = m[2] ? "openai" : "full";
  if (m[1] === undefined) return { app: host, surface };
  if (m[1] === "openai" && !m[2]) return { app: host, surface: "openai" };
  const app = m[1];
  if (!isMcpAppId(app) || app === host) return undefined;
  return mcpPath(host, app, surface) === path ? { app, surface } : undefined;
}
