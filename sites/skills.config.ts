// The one place that names the shared backend for the four sites. Every SKILL.md, the support pages
// and the site routers (deploy/router.ts reads BACKEND_ORIGIN from the Worker env, which CI sets from
// the same value) point here. Override per build with the BACKEND_ORIGIN and MCP_URL env vars.
//   bun run sites/sites.ts                 -> https://api.ntwrk.love, and https://<site>/mcp per site
//   BACKEND_ORIGIN=https://staging.example bun run sites/sites.ts
//
// The MCP URL is per site, not the backend origin: each site's router forwards /mcp to the backend
// with the site's signed host, and the MCP server binds a client to that one app (packages/mcp).
// https://api.ntwrk.love/mcp names no app and answers 404. MCP_URL is a template: "{domain}" is the
// site's domain (default "https://{domain}/mcp").
//
// SMS_LINE is the shared texting line (E.164) the landing pages name ("or text slop to ..."). Until a
// line is set, the pages show a fictional 555-01xx placeholder.

export const DEFAULT_BACKEND_ORIGIN = "https://api.ntwrk.love";

export interface SkillsConfig {
  /** The shared backend origin: every site's /api/*, /mcp and /oauth/* go here. No trailing slash. */
  BACKEND_ORIGIN: string;
  /** The MCP URL template: "{domain}" is replaced by each site's domain (mcpUrlFor). */
  MCP_URL: string;
  /** The shared line every app texts from (E.164): the landing pages' sms: link. */
  SMS_LINE: string;
}

/** A fictional number (555-01xx) the landing pages show until SMS_LINE is set. */
export const SMS_LINE_PLACEHOLDER = "+12125550100";

function origin(v: string, name: string): string {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`${name} must be an absolute URL (got ${JSON.stringify(v)})`);
  }
  if (u.protocol !== "https:" && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") throw new Error(`${name} must use https (got ${v})`);
  return v.replace(/\/+$/, "");
}

export function skillsConfig(env: Record<string, string | undefined> = process.env): SkillsConfig {
  const BACKEND_ORIGIN = origin(env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN, "BACKEND_ORIGIN");
  const MCP_URL = env.MCP_URL || DEFAULT_MCP_URL;
  if (!MCP_URL.includes("{domain}")) throw new Error(`MCP_URL must contain {domain}: each site is its own MCP server (got ${MCP_URL})`);
  origin(MCP_URL.replaceAll("{domain}", "example.com"), "MCP_URL");
  const SMS_LINE = (env.SMS_LINE || SMS_LINE_PLACEHOLDER).trim();
  if (!/^\+1[2-9]\d{9}$/.test(SMS_LINE)) throw new Error(`SMS_LINE must be a +1 number in E.164 form (got ${SMS_LINE})`);
  return { BACKEND_ORIGIN, MCP_URL, SMS_LINE };
}

export const DEFAULT_MCP_URL = "https://{domain}/mcp";

/** The MCP endpoint of one site (for example https://slop.date/mcp). */
export function mcpUrlFor(domain: string, env: Record<string, string | undefined> = process.env): string {
  return skillsConfig(env).MCP_URL.replaceAll("{domain}", domain).replace(/\/+$/, "");
}

export const { BACKEND_ORIGIN, MCP_URL } = skillsConfig();
