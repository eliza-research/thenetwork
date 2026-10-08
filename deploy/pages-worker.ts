// The Cloudflare Pages advanced-mode entry (_worker.js; founder decision 8): the router's default export
// only. workerd treats every named export of a Worker module as an entrypoint, so the router's helper
// exports (isBackendPath, MAX_BODY_BYTES, ...) must not reach the bundle's exports.
//
// The site's own APP_ID, SITE_HOST and BACKEND_ORIGIN are built in (sites/sites.ts defines them per
// site), so the router works even where the project's variables are not applied (wrangler pages dev
// with --binding, or a project created without wrangler.toml). A project variable still wins.
// PLATFORM_PROXY_SECRET is never built in: it is a Pages secret.
import router, { type Env } from "./router.ts";

declare const __SITE_APP_ID__: string;
declare const __SITE_HOST__: string;
declare const __SITE_BACKEND_ORIGIN__: string;

const BUILT: Partial<Env> = {
  APP_ID: typeof __SITE_APP_ID__ === "string" ? __SITE_APP_ID__ : undefined,
  SITE_HOST: typeof __SITE_HOST__ === "string" ? __SITE_HOST__ : undefined,
  BACKEND_ORIGIN: typeof __SITE_BACKEND_ORIGIN__ === "string" ? __SITE_BACKEND_ORIGIN__ : undefined,
} as Partial<Env>;

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    const merged = { ...env } as Env;
    for (const k of ["APP_ID", "SITE_HOST", "BACKEND_ORIGIN"] as const) if (!merged[k] && BUILT[k]) (merged as unknown as Record<string, string>)[k] = BUILT[k]!;
    return router.fetch(req, merged);
  },
};
