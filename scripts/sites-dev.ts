// Local dev server for the four app sites (sites/*).
//   bun run sites:dev                 all four: ntwrk 5101, slop 5102, peon 5103, friends 5104
//   bun run sites:dev slop peon       only some
// Each site is built with Bun's HTML bundler into sites/<domain>/dist and rebuilt on change.
// The backend paths of the production router (deploy/router.ts: /api/*, /mcp, /oauth/*,
// /.well-known/oauth-*) are proxied to PLATFORM_API_ORIGIN (default http://127.0.0.1:8790), the
// shared backend. With PLATFORM_PROXY_SECRET set (scripts/platform-dev.ts sets it) those paths run
// through the production router's own code (deploy/router.ts handle) with the visitor IP 127.0.0.1, so
// the backend sees exactly the signed headers it sees in production. Without a secret (sites:dev alone,
// against the legacy service on :8790) it sends X-Forwarded-Host: <site domain> instead. When the API is down, those paths answer 502 {ok:false, error:"api_unreachable"} and the
// pages show an inline error. Nothing here sends a text message or calls a paid service.
import { existsSync, statSync, watch } from "node:fs";
import { join, normalize, sep } from "node:path";
import { handle as routerHandle, isBackendPath, isProxyHeader } from "../deploy/router.ts";
import { SECURITY_HEADERS, SITES, buildSite, site as findSite, type Site } from "../sites/sites.ts";

const HOP = ["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "content-length", "accept-encoding"];
/** Client-set IP headers are dropped: the backend never takes a rate-limit bucket from a header a browser sets. */
const CLIENT_IP = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for", "true-client-ip", "forwarded"];

export interface DevOptions {
  port: number;
  apiOrigin: string;
  outdir: string;
  /** Sign forwarded requests like the production router (deploy/router.ts). Default: env PLATFORM_PROXY_SECRET. */
  proxySecret?: string;
  /** The router's clock for the signature time (default Date.now; tests pass the service's clock). */
  now?: () => number;
}

async function proxy(req: Request, s: Site, apiOrigin: string, secret?: string, now: () => number = Date.now): Promise<Response> {
  const url = new URL(req.url);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  if (secret) {
    // The production router: it strips every client proxy and IP header and signs the platform contract.
    const h = new Headers(req.headers);
    for (const k of CLIENT_IP) h.delete(k);
    h.set("cf-connecting-ip", "127.0.0.1");
    const routed = new Request(req.url, { method: req.method, headers: h, body: hasBody ? await req.arrayBuffer() : undefined });
    const env = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, BACKEND_ORIGIN: apiOrigin, APP_ID: s.app, SITE_HOST: s.domain, PLATFORM_PROXY_SECRET: secret };
    upstream = await routerHandle(routed, env, ((u: string, init: RequestInit) => fetch(u, { ...init, signal: AbortSignal.timeout(15_000) })) as typeof fetch, now);
  } else {
    const headers = new Headers();
    req.headers.forEach((v, k) => {
      if (!HOP.includes(k) && !CLIENT_IP.includes(k) && !isProxyHeader(k) && k !== "x-forwarded-host") headers.set(k, v);
    });
    headers.set("x-forwarded-host", s.domain);
    headers.set("x-forwarded-proto", "http");
    try {
      upstream = await fetch(apiOrigin + url.pathname + url.search, {
        method: req.method,
        headers,
        body: hasBody ? await req.arrayBuffer() : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return Response.json({ ok: false, error: "api_unreachable" }, { status: 502 });
    }
  }
  const out = new Headers();
  upstream.headers.forEach((v, k) => {
    if (k !== "set-cookie" && !HOP.includes(k) && k !== "content-encoding") out.set(k, v);
  });
  // Cookies bind to the dev host: drop any Domain= the backend set for the real domain.
  for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c.replace(/;\s*domain=[^;]*/i, ""));
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: out });
}

function file(outdir: string, pathname: string): { path: string; status: number } | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidates = p === "/" ? ["index.html"] : [p.slice(1) + ".html", p.slice(1)];
  for (const c of candidates) {
    // Cloudflare reads these files; it never serves them.
    if (c === "_headers" || c === "_redirects") return null;
    const full = normalize(join(outdir, c));
    if (!full.startsWith(outdir + sep)) return null;
    if (existsSync(full) && statSync(full).isFile()) return { path: full, status: 200 };
  }
  const nf = join(outdir, "404.html");
  return existsSync(nf) ? { path: nf, status: 404 } : null;
}

export function serveSite(s: Site, opts: DevOptions) {
  const secret = opts.proxySecret ?? process.env.PLATFORM_PROXY_SECRET ?? undefined;
  return Bun.serve({
    port: opts.port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (isBackendPath(url.pathname)) return proxy(req, s, opts.apiOrigin, secret || undefined, opts.now);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
        // Same-origin only: "//evil.example/" must not become a protocol-relative redirect.
        const to = "/" + url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
        return new Response(null, { status: 308, headers: { location: to + url.search } });
      }
      const f = file(opts.outdir, url.pathname);
      if (!f) return new Response("Not found", { status: 404 });
      const headers: Record<string, string> = { "cache-control": "no-store", ...SECURITY_HEADERS };
      if (f.path.endsWith(".md")) headers["content-type"] = "text/markdown; charset=utf-8";
      return new Response(Bun.file(f.path), { status: f.status, headers });
    },
  });
}

async function rebuild(s: Site, outdir: string): Promise<void> {
  const r = await buildSite(s, outdir);
  if (r.ok) console.log(`[sites] built ${s.domain}`);
  else console.error(`[sites] build FAILED for ${s.domain}\n  ${r.logs.join("\n  ")}`);
}

if (import.meta.main) {
  const apiOrigin = (process.env.PLATFORM_API_ORIGIN ?? "http://127.0.0.1:8790").replace(/\/+$/, "");
  const wanted = process.argv.slice(2);
  const chosen = wanted.length ? wanted.map(findSite) : SITES;
  const sitesDir = join(import.meta.dir, "../sites");
  for (const s of chosen) {
    const outdir = join(sitesDir, s.domain, "dist");
    await rebuild(s, outdir);
    serveSite(s, { port: s.port, apiOrigin, outdir });
    console.log(`[sites] ${s.domain.padEnd(12)} http://127.0.0.1:${s.port}  (api -> ${apiOrigin})`);
  }
  // Rebuild on change. A change in sites/shared rebuilds every site.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (s: Site) => {
    clearTimeout(timers.get(s.domain));
    timers.set(s.domain, setTimeout(() => void rebuild(s, join(sitesDir, s.domain, "dist")), 120));
  };
  for (const s of chosen) watch(s.src, { recursive: true }, () => schedule(s));
  watch(join(sitesDir, "shared"), { recursive: true }, () => chosen.forEach(schedule));
}
