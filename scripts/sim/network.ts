import { isDeepStrictEqual } from "node:util";
// The network block: the consent-first ConsentNetwork in the simulated NYC world (data/synthetic/v1),
// with the simulated reviewer. Pinned: invariants on seed 3 over 10 days; consent vs push on seeds 1-3
// over 21 days; every NYC scenario; every sim/scenarios/*.json at pass^3 against the push stub; the
// attention and plans invariants on the consent arms; and the shared conformance rules for networkPack.
import { fileAt } from "../../packages/core/src/runtime/files.ts";
import { spawnProcessSync } from "../../packages/core/src/runtime/process.ts";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { canBeMatched, classifyYesNo, DAY, earliestDayKeyOf, EngineRng, hash32, HOUR, latestDayKeyOf, MINUTE, Rng as SimRng, SimClock, type Facet, type MemberId, type NetworkContext, type NetworkUnderTest, type QualitySignals, type SimMessage, type SimMeta } from "../../packages/core/src/index.ts";
import { bookedCancellationPrefix } from "../../packages/core/src/generated/outboundAdmission.ts";
import { resolveConfig } from "../../packages/engine/src/config.ts";
import { availabilityProb, standingFromFacets } from "../../packages/engine/src/attention.ts";
import { localEmbed } from "../../packages/engine/src/embed.ts";
import { DEFAULT_ATTENTION, runEngine } from "../../packages/engine/src/index.ts";
import { memberQualityBandOf, memberReason, memberVampireTierOf, pairLeagueAndVampireReason } from "../../packages/engine/src/filters.ts";
import { exposureFloor } from "../../packages/engine/src/policy.ts";
import { computeComponents } from "../../packages/engine/src/scoring.ts";
import { networkPack } from "../../packages/engine/src/packs/network/index.ts";
import { makeSlopPack, SLOP_ENGINE_CONFIG } from "../../packages/engine/src/packs/slop/index.ts";
import { UNRATED_PREDICTIVE_DATE_STANDING } from "../../packages/engine/src/packs/slop/standing.ts";
import { friendsPack } from "../../packages/engine/src/packs/friends/index.ts";
import { peonPack, PEON_ENGINE_CONFIG } from "../../packages/engine/src/packs/peon/index.ts";
import { peonVectors } from "../../packages/engine/src/packs/peon/match.ts";
import {
  bilateralValueCompensates, lawAestheticWalledToDateOnly, lawMinorsNeverLeagueGated,
  lawPeonFirewallZeroesProtectedAxes, lawQuietHighStatusNotPenalized, leaguePairAllowed,
  type LeagueAxisProfile, type LeagueLane,
} from "../../packages/core/src/generated/qualityAndLeague.ts";
import { baseMember, emptyInput, randomWorld } from "../../packages/engine/src/testkit.ts";
import { World as EngineWorld } from "../../packages/engine/src/world.ts";
import type { RunRecord } from "../../packages/core/src/index.ts";
import { computeMetrics } from "../../packages/sim/src/judge/metrics.ts";
import type { PersonaAgent } from "../../packages/sim/src/agent/types.ts";
import { INTERESTS, PolicyPersonaAgent, StubNetwork, World, evaluateExpectations, loadScenario, runScenario as runSimScenario, runScenarioPassK, runWorld, scenarioWorldOptions, type Scenario } from "../../packages/sim/src/index.ts";
import { friendFactory, nycPersonas, runArm, runScenario, SCENARIOS, type ArmResult } from "../../packages/network/harness/index.ts";
import { allowedAt, ConsentNetwork, holdEveryItem, NY, OUTREACH, reviewTicket, SIM_REVIEW_JUDGE, simulatedReviewJudge, VENUES, type NetworkOptions } from "../../packages/network/src/index.ts";
import { simulatedStaffAction } from "../../packages/core/src/generated/automatedReview.ts";
import { Projector } from "../../apps/observatory/src/projector.ts";
import { Store } from "../../apps/observatory/src/store.ts";
import { styleViolations } from "../../packages/network/src/copy.ts";
import { Mini, START } from "../../packages/network/test/mini.ts";
import { DATA_DIR } from "../synthetic/common.ts";
import { loadSnapshot } from "../synthetic/load.ts";
import { feedbackAfterFraudGate, fraudReversalEligibilityGate, vouchCreditEligibilityGate, vouchPeriodGate, vouchStakeEligibilityGate } from "./capital.ts";
import { conformance, teenConformance } from "./conformance.ts";
import { teenJudgeGates } from "./teen-judge.ts";
import { birthKeyForAgeOn, generatePersonas, TEEN_WORLD } from "../../packages/sim/src/generator.ts";
import { DEFAULT_START } from "../../packages/sim/src/world.ts";
import { ageOnDay } from "../../packages/core/src/generated/memberAge.ts";
import { teenFriendCandidate, teenFriendMaxAge, teenPartnerAge, teenReady, teenRosterSizeAllowed } from "../../packages/core/src/generated/friendIntroAge.ts";
import { teenFriendApp, teenFriendCategory } from "../../packages/core/src/generated/matchLane.ts";
import type { Candidate, EngineInput } from "../../packages/engine/src/types.ts";
import { Block, digest, expect } from "./gate.ts";
import { meanInterval, overlap, pairedLine } from "../../packages/sim/src/paired.ts";
import { teenShape } from "../../packages/sim/src/teen.ts";

type Msg = Extract<RunRecord, { type: "message" }>;
type Log = Extract<RunRecord, { type: "network_log" }>;
const logs = (records: RunRecord[], kind: string) => records.filter((r): r is Log => r.type === "network_log" && r.kind === kind);
const outbound = (records: RunRecord[]) => records.filter((r): r is Msg => r.type === "message" && r.msg.direction === "outbound" && !r.msg.system);

class MessageFixtureNetwork extends StubNetwork {
  channelContext!: NetworkContext;
  override init(ctx: NetworkContext) { super.init(ctx); this.channelContext = ctx; }
}

/**
 * Regression floors (audit P2-20), not targets: pooled over seeds 1-3 at the CI lower bound.
 * Recalibrated from 140 to 120 after OPP18 requester re-ask (spec/probeDispatch.md:44) and
 * D15-D17 single-swap automated review coverage (spec/probeDispatch.md:141) shifted the 3-seed
 * A/A baseline to 135-138 +/- 13.8 pooled SD (docs/results/2026-10-08-network-hardening.md).
 */
const ALL_YES_MIN = 0.73;
const MEETINGS_MIN = 120;

function meetingKeys(records: RunRecord[]): string[] {
  return records.filter((r): r is Extract<RunRecord, { type: "outcome" }> => r.type === "outcome")
    .map(o => Object.entries(o.attendance).filter(([, a]) => a.showed).map(([id]) => id).sort())
    .filter(ids => ids.length >= 2).map(ids => ids.join(",")).sort();
}

const SIM_STAFF = "sim-staff";

function simulatedStaffDesk(net: ConsentNetwork): NetworkUnderTest {
  return {
    name: net.name,
    init: ctx => net.init(ctx),
    onInbound: msg => net.onInbound(msg),
    submitProposal: p => net.submitProposal(p),
    tick: async now => {
      await net.tick(now);
      for (const item of net.reviewQueue()) {
        if (!item.exception) continue;
        const action = simulatedStaffAction(reviewTicket(item.oppId, item.revision, "staff"));
        if (action === "SimStaffApproves") net.decide(item.oppId, "approve", { reviewer: SIM_STAFF, revision: item.revision });
        else if (action === "SimStaffRejects") net.decide(item.oppId, "reject", { reviewer: SIM_STAFF, revision: item.revision, reason: "weak_reason" });
      }
    },
  };
}

const standInJudge = (exceptions: boolean): NetworkOptions => ({ inlineJudge: simulatedReviewJudge({ exceptions }) });

async function world(days: number, seed = 3, network: NetworkOptions = standInJudge(false), staffDesk = true) {
  const personas = await nycPersonas();
  const start = (await fileAt(`${DATA_DIR}/manifest.json`).json()).snapshotNow as number;
  // The NYC world is one market.
  const net = new ConsentNetwork({ seed, ...network, engine: { cities: ["nyc"], ...network.engine } });
  const records: RunRecord[] = [];
  const w = new World({ seed, personas, days, start, app: net.app.id, writeLog: false, network: staffDesk ? simulatedStaffDesk(net) : net, agent: new PolicyPersonaAgent(start), spawnFriend: friendFactory({ seed }), onRecord: r => records.push(r) });
  await w.begin();
  return { w, net, records, start, personas: new Map(w.personaList().map(p => [p.id, p])) };
}

async function ntwrkTeenArm(seed: number, days: number, stopAfterDays?: number) {
  const personas = generatePersonas({ n: 240, seed: `ntwrk-teen:${seed}`, cityWeights: { nyc: 1, sf: 0 }, ...TEEN_WORLD, idPrefix: "t" });
  const net = new ConsentNetwork({ seed, ...standInJudge(false), engine: { cities: ["nyc"] } });
  const records: RunRecord[] = [];
  const w = new World({ seed, personas, days, start: DEFAULT_START, app: net.app.id, writeLog: false, network: simulatedStaffDesk(net), agent: new PolicyPersonaAgent(DEFAULT_START), onRecord: r => records.push(r) });
  await w.begin();
  if (stopAfterDays !== undefined) {
    await w.advanceTo(DEFAULT_START + stopAfterDays * DAY);
    const stopped = net.stopTeenIntros(SIM_ADMIN);
    if (!stopped.ok) throw new Error(`ntwrk teen world: the stop was refused (${stopped.reason})`);
  }
  await w.advanceTo(w.end);
  await w.complete();
  return { net, records, personas: new Map(w.personaList().map(p => [p.id, p])) };
}

function ntwrkTeenWorld(seed: number): EngineInput {
  const input = randomWorld({ members: 120, seed, minorShare: 0.25 });
  const minDay = earliestDayKeyOf(input.now), maxDay = latestDayKeyOf(input.now);
  const members = input.members.map(m => {
    if (m.age > teenFriendMaxAge + 1) return m;
    const birthKey = birthKeyForAgeOn(m.age, minDay, new SimRng(hash32("ntwrk-birth", seed, m.id)));
    const ready = teenReady(true, false, false, false, false, false)
      && (teenFriendCandidate(canBeMatched(m.age), true, birthKey, minDay, maxDay, true, teenFriendApp("ntwrk")) || teenPartnerAge(birthKey, minDay, maxDay));
    return { ...m, birthKey, birthExact: true, ageConflict: false, maxAge: ageOnDay(birthKey, maxDay), ...(ready ? { teenReady: true } : {}) };
  });
  return { ...input, members, teenIntros: true };
}

const teenRosterOf = (o: { participants: readonly string[]; alternates: readonly string[]; plan?: { hostId?: string } }) =>
  [...new Set([...o.participants, ...o.alternates, ...(o.plan?.hostId ? [o.plan.hostId] : [])])];

const SIM_ADMIN = "sim-admin";
type NetOpp = ConsentNetwork["opps"] extends Map<string, infer O> ? O : never;
type StatedPersona = { public: { claimedAge: number; birthKey?: number } };

const statedMinorAt = (p: StatedPersona | undefined, t: number): boolean =>
  !!p && (p.public.birthKey !== undefined ? ageOnDay(p.public.birthKey, earliestDayKeyOf(t)) < 18 : p.public.claimedAge < 18);

const birthAgeOn = (birthKey: number, dayKey: number): number => Math.floor((dayKey - birthKey) / 10_000);

function teenAgeOracleFault(roster: readonly string[], personas: ReadonlyMap<string, StatedPersona>, t: number, until: number): string | undefined {
  const born = roster.map(id => personas.get(id)?.public.birthKey).filter((k): k is number => k !== undefined);
  if (born.length !== roster.length) return "a member without a stated birth date";
  const minDay = earliestDayKeyOf(t), maxDay = latestDayKeyOf(until);
  const minors = born.filter(k => birthAgeOn(k, minDay) < 18);
  if (minors.length === 0) return undefined;
  if (roster.length > 6) return `${roster.length} members`;
  if (born.some(k => birthAgeOn(k, maxDay) >= 19)) return "a member aged 19 or more";
  if (born.some(k => birthAgeOn(k, minDay) < 13)) return "a member under 13";
  for (const m of minors) if (born.some(k => Math.abs(k - m) > 20_000)) return "a pair with a minor born more than 2 calendar years apart";
  return undefined;
}

