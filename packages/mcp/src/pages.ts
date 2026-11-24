// spec/authorizationPages.md, "The server reply selects the page view"
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type AuthPage, type Reply, alwaysFieldErrorStaysOnItsPage, initial, isPhoneFieldReply, showReply } from "../../core/src/generated/authorizationPages.ts";
import type { AppKey } from "../../core/src/generated/brandIdentity.ts";
import { type RemoveReply, canChooseRemoval, canConfirmRemoval, chooseRemoval, confirmRemoval, initial as consentsInitial, load } from "../../core/src/generated/connectedAssistants.ts";
import { brandIdFor } from "../../ui/src/brand/landing.ts";
import { AuthCodeView, type CodeFieldError } from "../../ui/src/components/AuthCodeView.tsx";
import { type AuthMessage, AuthMessageView } from "../../ui/src/components/AuthMessageView.tsx";
import { AuthPhoneView, type PhoneFieldError } from "../../ui/src/components/AuthPhoneView.tsx";
import { AuthSignupView, type AuthSignupViewProps } from "../../ui/src/components/AuthSignupView.tsx";
import { ConnectedAssistantsView } from "../../ui/src/components/ConnectedAssistantsView.tsx";
import { ConsentView } from "../../ui/src/components/ConsentView.tsx";
import { connectorApp, type McpApp } from "./apps.ts";
import { connectorCss, styleSource } from "./pages/styles.ts";
import type { Grant, Scope } from "./store.ts";

const TURNSTILE = "https://challenges.cloudflare.com";

/** The brand record of the app that serves the page. */
export function appKeyOf(app: McpApp): AppKey {
  return connectorApp[app.id];
}

export type PageApp = McpApp | { app: McpApp; host: McpApp };

export function pageAppOf(p: PageApp): { app: McpApp; siteOrigin: string } {
  if (!("host" in p)) return { app: p, siteOrigin: "" };
  return { app: p.app, siteOrigin: p.host.id === p.app.id ? "" : new URL(p.app.links.site).origin };
}

interface Respond { turnstileSiteKey?: string; formTargets?: string[]; status?: number }

/** One server-rendered page: the shared React view in a document with the brand on <html>, the design-system CSS and a strict CSP. */
function respond(app: McpApp, title: string, view: ReactElement, o: Respond = {}): Response {
  const ts = o.turnstileSiteKey ? ` ${TURNSTILE}` : "";
  const csp = [
    "default-src 'none'", `style-src ${styleSource}`, "font-src 'self'", "img-src 'self' data:", `script-src${ts || " 'none'"}`, `frame-src${ts || " 'none'"}`,
    `connect-src 'self'${ts}`, `form-action 'self'${(o.formTargets ?? []).map(t => ` ${t}`).join("")}`, "base-uri 'none'", "frame-ancestors 'none'",
  ].join("; ");
  const doc = h("html", { lang: "en", "data-brand": brandIdFor[appKeyOf(app)] },
    h("head", null,
      h("meta", { charSet: "utf-8" }),
      h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h("meta", { name: "referrer", content: "no-referrer" }),
      h("title", null, `${title} · ${app.name}`),
      connectorCss ? h("style", { dangerouslySetInnerHTML: { __html: connectorCss } }) : null,
      o.turnstileSiteKey ? h("script", { src: `${TURNSTILE}/turnstile/v0/api.js`, async: true, defer: true }) : null),
    h("body", null, view));
  return new Response(`<!doctype html>${renderToStaticMarkup(doc)}`, {
    status: o.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": csp, "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" },
  });
}

/** The page model after the server reply. */
const pageFor = (reply: Reply, turnstileOn = false): AuthPage => showReply(reply, { ...initial, turnstileOn });

export type PhoneError = Extract<Reply, "ReplyCheckFailed" | "ReplyPhoneInvalid" | "ReplyTooManyCodes" | "ReplySendUnavailable">;

/** A failed security check is shown only when the page has the check. */
export type PhonePageOptions = { reply: "ReplyCheckFailed"; turnstileSiteKey: string } | { reply?: Exclude<PhoneError, "ReplyCheckFailed">; turnstileSiteKey?: string };

const phoneSendErrors = ["ReplyPhoneInvalid", "ReplyTooManyCodes", "ReplySendUnavailable"] as const satisfies readonly PhoneError[];

export function phoneSendError(reply: Reply): Exclude<PhoneError, "ReplyCheckFailed"> {
  const found = isPhoneFieldReply(reply) ? phoneSendErrors.find(e => e === reply) : undefined;
  if (!found) throw new Error(`The phone page cannot show ${reply}`);
  return found;
}

export function phonePage(at: PageApp, rid: string, o: PhonePageOptions = {}) {
  const { app, siteOrigin } = pageAppOf(at);
  const shown = pageFor(o.reply ?? "ReplyPhone", o.turnstileSiteKey !== undefined);
  // spec/authorizationPages.md, "The server reply selects the page view"
  if (!alwaysFieldErrorStaysOnItsPage(shown)) throw new Error(`The phone page cannot show ${o.reply} without the security check`);
  const view = h(AuthPhoneView, { app: appKeyOf(app), siteOrigin, rid, fieldError: shown.fieldError as PhoneFieldError, turnstileSiteKey: o.turnstileSiteKey });
  return respond(app, "Sign in", view, { turnstileSiteKey: o.turnstileSiteKey, status: o.reply ? 400 : 200 });
}

