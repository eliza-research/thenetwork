import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { PgOAuthStore } from "../src/pg-store.ts";
import { addMember, call, connect, PHONE_A, PHONE_B, setup } from "./harness.ts";

const ADMIN_URL = `postgres://${process.env.USER ?? "postgres"}@localhost:${DEV_PG_PORT}/postgres`;
if (process.env.REQUIRE_PG === "1" && !pgAvailable) throw new Error("signup draft integration requires PostgreSQL");
const DB = `mcp_draft_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const testUrl = new URL(ADMIN_URL);
testUrl.pathname = `/${DB}`;
const admin = async (q: string) => {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe(q); } finally { await sql.close(); }
};

describe.skipIf(!pgAvailable)("spec/mcpSignupDraft.md, \"A draft is read only by the phone, app and person that saved it\"", () => {
  let store: PgOAuthStore;
  beforeAll(async () => {
    await devPgUp();
    await admin(`create database ${DB}`);
    store = new PgOAuthStore(testUrl.toString());
    await store.migrate();
  });
  afterAll(async () => {
    await store?.close();
    await admin(`drop database if exists ${DB} with (force)`).catch(() => {});
  });

  test("prepare_signup saves one draft that only the same phone, app and person read until its deadline, a disconnect included", async () => {
    const e = setup({ store });
    const c = await connect(e, "friends.help", PHONE_A);
    const token = c.token.access_token as string;
    const saved = await call(e, "https://friends.help/mcp", "prepare_signup", { firstName: "Ari", homeCity: "sf" }, { token });
    expect(saved.body!.result.structuredContent).toMatchObject({ prepared: true, app: "friends", next_step: expect.stringContaining("Finish signup") });
    expect(saved.text).not.toContain(PHONE_A);
    expect((await call(e, "https://friends.help/mcp", "prepare_signup", { firstName: "Other" }, { token })).body!.result.isError).toBe(true);
    for (const extra of [{ age: 29 }, { phone: PHONE_A }, { app: "slop" }])
      expect((await call(e, "https://friends.help/mcp", "prepare_signup", { firstName: "Ari", ...extra }, { token })).body!.result.isError).toBe(true);

    const keyA = e.accounts.phoneHash(PHONE_A), keyB = e.accounts.phoneHash(PHONE_B), at = e.clock.t;
    expect(await store.claimSignupDraft(keyA, "friends", null, at)).toEqual({ firstName: "Ari", homeCity: "sf" });
    expect(await store.claimSignupDraft(keyB, "friends", null, at)).toBeUndefined();
    expect(await store.claimSignupDraft(keyA, "ntwrk", null, at)).toBeUndefined();
    expect(await store.claimSignupDraft(keyA, "friends", "person_someone_else", at)).toBeUndefined();

    const grant = (await store.grantsFor(keyA, "friends", at))[0]!;
    expect(await store.revokeGrant(grant.id, at)).toBe(true);
    expect(await store.claimSignupDraft(keyA, "friends", null, at)).toEqual({ firstName: "Ari", homeCity: "sf" });
    expect(await store.claimSignupDraft(keyA, "friends", null, at + 10 * 60_000)).toBeUndefined();
    await store.sweep(at + 10 * 60_000);
    const rows = await new SQL({ url: testUrl.toString(), max: 1 });
    try { expect((await rows`select count(*)::int as n from oauth.signup_drafts`)[0]).toEqual({ n: 0 }); } finally { await rows.close(); }
  });

  test("a member cannot save a draft; a person under the app's join age cannot either; erasure deletes a saved draft", async () => {
    const e = setup({ store });
    await addMember(e, PHONE_B, [{ app: "friends", state: "active" }]);
    const member = await connect(e, "friends.help", PHONE_B);
    expect((await call(e, "https://friends.help/mcp", "prepare_signup", { firstName: "Bo" }, { token: member.token.access_token })).body!.result.isError).toBe(true);
    expect(await store.claimSignupDraft(e.accounts.phoneHash(PHONE_B), "friends", null, e.clock.t)).toBeUndefined();

    const child = "+12125550177";
    await e.people.noteAgeFloor(e.accounts.phoneHash(child), 12, e.clock.t);
    const young = await connect(e, "friends.help", child);
    const refused = await call(e, "https://friends.help/mcp", "prepare_signup", { firstName: "Mo" }, { token: young.token.access_token });
    expect(refused.body!.result.isError).toBe(true);
    expect(await store.claimSignupDraft(e.accounts.phoneHash(child), "friends", null, e.clock.t)).toBeUndefined();

    const invitedPhone = "+12125550178";
    const invited = await addMember(e, invitedPhone, [{ app: "ntwrk", state: "invited" }]);
    const c = await connect(e, "ntwrk.party", invitedPhone);
    expect((await call(e, "https://ntwrk.party/mcp", "prepare_signup", { firstName: "Lu" }, { token: c.token.access_token })).body!.result.structuredContent).toMatchObject({ prepared: true });
    expect(await store.claimSignupDraft(e.accounts.phoneHash(invitedPhone), "ntwrk", invited, e.clock.t)).toEqual({ firstName: "Lu" });
    await e.handler.forgetPerson(invited);
    expect(await store.claimSignupDraft(e.accounts.phoneHash(invitedPhone), "ntwrk", invited, e.clock.t)).toBeUndefined();
  });
});
