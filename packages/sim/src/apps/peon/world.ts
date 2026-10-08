// The peon.biz harness: weekly rounds over a hiring market (NYC and SF, plus remote jobs). Each
// week the matcher reads ONLY the snapshot and returns intros (candidate, job seat); the harness
// runs the application flow with hidden truth:
//   1. candidate-first probe: the candidate sees the role, pay range, work model and company and
//      says yes or no (or does not answer); at most CAND_CAP probes per candidate per week;
//   2. a yes forwards a summary to the employer's queue (the slate); the employer reviews up to
//      their weekly capacity when they are responsive; unreviewed applications expire after 3 weeks;
//   3. employer yes -> intro and interview the next week (show-up), interview feedback recorded;
//   4. the week after: the employer offers the openings to the best passers; the candidate takes
//      the best offer or declines; a hire closes an opening and takes the candidate out of the search;
//   5. 90-day retention and quality of hire are drawn from the oracle.
// Platform rules apply to every arm: declared minors and held members are never delivered (a
// proposal with a minor is counted as a violation); a candidate contacted by a scam employer reports
// it with p = 0.6, which holds the company and blocks the seat.
// All randomness is keyed by (seed, member, job, week), so arms see the same draws for the same event.
//
// REALISM PROFILES. `REALISM_V1` is the first world (docs/results/2026-10-08-peon-pack.md 1-8).
// `REALISM_V2` (iteration 2, the default) adds the attention costs of volume on both sides:
//   - employer screening: each job reads at most 20 / 30 / 40 applications a week (by urgency) out of
//     a recruiter-hours budget that also pays for interviews; 60% of employers order the pile with a
//     crude keyword screen (claims on paper), the rest read in arrival order; unread applications
//     expire (ghosted);
//   - candidate attention: P(reply) falls with each further role shown that week (x0.85 per earlier
//     one, as slop's probe fatigue) and with the channel's track record for this candidate (trust:
//     declined / ignored roles and ghosted applications lower it, an employer yes raises it);
//   - timing: stronger candidates leave the market faster (hired elsewhere); roles close at a
//     deadline (8 / 6 / 4 weeks by urgency) or are filled through another channel (4% a week).
import { DAY, canBeMatched, type MemberId } from "@thenetwork/core";
import type { InteractionRecord } from "@thenetwork/engine/src/types.ts";
import { Rng, hash32 } from "@thenetwork/core";
import { auditCompanies, type AuditFlag } from "./audit.ts";
import { PeonOracle, n01, u01 } from "./oracle.ts";
import { generatePeonPopulation, type Candidate, type Job, type PeonGenOptions, type PeonPopulation } from "./persona.ts";
import { PEON_WORLD_START, buildPeonSnapshot, proposalShell, type PeonNetworkState, type PeonSnapshot } from "./snapshot.ts";

/** Roles a candidate is shown per week: peon's attention budget (domain research B4: about 3). */
export const CAND_CAP = 3;
/** A job board: an active seeker looks at and can apply to about 10 roles a week. */
export const JOB_BOARD_WEEKLY = 10;
/** Interview slots per job per week: IV_BASE + open headcount. */
export const IV_BASE = 1;
export const EXIT_HAZARD = 0.02;
export const SCAM_REPORT = 0.6;
/**
 * peon's relay scam screen (domain research B2: "a scam classifier on employer messages"): the
 * first message from an employer goes through the relay; one asking for money, bank details or an
 * SSN is caught with this probability (an assumption, not measured) and the company is held
 * before the candidate sees it. Job boards have no relay.
 */
export const RELAY_CATCH = 0.7;
export const FEEDBACK_P = 0.7;
export const EXPIRE_WEEKS = 3;

