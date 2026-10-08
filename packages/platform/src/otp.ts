// Web phone verification (platform plan 3.1-3.2). The provider sends the code; this service keeps
// the challenge, the attempt count, the expiry and the rate limits, the same for every provider.
//  - 3 sends per number per hour and 6 a day (across every app), 10 per IP per hour, at least 30 s
//    between sends to a number, and a global budget of sends per hour (an alert in the log when it is
//    reached). A refused request is not counted, so it never extends a limit.
//  - A code expires after 10 minutes. 5 wrong codes use the challenge up. Code checks are limited too:
//    10 per number and 30 per IP per hour, across every app.
//  - Every limit is the same whether or not the number is known (no enumeration).
import { randomInt } from "node:crypto";
import type { AppId, AppInfo } from "./apps.ts";
import { devShortcutsAllowed, type Env } from "./env.ts";
import { keyedHash, maskPhone, safeEqual } from "./phone.ts";
import type { PeopleStore } from "./store.ts";

export interface OtpProvider {
  readonly name: string;
  /** Send a code to the number. Return the code only when this server must check it (dev), and the provider's id for the verification. */
  send(e164: string, app: AppInfo): Promise<{ code?: string; ref?: string }>;
  /** Check a code that the provider holds (Twilio Verify), bound to the verification `ref` when there is one. Not used when send returned the code. */
  check?(e164: string, code: string, ref?: string | null): Promise<boolean>;
}

export const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * Dev only: makes a code and prints it to the server log. Refused in production and in any
 * environment not declared dev (PLATFORM_ENV=dev; env.ts). Nothing is sent.
 */
export class DevConsoleProvider implements OtpProvider {
  readonly name = "dev_console";
  constructor(env: Env = process.env, private readonly log: (s: string) => void = s => console.log(s)) {
    if (!devShortcutsAllowed(env)) throw new Error("DevConsoleProvider is refused in production and outside PLATFORM_ENV=dev");
  }
  async send(e164: string, app: AppInfo) {
    const code = sixDigits();
    this.log(`[otp dev] ${app.id} ${maskPhone(e164)} code ${code}`);
    return { code };
  }
}

/**
 * Twilio Verify v2. Runs only with OTP_PROVIDER=twilio and TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_VERIFY_SERVICE_SID set. Twilio holds and checks the code. Tests pass a fake fetch.
 */
