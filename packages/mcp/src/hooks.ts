// What the MCP server needs from the platform, and an adapter that builds it from
// packages/platform (the same OTP service, sessions and people store as the sites' /api/*).
// The human signs in with the platform phone code on our page; the client and the agent never
// send or see a phone number or a code.
import type { Accounts, AppInfo, JoinError, JoinInput, Membership, MembershipState, OtpService, PeopleStore, SessionService } from "@thenetwork/platform";
import { canJoinApp, canMatchInApp, lowestAge, normalizePhone, resolveConsent, signupAccountView } from "@thenetwork/platform";
import type { McpAppId } from "./apps.ts";
import { connectorMembershipStatus, type MemberStatus } from "../../core/src/generated/connectorTools.ts";
import type { CloudGrantAuthority } from "../../core/src/svc/network-delegation.ts";
import type { Grant } from "./store.ts";

/** A membership state as the person's own agent may see it. No age, no member id, nothing about others. */
export type PublicStatus = "not_joined" | "invited" | "onboarding" | "active" | "stopped" | "on_hold";

export interface SignedIn {
  e164: string;
  personId: string | null;
  /** Server-held session hash for signing a confirmation that only this session can submit. */
  browserBinding?: string;
  /** Server-held binding of this authenticated session's immediate predecessor. */
  rotatedFromBrowserBinding?: string;
  /** A rotated site session: send this Set-Cookie with the page so the person stays signed in. */
  setCookie?: string;
}

export interface BrowserSignup {
  consent: Pick<AppInfo["consent"], "text" | "version">;
  requiresInvitation: boolean;
}

type BrowserSignupResult = { ok: true; membership: Membership; created: boolean } | { ok: false; error: JoinError };

/** The assistant behind an OAuth client, by its redirect hosts (handler.ts assistantOf). */
export type AssistantKind = "chatgpt" | "claude" | "grok" | "web";

/** One update for the person's assistant: a member-safe line from the inbox (packages/notify). */
export interface PublicUpdate { summary: string; at: string; kind: string }

export interface SavedProfileFields {
  firstName: string | null;
  about: unknown;
  interests: unknown;
  neighborhood: unknown;
  homeCity: unknown;
}

export interface PlatformHooks {
  cloudAuthorityRequired?(app: McpAppId): boolean;
  /** Only an OAuth-owner-generated live request ID, never a caller redirect URL. */
  beginCloudOAuth?(app: McpAppId, requestId: string): Promise<{url:string;setCookie:string}|undefined>;
  cloudGrantAuthority?(app: McpAppId, req: Request, resource: string): Promise<CloudGrantAuthority | "unavailable" | undefined>;
  validateCloudGrant?(grant: Grant): Promise<"valid" | "invalid" | "unavailable">;
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
  /** Resolve a grant's canonical phone binding without collapsing a held number into an unowned one. */
  grantOwner(phoneKey: string): Promise<{ personId: string | null; held: boolean }>;
  /** True when the grant's phone or person is banned now. Read at every use of a connector credential. */
  grantIsBanned(phoneKey: string, personId: string | null): Promise<boolean>;
  /** Internal canonical phone-age guard. No age is exposed to the agent. Missing support disables drafts. */
  withSignupAgePolicy?<T>(phoneKey: string, app: McpAppId, fn: (allowed: boolean) => Promise<T>): Promise<T>;
  /** Wire the one temporary-draft cleanup consumer to canonical age recording, including null-person phones. */
  setSignupAgeCleanup?(fn: (phoneKey: string, app: McpAppId) => Promise<void>): void;
  /** The person's own state in one app. */
  status(personId: string, app: McpAppId, phoneKey: string): Promise<PublicStatus>;
  /** Fields the active member saved in this app. The connector applies its output gate before disclosure. */
  readProfile?(personId: string, app: McpAppId, phoneKey: string): Promise<SavedProfileFields | undefined>;
  /** Current adult Slop member and phone owner, with no safety hold or ban. Never enrolls anyone. */
  customChatGptSlopEligible?(personId: string, phoneKey: string): Promise<boolean>;
  /**
   * The profile the person gave their assistant, delivered to their own member on this app as if they
   * had texted it (the Network reads it with the same rules). Undefined: the platform does not take profiles.
   */
  submitProfile?(personId: string, app: McpAppId, phoneKey: string, text: string): Promise<"accepted" | "not_member" | "stopped">;
  /** Scope the private retry receipt to this exact authorized grant and approved profile. */
  profileSubmissionFingerprint?(app: McpAppId, grantId: string, text: string): string;
  /**
   * The person's own unseen updates in this app from the single inbox, marked seen on every surface.
   * Undefined: the platform has no inbox (get_updates answers "not available").
   */
  updates?(personId: string, app: McpAppId, assistant: AssistantKind, token?: string): Promise<PublicUpdate[]>;
  /** An assistant was connected (consent granted) or disconnected (grant revoked) for a person. */
  assistantLinked?(personId: string, assistant: AssistantKind, active: boolean): Promise<void>;
  /** The person's existing app session on the host serving this request, if any. */
  session?(app: McpAppId, req: Request, host?: McpAppId): Promise<SignedIn | "unavailable" | undefined>;
  /** Start an app session on this host after a verified code. Returns a Set-Cookie value. */
  createSession?(app: McpAppId, who: SignedIn, host?: McpAppId): Promise<string | undefined>;
  /** The server's current eligibility and wording for this same-app verified browser. */
  signupEnrollment?(app: McpAppId, who: SignedIn): Promise<BrowserSignup | undefined>;
  joinSignup?(app: McpAppId, who: SignedIn, input: JoinInput, invitation?: string): Promise<BrowserSignupResult>;
}

