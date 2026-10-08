// What the MCP server needs from the platform, and an adapter that builds it from
// packages/platform (the same OTP service, sessions and people store as the sites' /api/*).
// The human signs in with the platform phone code on our page; the client and the agent never
// send or see a phone number or a code.
import type { Accounts, AppInfo, MembershipState, OtpService, PeopleStore, SessionService } from "@thenetwork/platform";
import { normalizePhone } from "@thenetwork/platform";
import type { McpAppId } from "./apps.ts";

/** A membership state as the person's own agent may see it. No age, no member id, nothing about others. */
export type PublicStatus = "not_joined" | "invited" | "onboarding" | "active" | "stopped" | "on_hold";

export interface SignedIn {
  e164: string;
  personId: string | null;
  /** A rotated site session: send this Set-Cookie with the page so the person stays signed in. */
  setCookie?: string;
}

export interface PlatformHooks {
  /** E.164 for a typed number, or undefined (the platform accepts +1 only). */
  normalizePhone(input: unknown): string | undefined;
  /** Send a code. The same answer whether or not the number is known. */
  startOtp(app: McpAppId, e164: string, ip: string): Promise<{ ok: true } | { ok: false; error: "rate_limited" | "unavailable" }>;
  verifyOtp(app: McpAppId, e164: string, code: string, ip: string): Promise<boolean>;
  /** After a verified code: the person of the number, or "held" when staff must look at the number first. */
  login(e164: string): Promise<{ personId: string | null } | "held">;
  /** The person of a number now, or null (no person, deleted, or on hold). */
  personFor(e164: string): Promise<string | null>;
  /**
   * The platform's keyed hash of a number (PLATFORM_HASH_KEY). OAuth rows keep only this, never the
   * number, so a reader of the oauth schema cannot tell whose number uses which app.
   */
  phoneKey(e164: string): string;
  /** The person whose number has this keyed hash now, or null (no person, deleted, or on hold). */
  personForKey(phoneKey: string): Promise<string | null>;
  /** The person's own state in one app. */
  status(personId: string, app: McpAppId): Promise<PublicStatus>;
  /**
   * The profile the person gave their assistant, delivered to their own member on this app as if they
   * had texted it (the Network reads it with the same rules). Undefined: the platform does not take profiles.
   */
  submitProfile?(personId: string, app: McpAppId, phoneKey: string, text: string): Promise<"accepted" | "not_member">;
  /** The person already signed in on this site (the site's session cookie), if any. */
  session?(app: McpAppId, req: Request): Promise<SignedIn | undefined>;
  /** Start a site session after a verified code, so the person is signed in on the site too. Returns a Set-Cookie value. */
  createSession?(app: McpAppId, who: SignedIn): Promise<string | undefined>;
}

/** Platform membership state -> what the person's agent sees. */
export function publicStatus(state: MembershipState | undefined, review: string | null | undefined): PublicStatus {
  if (review) return "on_hold";
  switch (state) {
    case undefined: case "removed": return "not_joined";
    case "invited": return "invited";
    case "onboarding": return "onboarding";
    case "active": return "active";
    case "paused": return "stopped";
    // A safety restriction is not explained to an agent; the person sees the details on the site.
    case "restricted": return "on_hold";
  }
}

export interface PlatformParts {
  store: PeopleStore;
  otp: OtpService;
  accounts: Accounts;
  sessions?: SessionService;
  /** The platform app for an MCP app id (undefined: the platform does not serve it, so sign-in is refused). */
  app(id: McpAppId): AppInfo | undefined;
  /** The site session cookie name for an app (the sites' /api/* uses sid_<app> in dev and __Host-sid elsewhere). */
  cookieName?(id: McpAppId): string;
  /** Seconds. Default 30 days (the platform session time). */
  sessionMaxAge?: number;
  /** Add "; Secure" to the site cookie (default true). */
  secureCookie?: boolean;
  /** The service's profile intake (NetworkService.submitProfile). Without it, submit_profile answers "not available". */
  submitProfile?: (personId: string, app: McpAppId, e164: string, text: string) => Promise<"accepted" | "not_member">;
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * PlatformHooks from the platform parts. With createPublicApi: platformHooks({ store, otp: api.otp,
 * accounts: api.accounts, sessions: api.sessions, app: id => apps[id] }).
 */
export function platformHooks(p: PlatformParts): PlatformHooks {
  const cookieName = p.cookieName ?? (() => "__Host-sid");
  const siteCookie = (id: McpAppId, token: string) =>
    `${cookieName(id)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${p.sessionMaxAge ?? 30 * 24 * 3600}${p.secureCookie === false ? "" : "; Secure"}`;
  return {
    normalizePhone,
    async startOtp(id, e164, ip) {
      const app = p.app(id);
      if (!app) return { ok: false, error: "unavailable" };
      // A banned number gets the same answer as any other, and no code is sent (no sign-in, no grant).
      if (await p.accounts.banned(e164)) return { ok: true };
      const r = await p.otp.start(app, e164, ip);
      return r.ok ? { ok: true } : { ok: false, error: "rate_limited" };
    },
    async verifyOtp(id, e164, code, ip) {
      const app = p.app(id);
      return app ? p.otp.verify(app.id, e164, code, ip) : false;
    },
    async login(e164) {
      if ((await p.accounts.banned(e164)) || (await p.accounts.seen(e164)) === "held") return "held";
      return { personId: (await p.accounts.personFor(e164))?.id ?? null };
    },
    async personFor(e164) {
      return (await p.accounts.personFor(e164))?.id ?? null;
    },
    phoneKey: e164 => p.accounts.phoneHash(e164),
    async personForKey(key) {
      return (await p.accounts.byPhoneHash(key))?.person.id ?? null;
    },
    ...(p.submitProfile ? {
      submitProfile: async (personId: string, id: McpAppId, key: string, text: string) => {
        // The grant holds only the keyed hash: the number is found here, and only for that same person.
        const who = await p.accounts.byPhoneHash(key);
        return who && who.person.id === personId ? p.submitProfile!(personId, id, who.e164, text) : "not_member";
      },
    } : {}),
    async status(personId, id) {
      const app = p.app(id);
      if (!app) return "not_joined";
      const m = await p.store.getMembership(personId, app.id);
      return publicStatus(m?.state, m?.review);
    },
    session: p.sessions && (async (id, req) => {
      const app = p.app(id);
      const token = cookieValue(req.headers.get("cookie"), cookieName(id));
      const a = app && token ? await p.sessions!.authenticate(app.id, token) : undefined;
      if (!a || (await p.accounts.held(a.session.e164))) return undefined;
      return {
        e164: a.session.e164, personId: (await p.accounts.personFor(a.session.e164))?.id ?? null,
        ...(a.rotated ? { setCookie: siteCookie(id, a.token) } : {}),
      };
    }),
    createSession: p.sessions && (async (id, who) => {
      const app = p.app(id);
      if (!app) return undefined;
      const { token } = await p.sessions!.create(app.id, who.e164, who.personId);
      return siteCookie(id, token);
    }),
  };
}
