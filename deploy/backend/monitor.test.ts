// The ops layer (packages/network/service: alerts, monitor, invariants, costs, run inputs; observatory
// pilot.ts) against a database of its own on the dev cluster, with a fake clock and a fake alert sink.
// No remote call: the LLM client gets a fake transport, the webhook sink a fake fetch.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, HOUR, MINUTE, OpenAILLM, setUsageObserver } from "../../packages/core/src/index.ts";
import { AlertDispatcher, WebhookSink, sinksFromEnv, type AlertSink, type SentAlert } from "../../packages/network/service/alerts.ts";
import { CostLedger, costAlerts, costSummary, rollupMessages, scopedTo } from "../../packages/network/service/costs.ts";
import { personCapViolations, recentViolations, runInvariants } from "../../packages/network/service/invariants.ts";
import { checks, Monitor } from "../../packages/network/service/monitor.ts";
import { appWiring } from "../../packages/network/service/packs.ts";
import { replayRun, runInputRow, scrubPhones, writeRunInputs } from "../../packages/network/service/runInputs.ts";
import { loadPilotInput, pilotAlerts, pilotMetrics, type PilotInput } from "../../packages/observatory/src/pilot.ts";
import { runEngine } from "../../packages/engine/src/engine.ts";
import { slopEngineInput } from "../../packages/sim/src/apps/slop/enginePack.ts";
import { generateSlopPersonas } from "../../packages/sim/src/apps/slop/persona.ts";
import { buildSlopSnapshot, SLOP_WORLD_START } from "../../packages/sim/src/apps/slop/snapshot.ts";
import { dropDb, emptyDb, pgAvailable } from "../../packages/platform/test/pg.ts";
import { migrate } from "../../packages/observatory/db/migrate.ts";

const T = 120_000;
/** The fake clock: a fixed Wednesday noon UTC, moved by the tests. */
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
let now = T0;
const clock = () => now;

class FakeSink implements AlertSink {
  readonly name = "fake";
  sent: SentAlert[][] = [];
  async send(a: SentAlert[]) { this.sent.push(a); }
  get all() { return this.sent.flat(); }
}