const PUBLIC_STATUS: Record<MemberStatus, PublicStatus> = {
  NotJoined: "not_joined", Invited: "invited", Onboarding: "onboarding", Active: "active", Stopped: "stopped", OnHold: "on_hold",
};

/** Only the coarse status reaches the person's agent. */
export function publicStatus(state: MembershipState | undefined, review: string | null | undefined, optedOut = false): PublicStatus {
  return PUBLIC_STATUS[connectorMembershipStatus(state ?? "", !!review, optedOut)];
}

export interface PlatformParts {
  authenticatedSiteSession?(app: AppInfo["id"], req: Request, browserCookieName?: string): Promise<Awaited<ReturnType<SessionService["authenticate"]>> | "unavailable">;
  cloudAuthorityRequired?: PlatformHooks["cloudAuthorityRequired"];
  beginCloudOAuth?: PlatformHooks["beginCloudOAuth"];
  cloudGrantAuthority?: PlatformHooks["cloudGrantAuthority"];
  validateCloudGrant?: PlatformHooks["validateCloudGrant"];
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
  /** The single inbox (NetworkService.updatesFor). Without it, get_updates answers "not available". */
  updates?: PlatformHooks["updates"];
  /** Surface signals for the inbox (NetworkService.assistantLinked). */
  assistantLinked?: PlatformHooks["assistantLinked"];
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
  let draftCleanup: ((phoneKey: string, app: McpAppId) => Promise<void>) | undefined;
  const cleanAge = async (key: string, age: number) => {
    for (const id of ["ntwrk", "friends"] as const) {
      const app = p.app(id);
      if (app && !canJoinApp(age, app)) await draftCleanup?.(key, id);
    }
  };
  // The hub needs one cookie for each verified app. SessionService still checks the row's app.
  const secure = p.secureCookie !== false;
  const cookieName = (id: McpAppId, host?: McpAppId) => host === "ntwrk" && id !== host && !p.cloudAuthorityRequired?.(id)
    ? `${secure ? "__Host-" : ""}mcp_sid_${id}`
    : p.cookieName?.(id) ?? "__Host-sid";
  const siteCookie = (name: string, token: string) =>
    `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${p.sessionMaxAge ?? 30 * 24 * 3600}${secure ? "; Secure" : ""}`;
  return {
    cloudAuthorityRequired: p.cloudAuthorityRequired,
    beginCloudOAuth: p.beginCloudOAuth,
    cloudGrantAuthority: p.cloudGrantAuthority,
    validateCloudGrant: p.validateCloudGrant,
    normalizePhone,
    setSignupAgeCleanup(fn) { draftCleanup = fn; p.store.setAgeFloorCleanup(cleanAge); },
    withSignupAgePolicy(key, id, fn) {
      return p.store.withPhoneAgeGuard(key, async () => {
        const owner = await p.accounts.byPhoneHash(key);
        const age = lowestAge(await p.store.ageFloor(key), owner?.person.lowestAge);
        const app = p.app(id);
        if (age !== undefined) await cleanAge(key, age);
        return fn(!!app && (age === undefined || canJoinApp(age, app)));
      });
    },
    async startOtp(id, e164, ip) {
      if(p.cloudAuthorityRequired?.(id))return {ok:false,error:"unavailable"};
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
    async grantOwner(key) {
      const phone = await p.store.findPhoneByHash(key);
      if (!phone || p.accounts.phoneHash(phone.e164) !== key) return { personId: null, held: false };
      if (phone.hold !== null) return { personId: null, held: true };
      const person = await p.store.getPerson(phone.personId);
      return { personId: person?.deletedAt === null ? person.id : null, held: false };
    },
    async grantIsBanned(key, personId) {
      return p.store.isBanned(key, personId ?? (await p.accounts.byPhoneHash(key))?.person.id ?? null);
    },
    async customChatGptSlopEligible(personId, key) {
      const app = p.app("slop");
      const who = await p.accounts.byPhoneHash(key);
      if (!app || !who || who.person.id !== personId || await p.accounts.banned(who.e164, who.person)) return false;
      const m = await p.store.getMembership(personId, "slop");
      return !!m && !m.review && ["active", "onboarding"].includes(m.state)
        && canMatchInApp(await p.accounts.lowestAge(who.e164, who.person), app);
    },
    ...(p.submitProfile ? {
      profileSubmissionFingerprint: (app: McpAppId, grantId: string, text: string) => p.accounts.profileSubmissionFingerprint(app, grantId, text),
      submitProfile: async (personId: string, id: McpAppId, key: string, text: string) => {
        // The grant holds only the keyed hash: the number is found here, and only for that same person.
        const who = await p.accounts.byPhoneHash(key);
        if (!who || who.person.id !== personId) return "not_member";
        if (resolveConsent(await p.store.lastConsent(who.e164, id)) === "opted_out") return "stopped";
        return p.submitProfile!(personId, id, who.e164, text);
      },
    } : {}),
    ...(p.updates ? { updates: p.updates } : {}),
    ...(p.assistantLinked ? { assistantLinked: p.assistantLinked } : {}),
    async status(personId, id, key) {
      const app = p.app(id);
      if (!app) return "not_joined";
      const who = await p.accounts.byPhoneHash(key);
      if (!who || who.person.id !== personId) return "on_hold";
      const m = await p.store.getMembership(personId, app.id);
      const optedOut = resolveConsent(await p.store.lastConsent(who.e164, app.id)) === "opted_out";
      return publicStatus(m?.state, m?.review, optedOut);
    },
    async readProfile(personId, id, key) {
      const app = p.app(id);
      const who = await p.accounts.byPhoneHash(key);
      if (!app || !who || who.person.id !== personId) return;
      const own = await p.accounts.activeMembership(app, { e164: who.e164, personId });
      if (!own) return;
      const { firstName, profile } = own.membership;
      return { firstName, about: profile.about, interests: profile.interests, neighborhood: profile.neighborhood, homeCity: profile.homeCity };
    },
    async signupEnrollment(id, who) {
      const app = p.app(id);
      if (!app || app.joinMode === "waitlist") return undefined;
      const eligibility = await p.accounts.canJoin(app, who);
      if ((eligibility.person?.id ?? null) !== who.personId || (!eligibility.canJoin && eligibility.reason !== "invite_only")) return undefined;
      return { consent: app.consent, requiresInvitation: eligibility.reason === "invite_only" };
    },
    async joinSignup(id, who, input, invitation) {
      const app = p.app(id);
      if (!app || app.joinMode === "waitlist") return { ok: false, error: "invalid" };
      const view = signupAccountView(id, p.accounts.phoneHash(who.e164), who.personId);
      return p.accounts.join(app, who, input, undefined, invitation, view);
    },
    session: p.sessions && (async (id, req, host) => {
      const app = p.app(id);
      const name = cookieName(id, host);
      const token = cookieValue(req.headers.get("cookie"), name);
      const a = app && token ? await (p.authenticatedSiteSession ? p.authenticatedSiteSession(app.id, req, name) : p.sessions!.authenticate(app.id, token)) : undefined;
      if(a==="unavailable")return "unavailable";
      if (!a || (await p.accounts.held(a.session.e164))) return undefined;
      const personId = (await p.accounts.personFor(a.session.e164))?.id ?? null;
      if (a.session.personId !== null && a.session.personId !== personId) return undefined;
      return {
        e164: a.session.e164, personId, browserBinding: a.session.tokenHash,
        ...(a.session.rotatedFrom ? { rotatedFromBrowserBinding: a.session.rotatedFrom } : {}),
        ...(a.rotated ? { setCookie: siteCookie(name, a.token) } : {}),
      };
    }),
    createSession: p.sessions && (async (id, who, host) => {
      if(p.cloudAuthorityRequired?.(id))return undefined;
      const app = p.app(id);
      if (!app) return undefined;
      const { token } = await p.sessions!.create(app.id, who.e164, who.personId);
      return siteCookie(cookieName(id, host), token);
    }),
  };
}
