// Serve the production Peon signup page and real platform API in one local fixture.
import { resolve } from "node:path";
import { serveHttp } from "../../packages/core/src/runtime/http.ts";
import { createPublicApi, type PublicApi } from "../../packages/platform/src/api.ts";
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
const server = await serveHttp({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method === "GET" && new URL(request.url).pathname === "/api/explore/start" && session) {
      return new Response(null, { status: 303, headers: { location: "/join?via=agent", "set-cookie": session } });
    }
    return (await platform?.fetch(request)) ?? new Response("Not found", { status: 404 });
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
  platform = createPublicApi({
    store: new MemoryPeopleStore(),
    otp: { name: "explore", async send(e164) {
      if (e164 !== phone) throw new Error("Unknown fixture phone");
      return { code };
    } },
    env: { PLATFORM_ENV: "dev" },
    hostMap: { [peon.domain]: "peon", [browser.url.host]: "peon" },
    trustForwardedHost: true,
    minStartMs: 0,
    minVerifyMs: 0,
    log: () => {},
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