export interface Realism {
  name: string;
  /** Employer screening: weekly read cap (base + per urgency level above 1) and recruiter hours per job per week. */
  screening?: { readBase: number; readPerUrgency: number; hoursBase: number; hoursPerUrgency: number; readHours: number; interviewHours: number; atsShare: number };
  /** Candidate attention: per-week fatigue and channel trust. */
  attention?: { fatigue: number; trustDeclined: number; trustIgnored: number; trustGhosted: number; trustGood: number; trustFloor: number };
  /** Timing: strength-dependent exits, role deadlines (weeks, by urgency 1-3) and fills through other channels. */
  timing?: { exitBase: number; exitStrength: number; deadlineWeeks: [number, number, number]; externalFill: number };
}
/** Iteration 1: fixed review capacity (4-8 a week), no fatigue, flat 2% weekly exits, no deadlines. */
export const REALISM_V1: Realism = { name: "v1" };
/** Iteration 2 (default). Parameters and their grounding: docs/results/2026-10-08-peon-pack.md, Iteration 2. */
export const REALISM_V2: Realism = {
  name: "v2",
  screening: { readBase: 20, readPerUrgency: 10, hoursBase: 3, hoursPerUrgency: 1, readHours: 0.1, interviewHours: 1.5, atsShare: 0.6 },
  attention: { fatigue: 0.85, trustDeclined: 0.02, trustIgnored: 0.02, trustGhosted: 0.05, trustGood: 0.05, trustFloor: 0.3 },
  timing: { exitBase: 0.01, exitStrength: 0.04, deadlineWeeks: [8, 6, 4], externalFill: 0.04 },
};

export interface Intro { cand: MemberId; job: MemberId }
export interface PeonMatcherContext {
  week: number; snapshot: PeonSnapshot; rng: Rng; seed: number;
  /** Candidates the matcher assessed (scored for at least one job after its hard filters): the audit's applicant pool. */
  assessed: Set<MemberId>;
}
export interface PeonMatcher {
  name: string;
  /** Employers see only the blind, candidate-approved summary until they say yes (the pack). Job-board baselines: false. */
  blindReview: boolean;
  /**
   * The monthly adverse-impact audit (peon's monitor): "flag" reports flagged companies for human
   * review; "hold" also suspends them at once; "off" (the job-board baselines) runs no audit.
   */
  audit?: "off" | "flag" | "hold";
  /** Probes (roles shown) per candidate per week (default CAND_CAP). */
  weeklyCap?: number;
  /** Employer messages go through peon's relay and its scam screen (the pack). */
  relayScreen?: boolean;
  propose(ctx: PeonMatcherContext): Intro[] | Promise<Intro[]>;
}

/** Everything that happened to one intro (harness-side; includes hidden truth). */
export interface Flow {
  key: string; week: number; cand: MemberId; job: MemberId;
  delivered: boolean; dropped?: "minor" | "held" | "cap" | "repeat" | "invalid" | "closed";
  replied?: boolean; yes?: boolean; reviewed?: boolean; reviewWeek?: number; employerYes?: boolean; expired?: boolean;
  interviewWeek?: number; interviewed?: boolean; passed?: boolean; score?: number; offered?: boolean; accepted?: boolean; hired?: boolean;
  withdrawn?: boolean;
  /** Read and acceptable, waiting for an interview slot (iteration 2). */
  onFile?: boolean;
  /** The role closed (deadline or filled elsewhere) while this application was open. */
  roleClosed?: boolean;
  // flags
  minor: boolean; unverified: boolean; noRange: boolean; scam: boolean; fake: boolean; qualified: boolean; underApplied: boolean;
  scamContact?: boolean;
  rec?: InteractionRecord;
}
export interface Hire { cand: MemberId; job: MemberId; week: number; day: number; timeToFill: number; retained: boolean; qoh: number; underApplied: boolean }

