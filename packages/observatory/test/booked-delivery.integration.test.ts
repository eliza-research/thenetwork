import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import { OutboundQueue, recipientWindowHasher } from "../../blooio/src/outbound-queue.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { currentBookingReceipt } from "../../network/service/channel.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";
import { ConsentNetwork } from "../../network/src/network.ts";
import { rescheduleUpdateKey } from "../../network/src/rescheduling.ts";
import { DEFAULT_START, generatePersonas, World } from "../../sim/src/index.ts";
import { Projector } from "../src/projector.ts";
import { RealSource } from "../src/sources/real.ts";
import { Store, emptyCounters } from "../src/store.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("a booking receipt is current only for the exact recipient, notice and schedule revision", async () => {
  // spec/consoleMemberView.md, "A booked plan shows only receipts for its current notice"
  const url = await testDb();
  const sql = new SQL(url);
  const real = new RealSource({ url, service: false, pollMs: HOUR, pushMs: HOUR });
  const at = Date.UTC(2026, 9, 9, 16), original = at + 2 * DAY, changed = original + DAY;
  const id = "fixture-booking";
  const roster = ["recorded", "withheld", "dry"];
  const clock = new SimClock(at);
  const body = "A public walk is booked.";
  const queue = new OutboundQueue({
    sql, app: "ntwrk", clock, line: "fixture-line", checks: { live: () => false },
    recipientWindowKey: recipientWindowHasher("synthetic-recipient-window"),
    provider: { kind: "sim", async send() { throw Error("Use collected receipts"); } },
  });
  async function saveBooking(meetingAt: number, scheduleRevision: number) {
    const state = { opps: [{ id, meetingAt, scheduleRevision, lane: "Cofounder", participants: roster,
      status: roster.map(member => [member, "yes"]), bookedAt: Object.fromEntries(roster.map(member => [member, at])),
    }] };
    await sql`insert into network.network_state(id,state,saved_at,version) values ('ntwrk:nyc',${state}::jsonb,${new Date(at)},${scheduleRevision + 1})
      on conflict (id) do update set state=excluded.state, version=excluded.version`;
    await sql`update network.opportunities set meeting_at=${new Date(meetingAt)} where app_id='ntwrk' and id=${id}`;
  }
  async function recordNotice(key: string, member: string, type: "proposal" | "scheduling", collect = true) {
    await sql`insert into network.messages (app_id,id,member_id,opportunity_id,direction,type,body,status,ts)
      values ('ntwrk',${key},${member},${id},'outbound',${type},${body},${collect ? "collected" : "dry_run"},${new Date(at)})`;
    if (collect) await queue.recordCollected(sql, [{ id: key, memberId: member, to: "+12125550140", kind: "transactional", text: body }]);
  }
  const told = () => real.state().opportunities.find(o => o.id === id)?.booked?.told ?? {};
  try {
    await sql`insert into network.opportunities(app_id,id,kind,state,source,city,objective)
      values ('ntwrk',${id},'intro','SCHEDULED','network','nyc','A public walk')`;
    for (const member of roster) {
      await sql`insert into network.members(app_id,id,name,home_city,age) values ('ntwrk',${member},'Synthetic member','nyc',30)`;
      await sql`insert into network.participations(app_id,opportunity_id,member_id,role,status)
        values ('ntwrk',${id},${member},'participant','confirmed')`;
      await recordNotice(member + "-notice", member, "proposal", member !== "dry");
    }
    await saveBooking(original, 0);
    await queue.collectedReceipt(sql, ["recorded-notice"], "accepted", at + HOUR);
    await real.init();
    expect(real.state().env.error).toBeUndefined();
    expect(told()).toEqual({ recorded: at + HOUR });

    await saveBooking(changed, 1);
    const currentKey = "cofounder-intro:reveal:" + rescheduleUpdateKey(id, 1, "recorded");
    const wrongLane = rescheduleUpdateKey(id, 1, "withheld");
    await recordNotice(currentKey, "recorded", "scheduling");
    await recordNotice(wrongLane, "withheld", "scheduling");
    await queue.collectedReceipt(sql, [wrongLane], "accepted", at + 2 * HOUR);
    await real.control({ type: "refresh" });
    expect(told()).toEqual({});

    const revisedAt = at + 3 * HOUR;
    await queue.collectedReceipt(sql, [currentKey], "accepted", revisedAt);
    expect((await currentBookingReceipt(sql, "ntwrk", id, "recorded", 1, "Cofounder"))?.sent_at?.getTime()).toBe(revisedAt);
    await real.control({ type: "refresh" });
    expect(told()).toEqual({ recorded: revisedAt });
    await sql.begin(async tx => {
      await tx`set local role network_observatory_ntwrk`;
      expect(await tx`select * from network.booking_receipts_ntwrk`).toEqual([{
        app_id: "ntwrk", opportunity_id: id, member_id: "recorded", booking_at: new Date(changed),
        revision: 1, lane: "Cofounder", received_at: new Date(revisedAt), simulated: false,
      }]);
    });
    await expect(sql.begin(async tx => {
      await tx`set local role network_observatory_ntwrk`;
      return tx`select * from network.booking_receipts_friends`;
    })).rejects.toMatchObject({ code: "42501" });
  } finally {
    await real.dispose();
    await sql.close();
    await dropTestDb();
  }
}, 60_000);

test("the game projects booking receipt times only for delivered notices", async () => {
  const seed = 4;
  const personas = generatePersonas({ n: 80, seed, joinSpreadDays: 7, cityWeights: { nyc: 1, sf: 0 } });
  const store = new Store({ mode: "game", label: "Synthetic", dataset: "Synthetic",
    capabilities: { canStep: true, canIntervene: false, hiddenTruth: true, readOnly: false } },
  { now: DEFAULT_START, start: DEFAULT_START, day: 1, playing: false, speed: 0, waitingForPlayer: false });
  for (const p of personas) store.upsertMember({
    id: p.id, name: p.name, city: p.homeCity, joined: false, minor: p.public.claimedAge < 18, state: "not_joined", counters: emptyCounters(),
  });
  const projector = new Projector(store);
  const world = new World({ seed, personas, days: 10, app: "ntwrk", failureRate: 0.25, network: new ConsentNetwork({ seed, inlineJudge: simulatedReviewJudge({ exceptions: false }) }), writeLog: false,
    onRecord: record => projector.apply(record) });
  await world.run();
  let delivered = 0, failed = 0;
  for (const msg of world.channel.all()) {
    const booking = msg.meta?.booked;
    if (!booking) continue;
    const opportunity = store.opps.get(booking.proposalId);
    const when = opportunity?.booked?.told[msg.memberId];
    if (msg.status === "failed") { failed++; expect(when).not.toBe(msg.ts); }
    if (msg.status === "delivered" && booking.at === opportunity?.meetingAt) { delivered++; expect(when).toBe(msg.ts); }
  }
  expect(failed).toBeGreaterThan(0);
  expect(delivered).toBeGreaterThan(0);
}, 30_000);
