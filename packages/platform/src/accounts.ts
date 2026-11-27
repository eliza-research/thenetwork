// Person and membership rules for the public API and for the text channel (platform plan 2.4-2.6,
// 3.4, 4.3). Rules:
//  - The verified phone finds the person. A second app's join adds a membership to the same person.
//  - An under-age join stores nothing for that app (only the age floor).
//  - Nothing crosses apps by default. A share grant names fields; sensitive classes are never shareable.
//  - A phone not seen for 12 months may have a new owner: at the next login or message the number is
//    put on hold, and nobody can read or change the old owner's account until staff decide.
//  - Joins of one phone run one at a time (store.withLock), so parallel joins make one person, one
//    membership, one member and one opt-in.
//  - The opt-in wording is the app's canonical text (apps.ts ConsentText): the ledger stores that text
//    and its version, never what a client sent.
//  - A member changes their own number (PRD F25) in two steps: a fresh login on the current number
//    starts it and a code goes to the new number; the code confirms it. The same rules as a staff
//    change: a number on hold or a banned person or number never moves, a number that already belongs
//    to someone is refused, the consent history and the age floor move with the person, and the old
//    number's sessions end. The phone_changes row (keyed hashes only) is the audit record.
import { randomUUID } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { resolveCity } from "../../core/src/cities.ts";
import { isCity, LAUNCH_CITIES, type City } from "../../core/src/types.ts";
import { DAY } from "../../core/src/clock.ts";
import {
  hasScopedMembership, initial as accountPrivacyInitial, step as stepPrivacy, verifiedPrivacyOwnerMatches,
} from "../../core/src/generated/accountPrivacy.ts";
import {
  initial as phoneChangeInitial, phoneChangesPerDay, phoneChangeLifetimeMs, phoneChangeWindowMs, step as stepPhoneChange, type PhoneChangeFailure,
} from "../../core/src/generated/phoneChange.ts";
import { declineEndsUnboundAccess, joinAgeFieldsValid, joinConsentEvidenceAllowed, joinFailureForgetsMembership, profileJoinAge, signupAccountViewMatches, step as stepEnrollment, typedJoinEntry, type Enrollment } from "../../core/src/generated/siteEnrollment.ts";
import { browserSignupMemberAllowed } from "../../core/src/generated/oauthBrowserAuthorization.ts";
import { adultAge, verifiedBrowserBirthMayBeKept } from "../../core/src/generated/memberAge.ts";
import { canJoin, validAge } from "../../core/src/policy.ts";
import { type AgeReading, type AgeRecord, ageRecordOf, canJoinApp, effectiveAgeAt, joinAgeCheck, joinBirthDateUsable, lowestAge, readingAge, signupEligibilityAt, type TeenBarReason } from "./age.ts";
import type { AppId, AppInfo } from "./apps.ts";
import { type ConsentEvent, resolveConsent } from "./consent.ts";
import { InvitationUnavailable, type ReferralJoin } from "./invite-links.ts";
import type { SeedInvitationReferral } from "./seed-invitations.ts";
import { keyedHash } from "./phone.ts";
import { signupAccountView } from "./sessions.ts";
import type { AppLeaveInput, Membership, PeopleStore, Person, PhoneIdentity, PhoneMethod, RecordedMemberAge, SignupBirth } from "./store.ts";

export const RECYCLED_AFTER_MS = 365 * 24 * 3_600_000;
/** A started number change must be confirmed with the code from the new number within this time. */
export const NUMBER_CHANGE_MS = phoneChangeLifetimeMs;
/** Number changes a person may start in a day (each sends a code). */
export const NUMBER_CHANGES_PER_DAY = phoneChangesPerDay;
export type NumberChangeError = "reauth" | "same_number" | "review" | "no_person" | "rate_limited" | "no_pending_change" | "invalid_code" | "number_in_use";
const NUMBER_CHANGE_ERRORS: Record<Exclude<PhoneChangeFailure, "NoFailure">, NumberChangeError> = {
  StaleSignIn: "reauth",
  SameNumber: "same_number",
  ReviewNeeded: "review",
  NoPerson: "no_person",
  RateLimited: "rate_limited",
  NoPendingChange: "no_pending_change",
  InvalidCode: "invalid_code",
  NumberInUse: "number_in_use",
};
const numberChangeRefused = (failure: PhoneChangeFailure): { ok: false; error: NumberChangeError } => ({
  ok: false, error: failure === "NoFailure" ? "review" : NUMBER_CHANGE_ERRORS[failure],
});
/** Base-profile fields a person may share from one app to another. Sensitive classes are not in this list and never will be. */
export const SHAREABLE_FIELDS = ["first_name", "city", "age_band", "interests"] as const;

const HOME_CITY_ALIASES: Record<string, City> = {
  sf: "sf",
  "san francisco": "sf",
  "bay area": "sf",
  "the bay area": "sf",
  nyc: "nyc",
  "new york": "nyc",
  "new york city": "nyc",
  la: "la",
  "los angeles": "la",
  "l.a.": "la",
  socal: "la",
  chicago: "chicago",
  chi: "chicago",
  chicagoland: "chicago",
  miami: "miami",
  "south florida": "miami",
};

/** Only an explicitly named city/region, never a ZIP or inferred neighborhood. */
export function homeCityOf(value: unknown): City | undefined {
  if (typeof value !== "string") return undefined;
  const city = value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  if (!city) return undefined;
  if (isCity(city) && LAUNCH_CITIES.includes(city)) return city;
  const aliased = HOME_CITY_ALIASES[city];
  if (aliased) return aliased;
  const resolved = resolveCity(city);
  return isCity(resolved) ? resolved : undefined;
}

export interface HomeInput { homeCity: City; neighborhood?: string }

/** An own-home edit cannot carry another member's identity or unrelated profile fields. */
export function parseHome(body: Record<string, unknown>): HomeInput | undefined {
  if (Object.keys(body).some(k => !["homeCity", "neighborhood"].includes(k))) return undefined;
  const homeCity = homeCityOf(body.homeCity);
  if (!homeCity) return undefined;
  if (body.neighborhood === undefined) return { homeCity };
  if (typeof body.neighborhood !== "string" || !body.neighborhood.trim() || body.neighborhood.trim().length > 80) return undefined;
  const neighborhood = body.neighborhood.trim(), coarse = homeCityOf(neighborhood);
  return coarse && coarse !== homeCity ? undefined : { homeCity, neighborhood };
}

export type JoinInput = JoinProfile & ({ age: number; birthDate?: undefined } | { birthDate: number; age?: undefined });

export const VOIP_LINE_TYPES: ReadonlySet<string> = new Set([
  "voip", "non_fixed_voip", "nonfixedvoip", "virtual", "burner", "toll_free", "tollfree",
]);

export function isVoipLineType(lineType: string | null | undefined): boolean {
  if (!lineType) return false;
  const norm = lineType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return VOIP_LINE_TYPES.has(norm) || norm.includes("voip");
}

export interface SafetyQuarantineRecord {
  readonly personId: string;
  readonly reason: string;
  readonly originApp: string;
  readonly originRef: string | null;
  readonly active: boolean;
  readonly createdAt: number;
  readonly clearedAt: number | null;
}

export type BoundarySignalKind = "post_meet_block" | "checkin_concern" | "self_promotion";

export interface BoundarySignalInput {
  readonly subjectPersonId?: string | null;
  readonly subjectPhoneHash: string;
  readonly reporterHash: string;
  readonly appId: AppId;
  readonly kind: BoundarySignalKind;
  readonly at?: number;
}

export interface StoredBoundarySignal {
  readonly subjectPersonId: string | null;
  readonly subjectPhoneHash: string;
  readonly reporterHash: string;
  readonly appId: string;
  readonly kind: BoundarySignalKind;
  readonly createdAt: number;
}

