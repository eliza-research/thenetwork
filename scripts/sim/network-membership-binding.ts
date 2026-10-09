// Offline scenarios for the host's existing-phone -> app-membership authorization boundary.
import { Accounts, RECYCLED_AFTER_MS } from "../../packages/platform/src/accounts.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { MemoryPeopleStore, type MembershipState } from "../../packages/platform/src/store.ts";
import { Block, expect } from "./gate.ts";

async function fixture(age: number | null = 25) {
  const at = Date.parse("2026-10-08T12:00:00Z"), e164 = "+12125550161";
  const store = new MemoryPeopleStore();
  const accounts = new Accounts(store, {hashKey: "simulation-only-key", now: () => at, apps: id => APPS[id]});
  const person = await store.createPerson({id: "local-person", e164, method: "inbound_message", at, lowestAge: age});
  for (const app of ["slop", "friends"] as const) {
    await store.putMembership({app, personId: person.id, memberId: `${app}_member`, state: "active", review: null, firstName: app, profile: {canary: `${app}_private`}, joinedAt: at, leftAt: null});
    await store.addConsent({e164, app, state: "opted_in", source: "simulation", at});
  }
  return {store, accounts, person, e164, at, who: {e164, personId: person.id}};
}

export async function networkMembershipBinding(b: Block): Promise<void> {
  await b.run("Cloud binding: verified phone resolves only the requested active app", async () => {
    const f = await fixture();
    const dating = await f.accounts.activeMembership(APPS.slop, f.who);
    const friends = await f.accounts.activeMembership(APPS.friends, f.who);
    expect(dating?.person.id).toBe(f.person.id);
    expect(dating?.membership.memberId).toBe("slop_member");
    expect(friends?.membership.profile).toEqual({canary: "friends_private"});
    expect(await f.accounts.activeMembership(APPS.peon, f.who)).toBeUndefined();
    expect(await f.accounts.activeMembership(APPS.slop, {...f.who, personId: "someone-else"})).toBeUndefined();
    expect((await f.accounts.activeMembership(APPS.slop, {...f.who, personId: null}))?.person.id).toBe(f.person.id);
  });
  await b.run("Cloud binding: onboarding, invitations and restricted states grant no agent action scope", async () => {
    const f = await fixture();
    const original = (await f.store.getMembership(f.person.id, "slop"))!;
    for (const state of ["invited", "onboarding", "paused", "restricted", "removed"] as MembershipState[]) {
      await f.store.putMembership({...original, state});
      expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeUndefined();
    }
    await f.store.putMembership({...original, review: "recycled_number"});
    expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeUndefined();
  });
  await b.run("Cloud binding: app leave and global STOP revoke the next authorization", async () => {
    const f = await fixture();
    expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeTruthy();
    await f.store.addConsent({e164: f.e164, app: null, state: "opted_out", source: "simulation-stop", at: f.at + 1});
    expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeUndefined();
    expect(await f.accounts.activeMembership(APPS.friends, f.who)).toBeUndefined();
    await f.store.addConsent({e164: f.e164, app: "friends", state: "opted_in", source: "simulation-start", at: f.at + 2});
    expect(await f.accounts.activeMembership(APPS.friends, f.who)).toBeTruthy();
    expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeUndefined();
    await f.store.forgetMembership(f.person.id, "friends", f.at + 3);
    expect(await f.accounts.activeMembership(APPS.friends, f.who)).toBeUndefined();
  });
  await b.run("Cloud binding: recycled, held and deleted identities are refused without writes", async () => {
    for (const reason of ["stale", "held", "deleted"] as const) {
      const f = await fixture();
      if (reason === "stale") await f.store.touchPhone(f.e164, f.at - RECYCLED_AFTER_MS - 1);
      if (reason === "held") await f.store.setPhoneHold(f.e164, "recycled_number");
      if (reason === "deleted") f.person.deletedAt = f.at;
      const before = JSON.stringify([Array.from(f.store.people), Array.from(f.store.phones), Array.from(f.store.members), f.store.consent]);
      expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeUndefined();
      expect(JSON.stringify([Array.from(f.store.people), Array.from(f.store.phones), Array.from(f.store.members), f.store.consent])).toBe(before);
    }
  });
  await b.run("Cloud binding: bans and suppression refuse otherwise active membership", async () => {
    for (const reason of ["ban", "suppression"] as const) {
      const f = await fixture();
      if (reason === "ban") await f.store.ban({id: "ban", scope: "person", personId: f.person.id, phoneHash: null, reason: "simulation", reportId: null, bannedBy: "local-reviewer", at: f.at});
      else await f.store.suppress(f.accounts.phoneHash(f.e164), "simulation", f.at);
      expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeUndefined();
    }
  });
  await b.run("Cloud binding: person-level age floor permits teen personal help but not underage or unknown access", async () => {
    for (const age of [null, 12, 13, 17, 21]) {
      const f = await fixture(age);
      expect(!!(await f.accounts.activeMembership(APPS.slop, f.who))).toBe(age !== null && age >= 13);
    }
    const f = await fixture(25);
    await f.store.noteAgeFloor(f.accounts.phoneHash(f.e164), 12, f.at);
    expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeUndefined();
  });
  await b.run("Cloud binding: absent or misbound membership never creates an identity", async () => {
    const f = await fixture();
    const original = f.store.getMembership;
    f.store.getMembership = async (person, app) => { const m = await original.call(f.store, person, app); return m ? {...m, app: "friends", personId: "other-person"} : undefined; };
    expect(await f.accounts.activeMembership(APPS.slop, f.who)).toBeUndefined();
    expect(await f.accounts.activeMembership(APPS.slop, {e164: "+12125550162", personId: null})).toBeUndefined();
    expect(f.store.people.size).toBe(1); expect(f.store.phones.size).toBe(1);
  });
}
