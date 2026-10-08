// Cloudflare Turnstile on the phone step (platform plan 3.2: it fights SMS pumping on /api/auth/otp/start).
// Markup: <meta name="turnstile-sitekey" content="{{TURNSTILE_SITE_KEY}}"> in <head> (the build fills it
// from TURNSTILE_SITE_KEY) and an empty [data-turnstile] element inside form[data-form="phone"].
// With no site key (local dev) there is no widget and no token, and the dev API does not ask for one.
// The script is the only third-party code on the sites; the CSP in sites.ts allows exactly this origin.

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const SRC = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
}

export interface TurnstileHandle {
  /** The current token, or undefined while the check runs or after it failed. One token per request. */
  token(): string | undefined;
  /** Ask for a new token (after every request: a token works once). */
  reset(): void;
}

/** The site key from the page, or "" when the build had none. */
export function siteKey(doc: Document = document): string {
  const v = doc.querySelector<HTMLMetaElement>('meta[name="turnstile-sitekey"]')?.content.trim() ?? "";
  return v.startsWith("{{") ? "" : v;
}

let loading: Promise<TurnstileApi | null> | null = null;
function load(): Promise<TurnstileApi | null> {
  loading ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve(((window as unknown as { turnstile?: TurnstileApi }).turnstile) ?? null);
    s.onerror = () => resolve(null);
    document.head.append(s);
  });
  return loading;
}

/** Mounts the widget in the form's [data-turnstile] element. Returns null when Turnstile is off for this page. */
export function mountTurnstile(form: HTMLFormElement): TurnstileHandle | null {
  const key = siteKey();
  const box = form.querySelector<HTMLElement>("[data-turnstile]");
  if (!key || !box) return null;
  let current: string | undefined;
  let id: string | undefined;
  let api: TurnstileApi | null = null;
  void load().then((t) => {
    api = t;
    if (!t) return;
    id = t.render(box, {
      sitekey: key,
      action: "otp_start",
      callback: (tok: string) => (current = tok),
      "expired-callback": () => (current = undefined),
      "error-callback": () => (current = undefined),
    });
  });
  return {
    token: () => current,
    reset: () => {
      current = undefined;
      if (api && id) api.reset(id);
    },
  };
}
