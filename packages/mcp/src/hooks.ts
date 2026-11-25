import type { Accounts, AppInfo, JoinError, JoinInput, Membership, MembershipState, OtpService, PeopleStore, SessionService } from "@thenetwork/platform";
import { canJoinApp, effectiveAgeAt, normalizePhone, resolveConsent, signupAccountView } from "@thenetwork/platform";
import type { PhotoAccessState } from "@thenetwork/platform/src/photo-relay.ts";
import type { McpAppId } from "./apps.ts";
import { connectorMembershipStatus, type MemberStatus } from "../../core/src/generated/connectorTools.ts";
import type { MinorNotice } from "../../core/src/generated/textEnrollment.ts";
import { canBeMatched } from "../../core/src/policy.ts";
import type { CloudGrantAuthority } from "../../core/src/svc/network-delegation.ts";
import type { Grant } from "./store.ts";

export type PublicStatus = "not_joined" | "invited" | "onboarding" | "active" | "stopped" | "on_hold";

export interface SignedIn {
  e164: string;
  personId: string | null;
  browserBinding?: string;
  rotatedFromBrowserBinding?: string;
  setCookie?: string;
}

export interface BrowserSignup {
  consent: Pick<AppInfo["consent"], "text" | "version">;
  requiresInvitation: boolean;
}

type BrowserSignupResult = { ok: true; membership: Membership; created: boolean } | { ok: false; error: JoinError };

export type AssistantKind = "chatgpt" | "claude" | "grok" | "web";

export interface PublicUpdate { summary: string; at: string; kind: string }

export interface SavedProfileFields {
  firstName: string | null;
  about: unknown;
  interests: unknown;
  neighborhood: unknown;
  homeCity: unknown;
}

export interface LookingForEntry {
  ref: string;
  number: number;
  kind: "want" | "intent" | "request" | "posting";
  summary: string;
  status: "active" | "paused" | "waiting_on_you" | "open";
  inProgress: boolean;
  endsAt: number | null;
}

export interface LookingForView {
  entries: LookingForEntry[];
  closedRecently: { ref: string; summary: string; closedAt: number }[];
  checkWithPerson: { ref: string; summary: string; reason: "said_not_wanted" | "ended_recently" }[];
}

type LookingForChange = "pause" | "resume";

export type LookingForResult =
  | { kind: "applied"; entry: LookingForEntry; notice: string }
  | { kind: "unchanged"; entry: LookingForEntry }
  | { kind: "refused"; reason: "unknown_ref" | "daily_limit" | "closed" | "posting" | "adults_only" | "texts_off" | "not_member" };

export interface PhotoHolding {
  number: number;
  name: string | null;
  addedOn: string;
  sharedWith: { firstName: string; state: PhotoAccessState }[];
}

export interface PhotoHoldingsView { text: string; photos: PhotoHolding[] }

export type PhotoRequestStatus = "texted" | "done" | "refused" | "unavailable";

interface PhotoRequestResult { status: PhotoRequestStatus; text: string }