export interface PeonWorld {
  seed: number; weeks: number; pop: PeonPopulation; oracle: PeonOracle; state: PeonNetworkState;
  /** Jobs with the lowest organic demand per opening (bottom third): under-applied (Horton 2017). */
  underApplied: Set<MemberId>;
}
export interface PeonRunResult {
  world: PeonWorld; flows: Flow[]; hires: Hire[]; audits: AuditFlag[][]; matcher: string; heldCompanies: Set<string>; assessed: Set<MemberId>;
  /** Recruiter hours spent reading applications and interviewing (iteration 2; 0 under v1). */
  recruiterHours: number;
  /** Jobs closed without a peon hire: at the deadline, or filled through another channel. */
  closed: { deadline: number; external: number };
}

export interface PeonRunOptions extends Omit<PeonGenOptions, "seed"> {
  seed: number; weeks?: number;
  matcher: PeonMatcher | ((w: PeonWorld) => PeonMatcher);
  pop?: PeonPopulation;
  /** World realism profile (default REALISM_V2). */
  realism?: Realism;
}

export function createPeonWorld(o: Omit<PeonRunOptions, "matcher">): PeonWorld {
  const weeks = o.weeks ?? 8;
  const pop = o.pop ?? generatePeonPopulation({ ...o, seed: o.seed });
  const oracle = new PeonOracle(pop, o.seed);
  const state: PeonNetworkState = {
    now: PEON_WORLD_START, week: 0, interactions: [], recentProposals: [], safetyHolds: [], edges: [], feedbackFacets: [],
    hired: new Set(), exited: new Set(), openings: new Map(pop.jobs.map(j => [j.id, j.openings])), feedback: [],
  };
  return { seed: o.seed, weeks, pop, oracle, state, underApplied: underAppliedJobs(pop, oracle) };
}

/** Organic demand: expected candidate interest from real adults who could see the job on a job board (same market or remote, a stated family). */
export function organicDemand(pop: PeonPopulation, oracle: PeonOracle): Map<MemberId, number> {
  const out = new Map<MemberId, number>();
  for (const j of pop.jobs) {
    let d = 0;
    for (const c of pop.candidates) {
      if (c.truth.isMinor || c.truth.fake || !c.stated.families.includes(j.family)) continue;
      if (j.mode !== "remote" && c.market !== j.market) continue;
      d += oracle.pInterested(c, j);
    }
    out.set(j.id, d / j.openings);
  }
  return out;
}
function underAppliedJobs(pop: PeonPopulation, oracle: PeonOracle): Set<MemberId> {
  const d = organicDemand(pop, oracle);
  const real = pop.jobs.filter(j => j.hidden.real).sort((a, b) => (d.get(a.id)! - d.get(b.id)!) || (a.id < b.id ? -1 : 1));
  return new Set(real.slice(0, Math.floor(real.length / 3)).map(j => j.id));
}

