// Serve the Peon signup and connector pages through the production handlers on a local site.
import { resolve } from "node:path";
import { serveHttp } from "../../packages/core/src/runtime/http.ts";
import { createMcpHandler, type McpHandler } from "../../packages/mcp/src/handler.ts";
import { platformHooks } from "../../packages/mcp/src/hooks.ts";
import { pkceS256 } from "../../packages/mcp/src/util.ts";
import { createPublicApi, type PublicApi } from "../../packages/platform/src/api.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { serveSite } from "../../scripts/sites-dev.ts";
import { buildSite, site } from "../../sites/sites.ts";

const peon = site("peon");
if (!peon) throw new Error("Peon site is missing");
const outdir = resolve("built");
const built = await buildSite(peon, outdir, { PLATFORM_ENV: "dev" });
if (!built.ok) throw new Error(built.logs.join("\n"));

let session: string | undefined;
let platform: PublicApi | undefined;
let oauth: McpHandler | undefined;
let authorization: URLSearchParams | undefined;
const verifier = "browser-fixture-verifier-".repeat(3);
const state = "browser-fixture-peon";
const server = await serveHttp({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const { pathname, searchParams } = new URL(request.url);
    if (request.method === "GET" && pathname === "/api/explore/start" && session) {
      return new Response(null, { status: 303, headers: { location: "/join?via=agent", "set-cookie": session } });
    }
    if (request.method === "GET" && pathname === "/api/explore/connect" && authorization) {
      return new Response(null, { status: 303, headers: { location: `/oauth/authorize?${authorization}` } });
    }
    if (request.method === "GET" && pathname === "/api/explore/approved" && authorization) {
      const code = searchParams.get("code");
      if (!code || searchParams.get("state") !== state) return new Response("Fixture authorization failed", { status: 400 });
      const exchange = await oauth?.fetch(new Request(new URL("/oauth/token", browser.url), {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier,
          client_id: authorization.get("client_id")!, redirect_uri: authorization.get("redirect_uri")! }),
      }));
      await exchange?.body?.cancel();
      if (!exchange?.ok) return new Response("Fixture token exchange failed", { status: 502 });
      return new Response(null, { status: 303, headers: { location: "/oauth/consents" } });
    }
    return (await platform?.fetch(request)) ?? (await oauth?.fetch(request)) ?? new Response("Not found", { status: 404 });
  },
});
const browser = await serveSite(peon, { port: 0, apiOrigin: server.url.origin, outdir, proxySecret: "" });
const stop = async () => { await Promise.all([browser.stop(true), server.stop(true)]); };
process.once("SIGTERM", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });

try {
  // Obtain a fresh Peon session before the browser starts. The provider never sends a text.
  const phone = "+12125550142";
  const code = "246810";
  const store = new MemoryPeopleStore();
  const hostMap = { [peon.domain]: "peon", [browser.url.host]: "peon" } as const;
  platform = createPublicApi({
    store,
    otp: { name: "explore", async send(e164) {
      if (e164 !== phone) throw new Error("Unknown fixture phone");
      return { code };
    } },
    env: { PLATFORM_ENV: "dev" },
    hostMap,
    trustForwardedHost: true,
    minStartMs: 0,
    minVerifyMs: 0,
    log: () => {},
  });
  const api = platform;
  oauth = createMcpHandler({
    platform: platformHooks({ store, otp: api.otp, accounts: api.accounts, sessions: api.sessions,
      authenticatedSiteSession: (app, req) => api.authenticatedSiteSession(app, req), app: id => APPS[id],
      cookieName: id => `sid_${id}`, secureCookie: false }),
    env: { PLATFORM_ENV: "dev" }, trustForwardedHost: true, issuer: browser.url.origin, hostMap, log: console.error,
  });
  const callback = new URL("/api/explore/approved", browser.url).href;
  const registered = await oauth.fetch(new Request(new URL("/oauth/register", browser.url), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Fixture assistant", token_endpoint_auth_method: "none", redirect_uris: [callback] }),
  }));
  if (!registered?.ok) throw new Error(`Fixture registration failed (${registered?.status})`);
  const { client_id } = await registered.json() as { client_id: string };
  authorization = new URLSearchParams({
    response_type: "code", client_id, redirect_uri: callback, state, code_challenge: pkceS256(verifier), code_challenge_method: "S256",
  });
  const otp = (part: string, body: object) => fetch(new URL(`/api/auth/otp/${part}`, browser.url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: browser.url.origin },
    body: JSON.stringify(body),
  });
  const started = await otp("start", { phone });
  if (!started.ok) throw new Error(`Fixture OTP start failed (${started.status})`);
  await started.body?.cancel();
  const verified = await otp("verify", { phone, code });
  session = verified.headers.getSetCookie().find(cookie => cookie.startsWith("sid_peon="));
  await verified.body?.cancel();
  if (!verified.ok || !session) throw new Error(`Fixture OTP verification failed (${verified.status})`);
  console.log(`Peon signup at ${new URL("/api/explore/start", browser.url)}`);
} catch (error) {
  await stop();
  throw error;
}
