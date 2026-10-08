// End-to-end checks of the consent-first Network on the NYC world, plus every NYC scenario.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, MINUTE, type MemberId } from "@thenetwork/core";
import { computeMetrics, type RunRecord } from "@thenetwork/judge";
import { INTERESTS, PolicyPersonaAgent, World } from "@thenetwork/sim";
import { DATA_DIR } from "../../../scripts/synthetic/common.ts";
import { friendFactory, nycPersonas, runArm, runScenario, SCENARIOS, type ArmResult } from "../harness/index.ts";
import { DEFAULT_ATTENTION } from "@thenetwork/engine";
import { allowedAt, ConsentNetwork, NY, OUTREACH, SIM_AUTO_REVIEWER, VENUES, type NetworkOptions } from "../src/index.ts";
import { styleViolations } from "../src/copy.ts";

const T = 300_000;
type Msg = Extract<RunRecord, { type: "message" }>;
type Log = Extract<RunRecord, { type: "network_log" }>;
const logs = (records: RunRecord[], kind: string) => records.filter((r): r is Log => r.type === "network_log" && r.kind === kind);
const outbound = (records: RunRecord[]) => records.filter((r): r is Msg => r.type === "message" && r.msg.direction === "outbound" && !r.msg.system);

async function world(days: number, seed = 3, network: NetworkOptions = { review: "auto" }) {
  const personas = await nycPersonas();
  const start = (await Bun.file(`${DATA_DIR}/manifest.json`).json()).snapshotNow as number;
  const net = new ConsentNetwork({ seed, ...network });
  const records: RunRecord[] = [];
  const w = new World({ seed, personas, days, start, writeLog: false, network: net, agent: new PolicyPersonaAgent(start), spawnFriend: friendFactory({ seed }), onRecord: r => records.push(r) });
  await w.begin();
  return { w, net, records, start, personas: new Map(w.personaList().map(p => [p.id, p])) };
}