export async function runPeonWorld(o: PeonRunOptions): Promise<PeonRunResult> {
  const world = createPeonWorld(o);
  const matcher = typeof o.matcher === "function" ? o.matcher(world) : o.matcher;
  const { oracle, state, seed } = world;
  const R = o.realism ?? REALISM_V2;
  const S = R.screening, A = R.attention, TM = R.timing;
  // Employers state a fill-by date at intake (domain research B6: "interview steps and timeline").
  if (TM) state.deadlineWeeks = TM.deadlineWeeks;
  let recruiterHours = 0;
  const closed = { deadline: 0, external: 0 };
  // Channel trust per candidate (iteration 2): the track record of the roles this channel sent them.
  const trust = new Map<MemberId, number>();
  const bumpTrust = (id: MemberId, d: number) => { if (A) trust.set(id, Math.max(A.trustFloor, Math.min(1, (trust.get(id) ?? 1) + d))); };
  const ghost = (f: Flow) => bumpTrust(f.cand, -(A?.trustGhosted ?? 0));
  // Candidate strength (true skill in their own family, 0-1): stronger candidates are hired elsewhere sooner.
  const strength = (c: Candidate) => {
    const lv = Object.values(c.truth.skills).sort((a, b) => b - a).slice(0, 3);
    return Math.max(0, Math.min(1, lv.reduce((x, y) => x + y, 0) / 15));
  };
  const flows: Flow[] = [], hires: Hire[] = [], audits: AuditFlag[][] = [];
  const queue = new Map<MemberId, Flow[]>(); // job -> applications waiting for review
  const introduced = new Set<string>();
  const heldCompanies = new Set<string>();
  const assessed = new Set<MemberId>();
  const seatsOf = new Map<string, MemberId[]>();
  for (const j of world.pop.jobs) { if (!seatsOf.has(j.company)) seatsOf.set(j.company, []); seatsOf.get(j.company)!.push(j.id); }
  const held = (id: MemberId) => state.safetyHolds.some(h => h.memberId === id);
  const holdCompany = (company: string, reason: string) => {
    if (heldCompanies.has(company)) return;
    heldCompanies.add(company);
    for (const id of seatsOf.get(company) ?? []) state.safetyHolds.push({ memberId: id, from: state.now, reason });
  };
  const jobOpen = (j: Job, week: number) => j.postedWeek <= week && (state.openings.get(j.id) ?? 0) > 0;
  const candActive = (c: Candidate, week: number) => c.joinWeek <= week && !state.hired.has(c.id) && !state.exited.has(c.id);

  for (let week = 0; week < world.weeks; week++) {
    state.week = week;
    state.now = PEON_WORLD_START + week * 7 * DAY + 12 * 3_600_000;
    // ---- 0. roles close at their deadline or are filled through another channel ----------------
    if (TM) for (const j of world.pop.jobs) {
      if (j.postedWeek > week || (state.openings.get(j.id) ?? 0) <= 0) continue;
      if (week >= j.postedWeek + TM.deadlineWeeks[Math.min(2, Math.max(0, j.urgency - 1))]!) { state.openings.set(j.id, 0); closed.deadline++; }
      else if (week > j.postedWeek && u01(seed, "extfill", j.id, week) < TM.externalFill) { state.openings.set(j.id, 0); closed.external++; }
    }
    const snapshot = buildPeonSnapshot(world.pop, state);
    const intros = await matcher.propose({ week, snapshot, rng: new Rng(hash32(seed, "matcher", week)), seed, assessed });
    const probes = new Map<MemberId, number>();
    // ---- 1. candidate-first probes -------------------------------------------------------------
    intros.forEach((it, i) => {
      const c = oracle.cand.get(it.cand), j = oracle.job.get(it.job);
      const f: Flow = {
        key: `w${week}:${i}:${it.cand}:${it.job}`, week, cand: it.cand, job: it.job, delivered: false,
        minor: !!c && (c.truth.isMinor || !canBeMatched(c.stated.declaredAge)), unverified: !!j && !oracle.co(j).verified,
        noRange: !!j && j.payMax === undefined, scam: !!j && !j.hidden.real, fake: !!c && c.truth.fake,
        qualified: !!c && !!j && oracle.qualified(c, j), underApplied: world.underApplied.has(it.job),
      };
      flows.push(f);
      if (!c || !j) { f.dropped = "invalid"; return; }
      if (f.minor) { f.dropped = "minor"; return; } // a policy violation: counted, never delivered
      const pk = `${c.id}|${j.id}`;
      if (introduced.has(pk)) { f.dropped = "repeat"; return; }
      if (held(c.id) || held(j.id)) { f.dropped = "held"; return; }
      if (!candActive(c, week) || !jobOpen(j, week)) { f.dropped = "closed"; return; }
      if ((probes.get(c.id) ?? 0) >= (matcher.weeklyCap ?? CAND_CAP)) { f.dropped = "cap"; return; }
      probes.set(c.id, (probes.get(c.id) ?? 0) + 1);
      introduced.add(pk);
      f.delivered = true;
      state.recentProposals.push(proposalShell(`p:${f.key}`, c.id, j.id, j.market, state.now));
      const rec: InteractionRecord = { id: f.key, kind: "intro", category: "professional", participants: [c.id, j.id], at: state.now, outcome: "pending" };
      f.rec = rec; state.interactions.push(rec);
      const active = u01(seed, "active", c.id, week) < c.truth.intensity;
      // Attention (iteration 2): each further role shown this week is read less, and a channel that
      // keeps sending poor roles or ghosted applications is trusted less.
      const att = A ? Math.pow(A.fatigue, (probes.get(c.id) ?? 1) - 1) * (trust.get(c.id) ?? 1) : 1;
      f.replied = active && u01(seed, "reply", c.id, j.id) < c.truth.replyProb * att;
      if (!f.replied) { rec.outcome = "expired"; rec.noResponse = [c.id]; bumpTrust(c.id, -(A?.trustIgnored ?? 0)); return; }
      f.yes = u01(seed, "yes", c.id, j.id) < oracle.pInterested(c, j);
      if (!f.yes) { rec.outcome = "declined"; rec.declinedBy = [c.id]; bumpTrust(c.id, -(A?.trustDeclined ?? 0)); return; }
      rec.acceptedBy = [c.id];
      if (!queue.has(j.id)) queue.set(j.id, []);
      queue.get(j.id)!.push(f);
    });

    // ---- 2. offers for last week's interviews (interview at w-1, decision at w) -------------------
    const offersByCand = new Map<MemberId, Flow[]>();
    const decided = flows.filter(f => f.interviewed && f.interviewWeek === week - 1 && f.passed !== undefined && f.offered === undefined);
    const byJob = new Map<MemberId, Flow[]>();
    for (const f of decided) { if (!byJob.has(f.job)) byJob.set(f.job, []); byJob.get(f.job)!.push(f); }
    for (const [jid, fs] of [...byJob.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const j = oracle.job.get(jid)!;
      const left = state.openings.get(jid) ?? 0;
      const passers = fs.filter(f => f.passed && !state.hired.has(f.cand)).sort((a, b) => (b.score! - a.score!) || (a.cand < b.cand ? -1 : 1));
      const offered = held(jid) ? [] : passers.slice(0, left);
      for (const f of fs) {
        f.offered = offered.includes(f);
        if (!f.offered) { f.rec!.outcome = "declined"; f.rec!.declinedBy = [jid]; }
        else { if (!offersByCand.has(f.cand)) offersByCand.set(f.cand, []); offersByCand.get(f.cand)!.push(f); }
      }
      void j;
    }
    // Candidates take their best offer, if any is good enough.
    const acceptedPerJob = new Map<MemberId, number>();
    for (const [cid, fs] of [...offersByCand.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const c = oracle.cand.get(cid)!;
      const best = [...fs].sort((a, b) => (oracle.pAccept(c, oracle.job.get(b.job)!) - oracle.pAccept(c, oracle.job.get(a.job)!)) || (a.job < b.job ? -1 : 1))[0]!;
      const jb = oracle.job.get(best.job)!;
      const room = (state.openings.get(jb.id) ?? 0) - (acceptedPerJob.get(jb.id) ?? 0);
      const yes = room > 0 && u01(seed, "accept", cid, jb.id) < oracle.pAccept(c, jb);
      for (const f of fs) {
        f.accepted = yes && f === best;
        if (!f.accepted) { f.rec!.outcome = "declined"; f.rec!.declinedBy = [cid]; }
      }
      if (yes) {
        acceptedPerJob.set(jb.id, (acceptedPerJob.get(jb.id) ?? 0) + 1);
        best.hired = true; best.rec!.outcome = "completed";
        const day = week * 7 + 3;
        const retained = u01(seed, "retain", cid, jb.id) < oracle.pRetain90(c, jb);
        hires.push({ cand: cid, job: jb.id, week, day, timeToFill: day - jb.postedWeek * 7, retained, qoh: oracle.qualityOfHire(c, jb, retained), underApplied: world.underApplied.has(jb.id) });
      }
    }
    for (const [jid, n] of acceptedPerJob) state.openings.set(jid, Math.max(0, (state.openings.get(jid) ?? 0) - n));
    for (const h of hires) if (h.week === week) state.hired.add(h.cand);

    // ---- 3. interviews scheduled for this week ---------------------------------------------------
    for (const f of flows) {
      if (f.interviewWeek !== week || f.interviewed !== undefined) continue;
      const c = oracle.cand.get(f.cand)!, j = oracle.job.get(f.job)!;
      if (state.hired.has(c.id) || (state.openings.get(j.id) ?? 0) <= 0 || held(j.id)) { f.interviewed = false; f.withdrawn = true; f.rec!.outcome = "cancelled"; continue; }
      f.interviewed = u01(seed, "show", c.id, j.id) < oracle.P.showUp * Math.max(0.6, c.truth.replyProb);
      if (!f.interviewed) { f.rec!.outcome = "no_show"; continue; }
      f.passed = u01(seed, "pass", c.id, j.id) < oracle.pPass(c, j);
      f.score = oracle.interviewScore(c, j);
      // The employer's interview record (visible to the Network: a real interview happened).
      state.feedback.push({ id: `fb:${f.key}`, from: j.id, about: c.id, opportunityId: f.key, at: state.now, sentiment: "neutral" });
      // Interview feedback: the employer reports the levels they saw on the must-haves (visible next week).
      if (j.hidden.real && u01(seed, "feedback", c.id, j.id) < FEEDBACK_P) for (const m of j.must) {
        const lvl = c.truth.skills[m.skill] ?? 0;
        state.feedbackFacets.push({ id: `${c.id}-d${String(week).padStart(2, "0")}-${m.skill}`, memberId: c.id, kind: "fact", value: `Interview feedback: ${m.skill.replace(/_/g, " ")} level ${lvl}`, tags: [`peon:demonstrated:${m.skill}:${lvl}`], scope: "matchable", provenance: "vouched", confidence: 0.9 });
      }
    }

    // ---- 4. employer review of the queue (the slate) ----------------------------------------------
    for (const [jid, q] of [...queue.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const j = oracle.job.get(jid)!, co = oracle.co(j);
      const pending = q.filter(f => f.reviewed === undefined && !f.expired);
      for (const f of pending) if (week - f.week >= EXPIRE_WEEKS || state.hired.has(f.cand) || (state.openings.get(jid) ?? 0) <= 0) {
        f.expired = true;
        if (state.hired.has(f.cand)) f.rec!.outcome = "cancelled";
        else if ((state.openings.get(jid) ?? 0) <= 0) { f.rec!.outcome = "cancelled"; f.roleClosed = true; }
        else { f.rec!.outcome = "expired"; f.rec!.noResponse = [jid]; ghost(f); }
      }
      if (held(jid)) continue;
      if (u01(seed, "responsive", jid, week) >= co.responsiveness) continue;
      let slots = IV_BASE + (state.openings.get(jid) ?? 0) - flows.filter(x => x.job === jid && x.interviewWeek === week + 1).length;
      const looks = (f: Flow) => oracle.onPaper(oracle.cand.get(f.cand)!, j) + 0.15 * n01(seed, "paper", f.cand, jid);
      const acceptableOf = (f: Flow) => u01(seed, "emp", f.cand, jid) < oracle.pEmployerYes(oracle.cand.get(f.cand)!, j, !matcher.blindReview);
      const schedule = (f: Flow) => {
        f.reviewed = true; f.reviewWeek = week; f.employerYes = true; f.onFile = false;
        f.rec!.outcome = "accepted"; f.rec!.acceptedBy = [f.cand, jid];
        bumpTrust(f.cand, A?.trustGood ?? 0);
        if (co.adversary === "scam") {
          // The intro opens contact: the scam asks for money / bank details / an SSN.
          if (matcher.relayScreen && u01(seed, "relay", f.cand, jid) < RELAY_CATCH) {
            holdCompany(co.id, "relay screen: asked for money or bank details");
            f.rec!.outcome = "cancelled";
            return;
          }
          f.scamContact = true;
          if (u01(seed, "report", f.cand, jid) < SCAM_REPORT) {
            holdCompany(co.id, "reported: asked for money or bank details");
            state.edges.push({ from: f.cand, to: jid, type: "blocked", strength: 1, explicit: true, createdAt: state.now });
          }
          f.rec!.outcome = "cancelled";
          return;
        }
        f.interviewWeek = week + 1; slots--;
      };
      const decline = (f: Flow) => { f.reviewed = true; f.reviewWeek = week; f.employerYes = false; f.onFile = false; f.rec!.outcome = "declined"; f.rec!.declinedBy = [jid]; };
      if (!S) {
        // Iteration 1: read up to the review capacity in arrival order; acceptable ones are ranked on
        // paper and fill next week's interview slots; the rest stay on file until they expire.
        const batch = pending.filter(f => !f.expired).slice(0, j.hidden.reviewCap);
        const acceptable: Flow[] = [];
        for (const f of batch) if (acceptableOf(f)) acceptable.push(f); else decline(f);
        acceptable.sort((a, b) => (looks(b) - looks(a)) || (a.cand < b.cand ? -1 : 1));
        for (const f of acceptable) if (co.adversary === "scam" || slots > 0) schedule(f);
        continue;
      }
      // Iteration 2: a recruiter-hours budget per job per week pays for reading (readHours each) and
      // for next week's interviews (interviewHours each). Applications already read and on file are
      // invited first (best on paper); then new ones are read, in arrival order or by a crude keyword
      // screen (claims on paper, so over-claimers and fakes float up), until the read cap, the hours
      // or the interview slots run out. What is not read waits, and expires after EXPIRE_WEEKS.
      let hours = S.hoursBase + S.hoursPerUrgency * j.urgency;
      const canInterview = () => co.adversary === "scam" || (slots > 0 && hours >= S.interviewHours);
      const invite = (f: Flow) => { if (co.adversary !== "scam") { hours -= S.interviewHours; recruiterHours += S.interviewHours; } schedule(f); };
      for (const f of pending.filter(x => !x.expired && x.onFile).sort((a, b) => (looks(b) - looks(a)) || (a.cand < b.cand ? -1 : 1))) if (canInterview()) invite(f);
      const ats = u01(seed, "ats", co.id) < S.atsShare;
      const unread = pending.filter(x => !x.expired && !x.onFile);
      if (ats) unread.sort((a, b) => (looks(b) - looks(a)) || (a.week - b.week) || (a.cand < b.cand ? -1 : 1));
      const readCap = S.readBase + S.readPerUrgency * (j.urgency - 1);
      let reads = 0;
      for (const f of unread) {
        if (reads >= readCap || hours < S.readHours || !canInterview()) break;
        reads++; hours -= S.readHours; recruiterHours += S.readHours;
        if (!acceptableOf(f)) { decline(f); continue; }
        if (canInterview()) invite(f); else f.onFile = true;
      }
    }

    // ---- 5. candidates leave the search for reasons outside the platform --------------------------
    for (const c of world.pop.candidates) {
      if (!candActive(c, week)) continue;
      const hazard = TM ? TM.exitBase + TM.exitStrength * strength(c) : EXIT_HAZARD;
      if (u01(seed, "exit", c.id, week) < hazard) state.exited.add(c.id);
    }

    // ---- 6. monthly adverse-impact audit (peon's monitor): flagged companies are held -------------
    if (matcher.audit && matcher.audit !== "off" && (week === 3 || week === 7)) {
      const flags = auditCompanies(flows, world);
      audits.push(flags);
      if (matcher.audit === "hold") for (const fl of flags) holdCompany(fl.company, `audit: ${fl.reason}`);
    }
  }
  return { world, flows, hires, audits, matcher: matcher.name, heldCompanies, assessed, recruiterHours, closed };
}