export interface MemberReliabilityInput {
  readonly personId: string;
  readonly phoneHash: string;
  readonly strikes: number;
  readonly lateCancels4h?: number;
  readonly lateCancels24h?: number;
  readonly rescheduleChurn?: number;
  readonly cleanStreak?: number;
  readonly resolved90d?: number;
  readonly completed90d?: number;
  readonly provisionalNoShow?: boolean;
  readonly at?: number;
}

export interface StoredMemberReliability {
  readonly personId: string;
  readonly phoneHash: string;
  readonly strikes: number;
  readonly lateCancels4h: number;
  readonly lateCancels24h: number;
  readonly rescheduleChurn: number;
  readonly cleanStreak: number;
  readonly resolved90d: number;
  readonly completed90d: number;
  readonly provisionalNoShow: boolean;
  readonly updatedAt: number;
}

function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "42703";
}

interface JoinProfile {
  firstName: string;
  homeCity?: City;
  neighborhood?: string;
  zip?: string;
  interests?: string[];
  about?: string;
  phoneLineType?: string;
  /** The person ticked the box next to the app's opt-in text: the client sends that text, or its version. */
  consent: { sms: true; wording?: string; version?: string };
}

export type JoinError = "under_age" | "invite_only" | "invalid_invitation" | "invalid" | "invalid_birthdate" | "review" | "consent_wording" | "account_changed";
export class JoinReviewRequired extends Error {}

export interface TeenAgeFacts { firstReadingExact: boolean; lineType: string | null; accountDays: number; apps: AppId[] }

const ISO_BIRTH_DATE = /^\d{4}-\d{2}-\d{2}$/;

const joinReading = (input: JoinInput): AgeReading =>
  input.birthDate !== undefined ? { kind: "birthDate", birthDate: input.birthDate } : { kind: "age", age: input.age };

function privateSignupBirth(birthKey: number, age: number): SignupBirth {
  if (age >= adultAge) return { birthKey };
  return { birthKey, eligibility: { initialMinorAge: age, eligibleAt: signupEligibilityAt(birthKey) } };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** Every supplied consent field must match this app's current opt-in. */
export const consentMatches = (app: Pick<AppInfo, "consent">, c: JoinInput["consent"]) => joinConsentEvidenceAllowed({
  smsAccepted: c.sms === true,
  wordingSupplied: c.wording !== undefined,
  wordingAccepted: c.wording !== undefined && squash(c.wording) === squash(app.consent.text),
  versionSupplied: c.version !== undefined,
  versionAccepted: c.version === app.consent.version,
});

/** Check and clean a join body. Returns undefined when it is not valid. */
export function parseJoin(body: unknown): JoinInput | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : undefined);
  const firstName = str(b.firstName, 50);
  if (!firstName || !joinAgeFieldsValid(b.birthdate !== undefined, b.age !== undefined)) return undefined;
  if (b.birthdate !== undefined && (typeof b.birthdate !== "string" || !ISO_BIRTH_DATE.test(b.birthdate))) return undefined;
  if (b.age !== undefined && (!validAge(b.age) || !Number.isInteger(b.age))) return undefined;
  const reading = typeof b.birthdate === "string" ? { birthDate: Number(b.birthdate.replace(/-/g, "")) } : { age: b.age as number };
  if (!b.consent || typeof b.consent !== "object" || Array.isArray(b.consent)) return undefined;
  const c = b.consent as Record<string, unknown>;
  const wording = str(c.wording, 2000), version = str(c.version, 40);
  if (!joinConsentEvidenceAllowed({
    smsAccepted: c.sms === true,
    wordingSupplied: c.wording !== undefined,
    wordingAccepted: wording !== undefined,
    versionSupplied: c.version !== undefined,
    versionAccepted: version !== undefined,
  })) return undefined;
  const out: JoinInput = { firstName, ...reading, consent: { sms: true, ...(wording ? { wording } : {}), ...(version ? { version } : {}) } };
  if (b.neighborhood !== undefined) { const v = str(b.neighborhood, 80); if (!v) return undefined; out.neighborhood = v; }
  const coarseHome = homeCityOf(out.neighborhood);
  const explicitHome = homeCityOf(b.homeCity);
  if (b.homeCity !== undefined && (!explicitHome || (coarseHome && coarseHome !== explicitHome))) return undefined;
  if (explicitHome || coarseHome) out.homeCity = explicitHome ?? coarseHome;
  if (b.zip !== undefined) { if (typeof b.zip !== "string" || !/^\d{5}$/.test(b.zip)) return undefined; out.zip = b.zip; }
  if (b.interests !== undefined) {
    if (!Array.isArray(b.interests) || b.interests.length > 20) return undefined;
    const list = b.interests.map(i => str(i, 40));
    if (list.some(i => !i)) return undefined;
    out.interests = list as string[];
  }
  if (b.about !== undefined) { const v = str(b.about, 1000); if (!v) return undefined; out.about = v; }
  if (b.phoneLineType !== undefined) { const v = str(b.phoneLineType, 32); if (!v) return undefined; out.phoneLineType = v.toLowerCase(); }
  return out;
}

/**
 * The approved profile as one text for the Network's readers: the about text, then the home area and
 * ZIP the request names, so onboarding does not ask for them again. Undefined without an about text:
 * the home area and ZIP alone stay on the member record (createMember) and never answer a question.
 */
// spec/siteEnrollment.md, "The approved profile reaches onboarding and its stated age counts"
export function joinProfileText(input: Pick<JoinInput, "about" | "neighborhood" | "zip">): string | undefined {
  if (!input.about) return undefined;
  return [input.about, input.neighborhood && `I live in ${input.neighborhood}.`, input.zip && `My zip is ${input.zip}.`].filter(Boolean).join("\n");
}

export type EnrollmentReferral = ReferralJoin | SeedInvitationReferral;

export interface JoinHookContext { app: AppInfo; person: Person; membership: Membership; e164: string; age: number; recordedAge: number | null; input: JoinInput; signupBirth?: SignupBirth; referral?: EnrollmentReferral; session?: string | null }
export interface MemberHookContext { app: AppInfo; personId: string; memberId: string; e164: string }
type MemberForgetReason = "leave" | "account_erasure" | "phone_reassignment" | "join_failed";

export interface AccountHooks {
  /** Resolve an explicit invitation for this app after the account and consent gates. */
  findInvitation?(app: AppId, token: string, at: number, verifiedPhone: string): Promise<EnrollmentReferral | undefined>;
  /** Commit the referred membership, opt-in, session attachment, Network member and invitation together. */
  commitReferredJoin?(ctx: JoinHookContext & { referral: EnrollmentReferral }): Promise<void>;
  /** Commit a browser minor's membership, Network member and private eligibility together. */
  commitBrowserSignup?(ctx: JoinHookContext & { signupBirth: SignupBirth }, consent: ConsentEvent): Promise<void>;
  commitExistingBrowserBirth?(ctx: JoinHookContext & { signupBirth: SignupBirth }, at: number): Promise<boolean>;
  /** Create the network member (the service mounts this). A throw undoes the join. */
  onJoin?(ctx: JoinHookContext): Promise<void> | void;
  memberExists?(ctx: MemberHookContext): Promise<boolean>;
  /** STOP from the web. memberId is this app's member, when there is one (a global stop runs without one). */
  onStop?(ctx: Omit<MemberHookContext, "memberId"> & { memberId?: string }): Promise<void> | void;
  /** Delete the member's network rows for this app (the generalized forget path). */
  onForget?(ctx: MemberHookContext, reason: MemberForgetReason): Promise<void> | void;
  /** Erase person-bound records that can exist without an app membership. */
  onEraseAccount?(personId: string): Promise<void> | void;
  /** The member's own network data for this app (facets, intents, opportunities, messages). */
  onExport?(ctx: MemberHookContext): Promise<unknown> | unknown;
  /** The person's lowest age went down (a stated age on any app): every app's member must follow (a minor is never matched anywhere). */
  /** Reconcile app state with the stored minimum after each age statement; must be idempotent. */
  onAgeLowered?(ctx: { personId: string; age: number }): Promise<void> | void;
  /** The ages a profile text states about the person (the Network's own reader). The join's age check counts them. */
  profileAges?(text: string): number[];
  /** True when the person currently has an active safety hold or quarantine in any app. */
  hasActiveSafetyHold?(personId: string): Promise<boolean> | boolean;
}

