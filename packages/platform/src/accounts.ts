// Person and membership rules for the public API and for the text channel (platform plan 2.4-2.6,
// 3.4, 4.3). Rules:
//  - The verified phone finds the person. A second app's join adds a membership to the same person.
//  - Age is a person-level fact: the lowest age ever stated wins, on every app. The phone's age floor
//    (a keyed hash and an age, platform.age_floor) keeps it for a phone with no person yet and after a
//    delete of everything, so a retry with an older age is refused.
//  - An under-age join stores nothing for that app (only the age floor).
//  - Nothing crosses apps by default. A share grant names fields; sensitive classes are never shareable.
//  - A phone not seen for 12 months may have a new owner: at the next login or message the number is
//    put on hold, and nobody can read or change the old owner's account until staff decide.
//  - Joins of one phone run one at a time (store.withLock), so parallel joins make one person, one
//    membership, one member and one opt-in.
//  - The opt-in wording is the app's canonical text (apps.ts ConsentText): the ledger stores that text
//    and its version, never what a client sent.
//  - A staff invite names a number nobody has proved yet: its phone is not verified until a message or
//    a code comes from it. An invite ends without a trace (but the decline and the age floor) when the
//    invitee is under 13, says no, or does not answer in 30 days (INVITE_TTL_MS).
//  - Soft approval (approval.ts): a join a rule flags is let in and flagged for staff; its member is
//    never matched until staff clear it.
import { randomUUID } from "node:crypto";
import { validAge } from "../../core/src/policy.ts";
import { joinAgeCheck, lowestAge } from "./age.ts";
import { joinFlags } from "./approval.ts";
import type { AppId, AppInfo } from "./apps.ts";
import { type ConsentEvent, resolveConsent, type StopScope, stopScope } from "./consent.ts";
import { keyedHash } from "./phone.ts";
import type { Membership, MembershipFlag, PeopleStore, Person, PhoneIdentity, PhoneMethod } from "./store.ts";

export const RECYCLED_AFTER_MS = 365 * 24 * 3_600_000;
/** An invite nobody answered is deleted after 30 days (the service's purge). */
export const INVITE_TTL_MS = 30 * 24 * 3_600_000;
/** Base-profile fields a person may share from one app to another. Sensitive classes are not in this list and never will be. */
export const SHAREABLE_FIELDS = ["first_name", "city", "age_band", "interests"] as const;

export interface JoinInput {
  firstName: string;
  age: number;
  neighborhood?: string;
  zip?: string;
  interests?: string[];
  about?: string;
  /** The person ticked the box next to the app's opt-in text: the client sends that text, or its version. */
  consent: { sms: true; wording?: string; version?: string };
}

export type JoinError = "under_age" | "invite_only" | "invalid" | "review" | "consent_wording";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** True when the client's consent names this app's canonical opt-in text (by its words or its version). */
export const consentMatches = (app: Pick<AppInfo, "consent">, c: JoinInput["consent"]) =>
  c.version !== undefined ? c.version === app.consent.version && (c.wording === undefined || squash(c.wording) === squash(app.consent.text))
    : c.wording !== undefined && squash(c.wording) === squash(app.consent.text);

/** Check and clean a join body. Returns undefined when it is not valid. */
export function parseJoin(body: unknown): JoinInput | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim().length > 0 && v.trim().length <= max ? v.trim() : undefined);
  const firstName = str(b.firstName, 50);
  if (!firstName || !validAge(b.age) || !Number.isInteger(b.age) || (b.age as number) > 120) return undefined;
  const c = b.consent as Record<string, unknown> | undefined;
  const wording = str(c?.wording, 2000), version = str(c?.version, 40);
  if (!c || c.sms !== true || (!wording && !version)) return undefined;
  const out: JoinInput = { firstName, age: b.age as number, consent: { sms: true, ...(wording ? { wording } : {}), ...(version ? { version } : {}) } };
  if (b.neighborhood !== undefined) { const v = str(b.neighborhood, 80); if (!v) return undefined; out.neighborhood = v; }
  if (b.zip !== undefined) { if (typeof b.zip !== "string" || !/^\d{5}$/.test(b.zip)) return undefined; out.zip = b.zip; }
  if (b.interests !== undefined) {
    if (!Array.isArray(b.interests) || b.interests.length > 20) return undefined;
    const list = b.interests.map(i => str(i, 40));
    if (list.some(i => !i)) return undefined;
    out.interests = list as string[];
  }
  if (b.about !== undefined) { const v = str(b.about, 1000); if (!v) return undefined; out.about = v; }
  return out;
}

