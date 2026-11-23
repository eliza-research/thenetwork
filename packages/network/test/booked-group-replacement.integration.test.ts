import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, type TurnReceiptRequest, type TurnRequest, type TurnResponse } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import type { ReviewItem } from "../src/network.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test("a booked group that continues after a withdrawal records only its active participants", async () => {
  const planned = ["ana", "ben", "cy", "dee"];
  const remaining = planned.slice(0, 3);
  const world = new Mini(planned.map(id => ({
    id, name: id, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
  })), { inlineJudge: holdEveryItem.inline, growth: false });
  await world.onboard(...planned);
  const id = world.propose(planned);
  expect(await world.runUntil(() => world.net.reviewQueue().some(item => item.oppId === id))).toBe(true);
  expect(world.net.decide(id, "approve", { reviewer: "staff" })).toEqual({ ok: true });
  await world.answerProbes(planned);
  expect(world.meetings).toMatchObject([{ participants: planned }]);

  await world.say("dee", "I can't make it anymore.");
  const opportunity = () => world.net.exportState().opps.find(item => item.id === id)!;
  expect(opportunity()).toMatchObject({ stage: "scheduled", participants: planned });
  expect(opportunity().status.filter(([, status]) => status === "yes").map(([member]) => member)).toEqual(remaining);
  for (const member of remaining) await world.say(member, "Thanks, still coming.");
  world.restart();

  const feedbackRecipients = () => world.sent.filter(item =>
    item.meta.type === "feedback_request" && item.meta.proposalId === id).map(item => item.to);
  await world.run(opportunity().meetingAt! - world.clock.now());
  for (const member of remaining) await world.say(member, "Thanks.");
  expect(await world.runUntil(() => feedbackRecipients().length >= remaining.length, DAY)).toBe(true);
  expect(feedbackRecipients().toSorted()).toEqual(remaining);
  for (const member of remaining) await world.say(member, member === "ben" ? "I couldn't make it." : "It was great!");

  expect(opportunity()).toMatchObject({ stage: "done", participants: planned, feedbackFrom: remaining, post: {
    ana: { came: true }, ben: { came: false }, cy: { came: true },
  } });
  expect(world.net.engineInput(world.clock.now()).feedback?.some(item => item.from === "dee" || item.about === "dee")).toBe(false);
  const rows = () => world.net.exportState().interactions.filter(item => item.id.startsWith(`${id}:fb:`));
  const history = [
    { id: `${id}:fb:ana`, participants: remaining, outcome: "completed" },
    { id: `${id}:fb:ben`, participants: remaining, outcome: "no_show" },
    { id: `${id}:fb:cy`, participants: remaining, outcome: "completed" },
  ];
  expect(rows()).toMatchObject(history);
  world.restart();
  expect(rows()).toMatchObject(history);

  const legacy = world.net.exportState();
  for (const item of legacy.interactions) if (item.id.startsWith(`${id}:fb:`)) item.participants = planned;
  world.net.importState(legacy);
  expect(rows()).toMatchObject(history);
  expect(opportunity().participants).toEqual(planned);

  world.net.forgetMember("dee");
  world.restart();
  expect(opportunity()).toBeUndefined();
  expect(rows()).toMatchObject(history);
  world.net.forgetMember("ben");
  expect(rows()).toEqual([]);
});

const scenes = ["fresh consent", "expired delivery", "withdrawn identity", "deferred booking roster", "changed queued availability", "expired generic invite"] as const;

