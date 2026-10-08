// The pages the person sees on the site's own domain at /oauth/authorize and /oauth/consents.
// Plain server-rendered HTML forms, no script except Cloudflare Turnstile when it is configured.
// Every string from a client (its name, its redirect host) is escaped and labelled as the client's claim.
import type { McpApp } from "./apps.ts";
import type { Grant, Scope } from "./store.ts";
import { esc } from "./util.ts";

export const SCOPE_TEXT: Record<Scope, (app: McpApp) => string> = {
  "apps:read": () => "Read public facts about the apps: what they are, who can join and the links. Anyone can read these.",
  "membership:read": app => `See whether you joined ${app.name} and your status there (for example active or stopped). It cannot see your messages, your profile, your age, your matches or anything about other people, and it cannot see other apps.`,
  "profile:write": app => `Send ${app.name} what you told the assistant about yourself (what you are looking for, your interests, when and where you are free), as if you had texted it. It can only add to your own profile, never read it, and never sends anything to anyone else.`,
};

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
main{max-width:30rem;margin:0 auto;padding:2.5rem 1rem}h1{font-size:1.4rem;margin:0 0 1rem}p,li{color:var(--fg)}.muted{color:var(--muted);font-size:.9rem}
label{display:block;font-weight:600;margin:1rem 0 .3rem}input[type=tel],input[type=text]{width:100%;padding:.7rem;border:1px solid var(--line);border-radius:.5rem;background:transparent;color:var(--fg);font-size:1rem}
button{margin-top:1rem;padding:.7rem 1.1rem;border-radius:.5rem;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);font-size:1rem;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}.row{display:flex;gap:.6rem;flex-wrap:wrap}
.box{border:1px solid var(--line);border-radius:.6rem;padding:1rem;margin:1rem 0}.err{color:#b3261e}ul{padding-left:1.2rem}
</style>${o.turnstileSiteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
</head><body><main>
<p class="muted">${esc(app.name)} · powered by The Network</p>
${body}
</main></body></html>`;
  return new Response(html, {
    status: o.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": csp, "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...o.headers },
  });
}

const clientLine = (clientName: string | null, redirectHost: string) =>
  `<p>An assistant that calls itself <strong>${esc(clientName ?? "an unnamed app")}</strong> (it returns to <strong>${esc(redirectHost)}</strong>) asks to connect to your account.</p>`;

const hidden = (rid: string) => `<input type="hidden" name="rid" value="${esc(rid)}">`;
const err = (e?: string) => (e ? `<p class="err" role="alert">${esc(e)}</p>` : "");

export function phonePage(app: McpApp, rid: string, clientName: string | null, redirectHost: string, o: { error?: string; turnstileSiteKey?: string } = {}) {
  return page(app, "Sign in", `<h1>Sign in to ${esc(app.name)}</h1>
${clientLine(clientName, redirectHost)}
<p>First, sign in yourself. We text a code to your phone. Type it on this page only. Never give the code to the assistant or to anyone else.</p>
${err(o.error)}
<form method="post" action="/oauth/authorize/phone">${hidden(rid)}
<label for="phone">Your phone number</label>
<input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required maxlength="40" placeholder="(212) 555-0100">
${o.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(o.turnstileSiteKey)}"></div>` : ""}
<button type="submit">Text me a code</button>
</form>
<form method="post" action="/oauth/authorize/consent">${hidden(rid)}<button class="secondary" name="decision" value="deny">Cancel</button></form>
<p class="muted">Message and data rates may apply. US and Canada numbers only.</p>`, { turnstileSiteKey: o.turnstileSiteKey, status: o.error ? 400 : 200 });
}

export function codePage(app: McpApp, rid: string, last4: string, o: { error?: string } = {}) {
  return page(app, "Enter your code", `<h1>Enter your code</h1>
<p>If ${esc(app.name)} can send to the number ending in ${esc(last4)}, a code is on its way. Type it here. Never give it to the assistant.</p>
${err(o.error)}
<form method="post" action="/oauth/authorize/code">${hidden(rid)}
<label for="code">Code</label>
<input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" required>
<button type="submit">Continue</button>
</form>
<form method="post" action="/oauth/authorize/consent">${hidden(rid)}<button class="secondary" name="decision" value="deny">Cancel</button></form>`, { status: o.error ? 400 : 200 });
}

export function consentPage(app: McpApp, rid: string, clientName: string | null, redirectHost: string, redirectOrigin: string, scopes: Scope[]) {
  return page(app, "Allow access", `<h1>Allow this assistant?</h1>
${clientLine(clientName, redirectHost)}
<div class="box"><p><strong>It will be able to:</strong></p><ul>${scopes.map(s => `<li>${esc(SCOPE_TEXT[s](app))}</li>`).join("")}</ul></div>
<p>It cannot sign you up, send messages, or act for you. You can remove this access at any time at <strong>${esc(app.domain)}/oauth/consents</strong>.</p>
<form method="post" action="/oauth/authorize/consent">${hidden(rid)}
<div class="row"><button name="decision" value="approve">Allow</button><button class="secondary" name="decision" value="deny">Don't allow</button></div>
</form>`, { formTargets: [redirectOrigin] });
}

export function messagePage(app: McpApp, title: string, text: string, status = 400) {
  return page(app, title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`, { status });
}

export function consentsPage(app: McpApp, grants: Array<Grant & { clientName: string | null }>, fmt: (ms: number) => string, notice?: string) {
  const items = grants.length
    ? grants.map(g => `<div class="box"><p><strong>${esc(g.clientName ?? "An unnamed app")}</strong> (as it calls itself)</p>
<p class="muted">Allowed ${esc(fmt(g.createdAt))}: ${g.scopes.map(esc).join(", ")}</p>
<form method="post" action="/oauth/consents/revoke"><input type="hidden" name="grant" value="${esc(g.id)}"><button class="secondary">Remove access</button></form></div>`).join("")
    : `<p>No assistant has access to your ${esc(app.name)} account.</p>`;
  return page(app, "Connected assistants", `<h1>Connected assistants</h1>${notice ? `<p role="status">${esc(notice)}</p>` : ""}${items}`);
}
