import { expect, test } from "vitest";
import { MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

test.skipIf(!pgAvailable)("signed participation controls commit with the reply and stay in their app", async () => {
  // spec/participationControls.md, "Only the current member can change settings in the current app"
  const url = await migratedDb("participation_controls");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const phone = "+12125550173";
  const secret = "synthetic-participation-controls-fixture";
  let service: NetworkService | undefined;
  const start = async () => {
    service = new NetworkService({
      url, clock, log: () => {}, photoStorage: null, adapter: () => new DryRunAdapter(() => {}),
      env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
      networks: [{ id: "friends:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }],
    });
    await service.start();
  };
  let turnCount = 0;
  const turn = (app: TurnRequest["app"], text: string, from = phone): TurnRequest => {
    clock.advance(MINUTE);
    return { app, text, from, messageId: `controls-${++turnCount}`, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
  };
  const send = async (input: TurnRequest) => {
    const body = JSON.stringify(input);
    const auth = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service!.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body }));
  };
  const say = (app: TurnRequest["app"], text: string) => send(turn(app, text));
  const member = async (app: "friends" | "peon") => (await sql`select * from network.members where app_id=${app}`)[0];

  try {
    await start();
    const unknown = "+12125550174";
    const unjoined = await send(turn("friends", "Pause matching", unknown));
    expect(await unjoined.json()).toMatchObject({ outcome: "handled", reason: "participation_controls", replies: [] });
    expect(await service!.accounts.personFor(unknown)).toBeUndefined();
    for (const [app, keyword] of [["friends", "friends.help"], ["peon", "peon.biz"]] as const) {
      for (const message of [keyword, "Ari, 29", "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) {
        expect((await say(app, message)).status).toBe(200);
      }
    }
    const peersBefore = (await member("peon")).prefs;
    expect((await member("friends")).prefs).toMatchObject({ categoriesOptIn: ["social", "hobby"], quietHours: [21, 9], romanceOptIn: false });

    // Quiet hours use the member's local clock, with no write for an ambiguous range.
    expect(await (await say("friends", "Quiet hours 10 to 8")).json()).toMatchObject({ replies: [expect.stringContaining("Use whole local hours")] });
    expect(await (await say("friends", "Quiet hours from 22:00 to 8")).json()).toMatchObject({ replies: [expect.stringContaining("Use whole local hours")] });
    expect((await member("friends")).prefs.quietHours).toEqual([21, 9]);
    const quiet = turn("friends", "Set quiet hours from 10 pm to 8 am");
    const confirmed = await (await send(quiet)).json();
    expect(confirmed).toMatchObject({ outcome: "handled", reason: "participation_controls", replyKind: "reply",
      replies: ["Quiet hours are 22:00 to 08:00 local time for this app."] });
    expect(await (await send(quiet)).json()).toEqual(confirmed);
    expect(await sql`select id from network.events where app_id='friends' and type='member_preferences_changed'`).toHaveLength(1);

    // Only a direct signed command can change an offered category, and the other app keeps its settings.
    expect(await (await say("friends", "Turn off hobby suggestions")).json()).toMatchObject({ replies: ["Hobby suggestions are off for this app."] });
    const person = (await service!.accounts.personFor(phone))!;
    expect(await service!.submitProfile(person.id, "friends", phone, "Turn on hobby suggestions")).toBe("accepted");
    expect(await (await say("friends", "Turn on dating suggestions")).json()).toMatchObject({ replies: ["Dating suggestions are unavailable for this membership."] });
    expect((await member("friends")).prefs).toMatchObject({ categoriesOptIn: ["social"], quietHours: [22, 8], romanceOptIn: false });
    expect((await member("peon")).prefs).toEqual(peersBefore);

    expect(await (await say("friends", "Pause matching")).json()).toMatchObject({ replies: [expect.stringContaining("Matching is paused")] });
    await service!.close();
    await start();
    expect((await member("friends")).participation_state).toBe("paused");
    expect(await (await send(quiet)).json()).toEqual(confirmed);
    expect(await (await say("friends", "Resume matching")).json()).toMatchObject({ replies: [expect.stringContaining("Matching is no longer paused")] });
    expect((await member("friends")).participation_state).toBe("normal");
    expect(await (await say("friends", "Quiet hours off")).json()).toMatchObject({ replies: ["Quiet hours are off for this app."] });
    expect((await member("friends")).prefs.quietHours).toEqual([0, 0]);
    expect((await say("friends", "STOP")).status).toBe(200);
    expect((await send(quiet)).status).toBe(409);
    const stopped = await say("friends", "Resume matching");
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ outcome: "handled", accountEligible: false, replies: [] });
    expect((await member("friends")).opted_out).toBe(true);
    expect((await member("friends")).prefs.quietHours).toEqual([0, 0]);
  } finally {
    await service?.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
