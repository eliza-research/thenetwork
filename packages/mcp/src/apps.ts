// The public facts about each app that the MCP server may tell an agent (app_info, start_signup).
// Nothing here is about a person. The join mode and the ages come from the platform registry
// (packages/platform/src/apps.ts) when it has the app, so the server and the sites cannot drift.
import { APPS as PLATFORM_APPS, PAGES_PROJECT, SUPPORT_EMAIL } from "@thenetwork/platform";
import { APP_IDS as MCP_APP_IDS, isAppId as isMcpAppId, type AppId as McpAppId } from "../../core/src/types.ts";
import { type AppId as ConnectorApp, type Surface as ConnectorSurface, appOffered, hostBindsApp } from "../../core/src/generated/connectorTools.ts";

export { MCP_APP_IDS, isMcpAppId, type McpAppId };

/**
 * Which client surface a request comes from. "openai" serves ChatGPT and Codex clients. It offers every app,
 * slop included (spec/connectorTools.md, "Each surface offers every app").
 */
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
  links: { site: string; join: string; privacy: string; terms: string; smsTerms: string | null; support: string };
  /** False: not listed or offered on the OpenAI surface (the registry can disable an app there; spec/connectorTools.md). */
  openai: boolean;
}

function app(id: McpAppId, name: string, domain: string, what: string, keyword: string | null, extra: { adultsOnly?: string[]; smsTerms?: boolean }): McpApp {
  const p = PLATFORM_APPS[id];
  const site = `https://${domain}`;
  return {
    id, name, domain, what, keyword,
    joinMode: p.joinMode,
    ages: { join: p.minJoinAge, match: p.minMatchAge },
    adultsOnly: ["Today, matching and introductions to other people are for adults 18 or older only, and nobody under 18 is introduced to anyone.", "Dating and work matching are for adults 18 or older only. Nobody under 18 is ever matched on dates or for work.", "If introductions ever open to people under 18, they are friendship introductions only, with people close to their own age.", ...(extra.adultsOnly ?? [])],
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
    friends: app("friends", "friends.help", "friends.help", "Friends and plans in New York City by text message, in small groups at public places.", "friends", {}),
  };
}

/** The apps a surface may name, in registry order. */
export const appsOn = (apps: Record<McpAppId, McpApp>, surface: Surface): McpApp[] =>
  MCP_APP_IDS.map(id => apps[id]).filter(a => a && appOffered(connectorSurface[surface], connectorApp[a.id]));

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
  return `${app === host ? "/mcp" : `/mcp/${app}`}${surface === "openai" ? "/openai" : ""}`;
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
