// Local dev server for the four app sites (sites/*).
//   bun run sites:dev                 all four: ntwrk 5101, slop 5102, peon 5103, buddies 5104
//   bun run sites:dev slop peon       only some
// Each site is built with Bun's HTML bundler into sites/<domain>/dist and rebuilt on change.
// /api/* is proxied to PLATFORM_API_ORIGIN (default http://127.0.0.1:8790), the shared backend.
// The proxy sends X-Forwarded-Host: <site domain>, so the backend's Host map picks the app.
// When the API is down, /api/* answers 502 {ok:false, error:"api_unreachable"} and the pages
// show an inline error. Nothing here sends a text message or calls a paid service.
import { existsSync, statSync, watch } from "node:fs";
import { join, normalize, sep } from "node:path";
import { SECURITY_HEADERS, SITES, buildSite, site as findSite, type Site } from "../sites/sites.ts";

const HOP = ["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "content-length", "accept-encoding"];
/** Client-set IP headers are dropped: the backend never takes a rate-limit bucket from a header a browser sets. */
const CLIENT_IP = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for", "true-client-ip", "forwarded"];

export interface DevOptions {
  port: number;
  apiOrigin: string;
  outdir: string;
}

async function proxy(req: Request, s: Site, apiOrigin: string): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP.includes(k) && !CLIENT_IP.includes(k)) headers.set(k, v);
  });
  headers.set("x-forwarded-host", s.domain);
  headers.set("x-forwarded-proto", "http");
  let upstream: Response;
  try {
    upstream = await fetch(apiOrigin + url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ ok: false, error: "api_unreachable" }, { status: 502 });
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
    if (c === "_headers") return null;
    const full = normalize(join(outdir, c));
    if (!full.startsWith(outdir + sep)) return null;
    if (existsSync(full) && statSync(full).isFile()) return { path: full, status: 200 };
  }
  const nf = join(outdir, "404.html");
  return existsSync(nf) ? { path: nf, status: 404 } : null;
}

export function serveSite(s: Site, opts: DevOptions) {
  return Bun.serve({
    port: opts.port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return proxy(req, s, opts.apiOrigin);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
        return Response.redirect(url.pathname.replace(/\/+$/, "") + url.search, 308);
      }
      const f = file(opts.outdir, url.pathname);
      if (!f) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(f.path), { status: f.status, headers: { "cache-control": "no-store", ...SECURITY_HEADERS } });
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
