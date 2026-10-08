// peon.biz oracle: pure, seeded functions of hidden truth. Engine code can never import it.
//   P(candidate interested)   pay over the TRUE floor, kind of work, work model, seniority step, appeal
//   P(employer interested)    what the employer SEES: claimed must-have coverage and seniority (blind
//                             summary in the pack; full resume in the job-board baselines)
//   P(interview)              employer yes, then the candidate shows up
//   P(offer)                  TRUE skills vs the bar + hidden pair fit + interview noise, then
//                             competition for the openings
//   P(accept)                 pay over the true floor, work model, appeal; best offer wins
//   P(90-day retention)       true fit, pay headroom, work model, retention propensity
//   quality of hire           sigmoid(true quality) x retained
// Calibration targets (docs/results/2026-10-08-peon-pack.md 2): 7-10% of interviewed candidates
// get offers and 11-17 interviews per hire on job-board matching (Gem / Ashby 2026), offer
// acceptance about 73-84%, median time-to-fill about 44 days (SHRM 2025).
import type { MemberId } from "@thenetwork/core";
import { hash32 } from "@thenetwork/sim/src/rng.ts";
import type { Candidate, Company, Job, PeonPopulation, Sealed } from "./persona.ts";

export const ORACLE_PARAMS = {
  interest0: -0.6, interestPay: 2.2, interestFam: 0.9, interestMode: 0.7, interestAppeal: 0.45, noRange: -1.0,
  employer0: -1.0, employerCov: 4.0, employerSen: 0.8,
  showUp: 0.92,
  offerBar: 0.5, offerScale: 0.33, pairFitSd: 0.45,
  accept0: -0.5, acceptPay: 3.0, acceptMode: 0.5, acceptAppeal: 0.3,
  retain0: 2.0, retainQ: 1.1, retainPay: 1.5, retainMode: 0.6,
  discriminate: 0.85,
};