test.runIf(pgAvailable).each(scenes)("a reviewed Friends group keeps current admission (%s)", async scene => {
  // spec/bookedGroupReplacement.md, "An accepted withdrawal can start recovery after the old booking closes"
  // spec/bookedGroupReplacement.md, "A replacement uses a current reviewed alternate and a viable slot"
  // spec/bookedGroupReplacement.md, "The next plan needs fresh review and all three separate acceptances"
  const url = await migratedDb(`booked_group_${scene.replaceAll(" ", "_")}`);
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 19));
  const app = APPS.friends;
  const networkId = "friends:nyc";
  const secret = "synthetic-booked-group-replacement-turn-secret";
  const people = [
    { name: "Ari", e164: "+12125550371" },
    { name: "Blair", e164: "+12125550372" },
    { name: "Charlie", e164: "+12125550373" },
    { name: "Drew", e164: "+12125550374" },
    { name: "Elliot", e164: "+12125550375" },
  ] as const;
  const calls: SendRequest[] = [];
  const makeService = () => {
    const adapter = new BlooioAdapter({ app: app.id, from: "+12125550370", clock, log: () => {}, provider: {
      kind: "sim", send: async request => {
        calls.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
      },
    } });
    return { adapter, service: new NetworkService({
      url, clock, log: () => {}, photoStorage: null, adapter: () => adapter,
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, reviewJudge: holdEveryItem.judge,
      networks: [{ id: networkId }], devMatching: [networkId],
      network: { plans: false, growth: false, maxNewPerDay: 0, plansConfig: { probeWindowHours: 6 } }, tokens: "reviewer@friends:group-reviewer",
    }) };
  };
  let { adapter, service } = makeService();
  const runtime = () => service.runtimes.get(networkId)!;
  const booking = async (id: string) => (await runtime().pg.load())?.opps.find(opportunity => opportunity.id === id);
  const reviewUrl = "http://127.0.0.1/apps/friends/review";
  const staff = { authorization: "Bearer group-reviewer", "content-type": "application/json" };
  const awaitingReview = async () => {
    const response = await service.fetch(new Request(reviewUrl, { headers: staff }));
    expect(response.status).toBe(200);
    return ((await response.json()) as { items: ReviewItem[] }).items;
  };
  const approve = (review: ReviewItem, revision = review.revision) => service.fetch(new Request(`${reviewUrl}/${encodeURIComponent(review.oppId)}`, {
    method: "POST", headers: staff, body: JSON.stringify({ decision: "approve", revision }),
  }));
  const post = async (path: string, id: string, value: TurnRequest | TurnReceiptRequest) => {
    const body = JSON.stringify(value);
    const auth = await svcSign(secret, { method: "POST", path, id, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body }));
  };
  const turn = (messageId: string, from: string, text: string): TurnRequest => ({
    app: app.id, from, messageId, text, channel: "blooio", transport: "imessage", to: null, receivedAt: clock.now(),
  });
  const answer = async (input: TurnRequest) => {
    const response = await post(TURN_PATH, input.messageId, input);
    const outcome = await response.json() as TurnResponse;
    expect(response.status, `${input.messageId}: ${JSON.stringify(outcome)}`).toBe(200);
    expect(outcome.outcome).toBe("handled");
    if (outcome.outcome === "handled" && outcome.replyIds.length) {
      const receipt = await post(TURN_RECEIPT_PATH, `${input.messageId}:receipt`, {
        channel: input.channel, messageId: input.messageId, replyIds: outcome.replyIds,
        outcome: "accepted", providerMessageIds: outcome.replyIds.map(id => `sim:${id}`), historyRecorded: true,
      });
      expect(receipt.status).toBe(200);
    }
    return outcome;
  };
  const messages = (opportunity: string, type: string) => sql<{ id: string }[]>`select id from network.messages where app_id=${app.id}
    and direction='outbound' and opportunity_id=${opportunity} and type=${type}`;
  const delivered = async (opportunity: string, type: string) => {
    const keys = new Set((await messages(opportunity, type)).map(row => `tn:${row.id}`));
    return calls.filter(call => keys.has(call.idempotencyKey));
  };

  try {
    await service.start();
    const members = [];
    for (const person of people) {
      const joined = await service.accounts.join(app, { e164: person.e164, personId: null }, {
        firstName: person.name, age: 30, homeCity: "nyc", neighborhood: "Inwood", interests: ["hiking"],
        consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture join refused for ${person.name}`);
      members.push({ id: joined.membership.memberId, name: person.name, age: 30 });
      await adapter.engaged(person.e164);
      await sql`insert into network.facets (app_id,id,member_id,kind,value,tags,privacy_scope,provenance,confidence)
        values (${app.id},${`${joined.membership.memberId}:verify`},${joined.membership.memberId},'fact','Verified',
          ${[person.name === "Drew" ? "verify:liveness:fail" : "verify:liveness:pass", "verify:age:pass"]},'agent_private','said',1)`;
    }
    const ids = members.map(member => member.id);
    const [ari, blair, charlie, drew, elliot] = ids;
    if (!ari || !blair || !charlie || !drew || !elliot) throw new Error("The five fixture members did not join");
    const checksDisclosure = scene === "withdrawn identity";
    const deferBooking = scene === "deferred booking roster";
    const fourSeats = checksDisclosure || deferBooking;
    const invited = fourSeats ? [ari, blair, charlie, elliot] : [ari, blair, charlie];
    const quietAri = () => sql`update network.members set prefs=prefs || ${{ quietHours: [14, 15] }}::jsonb
      where app_id=${app.id} and id=${ari}`;
    const freshRoster = [ari, blair, elliot];
    const now = clock.now();
    const fixture = new Mini(members, { app: app.id, plans: false, growth: false });
    fixture.clock.set(now);
    await fixture.onboard(...ids);
    const stated = { windows: [{ start: now, end: now + 7 * DAY }], at: now - 1, until: now + 7 * DAY };
    const plan: plans.Plan = {
      id: "booked_group_replacement_original", city: "nyc", activityId: "day_hike", venueId: "inwood-hill",
      place: { name: "Inwood Hill Park", area: "Inwood" }, window: { start: now + 5 * DAY, end: now + 5 * DAY + 4 * HOUR },
      invited, alternates: fourSeats ? [] : [drew, elliot], partner: false, size: { min: 3, target: invited.length, max: invited.length }, quorum: 3,
      probeDeadline: now + (scene === "expired generic invite" ? 2 * HOUR : 3 * DAY),
      score: 0.6, u: {}, familiar: {}, createdAt: now, category: "social",
    };
    await runtime().unitOfWork(net => {
      net.importState({ ...net.exportState(), members: fixture.net.exportState().members.map(member => ({ ...member, stated })) });
      net["submitPlan"](plan, now);
    });
    await service.reviewJudgeTick();
    const [original] = await awaitingReview();
    if (!original) throw new Error("The original plan did not reach staff review");
    expect(original.proposal.participants).toEqual(invited);
    expect(await delivered(original.oppId, "plan_probe")).toEqual([]);
    if (scene === "changed queued availability" || scene === "expired generic invite") await adapter.queue.setLineSafety("review");
    expect((await approve(original)).status).toBe(200);
    if (scene === "expired generic invite") {
      // The queued messages still have delivery time left, but the reviewed probe deadline has arrived.
      const waiting = await messages(original.oppId, "plan_probe");
      expect(waiting).toHaveLength(3);
      expect(await delivered(original.oppId, "plan_probe")).toEqual([]);
      clock.set(plan.probeDeadline);
      await adapter.queue.setLineSafety(undefined);
      await runtime().deliver();
      expect((await booking(original.oppId))?.stage).toBe("probing");
      for (const row of waiting) expect(await adapter.queue.statusOf(row.id)).toBe("suppressed_ineligible");
      expect(await delivered(original.oppId, "plan_probe")).toEqual([]);
      return;
    }
    if (scene === "changed queued availability") {
      // spec/planDispatch.md, "Recheck the member's current availability before contacting them"
      const waiting = await messages(original.oppId, "plan_probe");
      expect(waiting).toHaveLength(3);
      expect(await delivered(original.oppId, "plan_probe")).toEqual([]);
      const changedAt = clock.now() + 1;
      clock.set(changedAt);
      await runtime().unitOfWork(net => {
        const saved = net.exportState();
        const member = saved.members.find(candidate => candidate.id === ari)!;
        member.stated = { at: changedAt, until: now + 7 * DAY,
          windows: [{ start: plan.window.end + HOUR, end: plan.window.end + 5 * HOUR }] };
        net.importState(saved);
      });
      clock.set(changedAt + HOUR);
      await adapter.queue.setLineSafety(undefined);
      await runtime().deliver();
      const [withheld] = await sql`select outbound.status,outbound.attempts from platform.outbound outbound join network.messages msg
        on msg.app_id=outbound.app_id and msg.id=outbound.id and msg.member_id=outbound.member_id
        where outbound.app_id=${app.id} and outbound.member_id=${ari} and msg.opportunity_id=${original.oppId} and msg.type='plan_probe'`;
      expect(withheld).toEqual({ status: "suppressed_ineligible", attempts: 0 });
      expect((await delivered(original.oppId, "plan_probe")).map(call => call.to).sort()).toEqual([people[1].e164, people[2].e164]);
      expect((await booking(original.oppId))?.planRun?.answers[ari]).toBe("pending");
      await runtime().tick();
      const reconciled = await booking(original.oppId);
      expect(reconciled?.planRun?.answers).toMatchObject({ [ari]: "no", [elliot]: "pending" });
      expect((await delivered(original.oppId, "plan_probe")).map(call => call.to).sort()).toEqual([people[1].e164, people[2].e164, people[4].e164]);
      return;
    }
    const probed = people.filter((_, index) => invited.includes(ids[index]!));
    expect((await delivered(original.oppId, "plan_probe")).map(call => call.to).sort()).toEqual(probed.map(person => person.e164));
    const firstOriginalYes = turn("original-ari-yes", people[0].e164, "yes");
    const firstOriginalReply = await answer(firstOriginalYes);
    await answer(turn("original-blair-yes", people[1].e164, "yes"));
    if (deferBooking) await quietAri();
    if (checksDisclosure) await adapter.lineSafety("review");
    const bookedYes = turn("original-charlie-yes", people[2].e164, "yes");
    const bookedReply = await answer(bookedYes);
    if (deferBooking) {
      // spec/meetingReschedule.md, "A named booking notice still needs every recorded seat"
      await answer(turn("original-elliot-late-yes", people[4].e164, "yes"));
      const booked = await booking(original.oppId);
      expect(booked).toMatchObject({ stage: "scheduled", bookedTold: expect.arrayContaining([blair, charlie, elliot]) });
      expect(booked?.bookedTold).not.toContain(ari);
      expect((await runtime().pg.load())?.deferred).toContainEqual(expect.objectContaining({
        memberId: ari, kind: "reveal", body: expect.stringContaining("Charlie"),
      }));
      expect(await delivered(original.oppId, "proposal")).toEqual([expect.objectContaining({ to: people[1].e164 })]);
      // A saved assent without the current participant row cannot authorize a named reply.
      await sql`update network.participations set role='alternate' where app_id=${app.id} and opportunity_id=${original.oppId} and member_id=${ari}`;
      const replay = await post(TURN_PATH, bookedYes.messageId, bookedYes);
      expect(replay.status).toBe(409);
      expect(await replay.json()).toMatchObject({ error: "turn_booking_changed" });
      await sql`update network.participations set role='participant' where app_id=${app.id} and opportunity_id=${original.oppId} and member_id=${ari}`;
      await answer(turn("booked-charlie-steps-out", people[2].e164, "I can't make it."));
      const ongoing = await booking(original.oppId);
      expect(ongoing).toMatchObject({ stage: "scheduled" });
      expect(ongoing?.status.filter(([, status]) => status === "yes").map(([id]) => id).sort()).toEqual([...freshRoster].sort());
      clock.advance(HOUR);
      await runtime().tick();
      const refreshed = (await delivered(original.oppId, "proposal")).filter(call => call.to === people[0].e164);
      expect(refreshed.map(call => call.text)).toEqual([expect.stringContaining("with Blair, Elliot")]);
      expect(refreshed[0]?.text).not.toContain("Charlie");
      const [recorded] = await sql`select booking_roster_member_ids from network.messages
        where app_id=${app.id} and id=${refreshed[0]?.idempotencyKey.slice(3)} and member_id=${ari}`;
      expect(recorded?.booking_roster_member_ids).toEqual(freshRoster);
      return;
    }
    if (checksDisclosure) {
      // spec/meetingReschedule.md, "A named booking notice still needs every recorded seat"
      // The reviewed fourth invitee accepts after booking. Their collected reply still names Charlie.
      const lateYes = turn("original-elliot-late-yes", people[4].e164, "yes");
      const late = await post(TURN_PATH, lateYes.messageId, lateYes);
      expect(late.status).toBe(200);
      expect(await late.json()).toMatchObject({ outcome: "handled", replies: [expect.stringContaining("Charlie")] });
      expect(await booking(original.oppId)).toMatchObject({ stage: "scheduled", bookedTold: expect.arrayContaining(invited) });
      const unchanged = await post(TURN_PATH, bookedYes.messageId, bookedYes);
      expect(unchanged.status).toBe(200);
      expect(await unchanged.json()).toEqual(bookedReply);
      // spec/outboundAdmission.md, "Recheck blocks between the participants before contact"
      // The exact notice includes Ari and Blair even though it is returned to Elliot.
      const [block] = await sql<{ from_person: string; to_person: string }[]>`insert into platform.person_blocks (from_person,to_person,origin_app,at)
        select a.person_id,b.person_id,'ntwrk',${new Date(clock.now())} from platform.memberships a, platform.memberships b
        where a.app_id=${app.id} and a.member_id=${ari} and b.app_id=${app.id} and b.member_id=${blair} returning from_person,to_person`;
      if (!block) throw new Error("Fixture could not commit the cross-app block");
      const refused = await post(TURN_PATH, lateYes.messageId, lateYes);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({ error: "turn_opportunity_blocked", retryable: false });
      await sql`delete from platform.person_blocks where from_person=${block.from_person} and to_person=${block.to_person}`;
      const [held] = await sql`select queued.id,queued.body,queued.status,queued.attempts,msg.booking_roster_member_ids from network.messages msg
        join platform.outbound queued on queued.app_id=msg.app_id and queued.id=msg.id and queued.member_id=msg.member_id
        where msg.app_id=${app.id} and msg.opportunity_id=${original.oppId} and msg.type='proposal' and msg.member_id=${ari}`;
      expect(held).toMatchObject({ body: expect.stringContaining("Charlie"), attempts: 0, status: "retry_scheduled",
        booking_roster_member_ids: [ari, blair, charlie] });
      await answer(turn("booked-charlie-steps-out", people[2].e164, "I can't make it."));
      const remaining = await booking(original.oppId);
      expect(remaining).toMatchObject({ stage: "scheduled" });
      expect(remaining?.status.filter(([, status]) => status === "yes").map(([id]) => id).sort()).toEqual([...freshRoster].sort());
      await adapter.lineSafety(undefined);
      clock.advance(HOUR);
      await runtime().deliver();
      const [settled] = await sql`select status,attempts from platform.outbound where id=${held.id}`;
      const replay = await post(TURN_PATH, lateYes.messageId, lateYes);
      expect({ ...settled, providers: calls.filter(call => call.idempotencyKey === `tn:${held.id}`).length, replay: replay.status })
        .toEqual({ status: "suppressed_ineligible", attempts: 0, providers: 0, replay: 409 });
      expect(await replay.json()).toMatchObject({ error: "turn_booking_changed" });
      const person = await service.accounts.personFor(people[2].e164);
      expect(await service.accounts.leave(app, { e164: people[2].e164, personId: person!.id })).toBe(true);
      const [erased] = await sql`select msg.body,msg.booking_roster_member_ids,queued.body as queued_body from network.messages msg
        join platform.outbound queued on queued.app_id=msg.app_id and queued.id=msg.id where msg.id=${held.id}`;
      expect(erased).toEqual({ body: "Booking notice erased.", booking_roster_member_ids: null, queued_body: null });
      const [cleared] = await sql`select response,replies from platform.inbound where id=${`msg:blooio:${lateYes.messageId}`}`;
      expect(cleared).toEqual({ response: null, replies: [] });
      return;
    }
    expect(await booking(original.oppId)).toMatchObject({ stage: "scheduled", bookedTold: expect.arrayContaining(invited) });

    clock.advance(DAY);
    const withdrawal = turn("withdrawal", people[2].e164, "I can't make it.");
    const withdrawn = await answer(withdrawal);
    expect(await booking(original.oppId)).toMatchObject({ stage: "closed", closedFrom: "scheduled" });
    const cancellations = await delivered(original.oppId, "cancellation");
    expect(cancellations.map(call => call.to).sort()).toEqual(people.slice(0, 2).map(person => person.e164));
    for (const cancel of cancellations) {
      expect(cancel.text).toContain("off now");
      expect(cancel.text).not.toMatch(/\b(?:Ari|Blair|Charlie|Drew|Elliot)\b/i);
    }
    await service.reviewJudgeTick();
    const reviews = await awaitingReview();
    expect(reviews).toHaveLength(1);
    const replacement = reviews[0]!;
    expect(replacement.oppId).not.toBe(original.oppId);
    expect(replacement.proposal.participants).toEqual(expect.arrayContaining(freshRoster));
    expect(replacement.proposal.participants).toHaveLength(freshRoster.length);
    expect(await booking(replacement.oppId)).toMatchObject({ stage: "review", replacementFor: original.oppId });
    expect(await delivered(replacement.oppId, "plan_probe")).toEqual([]);
    expect(await answer(withdrawal)).toEqual(withdrawn);
    expect(await awaitingReview()).toEqual(reviews);
    expect(await delivered(original.oppId, "cancellation")).toHaveLength(2);

    await service.close();
    ({ adapter, service } = makeService());
    await service.start();
    expect(await awaitingReview()).toEqual(reviews);
    expect((await approve(replacement, replacement.revision + 1)).ok).toBe(false);
    expect(await delivered(replacement.oppId, "plan_probe")).toEqual([]);
    // Each survivor has received a booking and a cancellation since their last turn.
    for (const [index, person] of people.slice(0, 2).entries()) {
      const checkIn = turn(`cancellation-ack-${index}`, person.e164, "Thanks for the update.");
      expect((await post(TURN_PATH, checkIn.messageId, checkIn)).status).toBe(200);
    }
    if (scene === "expired delivery") await adapter.queue.setLineSafety("review");
    expect((await approve(replacement)).status).toBe(200);
    const deferred = await sql<{ until: string }[]>`select payload->>'until' as until from network.events
      where app_id=${app.id} and object_id=${replacement.oppId} and type='send_deferred' and payload->>'reason'='send_window'`;
    if (deferred.length) {
      clock.set(Math.max(clock.now(), ...deferred.map(event => Number(event.until))));
      await runtime().tick();
    }
    if (scene === "expired delivery") {
      const waiting = await messages(replacement.oppId, "plan_probe");
      expect(waiting).toHaveLength(3);
      expect(await delivered(replacement.oppId, "plan_probe")).toEqual([]);
      for (const row of waiting) expect(await adapter.queue.statusOf(row.id)).toBe("retry_scheduled");
      const premature = turn("yes-before-delivery", people[4].e164, "yes");
      const earlyReply = await post(TURN_PATH, premature.messageId, premature);
      expect(earlyReply.status, JSON.stringify(await earlyReply.json())).toBe(200);
      const pending = await booking(replacement.oppId);
      if (!pending?.plan) throw new Error("The queued replacement has no plan deadline");
      expect(pending.stage).toBe("probing");
      expect(pending.planRun?.answers).toEqual(Object.fromEntries(freshRoster.map(member => [member, "pending"])));
      clock.set(pending.plan.probeDeadline);
      // Advance the clock without a lifecycle tick, so only final queue admission can stop these sends.
      await adapter.queue.setLineSafety(undefined);
      await runtime().deliver();
      for (const row of waiting) expect(await adapter.queue.statusOf(row.id)).toBe("suppressed_ineligible");
      expect(await delivered(replacement.oppId, "plan_probe")).toEqual([]);
      return;
    }
    const probes = await delivered(replacement.oppId, "plan_probe");
    expect(probes.map(call => call.to).sort()).toEqual([people[0].e164, people[1].e164, people[4].e164]);
    for (const probe of probes) {
      expect(probe.text).toContain("Inwood Hill Park");
      expect(probe.text).not.toMatch(/\b(?:Ari|Blair|Charlie|Drew|Elliot)\b/i);
    }
    expect(await booking(replacement.oppId)).toMatchObject({ stage: "probing" });
    expect(await answer(firstOriginalYes)).toEqual(firstOriginalReply);
    const delayed = { ...turn("old-yes-arrives-late", people[0].e164, "yes"), receivedAt: now };
    const delayedReply = await post(TURN_PATH, delayed.messageId, delayed);
    expect(delayedReply.status, JSON.stringify(await delayedReply.json())).toBe(200);
    expect((await booking(replacement.oppId))?.planRun?.answers[ari]).toBe("pending");
    await answer(turn("replacement-elliot-yes", people[4].e164, "yes"));
    await answer(turn("replacement-blair-yes", people[1].e164, "yes"));
    expect(await booking(replacement.oppId)).toMatchObject({ stage: "probing" });
    expect(await delivered(replacement.oppId, "proposal")).toEqual([]);
    const booked = await answer(turn("replacement-ari-yes", people[0].e164, "yes"));
    expect(booked).toMatchObject({ replies: expect.arrayContaining([expect.stringContaining("You're in:")]) });
    expect(await booking(replacement.oppId)).toMatchObject({ stage: "scheduled", bookedTold: expect.arrayContaining(freshRoster) });
    const reveals = await delivered(replacement.oppId, "proposal");
    expect(reveals.map(call => call.to).sort()).toEqual([people[1].e164, people[4].e164]);
    if (booked.outcome !== "handled") throw new Error("The booking reply was not collected");
    for (const text of [...booked.replies, ...reveals.map(call => call.text)]) expect(text).not.toMatch(/\b(?:Charlie|Drew)\b/i);
    expect(await booking(original.oppId)).toMatchObject({ stage: "closed" });
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
