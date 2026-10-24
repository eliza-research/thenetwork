// The pages the person sees on the site's own domain at /oauth/authorize and /oauth/consents.
// Plain server-rendered HTML forms, no script except Cloudflare Turnstile when it is configured.
// Every string from a client (its name, its redirect host) is escaped and labelled as the client's claim.
import type { McpApp } from "./apps.ts";
import type { Grant, Scope } from "./store.ts";
import { esc } from "./util.ts";

// Same marks as the four homepage headers.
const BRAND_MARKS: Record<string, string> = {"ntwrk": "<svg aria-hidden=\"true\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"15\" fill=\"currentColor\"/><path class=\"l-logo-line\" d=\"M12 44L24 22\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><path class=\"l-logo-line\" d=\"M24 22L38 34\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><path class=\"l-logo-line\" d=\"M38 34L52 14\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><path class=\"l-logo-line\" d=\"M38 34L46 52\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><circle class=\"l-logo-bg\" cx=\"12\" cy=\"44\" r=\"5\"/><circle class=\"l-logo-bg\" cx=\"24\" cy=\"22\" r=\"6\"/><circle class=\"l-logo-bg\" cx=\"38\" cy=\"34\" r=\"7\"/><circle class=\"l-logo-bg\" cx=\"52\" cy=\"14\" r=\"5\"/><circle class=\"l-logo-bg\" cx=\"46\" cy=\"52\" r=\"5\"/></svg>", "slop": "<svg aria-hidden=\"true\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"15\" fill=\"#141414\"/><path fill=\"#dcf24a\" d=\"M32 46C12 32 10 20 19 14c6-4 11 0 13 4 2-4 7-8 13-4 9 6 7 18-13 32Z\"/><rect fill=\"#dcf24a\" x=\"21\" y=\"34\" width=\"5\" height=\"16\" rx=\"2.5\"/><rect fill=\"#dcf24a\" x=\"38\" y=\"34\" width=\"5\" height=\"12\" rx=\"2.5\"/><circle fill=\"#dcf24a\" cx=\"23.5\" cy=\"56\" r=\"2.5\"/></svg>", "peon": "<svg aria-hidden=\"true\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"15\" fill=\"#f59a3c\"/><path fill=\"#141414\" d=\"M26 8h12l-3 9h-6Z\"/><path fill=\"#141414\" d=\"M28.5 19h7l6 26-9.5 12L22.5 45Z\"/></svg>", "friends": "<svg aria-hidden=\"true\" viewBox=\"0 0 64 64\"><circle class=\"l-logo-hi\" cx=\"24\" cy=\"32\" r=\"15\"/><circle fill=\"currentColor\" cx=\"40\" cy=\"32\" r=\"15\"/><path class=\"l-logo-bg\" d=\"M32 19.3a15 15 0 0 1 0 25.4 15 15 0 0 1 0-25.4Z\"/></svg>"};

export interface PageOpts { turnstileSiteKey?: string; formTargets?: string[]; status?: number; headers?: Record<string, string> }

export function page(app: McpApp, title: string, body: string, o: PageOpts = {}): Response {
  const ts = o.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
  const csp = [
    "default-src 'none'", "style-src 'unsafe-inline'", "img-src 'self' data:", `script-src${ts || " 'none'"}`, `frame-src${ts || " 'none'"}`,
    `connect-src 'self'${ts}`, `form-action 'self'${(o.formTargets ?? []).map(t => ` ${t}`).join("")}`, "base-uri 'none'", "frame-ancestors 'none'",
  ].join("; ");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(title)} · ${esc(app.name)}</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1c1a;--muted:#6b6862;--line:#d9d5cc;--accent:#1d1c1a;--accent-fg:#fbfaf7}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#eeebe4;--muted:#a19d95;--line:#3a3833;--accent:#eeebe4;--accent-fg:#161513}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,sans-serif}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:18px;color:inherit;text-decoration:none;margin-bottom:48px}.brand .l-logo-bg{fill:var(--bg)}.brand .l-logo-line{fill:none;stroke:var(--bg)}.brand .l-logo-hi{fill:#b7e3a1}.brand svg{width:30px;height:30px}footer{display:flex;gap:20px;margin-top:48px;font-size:13px}footer a{color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}main{max-width:30rem;margin:0 auto;padding:2.5rem 1rem}h1{font-size:1.4rem;margin:0 0 1rem}p,li{color:var(--fg)}.muted{color:var(--muted);font-size:.9rem}