/** `session`: the token hash of the web session that acts (a web join binds only that session to the person). */
export interface Who { e164: string; personId: string | null; session?: string }

/** The public shape of a membership: this app only. */
export const publicMembership = (m: Membership | undefined) =>
  m && m.state !== "removed" ? { state: m.state, joinedAt: m.joinedAt === null ? null : new Date(m.joinedAt).toISOString(), firstName: m.firstName } : null;

export class Accounts {
  private readonly phoneListeners: ((ctx: { personId: string }) => Promise<unknown> | unknown)[] = [];
  private ageListener: ((phoneHash: string) => Promise<unknown> | unknown) | undefined;
  private readonly memQuarantines = new Map<string, SafetyQuarantineRecord>();
  private readonly memBoundarySignals = new Map<string, StoredBoundarySignal>();
  private readonly memReliabilityByPerson = new Map<string, StoredMemberReliability>();
  private readonly memReliabilityByPhone = new Map<string, StoredMemberReliability>();
  constructor(
    readonly store: PeopleStore,
    private readonly opts: { hashKey: string; now?: () => number; hooks?: AccountHooks; apps: (id: AppId) => AppInfo; sql?: SQL },
  ) {}
  private now() { return (this.opts.now ?? Date.now)(); }
  private get hooks() { return this.opts.hooks ?? {}; }
  private get sql(): SQL | undefined {
    return this.opts.sql ?? (this.store as unknown as { sql?: SQL }).sql;
  }
  phoneHash(e164: string) { return keyedHash(this.opts.hashKey, `phone:${e164}`); }
  /** The key of the number's one-time Eliza notice row (platform.eliza_notices). */
  noticeHash(e164: string) { return keyedHash(this.opts.hashKey, `eliza_notice:${e164}`); }

  /** Private connector receipt key. Keep the approved profile text out of OAuth storage. */
  profileSubmissionFingerprint(app: AppId, grantId: string, profile: string): string {
    return keyedHash(this.opts.hashKey, JSON.stringify(["mcp-profile-submission/v1", app, grantId, profile]));
  }

  /** The person for a verified phone, if any (never created here). A number on hold has no person until staff decide. */
  async personFor(e164: string): Promise<Person | undefined> {
    const ph = await this.store.findPhone(e164);
    if (!ph || ph.hold !== null) return undefined;
    const p = await this.store.getPerson(ph.personId);
    return p && p.deletedAt === null ? p : undefined;
  }

  /** True when the number is on hold for staff review (it may have a new owner). */
  /**
   * The live person whose phone has this keyed hash (phoneHash), with that phone, or undefined (no
   * person, deleted, or the number on hold). For holders of only the hash, such as OAuth grants.
   */
  async byPhoneHash(hash: string): Promise<{ person: Person; e164: string } | undefined> {
    const ph = await this.store.findPhoneByHash(hash);
    if (!ph || ph.hold !== null || this.phoneHash(ph.e164) !== hash) return undefined;
    const p = await this.store.getPerson(ph.personId);
    return p && p.deletedAt === null ? { person: p, e164: ph.e164 } : undefined;
  }

  async held(e164: string): Promise<boolean> {
    return (await this.store.findPhone(e164))?.hold != null;
  }

  /** True when this number, or its person, is banned (a staff decision after a report). A banned number never joins any app. */
  async banned(e164: string, person?: Person): Promise<boolean> {
    return this.store.isBanned(this.phoneHash(e164), person?.id ?? (await this.store.findPhone(e164))?.personId ?? null);
  }

  private stale(ph: PhoneIdentity, at: number) { return ph.lastSeenAt !== null && at - ph.lastSeenAt > RECYCLED_AFTER_MS; }

  /**
   * A verified login or a message from this number. A known number not seen for 12 months may have a
   * new owner: it goes on hold for staff review. Otherwise its last-seen time moves on.
   */
  async seen(e164: string): Promise<"new" | "ok" | "held"> {
    const at = this.now();
    const ph = await this.store.findPhone(e164);
    if (!ph) return "new";
    if (ph.hold !== null) return "held";
    if (this.stale(ph, at)) { await this.store.setPhoneHold(e164, "recycled_number", at); return "held"; }
    await this.store.touchPhone(e164, at);
    return "ok";
  }

  /** The numbers on hold (staff review). */
  heldPhones() { return this.store.heldPhones(); }

  /**
   * Staff decision on a held number. same_owner: the hold is lifted. new_owner: the old owner's account
   * is deleted (every membership's forget path), and the number starts clean (no suppression and no
   * age floor: those were the old owner's).
   */
  async clearHold(e164: string, decision: "same_owner" | "new_owner"): Promise<boolean> {
    const at = this.now();
    const ph = await this.store.findPhone(e164);
    if (!ph || ph.hold === null) return false;
    if (decision === "same_owner") {
      await this.store.setPhoneHold(e164, null, at);
      return true;
    }
    for (const m of await this.store.memberships(ph.personId)) {
      if (m.state !== "removed") await this.hooks.onForget?.({ app: this.opts.apps(m.app), personId: ph.personId, memberId: m.memberId, e164 }, "phone_reassignment");
    }
    await this.hooks.onEraseAccount?.(ph.personId);
    return this.store.deleteAll(ph.personId, e164, this.phoneHash(e164), at, true);
  }

  /**
   * Run `fn` after a person's number changed (the backend refreshes each network's member addresses:
   * deploy/backend/server.ts). A listener that throws never undoes the change: the listener logs its own errors.
   */
  onPhoneChanged(fn: (ctx: { personId: string }) => Promise<unknown> | unknown) { this.phoneListeners.push(fn); }

  setAgeRecordedListener(fn: (phoneHash: string) => Promise<unknown> | unknown) { this.ageListener = fn; }

  private async ageRecorded(phoneHash: string): Promise<void> {
    const fn = this.ageListener;
    if (fn) await fn(phoneHash);
  }

  private async currentPhoneForChange(who: Who, at?: number) {
    const own = await this.store.findPhone(who.e164);
    if (!own || own.hold !== null || this.stale(own, at ?? this.now())) return { ownership: "UnavailablePhone" as const };
    const person = await this.personFor(who.e164);
    if (!person || person.id !== own.personId || (who.personId !== null && who.personId !== person.id)) return { ownership: "WrongPerson" as const };
    return { ownership: "OwnedPhone" as const, person };
  }

