// Run diff (admin-console gap 19): compare two engine run summaries. The funnel, generator counts,
// rejection reasons and fairness side by side (b minus a), and the top configurations that appear
// in only one of them. A configuration is its participant set, so the same people found by another
// generator count as the same configuration.
import type { DiffNum, EngineRunSummary, RunDiff } from "./types.ts";

function diffRecord(a: Record<string, number | number[]>, b: Record<string, number | number[]>): Record<string, DiffNum> {
  const out: Record<string, DiffNum> = {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[k], y = b[k];
    if (Array.isArray(x) || Array.isArray(y)) continue; // the Lorenz curve: not a number
    const av = x ?? 0, bv = y ?? 0;
    out[k] = { a: av, b: bv, delta: Math.round((bv - av) * 1e6) / 1e6 };
  }
  return out;
}

const configKey = (t: EngineRunSummary["top"][number]) => [...t.participants].sort().join(",");

export function runDiff(a: EngineRunSummary, b: EngineRunSummary): RunDiff {
  const head = (r: EngineRunSummary) => ({ id: r.id, at: r.at, ...(r.city ? { city: r.city } : {}), engineVersion: r.engineVersion, proposals: r.proposals });
  const ka = new Set(a.top.map(configKey)), kb = new Set(b.top.map(configKey));
  return {
    a: head(a), b: head(b),
    funnel: diffRecord(a.funnel, b.funnel),
    byGenerator: diffRecord(a.byGenerator, b.byGenerator),
    proposalsByGenerator: diffRecord(a.proposalsByGenerator, b.proposalsByGenerator),
    rejectedBy: diffRecord(a.rejectedBy, b.rejectedBy),
    fairness: diffRecord(a.fairness as unknown as Record<string, number>, b.fairness as unknown as Record<string, number>),
    top: {
      added: b.top.filter(t => !ka.has(configKey(t))),
      removed: a.top.filter(t => !kb.has(configKey(t))),
      kept: b.top.filter(t => ka.has(configKey(t))).length,
    },
  };
}