describe("alert dispatch (no database)", () => {
  test("fires once, dedupes, re-alerts after the interval, escalates warn to bad, resolves once", async () => {
    let t = 0;
    const sink = new FakeSink();
    const d = new AlertDispatcher({ sinks: [sink], now: () => t, reAlertMs: 6 * HOUR });
    const a = { key: "x", level: "warn" as const, text: "X" };
    expect((await d.dispatch([a])).map(s => s.state)).toEqual(["firing"]);
    t += 5 * MINUTE;
    expect(await d.dispatch([a])).toEqual([]);
    t += 6 * HOUR;
    expect((await d.dispatch([a])).map(s => s.state)).toEqual(["repeat"]);
    t += 5 * MINUTE;
    expect((await d.dispatch([{ ...a, level: "bad" }])).map(s => `${s.state}:${s.level}`)).toEqual(["firing:bad"]);
    t += 5 * MINUTE;
    expect((await d.dispatch([])).map(s => s.state)).toEqual(["resolved"]);
    expect(await d.dispatch([])).toEqual([]);
    expect(sink.sent.length).toBe(4);
    // The state survives a restart (scripts/monitor.ts --state).
    const again = new AlertDispatcher({ sinks: [sink], now: () => t, state: { y: { first: t, last: t, level: "bad" } } });
    expect(await again.dispatch([{ key: "y", level: "bad", text: "Y" }])).toEqual([]);
  });

  test("a failing sink does not stop the others; the webhook posts JSON; never an SMS sink", async () => {
    const calls: { url: string; body: any }[] = [];
    const hook = new WebhookSink("https://hooks.example.test/x", async (url, init) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response("ok"); });
    const broken: AlertSink = { name: "broken", send: async () => { throw new Error("down"); } };
    const sink = new FakeSink(), logs: string[] = [];
    const d = new AlertDispatcher({ sinks: [broken, hook, sink], now: () => 1, log: s => logs.push(s) });
    await d.dispatch([{ key: "k", level: "bad", text: "Bad thing" }]);
    expect(sink.all.length).toBe(1);
    expect(calls[0]!.body.text).toBe("BAD Bad thing");
    expect(logs.join(" ")).toContain("sink broken failed");
    const names = sinksFromEnv({ ALERT_WEBHOOK_URL: "http://plain.example.test", ALERT_FILE: undefined }, () => {}).map(s => s.name);
    expect(names).toEqual(["log"]);
    expect(sinksFromEnv({ ALERT_WEBHOOK_URL: "https://hooks.example.test/y" }, () => {}).map(s => s.name)).toEqual(["log", "webhook"]);
  });

  test("person cap: a fourth proactive send to one person inside 24 hours, across apps", () => {
    const s = (app: string, id: string, h: number) => ({ app, person: "p1", id, ts: T0 + h * HOUR });
    expect(personCapViolations([s("slop", "a", 0), s("ntwrk", "b", 1), s("slop", "c", 2)], 3)).toEqual([]);
    const v = personCapViolations([s("slop", "a", 0), s("ntwrk", "b", 1), s("slop", "c", 2), s("friends", "d", 23)], 3);
    expect(v.map(x => `${x.app}:${x.key}`)).toEqual(["friends:person_cap:d"]);
    expect(personCapViolations([s("slop", "a", 0), s("ntwrk", "b", 1), s("slop", "c", 2), s("slop", "d", 25)], 3)).toEqual([]);
  });

  test("pilot pause thresholds need enough sample", () => {
    const base: PilotInput = { now: T0, probes: [], answers: [], opps: [], members: [], optOuts: 0, mutes: 0, complaints: 0, reached: 0, reports: [], blooio: { handed: 0, failed: 0 }, worth: [] };
    const probed = (n: number, yes: number): PilotInput => {
      const probes: PilotInput["probes"] = [], answers: PilotInput["answers"] = [];
      for (let i = 0; i < n; i++) for (const m of ["a", "b"]) {
        probes.push({ oppId: `o${i}`, memberId: `${m}${i}`, at: T0 - 4 * DAY });
        answers.push({ oppId: `o${i}`, memberId: `${m}${i}`, yes: i < yes, at: T0 - 3 * DAY });
      }
      return { ...base, probes, answers };
    };
    const few = pilotMetrics(probed(10, 1)).find(m => m.key === "mutual_yes")!;
    expect([few.value, few.paused]).toEqual([0.1, undefined]);
    const many = pilotMetrics(probed(30, 3));
    expect(many.find(m => m.key === "mutual_yes")!.paused).toBe(true);
    expect(pilotAlerts("slop", many).map(a => a.key)).toEqual(["pilot_pause:mutual_yes"]);
    const ok = pilotMetrics(probed(30, 9)).find(m => m.key === "mutual_yes")!;
    expect([ok.value, ok.met, ok.paused]).toEqual([0.3, true, undefined]);
  });
});

