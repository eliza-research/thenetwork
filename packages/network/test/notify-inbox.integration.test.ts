import { expect, test } from "vitest";
import { DAY, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { NetworkService } from "../service/service.ts";

// spec/outboundAdmission.md, "Replies, quiet hours and unanswered messages limit when a send can go out"
test.skipIf(!pgAvailable)("the notification planner follows each recipient's home zone in a shared New York runtime", async () => {
  const url = await migratedDb("network_notify_home_zone");
  const clock = new SimClock(Date.UTC(2026, 9, 19, 19));
  const service = new NetworkService({
    url, clock, photoStorage: null, log: () => {}, env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }],
  });
  try {
    await service.start();
    const app = APPS.ntwrk;
    const notify = service.notify!;
    const members = [];
    for (const [phone, firstName, homeCity] of [
      ["+12125550171", "Ari", "nyc"], ["+12125550172", "Mira", "sf"],
    ] as const) {
      const invite = await service.accounts.invite(app, phone);
      if (!invite) throw new Error("The notification fixture invitation was missing");
      const result = await service.accounts.join(app, { e164: phone, personId: invite.personId }, {
        firstName, age: 31, homeCity, consent: { sms: true, wording: app.consent.text },
      });
      if (!result.ok) throw new Error(`The notification fixture did not join: ${result.error}`);
      const { personId, memberId } = result.membership;
      expect(await service.runtimeOfMember(app.id, memberId)).toBe(service.runtimeFor("ntwrk", "nyc"));
      await notify.add({
        personId, app: app.id, eventType: "information", subjectId: "home-city",
        urgency: "requested", summary: "Your requested update is ready.", expiresAt: clock.now() + 2 * DAY,
      }, clock.now());
      members.push({ personId, phone });
    }
    const [ny, sf] = members;
    const planAt = async (at: number) => {
      clock.set(at);
      const { sends, holds } = await notify.plan(at);
      return { sends: sends.map(row => [row.to, row.timeZone]), holds };
    };
    // 10:30 in New York and 07:30 in San Francisco.
    expect(await planAt(Date.UTC(2026, 9, 20, 14, 30))).toEqual({
      sends: [[ny!.phone, "America/New_York"]], holds: [{ personId: sf!.personId, reason: "quiet_hours" }],
    });
    // 22:30 in New York and 19:30 in San Francisco.
    expect(await planAt(Date.UTC(2026, 9, 21, 2, 30))).toEqual({
      sends: [[sf!.phone, "America/Los_Angeles"]], holds: [{ personId: ny!.personId, reason: "quiet_hours" }],
    });
  } finally {
    await service.close();
    await dropDb(url);
  }
}, 120_000);

