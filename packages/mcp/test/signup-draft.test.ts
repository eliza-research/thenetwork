import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { DEV_PG_PORT, devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { effectiveAgeAt } from "../../platform/src/age.ts";
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

describe.skipIf(!pgAvailable)("spec/mcpSignupDraft.md, \"A draft is written only under the grant that saves it, and nothing reads it\"", () => {
  let store: PgOAuthStore;
  const drafts = async (phoneKey: string, app: string) => {
    const sql = new SQL({ url: testUrl.toString(), max: 1 });
    try { return (await sql<{ fields: unknown }[]>`select fields from oauth.signup_drafts where phone_key = ${phoneKey} and app_id = ${app}`).map(r => r.fields); }
    finally { await sql.close(); }
  };
  beforeAll(async () => {
    await devPgUp();
    await admin(`create database ${DB}`);
    store = new PgOAuthStore(testUrl.toString());
    await store.migrate();
  });
  afterAll(async () => {
    await store?.close();
    await admin(`drop database if exists ${DB} with (force)`);
  });

  test("prepare_signup saves one draft for the phone and app of the grant, a disconnect keeps it, and the deadline deletes it", async () => {
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
    expect(await drafts(keyA, "friends")).toEqual([{ firstName: "Ari", homeCity: "sf" }]);
    expect(await drafts(keyB, "friends")).toEqual([]);
    expect(await drafts(keyA, "ntwrk")).toEqual([]);

    const grant = (await store.grantsFor(keyA, "friends", at))[0]!;
    expect(await store.revokeGrant(grant.id, at)).toBe(true);
    expect(await drafts(keyA, "friends")).toEqual([{ firstName: "Ari", homeCity: "sf" }]);
    await store.sweep(at + 10 * 60_000);
    expect(await drafts(keyA, "friends")).toEqual([]);
  });

  test("a member cannot save a draft; a person under the app's join age cannot either; erasure deletes a saved draft", async () => {
    const e = setup({ store });
    await addMember(e, PHONE_B, [{ app: "friends", state: "active" }]);
    const member = await connect(e, "friends.help", PHONE_B);
    expect((await call(e, "https://friends.help/mcp", "prepare_signup", { firstName: "Bo" }, { token: member.token.access_token })).body!.result.isError).toBe(true);
    expect(await drafts(e.accounts.phoneHash(PHONE_B), "friends")).toEqual([]);

    const child = "+12125550177";
    await e.people.recordAgeReading(null, e.accounts.phoneHash(child), { kind: "age", age: 12 }, e.clock.t);
    const young = await connect(e, "friends.help", child);
    const refused = await call(e, "https://friends.help/mcp", "prepare_signup", { firstName: "Mo" }, { token: young.token.access_token });
    expect(refused.body!.result.isError).toBe(true);
    expect(await drafts(e.accounts.phoneHash(child), "friends")).toEqual([]);

    const invitedPhone = "+12125550178";
    const invited = await addMember(e, invitedPhone, [{ app: "ntwrk", state: "invited" }]);
    const c = await connect(e, "ntwrk.party", invitedPhone);
    expect((await call(e, "https://ntwrk.party/mcp", "prepare_signup", { firstName: "Lu" }, { token: c.token.access_token })).body!.result.structuredContent).toMatchObject({ prepared: true });
    expect(await drafts(e.accounts.phoneHash(invitedPhone), "ntwrk")).toEqual([{ firstName: "Lu" }]);
    await e.handler.forgetPerson(invited);
    expect(await drafts(e.accounts.phoneHash(invitedPhone), "ntwrk")).toEqual([]);
  });

  test("spec/mcpSignupDraft.md, \"A live connection prepares one draft under the age guard\": an age recorded between the check and the insert leaves no draft", async () => {
    const e = setup({ store });
    const phone = "+12125550179";
    const c = await connect(e, "friends.help", phone);
    const key = e.accounts.phoneHash(phone);
    const read = e.people.ageStanding.bind(e.people);
    let firstCheck: Awaited<ReturnType<typeof read>> | undefined;
    const recordAgeAfterFirstCheck = vi.spyOn(e.people, "ageStanding").mockImplementationOnce(async (personId, hash) => {
      firstCheck = await read(personId, hash);
      await e.people.recordAgeReading(null, key, { kind: "age", age: 12 }, e.clock.t);
      return firstCheck;
    });
    const write = store.putSignupDraft.bind(store);
    let draftsAfterWrite: unknown[] | undefined;
    const countAfterWrite = vi.spyOn(store, "putSignupDraft").mockImplementationOnce(async (d, at) => {
      const saved = await write(d, at);
      draftsAfterWrite = await drafts(key, "friends");
      return saved;
    });
    try {
      const refused = await call(e, "https://friends.help/mcp", "prepare_signup", { firstName: "Ari", homeCity: "sf" }, { token: c.token.access_token });
      expect(refused.body!.result.isError).toBe(true);
      expect(firstCheck).toBeDefined();
      expect(effectiveAgeAt(firstCheck!, e.clock.t)).toBeUndefined();
      expect(draftsAfterWrite).toEqual([{ firstName: "Ari", homeCity: "sf" }]);
      expect(await drafts(key, "friends")).toEqual([]);
    } finally {
      recordAgeAfterFirstCheck.mockRestore();
      countAfterWrite.mockRestore();
    }
  });
});
