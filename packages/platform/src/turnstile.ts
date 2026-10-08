// Cloudflare Turnstile in front of the OTP send (platform plan 3.2). Free; fights SMS pumping.
// Required outside dev: createPublicApi refuses to start without a verifier there.
import { devShortcutsAllowed, type Env } from "./env.ts";

export interface TurnstileVerifier {
  /** True when the token is valid for this IP and (when given) was issued on one of these host names. */
  verify(token: string | undefined, ip: string, hostnames?: readonly string[]): Promise<boolean>;
}

/** A siteverify call that has not answered after this long fails closed. */
export const TURNSTILE_TIMEOUT_MS = 3_000;

export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(private readonly secret: string, private readonly fetchFn: typeof fetch = fetch, private readonly timeoutMs = TURNSTILE_TIMEOUT_MS) {}
  async verify(token: string | undefined, ip: string, hostnames?: readonly string[]) {
    if (!token || token.length > 2048) return false;
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("turnstile timeout")), this.timeoutMs); });
      const call = (async () => {
        const res = await this.fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(this.timeoutMs) });
        return (await res.json()) as { success?: boolean; hostname?: string };
      })();
      const r = await Promise.race([call, timeout]);
      if (r.success !== true) return false;
      // A token solved on another site (or a test key's "example.com") is not valid here.
      return !hostnames?.length || (typeof r.hostname === "string" && hostnames.includes(r.hostname.toLowerCase()));
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Accepts every request. Dev only: refused in production and outside PLATFORM_ENV=dev. */
export class DevTurnstileBypass implements TurnstileVerifier {
  constructor(env: Env = process.env) {
    if (!devShortcutsAllowed(env)) throw new Error("the Turnstile bypass is refused in production and outside PLATFORM_ENV=dev");
  }
  async verify() { return true; }
}

/** Cloudflare when TURNSTILE_SECRET_KEY is set; else the dev bypass (dev only: any other environment must set the key). */
export function turnstileFromEnv(env: Env = process.env): TurnstileVerifier {
  return env.TURNSTILE_SECRET_KEY ? new CloudflareTurnstile(env.TURNSTILE_SECRET_KEY) : new DevTurnstileBypass(env);
}
