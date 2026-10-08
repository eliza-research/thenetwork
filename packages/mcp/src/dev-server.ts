#!/usr/bin/env bun
// Local dev only: the MCP server for ntwrk on http://127.0.0.1:4849/mcp, with memory stores and the
// platform's dev console OTP provider (codes are printed here; nothing is texted). For MCP clients and
// the Inspector:  PLATFORM_ENV=dev bun run packages/mcp/src/dev-server.ts [--port 4849] [--app ntwrk]
import { parseArgs } from "node:util";
import { Accounts, APPS, type AppInfo, devShortcutsAllowed, DevConsoleProvider, MemoryPeopleStore, OtpService, SessionService } from "@thenetwork/platform";
import { isMcpAppId, type McpAppId } from "./apps.ts";
import { createMcpHandler } from "./handler.ts";
import { platformHooks } from "./hooks.ts";

if (!devShortcutsAllowed()) throw new Error("dev-server.ts runs only with PLATFORM_ENV=dev");
const { values: a } = parseArgs({ options: { port: { type: "string", default: "4849" }, app: { type: "string", default: "ntwrk" } } });
if (!isMcpAppId(a.app)) throw new Error("--app must be ntwrk, slop, peon or friends");
const app: McpAppId = a.app;
const port = Number(a.port);
const local = `http://127.0.0.1:${port}`;
const people = new MemoryPeopleStore();
const appOf = (id: McpAppId) => (APPS as Record<string, AppInfo | undefined>)[id];
const hashKey = "dev-only-mcp-hash-key";
const accounts = new Accounts(people, { hashKey, apps: id => (APPS as Record<string, AppInfo>)[id]! });
const handler = createMcpHandler({
  platform: platformHooks({
    store: people, otp: new OtpService(people, new DevConsoleProvider(), { hashKey }), accounts,
    sessions: new SessionService(people, { secret: "dev-only-session-secret" }), app: appOf, cookieName: id => `sid_${id}`, secureCookie: false,
  }),
  issuer: x => (x.id === app ? local : `https://${x.domain}`),
  hostMap: { [`127.0.0.1:${port}`]: app, [`localhost:${port}`]: app },
});
Bun.serve({ hostname: "127.0.0.1", port, fetch: async (req, server) => (await handler.fetch(req, server)) ?? new Response("not found", { status: 404 }) });
console.log(`MCP (${app}) on ${local}/mcp and ${local}/mcp/openai. OTP codes print here. Use 555-01xx numbers only.`);