const loggedRoster = (l: Log): string[] => {
  const proposal = l.detail.proposal as { participants?: unknown; alternates?: unknown } | undefined;
  return [...(Array.isArray(proposal?.participants) ? proposal.participants : []), ...(Array.isArray(proposal?.alternates) ? proposal.alternates : [])]
    .filter((x): x is string => typeof x === "string");
};

function teenShapeHolds(app: string, x: NetOpp): boolean {
  const roster = teenRosterOf(x);
  return teenShape(app, roster, x).laneOk && teenRosterSizeAllowed(true, roster.length);
}

const recordedApprover = (approver: unknown, reviewer: unknown) =>
  (approver === "judge" && reviewer === SIM_REVIEW_JUDGE) || (approver === "staff" && reviewer === SIM_STAFF);

function judgeApprovals(records: RunRecord[]): { decision: Log; judgment: Log | undefined }[] {
  const last = new Map<string, Log>();
  const out: { decision: Log; judgment: Log | undefined }[] = [];
  for (const r of records) {
    if (r.type !== "network_log") continue;
    if (r.kind === "review_judgment") last.set(String(r.detail.oppId), r);
    if (r.kind === "review_decision" && r.detail.decision === "approve" && r.detail.approver === "judge") out.push({ decision: r, judgment: last.get(String(r.detail.oppId)) });
  }
  return out;
}

function reviewerFaults(net: ConsentNetwork, records: RunRecord[], personas: ReadonlyMap<string, StatedPersona>): string[] {
  const faults: string[] = [];
  const held = new Set(logs(records, "review_exception").map(l => String(l.detail.oppId)));
  const check = (id: unknown, t: number, approval: boolean, approver: unknown, reviewer: unknown, logged: readonly string[]) => {
    const opp = typeof id === "string" ? net.opps.get(id) : undefined;
    const statedMinor = (opp ? teenRosterOf(opp) : logged).some(x => statedMinorAt(personas.get(x), t));
    if (statedMinor && opp?.teenRuleAt === undefined) faults.push(`${String(id)}: a stated minor without the teen rule`);
    if (!approval) {
      if (reviewer !== SIM_STAFF) faults.push(`${String(id)}: a staff decision by reviewer ${String(reviewer)}`);
      return;
    }
    if (!recordedApprover(approver, reviewer)) faults.push(`${String(id)}: approver ${String(approver)}, reviewer ${String(reviewer)}`);
    if (approver === "staff" && !held.has(String(id))) faults.push(`${String(id)}: staff approved an item the judge did not hold`);
  };
  for (const l of logs(records, "review_decision")) check(l.detail.oppId, l.t, l.detail.decision === "approve", l.detail.approver, l.detail.reviewer, []);
  for (const l of logs(records, "probe_started")) check((l.detail.proposal as { id?: unknown } | undefined)?.id ?? l.detail.oppId, l.t, true, l.detail.approver, l.detail.reviewer, loggedRoster(l));
  for (const { decision, judgment } of judgeApprovals(records)) {
    const id = String(decision.detail.oppId);
    if (!judgment || judgment.detail.verdict !== "approve" || judgment.detail.stale !== false || judgment.detail.revision !== decision.detail.revision)
      faults.push(`${id}: a judge approval without its applied judgment`);
  }
  return faults;
}

function judgedApprovalFaults(records: RunRecord[]): { adultRubricMinor: string[]; stalePacket: string[] } {
  const adultRubricMinor: string[] = [], stalePacket: string[] = [];
  for (const { decision, judgment } of judgeApprovals(records)) {
    const id = String(decision.detail.oppId);
    if (!judgment) continue;
    if (judgment.detail.rubric === "adult" && judgment.detail.rosterHasMinor !== false) adultRubricMinor.push(id);
    if (judgment.detail.basePacketHash !== judgment.detail.currentHash) stalePacket.push(id);
  }
  return { adultRubricMinor, stalePacket };
}

/**
 * Invite chains may be stored under alias ids (ME-006). The walk must finish.
 * A repeated canonical id stops the walk. A chain stops before a minor (PRD 33.8).
 * Seed 1. The input is fixed. The walk does not use the model.
 */
export async function inviteRootGate(b: Block): Promise<void> {
  await b.run("inviter cohort resolves alias invite chains and stops on a repeated canonical id", () => {
    const now = Date.UTC(2026, 9, 5, 16);
    const input = emptyInput(now);
    input.members = [
      baseMember("a", { invitedBy: "phone:b" }),
      baseMember("b", { invitedBy: "phone:a" }),
      baseMember("c", { invitedBy: "phone:a" }),
      baseMember("d", { invitedBy: "phone:e" }),
      baseMember("e", { invitedBy: "f" }),
      baseMember("f"),
      baseMember("g", { invitedBy: "phone:teen" }),
      baseMember("p", { invitedBy: "q" }),
      baseMember("q", { invitedBy: "p" }),
      baseMember("s", { invitedBy: "phone:s" }),
      baseMember("teen", { age: 16 }),
    ];
    input.idAliases = { "phone:a": "a", "phone:b": "b", "phone:e": "e", "phone:s": "s", "phone:teen": "teen" };
    const w = new EngineWorld(input, resolveConfig({ seed: 1 }), localEmbed);
    const root = (id: string) => w.get(id)!.inviterRoot;
    // a <-> b through aliases. Stop on the repeated canonical id, as a direct id cycle does.
    expect(root("a")).toBe("b");
    expect(root("b")).toBe("a");
    expect(root("c")).toBe("b");
    expect(root("d")).toBe("f");
    expect(root("e")).toBe("f");
    expect(root("f")).toBe("f");
    expect(root("g")).toBe("g");
    expect(root("p")).toBe("q");
    expect(root("q")).toBe("p");
    expect(root("s")).toBe("s");
    expect(root("teen")).toBe("teen");
    expect(w.minors.has("teen")).toBe(true);
  });
}