// spec/notificationAcknowledgement.md, "A delivered text can appear only once and its opportunity must still be current"
test.skipIf(!pgAvailable)("the inbox repairs accepted messages once and shows only current updates in the caller's app", async () => {
  const url = await migratedDb("network_notify_inbox");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
  const phone = "+12125550387";
  const service = new NetworkService({
    url, clock, photoStorage: null, log: () => {}, env: { PLATFORM_ENV: "dev" },
    networks: [{ id: "friends:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }],
  });
  try {
    await service.start();
    const notify = service.notify!;
    const appFriends = APPS.friends, appPeon = APPS.peon;
    const [friends, peon] = await Promise.all([appFriends, appPeon].map(app => service.accounts.join(app, { e164: phone, personId: null }, {
      firstName: "Ari", age: 31, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
    })));
    if (!friends?.ok || !peon?.ok) throw new Error("The fixture person did not join both apps");
    const personId = friends.membership.personId;
    expect(peon.membership.personId).toBe(personId);
    const at = () => new Date(clock.now());
    await sql`insert into network.opportunities (id,app_id,kind,state,source,city,objective) values
      ('same-opp','friends','group','SCHEDULED','network','nyc','A walk'),
      ('peon-opp','peon','group','SCHEDULED','network','nyc','A call'),
      ('closed-friends','friends','group','SKIPPED','network','nyc','A stopped plan')`;
    const accepted = async (id: string, app: "friends" | "peon", member: string, opp: string, body: string) => {
      await sql`insert into network.messages (id,app_id,member_id,direction,channel,body,type,status,opportunity_id,proactive,ts)
        values (${id},${app},${member},'outbound','imessage',${body},'reminder','queued',${opp},true,${at()})`;
      await sql`insert into platform.outbound (id,app_id,member_id,line,to_address,kind,body,fingerprint,time_zone,status,
          next_attempt_at,created_at,updated_at,sent_at,opportunity_id)
        values (${id},${app},${member},'+12125550388',${phone},'proactive',${body},${id},'America/New_York','sent',
          ${at()},${at()},${at()},${at()},${opp})`;
    };
    const oldProjection = (id: string, subjectId: string, summary: string) => notify.recordSent(
      { personId, app: "friends", eventType: "reminder", subjectId, urgency: "normal", summary },
      { deliveryId: `net:${id}`, channel: "imessage", countsTowardCap: true, sentAt: clock.now() },
    );
    const friendsId = friends.membership.memberId;
    await accepted("old-opp-text", "friends", friendsId, "same-opp", "An earlier walk reminder.");
    await oldProjection("old-opp-text", "same-opp", "An earlier walk reminder.");
    clock.advance(MINUTE);
    await accepted("walk-one", "friends", friendsId, "same-opp", "The walk is tomorrow.");
    clock.advance(MINUTE);
    await accepted("walk-two", "friends", friendsId, "same-opp", "The walk is in two hours.");
    await accepted("closed-message-id", "friends", friendsId, "closed-friends", "A skipped old plan with a message subject.");
    await oldProjection("closed-message-id", "closed-message-id", "A skipped old plan with a message subject.");
    await oldProjection("closed-opp-message", "closed-friends", "A skipped old plan with an opportunity subject.");
    await oldProjection("erased-opp-message", "erased-friends", "A removed old plan with an opportunity subject.");
    await accepted("missing-opp-text", "friends", friendsId, "missing-opp", "A plan no longer in this app.");
    await accepted("wrong-app-text", "friends", friendsId, "peon-opp", "A call belonging to another app.");
    await accepted("other-app-text", "peon", peon.membership.memberId, "peon-opp", "A call in another app.");
    await notify.add({ personId, app: "friends", eventType: "info", subjectId: "standalone", urgency: "normal", summary: "A standalone update." }, clock.now());

    const friendsRuntime = service.runtimeFor("friends")!, peonRuntime = service.runtimeFor("peon")!;
    await friendsRuntime.projectNotifications();
    await peonRuntime.projectNotifications();
    await sql`update network.messages set notification_recorded_at=null where id in ('old-opp-text','walk-two')`;
    await friendsRuntime.projectNotifications();
    const projected = await sql`select subject_id,delivery_id from notify.inbox_items where person_id=${personId}
      and delivery_id in ('net:old-opp-text','net:walk-one','net:walk-two') order by delivery_id`;
    expect([...projected]).toEqual([
      { subject_id: "same-opp", delivery_id: "net:old-opp-text" },
      { subject_id: "same-opp#walk-one", delivery_id: "net:walk-one" },
      { subject_id: "same-opp#walk-two", delivery_id: "net:walk-two" },
    ]);
    expect(await sql`select id from notify.inbox_items where subject_id='same-opp#old-opp-text'`).toEqual([]);
    expect(await sql`select delivery_id from notify.deliveries where person_id=${personId} and counts_toward_cap
      and delivery_id in ('net:walk-one','net:walk-two')`).toHaveLength(2);

    const [discarded] = await sql`select id from notify.inbox_items where subject_id='closed-friends'`;
    const limited = "T-7F3K9Q";
    const passes = () => true;
    await notify.store.insertToken({ token: limited, personId, itemIds: [`inb_${discarded.id}`], issuedAt: clock.now(), expiresAt: clock.now() + MINUTE });
    expect(await service.updatesFor(personId, "friends", "claude", "T-ZZZZZZ", passes)).toEqual([]);
    expect(await sql`select id from notify.inbox_items where person_id=${personId} and seen_at is not null`).toEqual([]);
    expect(await service.updatesFor(personId, "friends", "claude", limited, passes)).toEqual([]);
    expect((await sql`select seen_at from notify.inbox_items where id=${discarded.id}`)[0].seen_at).toBeInstanceOf(Date);
    const visible = await service.updatesFor(personId, "friends", "claude", undefined, passes);
    expect(visible.map(item => item.summary)).toEqual([
      "An earlier walk reminder.", "The walk is tomorrow.", "A standalone update.", "The walk is in two hours.",
    ]);
    expect(await service.updatesFor(personId, "friends", "web", undefined, passes)).toEqual([]);
    expect((await sql`select seen_at from notify.inbox_items where subject_id='peon-opp#other-app-text'`)[0].seen_at).toBeNull();
    expect((await service.updatesFor(personId, "peon", "claude", undefined, passes)).map(item => item.summary)).toEqual(["A call in another app."]);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
