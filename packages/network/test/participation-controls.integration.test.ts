import { expect, test } from "vitest";
import { DAY, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter, DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini, type Spec } from "./mini.ts";

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
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret },
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
    expect(await (await say("friends", "PAUSE")).json()).toMatchObject({ replies: [expect.stringContaining("Matching is paused")] });
    expect((await member("friends")).participation_state).toBe("paused");
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

test.skipIf(!pgAvailable)("a pause text naming a weekday stores a paused window ending that day", async () => {
  // spec/participationWindow.md, "A window starts inclusively and ends exclusively";
  // spec/product/stories.md F20, "Interpret plain-language categories, quiet hours, pause and resume"
  const url = await migratedDb("participation_pause_until");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 18, 16));
  const phone = "+12125550175";
  const secret = "synthetic-participation-pause-until-fixture";
  let service: NetworkService | undefined;
  let turnCount = 0;
  const send = async (text: string) => {
    clock.advance(MINUTE);
    const input: TurnRequest = { app: "friends", text, from: phone, messageId: `pause-until-${++turnCount}`, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const body = JSON.stringify(input);
    const auth = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service!.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body }));
  };
  const member = async () => (await sql`select * from network.members where app_id='friends'`)[0];
  try {
    service = new NetworkService({
      url, clock, log: () => {}, photoStorage: null, adapter: () => new DryRunAdapter(() => {}),
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret },
      networks: [{ id: "friends:nyc", matchingEnabled: false }],
    });
    await service.start();
    for (const message of ["friends.help", "Ari, 29", "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) {
      expect((await send(message)).status).toBe(200);
    }
    expect(await (await send("Pause my texts until Monday")).json()).toMatchObject({
      outcome: "handled", reason: "participation_controls", replies: [expect.stringContaining("until Monday")],
    });
    expect(await member()).toMatchObject({
      participation_state: "normal", opted_out: false,
      participation_window: { state: "paused", until: "2026-11-23T05:00:00.000Z" },
    });
    expect(await (await send("Resume matching")).json()).toMatchObject({ replies: [expect.stringContaining("Matching is no longer paused")] });
    expect(await member()).toMatchObject({ participation_state: "normal", participation_window: null });
    expect(await (await send("Pause matching until Friday")).json()).toMatchObject({
      outcome: "handled", reason: "participation_controls", replies: [expect.stringContaining("until Friday")],
    });
    expect(await member()).toMatchObject({
      participation_state: "normal",
      participation_window: { state: "paused", until: "2026-11-20T05:00:00.000Z" },
    });
  } finally {
    await service?.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);

