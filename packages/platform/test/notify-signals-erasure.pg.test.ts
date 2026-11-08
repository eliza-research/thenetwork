// Notify surface signals when a person leaves one app (packages/notify/db/retention.sql) on real
// PostgreSQL; synthetic records only. Signals are person data: the insert trigger lets a live or
// pending (invited) membership write them, so leaving another app must keep them for that membership.
import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {Accounts} from "../src/accounts.ts";
import {APPS} from "../src/apps.ts";
import {PgPeopleStore} from "../src/pg-store.ts";
import {PgNotifyStore} from "../../notify/src/pg-store.ts";
import {dropDb, migratedDb, pgAvailable} from "./pg.ts";

describe.skipIf(!pgAvailable)("Notify surface signals on app erasure (PostgreSQL)", () => {
  let url: string, people: PgPeopleStore, notify: PgNotifyStore, accounts: Accounts;
  const now = Date.UTC(2026, 9, 9, 15), phone = "+12125550181";
  beforeAll(async () => {
    url = await migratedDb("notify_signals_erasure"); people = new PgPeopleStore(url); notify = new PgNotifyStore(people.sql);
    accounts = new Accounts(people, {hashKey: "synthetic-signals-fixture", now: () => now, apps: id => APPS[id]});
  }, 120_000);
  afterAll(async () => {await people?.close(); if (url) await dropDb(url);});

  test("SD-341 leaving one app keeps the signals of a person whose other membership is invited", async () => {
    const person = await accounts.createPerson(phone, "inbound_message", 28);
    await people.putMembership({app: "slop", personId: person.id, memberId: "slop_signals_fixture", state: "active", review: null, firstName: "Synthetic", profile: {}, joinedAt: now, leftAt: null});
    await people.putMembership({app: "friends", personId: person.id, memberId: "friends_signals_fixture", state: "invited", review: null, firstName: "Synthetic", profile: {}, joinedAt: null, leftAt: null});
    await notify.setActive(person.id, "claude", true);
    const signals = await notify.signals(person.id);
    expect(signals.map(s => [s.surface, s.active])).toEqual([["claude", true]]);
    await accounts.leave(APPS.slop, {e164: phone, personId: person.id});
    // The invited friends membership is pending: the insert trigger lets it write signals, so the erasure keeps them.
    expect(await notify.signals(person.id)).toEqual(signals);
  });
});