label{display:block;font-weight:600;margin:1rem 0 .3rem}input[type=tel],input[type=text]{width:100%;padding:.7rem;border:1px solid var(--line);border-radius:.5rem;background:transparent;color:var(--fg);font-size:1rem}
button{margin-top:1rem;padding:.7rem 1.1rem;border-radius:.5rem;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);font-size:1rem;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}.row{display:flex;gap:.6rem;flex-wrap:wrap}
.box{border:1px solid var(--line);border-radius:.6rem;padding:1rem;margin:1rem 0}.err{color:#b3261e}ul{padding-left:1.2rem}
</style>${o.turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
</head><body><main>
<a class="brand" href="/">${BRAND_MARKS[app.id] ?? ""}<span>${esc(app.domain)}</span></a>
${body}
<footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer></main></body></html>`;
  return new Response(html, {
    status: o.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": csp, "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...o.headers },
  });
}

const hidden = (rid: string) => `<input type="hidden" name="rid" value="${esc(rid)}">`;
const err = (e?: string) => (e ? `<p class="err" role="alert">${esc(e)}</p>` : "");

export function phonePage(app: McpApp, rid: string, o: { error?: string; turnstileSiteKey?: string } = {}) {
  return page(app, "Sign in", `<h1>Confirm your phone number</h1>
${err(o.error)}
<form method="post" action="/oauth/authorize/phone">${hidden(rid)}
<label class="sr-only" for="phone">Your phone number</label>
<input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required maxlength="40" placeholder="(212) 555-0100">
${o.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(o.turnstileSiteKey)}"></div>` : ""}
<button type="submit">Text me a code</button>
</form>
<form method="post" action="/oauth/authorize/cancel">${hidden(rid)}<button class="secondary" name="decision" value="deny">Cancel</button></form>
`, { turnstileSiteKey: o.turnstileSiteKey, status: o.error ? 400 : 200 });
}

export function codePage(app: McpApp, rid: string, last4: string, o: { error?: string } = {}) {
  return page(app, "Enter your code", `<h1>Enter your code</h1>
<p>Sent to ••• ${esc(last4)}.</p>
${err(o.error)}
<form method="post" action="/oauth/authorize/code">${hidden(rid)}
<label class="sr-only" for="code">Code</label>
<input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" required>
<button type="submit">Continue</button>
</form>
<form method="post" action="/oauth/authorize/cancel">${hidden(rid)}<button class="secondary" name="decision" value="deny">Cancel</button></form>`, { status: o.error ? 400 : 200 });
}

const SCOPE_TEXT: Record<Scope, string> = {
  "apps:read": "See which Network apps are available",
  "membership:read": "Read your membership status and new updates",
  "profile:write": "Save your profile and prepare signup details",
};

/** One pending OAuth connection, not an account page or a sign-in destination. */
export function consentPage(app: McpApp, rid: string, clientName: string | null, redirectHost: string, redirectOrigin: string, scopes: Scope[], o: { unavailable?: boolean } = {}) {
  return page(app, "Allow access", `<h1>Allow this assistant?</h1>
<p><strong>${esc(clientName ?? "An unnamed assistant")}</strong> (the name it provided)</p>
<p class="muted">Return to ${esc(redirectHost)}.</p>
${o.unavailable ? '<p>We can’t check your connection right now. Wait a moment, then try again below, or return to your agent or text conversation.</p>' : ""}
<div class="box"><p>It will be able to:</p><ul>${scopes.map(s => `<li>${esc(SCOPE_TEXT[s])}</li>`).join("")}</ul></div>
<form method="post" action="/oauth/authorize/consent">${hidden(rid)}
<div class="row"><button name="decision" value="approve">${o.unavailable ? "Try again" : "Allow"}</button><button class="secondary" name="decision" value="deny">Don't allow</button></div>
</form>`, { formTargets: [redirectOrigin], status: o.unavailable ? 503 : 200 });
}

export function messagePage(app: McpApp, title: string, text: string, status = 400, retryPath?:string) {
  const retry=retryPath?.startsWith("/")&&!retryPath.startsWith("//")?`<a href="${esc(retryPath)}">Try again</a>`:"";
  return page(app, title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>${retry}`, { status });
}

export function consentsPage(app: McpApp, grants: Array<Grant & { clientName: string | null }>, fmt: (ms: number) => string, notice?: string) {
  const items = grants.length
    ? grants.map(g => `<div class="box"><p><strong>${esc(g.clientName ?? "An unnamed app")}</strong> (as it calls itself)</p>
<p class="muted">Allowed ${esc(fmt(g.createdAt))}: ${g.scopes.map(esc).join(", ")}</p>
<form method="post" action="/oauth/consents/revoke"><input type="hidden" name="grant" value="${esc(g.id)}"><button class="secondary">Remove access</button></form></div>`).join("")
    : `<p>No assistant has access to your ${esc(app.name)} account.</p>`;
  return page(app, "Connected assistants", `<h1>Connected assistants</h1>${notice ? `<p role="status">${esc(notice)}</p>` : ""}${items}`);
}