export function codePage(at: PageApp, rid: string, last4: string, o: { reply?: Extract<Reply, "ReplyCodeRejected"> } = {}) {
  const { app, siteOrigin } = pageAppOf(at);
  const shown = pageFor(o.reply ?? "ReplyCode");
  const view = h(AuthCodeView, { app: appKeyOf(app), siteOrigin, rid, last4, fieldError: shown.fieldError as CodeFieldError });
  return respond(app, "Enter your code", view, { status: o.reply ? 400 : 200 });
}

/** One pending OAuth connection, not an account page or a sign-in destination. */
export function consentPage(at: PageApp, rid: string, clientName: string | null, redirectHost: string, redirectOrigin: string, scopes: Scope[],
  o: { unavailable?: boolean; canSignup?: boolean; signupSaved?: boolean; signupApproval?: string } = {}) {
  const { app, siteOrigin } = pageAppOf(at);
  const shown = pageFor(o.unavailable ? "ReplyConsentRetry" : "ReplyConsent");
  const view = h(ConsentView, { app: appKeyOf(app), siteOrigin, view: shown.view === "ConsentRetryView" ? "ConsentRetryView" : "ConsentView", rid,
    clientName, redirectHost, scopes, canSignup: o.canSignup, signupSaved: o.signupSaved, signupApproval: o.signupApproval });
  return respond(app, "Allow access", view, { formTargets: [redirectOrigin], status: o.unavailable ? 503 : 200 });
}

export type SignupPageOptions = Pick<AuthSignupViewProps, "consent" | "requiresInvitation" | "signupView" | "error" | "birthdateError" | "prefill">;
export type SignupPrefill = NonNullable<AuthSignupViewProps["prefill"]>;

/** The verified browser's transient form for confirming the app's signup. */
export function signupPage(at: PageApp, rid: string, options: SignupPageOptions) {
  const { app, siteOrigin } = pageAppOf(at);
  return respond(app, "Confirm your signup", h(AuthSignupView, { app: appKeyOf(app), siteOrigin, rid, ...options }), { status: options.error || options.birthdateError ? 400 : 200 });
}

const messageReplies = {
  "This link does not work": "ReplyLinkInvalid",
  "Too many tries": "ReplyTooManyTries",
  "Not available": "ReplyNotAvailable",
  "This page has expired": "ReplyExpired",
  "Already signed in": "ReplyAlreadySignedIn",
  "We need to check this number": "ReplyCheckNumber",
  "Connect again": "ReplyConnectAgain",
  "Please try again": "ReplyRetryLater",
  "Sign-in unavailable": "ReplySignInUnavailable",
  "Not allowed": "ReplyNotAllowed",
} as const satisfies Record<string, Reply>;

/** The heading of a page that stops the connection. */
export type MessageTitle = keyof typeof messageReplies | "Sign in first";

export function messagePage(at: PageApp, title: MessageTitle, text: string, status = 400, retryPath?: string) {
  const { app, siteOrigin } = pageAppOf(at);
  const view = title === "Sign in first"
    ? load(consentsInitial, "LoadedSignedOut", 0).view
    : pageFor(title === "Please try again" && !retryPath ? "ReplySignupUnavailable" : messageReplies[title]).view;
  return respond(app, title, h(AuthMessageView, { app: appKeyOf(app), siteOrigin, view: view as AuthMessage, text, retryHref: retryPath }), { status });
}

/**
 * The connected assistants page. `confirmation` identifies the selected grant and the form proof for this browser session;
 * the page then asks the person to confirm the removal of that grant. `removal` is the result of a confirmed removal,
 * and `grants` are the grants that stay after it.
 */
export function consentsPage(at: PageApp, grants: Array<Grant & { clientName: string | null }>, fmt: (ms: number) => string, o: { confirmation?: { grantId: string; proof: string }; removal?: Extract<RemoveReply, "Removed" | "NothingRemoved"> } = {}) {
  const { app, siteOrigin } = pageAppOf(at);
  // spec/connectedAssistants.md, "A confirmed removal shows its result"
  const before = load(consentsInitial, "LoadedList", grants.length + (o.removal === "Removed" ? 1 : 0));
  const asked = canChooseRemoval(before) ? chooseRemoval(before) : before;
  const shown = o.removal === undefined
    ? (o.confirmation !== undefined && grants.some(g => g.id === o.confirmation?.grantId) && canChooseRemoval(before) ? chooseRemoval(before) : before)
    : canConfirmRemoval(asked, grants.length) ? confirmRemoval(asked, o.removal, grants.length) : load(consentsInitial, "LoadedList", grants.length);
  const view = h(ConnectedAssistantsView, {
    app: appKeyOf(app),
    siteOrigin,
    view: shown.view,
    grants: grants.map(g => ({ id: g.id, clientName: g.clientName, allowedOn: fmt(g.createdAt), scopes: g.scopes })),
    notice: shown.notice,
    confirmingGrantId: shown.view === "ConfirmingRemoval" ? o.confirmation?.grantId : undefined,
    removalProof: shown.view === "ConfirmingRemoval" ? o.confirmation?.proof : undefined,
  });
  return respond(app, "Connected assistants", view);
}
