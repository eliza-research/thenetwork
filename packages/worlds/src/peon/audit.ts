// The adverse-impact audit (peon's monitor, run monthly). It reads the SEALED store, aggregated per
// company, and never feeds anything back per person: its only action is to flag a company for
// human review (the harness holds flagged companies). Matching never sees it.
//
// Per company: every human decision on a peon candidate (employer review yes/no, interview pass/fail)
// grouped by sealed attribute. A group whose advance rate is under half the rest's, with a one-sided
// binomial p under AUDIT.p (AUDIT.pAsked when the employer asked for a protected-trait filter at intake), is flagged.
import type { MemberId } from "@thenetwork/core";
import type { Sealed } from "./persona.ts";
import type { Flow, PeonWorld } from "./world.ts";

/** Audit thresholds: a one-sided binomial p under `p` (about 10 groups per company are tested, so
 *  the bar is Bonferroni-like), or under `pAsked` when the employer asked for a protected-trait filter. */
export const AUDIT = { p: 0.005, pAsked: 0.05, minN: 4, maxRatio: 0.5 };

export interface AuditFlag { company: string; attr: string; value: string; ratio: number; p: number; n: number; reason: string }

const ATTRS: { attr: string; of: (s: Sealed) => string }[] = [
  { attr: "sex", of: s => s.sex }, { attr: "race", of: s => s.race },
  { attr: "age40", of: s => String(s.age >= 40) }, { attr: "disability", of: s => String(s.disability) },
];

/** P(X <= k) for X ~ Binomial(n, p). */
export function binomCdf(k: number, n: number, p: number): number {
  let s = 0, term = Math.pow(1 - p, n);
  for (let i = 0; i <= k; i++) { s += term; term *= ((n - i) / (i + 1)) * (p / Math.max(1e-12, 1 - p)); }
  return Math.min(1, s);
}

export function auditCompanies(flows: Flow[], world: PeonWorld): AuditFlag[] {
  const { oracle } = world;
  const decisions = new Map<string, { cand: MemberId; adv: boolean }[]>();
  for (const f of flows) {
    const j = oracle.job.get(f.job);
    if (!j) continue;
    const add = (adv: boolean) => { const co = j.company; if (!decisions.has(co)) decisions.set(co, []); decisions.get(co)!.push({ cand: f.cand, adv }); };
    if (f.reviewed && f.employerYes !== undefined) add(f.employerYes);
    if (f.interviewed && f.passed !== undefined) add(f.passed);
  }
  const out: AuditFlag[] = [];
  for (const [company, ds] of [...decisions.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const asked = oracle.company.get(company)?.discriminatoryRequest ?? false;
    let worst: AuditFlag | undefined;
    for (const { attr, of } of ATTRS) {
      const by = new Map<string, { n: number; adv: number }>();
      for (const d of ds) {
        const s = oracle.sealed(d.cand);
        if (!s) continue;
        const v = of(s);
        const g = by.get(v) ?? { n: 0, adv: 0 };
        g.n++; if (d.adv) g.adv++;
        by.set(v, g);
      }
      const total = [...by.values()].reduce((a, g) => ({ n: a.n + g.n, adv: a.adv + g.adv }), { n: 0, adv: 0 });
      for (const [value, g] of by) {
        const rest = { n: total.n - g.n, adv: total.adv - g.adv };
        if (g.n < AUDIT.minN || rest.n < AUDIT.minN || rest.adv === 0) continue;
        const rRest = rest.adv / rest.n, ratio = g.adv / g.n / rRest;
        if (ratio >= AUDIT.maxRatio) continue;
        const p = binomCdf(g.adv, g.n, rRest);
        if (p < (asked ? AUDIT.pAsked : AUDIT.p) && (!worst || p < worst.p)) worst = { company, attr, value, ratio, p, n: g.n, reason: `${attr}=${value} advance ratio ${ratio.toFixed(2)} (p=${p.toFixed(3)}, n=${g.n})` };
      }
    }
    if (worst) out.push(worst);
  }
  return out;
}
