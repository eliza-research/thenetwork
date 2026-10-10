// The one place that names the shared backend for the four sites. Every SKILL.md, the support pages
// and the site routers (deploy/router.ts reads BACKEND_ORIGIN from the Worker env, which CI sets from
// the same value) point here. Override per build with the BACKEND_ORIGIN and MCP_URL env vars.
//   bun run sites/sites.ts                 -> https://api.ntwrk.party, and https://<site>/mcp per site
//   BACKEND_ORIGIN=https://staging.example bun run sites/sites.ts
//
// The MCP URL is per site, not the backend origin: each site's router forwards /mcp to the backend
// with the site's signed host, and the MCP server binds a client to that one app (packages/mcp).
// https://api.ntwrk.party/mcp names no app and answers 404. MCP_URL is a template: "{domain}" is the
// site's domain (default "https://{domain}/mcp").
import { APPS, stagingSiteOrigins } from "../packages/platform/src/apps.ts";

export const DEFAULT_BACKEND_ORIGIN = "https://api.ntwrk.party";

export interface SkillsConfig {
  /** The shared backend origin: every site's /api/*, /mcp and /oauth/* go here. No trailing slash. */
  BACKEND_ORIGIN: string;
  /** The MCP URL template: "{domain}" is replaced by each site's domain (mcpUrlFor). */
  MCP_URL: string;
}

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
  const staging = stagingSiteOrigins(env);
  if (Object.keys(staging).length) {
    const backend = env.BACKEND_ORIGIN ? new URL(origin(env.BACKEND_ORIGIN, "BACKEND_ORIGIN")) : undefined;
    if (!backend || backend.origin === DEFAULT_BACKEND_ORIGIN || Object.values(staging).includes(backend.origin) || backend.hostname.endsWith(".") || backend.pathname !== "/" || backend.search || backend.hash || backend.username || backend.password) {
      throw new Error("staging sites need an explicit isolated BACKEND_ORIGIN");
    }
  }
  if (Object.keys(staging).length && env.MCP_URL && env.MCP_URL !== DEFAULT_MCP_URL) throw new Error("staging MCP_URL must use the configured site's /mcp endpoint");
  const BACKEND_ORIGIN = origin(env.BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN, "BACKEND_ORIGIN");
  const MCP_URL = env.MCP_URL || DEFAULT_MCP_URL;
  if (!MCP_URL.includes("{domain}")) throw new Error(`MCP_URL must contain {domain}: each site is its own MCP server (got ${MCP_URL})`);
  origin(MCP_URL.replaceAll("{domain}", "example.com"), "MCP_URL");
  return { BACKEND_ORIGIN, MCP_URL };
}

export const DEFAULT_MCP_URL = "https://{domain}/mcp";

/** The MCP endpoint of one site (for example https://slop.date/mcp). */
export function mcpUrlFor(domain: string, env: Record<string, string | undefined> = process.env): string {
  const staging = stagingSiteOrigins(env);
  const app = Object.values(APPS).find(a => a.domain === domain);
  if (app && staging[app.id]) { skillsConfig(env); return `${staging[app.id]}/mcp`; }
  return skillsConfig(env).MCP_URL.replaceAll("{domain}", domain).replace(/\/+$/, "");
}

export const { BACKEND_ORIGIN, MCP_URL } = skillsConfig();