export class TwilioVerifyProvider implements OtpProvider {
  readonly name = "twilio_verify";
  private readonly auth: string;
  private readonly service: string;
  constructor(env: Env = process.env, private readonly fetchFn: typeof fetch = fetch, private readonly timeoutMs = 10_000) {
    const { OTP_PROVIDER, TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_VERIFY_SERVICE_SID: service } = env;
    if (OTP_PROVIDER !== "twilio") throw new Error("TwilioVerifyProvider needs OTP_PROVIDER=twilio");
    if (!sid || !token || !service) throw new Error("TwilioVerifyProvider needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID");
    this.auth = `Basic ${btoa(`${sid}:${token}`)}`;
    this.service = service;
  }
  private async post(path: string, form: Record<string, string>) {
    const res = await this.fetchFn(`https://verify.twilio.com/v2/Services/${encodeURIComponent(this.service)}/${path}`, {
      method: "POST",
      headers: { authorization: this.auth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; sid?: string };
    return { ok: res.ok, status: res.status, body };
  }
  /** The text names the app the person asked on (CustomFriendlyName), never another one. */
  async send(e164: string, app: AppInfo) {
    const r = await this.post("Verifications", { To: e164, Channel: "sms", CustomFriendlyName: app.name });
    if (!r.ok) throw new Error(`twilio verify send failed (${r.status})`);
    return r.body.sid ? { ref: r.body.sid } : {};
  }
  async check(e164: string, code: string, ref?: string | null) {
    const r = await this.post("VerificationCheck", ref ? { VerificationSid: ref, Code: code } : { To: e164, Code: code });
    return r.ok && r.body.status === "approved";
  }
}

/** The provider the environment asks for: Twilio when OTP_PROVIDER=twilio, else the dev console (dev only). */
export function otpProviderFromEnv(env: Env = process.env): OtpProvider {
  return env.OTP_PROVIDER === "twilio" ? new TwilioVerifyProvider(env) : new DevConsoleProvider(env);
}

export interface OtpLimits {
  ttlMs: number;
  maxAttempts: number;
  perPhonePerHour: number;
  perPhonePerDay: number;
  perIpPerHour: number;
  minGapMs: number;
  /** Every send, every number, every app: a ceiling against SMS pumping. */
  globalPerHour: number;
  /** Code checks (right or wrong) per number and per IP, across every app. */
  verifyPerPhonePerHour: number;
  verifyPerIpPerHour: number;
}
export const OTP_LIMITS: OtpLimits = {
  ttlMs: 10 * 60_000, maxAttempts: 5, perPhonePerHour: 3, perPhonePerDay: 6, perIpPerHour: 10, minGapMs: 30_000,
  globalPerHour: 500, verifyPerPhonePerHour: 10, verifyPerIpPerHour: 30,
};
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The rate-limit bucket of a client address: an IPv4 address as it is, an IPv6 address by its /64
 * (any VPS has a whole /64, so a per-address bucket would be unlimited; audit: IPv6 buckets).
 * "::ffff:1.2.3.4" is IPv4. Anything else (for example "unknown") is its own bucket.
 */
export function ipBucket(ip: string): string {
  const a = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (v4) return v4[1]!;
  if (!a.includes(":") || !/^[0-9a-f:.]+$/.test(a)) return a;
  const [head, tail = ""] = a.split("::");
  const h = head ? head.split(":") : [], t = a.includes("::") && tail ? tail.split(":") : [];
  if (h.length + t.length > 8) return a;
  const groups = a.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (groups.length !== 8) return a;
  return `${groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}

export type OtpStart = { ok: true } | { ok: false; error: "rate_limited"; retryAfterMs: number };

export class OtpService {
  readonly limits: OtpLimits;
  constructor(
    private readonly store: PeopleStore,
    private readonly provider: OtpProvider,
    private readonly opts: { hashKey: string; now?: () => number; limits?: Partial<OtpLimits>; log?: (s: string) => void },
  ) {
    this.limits = { ...OTP_LIMITS, ...opts.limits };
  }
  private now() { return (this.opts.now ?? Date.now)(); }

  /** Rate-limit, then send. A provider error is logged and not shown (the response stays the same). */
  async start(app: AppInfo, e164: string, ip: string): Promise<OtpStart> {
    const at = this.now(), L = this.limits;
    const hourLeft = HOUR - (at % HOUR);
    const limited = (retryAfterMs = hourLeft): OtpStart => ({ ok: false, error: "rate_limited", retryAfterMs });
    // The client IP (the socket address, or the IP a trusted site router signed: proxy.ts).
    if (!(await this.store.hit(`otp:ip:${keyedHash(this.opts.hashKey, ipBucket(ip))}`, HOUR, at, { limit: L.perIpPerHour })).ok) return limited();
    // The number alone, not the app: one number gets 3 codes an hour and 6 a day whatever site asks.
    const phoneKey = keyedHash(this.opts.hashKey, e164);
    const byPhone = await this.store.hit(`otp:phone:${phoneKey}`, HOUR, at, { limit: L.perPhonePerHour, minGapMs: L.minGapMs });
    if (!byPhone.ok) {
      const gap = byPhone.prevAt !== null && at - byPhone.prevAt < L.minGapMs;
      return limited(gap ? L.minGapMs - (at - byPhone.prevAt!) : hourLeft);
    }
    if (!(await this.store.hit(`otp:phone_day:${phoneKey}`, DAY, at, { limit: L.perPhonePerDay })).ok) return limited(DAY - (at % DAY));
    const all = await this.store.hit("otp:global", HOUR, at, { limit: L.globalPerHour });
    if (!all.ok) {
      this.opts.log?.(`[otp] ALERT: the global budget of ${L.globalPerHour} codes an hour is used up; sends are refused until the hour ends`);
      return limited();
    }
    try {
      const { code, ref } = await this.provider.send(e164, app);
      await this.store.putChallenge({
        app: app.id, e164, provider: this.provider.name, providerRef: ref ?? null, codeHash: code ? keyedHash(this.opts.hashKey, `${app.id}:${e164}:${code}`) : null,
        attempts: 0, createdAt: at, expiresAt: at + L.ttlMs, consumedAt: null,
      });
    } catch (e) {
      this.opts.log?.(`[otp] send failed for ${app.id}: ${(e as Error).message}`);
    }
    return { ok: true };
  }

  /** True once for the right code on the newest live challenge. Wrong, expired, used-up and unknown all give false. */
  async verify(app: AppId, e164: string, code: string, ip = "unknown"): Promise<boolean> {
    if (!/^\d{4,10}$/.test(code)) return false;
    const at = this.now(), L = this.limits;
    // Guessing across apps and challenges: a ceiling on code checks per number and per IP.
    if (!(await this.store.hit(`otp:verify:ip:${keyedHash(this.opts.hashKey, ipBucket(ip))}`, HOUR, at, { limit: L.verifyPerIpPerHour })).ok) return false;
    if (!(await this.store.hit(`otp:verify:phone:${keyedHash(this.opts.hashKey, e164)}`, HOUR, at, { limit: L.verifyPerPhonePerHour })).ok) return false;
    const c = await this.store.latestChallenge(app, e164);
    if (!c) return false;
    if (!(await this.store.claimAttempt(c.id, this.limits.maxAttempts, at))) return false;
    let ok: boolean;
    if (c.codeHash) ok = safeEqual(c.codeHash, keyedHash(this.opts.hashKey, `${app}:${e164}:${code}`));
    else ok = this.provider.check ? await this.provider.check(e164, code, c.providerRef).catch(() => false) : false;
    if (!ok) return false;
    return this.store.consumeChallenge(c.id, at);
  }
}
