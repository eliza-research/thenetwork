// The network block: the consent-first ConsentNetwork in the simulated NYC world (data/synthetic/v1),
// with the simulated reviewer. Pinned: invariants on seed 3 over 10 days; consent vs push on seeds 1-3
// over 21 days; every NYC scenario; every sim/scenarios/*.json at pass^3 against the push stub; the
// attention and plans invariants on the consent arms; and the shared conformance rules for networkPack.
import { readdirSync } from "node:fs";
import { DAY, HOUR, MINUTE, type MemberId } from "../../packages/core/src/index.ts";
import { DEFAULT_ATTENTION } from "../../packages/engine/src/index.ts";
import { networkPack } from "../../packages/engine/src/packs/network/index.ts";
import type { RunRecord } from "../../packages/core/src/index.ts";
import { computeMetrics } from "../../packages/sim/src/judge/metrics.ts";
import { INTERESTS, PolicyPersonaAgent, StubNetwork, World, loadScenario, runScenario as runSimScenario, runScenarioPassK } from "../../packages/sim/src/index.ts";
import { friendFactory, nycPersonas, runArm, runScenario, SCENARIOS, type ArmResult } from "../../packages/network/harness/index.ts";
import { allowedAt, ConsentNetwork, NY, OUTREACH, SIM_AUTO_REVIEWER, VENUES, type NetworkOptions } from "../../packages/network/src/index.ts";
import { styleViolations } from "../../packages/network/src/copy.ts";
import { DATA_DIR } from "../synthetic/common.ts";
import { conformance } from "./conformance.ts";
import { Block, digest, expect } from "./gate.ts";
import { networkPluginScope } from "./network-plugin-scope.ts";
import { networkMembershipBinding } from "./network-membership-binding.ts";

type Msg = Extract<RunRecord, { type: "message" }>;
type Log = Extract<RunRecord, { type: "network_log" }>;
const logs = (records: RunRecord[], kind: string) => records.filter((r): r is Log => r.type === "network_log" && r.kind === kind);
const outbound = (records: RunRecord[]) => records.filter((r): r is Msg => r.type === "message" && r.msg.direction === "outbound" && !r.msg.system);

/** Regression floors (audit P2-20), not targets: pooled over seeds 1-3 at the CI lower bound (docs/results/2026-10-08-network-hardening.md). */
const ALL_YES_MIN = 0.73;
const MEETINGS_MIN = 140;

async function world(days: number, seed = 3, network: NetworkOptions = { review: "auto" }) {
  const personas = await nycPersonas();
  const start = (await Bun.file(`${DATA_DIR}/manifest.json`).json()).snapshotNow as number;
  const net = new ConsentNetwork({ seed, ...network });
  const records: RunRecord[] = [];
  const w = new World({ seed, personas, days, start, writeLog: false, network: net, agent: new PolicyPersonaAgent(start), spawnFriend: friendFactory({ seed }), onRecord: r => records.push(r) });
  await w.begin();
  return { w, net, records, start, personas: new Map(w.personaList().map(p => [p.id, p])) };
}