test.skipIf(!pgAvailable)("a texted pause with a duration holds matching until its end and then lifts", async () => {
  // spec/participationControls.md, "Pause and resume apply immediately to matching"
  // spec/participationWindow.md, "A window starts inclusively and ends exclusively"
  const url = await migratedDb("participation_timed_pause");
  const sql = new SQL(url);
  const start = Date.UTC(2026, 10, 16, 16);
  const clock = new SimClock(start);
  const secret = "synthetic-timed-participation-pause-fixture";
  const app = APPS.friends;
  const codes = new Map<string, string>();
  const otp = { name: "fake", send: async (e164: string) => { codes.set(e164, "246810"); return { code: "246810" }; } };
  const adapter = new BlooioAdapter({ app: app.id, from: "+12125550190", clock, log: () => {}, provider: {
    kind: "sim", send: async request => ({ providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" }) } });
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: () => adapter, publicApi: { otp, minStartMs: 0, minVerifyMs: 0 },
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret }, networks: [{ id: "friends:nyc", matchingEnabled: false }],
  });
  let seq = 0;
  const turn = (from: string, text: string): TurnRequest => {
    clock.advance(MINUTE);
    return { app: app.id, channel: "blooio", from, to: null, messageId: `timed-${++seq}`, transport: "imessage", receivedAt: clock.now(), text };
  };
  const send = async (input: TurnRequest) => {
    const body = JSON.stringify(input);
    const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return (await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }))).json();
  };
  const site = async (phone: string) => {
    let cookie = "";
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await service.publicFetch(new Request(`http://127.0.0.1:8790${path}`, { method,
        headers: { host: app.domain, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
      cookie = res.headers.get("set-cookie")?.split(";")[0] ?? cookie;
      return res.json() as Promise<any>;
    };
    await call("POST", "/api/auth/otp/start", { phone });
    await call("POST", "/api/auth/otp/verify", { phone, code: codes.get(phone) });
    return (await call("GET", "/api/me")).participation;
  };
  const phone: Record<string, string> = {};
  const specs: Spec[] = [];
  try {
    await service.start();
    const rt = service.runtimes.get("friends:nyc")!;
    for (const [index, name] of ["Ari", "Bo", "Ed", "Gus", "Cy", "Di", "Fa", "Hal"].entries()) {
      phone[name] = `+121255502${index}1`;
      const joined = await service.accounts.join(app, { e164: phone[name]!, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      const id = joined.membership.memberId;
      const reviewer = { id: "timed-pause-staff", roles: ["safety" as const], grants: [{ role: "safety" as const, app: app.id }], via: "sso" as const };
      expect([await service.verify(reviewer, rt, id, "age", "pass", "fixture"), await service.verify(reviewer, rt, id, "liveness", "pass", "fixture")]).toEqual([{ ok: true }, { ok: true }]);
      specs.push({ id, name, age: 30, area: "Greenpoint", interests: ["hiking", "climbing"], skills: ["belaying"] });
    }
    const [ari, bo, ed, gus, cy, di, fa, hal] = specs.map(s => s.id);
    const row = async (id: string) => (await sql`select participation_state, participation_window from network.members where app_id=${app.id} and id=${id}`)[0]!;

    const week = turn(phone.Ari!, "Pause me for a week");
    const weekUntil = new Date(clock.now() + 7 * DAY).toISOString();
    const confirmed = await send(week);
    expect(confirmed).toMatchObject({ replies: ["Matching is paused for this app for 1 week. Say ‘resume matching’ when you're ready."] });
    expect(await send(week)).toEqual(confirmed);
    expect(await sql`select id from network.events where app_id=${app.id} and actor_id=${ari!} and type='member_state_requested'`).toHaveLength(1);
    await send(turn(phone.Bo!, "Pause matching"));
    const twoWeeks = turn(phone.Bo!, "take a break for two weeks");
    const twoWeeksUntil = new Date(clock.now() + 14 * DAY).toISOString();
    await send(twoWeeks);
    await send(turn(phone.Ed!, "Pause matching"));
    expect(await send(turn(phone.Gus!, "Pause matching until Monday"))).toMatchObject({ replies: [expect.stringContaining("until Monday")] });

    clock.set(start + DAY);
    expect(await site(phone.Ari!)).toMatchObject({ state: "paused", until: weekUntil });
    expect(await site(phone.Bo!)).toMatchObject({ state: "paused", until: twoWeeksUntil });
    expect(await site(phone.Gus!)).toMatchObject({ state: "paused", until: "2026-11-23T05:00:00.000Z" });

    const w = new Mini(specs, { app: app.id, inlineJudge: holdEveryItem.inline, plans: false, growth: false });
    w.verify(...specs.map(s => s.id));
    await w.onboard(...specs.map(s => s.id));
    const opp = { [ari!]: w.propose([ari!, cy!], { category: "hobby" }), [bo!]: w.propose([bo!, di!], { category: "hobby" }), [ed!]: w.propose([ed!, fa!], { category: "hobby" }), [gus!]: w.propose([gus!, hal!], { category: "hobby" }) };
    expect(await w.runUntil(() => Object.values(opp).every(id => w.net.reviewQueue().some(o => o.oppId === id)), 2 * DAY)).toBe(true);
    for (const id of Object.values(opp)) expect(w.net.review(id, "approve", { reviewer: "sim_staff" })).toBe(true);
    const probe = async (label: string) => {
      for (const p of Object.values(phone)) await adapter.engaged(p);
      await rt.unitOfWork(net => {
        net.importState({ ...net.exportState(), members: w.net.exportState().members, opps: w.net.exportState().opps });
        for (const id of [ari!, bo!, ed!, gus!]) rt.unit.sends.push({ id: `${label}-${id}`, memberId: id, to: phone[specs.find(s => s.id === id)!.name], kind: "proactive",
          body: "Would you like to join a climbing session?", type: "probe", oppId: opp[id], proactive: true, system: false, ts: clock.now() });
      });
      await rt.deliver();
      return Promise.all([ari!, bo!, ed!, gus!].map(id => adapter.queue.statusOf(`${label}-${id}`)));
    };
    expect(await probe("held")).toEqual(["suppressed_ineligible", "suppressed_ineligible", "suppressed_ineligible", "suppressed_ineligible"]);

    clock.set(start + 15 * DAY);
    expect(await probe("lifted")).toEqual(["sent", "sent", "suppressed_ineligible", "sent"]);
    expect(await send(turn(phone.Ari!, "Resume matching"))).toMatchObject({ replies: [expect.stringContaining("Matching is no longer paused")] });
    expect(await row(ari!)).toEqual({ participation_state: "normal", participation_window: null });
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