export interface PlatformHooks {
  cloudAuthorityRequired?(app: McpAppId): boolean;
  beginCloudOAuth?(app: McpAppId, requestId: string): Promise<{url:string;setCookie:string}|undefined>;
  cloudGrantAuthority?(app: McpAppId, req: Request, resource: string): Promise<CloudGrantAuthority | "unavailable" | undefined>;
  validateCloudGrant?(grant: Grant): Promise<"valid" | "invalid" | "unavailable">;
  normalizePhone(input: unknown): string | undefined;
  startOtp(app: McpAppId, e164: string, ip: string): Promise<{ ok: true } | { ok: false; error: "rate_limited" | "unavailable" }>;
  verifyOtp(app: McpAppId, e164: string, code: string, ip: string): Promise<boolean>;
  login(e164: string): Promise<{ personId: string | null } | "held">;
  personFor(e164: string): Promise<string | null>;
  phoneKey(e164: string): string;
  personForKey(phoneKey: string): Promise<string | null>;
  grantOwner(phoneKey: string): Promise<{ personId: string | null; held: boolean }>;
  grantIsBanned(phoneKey: string, personId: string | null): Promise<boolean>;
  signupAgeAllowed(phoneKey: string, app: McpAppId, at: number): Promise<boolean>;
  status(personId: string, app: McpAppId, phoneKey: string): Promise<PublicStatus>;
  minorMember(personId: string, phoneKey: string): Promise<boolean>;
  minorNotice?(personId: string, app: McpAppId, phoneKey: string): Promise<MinorNotice | undefined>;
  readProfile(personId: string, app: McpAppId, phoneKey: string): Promise<SavedProfileFields | undefined>;
  submitProfile?(personId: string, app: McpAppId, phoneKey: string, text: string): Promise<"accepted" | "not_member" | "stopped">;
  lookingFor?(personId: string, app: McpAppId, phoneKey: string): Promise<LookingForView | undefined>;
  changeLookingFor?(personId: string, app: McpAppId, phoneKey: string, grantId: string, ref: string, change: LookingForChange): Promise<LookingForResult>;
  photoHoldings?(personId: string, app: McpAppId, phoneKey: string): Promise<PhotoHoldingsView | undefined>;
  photoRequest?(personId: string, app: McpAppId, phoneKey: string, words: string): Promise<PhotoRequestResult>;
  profileSubmissionFingerprint?(app: McpAppId, grantId: string, text: string): string;
  updates?(personId: string, app: McpAppId, assistant: AssistantKind, token: string | undefined, passesLeakGate: (summary: string) => boolean): Promise<PublicUpdate[]>;
  assistantLinked?(personId: string, assistant: AssistantKind, active: boolean): Promise<void>;
  session?(app: McpAppId, req: Request, host?: McpAppId): Promise<SignedIn | "unavailable" | undefined>;
  createSession?(app: McpAppId, who: SignedIn, host?: McpAppId): Promise<string | undefined>;
  signupEnrollment?(app: McpAppId, who: SignedIn): Promise<BrowserSignup | undefined>;
  joinSignup?(app: McpAppId, who: SignedIn, input: JoinInput, invitation?: string): Promise<BrowserSignupResult>;
}