describe.skipIf(!pgAvailable)("monitor (Postgres, fake clock, fake sink)", () => {
  let url = "";
  let sql: SQL;
  const REPORT_AT = T0 - 10 * MINUTE;
  const state = (reports: unknown[]) => ({ lastTick: T0, members: [{ id: "s5", minor: true }], reports });

  beforeAll(async () => {
    url = await emptyDb("ops_monitor");
    await migrate(url, { lockTimeout: "5s" });
    sql = new SQL({ url, max: 2 });
    const at = (ms: number) => new Date(ms);
    await sql`insert into network.members (id, app_id, name, home_city, account_status, age, joined_at) values
      ('s1', 'slop', 'A', 'nyc', 'active', 30, ${at(T0 - 20 * DAY)}), ('s2', 'slop', 'B', 'nyc', 'active', 31, ${at(T0 - 20 * DAY)}),
      ('s3', 'slop', 'C', 'nyc', 'active', 29, ${at(T0 - 20 * DAY)}), ('s4', 'slop', 'D', 'nyc', 'active', 33, ${at(T0 - 20 * DAY)}),
      ('s5', 'slop', 'E', 'nyc', 'active', 16, ${at(T0 - 20 * DAY)})`;
    // o1: a probe went out before any approval. o2: a booked plan with a minor in it. o3, o4: dates.
    await sql`insert into network.opportunities (id, app_id, kind, state, source, city, objective, created_at, meeting_at) values
      ('o1', 'slop', 'one_to_one', 'PROPOSED', 'engine', 'nyc', 'x', ${at(T0 - HOUR)}, null),
      ('o2', 'slop', 'one_to_one', 'SCHEDULED', 'engine', 'nyc', 'x', ${at(T0 - 2 * DAY)}, ${at(T0 + DAY)}),
      ('o3', 'slop', 'one_to_one', 'COMPLETED', 'engine', 'nyc', 'x', ${at(T0 - 5 * DAY)}, ${at(T0 - 2 * DAY)}),
      ('o4', 'slop', 'one_to_one', 'SCHEDULED', 'engine', 'nyc', 'x', ${at(T0 - 5 * DAY)}, ${at(T0 - 3 * DAY)})`;
    await sql`insert into network.participations (opportunity_id, member_id, app_id, role, status) values
      ('o1', 's1', 'slop', 'participant', 'checking'), ('o1', 's2', 'slop', 'participant', 'pending'),
      ('o2', 's3', 'slop', 'participant', 'confirmed'), ('o2', 's5', 'slop', 'participant', 'confirmed'),
      ('o3', 's1', 'slop', 'participant', 'attended'), ('o3', 's4', 'slop', 'participant', 'attended'),
      ('o4', 's2', 'slop', 'participant', 'confirmed'), ('o4', 's3', 'slop', 'participant', 'confirmed')`;
    await sql`insert into network.review_items (opportunity_id, app_id, queued_at, deadline, decision) values
      ('o1', 'slop', ${at(T0 - HOUR)}, ${at(T0 + 90 * MINUTE)}, null), ('o2', 'slop', ${at(T0 - 2 * DAY)}, ${at(T0 - DAY)}, 'approve'),
      ('o3', 'slop', ${at(T0 - 5 * DAY)}, ${at(T0 - 4 * DAY)}, 'approve'), ('o4', 'slop', ${at(T0 - 5 * DAY)}, ${at(T0 - 4 * DAY)}, 'approve')`;
    const msg = (id: string, member: string, type: string | null, opp: string | null, status: string, ts: number, proactive = false) =>
      ({ id, app_id: "slop", member_id: member, direction: "outbound", channel: "imessage", body: "Hi there", status, type, opportunity_id: opp, proactive, system: false, ts: at(ts) });
    const rows = [
      msg("x1", "s1", "probe", "o1", "dry_run", T0 - 30 * MINUTE, true),
      msg("x2", "s5", "proposal", "o2", "dry_run", T0 - DAY),
      // Blooio: 9 delivered and 1 failed in the last day (10%: under the 20-send floor for the failure alert).
      ...Array.from({ length: 9 }, (_, i) => msg(`d${i}`, "s3", "info", null, "delivered", T0 - 2 * HOUR)),
      msg("f1", "s3", "info", null, "failed", T0 - 2 * HOUR),
      // s4's private note in a message to s1: a send that skipped the leak guard.
      { ...msg("x3", "s1", "info", null, "dry_run", T0 - HOUR), body: "Heads up: they are recovering from a gambling addiction in Queens" },
    ];
    await sql`insert into network.facets (id, app_id, member_id, kind, value, privacy_scope, provenance) values
      ('f-s4', 'slop', 's4', 'fact', 'recovering from a gambling addiction in Queens', 'agent_private', 'said')`;
    await sql`insert into network.messages ${sql(rows)}`;
    await sql`insert into network.messages (id, app_id, member_id, direction, body, status, ts) values ('in1', 'slop', 's1', 'inbound', 'yo', 'received', ${at(T0 - DAY)})`;
    const ev = (type: string, payload: Record<string, unknown>, t: number) => ({ app_id: "slop", at: at(t), actor_type: "agent", actor_id: null, type, object_type: null, object_id: null, payload });
    await sql`insert into network.events ${sql([
      ev("probe_sent", { oppId: "o3", memberId: "s1" }, T0 - 5 * DAY), ev("probe_sent", { oppId: "o3", memberId: "s4" }, T0 - 5 * DAY),
      ev("probe_answer", { oppId: "o3", memberId: "s1", yes: true }, T0 - 5 * DAY + HOUR), ev("probe_answer", { oppId: "o3", memberId: "s4", yes: true }, T0 - 5 * DAY + HOUR),
      ev("probe_sent", { oppId: "o4", memberId: "s2" }, T0 - 5 * DAY), ev("probe_sent", { oppId: "o4", memberId: "s3" }, T0 - 5 * DAY),
      ev("probe_answer", { oppId: "o4", memberId: "s2", yes: true }, T0 - 5 * DAY + HOUR), ev("probe_answer", { oppId: "o4", memberId: "s3", yes: true }, T0 - 5 * DAY + HOUR),
      ev("probe_sent", { oppId: "o5", memberId: "s1" }, T0 - 4 * DAY), ev("probe_answer", { oppId: "o5", memberId: "s1", yes: false }, T0 - 4 * DAY + HOUR),
      ev("worth_a_text", { opportunityId: "o3", worth: true }, T0 - DAY), ev("worth_a_text", { opportunityId: "o3", worth: true }, T0 - DAY),
      ev("worth_a_text", { opportunityId: "o4", worth: "yes" }, T0 - DAY), ev("worth_a_text", { opportunityId: "o4", worth: false }, T0 - DAY),
      ev("bias_report", { ratio: 0.78, min_group: "q1", action: "pause" }, T0 - DAY),
      ev("queue_alert", { kind: "line_flagged", line: "+15550000000", address_hash: "h", detail: "provider flagged the line" }, T0),
    ])}`;
    await sql`insert into network.network_state (id, version, state, saved_at) values ('slop:nyc', 1,
      ${state([{ id: "rp1", kind: "harassment", reporterId: "s4", subjectId: "s1", at: REPORT_AT, status: "open", source: "check_in" }])}::jsonb, ${at(T0)})`;
  }, T);
  afterAll(async () => { await sql?.close(); if (url) await dropDb(url); });

  const run = (o: Partial<Parameters<typeof checks>[0]> = {}) => checks({ sql, now: clock, dispatcher: undefined as never, apps: ["slop"], sla: { slop: 6 }, budget: {}, prices: {}, invariants: false, ...o });

  test("the invariant job writes a violation for a probe without approval and for a minor in a plan, once", async () => {
    now = T0;
    const r = await runInvariants(sql, { now, apps: ["slop"] });
    const keys = r.written.map(v => v.key).sort();
    expect(keys).toContain("probe_without_approval:x1");
    expect(keys).toContain("minor_in_opportunity:o2");
    expect(keys).toContain("minor_connection_message:x2");
    expect(keys).toContain("leak_guard:x3");
    // Nothing else: the other sends pass the guard, nobody opted out, nobody is over the person cap.
    expect(r.written.every(v => ["probe_without_approval", "minor_in_opportunity", "minor_connection_message", "leak_guard"].includes(v.rule))).toBe(true);
    expect((await runInvariants(sql, { now, apps: ["slop"] })).written).toEqual([]);
    const ev = await scopedTo(sql, "slop", tx => tx`select payload->>'rule' as rule, actor_id from network.events where type = 'invariant_violation' order by id`) as any[];
    expect(ev.length).toBe(r.written.length);
    expect(ev.find(e => e.rule === "probe_without_approval").actor_id).toBe("s1");
    expect((await recentViolations(sql, now, DAY, ["slop"])).map(v => v.rule).sort()).toEqual(["leak_guard", "minor_connection_message", "minor_in_opportunity", "probe_without_approval"]);
    // And the monitor alerts on them.
    expect((await run()).map(a => a.key)).toContain("invariant:slop:probe_without_approval");
  }, T);

  test("an urgent report alerts after 1 hour, not before; the other checks fire on the seeded rows", async () => {
    now = REPORT_AT + 59 * MINUTE;
    let keys = (await run()).map(a => a.key);
    expect(keys).not.toContain("report_urgent_overdue:slop");
    now = REPORT_AT + 61 * MINUTE;
    const all = await run({ healthz: async () => false });
    keys = all.map(a => a.key);
    expect(keys).toContain("report_urgent_overdue:slop");
    expect(keys).toContain("healthz_down");
    expect(keys).toContain("review_near_sla:slop");
    expect(keys).toContain("bias_report:slop");
    expect(all.find(a => a.key === "bias_report:slop")!.level).toBe("bad");
    expect(keys).toContain("queue_alert:slop:line_flagged:+15550000000");
    // o4 is still scheduled 3 days after its meeting.
    expect(keys).toContain("opportunities_stuck:slop");
    expect(keys.some(k => k.startsWith("send_failures"))).toBe(false);
    expect(keys.some(k => k.startsWith("monitor_check_failed"))).toBe(false);
    // The tick is stale 11 minutes after the stored last tick.
    now = T0 + 11 * MINUTE;
    expect((await run()).map(a => a.key)).toContain("tick_stale:slop:nyc");
  }, T);

  test("the monitor loop: each alert once, deduped on the next run, again after the re-alert interval, resolved when it clears", async () => {
    now = REPORT_AT + 61 * MINUTE;
    const sink = new FakeSink();
    const dispatcher = new AlertDispatcher({ sinks: [sink], now: clock, reAlertMs: 6 * HOUR });
    const m = new Monitor({ sql, now: clock, dispatcher, apps: ["slop"], sla: { slop: 6 }, budget: {}, prices: {}, invariants: false });
    const first = await m.runOnce();
    expect(first.filter(a => a.key === "report_urgent_overdue:slop").map(a => a.state)).toEqual(["firing"]);
    expect(new Set(first.map(a => a.key)).size).toBe(first.length);
    now += 5 * MINUTE;
    const second = await m.runOnce();
    expect(second.filter(a => a.key === "report_urgent_overdue:slop")).toEqual([]);
    now += 6 * HOUR;
    expect((await m.runOnce()).filter(a => a.key === "report_urgent_overdue:slop").map(a => a.state)).toEqual(["repeat"]);
    // Staff dismiss the report: one resolved line, then silence.
    await sql`update network.network_state set state = ${state([{ id: "rp1", kind: "harassment", reporterId: "s4", subjectId: "s1", at: REPORT_AT, status: "dismissed", source: "check_in" }])}::jsonb where id = 'slop:nyc'`;
    now += 5 * MINUTE;
    expect((await m.runOnce()).filter(a => a.key === "report_urgent_overdue:slop").map(a => a.state)).toEqual(["resolved"]);
    now += 5 * MINUTE;
    expect((await m.runOnce()).filter(a => a.key === "report_urgent_overdue:slop")).toEqual([]);
    expect(sink.all.filter(a => a.key === "report_urgent_overdue:slop").length).toBe(3);
  }, T);

  test("a minor report alerts at once", async () => {
    now = T0;
    await sql`update network.network_state set state = ${state([{ id: "rp2", kind: "minor", reporterId: "s4", subjectId: "s2", at: T0 - MINUTE, status: "open", source: "message" }])}::jsonb where id = 'slop:nyc'`;
    const keys = (await run()).map(a => a.key);
    expect(keys).toContain("report_minor_open:slop");
  }, T);

  test("cost: an LLM call through the process hook lands in the ledger; spend at 80% and 100% of the daily budget alerts", async () => {
    now = T0;
    const ledger = new CostLedger({ sql, now: clock });
    const uninstall = ledger.install();
    try {
      // A fake provider (no network): 8.5 USD reported for one call.
      const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 8.5 } }), { status: 200, headers: { "content-type": "application/json" } });
      const llm = new OpenAILLM("test-key", "gpt-6-luna", "https://llm.example.test/v1", { fetch, purpose: "onboarding", app: "slop", maxRetries: 0 });
      expect(await llm.chat([{ role: "user", content: "hi" }])).toBe("ok");
      expect(ledger.pending).toBe(1);
      expect(await ledger.flush()).toBe(1);
    } finally { uninstall(); }
    expect(setUsageObserver(undefined)).toBeUndefined();
    const [row] = await sql`select app_id, purpose, model, tokens_in, tokens_out, cost_micro from network.llm_usage`;
    expect({ ...row, cost_micro: Number(row.cost_micro) }).toEqual({ app_id: "slop", purpose: "onboarding", model: "gpt-6-luna", tokens_in: 100, tokens_out: 20, cost_micro: 8_500_000 });
    // Blooio messages roll up from network.messages (10 handed to Blooio today), at a founder price.
    expect(await rollupMessages(sql, now, { blooioMessageUsd: 0.01 })).toMatchObject({ slop: 10 });
    const s = await costSummary(sql, now, { blooioMessageUsd: 0.01 });
    expect(s.day.totalUsd).toBeCloseTo(8.6, 6);
    expect(s.byApp.slop!.blooioMessages).toBe(10);
    expect(costAlerts(s, {}).length).toBe(0);
    expect(costAlerts(s, { dailyUsd: 10 }).map(a => `${a.key}:${a.level}`)).toEqual(["cost_daily_80:warn"]);
    expect(costAlerts(s, { dailyUsd: 8 }).map(a => `${a.key}:${a.level}`)).toEqual(["cost_daily_100:bad"]);
    expect((await run({ budget: { dailyUsd: 10 }, prices: { blooioMessageUsd: 0.01 } })).map(a => a.key)).toContain("cost_daily_80");
    expect((await run({ budget: {} })).map(a => a.key).some(k => k.startsWith("cost_"))).toBe(false);
  }, T);

  test("the pilot scorecard on the seeded rows", async () => {
    now = T0;
    const input = await scopedTo(sql, "slop", tx => loadPilotInput(tx, "slop", now, { cost: { monthUsd: 8.6, activeMembers: 1, targetUsd: 5 } }));
    const m = Object.fromEntries(pilotMetrics(input).map(x => [x.key, x]));
    // o3 and o4 mutual; o5 one no: 2 of 3.
    expect([m.mutual_yes!.value, m.mutual_yes!.n]).toEqual([0.667, 3]);
    // Both dates are past; o3 was held, o4 was not.
    expect([m.dates_held!.value, m.dates_held!.n]).toEqual([0.5, 2]);
    expect(m.blooio_failures!.value).toBe(0.1);
    expect([m.worth_a_text!.value, m.worth_a_text!.n]).toEqual([0.75, 4]);
    expect(m.days_to_first_date!.value).toBe(18);
    expect(m.cost_per_active_member!.value).toBe(8.6);
    expect(m.cost_per_active_member!.met).toBe(false);
    expect(m.reports_per_1000_dates!.parts).toEqual({ reports: 1, minor: 1 });
    // Probes went to 4 of 4 adults (s1 twice): the top 10% (one member) holds 2 of 5.
    expect(m.probes_top10!.value).toBe(0.4);
  }, T);

  test("replay: a stored slop engine run (phones scrubbed) re-runs to the same proposals", async () => {
    const personas = generateSlopPersonas({ seed: 3, perCity: 40, minorShare: 0 });
    const input = slopEngineInput(buildSlopSnapshot(personas, { now: SLOP_WORLD_START + 12 * HOUR, week: 0, interactions: [], feedback: [], safetyHolds: [], inboundAsks: [], edges: [], paused: new Set(), asks: [], learned: new Map() }));
    const w = appWiring("slop");
    const config = { seed: 1, ...w.engine, cities: ["nyc" as const], judge: { enabled: false } };
    const withPhone = { ...input, members: input.members.map((x, i) => (i === 0 ? { ...x, bio: "text me at +1 (212) 555-0123" } : x)) };
    const r = await runEngine(withPhone, config, { pack: w.pack });
    expect(r.proposals.length).toBeGreaterThan(0);
    const row = runInputRow({ runId: "slop.test-run", app: "slop", city: "nyc", at: T0, log: r.runLog, proposals: r.proposals, input: withPhone, config, pack: w.pack?.id });
    expect(JSON.stringify(row.input)).not.toContain("555-0123");
    expect(JSON.stringify(scrubPhones({ a: ["call +12125550123 now"] }))).toBe('{"a":["call [phone] now"]}');
    await scopedTo(sql, "slop", tx => writeRunInputs(tx, "slop", [row, { ...row, run_id: "slop.old", at: new Date(T0 - 40 * DAY), expires_at: new Date(T0 - 10 * DAY) }], T0));
    const stored = await scopedTo(sql, "slop", tx => tx`select * from network.matching_run_inputs order by run_id`) as any[];
    // The expired row is gone on write (30-day retention).
    expect(stored.map(s => s.run_id)).toEqual(["slop.test-run"]);
    const d = await replayRun(stored[0]);
    expect(d.same).toBe(true);
    expect(d.configHash.replay).toBe(d.configHash.stored!);
    // A changed proposal shows in the diff.
    const tampered = await replayRun({ ...stored[0], proposals: JSON.stringify((typeof stored[0].proposals === "string" ? JSON.parse(stored[0].proposals) : stored[0].proposals).slice(1)) });
    expect([tampered.same, tampered.added.length]).toEqual([false, 1]);
  }, T);
});