  async recordSafetyQuarantine(personId: string, reason: string, originApp: AppId, originRef: string | null = null, at = this.now()): Promise<void> {
    const rec: SafetyQuarantineRecord = { personId, reason, originApp, originRef, active: true, createdAt: at, clearedAt: null };
    this.memQuarantines.set(personId, rec);
    const sql = this.sql;
    if (!sql) return;
    try {
      await sql`insert into platform.person_safety_quarantine (person_id, reason, origin_app, origin_ref, active, created_at, cleared_at)
        values (${personId}, ${reason}, ${originApp}, ${originRef}, true, ${at}, null)
        on conflict (person_id) do update set reason = excluded.reason, origin_app = excluded.origin_app,
          origin_ref = excluded.origin_ref, active = true, created_at = excluded.created_at, cleared_at = null`;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
  }

  async clearSafetyQuarantine(personId: string, at = this.now()): Promise<void> {
    const prev = this.memQuarantines.get(personId);
    if (prev) this.memQuarantines.set(personId, { ...prev, active: false, clearedAt: at });
    const sql = this.sql;
    if (!sql) return;
    try {
      await sql`update platform.person_safety_quarantine set active = false, cleared_at = ${at} where person_id = ${personId} and active = true`;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
  }

  async activeSafetyQuarantine(personId: string): Promise<SafetyQuarantineRecord | undefined> {
    const sql = this.sql;
    if (sql) {
      try {
        const [r] = await sql<{ person_id: string; reason: string; origin_app: string; origin_ref: string | null; active: boolean; created_at: string | number; cleared_at: string | number | null }[]>`
          select person_id, reason, origin_app, origin_ref, active, created_at, cleared_at
          from platform.person_safety_quarantine
          where person_id = ${personId} and active = true`;
        if (r) {
          return {
            personId: r.person_id, reason: r.reason, originApp: r.origin_app, originRef: r.origin_ref,
            active: r.active, createdAt: Number(r.created_at), clearedAt: r.cleared_at === null ? null : Number(r.cleared_at),
          };
        }
        return undefined;
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
      }
    }
    const mem = this.memQuarantines.get(personId);
    return mem?.active ? mem : undefined;
  }

  async hasActiveSafetyHoldOrQuarantine(personId: string): Promise<boolean> {
    if (await this.hooks.hasActiveSafetyHold?.(personId)) return true;
    if (await this.activeSafetyQuarantine(personId)) return true;
    const sql = this.sql;
    if (!sql) return false;
    try {
      const [staffHold] = await sql<{ hit: number }[]>`
        select 1 as hit from platform.staff_safety_holds
        where person_id = ${personId}::uuid
        limit 1`;
      if (staffHold) return true;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
    try {
      const [reportHold] = await sql<{ hit: number }[]>`
        select 1 as hit from platform.report_safety_carryovers
        where person_id = ${personId}::uuid
        limit 1`;
      if (reportHold) return true;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
    return false;
  }

  async recordBoundarySignal(input: BoundarySignalInput): Promise<void> {
    const at = input.at ?? this.now();
    const key = `${input.subjectPhoneHash}|${input.reporterHash}|${input.appId}|${input.kind}`;
    this.memBoundarySignals.set(key, {
      subjectPersonId: input.subjectPersonId ?? null,
      subjectPhoneHash: input.subjectPhoneHash,
      reporterHash: input.reporterHash,
      appId: input.appId,
      kind: input.kind,
      createdAt: at,
    });
    const sql = this.sql;
    if (!sql) return;
    try {
      await sql`insert into platform.person_boundary_signals (subject_person_id, subject_phone_hash, reporter_hash, app_id, kind, created_at)
        values (${input.subjectPersonId ?? null}, ${input.subjectPhoneHash}, ${input.reporterHash}, ${input.appId}, ${input.kind}, ${at})
        on conflict (subject_phone_hash, reporter_hash, app_id, kind) do update
          set subject_person_id = coalesce(excluded.subject_person_id, platform.person_boundary_signals.subject_person_id),
              created_at = greatest(platform.person_boundary_signals.created_at, excluded.created_at)`;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
  }

  async boundarySignalsForPhone(subjectPhoneHash: string, sinceMs = 0): Promise<StoredBoundarySignal[]> {
    const sql = this.sql;
    if (sql) {
      try {
        const rows = await sql<{ subject_person_id: string | null; subject_phone_hash: string; reporter_hash: string; app_id: string; kind: BoundarySignalKind; created_at: string | number }[]>`
          select subject_person_id, subject_phone_hash, reporter_hash, app_id, kind, created_at
          from platform.person_boundary_signals
          where subject_phone_hash = ${subjectPhoneHash} and created_at >= ${sinceMs}
          order by created_at desc`;
        return rows.map(r => ({
          subjectPersonId: r.subject_person_id, subjectPhoneHash: r.subject_phone_hash,
          reporterHash: r.reporter_hash, appId: r.app_id, kind: r.kind, createdAt: Number(r.created_at),
        }));
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
      }
    }
    return [...this.memBoundarySignals.values()]
      .filter(s => s.subjectPhoneHash === subjectPhoneHash && s.createdAt >= sinceMs)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async upsertMemberReliability(input: MemberReliabilityInput): Promise<void> {
    const at = input.at ?? this.now();
    const rec: StoredMemberReliability = {
      personId: input.personId,
      phoneHash: input.phoneHash,
      strikes: Math.max(0, Math.round(input.strikes)),
      lateCancels4h: Math.max(0, Math.round(input.lateCancels4h ?? 0)),
      lateCancels24h: Math.max(0, Math.round(input.lateCancels24h ?? 0)),
      rescheduleChurn: Math.max(0, Math.round(input.rescheduleChurn ?? 0)),
      cleanStreak: Math.max(0, Math.round(input.cleanStreak ?? 0)),
      resolved90d: Math.max(0, Math.round(input.resolved90d ?? 0)),
      completed90d: Math.max(0, Math.round(input.completed90d ?? 0)),
      provisionalNoShow: input.provisionalNoShow === true,
      updatedAt: at,
    };
    this.memReliabilityByPerson.set(rec.personId, rec);
    this.memReliabilityByPhone.set(rec.phoneHash, rec);
    const sql = this.sql;
    if (!sql) return;
    try {
      await sql`insert into platform.member_reliability
          (person_id, phone_hash, strikes, late_cancels_4h, late_cancels_24h, reschedule_churn, clean_streak, resolved_90d, completed_90d, provisional_no_show, updated_at)
        values (${rec.personId}, ${rec.phoneHash}, ${rec.strikes}, ${rec.lateCancels4h}, ${rec.lateCancels24h}, ${rec.rescheduleChurn}, ${rec.cleanStreak}, ${rec.resolved90d}, ${rec.completed90d}, ${rec.provisionalNoShow}, ${rec.updatedAt})
        on conflict (person_id) do update set
          phone_hash = excluded.phone_hash,
          strikes = excluded.strikes,
          late_cancels_4h = excluded.late_cancels_4h,
          late_cancels_24h = excluded.late_cancels_24h,
          reschedule_churn = excluded.reschedule_churn,
          clean_streak = excluded.clean_streak,
          resolved_90d = excluded.resolved_90d,
          completed_90d = excluded.completed_90d,
          provisional_no_show = excluded.provisional_no_show,
          updated_at = excluded.updated_at`;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
  }

  async getMemberReliability(personId: string, phoneHash?: string): Promise<StoredMemberReliability | undefined> {
    const sql = this.sql;
    if (sql) {
      try {
        const rows = phoneHash
          ? await sql<Record<string, any>[]>`
              select * from platform.member_reliability
              where person_id = ${personId} or phone_hash = ${phoneHash}
              order by case when person_id = ${personId} then 0 else 1 end, updated_at desc limit 1`
          : await sql<Record<string, any>[]>`
              select * from platform.member_reliability where person_id = ${personId} limit 1`;
        const r = rows[0];
        if (!r) return undefined;
        return {
          personId: String(r.person_id), phoneHash: String(r.phone_hash),
          strikes: Number(r.strikes), lateCancels4h: Number(r.late_cancels_4h),
          lateCancels24h: Number(r.late_cancels_24h), rescheduleChurn: Number(r.reschedule_churn),
          cleanStreak: Number(r.clean_streak), resolved90d: Number(r.resolved_90d),
          completed90d: Number(r.completed_90d), provisionalNoShow: Boolean(r.provisional_no_show),
          updatedAt: Number(r.updated_at),
        };
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
      }
    }
    return this.memReliabilityByPerson.get(personId) ?? (phoneHash ? this.memReliabilityByPhone.get(phoneHash) : undefined);
  }

  private async relinkPhoneSignalsOnRejoin(personId: string, phoneHash: string): Promise<void> {
    const memRel = this.memReliabilityByPhone.get(phoneHash);
    if (memRel && memRel.personId !== personId) {
      const moved = { ...memRel, personId };
      this.memReliabilityByPerson.set(personId, moved);
      this.memReliabilityByPhone.set(phoneHash, moved);
    }
    for (const [k, s] of this.memBoundarySignals) {
      if (s.subjectPhoneHash === phoneHash && s.subjectPersonId !== personId) {
        this.memBoundarySignals.set(k, { ...s, subjectPersonId: personId });
      }
    }
    const sql = this.sql;
    if (!sql) return;
    try {
      await sql`update platform.person_boundary_signals set subject_person_id = ${personId}
        where subject_phone_hash = ${phoneHash} and subject_person_id is distinct from ${personId}`;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
    try {
      const [existing] = await sql<Record<string, any>[]>`select * from platform.member_reliability
        where phone_hash = ${phoneHash} and person_id <> ${personId} order by updated_at desc limit 1`;
      if (existing) {
        await sql`insert into platform.member_reliability
            (person_id, phone_hash, strikes, late_cancels_4h, late_cancels_24h, reschedule_churn, clean_streak, resolved_90d, completed_90d, provisional_no_show, updated_at)
          values (${personId}, ${phoneHash}, ${Number(existing.strikes)}, ${Number(existing.late_cancels_4h)}, ${Number(existing.late_cancels_24h)},
            ${Number(existing.reschedule_churn)}, ${Number(existing.clean_streak)}, ${Number(existing.resolved_90d)}, ${Number(existing.completed_90d)},
            ${Boolean(existing.provisional_no_show)}, ${Number(existing.updated_at)})
          on conflict (person_id) do update set
            strikes = greatest(platform.member_reliability.strikes, excluded.strikes),
            late_cancels_4h = greatest(platform.member_reliability.late_cancels_4h, excluded.late_cancels_4h),
            late_cancels_24h = greatest(platform.member_reliability.late_cancels_24h, excluded.late_cancels_24h),
            reschedule_churn = greatest(platform.member_reliability.reschedule_churn, excluded.reschedule_churn),
            provisional_no_show = platform.member_reliability.provisional_no_show or excluded.provisional_no_show,
            updated_at = greatest(platform.member_reliability.updated_at, excluded.updated_at)`;
      }
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
    }
  }

  async startNumberChange(app: AppInfo, who: Who, newE164: string, freshSignIn: boolean, sendCode: () => Promise<boolean>): Promise<{ ok: true } | { ok: false; error: NumberChangeError }> {
    const at = this.now();
    const request = stepPhoneChange(phoneChangeInitial, { type: "requestChallenge", freshSignIn, sameNumber: newE164 === who.e164 });
    if (request.phase !== "CheckingStartOwner") return numberChangeRefused(request.failure);
    const { ownership, person } = await this.currentPhoneForChange(who, at);
    const current = stepPhoneChange(request, { type: "checkCurrentPhone", ownership });
    if (current.phase !== "CheckingStartPolicy" || !person) return numberChangeRefused(current.failure);
    const blocked = (await this.banned(who.e164, person)) || (await this.hasActiveSafetyHoldOrQuarantine(person.id));
    const policy = stepPhoneChange(current, { type: "checkStartPolicy", oldNumberAllowed: !blocked });
    if (policy.phase !== "AwaitingRateLimit") return numberChangeRefused(policy.failure);
    const slot = await this.store.hit(`phone-change:${this.phoneHash(`person:${person.id}`)}`, phoneChangeWindowMs, at, { limit: NUMBER_CHANGES_PER_DAY });
    const rated = stepPhoneChange(policy, { type: "checkStartRate", slotGranted: slot.ok, startsBefore: slot.count - 1 });
    if (rated.phase !== "AwaitingCodeSend") return numberChangeRefused(rated.failure);
    const sent = stepPhoneChange(rated, { type: "recordCodeSend", sendAccepted: await sendCode() });
    if (sent.phase !== "AwaitingPendingWrite") return numberChangeRefused(sent.failure);
    await this.store.putPhoneChange({ id: randomUUID(), personId: person.id, app: app.id, newE164, requestedBy: "member", requestedAt: at, confirmedAt: null });
    const pending = stepPhoneChange(sent, { type: "recordPendingWrite" });
    return pending.phase === "PendingRecorded" ? { ok: true } : numberChangeRefused(pending.failure);
  }

  /**
   * Step 2: the code from the new number. `verify` checks it on the OTP service (it answers true once).
   * Then, with the new number proved: a banned new number reads as review, a number that belongs to
   * anyone (a member, a held number) is "number_in_use", and otherwise the person moves (store.movePhone).
   * A delete of everything by an earlier owner of the new number no longer suppresses it, and the lowest
   * age either number ever stated becomes the person's (every app follows a lower age).
   */
  async confirmNumberChange(who: Who, verify: (app: AppId, e164: string) => Promise<boolean>): Promise<{ ok: true; e164: string; personId: string } | { ok: false; error: NumberChangeError }> {
    const request = stepPhoneChange(phoneChangeInitial, { type: "beginConfirmation" });
    const { ownership, person } = await this.currentPhoneForChange(who);
    const current = stepPhoneChange(request, { type: "checkCurrentPhone", ownership });
    if (current.phase !== "AwaitingPendingRead" || !person) return numberChangeRefused(current.failure);
    const change = await this.store.pendingPhoneChange(person.id);
    const pending = stepPhoneChange(current, {
      type: "readPending", hasTarget: !!change?.newE164, elapsedMs: change?.newE164 ? this.now() - change.requestedAt : 0,
    });
    if (pending.phase !== "AwaitingVerification" || !change?.newE164) return numberChangeRefused(pending.failure);
    const newE164 = change.newE164;
    const verified = stepPhoneChange(pending, { type: "recordVerification", otpVerified: await verify(change.app, newE164) });
    if (verified.phase !== "AwaitingMovePolicy") return numberChangeRefused(verified.failure);
    // One lock, on the new number (a join of that number waits): withLock never nests.
    const r = await this.store.withLock(`join:${newE164}`, async (): Promise<{ ok: true } | { ok: false; error: NumberChangeError }> => {
      const blocked = await this.banned(who.e164, person)
        || await this.store.isBanned(this.phoneHash(newE164))
        || await this.hasActiveSafetyHoldOrQuarantine(person.id);
      const policy = blocked ? "MoveBlocked" : await this.store.findPhone(newE164) ? "NumberTaken" : "MoveAllowed";
      const allowed = stepPhoneChange(verified, { type: "checkMovePolicy", policy });
      if (allowed.phase !== "AwaitingMove") return numberChangeRefused(allowed.failure);
      const moved = await this.store.movePhone({ personId: person.id, changeId: change.id, oldE164: who.e164, newE164, oldHash: this.phoneHash(who.e164), newHash: this.phoneHash(newE164),
        oldNoticeHash: this.noticeHash(who.e164), newNoticeHash: this.noticeHash(newE164), now: () => this.now() });
      const moveResult = {
        ok: "MoveApplied", number_in_use: "MoveNumberTaken", no_phone: "MoveMissingPhone", banned: "MoveBanned",
        stale_request: "MoveRequestStale",
      } as const;
      const result = stepPhoneChange(allowed, { type: "recordMove", moveResult: moveResult[moved] });
      if (result.phase !== "Moved") return numberChangeRefused(result.failure);
      return { ok: true };
    });
    if (!r.ok) return r;
    if (await this.store.ageFloorRecord(this.phoneHash(newE164))) {
      const age = await this.lowestAge(newE164, await this.store.getPerson(person.id));
      if (age !== undefined) await this.hooks.onAgeLowered?.({ personId: person.id, age });
    }
    await this.ageRecorded(this.phoneHash(newE164));
    for (const fn of this.phoneListeners) await Promise.resolve().then(() => fn({ personId: person.id })).catch(() => {});
    return { ok: true, e164: newE164, personId: person.id };
  }

  /** The age a join states: the typed age, or a lower one that the profile text states about the person. */
  private statedJoinAge(input: JoinInput, at: number): number {
    const text = joinProfileText(input);
    const ages = text ? (this.hooks.profileAges?.(text) ?? []).filter(validAge) : [];
    // spec/siteEnrollment.md, "The approved profile reaches onboarding and its stated age counts"
    return ages.reduce((age, stated) => profileJoinAge(age, stated, true), readingAge(joinReading(input), at));
  }


  /** The lowest usable age known for this phone and its verified person. */
  async lowestAge(e164: string, person?: Person): Promise<number | undefined> {
    return (await this.knownAges(e164, person)).effective;
  }

  async ageRecord(e164: string, person: Person | undefined): Promise<AgeRecord> {
    const hash = this.phoneHash(e164);
    const standing = await this.store.ageStanding(person?.id ?? null, hash);
    return ageRecordOf(standing, this.now(), await this.store.teenBarred(hash));
  }

  async knownAges(e164: string, person?: Person) {
    const standing = await this.store.ageStanding(person?.id ?? null, this.phoneHash(e164));
    const now = this.now();
    return { effective: effectiveAgeAt(standing, now), independent: lowestAge(standing.person?.lowestAge, standing.floor?.age) };
  }

  /** Record a stated age: the phone's age floor and the person (if any) keep the lowest. Every app's member follows a lower age. */
  async recordAge(e164: string, person: Person | undefined, age: number): Promise<void> {
    if (!validAge(age)) return;
    await this.recordReading(e164, person, { kind: "age", age });
  }

  async recordBirthDate(e164: string, person: Person | undefined, birthKey: number): Promise<void> {
    await this.recordReading(e164, person, { kind: "birthDate", birthDate: birthKey });
  }

  private async recordReading(e164: string, person: Person | undefined, reading: AgeReading): Promise<void> {
    const phoneHash = this.phoneHash(e164);
    const after = await this.store.recordAgeReading(person?.id ?? null, phoneHash, reading, this.now());
    if (person && after !== undefined) await this.hooks.onAgeLowered?.({ personId: person.id, age: after });
    await this.ageRecorded(phoneHash);
  }

  async barTeenPool(e164: string, reason: TeenBarReason, at: number): Promise<void> {
    await this.store.barTeenPool(this.phoneHash(e164), reason, at);
  }

  async teenAgeFacts(personId: string): Promise<TeenAgeFacts> {
    const row = await this.store.teenAgeFacts(personId);
    return {
      firstReadingExact: row?.firstExact === true,
      lineType: row?.lineType ?? null,
      accountDays: row ? Math.max(0, Math.floor((this.now() - row.createdAt) / DAY)) : 0,
      apps: row?.apps ?? [],
    };
  }

  /** Project a durable chat observation. The write's owner survives a change of phone number. */
  async projectRecordedAge(recorded: RecordedMemberAge): Promise<void> {
    const person = recorded.personId ? await this.store.getPerson(recorded.personId) : undefined;
    if (person?.deletedAt === null && validAge(person.lowestAge)) {
      await this.hooks.onAgeLowered?.({ personId: person.id, age: person.lowestAge });
    }
    await this.ageRecorded(recorded.phoneHash);
  }

  /**
   * A new person for a verified phone (or the tombstone of this phone's earlier person, revived). Web
   * sessions of the number with no person end, except `joiningSession` (the web join's own): one of them may
   * belong to an earlier holder of the number, and it must never act for this person. The store binds
   * them in the same transaction as the person.
   */
  createPerson(e164: string, method: PhoneMethod, lowestAge: number | null, joiningSession: string | null = null) {
    return this.store.createPerson({ id: randomUUID(), e164, method, at: this.now(), lowestAge, phoneHash: this.phoneHash(e164), joiningSession });
  }

  /**
   * Whether this number may join the app now. The age is not checked here: it is checked at the join,
   * so this answer never shows an age that the person gave another app.
   */
  async canJoin(app: AppInfo, who: Who): Promise<{ canJoin: boolean; reason?: "member" | "invite_only" | "review"; membership?: Membership; person?: Person }> {
    if (await this.held(who.e164)) return { canJoin: false, reason: "review" };
    const person = await this.personFor(who.e164);
    // A ban reads like a review: the answer never says why (the copy is the founder's call).
    if (await this.banned(who.e164, person)) return { canJoin: false, reason: "review", person };
    const membership = person && (await this.store.getMembership(person.id, app.id));
    if (membership && membership.state !== "removed" && membership.state !== "invited") return { canJoin: false, reason: "member", membership, person };
    if (app.joinMode === "invite" && membership?.state !== "invited") return { canJoin: false, reason: "invite_only", membership, person };
    return { canJoin: true, membership, person };
  }

  /** Revalidate the exact canonical phone, person, app membership and current consent. */
  async activeMembership(app: AppInfo, who: Who): Promise<{person: Person; membership: Membership} | undefined> {
    const phone = await this.store.findPhone(who.e164);
    if (!phone || phone.hold !== null || this.stale(phone, this.now())) return;
    const person = await this.personFor(who.e164);
    if (!person || person.id !== phone.personId || (who.personId !== null && who.personId !== person.id)) return;
    if (await this.banned(who.e164, person) || !canJoinApp(await this.lowestAge(who.e164, person), app)) return;
    const membership = await this.store.getMembership(person.id, app.id);
    if (!membership || membership.app !== app.id || membership.personId !== person.id || membership.state !== "active" || membership.review !== null) return;
    if (await this.store.isSuppressed(this.phoneHash(who.e164)) || !await this.optedIn(app.id, who.e164)) return;
    return {person, membership};
  }

  /**
   * Staff or a member invite: a person (method 'staff' when new) and an 'invited' membership.
   * Undefined for a number that asked to delete everything (the suppression hash) or is on hold.
   */
  async invite(app: AppInfo, e164: string): Promise<Membership | undefined> {
    if ((await this.held(e164)) || (await this.store.isSuppressed(this.phoneHash(e164))) || (await this.banned(e164))) return undefined;
    const person = (await this.personFor(e164)) ?? (await this.createPerson(e164, "staff", null));
    const existing = await this.store.getMembership(person.id, app.id);
    if (existing && existing.state !== "removed") return existing;
    const m: Membership = { app: app.id, personId: person.id, memberId: `${app.id}_${randomUUID()}`, state: "invited", review: null, firstName: null, profile: {}, joinedAt: null, leftAt: null };
    await this.store.putMembership(m);
    return m;
  }

  async join(app: AppInfo, who: Who, input: JoinInput, enrollment: Enrollment = typedJoinEntry, inviteToken?: string, signupView?: string): Promise<{ ok: true; membership: Membership; created: boolean } | { ok: false; error: JoinError }> {
    if (enrollment.phase !== "AwaitingConsent") return { ok: false, error: "invalid" };
    if (input.birthDate !== undefined && !joinBirthDateUsable(input.birthDate, this.now())) return { ok: false, error: "invalid_birthdate" };
    const consent = stepEnrollment(enrollment, { type: "confirmConsent", consentMatches: consentMatches(app, input.consent) });
    if (consent.phase !== "AwaitingEligibility") return { ok: false, error: "consent_wording" };
    // One join per phone at a time: parallel requests see the first one's person and membership.
    return this.store.withLock(`join:${who.e164}`, () => this.joinLocked(app, who, input, consent, inviteToken, signupView));
  }

  private async joinLocked(app: AppInfo, who: Who, input: JoinInput, consent: Enrollment, inviteToken?: string, signupView?: string): Promise<{ ok: true; membership: Membership; created: boolean } | { ok: false; error: JoinError }> {
    const at = this.now();
    const held = (await this.seen(who.e164)) === "held";
    let person = held ? undefined : await this.personFor(who.e164);
    const eligibility = stepEnrollment(consent, { type: "checkEligibility", eligible: !held && !await this.banned(who.e164, person) });
    if (eligibility.phase !== "AwaitingMembership") return { ok: false, error: "review" };
    const markerMatches = signupView !== undefined && signupView === signupAccountView(app.id, this.phoneHash(who.e164), person?.id ?? null);
    if (!signupAccountViewMatches(signupView !== undefined, markerMatches)) return { ok: false, error: "account_changed" };
    const existing = person && (await this.store.getMembership(person.id, app.id));
    const existingMember = !!existing && existing.state !== "removed" && existing.state !== "invited";
    const attemptedReferral = !existingMember && inviteToken !== undefined;
    const referral = attemptedReferral && app.joinMode !== "waitlist" && this.hooks.commitReferredJoin
      ? await this.hooks.findInvitation?.(app.id, inviteToken, at, who.e164) : undefined;
    const membershipCheck = stepEnrollment(eligibility, {
      type: "checkMembership",
      membershipFacts: {
        existingMember,
        inviteRequired: app.joinMode === "invite",
        hasInvite: existing?.state === "invited",
        referral: referral ? "VerifiedReferral" : attemptedReferral ? "InvalidReferral" : "NoReferral",
      },
    });
    if (membershipCheck.phase === "NeedsInvite") return { ok: false, error: "invite_only" };
    const statedAge = this.statedJoinAge(input, at);
    const enteredAge = readingAge(joinReading(input), at);
    const signupBirth = input.birthDate !== undefined && verifiedBrowserBirthMayBeKept(true, enteredAge)
      ? privateSignupBirth(input.birthDate, enteredAge) : undefined;
    const profile = signupBirth ? joinProfileText(input) : undefined;
    const recordedAge = signupBirth ? lowestAge(...(profile ? this.hooks.profileAges?.(profile) ?? [] : [])) : statedAge;
    if (recordedAge !== undefined) await this.recordAge(who.e164, person, recordedAge);
    const known = await this.knownAges(who.e164, person);
    const age = joinAgeCheck(statedAge, known.effective, app);
    const memberMissing = membershipCheck.rejoin && age.ok && !!person && existing?.state === "active" && !!this.hooks.memberExists
      && !await this.hooks.memberExists({ app, personId: person.id, memberId: existing.memberId, e164: who.e164 });
    const ageCheck = stepEnrollment(membershipCheck, { type: "checkJoinAge", ageEligible: age.ok, memberMissing });
    if (ageCheck.phase === "BelowJoinAge") {
      // Nothing is stored for this app: only the age, on the phone's age floor (and the person, if any).
      if (age.effective !== undefined && declineEndsUnboundAccess(age.effective)) {
        await this.store.endUnboundAccess(who.e164, this.phoneHash(who.e164), at);
        await this.declineUnderAge(who.e164, person);
      }
      if (!person) await this.store.forgetPersonlessSessions(who.e164);
      return { ok: false, error: "under_age" };
    }
    if (ageCheck.phase === "ReturnExisting" && existing) {
      if (who.session && who.personId === null && person) await this.store.attachPerson(who.e164, person.id, who.session, at);
      if (signupBirth && person && existing.review === null && browserSignupMemberAllowed(existing.state)) {
        const ctx = { app, person, membership: existing, e164: who.e164, age: age.effective ?? statedAge,
          recordedAge: lowestAge(recordedAge, known.independent) ?? null, input, signupBirth };
        const saved = this.hooks.commitExistingBrowserBirth
          ? await this.hooks.commitExistingBrowserBirth(ctx, at)
          : await this.store.saveSignupBirth(existing, who.e164, this.phoneHash(who.e164), signupBirth, at);
        if (!saved) return { ok: false, error: "review" };
      }
      return { ok: true, membership: existing, created: false };
    }
    if (ageCheck.phase === "AwaitingRepair" && existing && person) {
      const ctx = { app, person, membership: existing, e164: who.e164, age: age.effective ?? statedAge,
        recordedAge: lowestAge(recordedAge, known.independent) ?? null, input, ...(who.session ? { session: who.session } : {}) };
      const repair = await this.runJoinHook(() => this.hooks.onJoin?.(ctx));
      const repaired = stepEnrollment(ageCheck, { type: "finishRepair", hookSucceeded: repair.ok });
      if (repaired.phase === "ReturnExisting") return { ok: true, membership: existing, created: false };
      if (repaired.phase !== "JoinHookFailed" || repair.ok) return { ok: false, error: "invalid" };
      return this.undoFailedJoin(app, who.e164, person.id, existing.memberId, at, repair.error, false);
    }
    if (ageCheck.phase === "InvalidInvitation") return { ok: false, error: "invalid_invitation" };
    if (ageCheck.phase !== "AwaitingPersistence") return { ok: false, error: "invalid" };
    if (!person) {
      person = await this.createPerson(who.e164, "otp_sms", signupBirth ? recordedAge ?? null : lowestAge(recordedAge, known.independent) ?? null, who.session ?? null);
      if (recordedAge !== undefined) await this.recordAge(who.e164, person, recordedAge);
    }
    const membership: Membership = {
      // An invited membership keeps its member id (the invite may already name it).
      app: app.id, personId: person.id, memberId: membershipCheck.invited && existing ? existing.memberId : `${app.id}_${randomUUID()}`,
      state: app.joinMode === "waitlist" ? "onboarding" : "active", review: null,
      firstName: input.firstName,
      profile: Object.fromEntries(Object.entries({ homeCity: input.homeCity, neighborhood: input.neighborhood, zip: input.zip, interests: input.interests, about: input.about, phoneLineType: input.phoneLineType }).filter(([, v]) => v !== undefined)),
      joinedAt: at, leftAt: null,
    };
    const referredJoin = ageCheck.referred && referral;
    const commitBrowserSignup = signupBirth && this.hooks.commitBrowserSignup;
    const phoneHash = this.phoneHash(who.e164);
    await this.relinkPhoneSignalsOnRejoin(person.id, phoneHash);
    const suppressed = !referredJoin && !commitBrowserSignup && await this.store.isSuppressed(phoneHash);
    const optIn: ConsentEvent = { e164: who.e164, app: app.id, state: "opted_in", source: "web_form", wording: app.consent.text, wordingVersion: app.consent.version, at };
    if (!referredJoin && !commitBrowserSignup) {
      if (!await this.store.admitMembership(membership, optIn, phoneHash, who.session ?? null)) return { ok: false, error: "review" };
    }
    const ctx = { app, person, membership, e164: who.e164, age: age.effective ?? statedAge,
      recordedAge: lowestAge(recordedAge, known.independent) ?? null, input, signupBirth, ...(who.session ? { session: who.session } : {}) };
    const hook = await this.runJoinHook(async () => {
      if (referredJoin) return this.hooks.commitReferredJoin!({ ...ctx, referral: referredJoin });
      if (signupBirth && commitBrowserSignup) return commitBrowserSignup({ ...ctx, signupBirth }, optIn);
      await this.hooks.onJoin?.(ctx);
      if (signupBirth && !await this.store.saveSignupBirth(membership, who.e164, phoneHash, signupBirth, at)) throw new JoinReviewRequired();
    });
    const result = stepEnrollment(ageCheck, { type: "finishJoin", hookSucceeded: hook.ok });
    if (result.phase === "JoinHookFailed" && !hook.ok) return this.undoFailedJoin(app, who.e164, person.id, membership.memberId, at, hook.error, !!referredJoin || !!commitBrowserSignup, suppressed);
    if (result.phase !== "Created") return { ok: false, error: "invalid" };
    return { ok: true, membership, created: true };
  }

  private async runJoinHook(run: () => Promise<void> | void | undefined): Promise<{ ok: true } | { ok: false; error: unknown }> {
    try {
      await run();
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** `suppressed`: the number was suppressed before admitMembership lifted it; a failed join puts it back. */
  private async undoFailedJoin(app: AppInfo, e164: string, personId: string, memberId: string, at: number, error: unknown, referred: boolean, suppressed = false): Promise<{ ok: false; error: JoinError }> {
    if (joinFailureForgetsMembership(referred)) {
      try {
        await this.hooks.onForget?.({ app, personId, memberId, e164 }, "join_failed");
      } finally {
        await this.store.forgetMembership(personId, app.id, at, memberId);
        await this.store.addConsent({ e164, app: app.id, state: "opted_out", source: "join_failed", at });
        if (suppressed) await this.store.suppress(this.phoneHash(e164), "deleted", at);
      }
    }
    if (error instanceof JoinReviewRequired) return { ok: false, error: "review" };
    if (referred && error instanceof InvitationUnavailable) return { ok: false, error: "invalid_invitation" };
    throw error;
  }

  async stop(app: AppInfo, who: Who, source = "web_form"): Promise<void> {
    // The person is read first: a number change that commits before the write below does not lose the STOP.
    const person = await this.personFor(who.e164);
    await this.store.addConsent({ e164: who.e164, app: null, state: "opted_out", source, at: this.now() }, person?.id);
    // The ledger above is what the send path reads. The hooks pause the person's members: every app's,
    // even when the person has no membership on the app they stopped from.
    const m = person && (await this.store.getMembership(person.id, app.id));
    const live = m && m.state !== "removed" ? m : undefined;
    if (person) await this.hooks.onStop?.({ app, personId: person.id, memberId: live?.memberId, e164: who.e164 });
  }

  /**
   * Under 13 cannot use any app (core canJoin): when the phone's lowest age is under 13, a text join the
   * phone started (its pending row) is deleted, and every non-removed membership of the person goes
   * through the forget path with an opt-out in the ledger.
   */
  async declineUnderAge(e164: string, person: Person | undefined): Promise<void> {
    const lowest = await this.lowestAge(e164, person);
    if (lowest === undefined || canJoin(lowest)) return;
    await this.store.deletePending(this.phoneHash(e164), "join");
    if (!person) return;
    const at = this.now();
    for (const m of await this.store.memberships(person.id)) {
      if (m.state === "removed") continue;
      await this.hooks.onForget?.({ app: this.opts.apps(m.app), personId: person.id, memberId: m.memberId, e164 }, "account_erasure");
      await this.store.forgetMembership(person.id, m.app, at, m.memberId);
      await this.store.addConsent({ e164, app: m.app, state: "opted_out", source: "join_declined", at });
    }
  }

  /** Record any consent event (keywords on a line, staff). `personId`: see PeopleStore.addConsent. */
  async recordConsent(e: ConsentEvent, personId?: string) { await this.store.addConsent(e, personId); }

  /**
   * True if the number may get messages from this app now. A number that deleted everything has no
   * events left, so it needs a new opt-in (the suppression hash keeps that true across re-imports).
   */
  async optedIn(app: AppId, e164: string): Promise<boolean> {
    return resolveConsent(await this.store.lastConsent(e164, app)) === "opted_in";
  }

  /** Leave one app: the forget path. The phone and other memberships stay. */
  async leave(app: AppInfo, who: Who, evidence?: Partial<Pick<AppLeaveInput, "at" | "expectedMemberId" | "line" | "ref">>): Promise<boolean> {
    const at = evidence?.at ?? this.now();
    const request = stepPrivacy(accountPrivacyInitial, { type: "beginPrivacyRequest", operation: "LeaveApp" });
    const admission = await this.store.beginAppLeave({ app: app.id, ...who, ...evidence, at });
    const m = admission.ok ? admission.membership : undefined;
    const optedOut = stepPrivacy(request, {
      type: "recordLeaveConsent", recorded: admission.ok, membershipBound: hasScopedMembership(!!who.personId, !!m, m?.state === "removed"),
    });
    if (optedOut.phase === "AwaitingAppForget" && who.personId && m) {
      await this.hooks.onForget?.({ app, personId: who.personId, memberId: m.memberId, e164: who.e164 }, "leave");
      await this.store.forgetMembership(who.personId, app.id, at, m.memberId);
      return stepPrivacy(optedOut, { type: "recordAppForget" }).phase === "CompletePrivacyRequest";
    }
    return optedOut.phase === "CompletePrivacyRequest";
  }

  /** Delete everything: every membership (forget path each), the phone, grants, own blocks, sessions; keep a tombstone and the suppression hash. */
  async deleteAll(who: Who): Promise<boolean> {
    const at = this.now();
    const request = stepPrivacy(accountPrivacyInitial, { type: "beginPrivacyRequest", operation: "DeleteAccount" });
    const phone = await this.store.findPhone(who.e164);
    const current = verifiedPrivacyOwnerMatches(who.personId ?? "", phone?.personId ?? "", phone?.hold != null);
    const ownerChecked = stepPrivacy(request, { type: "checkErasureOwner", authorityCurrent: current });
    if (ownerChecked.phase !== "AwaitingAccountCleanup") return false;
    if (who.personId) {
      if (await this.hasActiveSafetyHoldOrQuarantine(who.personId) && !(await this.activeSafetyQuarantine(who.personId))) {
        await this.recordSafetyQuarantine(who.personId, "erasure_hold_carryover", "ntwrk", null, at);
      }
      for (const m of await this.store.memberships(who.personId)) {
        if (hasScopedMembership(true, true, m.state === "removed"))
          await this.hooks.onForget?.({ app: this.opts.apps(m.app), personId: who.personId, memberId: m.memberId, e164: who.e164 }, "account_erasure");
      }
      await this.hooks.onEraseAccount?.(who.personId);
    }
    const cleaned = stepPrivacy(ownerChecked, { type: "recordAccountCleanup" });
    if (cleaned.phase !== "AwaitingAccountErasure") return false;
    const committed = await this.store.deleteAll(who.personId, who.e164, this.phoneHash(who.e164), at);
    return stepPrivacy(cleaned, { type: "recordAccountErasure", committed }).phase === "CompletePrivacyRequest";
  }

  /** This app's own data. Nothing from another app, not even its name. */
  async exportApp(app: AppInfo, who: Who): Promise<Record<string, unknown>> {
    const exportHeader = { app: app.id, exportedAt: new Date(this.now()).toISOString(), phone: who.e164 };
    const ownsPhone = async () => {
      const phone = await this.store.findPhone(who.e164);
      return verifiedPrivacyOwnerMatches(who.personId ?? "", phone?.personId ?? "", phone?.hold != null);
    };
    const empty = { ...exportHeader, membership: null, consent: [], network: null };
    if (!(await ownsPhone())) return empty;

    const request = stepPrivacy(accountPrivacyInitial, { type: "beginPrivacyRequest", operation: "ExportApp" });
    const m = who.personId ? await this.store.getMembership(who.personId, app.id) : undefined;
    const checked = stepPrivacy(request, {
      type: "checkAppExport", membershipBound: hasScopedMembership(!!who.personId, !!m, m?.state === "removed"),
    });
    const consent = (await this.store.consentEvents(who.e164, app.id)).map(e => ({ state: e.state, source: e.source, wording: e.wording ?? null, at: new Date(e.at).toISOString() }));
    const exported = stepPrivacy(checked, { type: "recordConsentExport" });
    const live = exported.phase === "CompletePrivacyRequest" && exported.includeMembership ? m : undefined;
    const network = who.personId && live
      ? (await this.hooks.onExport?.({ app, personId: who.personId, memberId: live.memberId, e164: who.e164 })) ?? null
      : null;
    const current = who.personId && live ? await this.store.getMembership(who.personId, app.id) : undefined;
    if (!(await ownsPhone())) return empty;
    if (!current || current.memberId !== live?.memberId || current.state === "removed") return { ...empty, consent };
    return {
      ...exportHeader,
      membership: {
        memberId: current.memberId, state: current.state, firstName: current.firstName, profile: current.profile,
        joinedAt: current.joinedAt === null ? null : new Date(current.joinedAt).toISOString(),
      },
      consent,
      network,
    };
  }

  async share(app: AppInfo, who: Who, fromApp: AppId, fields: string[]): Promise<boolean> {
    if (fromApp === app.id || !fields.length || fields.some(f => !(SHAREABLE_FIELDS as readonly string[]).includes(f))) return false;
    const person = await this.personFor(who.e164);
    if (!person) return false;
    return this.store.withLock(`profile-share:${person.id}`, async () => {
      if (await this.banned(who.e164, person)) return false;
      const [to, from] = await Promise.all([this.store.getMembership(person.id, app.id), this.store.getMembership(person.id, fromApp)]);
      const live = (m?: Membership) => !!m && m.state !== "removed" && m.state !== "invited" && m.state !== "restricted";
      if (!live(to) || !live(from)) return false;
      await this.store.putShareGrant({ personId: person.id, fromApp, toApp: app.id, fields: [...new Set(fields)], grantedAt: this.now(), revokedAt: null });
      return true;
    });
  }
}
