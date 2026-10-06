// Apply extract.v2 rule changes to the fixed-by-construction labels. Idempotent; keeps the original as label_v1.
// Only rule-driven, spec-driven changes (no judgment calls):
//   age_signal: the spec "Reveal naturally that you have two kids." was labeled "adult" under extract.v1.
//   Under extract.v2, having children only makes adulthood likely -> null.
// The meet-people rule needed no relabel: by construction, social is labeled only when the spec asked for it as a
// goal, which is exactly the v2 rule; unrequested "meet people" asides are generator drift and stay unlabeled.
// Usage: bun run src/relabel.ts
import { readJsonl, writeJsonl } from "./llm.ts";

export function relabelV2(row: any): { row: any; changed: string[] } {
  const label_v1 = row.label_v1 ?? row.label;
  const label = structuredClone(label_v1);
  const changed: string[] = [];
  const must: string[] = row.spec?.must ?? [];
  if (label.age_signal === "adult" && must.some(m => /you have two kids/.test(m)) && !must.some(m => /you're \d|turned \d|retired/.test(m))) {
    label.age_signal = null; changed.push("age_signal adult->null (kids)");
  }
  return { row: { ...row, label, label_v1, ...(changed.length ? { relabel_v2: changed } : {}) }, changed };
}

if (import.meta.main) {
  for (const f of ["extraction", "extraction_disputed"]) {
    const rows = readJsonl(`data/${f}.jsonl`).map(relabelV2);
    writeJsonl(`data/${f}.jsonl`, rows.map(r => r.row));
    console.log(f, rows.filter(r => r.changed.length).map(r => `${r.row.id}: ${r.changed.join("; ")}`));
  }
}
