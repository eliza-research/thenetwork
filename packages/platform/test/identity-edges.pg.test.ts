import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DAY } from "../../core/src/clock.ts";
import { Accounts, type AccountHooks, JoinReviewRequired } from "../src/accounts.ts";
import { APPS } from "../src/apps.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { SessionService } from "../src/sessions.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

describe.skipIf(!pgAvailable)("phone identity edges (PostgreSQL)", () => {
  const app = APPS.friends;
  const consent = { sms: true, wording: app.consent.text } as const;
  let url: string, store: PgPeopleStore, now = Date.UTC(2026, 10, 21, 15), seq = 0;
  const phone = () => `+1212555${String(1000 + seq++).padStart(4, "0")}`;
  const world = (hooks: AccountHooks = {}) => {
    const accounts = new Accounts(store, { hashKey: "synthetic-identity-fixture", now: () => now, apps: id => APPS[id], hooks });
    const sessions = new SessionService(store, { secret: "synthetic-session-secret", phoneHash: e164 => accounts.phoneHash(e164), now: () => now });
    return { accounts, sessions };
  };
  const recorder = () => {
    const members = new Set<string>(), forgotten: string[] = [];
    const hooks: AccountHooks = {
      memberExists: async ctx => members.has(ctx.memberId),
      onForget: async (ctx, reason) => { members.delete(ctx.memberId); forgotten.push(`${ctx.memberId}:${reason}`); },
    };
    return { members, forgotten, hooks };
  };

  beforeAll(async () => { url = await migratedDb("identity_edges"); store = new PgPeopleStore(url); }, 120_000);
  afterAll(async () => { await store?.close(); if (url) await dropDb(url); });

  test("webSession, a session without a person never outlives its number getting a person: a join binds only its own session", async () => {
    const { accounts, sessions } = world();
    const number = phone();
    const earlier = await sessions.create(app.id, number, null);
    const joining = await sessions.create(app.id, number, null);
    const joined = await accounts.join(app, { e164: number, personId: null, session: joining.session.tokenHash }, { firstName: "Bea", age: 30, consent });
    if (!joined.ok) throw new Error(`fixture join failed: ${joined.error}`);
    expect(await sessions.authenticate(app.id, earlier.token, false)).toBeUndefined();
    expect((await sessions.authenticate(app.id, joining.token, false))?.session.personId).toBe(joined.membership.personId);
  });

  test("siteEnrollment, a decline below the join age ends the number's unbound access: an under-13 decline ends the number's unbound sessions and its pending text join", async () => {
    const { accounts, sessions } = world();
    const number = phone(), hash = accounts.phoneHash(number);
    const signedIn = await sessions.create(app.id, number, null);
    await store.putPending({ phoneHash: hash, kind: "join", app: app.id, name: "Kid", age: null, at: now });
    const declined = await accounts.join(app, { e164: number, personId: null, session: signedIn.session.tokenHash }, { firstName: "Kid", age: 12, consent });
    expect(declined).toEqual({ ok: false, error: "under_age" });
    expect(await sessions.authenticate(app.id, signedIn.token, false)).toBeUndefined();
    expect(await store.getPending(hash, "join")).toBeUndefined();
  });

  test("webSession, only a live token can authenticate: a rotation in flight during delete everything issues no session for the erased number", async () => {
    const { accounts } = world();
    const number = phone();
    const joined = await accounts.join(app, { e164: number, personId: null }, { firstName: "Cy", age: 33, consent });
    if (!joined.ok) throw new Error(`fixture join failed: ${joined.error}`);
    const owner = { e164: number, personId: joined.membership.personId };
    let erase = true;
    const racing = new Proxy(store, {
      get(target, key, receiver) {
        if (key !== "isBanned") return Reflect.get(target, key, receiver);
        return async (...args: Parameters<PgPeopleStore["isBanned"]>) => {
          if (erase) { erase = false; expect(await accounts.deleteAll(owner)).toBe(true); }
          return target.isBanned(...args);
        };
      },
    });
    const sessions = new SessionService(racing, { secret: "synthetic-session-secret", phoneHash: e164 => accounts.phoneHash(e164), now: () => now });
    const old = await sessions.create(app.id, number, owner.personId);
    now += DAY + 1;
    expect(await sessions.authenticate(app.id, old.token)).toBeUndefined();
    expect(await store.sql`select 1 from platform.sessions where e164 = ${number}`).toEqual([]);
  });

  test("siteEnrollment, the effective age controls a repeated join: a repeated join runs the join hook again when the membership has no Network member", async () => {
    const r = recorder();
    const { accounts } = world({
      ...r.hooks,
      onJoin: async ctx => { r.members.add(ctx.membership.memberId); },
    });
    const number = phone();
    const person = await accounts.createPerson(number, "otp_sms", 41);
    const stranded = { app: app.id, personId: person.id, memberId: `${app.id}_${randomUUID()}`, state: "active" as const, review: null, firstName: "Di", profile: {}, joinedAt: now, leftAt: null };
    await store.putMembership(stranded);
    expect((await store.getMembership(person.id, app.id))?.state).toBe("active");
    const again = await accounts.join(app, { e164: number, personId: person.id }, { firstName: "Di", age: 41, consent });
    expect(again).toEqual({ ok: true, membership: stranded, created: false });
    expect(r.members.has(stranded.memberId)).toBe(true);
  });

  test("siteEnrollment, success follows the join hook: a failed join hook forgets the Network member it made, the membership and the opt-in", async () => {
    const r = recorder();
    const { accounts } = world({ ...r.hooks, onJoin: async ctx => { r.members.add(ctx.membership.memberId); throw new Error("welcome failed"); } });
    const number = phone();
    await expect(accounts.join(app, { e164: number, personId: null }, { firstName: "Ed", age: 29, consent })).rejects.toThrow("welcome failed");
    const person = (await accounts.personFor(number))!;
    const membership = (await store.getMembership(person.id, app.id))!;
    expect(r.forgotten).toEqual([`${membership.memberId}:join_failed`]);
    expect(r.members.size).toBe(0);
    expect(membership.state).toBe("removed");
    expect(await accounts.optedIn(app.id, number)).toBe(false);
  });

  test("siteEnrollment, success follows the join hook: a review refusal from the join hook forgets the membership and the opt-in", async () => {
    const r = recorder();
    const { accounts } = world({ ...r.hooks, onJoin: async () => { throw new JoinReviewRequired(); } });
    const number = phone();
    expect(await accounts.join(app, { e164: number, personId: null }, { firstName: "Flo", age: 35, consent })).toEqual({ ok: false, error: "review" });
    const person = (await accounts.personFor(number))!;
    const membership = (await store.getMembership(person.id, app.id))!;
    expect(r.forgotten).toEqual([`${membership.memberId}:join_failed`]);
    expect(membership.state).toBe("removed");
    expect(await accounts.optedIn(app.id, number)).toBe(false);
    expect((await accounts.canJoin(app, { e164: number, personId: person.id })).canJoin).toBe(true);
  });

  test("staffSafetyService, a staff hold survives membership changes: a staff hold survives delete everything and returns with the person on the next join", async () => {
    const { accounts } = world();
    const number = phone();
    const joined = await accounts.join(app, { e164: number, personId: null }, { firstName: "Gus", age: 38, consent });
    if (!joined.ok) throw new Error(`fixture join failed: ${joined.error}`);
    const personId = joined.membership.personId;
    await store.sql`insert into platform.staff_safety_holds (person_id, app_id, decision_id, held_at) values (${personId}::uuid, null, ${randomUUID()}::uuid, ${new Date(now)})`;
    expect(await accounts.deleteAll({ e164: number, personId })).toBe(true);
    now += 1000;
    const back = await accounts.join(app, { e164: number, personId: null }, { firstName: "Gus", age: 38, consent });
    if (!back.ok) throw new Error(`fixture rejoin failed: ${back.error}`);
    expect(back.membership.personId).toBe(personId);
    expect(await store.sql`select app_id from platform.staff_safety_holds where person_id = ${personId}::uuid`).toEqual([{ app_id: null }]);
  });

  test("webSession, a session without a person never outlives its number getting a person: a number change ends an earlier holder's session of the new number", async () => {
    const { accounts, sessions } = world();
    const oldNumber = phone(), newNumber = phone();
    const joined = await accounts.join(app, { e164: oldNumber, personId: null }, { firstName: "Hal", age: 44, consent });
    if (!joined.ok) throw new Error(`fixture join failed: ${joined.error}`);
    const owner = { e164: oldNumber, personId: joined.membership.personId };
    const earlier = await sessions.create(app.id, newNumber, null);
    expect(await accounts.startNumberChange(app, owner, newNumber, true, async () => true)).toEqual({ ok: true });
    expect(await accounts.confirmNumberChange(owner, async () => true)).toEqual({ ok: true, e164: newNumber, personId: owner.personId });
    expect(await sessions.authenticate(app.id, earlier.token, false)).toBeUndefined();
  });

  test("webSession, a session without a person never outlives its number getting a person: an invitation ends an earlier holder's session of the number", async () => {
    const { accounts, sessions } = world();
    const number = phone();
    const earlier = await sessions.create(APPS.ntwrk.id, number, null);
    expect(await accounts.invite(APPS.ntwrk, number)).toMatchObject({ state: "invited" });
    expect(await sessions.authenticate(APPS.ntwrk.id, earlier.token, false)).toBeUndefined();
  });

  test("webSession, a session without a person never outlives its number getting a person: a sign-in after the person arrived takes the person", async () => {
    const { accounts, sessions } = world();
    const number = phone();
    const invited = await accounts.invite(APPS.ntwrk, number);
    const later = await sessions.create(APPS.ntwrk.id, number, null);
    expect((await sessions.authenticate(APPS.ntwrk.id, later.token, false))?.session.personId).toBe(invited!.personId);
  });
});
