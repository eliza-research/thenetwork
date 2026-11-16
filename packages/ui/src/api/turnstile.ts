// spec/browserJoin.md, "The page sends a number only when it is valid and the security check passed"

/** The only third-party origin of the sites; the content security policy allows exactly this one. */
export const turnstileOrigin = "https://challenges.cloudflare.com";

interface TurnstileApi {
  render(element: HTMLElement, options: Readonly<Record<string, unknown>>): string;
  remove(id: string): void;
}

/** What the widget reports: a token for one request, a failure, or an expired token. */
export interface TurnstileCallbacks {
  onPassed: (token: string) => void;
  onFailed: () => void;
  onExpired: () => void;
}

let loading: Promise<TurnstileApi | null> | undefined;

function load(): Promise<TurnstileApi | null> {
  loading ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = `${turnstileOrigin}/turnstile/v0/api.js?render=explicit`;
    script.async = true;
    script.onload = () => resolve((window as unknown as { turnstile?: TurnstileApi }).turnstile ?? null);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return loading;
}

/** The site key from `<meta name="turnstile-sitekey">`, or "" when the build had none (the site then has no security check). */
export function turnstileSiteKey(doc: Document = document): string {
  const value = doc.querySelector<HTMLMetaElement>('meta[name="turnstile-sitekey"]')?.content.trim() ?? "";
  return value.startsWith("{{") ? "" : value;
}

/** Shows the widget in the element and returns the function that removes it. A script that does not load counts as a failed check. */
export function mountTurnstile(element: HTMLElement, siteKey: string, callbacks: TurnstileCallbacks): () => void {
  let removed = false;
  let widget: { api: TurnstileApi; id: string } | undefined;
  void load().then((api) => {
    if (removed) return;
    if (!api) {
      callbacks.onFailed();
      return;
    }
    const id = api.render(element, {
      sitekey: siteKey,
      action: "otp_start",
      callback: callbacks.onPassed,
      "expired-callback": callbacks.onExpired,
      "error-callback": callbacks.onFailed,
    });
    widget = { api, id };
  });
  return () => {
    removed = true;
    if (widget) widget.api.remove(widget.id);
  };
}