const sig = (x: number) => 1 / (1 + Math.exp(-x));
/** Seeded uniform in [0, 1) keyed by parts. */
export const u01 = (...parts: (string | number)[]) => hash32(...parts) / 4294967296;
/** Seeded standard normal keyed by parts. */
export function n01(...parts: (string | number)[]): number {
  const a = Math.max(u01(...parts, "a"), 1e-12), b = u01(...parts, "b");
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

export class PeonOracle {
  readonly cand = new Map<MemberId, Candidate>();
  readonly job = new Map<MemberId, Job>();
  readonly company = new Map<string, Company>();
  constructor(readonly pop: PeonPopulation, readonly seed: number, readonly P = ORACLE_PARAMS) {
    for (const c of pop.candidates) this.cand.set(c.id, c);
    for (const j of pop.jobs) this.job.set(j.id, j);
    for (const c of pop.companies) this.company.set(c.id, c);
  }
  sealed(id: MemberId): Sealed | undefined { return this.pop.sealed.get(id); }
  co(j: Job): Company { return this.company.get(j.company)!; }

  /** The candidate's TRUE logistics allow this job (true modes, commute areas, true floor vs top of range, authorization). */
  trulyCompatible(c: Candidate, j: Job): boolean {
    if (j.mode === "remote") { if (!c.truth.modes.includes("remote")) return false; }
    else if (!c.truth.modes.includes(j.mode) || c.market !== j.market || !j.area || !c.truth.areas.includes(j.area)) return false;
    if (!c.stated.auth || (c.stated.needsSponsor && !j.sponsors)) return false;
    if (j.credRequired && !c.stated.creds.includes(j.credRequired)) return false;
    return true;
  }
  payHead(c: Candidate, j: Job): number {
    const top = j.payMax ?? (j.payMin ?? 0);
    const mid = j.payMax !== undefined ? (j.payMin! + j.payMax) / 2 : top;
    return Math.max(-0.6, Math.min(0.5, (0.5 * (top + mid) - c.truth.payFloor) / c.truth.payFloor));
  }
  famMatch(c: Candidate, j: Job): number { return j.family === c.truth.family ? 1 : c.stated.families.includes(j.family) ? 0.4 : -1.2; }
  modeFit(c: Candidate, j: Job): number { return c.truth.modes.includes(j.mode) ? (j.mode === "remote" ? 1 : 0.6) : -1; }
  senStep(c: Candidate, j: Job): number { const d = j.seniority - c.truth.seniority; return d === 0 ? 0.3 : d === 1 ? 0.25 : d === -1 ? -0.6 : -1.6; }

  /** P(candidate says yes | they read the probe). Candidates do not want roles their true logistics rule out. */
  pInterested(c: Candidate, j: Job): number {
    const P = this.P;
    if (c.truth.fake) return 0.9;
    const L = P.interest0 + P.interestPay * this.payHead(c, j) + P.interestFam * this.famMatch(c, j) + P.interestMode * this.modeFit(c, j)
      + P.interestAppeal * j.hidden.appeal + this.senStep(c, j) + (j.payMax === undefined ? P.noRange : 0);
    return sig(L) * (this.trulyCompatible(c, j) ? 1 : 0.15);
  }

  /** Must-have coverage as the employer reads it from the candidate's claims. */
  claimedCoverage(c: Candidate, j: Job): number {
    if (!j.must.length) return 1;
    return j.must.reduce((s, m) => s + Math.max(0, Math.min(1, 1 - Math.max(0, m.min - (c.stated.skills[m.skill] ?? 0)) / 2)), 0) / j.must.length;
  }
  /** How strong the application looks on paper (claimed must-have coverage, stated seniority fit): the employer's ranking. */
  onPaper(c: Candidate, j: Job): number { return this.claimedCoverage(c, j) - 0.2 * Math.abs(c.stated.seniority - j.seniority); }
  /**
   * P(employer says yes to interview) from what they see. `seesIdentity`: the employer sees a full
   * resume (name, address, graduation year: job-board baselines); a discriminatory employer then
   * screens out its target group. The pack's blind summary hides all of that until after the yes.
   */
  pEmployerYes(c: Candidate, j: Job, seesIdentity: boolean): number {
    const P = this.P;
    const co = this.co(j);
    if (co.adversary === "scam") return 1;
    if (seesIdentity && this.targeted(co, c.id)) return (1 - P.discriminate) * this.pEmployerYesBase(c, j);
    return this.pEmployerYesBase(c, j);
  }
  private pEmployerYesBase(c: Candidate, j: Job): number {
    const P = this.P;
    const dSen = Math.abs(c.stated.seniority - j.seniority);
    return sig(P.employer0 + P.employerCov * (this.claimedCoverage(c, j) - 0.6) + P.employerSen * (1 - dSen));
  }
  /** The candidate is in the discriminatory employer's target group (sealed truth). */
  targeted(co: Company, id: MemberId): boolean {
    if (co.adversary !== "discriminatory" || !co.target) return false;
    const s = this.sealed(id);
    if (!s) return false;
    const v = co.target.attr === "age40" ? String(s.age >= 40) : co.target.attr === "disability" ? String(s.disability) : co.target.attr === "sex" ? s.sex : s.race;
    return v === co.target.value;
  }

  /** True interview quality (logit units): must-have skill margin, seniority fit, hidden pair fit. Fixed per pair. */
  quality(c: Candidate, j: Job): number {
    const P = this.P;
    let margin = 0;
    for (const m of j.must) margin += Math.max(-2, Math.min(1.5, (c.truth.skills[m.skill] ?? 0) - m.min));
    margin /= Math.max(1, j.must.length);
    const nice = j.nice.filter(s => (c.truth.skills[s] ?? 0) >= 2).length * 0.15;
    const sen = -0.45 * Math.abs(j.seniority - c.truth.seniority);
    return margin + nice + sen + P.pairFitSd * n01(this.seed, "fit", c.id, j.id);
  }
  /** The employer can legally hire this person: licence held, authorized to work, sponsorship offered if needed (checked at the offer, I-9). */
  hireable(c: Candidate, j: Job): boolean {
    if (j.credRequired && !c.stated.creds.includes(j.credRequired)) return false;
    return c.stated.auth && !(c.stated.needsSponsor && !j.sponsors);
  }
  /** P(passes the interview loop), before competition for the openings. Discriminatory employers fail their target group once they meet them. */
  pPass(c: Candidate, j: Job): number {
    if (!j.hidden.real || !this.hireable(c, j)) return 0;
    const P = this.P;
    const p = sig((this.quality(c, j) - P.offerBar - j.hidden.barShift) / P.offerScale);
    return this.targeted(this.co(j), c.id) ? p * (1 - P.discriminate) : p;
  }
  /** Interview-day score (quality + noise): used to rank passers for the openings. */
  interviewScore(c: Candidate, j: Job): number { return this.quality(c, j) + c.truth.interviewSd * n01(this.seed, "iv", c.id, j.id); }

  pAccept(c: Candidate, j: Job): number {
    const P = this.P;
    if (c.truth.fake) return 0.95;
    return sig(P.accept0 + P.acceptPay * this.payHead(c, j) + P.acceptMode * this.modeFit(c, j) + P.acceptAppeal * j.hidden.appeal + 0.5 * this.famMatch(c, j));
  }
  pRetain90(c: Candidate, j: Job): number {
    const P = this.P;
    if (c.truth.fake) return 0.05;
    return sig(P.retain0 + P.retainQ * this.quality(c, j) + P.retainPay * this.payHead(c, j) + P.retainMode * this.modeFit(c, j) + c.truth.retention + 0.4 * Math.min(0, this.famMatch(c, j)));
  }
  qualityOfHire(c: Candidate, j: Job, retained: boolean): number { return retained ? sig(this.quality(c, j)) : 0; }

  /** A "qualified" intro: true logistics fit and the candidate truly meets the must-haves (within one level on at most one). */
  qualified(c: Candidate, j: Job): boolean {
    if (c.truth.fake || !j.hidden.real || !this.trulyCompatible(c, j)) return false;
    let short = 0;
    for (const m of j.must) { const d = m.min - (c.truth.skills[m.skill] ?? 0); if (d >= 2) return false; if (d === 1) short++; }
    return short <= 1 && Math.abs(c.truth.seniority - j.seniority) <= 1 && c.truth.payFloor <= (j.payMax ?? 0);
  }
}