export interface JoinHookContext { app: AppInfo; person: Person; membership: Membership; e164: string; age: number; input: JoinInput }
/** Where a join came from, for the soft-approval rules (approval.ts). */
export interface JoinOrigin { ip?: string }
export interface MemberHookContext { app: AppInfo; personId: string; memberId: string; e164: string }

export interface AccountHooks {
  /** Create the network member (the service mounts this). A throw undoes the join. */
  onJoin?(ctx: JoinHookContext): Promise<void> | void;
  /** STOP from the web. memberId is this app's member, when there is one (a global stop runs without one). */
  onStop?(ctx: Omit<MemberHookContext, "memberId"> & { memberId?: string; scope: StopScope }): Promise<void> | void;
  /** Delete the member's network rows for this app (the generalized forget path). */
  onForget?(ctx: MemberHookContext): Promise<void> | void;
  /** The member's own network data for this app (facets, intents, opportunities, messages). */
  onExport?(ctx: MemberHookContext): Promise<unknown> | unknown;
  /** The person's lowest age went down (a stated age on any app): every app's member must follow (a minor is never matched anywhere). */
  onAgeLowered?(ctx: { personId: string; age: number }): Promise<void> | void;
  /** More of the person's own records for this app's export, outside the network rows (photos, connected assistants). */
  onExportAccount?(ctx: MemberHookContext): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface Who { e164: string; personId: string | null }

/** The public shape of a membership: this app only. */
export const publicMembership = (m: Membership | undefined) =>
  m && m.state !== "removed" ? { state: m.state, joinedAt: m.joinedAt === null ? null : new Date(m.joinedAt).toISOString(), firstName: m.firstName } : null;

export class Accounts {
  constructor(
    readonly store: PeopleStore,
    private readonly opts: { hashKey: string; now?: () => number; hooks?: AccountHooks; env?: Record<string, string | undefined>; apps: (id: AppId) => AppInfo },
  ) {}
  private now() { return (this.opts.now ?? Date.now)(); }
  private get hooks() { return this.opts.hooks ?? {}; }
  phoneHash(e164: string) { return keyedHash(this.opts.hashKey, `phone:${e164}`); }

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
    // The first message or code from a number a staff invite named: the number is proved now.
    if (ph.verifiedAt === null) await this.store.verifyPhone(e164, at);
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
      await this.store.touchPhone(e164, at);
      return true;
    }
    for (const m of await this.store.memberships(ph.personId)) {
      if (m.state !== "removed") await this.hooks.onForget?.({ app: this.opts.apps(m.app), personId: ph.personId, memberId: m.memberId, e164 });
    }
    const hash = this.phoneHash(e164);
    await this.store.deleteAll(ph.personId, e164, hash, at);
    // The old owner's tombstone keeps its blocks, but is never revived for the new owner of the number.
    await this.store.detachPhoneHash(ph.personId);
    await this.store.unsuppress(hash);
    await this.store.clearAgeFloor(hash);
    return true;
  }

  /** The lowest age known for this phone: the person's (any app) and the phone's age floor. */
  async lowestAge(e164: string, person?: Person): Promise<number | undefined> {
    return lowestAge(person?.lowestAge ?? undefined, await this.store.ageFloor(this.phoneHash(e164)));
  }

  /** Record a stated age: the phone's age floor and the person (if any) keep the lowest. Every app's member follows a lower age. */
  async recordAge(e164: string, person: Person | undefined, age: number): Promise<void> {
    if (!validAge(age)) return;
    await this.store.noteAgeFloor(this.phoneHash(e164), age, this.now());
    if (!person) return;
    const before = (await this.store.getPerson(person.id))?.lowestAge ?? null;
    const after = await this.store.noteAge(person.id, age);
    if (before === null || after < before) await this.hooks.onAgeLowered?.({ personId: person.id, age: after });
  }

  /** A new person for a verified phone (or the tombstone of this phone's earlier person, revived). */
  createPerson(e164: string, method: PhoneMethod, lowestAge: number | null) {
    return this.store.createPerson({ id: randomUUID(), e164, method, at: this.now(), lowestAge, phoneHash: this.phoneHash(e164) });
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

  /**
   * Staff or a member invite: a person (method 'staff' when new, its phone not verified until the
   * invitee writes) and an 'invited' membership. Undefined for a number that asked to delete
   * everything (the suppression hash) or is on hold. An existing membership comes back as it is (a
   * waitlisted one too: the service lets it in).
   */
  async invite(app: AppInfo, e164: string): Promise<Membership | undefined> {
    const at = this.now();
    if ((await this.held(e164)) || (await this.store.isSuppressed(this.phoneHash(e164))) || (await this.banned(e164))) return undefined;
    const person = (await this.personFor(e164)) ?? (await this.createPerson(e164, "staff", null));
    const existing = await this.store.getMembership(person.id, app.id);
    if (existing && existing.state !== "removed") return existing;
    const m: Membership = { app: app.id, personId: person.id, memberId: `${app.id}_${randomUUID()}`, state: "invited", review: null, firstName: null, profile: {}, joinedAt: null, leftAt: null, invitedAt: at };
    await this.store.putMembership(m);
    return m;
  }

  /**
   * An invite ends without a join: an under-13 answer, a "no thanks", or 30 days with no answer. The
   * invited membership goes, and the person and their phone too when nothing else names them (a
   * staff invite made them). Only the age floor (a keyed hash and an age) and the decline in the
   * consent ledger stay.
   */
  async endInvite(app: AppInfo, personId: string): Promise<{ personDeleted: boolean }> {
    return this.store.dropInvite(personId, app.id);
  }

  /** Invites older than 30 days that nobody answered are ended (the service's purge). Returns how many. */
  async expireInvites(): Promise<number> {
    let n = 0;
    for (const m of await this.store.staleInvites(this.now() - INVITE_TTL_MS)) { await this.store.dropInvite(m.personId, m.app); n++; }
    return n;
  }

  /**
   * Soft approval: count this join against the rules (approval.ts) and flag the membership when one
   * fires. The member is never matched until staff clear the flag (decideFlag).
   */
  async flagJoin(app: AppId, personId: string, j: { e164: string; ip?: string; text?: string }): Promise<string[]> {
    const at = this.now();
    const reasons = await joinFlags(this.store, this.opts.hashKey, j, at);
    if (reasons.length) await this.store.putFlag({ app, personId, reasons, flaggedAt: at, decision: null, decidedBy: null, decidedAt: null });
    return reasons;
  }

  /** True while staff have not cleared a flag on this membership. */
  async flagged(app: AppId, personId: string): Promise<boolean> {
    const f = await this.store.getFlag(app, personId);
    return !!f && f.decision === null;
  }

  /** Staff decide a flag: "clear" lets the member be matched; "keep" keeps them out of matching for good (staff may hold or ban as well). */
  async decideFlag(app: AppId, personId: string, decision: "clear" | "keep", by: string): Promise<MembershipFlag | undefined> {
    const f = await this.store.getFlag(app, personId);
    if (!f || f.decision !== null) return undefined;
    const out: MembershipFlag = { ...f, decision, decidedBy: by, decidedAt: this.now() };
    await this.store.putFlag(out);
    return out;
  }

  /**
   * Move a person to a new number (F25, a staff tool after a code to the new number was confirmed):
   * the phone, the consent history, the keyed phone hash and the age floor. Memberships, grants and
   * photos belong to the person and stay. Refused when the new number already belongs to someone.
   */
  async movePhone(personId: string, changeId: string, oldE164: string, newE164: string): Promise<"ok" | "number_in_use" | "no_phone"> {
    const old = await this.store.findPhone(oldE164);
    if (!old || old.personId !== personId) return "no_phone";
    if (await this.store.findPhone(newE164)) return "number_in_use";
    await this.store.movePhone({ personId, changeId, oldE164, newE164, oldHash: this.phoneHash(oldE164), newHash: this.phoneHash(newE164), at: this.now() });
    // The person proved the new number and brings their own opt-ins: an old delete-everything of that number no longer suppresses it (a ban refuses the change before this).
    await this.store.unsuppress(this.phoneHash(newE164));
    return "ok";
  }

  async join(app: AppInfo, who: Who, input: JoinInput, from: JoinOrigin = {}): Promise<{ ok: true; membership: Membership } | { ok: false; error: JoinError }> {
    if (!consentMatches(app, input.consent)) return { ok: false, error: "consent_wording" };
    // One join per phone at a time: parallel requests see the first one's person and membership.
    return this.store.withLock(`join:${who.e164}`, () => this.joinLocked(app, who, input, from));
  }

  private async joinLocked(app: AppInfo, who: Who, input: JoinInput, from: JoinOrigin): Promise<{ ok: true; membership: Membership } | { ok: false; error: JoinError }> {
    const at = this.now();
    if ((await this.seen(who.e164)) === "held") return { ok: false, error: "review" };
    let person = await this.personFor(who.e164);
    if (await this.banned(who.e164, person)) return { ok: false, error: "review" };
    const existing = person && (await this.store.getMembership(person.id, app.id));
    if (existing && existing.state !== "removed" && existing.state !== "invited") return { ok: true, membership: existing };
    if (app.joinMode === "invite" && existing?.state !== "invited") return { ok: false, error: "invite_only" };
    const age = joinAgeCheck(input.age, await this.lowestAge(who.e164, person), app);
    if (!age.ok) {
      // Nothing is stored for this app: only the age, on the phone's age floor (and the person, if any).
      // An invite ends here, and a person the invite made goes with it (audit platform-25).
      const left = existing?.state === "invited" ? await this.endInvite(app, person!.id) : { personDeleted: false };
      await this.recordAge(who.e164, left.personDeleted ? undefined : person, input.age);
      return { ok: false, error: "under_age" };
    }
    if (!person) person = await this.createPerson(who.e164, "otp_sms", age.effective ?? input.age);
    await this.recordAge(who.e164, person, input.age);
    // A new opt-in by the person: a delete of everything no longer suppresses the number.
    await this.store.unsuppress(this.phoneHash(who.e164));
    const membership: Membership = {
      // An invited membership keeps its member id (the invite may already name it).
      app: app.id, personId: person.id, memberId: existing?.state === "invited" ? existing.memberId : `${app.id}_${randomUUID()}`,
      state: app.joinMode === "waitlist" ? "onboarding" : "active", review: null,
      firstName: input.firstName,
      profile: Object.fromEntries(Object.entries({ neighborhood: input.neighborhood, zip: input.zip, interests: input.interests, about: input.about }).filter(([, v]) => v !== undefined)),
      joinedAt: at, leftAt: null,
    };
    await this.store.putMembership(membership);
    await this.store.addConsent({ e164: who.e164, app: app.id, state: "opted_in", source: "web_form", wording: app.consent.text, wordingVersion: app.consent.version, at });
    await this.store.attachPerson(who.e164, person.id);
    await this.flagJoin(app.id, person.id, { e164: who.e164, ip: from.ip, text: [input.firstName, input.about, ...(input.interests ?? [])].filter(Boolean).join(" ") });
    try {
      // The network member gets the person's lowest age, not the one typed now (a minor anywhere is a minor here).
      await this.hooks.onJoin?.({ app, person, membership, e164: who.e164, age: age.effective ?? input.age, input });
    } catch (e) {
      await this.store.forgetMembership(person.id, app.id, at);
      await this.store.addConsent({ e164: who.e164, app: app.id, state: "opted_out", source: "join_failed", at });
      throw e;
    }
    return { ok: true, membership };
  }

  /** The site's stop button: every app on this number (PRD 40.3), unless PLATFORM_STOP_SCOPE=app. */
  async stop(app: AppInfo, who: Who, source = "web_form"): Promise<void> {
    const scope = stopScope(this.opts.env);
    await this.store.addConsent({ e164: who.e164, app: scope === "global" ? null : app.id, state: "opted_out", source, at: this.now() });
    // The ledger above is what the send path reads. The hooks pause the person's members: on a global
    // stop every app's, even when the person has no membership on the app they stopped from.
    const person = await this.personFor(who.e164);
    const m = person && (await this.store.getMembership(person.id, app.id));
    const live = m && m.state !== "removed" ? m : undefined;
    if (person && (live || scope === "global")) await this.hooks.onStop?.({ app, personId: person.id, memberId: live?.memberId, e164: who.e164, scope });
  }

  /** Record any consent event (keywords on a line, staff). */
  async recordConsent(e: ConsentEvent) { await this.store.addConsent(e); }

  /**
   * True if the number may get messages from this app now. A number that deleted everything has no
   * events left, so it needs a new opt-in (the suppression hash keeps that true across re-imports).
   */
  async optedIn(app: AppId, e164: string): Promise<boolean> {
    return resolveConsent(await this.store.lastConsent(e164, app)) === "opted_in";
  }

  /** Leave one app: the forget path. The phone and other memberships stay. */
  async leave(app: AppInfo, who: Who): Promise<void> {
    const at = this.now();
    const person = await this.personFor(who.e164);
    const m = person && (await this.store.getMembership(person.id, app.id));
    await this.store.addConsent({ e164: who.e164, app: app.id, state: "opted_out", source: "leave", at });
    if (!person || !m || m.state === "removed") return;
    await this.hooks.onForget?.({ app, personId: person.id, memberId: m.memberId, e164: who.e164 });
    await this.store.forgetMembership(person.id, app.id, at);
  }

  /** Delete everything: every membership (forget path each), the phone, grants, own blocks, sessions; keep a tombstone and the suppression hash. */
  async deleteAll(who: Who): Promise<void> {
    const at = this.now();
    const person = await this.personFor(who.e164);
    // The age stays on the phone's age floor (a safety fact, not profile data): deleting everything
    // and joining again with an older age is refused.
    if (person?.lowestAge != null) await this.store.noteAgeFloor(this.phoneHash(who.e164), person.lowestAge, at);
    if (person) {
      for (const m of await this.store.memberships(person.id)) {
        if (m.state !== "removed") await this.hooks.onForget?.({ app: this.opts.apps(m.app), personId: person.id, memberId: m.memberId, e164: who.e164 });
      }
    }
    await this.store.deleteAll(person?.id ?? null, who.e164, this.phoneHash(who.e164), at);
  }

  /** This app's own data. Nothing from another app, not even its name. */
  async exportApp(app: AppInfo, who: Who): Promise<Record<string, unknown>> {
    const person = await this.personFor(who.e164);
    const m = person && (await this.store.getMembership(person.id, app.id));
    const consent = (await this.store.consentEvents(who.e164, app.id)).map(e => ({ state: e.state, source: e.source, wording: e.wording ?? null, at: new Date(e.at).toISOString() }));
    const live = m && m.state !== "removed" ? m : undefined;
    return {
      app: app.id,
      exportedAt: new Date(this.now()).toISOString(),
      phone: who.e164,
      membership: live ? {
        memberId: live.memberId, state: live.state, firstName: live.firstName, profile: live.profile,
        joinedAt: live.joinedAt === null ? null : new Date(live.joinedAt).toISOString(),
      } : null,
      consent,
      network: person && live ? ((await this.hooks.onExport?.({ app, personId: person.id, memberId: live.memberId, e164: who.e164 })) ?? null) : null,
      // Base-profile grants into this app: the fields and times only (the other app is never named here).
      shareGrants: person ? (await this.store.shareGrants(person.id)).filter(g => g.toApp === app.id).map(g => ({
        fields: g.fields, grantedAt: new Date(g.grantedAt).toISOString(), revokedAt: g.revokedAt === null ? null : new Date(g.revokedAt).toISOString(),
      })) : [],
      ...(person && live ? ((await this.hooks.onExportAccount?.({ app, personId: person.id, memberId: live.memberId, e164: who.e164 })) ?? {}) : {}),
    };
  }

  /** Revoke a base-profile grant into this app (logged in the consent ledger without naming the other app to anyone but staff). */
  async revokeShare(app: AppInfo, who: Who, fromApp: AppId): Promise<boolean> {
    const person = await this.personFor(who.e164);
    if (!person) return false;
    const g = (await this.store.shareGrants(person.id)).find(x => x.fromApp === fromApp && x.toApp === app.id && x.revokedAt === null);
    if (!g) return false;
    await this.store.putShareGrant({ ...g, revokedAt: this.now() });
    return true;
  }

  /** A base-profile grant from another app the person is an active member of to this app. */
  async share(app: AppInfo, who: Who, fromApp: AppId, fields: string[]): Promise<boolean> {
    if (fromApp === app.id || !fields.length || fields.some(f => !(SHAREABLE_FIELDS as readonly string[]).includes(f))) return false;
    const person = await this.personFor(who.e164);
    if (!person) return false;
    const [to, from] = await Promise.all([this.store.getMembership(person.id, app.id), this.store.getMembership(person.id, fromApp)]);
    const live = (m?: Membership) => !!m && m.state !== "removed" && m.state !== "invited";
    if (!live(to) || !live(from)) return false;
    await this.store.putShareGrant({ personId: person.id, fromApp, toApp: app.id, fields: [...new Set(fields)], grantedAt: this.now(), revokedAt: null });
    return true;
  }
}