export async function scenarioRepetitionGate(b: Block): Promise<void> {
  await b.run("scenario CLI: repetitions must be a positive integer; default and one run execute checks", () => {
    const root = `${import.meta.dirname}/../..`;
    const run = (k?: string) => spawnProcessSync([
      process.execPath, "--import", "tsx", "--conditions", "eliza-source", "packages/sim/src/cli.ts", "--scenario", "packages/sim/scenarios/band-week-apart.json", "--no-log",
      ...(k === undefined ? [] : [`--k=${k}`]),
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    for (const k of ["0", "-1", "1.5", "invalid"]) {
      const result = run(k);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("positive integer");
      expect(result.stdout.toString()).not.toContain("pass^");
    }
    for (const k of [undefined, "1"]) {
      const result = run(k);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("pass^1: PASS (1/1)");
      expect(result.stdout.toString()).toMatch(/\n\s+pass\s+metric:/);
    }
  });
}

export async function scenarioAttendanceEvidenceGates(b: Block): Promise<void> {
  const template = await loadScenario(`${import.meta.dirname}/../../packages/sim/scenarios/group-flake-morning-of.json`);
  const network = () => new StubNetwork({ randomIntros: false });
  await b.run("scenario held evidence needs a second attendee even when one is named", async () => {
    for (const seed of [2, 10, 15]) for (const flake of [false, true]) {
      const s = structuredClone(template);
      s.personas = s.personas.slice(0, 2);
      for (const p of s.personas) p.preferredGroupSize = 2;
      s.actions = s.actions.filter(a => a.do !== "force_flake" || flake);
      for (const a of s.actions) {
        if (a.do === "force_flake") { a.persona = "dinner-1"; a.how = "no_show"; }
        if (a.do === "propose") {
          a.participants = s.personas.map(p => p.ref);
          a.kind = "intro";
          a.objective = "dinner for two";
        }
      }
      s.expectations = [{ check: "meeting_held", personas: ["dinner-2"], min: 1 }];
      const result = await runSimScenario(s, { seed, network });
      expect(result.world.metrics.meetings.held).toBe(flake ? 0 : 1);
      expect(result.results[0]?.status).toBe(flake ? "fail" : "pass");
    }
  });

  await b.run("scenario cancellation evidence needs delivery to each remaining participant", async () => {
    for (const seed of [2, 7, 29]) for (const noShow of [false, true]) for (const failureRate of [0, 0.1]) {
      const scenario = structuredClone(template);
      if (noShow) scenario.actions.unshift({ at: { day: 0, hour: 20 }, do: "force_flake", persona: "dinner-5", how: "no_show" });
      const w = await runWorld({ ...scenarioWorldOptions(scenario, { seed, network }), failureRate });
      const outcome = w.records.find(r => r.type === "outcome");
      const booking = w.records.findLast(r => r.type === "meeting_scheduled");
      expect(outcome?.attendance["dinner-4"]?.cancelledWithNotice).toBe(true);
      expect(w.metrics.meetings.held).toBe(1);
      const recipients = booking!.participants.filter(id => id !== "dinner-4" && !outcome!.attendance[id]?.cancelledWithNotice);
      const grade = evaluateExpectations(scenario, w, "stub").find(r => r.expectation.check === "others_notified_of_drop");
      expect(grade?.status).toBe(failureRate ? "fail" : "pass");
      expect(grade?.detail).toBe(`${recipients.length - (failureRate ? 1 : 0)}/${recipients.length} notified`);
    }
  });

  await b.run("participant cancellation counts only when the notice reaches the channel before the meeting", async () => {
    for (const mode of ["early", "late", "stopped"] as const) {
      const scenario = structuredClone(template);
      scenario.days = 9;
      scenario.actions = scenario.actions.filter(a => a.do !== "force_flake");
      const persona = scenario.personas.find(p => p.ref === "dinner-4")!;
      persona.flakiness = 1;
      persona.responsiveness = { latencyMedianMin: mode === "early" ? 20 : 600, latencySigma: 0, ignoreProb: 0 };
      if (mode === "stopped") scenario.actions.push({ at: { day: 3, hour: 16 }, do: "opt_out", persona: persona.ref });
      scenario.expectations = [{ check: "flake_notice", persona: persona.ref }];
      const run = await runSimScenario(scenario, { seed: 1, network });
      const outcome = run.world.records.find(r => r.type === "outcome")!;
      const decision = run.world.records.find(r => r.type === "decision" && r.memberId === persona.ref && r.intent === "flake_notice");
      const notice = run.world.channel.all().find(m => m.direction === "inbound" && m.memberId === persona.ref && /can't make it/.test(m.body));
      expect(decision?.t).toBeLessThan(outcome.at);
      expect(notice?.status ?? null).toBe(mode === "stopped" ? null : "delivered");
      expect(notice ? notice.ts < outcome.at : null).toBe(mode === "stopped" ? null : mode === "early");
      expect(outcome.attendance[persona.ref]).toMatchObject({ showed: false, cancelledWithNotice: mode === "early" });
      expect(run.world.metrics.meetings.noShowRate).toBe(mode === "early" ? 0 : 0.167);
      expect(run.results[0]?.status).toBe(mode === "early" ? "pass" : "fail");
    }
  });

  await b.run("only timely delivery of an exact booking cancellation changes a recipient's attendance", async () => {
    const cases = [
      { size: 2, seed: 21, how: "notice", failureRate: 0, present: 0, ownNotice: true, terminal: true, noShowRate: 0, notified: "pass" },
      { size: 6, seed: 21, how: "notice", failureRate: 0, present: 5, ownNotice: true, terminal: false, noShowRate: 0, notified: "pass" },
      { size: 2, seed: 21, how: "no_show", failureRate: 0, present: 1, ownNotice: false, terminal: false, noShowRate: 0.5, notified: "fail" },
      { size: 2, seed: 35, how: "notice", failureRate: 0.1, present: 1, ownNotice: true, terminal: false, noShowRate: 0, notified: "fail" },
      { size: 2, seed: 21, how: "none", failureRate: 0, present: 2, ownNotice: false, terminal: false, noShowRate: 0, notified: "fail" },
    ] as const;
    for (const check of cases) {
      const scenario = structuredClone(template);
      scenario.days = 8;
      scenario.personas = scenario.personas.slice(0, check.size);
      if (check.size === 2) for (const person of scenario.personas) person.preferredGroupSize = 2;
      scenario.actions = scenario.actions.filter(a => a.do !== "force_flake" || check.how !== "none");
      for (const action of scenario.actions) {
        if (action.do === "force_flake" && check.how !== "none") { action.persona = "dinner-1"; action.how = check.how; }
        if (action.do === "propose") {
          action.participants = scenario.personas.map(p => p.ref);
          if (check.size === 2) action.kind = "intro";
        }
      }
      scenario.expectations = [{ check: "others_notified_of_drop", persona: "dinner-1" }];
      const network = new MessageFixtureNetwork({ randomIntros: false });
      const options = scenarioWorldOptions(scenario, { seed: check.seed, network: () => network });
      const store = new Store({ mode: "game", label: "Synthetic", dataset: "Synthetic",
        capabilities: { canStep: true, canIntervene: false, hiddenTruth: true, readOnly: false },
      }, { now: options.start!, start: options.start!, day: 1, playing: false, speed: 0, waitingForPlayer: false });
      const projector = new Projector(store);
      let stateAtOutcome: string | undefined;
      const sim = new World({ ...options, failureRate: check.failureRate, onRecord: r => {
        projector.apply(r);
        if (r.type === "outcome") stateAtOutcome = store.opps.get(r.proposalId)?.state;
      } });
      await sim.begin();
      if (check.how === "none") {
        await sim.advanceTo(sim.clock.now() + 2 * DAY + 10 * HOUR);
        const booking = sim.channel.all().find(m => m.meta?.type === "scheduling" && m.memberId === "dinner-2")!;
        expect(booking.meta?.meetingAt).toBeGreaterThan(sim.clock.now());
        const textOnly = network.channelContext.send("dinner-2", "I'm calling this one off.", {
          meta: { type: "cancellation", proposalId: booking.meta?.proposalId },
        });
        expect(textOnly.status).toBe("delivered");
        expect(store.opps.get(booking.meta!.proposalId!)?.state).toBe("SCHEDULED");
      }
      await sim.advanceTo(sim.end - HOUR);
      if (check.failureRate) {
        const failed = sim.channel.all().find(m => m.meta?.type === "cancellation")!;
        expect(failed.status).toBe("failed");
        const late = network.channelContext.send(failed.memberId, failed.body, { meta: failed.meta });
        expect(late.status).toBe("delivered");
      }
      if (check.how === "none") {
        const booking = sim.channel.all().find(m => m.meta?.type === "scheduling" && m.memberId === "dinner-2")!;
        const late = network.channelContext.send("dinner-2", "I'm calling this one off.", {
          meta: { type: "cancellation", proposalId: booking.meta!.proposalId, meetingAt: booking.meta!.meetingAt },
          idempotencyKey: `${bookedCancellationPrefix}${booking.meta!.proposalId}:dinner-2`,
        });
        expect(late.status).toBe("delivered");
        expect(late.ts).toBeGreaterThan(booking.meta!.meetingAt!);
      }
      await sim.advanceTo(sim.end);
      const world = await sim.complete();
      const outcome = world.records.find(r => r.type === "outcome")!;
      const present = Object.values(outcome.attendance).filter(a => a.showed).length;
      expect(present).toBe(check.present);
      expect(outcome.attendance["dinner-1"]?.cancelledWithNotice).toBe(check.ownNotice);
      expect(outcome.attendance["dinner-2"]).toMatchObject({ cancelledWithNotice: false });
      expect(outcome.attendance["dinner-2"]?.cancelledByNetwork === true).toBe(check.terminal);
      const acceptedCancellation = world.records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.bookingNoticeMeetingId === outcome.meetingId);
      expect(acceptedCancellation.length).toBe(check.terminal ? 1 : 0);
      const projected = store.opps.get(outcome.proposalId)!;
      expect(stateAtOutcome).toBe(check.terminal ? "CANCELLED" : check.present >= 2 ? "COMPLETED" : "ABANDONED");
      expect(projected.status["dinner-1"]).toBe(check.ownNotice ? "cancelled_with_notice" : check.how === "no_show" ? "no_show" : "attended");
      expect(projected.status["dinner-2"]).toBe(check.terminal ? "confirmed" : "attended");
      expect(store.counts.attended).toBe(check.present);
      expect(store.counts.noShows).toBe(check.how === "no_show" ? 1 : 0);
      expect(store.counts.cancelledWithNotice).toBe(check.ownNotice ? 1 : 0);
      expect(world.metrics.meetings.noShowRate).toBe(check.noShowRate);
      expect(evaluateExpectations(scenario, world, network.name)[0]?.status).toBe(check.notified);
    }
  });
}

export async function scenarioContactEvidenceGates(b: Block): Promise<void> {
  const seed = 3;
  const scenario: Scenario = {
    name: "contact-evidence", description: "Grade received messages and inferred simulated counterparts.",
    seed, days: 3,
    personas: [
      { ref: "recipient", name: "Maya Rivera", age: 29 },
      { ref: "minor", name: "Noé Reyes", age: 15 },
      { ref: "blocked", name: "Al Brennan", age: 30 },
      { ref: "other", name: "Alex Parker", age: 30 },
      { ref: "shared-one", name: "Rae Vega", age: 29 },
      { ref: "shared-two", name: "Rae Vance", age: 29 },
      { ref: "distinct", name: "Rae Young", age: 29 },
      { ref: "prefixed", name: "Noéline Reyes", age: 29 },
    ].map(p => ({ ...p, city: "sf", join: { day: 0, hour: 10 }, responsiveness: { ignoreProb: 0, latencyMedianMin: 1, latencySigma: 0 } })),
    actions: [{ at: { day: 1, hour: 10 }, do: "say", persona: "recipient", text: "block Al Brennan" }],
    expectations: [{ check: "no_contact", persona: "minor" }, { check: "blocked_pair_kept_apart", personas: ["recipient", "blocked"] }],
  };
  const startFixture = async () => {
    const network = new MessageFixtureNetwork({ seed, randomIntros: false });
    const sim = new World({ ...scenarioWorldOptions(scenario, { network: () => network }), failureRate: 0 });
    await sim.begin();
    await sim.advanceTo(sim.clock.now() + DAY + 22 * HOUR);
    return { network, sim };
  };
  const { network, sim } = await startFixture();
  const send = (body: string, meta: SimMeta = {}) => network.channelContext.send("recipient", body, { meta: { type: "proposal", ...meta } });
  const firstName = send("Would you like to meet Noe\u0301 for coffee?");
  const longerName = send("Would you like to meet Alex for coffee?");
  const longerMinorName = send("Would you like to meet Noéline for coffee?");
  const blockedName = send("Would you like to meet Al for coffee?");
  const metadata = send("Would you like to meet for coffee?", { probe: { key: "exact-minor", category: "social", participants: ["recipient", "minor"] } });
  const recordedRelay = send("Thanks for checking.", { type: "relay", relayFrom: "blocked" });
  const neutralCancel = send("That plan is off.", { type: "cancellation", participants: ["recipient", "blocked"] });
  network.channelContext.recordProposal({
    id: "scenario-alternates", kind: "intro", participants: ["recipient", "other"], alternates: ["minor", "blocked"],
    city: "sf", objective: "coffee", category: "social", score: 1, exploration: false,
    components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1 },
    explanations: {}, generator: "scenario", createdAt: sim.clock.now(),
    window: { start: sim.clock.now(), end: sim.end },
  }, "scenario");
  const linkedProposal = send("Would you like to meet for coffee tomorrow?", { proposalId: "scenario-alternates" });
  const explicitRoster = send("Would you like to meet for coffee on Tuesday?", {
    proposalId: "scenario-alternates", participants: ["recipient", "other"],
  });
  await sim.advanceTo(sim.end);
  const world = await sim.complete();
  const grade = (id: string) => evaluateExpectations(scenario, { ...world,
    records: world.records.filter(r => r.type !== "message" || r.msg.direction !== "outbound" || r.msg.id === id),
  }, network.name).map(x => x.status);

  await b.run("scenario contact evidence catches a unique first name or exact metadata", () => {
    expect(world.records.some(r => r.type === "block" && r.from === "recipient" && r.to === "blocked")).toBe(true);
    expect([grade(firstName.id), grade(longerMinorName.id), grade(metadata.id)]).toEqual([
      ["fail", "pass"], ["pass", "pass"], ["fail", "pass"],
    ]);
  });
  await b.run("scenario block evidence distinguishes a longer name from the blocked member", () => {
    expect([grade(longerName.id), grade(blockedName.id), grade(recordedRelay.id), grade(neutralCancel.id)]).toEqual([
      ["pass", "pass"], ["pass", "fail"], ["pass", "fail"], ["pass", "pass"],
    ]);
  });
  await b.run("scenario grading preserves minor alternates in a referenced proposal", () => {
    expect([grade(linkedProposal.id), grade(explicitRoster.id)]).toEqual([["fail", "pass"], ["pass", "pass"]]);
  });
  await b.run("simulator personas use unique display initials and preserve a recorded roster", async () => {
    const observed = [];
    for (const { body, participants } of [
      { body: "For coffee, would you like to meet Rae Y." },
      { body: "Would you like to meet Rae V. for coffee?" },
      { body: "Would you like to meet Rae for coffee?" },
      { body: "Would you like to meet Rae V.", participants: ["recipient", "shared-two"] },
    ]) {
      const { network, sim } = await startFixture();
      const message = network.channelContext.send("recipient", body, { meta: { type: "proposal", participants } });
      expect(message.status).toBe("delivered");
      await sim.advanceTo(sim.end);
      const result = await sim.complete();
      observed.push(result.memories.get("recipient")?.proposals[`inferred:${message.id}`]?.others);
    }
    expect(observed).toEqual([["distinct"], [], [], ["shared-two"]]);
  });
}

export async function heldForStaffGate(b: Block): Promise<void> {
  await b.run("held for staff (owner decision 2026-11-22, D17): a judge that holds every item contacts nobody until staff approve a held item; reject and expiry send nothing", async () => {
    const { w, net, records, start } = await world(3, 3, { inlineJudge: holdEveryItem.inline }, false);
    await w.advanceTo(start + 19 * HOUR);
    const free = net.memberList().filter(m => net.eligible(m.id)).map(m => m.id);
    (["player", "scenario"] as const).forEach((source, i) => w.act({ do: "propose", source, proposal: {
      id: `${source}-1`, kind: "intro", participants: [free[2 * i]!, free[2 * i + 1]!], alternates: [], objective: "one-to-one intro", category: "social", city: "nyc",
      window: { start: start + 2 * DAY, end: start + 6 * DAY }, score: 0, components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
      exploration: false, explanations: {}, generator: source, createdAt: start + 19 * HOUR,
    } }));
    await w.advanceTo(start + 22 * HOUR);
    const queue = net.reviewQueue();
    expect(queue.filter(q => q.origin === "player").map(q => q.oppId).sort()).toEqual(["player-1", "scenario-1"]);
    expect(queue.length).toBeGreaterThan(5);
    expect(queue.filter(q => q.kind !== "fraud").every(q => q.exception?.verdict === "flag" && q.exception.reason === "other_concern")).toBe(true);
    expect(logs(records, "review_decision").filter(l => l.detail.decision === "approve")).toEqual([]);
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
    // Approval opens the probe turn. Delivery can wait for an existing question or the member's send window.
    const probeDeadline = decidedAt + DEFAULT_ATTENTION.expiry.partnerProbeDays * DAY;
    await w.advanceTo(probeDeadline);
    const probes = logs(records, "probe_sent");
    expect(probes.filter(l => l.detail.oppId === a!.oppId).length).toBeGreaterThan(0);
    expect(probes.filter(l => l.t < decidedAt)).toEqual([]);
    const about = (id: string) => outbound(records).filter(m => m.msg.meta?.proposalId === id || (m.msg.meta?.probe as { key?: string } | undefined)?.key === id);
    expect(about(bb!.oppId)).toEqual([]);
    const expired = new Set(logs(records, "review_expired").map(l => String(l.detail.oppId)));
    for (const id of left) { expect([id, expired.has(id) || net.opps.get(id)?.closedFrom === "review"]).toEqual([id, true]); expect([id, about(id)]).toEqual([id, []]); }
    const approved = new Set(logs(records, "review_decision").filter(l => l.detail.decision === "approve").map(l => String(l.detail.oppId)));
    for (const l of probes) expect(approved.has(String(l.detail.oppId))).toBe(true);
    expect(logs(records, "review_decision").filter(l => l.detail.decision === "approve").map(l => [l.detail.oppId, l.detail.approver, l.detail.reviewer])).toEqual([[a!.oppId, "staff", "sim"]]);
  });
}

export async function exceptionArmGates(b: Block, o: { quick: boolean }): Promise<void> {
  const days = o.quick ? 7 : 21;
  const { w, net, records, personas } = await world(days, 3, standInJudge(true));
  await w.advanceTo(w.end);
  await w.complete();
  const exceptions = logs(records, "review_exception");
  const heldIds = new Set(exceptions.map(l => String(l.detail.oppId)));
  const staffApprovals = logs(records, "review_decision").filter(l => l.detail.decision === "approve" && l.detail.approver === "staff");
  const rejected = new Set(logs(records, "review_decision").filter(l => l.detail.decision === "reject" && l.detail.approver === "staff" && heldIds.has(String(l.detail.oppId))).map(l => String(l.detail.oppId)));
  const expired = new Set(logs(records, "review_expired").map(l => String(l.detail.oppId)).filter(id => heldIds.has(id)));
  const overdue = exceptions.filter(l => l.detail.reason === "judge_overdue");
  const ended = new Set([...rejected, ...expired]);
  const contacts = [
    ...logs(records, "probe_sent").filter(l => ended.has(String(l.detail.oppId))).map(l => `probe_sent ${String(l.detail.oppId)}`),
    ...outbound(records).filter(m => ended.has(String(m.msg.meta?.proposalId)) || ended.has(String((m.msg.meta?.probe as { key?: string } | undefined)?.key)))
      .map(m => `${String(m.msg.meta?.type)} ${m.msg.id}`),
  ];
  const m = computeMetrics(records, { requireReview: true });
  const sameDay = (id: string) => net.opps.get(id)?.sameDay === true;
  const tooClose = logs(records, "review_judgment").filter(l => l.detail.reason === "deadline_too_close");
  b.track(`exception arm (seed 3, ${days} days; review by the simulated judge, a deterministic stand-in with no model call, and simulated staff; the stand-in does not read text: text safety is measured only by the live qualification corpus)`, true,
    `${exceptions.length} held, ${staffApprovals.length} staff approvals, ${rejected.size} staff rejects, ${expired.size} expired, ${overdue.length} judge_overdue; same day: ${[...heldIds].filter(sameDay).length} held, ${[...expired].filter(sameDay).length} expired; deadline_too_close ${tooClose.length}`);
  b.gate("exception arm: the judge holds items (held > 0)", exceptions.length > 0, String(exceptions.length));
  b.gate("exception arm: staff approve held items (staff approvals > 0)", staffApprovals.length > 0, String(staffApprovals.length));
  b.gate("exception arm: held items expire unsent (expired exceptions > 0)", expired.size > 0, String(expired.size), !o.quick);
  b.gate("exception arm: a silent judge holds the item for staff (judge_overdue > 0)", overdue.length > 0, String(overdue.length), !o.quick);
  b.gate("exception arm: contacts of expired or rejected exceptions = 0", contacts.length === 0, contacts.slice(0, 5).join(", ") || "none");
  b.gate("exception arm: exception contact without staff = 0 and review approval recorded (unrecorded contacts = 0)",
    (m.invariants.byRule.exception_contact_without_staff ?? 0) === 0 && (m.invariants.byRule.unreviewed_contact ?? 0) === 0, JSON.stringify(m.invariants.byRule));
  b.gate("exception arm: judge 0 invariant violations, minor contacts, canary leaks and errors",
    m.invariants.total === 0 && m.safety.minorContacts === 0 && m.privacy.canaryLeaks === 0 && m.errors === 0, JSON.stringify(m.invariants.byRule));
  const faults = reviewerFaults(net, records, personas);
  b.gate("exception arm: every approval is the simulated judge's applied judgment or sim-staff's on a held item", faults.length === 0, faults.slice(0, 5).join(", ") || "none");
  const rubric = judgedApprovalFaults(records);
  b.gate("exception arm: minor roster approved with adult rubric = 0 and approval for a stale packet = 0",
    rubric.adultRubricMinor.length === 0 && rubric.stalePacket.length === 0, `adult rubric ${rubric.adultRubricMinor.length}, stale ${rubric.stalePacket.length}`);
}

export async function probeDeclineReceiptGate(b: Block): Promise<void> {
  await b.run("judge: a simulated probe decline needs its received reply", async () => {
    const [ada, bev] = (await nycPersonas()).slice(0, 2).map((p, i) => ({ ...p, name: i === 0 ? "Ada Harper" : "Bev Carter" }));
    const oppId = "probe-receipt";
    const refusal = "I'll sit this one out.";
    expect(classifyYesNo(refusal)).toBe("unsure");
    for (const mode of ["delivered", "structured", "ignored", "raw", "linked raw"] as const) {
      let ctx: NetworkContext;
      let probeId = "";
      const reveals: string[] = [];
      const network: NetworkUnderTest = {
        name: "probe-receipt",
        init(context) { ctx = context; },
        onInbound() {},
        tick(now) {
          if (now === START + 5 * MINUTE) {
            probeId = ctx.send(ada!.id, "Would you like to meet someone for coffee?", {
              meta: { type: "probe", probe: { key: oppId, category: "social", participants: [ada!.id, bev!.id], kind: "intro" } },
            }).id;
          }
          if (now === START + 15 * MINUTE || now === START + 35 * MINUTE) {
            reveals.push(ctx.send(bev!.id, "You can meet Ada Harper for coffee.", { meta: { type: "proposal", proposalId: oppId } }).id);
          }
          if (mode === "linked raw" && now === START + 15 * MINUTE) {
            ctx.send(ada!.id, "How would Thursday work?", { meta: { type: "scheduling", proposalId: "newer" } });
          }
          if (mode === "linked raw" && now === START + 35 * MINUTE) {
            ctx.send(bev!.id, "A different plan with Ada Harper.", { meta: { type: "proposal", proposalId: "newer" } });
          }
        },
      };
      const agent: PersonaAgent = {
        mode: "policy",
        async joinMessage() { return "Hello."; },
        async initiative() { return undefined; },
        async respond(_ctx, message) {
          if (message.id !== probeId) return { messageType: "info", intent: "ignore", decision: "none", delayMs: 0, action: "ignore" };
          if (mode === "linked raw") return { messageType: "probe", intent: "answer_question", decision: "none",
            delayMs: 20 * MINUTE, action: "reply", text: "No thanks." };
          const delivered = mode === "delivered" || mode === "structured";
          return { messageType: "probe", intent: mode === "structured" ? "decline" : "probe_no",
            decision: mode === "structured" ? "decline" : "none", proposalId: oppId, delayMs: 20 * MINUTE,
            ...(delivered ? { action: "reply", text: refusal } : { action: "ignore" }) };
        },
      };
      const world = new World({ seed: 1, personas: [ada!, bev!], days: 1 / 24, start: START, tickMinutes: 10, writeLog: false, network, app: "ntwrk", agent,
        actions: [
          { at: START, action: { do: "join", persona: ada!.id } },
          { at: START, action: { do: "join", persona: bev!.id } },
          ...(mode === "raw" ? [{ at: START + 25 * MINUTE, action: { do: "say" as const, persona: ada!.id, text: "No thanks." } }] : []),
        ],
      });
      const result = await world.run();
      expect(reveals.length).toBe(2);
      const exposed = result.metrics.invariants.examples.filter(x => x.rule === "decliner_exposed").map(x => x.detail.split(" ")[0]);
      expect({ mode, exposed }).toEqual({ mode, exposed: mode === "ignored" ? [] : [reveals[1]] });
      const reply = result.records.find((r): r is Msg => r.type === "message" && r.msg.direction === "inbound"
        && r.msg.body === (mode === "linked raw" ? "No thanks." : refusal));
      expect(reply?.msg.replyToMessageId).toEqual(mode === "delivered" || mode === "structured" || mode === "linked raw" ? probeId : undefined);
    }
  });
}

export async function generatorDryRunGate(b: Block): Promise<void> {
  await b.run("synthetic generator: --dry-run with --no-llm writes nothing", () => {
    const root = `${import.meta.dirname}/../..`;
    const dir = mkdtempSync(`${tmpdir()}/generator-dry-run-`);
    const out = `${dir}/out`;
    try {
      const result = spawnProcessSync([
        process.execPath, "--import", "tsx", "scripts/synthetic/generate.ts", "--no-llm", "--dry-run", "--out", out,
      ], { cwd: root, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0);
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

export async function engineReportMinorsGate(b: Block): Promise<void> {
  await b.run("synthetic load --engine: minorsInAnyProposal counts declared minors (0) and hiddenMinorsInAnyProposal counts age-liars separately", async () => {
    const root = `${import.meta.dirname}/../..`;
    const result = spawnProcessSync([
      process.execPath, "--import", "tsx", "scripts/synthetic/load.ts", "--engine", "--no-write",
    ], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()).engine;
    const hidden = readFileSync(`${DATA_DIR}/hidden_truth.jsonl`, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    const hiddenMinorIds = new Set(hidden.filter(h => h.hidden.trueAge < 18 && h.personaPublic.claimedAge >= 18).map(h => h.memberId));
    expect(hiddenMinorIds.size).toBeGreaterThan(0);
    const trueMinorIds = new Set(hidden.filter(h => h.hidden.trueAge < 18).map(h => h.memberId));
    const snap = await loadSnapshot(DATA_DIR);
    const { proposals } = await runEngine(snap, { seed: report.seed });
    const membersOf = (p: (typeof proposals)[number]) => [...p.participants, ...(p.alternates ?? []), ...((p as any).via ? [(p as any).via] : [])];
    const expectedHidden = proposals.filter(p => membersOf(p).some(id => hiddenMinorIds.has(id))).length;
    expect(report.checks.minorsInAnyProposal).toBe(0);
    expect(report.checks.hiddenMinorsInAnyProposal).toBe(expectedHidden);
    expect(report.checks.proposalRosters).toBeUndefined();
    expect(report.oracle.adults).toBe(snap.members.length - trueMinorIds.size);
  });
}

export async function hiddenKeysLeakGate(b: Block): Promise<void> {
  await b.run("synthetic validate: a hidden-only key in a public file fails the privacy split check", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const root = `${import.meta.dirname}/../..`;
    const dir = fs.mkdtempSync(`${os.tmpdir()}/hidden-keys-`);
    const check = (key: string | undefined) => {
      const copy = `${dir}/${key ?? "clean"}`;
      fs.cpSync(DATA_DIR, copy, { recursive: true });
      if (key !== undefined) {
        const file = `${copy}/members.jsonl`;
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), [key]: "x" });
        fs.writeFileSync(file, lines.join("\n"));
      }
      const out = `${copy}/result.json`;
      spawnProcessSync([
        process.execPath, "--import", "tsx", "scripts/synthetic/validate.ts", "--dir", copy, "--out", out,
      ], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const report = JSON.parse(fs.readFileSync(out, "utf8"));
      return report.checks.find((c: { name: string }) => c.name === "canaries_agent_private_and_hidden_split").pass as boolean;
    };
    try {
      expect(check(undefined)).toBe(true);
      for (const key of ["trueAge", "gender", "workplace", "personaPublic"]) expect([key, check(key)]).toEqual([key, false]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

export async function networkBlock(b: Block, o: { quick: boolean }): Promise<void> {
  await scenarioRepetitionGate(b);
  await generatorDryRunGate(b);
  await engineReportMinorsGate(b);
  await hiddenKeysLeakGate(b);
  await scenarioAttendanceEvidenceGates(b);
  await scenarioContactEvidenceGates(b);
  await inviteRootGate(b);
  await vouchPeriodGate(b);
  await fraudReversalEligibilityGate(b);
  await feedbackAfterFraudGate(b);
  await vouchCreditEligibilityGate(b);
  await vouchStakeEligibilityGate(b);
  await probeDeclineReceiptGate(b);
  await b.run("judge: a time counter requires agreement before a name can be revealed", () => {
    const person = (id: MemberId, name: string): RunRecord => ({ t: 0, type: "persona", persona: {
      id, name, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: 30, claimedAge: 30, quietHours: [23, 7], romanceOptIn: false,
    } });
    const run = (decision: "accept" | "counter" | "decline", intent: string = decision) => computeMetrics([
      person("ada", "Ada"), person("bev", "Bev"),
      { t: 1000, type: "message", msg: { id: "p1", ts: 1000, memberId: "ada", direction: "outbound", status: "delivered",
        body: "Want to meet someone for coffee this week?", meta: { type: "probe", probe: { key: "opp-1", participants: ["ada", "bev"] } } } },
      { t: 2000, type: "decision", memberId: "ada", messageId: "p1", messageType: "proposal", intent, decision, proposalId: "opp-1", delayMs: 1000 },
      { t: 3000, type: "message", msg: { id: "c1", ts: 3000, memberId: "bev", direction: "outbound", status: "delivered",
        body: "Ada is free Thursday.", meta: { type: "scheduling", proposalId: "opp-1" } } },
    ]);
    const counter = run("counter");
    const named = (m: ReturnType<typeof run>) => m.invariants.byRule.name_before_reveal ?? 0;
    expect([named(run("accept")), named(counter), named(run("decline")), named(run("counter", "confirm_schedule"))]).toEqual([0, 1, 1, 0]);
    expect(counter.responses).toMatchObject({ accepted: 0, countered: 1, acceptRate: 0 });
  });
  await b.run("availability: reviewed probes ignore inactive facets and retain active or undated patterns", async () => {
    const states = ["none", "future", "expired", "active", "starts_now", "ends_now", "onboarding"] as const;
    const failures: string[] = [];
    for (const seed of [1, 2, 3]) {
      const offered = new Map<string, unknown>();
      for (const state of states) {
        const w = new Mini([
          { id: "a", name: "Alex", age: 30, interests: ["climbing"], shareable: true },
          { id: "b", name: "Blair", age: 29, interests: ["climbing"], shareable: true },
        ], { seed, inlineJudge: holdEveryItem.inline });
        for (const id of ["a", "b"]) for (const answer of ["hi!", "More time outdoors.", state === "onboarding" ? "Tuesday evenings." : "My schedule varies.", "One-on-one is good."]) await w.say(id, answer);
        if (state !== "none" && state !== "onboarding") for (const id of ["a", "b"]) w.facets.push({
          id: `${id}-availability`, memberId: id, kind: "availability_pattern", value: "Usually free Tuesday evening", tags: ["evening:Tue"],
          scope: "agent_private", provenance: "said", confidence: 1, confirmedByMember: true, observedAt: START,
          validFrom: state === "future" ? START + 30 * DAY : state === "starts_now" ? START + HOUR : START - DAY,
          validTo: state === "expired" ? START - 1 : state === "ends_now" ? START + HOUR : START + 60 * DAY,
        });
        w.restart();
        const opp = w.propose(["a", "b"]);
        expect(await w.runUntil(() => w.net.reviewQueue().some(x => x.oppId === opp))).toBe(true);
        expect(w.sent.some(x => x.meta.probe?.key === opp)).toBe(false);
        w.net.review(opp, "approve", { reviewer: "sim" });
        expect(await w.runUntil(() => w.probed("a") || w.probed("b"))).toBe(true);
        const probe = w.sent.find(x => x.meta.probe?.key === opp && x.meta.timeOptions?.length);
        expect(probe?.t).toBe(START + HOUR);
        expect(probe!.meta.timeOptions!.length).toBeGreaterThanOrEqual(2);
        offered.set(state, probe!.meta.timeOptions);
      }
      expect(offered.get("active")).not.toEqual(offered.get("none"));
      for (const state of states.slice(1)) {
        const control = state === "future" || state === "expired" ? "none" : "active";
        if (!isDeepStrictEqual(offered.get(state), offered.get(control))) failures.push(`${seed}:${state}`);
      }
    }
    expect(failures).toEqual([]);
  });

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

  await b.run("judge: an unknown age that resolves adult (age_resolved minor:false) clears the minor flag; minor:true keeps it", () => {
    // network.ts logs age_resolved as { memberId, minor } with no age; the judge used to read the absent age as a minor.
    const t = Date.UTC(2026, 9, 5);
    const persona = (id: string) => ({ t, type: "persona", persona: { id, name: `${id} Q`, archetype: "regular", homeCity: "nyc", joinDay: 0, trueAge: 30, claimedAge: 30, quietHours: [22, 8], romanceOptIn: true } });
    const log = (dt: number, kind: string, detail: Record<string, unknown>) => ({ t: t + dt, type: "network_log", kind, detail });
    const records = (minor: boolean) => [persona("p1"), persona("p2"), log(1, "age_unknown", { memberId: "p1" }), log(2, "age_resolved", { memberId: "p1", minor }),
      log(3, "review_decision", { oppId: "o1", decision: "approve", reviewer: "r" }), log(4, "probe_started", { oppId: "o1", proposal: { id: "o1", participants: ["p1", "p2"], alternates: [] } }),
      log(5, "probe_sent", { oppId: "o1", memberId: "p1" })] as unknown as RunRecord[];
    expect(computeMetrics(records(false), { requireReview: true }).safety.minorContacts).toBe(0);
    expect(computeMetrics(records(true), { requireReview: true }).safety.minorContacts).toBe(2);
  });

  await b.run("minors: no minor is an alternate (a possible backfill) outside a teen friendship item; in a teen item every member, alternates and plan host included, keeps the teen group rule and the roster holds at most 6", () => {
    const minors = new Set([...run.personas.values()].filter(p => p.public.claimedAge < 18).map(p => p.id));
    const started = logs(R, "probe_started");
    expect(started.length).toBeGreaterThan(0);
    for (const r of started) {
      const proposal = (r.detail as { proposal?: { id?: string; alternates?: string[] } }).proposal;
      const opp = proposal?.id !== undefined ? run.net.opps.get(proposal.id) : undefined;
      if (opp?.teenRuleAt !== undefined) {
        const roster = [...new Set([...loggedRoster(r), ...(opp.plan?.hostId ? [opp.plan.hostId] : [])])];
        const withMinor = roster.some(id => statedMinorAt(run.personas.get(id), r.t));
        expect([opp.id, teenAgeOracleFault(roster, run.personas, r.t, Math.max(r.t, opp.plan?.window.end ?? r.t)), !withMinor || teenFriendCategory(run.net.app.id, opp.category)])
          .toEqual([opp.id, undefined, true]);
        continue;
      }
      expect((proposal?.alternates ?? []).filter(id => minors.has(id))).toEqual([]);
    }
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
    expect(reviewerFaults(run.net, R, run.personas)).toEqual([]);
  });

  await b.run("review approval recorded (seed 3, 10 days, simulated judge): every contact follows an approval by the judge or by staff on a held item; no minor roster approved with the adult rubric; no approval for a stale packet", () => {
    const byRule = computeMetrics(R, { requireReview: true }).invariants.byRule;
    expect([byRule.unreviewed_contact ?? 0, byRule.exception_contact_without_staff ?? 0]).toEqual([0, 0]);
    expect(judgedApprovalFaults(R)).toEqual({ adultRubricMinor: [], stalePacket: [] });
    expect(judgeApprovals(R).length).toBeGreaterThan(20);
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
    // Initial invites only: the outreach controller marks other unsolicited sends proactive too (meta.unsolicited),
    // and an info or cancellation note keeps its logistics timing (after quiet hours, not the send slot).
    const invites = outbound(R).filter(m => m.msg.meta?.proactive && !m.msg.meta?.unsolicited && m.msg.status === "delivered");
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
    const currentPersonas = new Map(run.w.personaList().map(persona => [persona.id, persona]));
    for (const r of logs(R, "abuse")) {
      const member = currentPersonas.get(String(r.detail.memberId));
      expect([r.detail.memberId, !!member?.hidden.adversarial]).toEqual([r.detail.memberId, true]);
    }
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

  await heldForStaffGate(b);
  await exceptionArmGates(b, o);

  await b.run("send-time recipient policy: minors, declined pairs and replies; stated ages fail closed", async () => {
    const { w, net, records, start, personas } = await world(1, 3, { inlineJudge: holdEveryItem.inline }, false);
    await w.advanceTo(start + 6 * HOUR);
    const members = net.memberList();
    const minor = members.find(m => (personas.get(m.id)?.public.claimedAge ?? 99) < 18)!;
    const adult = members.find(m => !m.minor && m.stage !== "new" && !personas.get(m.id)?.hidden.adversarial)!;
    expect(net.recipientPolicy(minor.id, "probe")).toEqual({ ok: false, reason: "minor" });
    expect(net.recipientPolicy(minor.id, "growth")).toEqual({ ok: false, reason: "minor" });
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
    const met: string[][] = [];
    for (const seed of [1, 2, 3]) consent.push(await runArm("consent", { days: 21, seed, onRecords: r => met.push(meetingKeys(r)) }));
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

    const aa: ArmResult[] = [], aaMet: string[][] = [];
    for (const seed of [1, 2, 3]) aa.push(await runArm("consent", { days: 21, seed, network: { seed: seed + 1000 }, onRecords: r => aaMet.push(meetingKeys(r)) }));
    const row = (f: (r: ArmResult) => number) => pairedLine(consent.map(f), aa.map(f));
    b.track("A/A consent (Network seed + 1000), meetings held", true, row(r => r.meetingsHeld));
    b.track("A/A consent, everyone-yes proposals", true, row(r => r.proposalsAllYes));
    b.track("A/A consent, new members joined", true, row(r => r.newMembersJoined));
    b.track("A/A consent, expected value per proposal (oracle)", true, row(r => r.expected.perProposal));
    b.track("A/A consent, expected good meetings per member (oracle)", true, row(r => r.expected.perMember));
    b.track("A/A consent, same meetings (Jaccard of who met whom, per seed)", true, met.map((m, i) => overlap(m, aaMet[i]!).toFixed(2)).join(", "));
  }

  // ---- NYC scenarios ------------------------------------------------------------------------------------
  for (const s of SCENARIOS) {
    const r = await runScenario(s);
    const failed = r.checks.filter(c => !c.pass);
    b.gate(`scenario ${s.id}`, failed.length === 0, failed.map(c => `${c.name}: ${c.detail}`).join("; "));
  }

  // ---- sim/scenarios/*.json against the push stub (pass^3), and a negative control -------------------------
  const dir = `${import.meta.dirname}/../../packages/sim/scenarios`;
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

  await b.run("recurring availability: refused day groups are not saved as free time", async () => {
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `evening:${d}`);
    const weekends = ["Sun", "Sat"].flatMap(d => ["morning", "afternoon", "evening"].map(p => `${p}:${d}`));
    const cases: [string, string[], number | undefined, number?][] = [
      ["Usually free Tuesday evenings, not weekends", ["evening:Tue"], Date.UTC(2026, 9, 10, 14)],
      ["Usually free Saturday mornings, not weekdays", ["morning:Sat"], Date.UTC(2026, 9, 6, 23)],
      ["Usually free Sunday afternoons, not weeknights", ["afternoon:Sun"], Date.UTC(2026, 9, 6, 23)],
      ["Usually free Tuesday evenings, weekends don't work", ["evening:Tue"], Date.UTC(2026, 9, 10, 14)],
      ["Usually free Saturday mornings, weekdays are busy", ["morning:Sat"], Date.UTC(2026, 9, 6, 23)],
      ["Usually free Sunday afternoons, weeknights are out", ["afternoon:Sun"], Date.UTC(2026, 9, 6, 23)],
      ["Usually free weekends", weekends, undefined],
      ["Usually free weekdays", weekdays, undefined],
      ["Usually free weeknights", weekdays, undefined],
      ["Usually free Tuesday evenings, not Saturday", ["evening:Tue"], Date.UTC(2026, 9, 10, 14)],
      ["free most evenings, not weeknights", [], Date.UTC(2026, 9, 6, 23)],
      ["Usually free any evenings, not weekdays", [], Date.UTC(2026, 9, 6, 23)],
      ["Usually free all evenings, weeknights don't work", [], Date.UTC(2026, 9, 6, 23)],
      ["Usually free every evening, weekdays are busy", [], Date.UTC(2026, 9, 6, 23)],
      ["free most evenings", weekdays, undefined],
      ["free most evenings, not weekends", weekdays, undefined],
      ["Free every evening, not Tuesday", [], Date.UTC(2026, 9, 6, 23)],
      ["Free all evenings, Friday is out", [], Date.UTC(2026, 9, 9, 23)],
      ["Free most evenings, not Sunday", weekdays, undefined],
      ["I'm free on weekdays except Tuesday", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["I'm free weekdays, not Tuesday", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["I can do weekdays but Tuesday is out", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["Usually free weekdays, Tuesdays are busy", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["Usually free weeknights but not Friday", weekdays.filter(t => t !== "evening:Fri"), Date.UTC(2026, 9, 9, 23), Date.UTC(2026, 9, 12, 23)],
      ["Usually free weeknights except Friday", weekdays.filter(t => t !== "evening:Fri"), Date.UTC(2026, 9, 9, 23), Date.UTC(2026, 9, 12, 23)],
      ["I'm free on weekends except Sunday", weekends.filter(t => t.endsWith(":Sat")), Date.UTC(2026, 9, 11, 14), Date.UTC(2026, 9, 10, 14)],
      ["Free weekends, not Saturday", weekends.filter(t => t.endsWith(":Sun")), Date.UTC(2026, 9, 10, 14), Date.UTC(2026, 9, 11, 14)],
      ["Free on weekends except Sunday mornings", weekends.filter(t => t !== "morning:Sun"), Date.UTC(2026, 9, 11, 14), Date.UTC(2026, 9, 10, 14)],
      ["Free weekday evenings except Tuesday and Friday", weekdays.filter(t => !["evening:Tue", "evening:Fri"].includes(t)), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["Free most weekend evenings except Saturday and Sunday", [], Date.UTC(2026, 9, 10, 23)],
      ["Usually free weekdays, not Sunday", weekdays, undefined],
      ["Usually free weekends, not Tuesday", weekends, undefined],
      ["Usually free Tuesdays", ["evening:Tue"], undefined],
      ["Usually free weekday mornings, not Tuesday", ["Mon", "Wed", "Thu", "Fri"].map(d => `morning:${d}`), Date.UTC(2026, 9, 13, 14), Date.UTC(2026, 9, 12, 14)],
      ["Free weekday evenings except Monday and Tuesday and Wednesday and Thursday and Friday", [], Date.UTC(2026, 9, 13, 23)],
      ["Usually free weekday mornings, not evenings", ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `morning:${d}`), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 14)],
      ["Usually free weekday afternoons, not evenings", ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `afternoon:${d}`), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 18)],
      ["Usually free weekends, not mornings", weekends.filter(t => !t.startsWith("morning:")), Date.UTC(2026, 9, 11, 14), Date.UTC(2026, 9, 10, 18)],
      ["Usually free weekend mornings, not afternoons", ["morning:Sun", "morning:Sat"], Date.UTC(2026, 9, 11, 18), Date.UTC(2026, 9, 10, 14)],
      ["Usually free weekdays, not evenings", [], Date.UTC(2026, 9, 13, 23)],
      ["Free most evenings, not after work", [], Date.UTC(2026, 9, 13, 23)],
      ["Usually free weekday mornings, evenings don't work", ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `morning:${d}`), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 14)],
      ["Usually free weekday mornings, no nights", ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `morning:${d}`), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 14)],
      ["Free Tuesday morning and afternoon, not evening", ["morning:Tue", "afternoon:Tue"], Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 13, 14)],
      ["Free mornings on weekdays, not evenings", ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `morning:${d}`), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 14)],
      ["Not evenings, free Saturday afternoons", ["afternoon:Sat"], Date.UTC(2026, 9, 10, 23), Date.UTC(2026, 9, 10, 18)],
      ["Usually free weekday mornings, not after work", ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `morning:${d}`), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 14)],
      ["Free weekend mornings but not afternoons", ["morning:Sun", "morning:Sat"], Date.UTC(2026, 9, 11, 18), Date.UTC(2026, 9, 10, 14)],
      ["Free Tuesday evenings and Saturday mornings", ["evening:Tue", "morning:Sat"], undefined],
      ["Usually free weekdays, not mornings", weekdays, Date.UTC(2026, 9, 13, 14), Date.UTC(2026, 9, 12, 23)],
      ["Free Saturday mornings and afternoons", ["morning:Sat", "afternoon:Sat"], undefined],
      ["Free most evenings, not mornings", weekdays, undefined],
      ["Free mornings on weekdays", ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `morning:${d}`), undefined],
      ["I'm free on weekdays other than Tuesday", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["I'm free on weekdays apart from Tuesday", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["I'm free on weekdays aside from Tuesday", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["I'm free on weekdays barring Tuesday", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["Free weekends other than Sunday mornings", weekends.filter(t => t !== "morning:Sun"), Date.UTC(2026, 9, 11, 14), Date.UTC(2026, 9, 10, 14)],
      ["Free weekends apart from Sunday", weekends.filter(t => t.endsWith(":Sat")), Date.UTC(2026, 9, 11, 14), Date.UTC(2026, 9, 10, 14)],
      ["Free weekday evenings aside from Tuesday and Friday", weekdays.filter(t => !["evening:Tue", "evening:Fri"].includes(t)), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["Free Tuesday evenings, other than weekends", ["evening:Tue"], Date.UTC(2026, 9, 10, 14), Date.UTC(2026, 9, 13, 23)],
      ["Free Tuesday evenings apart from weekends", ["evening:Tue"], Date.UTC(2026, 9, 10, 14), Date.UTC(2026, 9, 13, 23)],
      ["Free most evenings apart from weeknights", [], Date.UTC(2026, 9, 13, 23)],
      ["Free weekday mornings other than evenings", ["Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `morning:${d}`), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 14)],
      ["Free weekends apart from mornings", weekends.filter(t => !t.startsWith("morning:")), Date.UTC(2026, 9, 11, 14), Date.UTC(2026, 9, 10, 18)],
      ["Apart from mornings, free Saturday afternoons", ["afternoon:Sat"], Date.UTC(2026, 9, 10, 14), Date.UTC(2026, 9, 10, 18)],
      ["Free weekdays other than on Tuesday", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["Free weekdays other than Tue", weekdays.filter(t => t !== "evening:Tue"), Date.UTC(2026, 9, 13, 23), Date.UTC(2026, 9, 12, 23)],
      ["Free most evenings other than Friday", [], Date.UTC(2026, 9, 9, 23)],
      ["Barring emergencies, Tuesday evenings work", ["evening:Tue"], undefined],
      ["Apart from hiking, I'm free Tuesday evenings", ["evening:Tue"], undefined],
      ["Other than work, Saturday mornings are free", ["morning:Sat"], undefined],
      ["Aside from book club, I'm free Sunday afternoons", ["afternoon:Sun"], undefined],
      ["Free Tuesday evenings at the bar", ["evening:Tue"], undefined],
      ["Sorry, but Tuesday evenings work", ["evening:Tue"], undefined],
    ];
    const results: { seed: number; body: string; tags: string[]; expected: string[]; p?: number; prior?: number; allowedP?: number; allowedPrior?: number; hasStanding: boolean; hasAvailability: boolean }[] = [];
    for (const seed of [1, 2, 3]) for (const [body, expected, refusedAt, allowedAt] of cases) {
      const input = randomWorld({ seed, members: 120, minors: false });
      const member = input.members.find(m => m.homeCity === "nyc" && m.state === "normal")!;
      const clock = new SimClock(input.now);
      let seq = 0;
      const ctx: NetworkContext = {
        clock, snapshot: () => input,
        send: (memberId, body, options) => ({ id: `availability:${++seq}`, ts: clock.now(), direction: "outbound", channel: "sms", from: "network", to: memberId, memberId, body, status: "delivered", meta: options?.meta } satisfies SimMessage),
        recordProposal: () => {}, recordMeeting: () => "unused", recordBlock: () => {}, log: () => {},
      };
      const opts = { seed, matchingEnabled: false };
      let net = new ConsentNetwork(opts);
      net.init(ctx);
      await net.onInbound({ id: "join", memberId: member.id, body: "Hi", ts: clock.now(), channel: "sms" });
      await net.onInbound({ id: "availability", memberId: member.id, body, ts: clock.now(), channel: "sms" });
      // Reload persisted state into a fresh instance before the scheduler reads it.
      const state = JSON.parse(JSON.stringify(net.exportState()));
      net = new ConsentNetwork(opts); net.init(ctx); net.importState(state);
      const reloaded = net.memberList().find(m => m.id === member.id)!;
      const saved = reloaded.standing;
      const standing = standingFromFacets(saved ? [{ kind: "availability_pattern", tags: saved.tags, observedAt: saved.at }] : [], clock.now());
      const p = refusedAt === undefined ? undefined : availabilityProb({ memberId: member.id, tz: NY, standing }, { start: refusedAt, end: refusedAt + 2 * HOUR }, clock.now());
      const prior = refusedAt === undefined ? undefined : availabilityProb({ memberId: member.id, tz: NY }, { start: refusedAt, end: refusedAt + 2 * HOUR }, clock.now());
      const allowedP = allowedAt === undefined ? undefined : availabilityProb({ memberId: member.id, tz: NY, standing }, { start: allowedAt, end: allowedAt + 2 * HOUR }, clock.now());
      const allowedPrior = allowedAt === undefined ? undefined : availabilityProb({ memberId: member.id, tz: NY }, { start: allowedAt, end: allowedAt + 2 * HOUR }, clock.now());
      results.push({ seed, body, tags: saved?.tags ?? [], expected, hasStanding: saved !== undefined, hasAvailability: reloaded.availability !== undefined, ...(p === undefined ? {} : { p, prior }), ...(allowedP === undefined ? {} : { allowedP, allowedPrior }) });
    }
    const mismatches = results.filter(r => !isDeepStrictEqual(r.tags, r.expected));
    expect(mismatches.map(({ seed, body, tags }) => [seed, body, tags]).slice(0, 8)).toEqual([]);
    for (const r of results) {
      if (r.p !== undefined && r.expected.length) expect(r.p).toBeLessThan(r.prior!);
      if (r.allowedP !== undefined) expect(r.allowedP).toBeGreaterThan(r.allowedPrior!);
      if (!r.expected.length) {
        expect(r.hasStanding).toBe(false);
        expect(r.hasAvailability).toBe(false);
        expect(r.p).toBe(r.prior);
      }
    }
  });  // ---- conformance rules for networkPack (engine level) ---------------------------------------------------
  await conformance(b, networkPack, { seeds: o.quick ? [1, 2] : [1, 2, 3, 4] });
  await teenConformance(b, networkPack, { world: ntwrkTeenWorld, seeds: o.quick ? [1, 2] : [1, 2, 3, 4] });
  await ntwrkTeenGates(b, o);
  await teenJudgeGates(b);
  await pass4QualityLeagueGates(b);
}

export async function pass4QualityLeagueGates(b: Block): Promise<void> {
  const now = START;

  await b.run("quality_quiet_vip_vs_slop: quiet high-signal member enters exposure floor while VoIP/Sybil and probationary slop are excluded; unverified peon seniority discounted; unrated slop capped", () => {
    expect(lawQuietHighStatusNotPenalized(30, 20, 25, 12)).toBe(true);
    expect(UNRATED_PREDICTIVE_DATE_STANDING).toEqual({ standing: 50, uncertainty: 10 });

    const mk = (id: string, joinedDaysAgo = 45) => baseMember(id, {
      age: 32, homeCity: "nyc", joinedAt: now - joinedDaysAgo * DAY,
      prefs: { romanceOptIn: true, categoriesOptIn: ["social", "hobby", "professional", "romance", "help", "growth"], formats: ["one_to_one", "small_group", "event"] },
    });
    const members = [mk("vip"), mk("voip"), mk("sybil"), mk("slop_low"), mk("hype")];
    const facets: Facet[] = [
      { id: "f_vip_1", memberId: "vip", kind: "interest", value: "distributed systems", tags: ["distributed_systems", "climbing"], confidence: 0.95, provenance: "said", observedAt: now - DAY, scope: "shareable" },
      { id: "f_vip_2", memberId: "vip", kind: "skill", value: "infrastructure", tags: ["infrastructure", "rust"], confidence: 0.95, provenance: "vouched", observedAt: now - DAY, scope: "shareable" },
      { id: "f_hype_1", memberId: "hype", kind: "skill", value: "growth guru", tags: ["hv:hype:pitch"], confidence: 0.8, provenance: "said", observedAt: now - DAY, scope: "shareable" },
    ];
    const qualityByMember: Record<MemberId, QualitySignals> = {
      vip: { provenanceScore: 30, specificityScore: 20, hygieneScore: 25, completionScore: 12, voipOrPumping: false, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: false, newcomerDays: 45 },
      voip: { provenanceScore: 5, specificityScore: 10, hygieneScore: 10, completionScore: 5, voipOrPumping: true, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: false, newcomerDays: 45 },
      sybil: { provenanceScore: 25, specificityScore: 18, hygieneScore: 20, completionScore: 12, voipOrPumping: false, sybilFlagged: true, chronicLowEffort: false, unverifiedHype: false, newcomerDays: 45 },
      slop_low: { provenanceScore: 15, specificityScore: 8, hygieneScore: 15, completionScore: 5, voipOrPumping: false, sybilFlagged: false, chronicLowEffort: true, unverifiedHype: false, newcomerDays: 45 },
      hype: { provenanceScore: 15, specificityScore: 12, hygieneScore: 20, completionScore: 10, voipOrPumping: false, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: true, newcomerDays: 45 },
    };

    const wNet = new EngineWorld({ ...emptyInput(now), members, facets, qualityByMember }, resolveConfig({ cities: ["nyc"] }), localEmbed, networkPack);
    expect(memberQualityBandOf(wNet, "vip")).toBe("Q3HighSignal");
    expect(memberQualityBandOf(wNet, "voip")).toBe("Q0Quarantine");
    expect(memberQualityBandOf(wNet, "sybil")).toBe("Q0Quarantine");
    expect(memberQualityBandOf(wNet, "slop_low")).toBe("Q1Probationary");
    expect(memberQualityBandOf(wNet, "hype")).toBe("Q1Probationary");

    const floor = exposureFloor(wNet, new EngineRng(7), {});
    expect(floor.members).toContain("vip");
    expect(floor.members).not.toContain("voip");
    expect(floor.members).not.toContain("sybil");
    expect(floor.members).not.toContain("slop_low");
    expect(floor.members).not.toContain("hype");

    expect(memberReason(wNet, "vip", { category: "social", role: "peer", format: "one_to_one", timeSensitive: false })).toBe(null);
    expect(memberReason(wNet, "voip", { category: "social", role: "peer", format: "one_to_one", timeSensitive: false })).toBe("quality_quarantine");
    expect(memberReason(wNet, "sybil", { category: "social", role: "peer", format: "one_to_one", timeSensitive: false })).toBe("quality_quarantine");

    const friendsFacets: Facet[] = [
      ...facets,
      { id: "f_voip_v", memberId: "voip", kind: "fact", value: "verified", tags: ["verify:age:pass", "verify:liveness:pass"], confidence: 1, provenance: "vouched", observedAt: now - DAY, scope: "matchable" },
    ];
    const wFriends = new EngineWorld({ ...emptyInput(now), members, facets: friendsFacets, qualityByMember }, resolveConfig({ cities: ["nyc"] }), localEmbed, friendsPack);
    expect(memberReason(wFriends, "voip", { category: "social", role: "peer", format: "one_to_one", timeSensitive: false })).toBe("quality_quarantine");
    const wSlop = new EngineWorld({ ...emptyInput(now), members, facets, qualityByMember }, resolveConfig(SLOP_ENGINE_CONFIG), localEmbed, makeSlopPack());
    expect(memberReason(wSlop, "voip", { lane: "Date", category: "romance", role: "peer", format: "one_to_one", timeSensitive: false })).toBe("quality_quarantine");
    const peonQFacets: Facet[] = [
      ...facets,
      { id: "f_voip_p", memberId: "voip", kind: "skill", value: "eng", tags: ["peon:entity:candidate", "peon:family:engineering", "peon:seniority:3", "peon:pay_floor:150", "peon:mode:hybrid"], confidence: 1, provenance: "said", observedAt: now - DAY, scope: "shareable" },
    ];
    const peonQIntents = [
      { id: "i_voip_p", memberId: "voip", objective: "engineering role", category: "professional" as const, details: "peon:search", horizonDays: 30, status: "active" as const, createdAt: now - DAY },
    ];
    const wPeonQ = new EngineWorld({ ...emptyInput(now), members, facets: peonQFacets, intents: peonQIntents, qualityByMember }, resolveConfig(PEON_ENGINE_CONFIG), localEmbed, peonPack);
    expect(memberReason(wPeonQ, "voip", { lane: "Hire", category: "professional", role: "seeker", format: "one_to_one", timeSensitive: false })).toBe("quality_quarantine");

    const candVerified = mk("cand_ver");
    const candUnver = mk("cand_unver");
    const peonFacets: Facet[] = [
      { id: "pv_kind", memberId: "cand_ver", kind: "skill", value: "eng", tags: ["peon:entity:candidate", "peon:family:engineering", "peon:seniority:5", "peon:pay_floor:200", "peon:mode:hybrid"], confidence: 1, provenance: "vouched", observedAt: now - DAY, scope: "shareable" },
      { id: "pu_kind", memberId: "cand_unver", kind: "skill", value: "eng", tags: ["peon:entity:candidate", "peon:family:engineering", "peon:seniority:5", "peon:pay_floor:200", "peon:mode:hybrid", "hv:hype:pitch"], confidence: 1, provenance: "said", observedAt: now - DAY, scope: "shareable" },
    ];
    const peonCandIntents = [
      { id: "i_cver", memberId: "cand_ver", objective: "principal eng", category: "professional" as const, details: "peon:search", horizonDays: 30, status: "active" as const, createdAt: now - DAY },
      { id: "i_cunver", memberId: "cand_unver", objective: "principal eng", category: "professional" as const, details: "peon:search", horizonDays: 30, status: "active" as const, createdAt: now - DAY },
    ];
    const wPeon = new EngineWorld({
      ...emptyInput(now),
      members: [candVerified, candUnver],
      facets: peonFacets,
      intents: peonCandIntents,
      qualityByMember: { cand_unver: qualityByMember.hype! },
    }, resolveConfig(PEON_ENGINE_CONFIG), localEmbed, peonPack);
    const sVer = peonVectors.standing(wPeon, { id: "cand_ver", memberId: "cand_ver", lane: "Hire", side: "Seeking", market: "nyc", capacity: 3 });
    const sUnver = peonVectors.standing(wPeon, { id: "cand_unver", memberId: "cand_unver", lane: "Hire", side: "Seeking", market: "nyc", capacity: 3 });
    expect(sUnver.standing).toBeLessThan(sVer.standing);
  });

  await b.run("league_gap_bilateral_value: wide uncompensated gaps block, verified bilateral value compensates, Date blocks aesthetic gap without wealth bypass, Peon & non-Date firewalls hold", () => {
    const founderUnverified: LeagueAxisProfile = {
      economic: 25, socialCapital: 30, domainRung: 85, aesthetic: 50, discretion: 85,
      extractionRisk: 10, publicity: 10, verifiedEvidence: false, trajectory: 85, crossCapitalOpen: true, sharedGuild: false,
    };
    const founderVerified: LeagueAxisProfile = { ...founderUnverified, verifiedEvidence: true };
    const patron: LeagueAxisProfile = {
      economic: 95, socialCapital: 88, domainRung: 70, aesthetic: 55, discretion: 90,
      extractionRisk: 5, publicity: 75, verifiedEvidence: true, trajectory: 70, crossCapitalOpen: true, sharedGuild: false,
    };
    expect(leaguePairAllowed("LeagueInvest", false, founderUnverified, patron)).toBe(false);
    expect(bilateralValueCompensates("LeagueInvest", founderVerified, patron)).toBe(true);
    expect(leaguePairAllowed("LeagueInvest", false, founderVerified, patron)).toBe(true);
    expect(leaguePairAllowed("LeagueIntro", false, founderVerified, patron)).toBe(true);

    const lowDiscretionStranger: LeagueAxisProfile = {
      economic: 30, socialCapital: 35, domainRung: 50, aesthetic: 50, discretion: 50,
      extractionRisk: 35, publicity: 10, verifiedEvidence: true, trajectory: 50, crossCapitalOpen: true, sharedGuild: false,
    };
    const sharedGuildPeer: LeagueAxisProfile = {
      economic: 35, socialCapital: 40, domainRung: 60, aesthetic: 50, discretion: 85,
      extractionRisk: 10, publicity: 10, verifiedEvidence: true, trajectory: 60, crossCapitalOpen: true, sharedGuild: true,
    };
    expect(leaguePairAllowed("LeagueFriend", false, lowDiscretionStranger, patron)).toBe(false);
    expect(leaguePairAllowed("LeagueFriend", false, sharedGuildPeer, { ...patron, sharedGuild: true })).toBe(true);

    const dateRichLowAes: LeagueAxisProfile = {
      economic: 98, socialCapital: 95, domainRung: 90, aesthetic: 45, discretion: 95,
      extractionRisk: 0, publicity: 40, verifiedEvidence: true, trajectory: 90, crossCapitalOpen: true, sharedGuild: true,
    };
    const dateHighAes: LeagueAxisProfile = {
      economic: 40, socialCapital: 45, domainRung: 55, aesthetic: 88, discretion: 90,
      extractionRisk: 5, publicity: 30, verifiedEvidence: true, trajectory: 60, crossCapitalOpen: true, sharedGuild: true,
    };
    expect(leaguePairAllowed("LeagueDate", false, dateRichLowAes, dateHighAes)).toBe(false);
    expect(leaguePairAllowed("LeagueDate", false, { ...dateRichLowAes, aesthetic: 72 }, dateHighAes)).toBe(true);

    for (const [eA, eB, sA, sB, aA, aB, pA, pB] of [[0, 100, 0, 100, 0, 100, 0, 100], [95, 10, 90, 5, 85, 15, 80, 0]] as const) {
      expect(lawPeonFirewallZeroesProtectedAxes(founderVerified, patron, eA, eB, sA, sB, aA, aB, pA, pB)).toBe(true);
    }
    const nonDateLanes: LeagueLane[] = ["LeagueFriend", "LeagueHire", "LeagueCofounder", "LeagueMentor", "LeagueInvest", "LeagueIntro"];
    for (const lane of nonDateLanes) {
      expect(lawAestheticWalledToDateOnly(lane, founderVerified, patron, 5, 98)).toBe(true);
      expect(lawAestheticWalledToDateOnly(lane, sharedGuildPeer, { ...patron, sharedGuild: true }, 99, 1)).toBe(true);
    }

    const mPatron = baseMember("patron", { age: 42, homeCity: "nyc", joinedAt: now - 90 * DAY });
    const mFounder = baseMember("founder", { age: 28, homeCity: "nyc", joinedAt: now - 30 * DAY });
    const mStranger = baseMember("stranger", { age: 27, homeCity: "nyc", joinedAt: now - 30 * DAY });
    const worldFacets: Facet[] = [
      { id: "fp1", memberId: "patron", kind: "skill", value: "vc", tags: ["econ_tier:95", "publicity_tier:75", "discretion:90", "extraction_risk:5", "angel_patron", "guild:founders"], confidence: 1, provenance: "vouched", observedAt: now - DAY, scope: "shareable" },
      { id: "ff1", memberId: "founder", kind: "skill", value: "ml", tags: ["econ_tier:25", "hv:rung:ai:9", "discretion:90", "extraction_risk:5", "angel_patron", "guild:founders"], confidence: 1, provenance: "vouched", observedAt: now - DAY, scope: "shareable" },
      { id: "fs1", memberId: "stranger", kind: "skill", value: "biz", tags: ["econ_tier:20", "discretion:45", "extraction_risk:40", "hv:hype:pitch"], confidence: 1, provenance: "said", observedAt: now - DAY, scope: "shareable" },
    ];
    const wLive = new EngineWorld({
      ...emptyInput(now),
      members: [mPatron, mFounder, mStranger],
      facets: worldFacets,
      qualityByMember: {
        patron: { provenanceScore: 32, specificityScore: 22, hygieneScore: 25, completionScore: 14, voipOrPumping: false, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: false, newcomerDays: 90 },
        founder: { provenanceScore: 28, specificityScore: 22, hygieneScore: 24, completionScore: 13, voipOrPumping: false, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: false, newcomerDays: 30 },
        stranger: { provenanceScore: 10, specificityScore: 8, hygieneScore: 15, completionScore: 8, voipOrPumping: false, sybilFlagged: false, chronicLowEffort: false, unverifiedHype: true, newcomerDays: 30 },
      },
    }, resolveConfig({ cities: ["nyc"] }), localEmbed, networkPack);
    expect(pairLeagueAndVampireReason(wLive, "patron", "stranger", "Invest")).not.toBe(null);
    expect(pairLeagueAndVampireReason(wLive, "patron", "founder", "Invest")).toBe(null);
  });

  await b.run("teen_league_invariance: minors are never league-gated, vampire-tiered, or penalized by adult status/reliability multipliers", () => {
    const extremeA: LeagueAxisProfile = {
      economic: 100, socialCapital: 100, domainRung: 100, aesthetic: 100, discretion: 0,
      extractionRisk: 100, publicity: 100, verifiedEvidence: false, trajectory: 0, crossCapitalOpen: false, sharedGuild: false,
    };
    const extremeB: LeagueAxisProfile = {
      economic: 0, socialCapital: 0, domainRung: 0, aesthetic: 0, discretion: 0,
      extractionRisk: 100, publicity: 0, verifiedEvidence: false, trajectory: 0, crossCapitalOpen: false, sharedGuild: false,
    };
    const allLanes: LeagueLane[] = ["LeagueFriend", "LeagueDate", "LeagueHire", "LeagueCofounder", "LeagueMentor", "LeagueInvest", "LeagueIntro"];
    for (const lane of allLanes) {
      expect(lawMinorsNeverLeagueGated(lane, extremeA, extremeB)).toBe(true);
      expect(leaguePairAllowed(lane, true, extremeA, extremeB)).toBe(true);
    }

    const teenRng = new SimRng(11);
    const teenA = baseMember("teenA", { age: 16, homeCity: "nyc", joinedAt: now - 20 * DAY, birthKey: birthKeyForAgeOn(16, earliestDayKeyOf(now), teenRng), birthExact: true });
    const teenB = baseMember("teenB", { age: 17, homeCity: "nyc", joinedAt: now - 20 * DAY, birthKey: birthKeyForAgeOn(17, earliestDayKeyOf(now), teenRng), birthExact: true });
    const wClean = new EngineWorld({ ...emptyInput(now), members: [teenA, teenB] }, resolveConfig({ cities: ["nyc"] }), localEmbed, networkPack);
    const wNoisy = new EngineWorld({
      ...emptyInput(now),
      members: [teenA, teenB],
      reliability: { teenA: { noShows: 3, completedSinceLastNoShow: 0, strikes: 8 } },
      vampireByMember: {
        teenA: { introsReceived90d: 10, positiveCounterpartVotes90d: 0, asymmetricNegativeVotes90d: 5, pitchSignals90d: 5, distinctSelfPromoReports90d: 3 },
      },
    }, resolveConfig({ cities: ["nyc"] }), localEmbed, networkPack);

    expect(memberVampireTierOf(wNoisy, "teenA")).toBe("VampireClean");
    expect(pairLeagueAndVampireReason(wNoisy, "teenA", "teenB", "Friend", 10, 95)).toBe(null);

    const cand: Candidate = {
      key: "teen-c1", kind: "intro", category: "social", lane: "Friend",
      generator: "intent_match", format: "one_to_one", city: "nyc",
      objective: "hang out", channels: new Set(["sms"]), exploration: false, safetyClass: "low",
      timeSensitive: false, riskText: "",
      participants: ["teenA", "teenB"], alternates: [],
      roles: { teenA: "peer", teenB: "peer" }, fit: 0.75, benefit: { teenA: 0.75, teenB: 0.75 },
      warm: 0, evidence: {},
    };
    const compClean = computeComponents(wClean, cand);
    const compNoisy = computeComponents(wNoisy, cand);
    expect(compNoisy.mutualBenefit).toBe(compClean.mutualBenefit);
  });
}

async function ntwrkTeenGates(b: Block, o: { quick: boolean }): Promise<void> {
  const seeds = o.quick ? [1] : [1, 2, 3];
  const days = o.quick ? 7 : 14;
  const arms = [];
  for (const seed of seeds) arms.push({ seed, ...(await ntwrkTeenArm(seed, days)) });
  const per = arms.map(({ seed, net, records, personas }) => {
    const m = computeMetrics(records, { requireReview: true });
    const minor = (id: string) => (personas.get(id)?.public.claimedAge ?? 0) < 18;
    const teenOpps = [...net.opps.values()].filter(x => teenRosterOf(x).some(id => statedMinorAt(personas.get(id), x.createdAt)));
    const outsideShape = teenOpps.filter(x => x.teenRuleAt === undefined || x.plan !== undefined || x.gatheringRepeat !== undefined || x.category !== "social"
      || !teenShapeHolds("ntwrk", x)).map(x => x.id);
    const reviewed = logs(records, "review_decision").filter(l => l.detail.decision === "approve" && net.opps.get(String(l.detail.oppId))?.teenRuleAt !== undefined);
    const wrongReviewer = reviewerFaults(net, records, personas);
    const rubric = judgedApprovalFaults(records);
    const probed = new Set(logs(records, "probe_started").map(l => String((l.detail.proposal as { id?: unknown } | undefined)?.id ?? l.detail.oppId)).filter(id => net.opps.get(id)?.teenRuleAt !== undefined));
    const meetings = records.filter(r => r.type === "meeting_scheduled" && r.participants.some(minor)).length;
    const ageFaults = teenOpps.flatMap(x => {
      const fault = teenAgeOracleFault(teenRosterOf(x), personas, x.createdAt, Math.max(x.createdAt, x.plan?.window.end ?? x.createdAt));
      return fault ? [`${x.id}: ${fault}`] : [];
    });
    return { seed, m, outsideShape, reviewed: reviewed.length, wrongReviewer, rubric, probed: probed.size, meetings, teenItems: teenOpps.length, ageFaults };
  });
  b.gate("ntwrk teen world: judge 0 invariant violations, minor contacts, canary leaks and errors, every seed",
    per.every(x => x.m.invariants.total === 0 && x.m.safety.minorContacts === 0 && x.m.privacy.canaryLeaks === 0 && x.m.errors === 0),
    per.map(x => `seed ${x.seed}: ${JSON.stringify(x.m.invariants.byRule)}, minor ${x.m.safety.minorContacts}, leaks ${x.m.privacy.canaryLeaks}, errors ${x.m.errors}`).join("; "));
  b.gate("ntwrk teen world: every item with a stated minor is a reviewed Friend-lane pair or circle of 2 to 6 from a teen generator, with a friendship format and a friendship role for everyone (no plan, gathering, via or event), every seed",
    per.every(x => x.outsideShape.length === 0), per.map(x => `seed ${x.seed}: ${x.outsideShape.slice(0, 5).join(",") || "none"}`).join("; "));
  b.gate("ntwrk teen world: every item with a stated minor meets the age oracle from the stated birth dates (pairs with a minor at most 2 calendar years apart, nobody 19 or more, at most 6 members), and the run checks at least one such item",
    per.every(x => x.ageFaults.length === 0) && (o.quick || per.reduce((n, x) => n + x.teenItems, 0) > 0),
    per.map(x => `seed ${x.seed}: ${x.teenItems} items checked, faults ${x.ageFaults.slice(0, 3).join("; ") || "none"}`).join("; "));
  b.gate("ntwrk teen world: every item with a stated minor carries the teen rule; every approval is the simulated judge's applied judgment or sim-staff's on a held item, every seed",
    per.every(x => x.wrongReviewer.length === 0), per.map(x => `seed ${x.seed}: ${x.wrongReviewer.slice(0, 5).join(",") || "none"}`).join("; "));
  b.gate("ntwrk teen world: minor roster approved with adult rubric = 0 and approval for a stale packet = 0, every seed",
    per.every(x => x.rubric.adultRubricMinor.length === 0 && x.rubric.stalePacket.length === 0),
    per.map(x => `seed ${x.seed}: adult rubric ${x.rubric.adultRubricMinor.slice(0, 5).join(",") || "none"}, stale ${x.rubric.stalePacket.slice(0, 5).join(",") || "none"}`).join("; "));
  b.gate("ntwrk teen world: positive control, a teen friendship item reaches approval and a probe", per.reduce((n, x) => n + x.reviewed, 0) > 0 && per.reduce((n, x) => n + x.probed, 0) > 0,
    per.map(x => `seed ${x.seed}: ${x.reviewed} approved, ${x.probed} probed, ${x.meetings} meetings with a minor`).join("; "), !o.quick);
  b.track("ntwrk teen world: tracked teen items approved (simulated judge with the strict rubric, or sim-staff on a held item)", true, meanInterval(per.map(x => x.reviewed)));
  b.track("ntwrk teen world: tracked meetings with a minor", true, meanInterval(per.map(x => x.meetings)));
  b.track("ntwrk teen world: tracked meetings, all members", true, meanInterval(per.map(x => x.m.meetings.held)));
  b.track("ntwrk teen world: fingerprint", true, digest(per.map(x => ({ seed: x.seed, byRule: x.m.invariants.byRule, reviewed: x.reviewed, probed: x.probed, meetings: x.meetings }))));

  const stopAfterDays = o.quick ? 3 : 7;
  const stopArms = [];
  for (const seed of seeds) stopArms.push({ seed, ...(await ntwrkTeenArm(seed, days, stopAfterDays)) });
  const stopPer = stopArms.map(({ seed, records, personas }) => {
    const m = computeMetrics(records, { requireReview: true });
    const stopAt = logs(records, "teen_intros_switch").find(l => l.detail.on === false)?.t;
    const minorAt = (id: unknown, t: number) => typeof id === "string" && statedMinorAt(personas.get(id), t);
    const teenStarted = (after: boolean) => logs(records, "probe_started")
      .filter(l => stopAt !== undefined && (l.t >= stopAt) === after && loggedRoster(l).some(id => minorAt(id, l.t)))
      .map(l => `probe_started ${String((l.detail.proposal as { id?: unknown } | undefined)?.id ?? l.detail.oppId)}`);
    const after = stopAt === undefined ? ["no stop record"] : [
      ...teenStarted(true),
      ...logs(records, "probe_sent").filter(l => l.t >= stopAt && minorAt(l.detail.memberId, l.t)).map(l => `probe_sent ${String(l.detail.oppId)} to ${String(l.detail.memberId)}`),
      ...records.filter((r): r is Extract<RunRecord, { type: "meeting_scheduled" }> => r.type === "meeting_scheduled" && r.t >= stopAt && r.participants.some(id => minorAt(id, r.t))).map(r => `meeting ${r.meetingId}`),
    ];
    return { seed, m, before: teenStarted(false).length, after };
  });
  b.gate("ntwrk teen world, stopped on day " + stopAfterDays + " by one admin: judge 0 minor contacts and 0 invariant violations, and no teen probe, probe to a minor or meeting with a minor after the stop, every seed",
    stopPer.every(x => x.m.safety.minorContacts === 0 && x.m.invariants.total === 0 && x.after.length === 0),
    stopPer.map(x => `seed ${x.seed}: minor ${x.m.safety.minorContacts}, ${JSON.stringify(x.m.invariants.byRule)}, after the stop ${x.after.slice(0, 5).join(",") || "none"}`).join("; "));
  b.gate("ntwrk teen world, stopped: positive control, teen items started before the stop", stopPer.reduce((n, x) => n + x.before, 0) > 0,
    stopPer.map(x => `seed ${x.seed}: ${x.before} teen items started before the stop`).join("; "), !o.quick);
}

if (import.meta.main) {
  const b = new Block("network");
  await inviteRootGate(b);
  const failed = b.gates.some(g => g.blocking && !g.pass);
  process.exit(failed ? 1 : 0);
}
