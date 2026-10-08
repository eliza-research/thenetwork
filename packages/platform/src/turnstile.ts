// Cloudflare Turnstile in front of the OTP send (platform plan 3.2). Free; fights SMS pumping.
import { devShortcutsAllowed, type Env } from "./env.ts";

export interface TurnstileVerifier { verify(token: string | undefined, ip: string): Promise<boolean> }

export class CloudflareTurnstile implements TurnstileVerifier {
  constructor(private readonly secret: string, private readonly fetchFn: typeof fetch = fetch) {}
  async verify(token: string | undefined, ip: string) {
    if (!token || token.length > 2048) return false;
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    try {
      const res = await this.fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
      const r = (await res.json()) as { success?: boolean };
      return r.success === true;
    } catch {
      return false;
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