export async function networkBlock(b: Block, o: { quick: boolean }): Promise<void> {
  await networkPluginScope(b);
  await networkMembershipBinding(b);
  // ---- invariants: NYC, 10 days, seed 3, simulated reviewer ---------------------------------------
  const run = await world(10);
  await run.w.advanceTo(run.w.end);
  await run.w.complete();
  const R = run.records;
  // Wall-clock fields (run_start's id, run_end's wallMs) and engine run ids (which carry the config hash) are left out.
  b.track("fingerprint: invariant run (seed 3, 10 days) records", true, digest(R.filter(r => r.type !== "run_start" && r.type !== "run_end").map(r => JSON.stringify(r).replace(/"runId":"[^"]*"/g, ""))));

  await b.run("invariants (seed 3, 10 days): judge 0 invariant violations, minor contacts, canary leaks, errors", () => {
    expect(R.length).toBeGreaterThan(1000);
    const m = computeMetrics(R, { requireReview: true });
    expect(m.invariants).toMatchObject({ total: 0 });
    expect(m.safety.minorContacts).toBe(0);
    expect(m.privacy.canaryLeaks).toBe(0);
    expect(m.errors).toBe(0);
  });

  await b.run("minors: no minor is ever an alternate (a possible backfill)", () => {
    const minors = new Set([...run.personas.values()].filter(p => p.public.claimedAge < 18).map(p => p.id));
    const started = logs(R, "probe_started");
    expect(started.length).toBeGreaterThan(0);
    for (const r of started) expect(((r.detail as { proposal?: { alternates?: string[] } }).proposal?.alternates ?? []).filter(id => minors.has(id))).toEqual([]);
  });

  await b.run("review before contact: review_decision precedes every probe and reveal", () => {
    const approvedAt = new Map(logs(R, "review_decision").filter(l => l.detail.decision === "approve").map(l => [String(l.detail.oppId), l.t]));
    const sent = logs(R, "probe_sent");
    expect(sent.length).toBeGreaterThan(50);
    for (const l of sent) expect([l.detail.oppId, (approvedAt.get(String(l.detail.oppId)) ?? Infinity) <= l.t]).toEqual([l.detail.oppId, true]);
    for (const m of outbound(R).filter(m => m.msg.meta?.type === "proposal")) {
      const id = String(m.msg.meta?.proposalId);
      expect([id, (approvedAt.get(id) ?? Infinity) <= m.msg.ts]).toEqual([id, true]);
    }
    expect(logs(R, "review_decision").every(l => l.detail.reviewer === SIM_AUTO_REVIEWER)).toBe(true);
    expect(logs(R, "probe_started").filter(l => l.detail.reviewer !== SIM_AUTO_REVIEWER)).toEqual([]);
  });

  await b.run("consent before reveal: probes never name anyone; every reveal follows a yes from everyone (or their own ask)", () => {
    const names = [...run.personas.values()].map(p => p.name);
    for (const m of outbound(R).filter(m => m.msg.meta?.type === "probe")) for (const n of names) expect(m.msg.body.includes(n)).toBe(false);
    for (const op of run.net.opps.values()) {
      if (!op.recorded) continue;
      for (const p of op.plan ? op.participants.filter(x => op.status.get(x) === "yes") : op.participants) {
        const said = logs(R, "probe_answer").some(r => r.detail.oppId === op.id && r.detail.memberId === p && r.detail.yes === true);
        expect([op.id, p, said || op.primed.has(p)]).toEqual([op.id, p, true]);
      }
    }
  });

  await b.run("leak gate: a probe carries at most one fact (D5), never an interest as the activity, no raw tags", () => {
    const interests = new Set(INTERESTS.flatMap(i => [i.label.toLowerCase(), i.tag.replace(/_/g, " ")]));
    const probes = outbound(R).filter(m => m.msg.meta?.type === "probe" || m.msg.meta?.type === "scheduling").map(m => m.msg.body);
    expect(probes.length).toBeGreaterThan(50);
    for (const t of probes) {
      expect([t, styleViolations(t)]).toEqual([t, []]);
      const activity = /would you be up for (.*?) near /.exec(t)?.[1]?.toLowerCase();
      if (activity !== undefined) expect([t, interests.has(activity)]).toEqual([t, false]);
      if (/\bwants to\b/.test(t) && !/would you be up for/.test(t)) expect(t).toMatch(/Someone nearby wants to /);
    }
  });

  await b.run("attention: nothing agent-started in quiet hours; initial invites in the member's send window", () => {
    const inboundAt = new Set(R.filter((r): r is Msg => r.type === "message" && r.msg.direction === "inbound").map(r => `${r.msg.memberId}|${r.msg.ts}`));
    const quiet = new Map(R.flatMap(r => (r.type === "persona" ? [[r.persona.id, r.persona.quietHours] as const] : [])));
    const started = outbound(R).filter(m => !inboundAt.has(`${m.msg.memberId}|${m.msg.ts}`) && !m.msg.meta?.safety);
    expect(started.length).toBeGreaterThan(200);
    expect(started.filter(m => !allowedAt(m.msg.ts, quiet.get(m.msg.memberId)!)).map(m => `${m.msg.meta?.type} ${m.msg.memberId} ${new Date(m.msg.ts).toISOString()}`)).toEqual([]);
    const invites = outbound(R).filter(m => m.msg.meta?.proactive && m.msg.status === "delivered");
    expect(invites.length).toBeGreaterThan(50);
    const hour = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: NY, hourCycle: "h23", hour: "2-digit" }).format(t));
    expect(invites.filter(m => hour(m.msg.ts) < 9)).toEqual([]);
    expect(invites.filter(m => hour(m.msg.ts) >= 12 && hour(m.msg.ts) < 20).length / invites.length).toBeGreaterThan(0.8);
    expect(DEFAULT_ATTENTION.sendTime.windowHours).toBe(OUTREACH.sendWindowHours);
    const deferred = logs(R, "send_deferred");
    expect(deferred.length).toBeGreaterThan(10);
    for (const l of deferred) expect([l.detail.kind, Number(l.detail.until) >= l.t]).toEqual([l.detail.kind, true]);
  });

  await b.run("reminders land outside quiet hours, before the meeting", () => {
    const at = new Map(outbound(R).filter(m => m.msg.meta?.booked).map(m => [`${m.msg.memberId}|${m.msg.meta?.proposalId}`, Number(m.msg.meta?.meetingAt)]));
    const reminders = outbound(R).filter(m => m.msg.meta?.type === "reminder");
    expect(reminders.length).toBeGreaterThan(5);
    for (const m of reminders) { const meeting = at.get(`${m.msg.memberId}|${m.msg.meta?.proposalId}`)!; expect([m.msg.id, m.msg.ts < meeting && meeting - m.msg.ts <= DAY]).toEqual([m.msg.id, true]); }
  });

  await b.run("probes are sequential and offer 2-3 times; the partner sees only the times the first member picked", () => {
    const probes = outbound(R).filter(m => m.msg.meta?.type === "probe");
    const withTimes = probes.filter(m => (m.msg.meta?.timeOptions as unknown[] | undefined)?.length);
    expect(withTimes.length / probes.length).toBeGreaterThan(0.5);
    for (const m of withTimes) expect((m.msg.meta!.timeOptions as unknown[]).length).toBeLessThanOrEqual(3);
    const byOpp = new Map<string, Msg[]>();
    for (const m of probes) { const k = String((m.msg.meta?.probe as { key: string }).key); byOpp.set(k, [...(byOpp.get(k) ?? []), m]); }
    let partners = 0;
    for (const [opp, ms] of byOpp) {
      if (ms.length < 2) continue;
      const [first, second] = ms;
      const yes = logs(R, "probe_answer").find(l => l.detail.oppId === opp && l.detail.memberId === first!.msg.memberId && l.detail.yes === true);
      if (!yes) continue;
      partners++;
      expect(second!.msg.ts).toBeGreaterThanOrEqual(yes.t);
      const picked = new Set(((first!.msg.meta?.timeOptions ?? []) as { key: string; start: number }[]).filter(x => (yes.detail.picked as string[] | undefined)?.includes(x.key)).map(x => x.start));
      for (const x of (second!.msg.meta?.timeOptions ?? []) as { start: number }[]) expect(picked.has(x.start)).toBe(true);
    }
    expect(partners).toBeGreaterThan(5);
  });

  await b.run("the booked plan: one message per member after both yeses, no separate confirmation", () => {
    const booked = outbound(R).filter(m => m.msg.meta?.booked);
    expect(booked.length).toBeGreaterThan(10);
    for (const m of booked) { expect(m.msg.meta?.proactive).toBe(false); expect(m.msg.meta?.type).toBe("proposal"); expect(m.msg.body).toMatch(/Reply if your plans change\./); }
    expect(outbound(R).filter(m => m.msg.meta?.type === "scheduling" && (m.msg.meta?.meetingAt || !m.msg.meta?.timeOptions))).toEqual([]);
  });

  await b.run("attention caps: each member's cap on initial invites, the plan lane (1 / 7 days), the Blooio streak, only-when-asked", () => {
    const state = new Map(run.w.snapshot().members.map(m => [m.id, m.state]));
    const by = new Map<MemberId, number[]>(), plan = new Map<MemberId, number[]>();
    const invite = (m: { msg: { meta?: Record<string, unknown> } }) => m.msg.meta?.unsolicited !== true && (["probe", "plan_probe"].includes(String(m.msg.meta?.type)) || m.msg.meta?.reengagement === true);
    for (const m of outbound(R).filter(m => m.msg.meta?.proactive && m.msg.status === "delivered" && invite(m))) {
      const map = m.msg.meta?.planInvite ? plan : by;
      if (!map.has(m.msg.memberId)) map.set(m.msg.memberId, []);
      map.get(m.msg.memberId)!.push(m.msg.ts);
    }
    for (const [id, ts] of by) { const bud = OUTREACH.budget[state.get(id) ?? "normal"] ?? OUTREACH.budget.normal!; for (const t of ts) expect([id, ts.filter(x => x > t - bud.days * DAY && x <= t).length <= bud.n]).toEqual([id, true]); }
    for (const [id, ts] of plan) for (const t of ts) expect([id, ts.filter(x => x > t - 7 * DAY && x <= t).length <= 1]).toEqual([id, true]);
    const streak = new Map<MemberId, number>();
    for (const r of R) {
      if (r.type !== "message" || r.msg.system) continue;
      if (r.msg.direction === "inbound") { streak.set(r.msg.memberId, 0); continue; }
      if (r.msg.status !== "delivered") continue;
      const n = (streak.get(r.msg.memberId) ?? 0) + 1;
      streak.set(r.msg.memberId, n);
      if (!r.msg.meta?.safety) expect([r.msg.memberId, r.msg.meta?.type, n <= 3]).toEqual([r.msg.memberId, r.msg.meta?.type, true]);
    }
    for (const l of logs(R, "only_when_asked")) {
      const id = String(l.detail.memberId);
      const back = R.find(r => r.type === "message" && r.msg.direction === "inbound" && r.msg.memberId === id && r.t > l.t)?.t ?? Infinity;
      expect(outbound(R).filter(m => m.msg.memberId === id && m.msg.meta?.proactive && m.msg.ts > l.t && m.msg.ts < back)).toEqual([]);
    }
  });

  await b.run("meetings happen at real public NYC venues", () => {
    const sched = outbound(R).filter(m => m.msg.meta?.booked);
    expect(sched.length).toBeGreaterThan(0);
    for (const m of sched) expect([m.msg.body, VENUES.some(v => m.msg.body.includes(`${v.name} (${v.neighborhood})`))]).toEqual([m.msg.body, true]);
  });

  await b.run("trust: no honest member is flagged; bad actors who acted are restricted", () => {
    for (const r of logs(R, "abuse")) expect([r.detail.memberId, !!run.personas.get(String(r.detail.memberId))?.hidden.adversarial]).toEqual([r.detail.memberId, true]);
    const acted = new Set(R.filter(r => r.type === "adversarial_attempt" && ["spammer", "scammer", "harasser", "prompt_injector"].includes(r.kind)).map(r => (r as { memberId: string }).memberId));
    for (const id of acted) expect([id, run.net.trust.level(id)]).not.toEqual([id, "ok"]);
  });

  await b.run("privacy: the run log never carries a member's own words", () => {
    const said = [...new Set(R.filter((r): r is Msg => r.type === "message" && r.msg.direction === "inbound" && r.msg.body.length >= 16).map(r => r.msg.body))];
    expect(said.length).toBeGreaterThan(100);
    const logged = R.filter((r): r is Log => r.type === "network_log").map(r => JSON.stringify(r.detail)).join("\n");
    expect(said.filter(t => logged.includes(JSON.stringify(t).slice(1, -1)))).toEqual([]);
  });

  if (!o.quick) await b.run("deterministic (seed 3 rerun gives the same counters)", async () => {
    const again = await world(10);
    await again.w.advanceTo(again.w.end);
    expect(JSON.stringify(again.net.counters)).toBe(JSON.stringify(run.net.counters));
  });

  // ---- human review gate and recipient policy --------------------------------------------------------
  await b.run("human review (PRD 32.8): nothing probed until approved; reject and SLA expiry send nothing", async () => {
    const { w, net, records, start } = await world(3, 3, { review: "human" });
    await w.advanceTo(start + 19 * HOUR);
    const free = net.memberList().filter(m => net.eligible(m.id)).map(m => m.id);
    (["player", "scenario"] as const).forEach((source, i) => w.act({ do: "propose", source, proposal: {
      id: `${source}-1`, kind: "intro", participants: [free[2 * i]!, free[2 * i + 1]!], alternates: [], objective: "one-to-one intro", category: "social", city: "nyc",
      window: { start: start + 2 * DAY, end: start + 6 * DAY }, score: 0, components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
      exploration: false, explanations: {}, generator: source, createdAt: start + 19 * HOUR,
    } }));
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
    const [a, bb] = queue.filter(q => q.origin === "engine").length >= 2 ? queue.filter(q => q.origin === "engine") : queue;
    const decidedAt = w.clock.now();
    expect(net.review(a!.oppId, "approve", { reviewer: "sim" })).toBe(true);
    expect(net.review(bb!.oppId, "reject", { reason: "weak_reason", reviewer: "sim" })).toBe(true);
    expect(net.review(bb!.oppId, "approve")).toBe(false);
    const left = net.reviewQueue().map(q => q.oppId);
    await w.advanceTo(start + 2 * DAY + 30 * MINUTE);
    const probes = logs(records, "probe_sent");
    expect(probes.filter(l => l.detail.oppId === a!.oppId).length).toBeGreaterThan(0);
    expect(probes.filter(l => l.t < decidedAt)).toEqual([]);
    const about = (id: string) => outbound(records).filter(m => m.msg.meta?.proposalId === id || (m.msg.meta?.probe as { key?: string } | undefined)?.key === id);
    expect(about(bb!.oppId)).toEqual([]);
    const expired = new Set(logs(records, "review_expired").map(l => String(l.detail.oppId)));
    for (const id of left) { expect([id, expired.has(id) || net.opps.get(id)?.closedFrom === "review"]).toEqual([id, true]); expect([id, about(id)]).toEqual([id, []]); }
    const approved = new Set(logs(records, "review_decision").filter(l => l.detail.decision === "approve").map(l => String(l.detail.oppId)));
    for (const l of probes) expect(approved.has(String(l.detail.oppId))).toBe(true);
  });

  await b.run("send-time recipient policy: minors, declined pairs and replies; stated ages fail closed", async () => {
    const { w, net, records, start, personas } = await world(1, 3, { review: "human" });
    await w.advanceTo(start + 6 * HOUR);
    const members = net.memberList();
    const minor = members.find(m => (personas.get(m.id)?.public.claimedAge ?? 99) < 18)!;
    const adult = members.find(m => !m.minor && m.stage !== "new" && !personas.get(m.id)?.hidden.adversarial)!;
    expect(net.recipientPolicy(minor.id, "probe")).toEqual({ ok: false, reason: "minor" });
    expect(net.recipientPolicy(adult.id, "reveal", { about: [adult.id, minor.id] })).toEqual({ ok: false, reason: "other_not_matchable" });
    expect(net.recipientPolicy(minor.id, "reply")).toEqual({ ok: true });
    expect(net.recipientPolicy(adult.id, "reminder", { about: [adult.id] })).toEqual({ ok: true });
    // Age policy on inbound messages: ordinary adult phrases never decline; a conflicting stated age fails closed to minor and goes to staff.
    const ages = new Map(w.snapshot().members.map(m => [m.id, m.age]));
    const [sober, teacher, kid] = net.memberList().filter(m => m.stage !== "new" && !m.minor && (ages.get(m.id) ?? 0) >= 25).map(m => m.id);
    w.act({ do: "say", persona: sober!, text: "I'm 4 years sober and I love climbing" });
    w.act({ do: "say", persona: teacher!, text: "I'm in 7th grade" });
    w.act({ do: "say", persona: kid!, text: "I am 12 years old" });
    await w.advanceTo(start + 7 * HOUR);
    expect(net.isDeclined(sober!)).toBe(false);
    expect(net.memberList().find(m => m.id === sober)!.minor).toBe(false);
    expect(net.memberList().find(m => m.id === teacher)!.minor).toBe(true);
    expect(logs(records, "age_conflict").map(l => l.detail.memberId).sort()).toEqual([teacher!, kid!].sort());
    expect(net.isDeclined(kid!)).toBe(false);
    expect(net.memberList().find(m => m.id === kid)!.minor).toBe(true);
    expect(net.safetyCases().some(c => c.memberId === kid && c.events.some(e => e.kind === "age_conflict"))).toBe(true);
  });

  // ---- consent beats push (21 days); attention and plans invariants on the consent arms --------------
  if (!o.quick) {
    const push = await runArm("push_baseline", { days: 21, seed: 1 });
    const consent: ArmResult[] = [];
    for (const seed of [1, 2, 3]) consent.push(await runArm("consent", { days: 21, seed }));
    b.track("fingerprint: consent vs push arms", true, digest([push, ...consent]));
    const sum = (f: (r: ArmResult) => number) => consent.reduce((x, r) => x + f(r), 0);
    const allYes = sum(r => r.proposalsAllYes) / sum(r => r.proposals);
    b.gate(`consent vs push: everyone-yes (pooled seeds 1-3) > ${ALL_YES_MIN}`, allYes > ALL_YES_MIN, allYes.toFixed(3));
    const inviteYes = sum(r => r.inviteYes) / sum(r => r.invitations);
    b.gate("consent vs push: invite-yes (pooled) > 0.85", inviteYes > 0.85, inviteYes.toFixed(3));
    b.gate("consent vs push: push all-yes < 0.25", push.proposalAllYesRate < 0.25, push.proposalAllYesRate.toFixed(3));
    b.gate("consent vs push: unsafe proposals < push / 4 (seed 1)", consent[0]!.unsafe < push.unsafe / 4, `${consent[0]!.unsafe} vs ${push.unsafe}`);
    b.gate("consent vs push: more meetings than push (seed 1)", consent[0]!.meetingsHeld > push.meetingsHeld, `${consent[0]!.meetingsHeld} vs ${push.meetingsHeld}`);
    b.gate(`consent vs push: meetings (pooled) > ${MEETINGS_MIN}`, sum(r => r.meetingsHeld) > MEETINGS_MIN, String(sum(r => r.meetingsHeld)));
    b.gate("consent vs push: > 5 new members joined (seed 1)", consent[0]!.newMembersJoined > 5, String(consent[0]!.newMembersJoined));
    b.gate("consent arms: 0 false flags", consent.every(r => (r.falseFlags ?? 0) === 0), consent.map(r => r.falseFlags).join(","));
    b.gate("consent arms: judge 0 invariants, canary leaks, minor contacts (quiet hours, over budget, streak included)",
      consent.every(r => r.judge.invariants === 0 && r.judge.canaryLeaks === 0 && r.judge.minorContacts === 0), consent.map(r => JSON.stringify(r.judge.byRule)).join(" "));
    const P = consent.map(r => r.plans!);
    b.gate("plans: plans booked and held (pooled seeds 1-3)", P.reduce((x, p) => x + p.planMeetingsHeld, 0) > 0, P.map(p => p.planMeetingsHeld).join(","));
    b.gate("plans: 0 minors in any plan role", P.every(p => p.minorsInPlans === 0));
    b.gate("plans: no names before booking (quorum), no reveal before quorum", P.every(p => p.namesBeforeBooking === 0 && p.revealsBeforeQuorum === 0), P.map(p => `${p.namesBeforeBooking}/${p.revealsBeforeQuorum}`).join(","));
    // The intro cap per participation state is checked on the invariant run above and by the judge (over_budget = 0).
    b.gate("plans: <= 1 plan invite per member per 7 days (the plan lane)", P.every(p => p.maxPlanInvites7d <= 1), P.map(p => p.maxPlanInvites7d).join(","));
  }

  // ---- NYC scenarios ------------------------------------------------------------------------------------
  for (const s of SCENARIOS) {
    const r = await runScenario(s);
    const failed = r.checks.filter(c => !c.pass);
    b.gate(`scenario ${s.id}`, failed.length === 0, failed.map(c => `${c.name}: ${c.detail}`).join("; "));
  }

  // ---- sim/scenarios/*.json against the push stub (pass^3), and a negative control -------------------------
  const dir = `${import.meta.dir}/../../packages/sim/scenarios`;
  for (const f of readdirSync(dir).filter(x => x.endsWith(".json")).sort()) {
    const s = await loadScenario(`${dir}/${f}`);
    const r = await runScenarioPassK(s, o.quick ? 1 : 3, { network: sc => new StubNetwork({ seed: s.seed, ...sc.stub }) });
    const failed = r.runs.flatMap(x => x.results.filter(y => y.status === "fail").map(y => y.expectation.check));
    b.gate(`sim scenario ${f} (pass^${r.k})`, r.passK && r.runs.every(x => x.results.some(y => y.status === "pass")), [...new Set(failed)].join(", "));
  }
  {
    const s = await loadScenario(`${dir}/private-disclosure-canary.json`);
    const r = await runSimScenario({ ...s, background: { personas: 6 } }, { network: () => new StubNetwork({ seed: 1, leakyExplanations: true, introRate: 1 }) });
    b.gate("negative control: the canary check fails against a leaky network", r.results.find(x => x.expectation.check === "canary_not_leaked")?.status === "fail");
  }

  // ---- conformance rules for networkPack (engine level) ---------------------------------------------------
  await conformance(b, networkPack, { seeds: o.quick ? [1, 2] : [1, 2, 3, 4] });
}