describe("ConsentNetwork invariants (NYC, 10 days, simulated reviewer)", () => {
  let run: Awaited<ReturnType<typeof world>>;
  test("runs", async () => {
    run = await world(10);
    await run.w.advanceTo(run.w.end);
    await run.w.complete();
    expect(run.records.length).toBeGreaterThan(1000);
  }, T);

  test("judge: zero invariant violations, zero minor contacts, zero canary leaks", () => {
    // The judge's weekly cap is the Network's own (outreach.ts), so both count the same thing (P2-13).
    const m = computeMetrics(run.records, { weeklyBudget: OUTREACH.maxPerWeek });
    expect(m.invariants).toMatchObject({ total: 0 });
    expect(m.safety.minorContacts).toBe(0);
    expect(m.privacy.canaryLeaks).toBe(0);
    expect(m.errors).toBe(0);
  });

  test("every opportunity is reviewed before anyone is contacted (review_decision precedes every probe and reveal)", () => {
    const approvedAt = new Map(logs(run.records, "review_decision").filter(l => l.detail.decision === "approve").map(l => [String(l.detail.oppId), l.t]));
    const sent = logs(run.records, "probe_sent");
    expect(sent.length).toBeGreaterThan(50);
    for (const l of sent) expect([l.detail.oppId, (approvedAt.get(String(l.detail.oppId)) ?? Infinity) <= l.t]).toEqual([l.detail.oppId, true]);
    for (const m of outbound(run.records).filter(m => m.msg.meta?.type === "proposal")) {
      const id = String(m.msg.meta?.proposalId);
      expect([id, (approvedAt.get(id) ?? Infinity) <= m.msg.ts]).toEqual([id, true]);
    }
    expect(logs(run.records, "review_decision").every(l => l.detail.reviewer === SIM_AUTO_REVIEWER)).toBe(true);
    // Every opportunity that started, whatever its origin, names the reviewer who approved it.
    expect(logs(run.records, "probe_started").filter(l => l.detail.reviewer !== SIM_AUTO_REVIEWER)).toEqual([]);
  });

  test("probes never name anyone, and every reveal follows a yes from everyone (or their own ask)", () => {
    const names = [...run.personas.values()].map(p => p.name);
    for (const m of outbound(run.records).filter(m => m.msg.meta?.type === "probe")) for (const n of names) expect(m.msg.body.includes(n)).toBe(false);
    for (const o of run.net.opps.values()) {
      if (!o.recorded) continue;
      for (const p of o.participants) {
        const said = logs(run.records, "probe_answer").some(r => r.detail.oppId === o.id && r.detail.memberId === p && r.detail.yes === true);
        expect([o.id, p, said || o.primed.has(p)]).toEqual([o.id, p, true]);
      }
    }
  });

  test("a probe carries at most one fact about the others (D5): the activity never names an interest, a request probe never says where the requester lives, and no raw tags", () => {
    const interests = new Set(INTERESTS.flatMap(i => [i.label.toLowerCase(), i.tag.replace(/_/g, " ")]));
    const probes = outbound(run.records).filter(m => m.msg.meta?.type === "probe" || m.msg.meta?.type === "scheduling").map(m => m.msg.body);
    expect(probes.length).toBeGreaterThan(50);
    for (const b of probes) {
      expect([b, styleViolations(b)]).toEqual([b, []]);
      // "would you be up for <activity> near <area> (<the one fact>)": the activity is not a second fact.
      const activity = /would you be up for (.*?) near /.exec(b)?.[1]?.toLowerCase();
      if (activity !== undefined) expect([b, interests.has(activity)]).toEqual([b, false]);
      if (/\bwants to\b/.test(b) && !/would you be up for/.test(b)) expect(b).toMatch(/Someone nearby wants to /);
    }
  });

  test("send timing: nothing agent-started in quiet hours; initial invites only in the member's send window (12:00 slot, 6 h)", async () => {
    // Agent-started = not sent at the moment the member wrote to us (a direct reply) and not a safety notice.
    const inboundAt = new Set(run.records.filter((r): r is Msg => r.type === "message" && r.msg.direction === "inbound").map(r => `${r.msg.memberId}|${r.msg.ts}`));
    const quiet = new Map(run.records.flatMap(r => (r.type === "persona" ? [[r.persona.id, r.persona.quietHours] as const] : [])));
    const started = outbound(run.records).filter(m => !inboundAt.has(`${m.msg.memberId}|${m.msg.ts}`) && !m.msg.meta?.safety);
    expect(started.length).toBeGreaterThan(200);
    const bad = started.filter(m => !allowedAt(m.msg.ts, quiet.get(m.msg.memberId)!));
    expect(bad.map(m => `${m.msg.meta?.type} ${m.msg.memberId} ${new Date(m.msg.ts).toISOString()}`)).toEqual([]);
    // The latest an initial invite can go: the evening slot (17:00) + 2 h spread + 6 h window; the
    // earliest: the morning slot (09:00). The default slot (12:00-14:00 + 6 h) covers most of them.
    const invites = outbound(run.records).filter(m => m.msg.meta?.proactive && m.msg.status === "delivered");
    expect(invites.length).toBeGreaterThan(50);
    const hour = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", hour: "2-digit" }).format(t));
    expect(invites.filter(m => hour(m.msg.ts) < 9)).toEqual([]);
    const lunch = invites.filter(m => hour(m.msg.ts) >= 12 && hour(m.msg.ts) < 20).length;
    expect(lunch / invites.length).toBeGreaterThan(0.8);
    expect(DEFAULT_ATTENTION.sendTime.windowHours).toBe(OUTREACH.sendWindowHours);
    // Deferrals are logged with when the send can go out.
    const deferred = logs(run.records, "send_deferred");
    expect(deferred.length).toBeGreaterThan(10);
    for (const l of deferred) expect([l.detail.kind, Number(l.detail.until) >= l.t]).toEqual([l.detail.kind, true]);
  });

  test("reminders land outside quiet hours, before the meeting", () => {
    const at = new Map(outbound(run.records).filter(m => m.msg.meta?.booked).map(m => [`${m.msg.memberId}|${m.msg.meta?.proposalId}`, Number(m.msg.meta?.meetingAt)]));
    const reminders = outbound(run.records).filter(m => m.msg.meta?.type === "reminder");
    expect(reminders.length).toBeGreaterThan(5);
    for (const m of reminders) {
      const meeting = at.get(`${m.msg.memberId}|${m.msg.meta?.proposalId}`)!;
      expect([m.msg.id, m.msg.ts < meeting && meeting - m.msg.ts <= DAY]).toEqual([m.msg.id, true]);
    }
  });

  test("probes are sequential and offer 2-3 times; the partner sees only the times the first member picked", () => {
    const probes = outbound(run.records).filter(m => m.msg.meta?.type === "probe");
    const withTimes = probes.filter(m => (m.msg.meta?.timeOptions as unknown[] | undefined)?.length);
    expect(withTimes.length / probes.length).toBeGreaterThan(0.5);
    for (const m of withTimes) expect((m.msg.meta!.timeOptions as unknown[]).length).toBeLessThanOrEqual(3);
    const byOpp = new Map<string, Msg[]>();
    for (const m of probes) { const k = String((m.msg.meta?.probe as { key: string }).key); byOpp.set(k, [...(byOpp.get(k) ?? []), m]); }
    let partners = 0;
    for (const [opp, ms] of byOpp) {
      if (ms.length < 2) continue;
      const [first, second] = ms;
      const yes = logs(run.records, "probe_answer").find(l => l.detail.oppId === opp && l.detail.memberId === first!.msg.memberId && l.detail.yes === true);
      if (!yes) continue; // the first member was replaced, not a partner probe
      partners++;
      expect(second!.msg.ts).toBeGreaterThanOrEqual(yes.t);
      const picked = new Set(((first!.msg.meta?.timeOptions ?? []) as { key: string; start: number }[]).filter(o => (yes.detail.picked as string[] | undefined)?.includes(o.key)).map(o => o.start));
      for (const o of (second!.msg.meta?.timeOptions ?? []) as { start: number }[]) expect(picked.has(o.start)).toBe(true);
    }
    expect(partners).toBeGreaterThan(5);
  });

  test("the booked plan: one message per member after both yeses, logistics (never on the cap), no separate confirmation", () => {
    const booked = outbound(run.records).filter(m => m.msg.meta?.booked);
    expect(booked.length).toBeGreaterThan(10);
    for (const m of booked) {
      expect(m.msg.meta?.proactive).toBe(false);
      expect(m.msg.meta?.type).toBe("proposal");
      expect(m.msg.body).toMatch(/Reply if you can't make it\./);
    }
    // No separate "you're all set": the only scheduling messages ask for times, before anything is booked.
    expect(outbound(run.records).filter(m => m.msg.meta?.type === "scheduling" && (m.msg.meta?.meetingAt || !m.msg.meta?.timeOptions))).toEqual([]);
  });

  test("each member's own cap on initial invites (PRD 32.9, founder decision 3), and the Blooio streak", () => {
    const state = new Map(run.w.snapshot().members.map(m => [m.id, m.state]));
    const by = new Map<MemberId, number[]>(), plan = new Map<MemberId, number[]>();
    for (const m of outbound(run.records).filter(m => m.msg.meta?.proactive && m.msg.status === "delivered")) {
      // Plan invites under the plan allowance have their own cap (1 per 7 days) and never count on the intro cap.
      const map = m.msg.meta?.planInvite ? plan : by;
      if (!map.has(m.msg.memberId)) map.set(m.msg.memberId, []);
      map.get(m.msg.memberId)!.push(m.msg.ts);
    }
    for (const [id, ts] of by) {
      const b = OUTREACH.budget[state.get(id) ?? "normal"] ?? OUTREACH.budget.normal!;
      for (const t of ts) expect([id, ts.filter(x => x > t - b.days * DAY && x <= t).length <= b.n]).toEqual([id, true]);
    }
    for (const [id, ts] of plan) for (const t of ts) expect([id, ts.filter(x => x > t - 7 * DAY && x <= t).length <= 1]).toEqual([id, true]);
    // Blooio: never a 4th message in a row without an answer (safety notices and direct replies aside).
    const streak = new Map<MemberId, number>();
    for (const r of run.records) {
      if (r.type !== "message" || r.msg.system) continue;
      if (r.msg.direction === "inbound") { streak.set(r.msg.memberId, 0); continue; }
      if (r.msg.status !== "delivered") continue;
      const n = (streak.get(r.msg.memberId) ?? 0) + 1;
      streak.set(r.msg.memberId, n);
      if (!r.msg.meta?.safety) expect([r.msg.memberId, r.msg.meta?.type, n <= 3]).toEqual([r.msg.memberId, r.msg.meta?.type, true]);
    }
    // "Only when I ask": nothing proactive between the move and the member's next message.
    for (const l of logs(run.records, "only_when_asked")) {
      const id = String(l.detail.memberId);
      const back = run.records.find(r => r.type === "message" && r.msg.direction === "inbound" && r.msg.memberId === id && r.t > l.t)?.t ?? Infinity;
      expect(outbound(run.records).filter(m => m.msg.memberId === id && m.msg.meta?.proactive && m.msg.ts > l.t && m.msg.ts < back)).toEqual([]);
    }
  });

  test("meetings happen at real public NYC venues (geo.ts)", () => {
    const sched = outbound(run.records).filter(m => m.msg.meta?.booked);
    expect(sched.length).toBeGreaterThan(0);
    for (const m of sched) expect([m.msg.body, VENUES.some(v => m.msg.body.includes(`${v.name} (${v.neighborhood})`))]).toEqual([m.msg.body, true]);
  });

  test("no honest member is flagged; bad actors who acted are restricted", () => {
    for (const r of logs(run.records, "abuse")) expect([r.detail.memberId, !!run.personas.get(String(r.detail.memberId))?.hidden.adversarial]).toEqual([r.detail.memberId, true]);
    const acted = new Set(run.records.filter(r => r.type === "adversarial_attempt" && ["spammer", "scammer", "harasser", "prompt_injector"].includes(r.kind)).map(r => (r as { memberId: string }).memberId));
    for (const id of acted) expect([id, run.net.trust.level(id)]).not.toEqual([id, "ok"]);
  });

  test("the run log never carries a member's own words (privacy, P3)", () => {
    const said = [...new Set(run.records.filter((r): r is Msg => r.type === "message" && r.msg.direction === "inbound" && r.msg.body.length >= 16).map(r => r.msg.body))];
    expect(said.length).toBeGreaterThan(100);
    const logged = run.records.filter((r): r is Log => r.type === "network_log").map(r => JSON.stringify(r.detail)).join("\n");
    expect(said.filter(b => logged.includes(JSON.stringify(b).slice(1, -1)))).toEqual([]);
  });

  test("deterministic", async () => {
    const again = await world(10);
    await again.w.advanceTo(again.w.end);
    expect(JSON.stringify(again.net.counters)).toBe(JSON.stringify(run.net.counters));
  }, T);
});

describe("human review gate (PRD 32.8)", () => {
  test("nothing is probed until approved; reject and SLA expiry send nothing; requesters still hear 'On it'", async () => {
    const run = await world(3, 3, { review: "human" });
    const { w, net, records, start } = run;
    // A staff-composed (player) and a scenario proposal, submitted at 08:00 New York on day 1, wait
    // for review like everything else (PRD 32.8).
    await w.advanceTo(start + 19 * HOUR);
    const free = net.memberList().filter(m => net.eligible(m.id)).map(m => m.id);
    const injected = ["player", "scenario"] as const;
    injected.forEach((source, i) => w.act({ do: "propose", source, proposal: {
      id: `${source}-1`, kind: "intro", participants: [free[2 * i]!, free[2 * i + 1]!], alternates: [], objective: "one-to-one intro", category: "social", city: "nyc",
      window: { start: start + 2 * DAY, end: start + 6 * DAY }, score: 0, components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
      exploration: false, explanations: {}, generator: source, createdAt: start + 19 * HOUR,
    } }));
    // 10:00 New York on day 1: the morning engine run's items (queued about 09:05) are inside their 12 h SLA.
    await w.advanceTo(start + 21 * HOUR);
    const queue = net.reviewQueue();
    expect(queue.filter(q => q.origin === "player").map(q => q.oppId).sort()).toEqual(["player-1", "scenario-1"]);
    expect(queue.length).toBeGreaterThan(5);
    expect(logs(records, "probe_sent")).toEqual([]);
    expect(outbound(records).filter(m => m.msg.meta?.type === "probe" || m.msg.meta?.type === "proposal")).toEqual([]);
    for (const l of logs(records, "review_queued").filter(l => l.detail.origin === "request")) {
      const requester = (l.detail.proposal as { participants: MemberId[] }).participants[0]!;
      expect(outbound(records).some(m => m.msg.memberId === requester && m.msg.ts === l.t && /^On it/.test(m.msg.body))).toBe(true);
    }
    // Approve one, reject one, leave the rest to their SLA.
    const [a, b] = queue.filter(q => q.origin === "engine").length >= 2 ? queue.filter(q => q.origin === "engine") : queue;
    const decidedAt = w.clock.now();
    expect(net.review(a!.oppId, "approve", { reviewer: "test" })).toBe(true);
    expect(net.review(b!.oppId, "reject", { reason: "weak_reason", reviewer: "test" })).toBe(true);
    expect(net.review(b!.oppId, "approve")).toBe(false); // decided items cannot be decided again
    const left = net.reviewQueue().map(q => q.oppId);
    await w.advanceTo(start + 2 * DAY + 30 * MINUTE);

    const probes = logs(records, "probe_sent");
    expect(probes.filter(l => l.detail.oppId === a!.oppId).length).toBeGreaterThan(0);
    expect(probes.filter(l => l.t < decidedAt)).toEqual([]);
    const about = (id: string) => outbound(records).filter(m => m.msg.meta?.proposalId === id || (m.msg.meta?.probe as { key?: string } | undefined)?.key === id);
    expect(about(b!.oppId)).toEqual([]);
    const expired = new Set(logs(records, "review_expired").map(l => String(l.detail.oppId)));
    for (const id of left) {
      expect([id, expired.has(id)]).toEqual([id, true]);
      expect([id, about(id)]).toEqual([id, []]);
    }
    // Nothing was ever sent about an opportunity a reviewer did not approve.
    const approved = new Set(logs(records, "review_decision").filter(l => l.detail.decision === "approve").map(l => String(l.detail.oppId)));
    for (const l of probes) expect(approved.has(String(l.detail.oppId))).toBe(true);
  }, T);

  test("send-time recipient policy (Blooio hook): minors, declined pairs and replies", async () => {
    const { w, net, start, personas } = await world(1, 3, { review: "human" });
    await w.advanceTo(start + 6 * HOUR);
    const members = net.memberList();
    const minor = members.find(m => (personas.get(m.id)?.public.claimedAge ?? 99) < 18)!;
    const adult = members.find(m => !m.minor && m.stage !== "new" && !personas.get(m.id)?.hidden.adversarial)!;
    expect(net.recipientPolicy(minor.id, "probe")).toEqual({ ok: false, reason: "minor" });
    expect(net.recipientPolicy(adult.id, "reveal", { about: [adult.id, minor.id] })).toEqual({ ok: false, reason: "other_not_matchable" });
    expect(net.recipientPolicy(minor.id, "reply")).toEqual({ ok: true });
    expect(net.recipientPolicy(adult.id, "reminder", { about: [adult.id] })).toEqual({ ok: true });
  }, T);
});

describe("age policy (core policy.ts) on inbound messages", () => {
  test("an adult's ordinary phrases never decline them; a conflicting stated age fails closed to minor; an explicit under-13 age declines", async () => {
    const { w, net, records, start } = await world(1, 3, { review: "human" });
    await w.advanceTo(start + 6 * HOUR);
    const ages = new Map(w.snapshot().members.map(m => [m.id, m.age]));
    const [sober, teacher, kid] = net.memberList().filter(m => m.stage !== "new" && !m.minor && (ages.get(m.id) ?? 0) >= 25).map(m => m.id);
    w.act({ do: "say", persona: sober!, text: "I'm 4 years sober and I love climbing" });
    w.act({ do: "say", persona: teacher!, text: "I'm in 7th grade" });
    w.act({ do: "say", persona: kid!, text: "I am 12 years old" });
    await w.advanceTo(start + 7 * HOUR);
    // Before the fix, "I'm 4 years sober" read as age 4: the member was declined and deleted.
    expect(net.isDeclined(sober!)).toBe(false);
    expect(net.memberList().find(m => m.id === sober)!.minor).toBe(false);
    expect(net.isDeclined(teacher!)).toBe(false);
    expect(net.memberList().find(m => m.id === teacher)!.minor).toBe(true);
    expect(logs(records, "age_conflict").map(l => l.detail.memberId)).toEqual([teacher]);
    expect(net.isDeclined(kid!)).toBe(true);
  }, T);
});

describe("consent-first beats push (21 days, NYC)", () => {
  test("higher everyone-yes rate (pooled seeds 1-3), far fewer unsafe proposals, more meetings, growth; judge gates at 0", async () => {
    const push = await runArm("push_baseline", { days: 21, seed: 1 });
    const consent: ArmResult[] = [];
    for (const seed of [1, 2, 3]) consent.push(await runArm("consent", { days: 21, seed }));
    const sum = (f: (r: ArmResult) => number) => consent.reduce((x, r) => x + f(r), 0);
    expect(sum(r => r.proposalsAllYes) / sum(r => r.proposals)).toBeGreaterThan(ALL_YES_MIN);
    expect(sum(r => r.inviteYes) / sum(r => r.invitations)).toBeGreaterThan(0.85);
    expect(push.proposalAllYesRate).toBeLessThan(0.25);
    expect(consent[0]!.unsafe).toBeLessThan(push.unsafe / 4);
    expect(consent[0]!.meetingsHeld).toBeGreaterThan(push.meetingsHeld);
    expect(sum(r => r.meetingsHeld)).toBeGreaterThan(MEETINGS_MIN);
    expect(consent[0]!.newMembersJoined).toBeGreaterThan(5);
    for (const r of consent) {
      expect(r.falseFlags).toBe(0);
      expect(r.judge).toMatchObject({ invariants: 0, canaryLeaks: 0, minorContacts: 0 });
    }
  }, T);
});

describe("NYC scenarios", () => {
  for (const s of SCENARIOS) {
    test(s.id, async () => {
      const r = await runScenario(s);
      const failed = r.checks.filter(c => !c.pass);
      expect(failed.map(c => `${c.name}: ${c.detail}`)).toEqual([]);
    }, T);
  }
});

// Regression floors (audit P2-20), not targets (the everyone-yes target is 0.85+). Measured 2026-10-07
// after the attention v1.2 send defaults (docs/results/2026-10-07-network-send-defaults.md), 21 days,
// review "auto", default persona policy (time-aware off), seeds 1-3:
//   everyone-yes 0.780 / 0.886 / 0.889, pooled 0.853 (214/251, Wilson 95% CI 0.80-0.89);
//   before the change 0.866 / 0.835 / 0.747, pooled 0.818 (198/242).
//   meetings held 52 / 56 / 65 = 173 (before 49 / 48 / 32 = 129).
// Everyone-yes on a booked plan counts each member's own decision (silence = in; a silent decliner
// is a no). One seed is one sample: a 10-point swing on ~80 plans is inside run-to-run noise, so the
// floors are pooled over the three seeds and sit at the pooled CI lower bound (0.80) and about 80%
// of the measured meetings. Lower them only after a pooled re-run shows the drop is real.
const ALL_YES_MIN = 0.8;
const MEETINGS_MIN = 140;
