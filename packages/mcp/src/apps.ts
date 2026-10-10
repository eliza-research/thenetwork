// The public facts about each app that the MCP server may tell an agent (app_info, start_signup).
// Nothing here is about a person. The join mode and the ages come from the platform registry
// (packages/platform/src/apps.ts) when it has the app, so the server and the sites cannot drift.
import { APPS as PLATFORM_APPS, PAGES_PROJECT, SUPPORT_EMAIL } from "@thenetwork/platform";

export const MCP_APP_IDS = ["ntwrk", "slop", "peon", "friends"] as const;
export type McpAppId = (typeof MCP_APP_IDS)[number];
export const isMcpAppId = (v: unknown): v is McpAppId => typeof v === "string" && (MCP_APP_IDS as readonly string[]).includes(v);

/**
 * Which client surface a request comes from. "openai" is the public OpenAI (ChatGPT, Codex) plugin:
 * OpenAI requires plugins that suit people aged 13-17, so slop (dating) is hidden there.
 */
export type Surface = "full" | "openai";

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
  links: { site: string; join: string; privacy: string; terms: string; smsTerms: string | null; safety: string | null; settings: string; support: string };
  /** False: never listed or offered on the OpenAI surface. */
  openai: boolean;
}

type PlatformPolicy = { joinMode: McpApp["joinMode"]; minJoinAge: number; minMatchAge: number };

function app(id: McpAppId, name: string, domain: string, what: string, keyword: string | null, extra: { adultsOnly?: string[]; smsTerms?: boolean; safety?: boolean; openai?: boolean; joinMode?: McpApp["joinMode"] }): McpApp {
  // The platform registry is the source of truth for join mode and ages. An app it does not know yet
  // (for example before a rename lands) gets the founder defaults: 13+ to join, 18+ to be matched.
  const p = (PLATFORM_APPS as Record<string, PlatformPolicy | undefined>)[id];
  const site = `https://${domain}`;
  return {
    id, name, domain, what, keyword,
    joinMode: p?.joinMode ?? extra.joinMode ?? "open",
    ages: { join: p?.minJoinAge ?? 13, match: Math.max(18, p?.minMatchAge ?? 18) },
    adultsOnly: ["Matching and introductions to other people are for adults 18 or older only. Nobody under 18 is ever matched or introduced.", ...(extra.adultsOnly ?? [])],
    links: {
      site, join: `${site}/join`, privacy: `${site}/privacy`, terms: `${site}/terms`,
      smsTerms: extra.smsTerms === false ? null : `${site}/sms-terms`, safety: extra.safety ? `${site}/safety` : null,
      settings: `${site}/settings`, support: `mailto:${SUPPORT_EMAIL}`,
    },
    openai: extra.openai ?? true,
  };
}

/** The default registry: the four apps, all powered by The Network. */
export function defaultApps(): Record<McpAppId, McpApp> {
  return {
    ntwrk: app("ntwrk", "The Network", "ntwrk.party", "The home of every app below: an agent you text that helps with people, plans and events you ask for.", null, { smsTerms: false }),
    slop: app("slop", "slop.date", "slop.date", "Dating by text message. A matchmaker suggests one person now and then, and nobody is introduced unless both say yes.", "slop", {
      adultsOnly: ["Photos and any rating of looks are for adults (18+) only; the stated age counts (no ID check). They are never asked of, stored for or shown to anyone under 18."],
      safety: true, openai: false,
    }),
    peon: app("peon", "peon.biz", "peon.biz", "Work and hiring by text message. It introduces people looking for work to people hiring, and a person makes every decision.", "peon", {}),
    friends: app("friends", "friends.help", "friends.help", "Friends and plans in New York City by text message, in small groups at public places.", "friends", {}),
  };
}

/** The apps a surface may name, in registry order. */
export const appsOn = (apps: Record<McpAppId, McpApp>, surface: Surface): McpApp[] =>
  MCP_APP_IDS.map(id => apps[id]).filter(a => a && (surface === "full" || a.openai));

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