const PUBLIC_STATUS: Record<MemberStatus, PublicStatus> = {
  NotJoined: "not_joined", Invited: "invited", Onboarding: "onboarding", Active: "active", Stopped: "stopped", OnHold: "on_hold",
};

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
  app(id: McpAppId): AppInfo | undefined;
  cookieName?(id: McpAppId): string;
  sessionMaxAge?: number;
  secureCookie?: boolean;
  submitProfile?: (personId: string, app: McpAppId, e164: string, text: string) => Promise<"accepted" | "not_member">;
  lookingFor?: (personId: string, app: McpAppId, e164: string) => Promise<LookingForView | undefined>;
  minorNotice?: (personId: string, app: McpAppId, e164: string) => Promise<MinorNotice | undefined>;
  changeLookingFor?: (personId: string, app: McpAppId, e164: string, grantId: string, ref: string, change: LookingForChange) => Promise<LookingForResult>;
  photoHoldings?: (personId: string, app: McpAppId, e164: string) => Promise<PhotoHoldingsView | undefined>;
  photoRequest?: (personId: string, app: McpAppId, e164: string, words: string) => Promise<PhotoRequestResult>;
  updates?: PlatformHooks["updates"];
  assistantLinked?: PlatformHooks["assistantLinked"];
  /** True when the app's Network holds this member (a staff or trust hold until a review). The membership row does not show it. */
  memberHeld?: (app: AppInfo["id"], memberId: string) => Promise<boolean>;
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function platformHooks(p: PlatformParts): PlatformHooks {
  const ownerE164 = async (personId: string, key: string): Promise<string | undefined> => {
    const who = await p.accounts.byPhoneHash(key);
    return who && who.person.id === personId ? who.e164 : undefined;
  };
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
    async startOtp(id, e164, ip) {
      if(p.cloudAuthorityRequired?.(id))return {ok:false,error:"unavailable"};
      const app = p.app(id);
      if (!app) return { ok: false, error: "unavailable" };
      const r = await p.otp.start(app, e164, ip, await p.accounts.banned(e164));
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
    async signupAgeAllowed(key, id, at) {
      const app = p.app(id);
      const owner = await p.accounts.byPhoneHash(key);
      const age = effectiveAgeAt(await p.store.ageStanding(owner?.person.id ?? null, key), at);
      return !!app && (age === undefined || canJoinApp(age, app));
    },
    ...(p.submitProfile ? {
      profileSubmissionFingerprint: (app: McpAppId, grantId: string, text: string) => p.accounts.profileSubmissionFingerprint(app, grantId, text),
      submitProfile: async (personId: string, id: McpAppId, key: string, text: string) => {
        const e164 = await ownerE164(personId, key);
        if (!e164) return "not_member";
        if (resolveConsent(await p.store.lastConsent(e164, id)) === "opted_out") return "stopped";
        return p.submitProfile!(personId, id, e164, text);
      },
    } : {}),
    ...(p.lookingFor ? {
      lookingFor: async (personId: string, id: McpAppId, key: string) => {
        const e164 = await ownerE164(personId, key);
        return e164 ? p.lookingFor!(personId, id, e164) : undefined;
      },
    } : {}),
    ...(p.minorNotice ? {
      minorNotice: async (personId: string, id: McpAppId, key: string) => {
        const e164 = await ownerE164(personId, key);
        return e164 ? p.minorNotice!(personId, id, e164) : undefined;
      },
    } : {}),
    ...(p.changeLookingFor ? {
      changeLookingFor: async (personId: string, id: McpAppId, key: string, grantId: string, ref: string, change: LookingForChange): Promise<LookingForResult> => {
        const e164 = await ownerE164(personId, key);
        return e164 ? p.changeLookingFor!(personId, id, e164, grantId, ref, change) : { kind: "refused", reason: "not_member" };
      },
    } : {}),
    ...(p.photoHoldings ? {
      photoHoldings: async (personId: string, id: McpAppId, key: string) => {
        const e164 = await ownerE164(personId, key);
        return e164 ? p.photoHoldings!(personId, id, e164) : undefined;
      },
    } : {}),
    ...(p.photoRequest ? {
      photoRequest: async (personId: string, id: McpAppId, key: string, words: string): Promise<PhotoRequestResult> => {
        const e164 = await ownerE164(personId, key);
        return e164 ? p.photoRequest!(personId, id, e164, words) : { status: "unavailable", text: "" };
      },
    } : {}),
    ...(p.updates ? { updates: p.updates } : {}),
    ...(p.assistantLinked ? { assistantLinked: p.assistantLinked } : {}),
    async status(personId, id, key) {
      const app = p.app(id);
      if (!app) return "not_joined";
      const e164 = await ownerE164(personId, key);
      if (!e164) return "on_hold";
      const m = await p.store.getMembership(personId, app.id);
      const held = m && m.state !== "removed" && m.state !== "invited" ? await p.memberHeld?.(app.id, m.memberId) : false;
      const optedOut = resolveConsent(await p.store.lastConsent(e164, app.id)) === "opted_out";
      return publicStatus(m?.state, m?.review ?? (held ? "hold" : null), optedOut);
    },
    async minorMember(personId, key) {
      const who = await p.accounts.byPhoneHash(key);
      if (!who || who.person.id !== personId) return true;
      return !canBeMatched(await p.accounts.lowestAge(who.e164, who.person));
    },
    async readProfile(personId, id, key) {
      const app = p.app(id);
      const e164 = await ownerE164(personId, key);
      if (!app || !e164) return;
      const own = await p.accounts.activeMembership(app, { e164, personId });
      if (!own || await p.memberHeld?.(app.id, own.membership.memberId)) return;
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
      return p.accounts.join(app, { e164: who.e164, personId: who.personId, ...(who.browserBinding ? { session: who.browserBinding } : {}) }, input, undefined, invitation, view);
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
