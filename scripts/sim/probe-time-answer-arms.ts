// Read the time-answer corpus through one parser, then through the merge the flow uses, so a
// reviewer can re-run the numbers in docs/results/2026-10-27-time-answer-collisions.md.
//
//   bun run --conditions eliza-source scripts/sim/probe-time-answer-arms.ts
//
// To read the same rows with an older parser, write it beside the current one and pass the path:
//
//   git show <sha>:packages/network/src/classify.ts > packages/network/src/.arm-older.tmp.ts
//   bun run --conditions eliza-source scripts/sim/probe-time-answer-arms.ts packages/network/src/.arm-older.tmp.ts
//
// A row marked modelYes is also merged with a model yes (packages/network/src/network.ts:801):
// the answer must survive it, or the flow books every offered time the member never named.
import { parseProbeReply } from "../../packages/network/src/classify.ts";
import { mergeConsent, type Understood } from "../../packages/network/src/extract.ts";
import type { TimeOption } from "../../packages/network/src/classify.ts";

interface Row {
  text: string;
  answer: "yes" | "unclear";
  keys?: string[];
  modelYes?: true;
  options: { key: string; label: string }[];
}

const ROOT = `${import.meta.dir}/../..`;
const rows: Row[] = (await Bun.file(`${ROOT}/evals/network/time-answer-collisions.jsonl`).text()).trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as Row);

const armPath = process.argv[2];
const parse: typeof parseProbeReply = armPath
  ? (await import(`file://${ROOT}/${armPath}`)).parseProbeReply
  : parseProbeReply;

const modelYes: Understood = { consent: "yes", times: [], wants: [], notWanted: [], interests: [], skills: [] };

let ok = 0;
const fails: string[] = [];
for (const row of rows) {
  const options: TimeOption[] = row.options.map((o, i) => ({ key: o.key, label: o.label, start: i * 2 + 1, end: i * 2 + 2 }));
  const r = parse(row.text, options);
  const expected = row.keys ?? [];
  const hit = (a: string, keys: string[]) => a === row.answer && JSON.stringify(keys) === JSON.stringify(expected);
  let seen = `${r.answer} [${r.keys}]`;
  let pass = hit(r.answer, r.keys);
  if (row.modelYes) {
    const m = mergeConsent(r, modelYes, options);
    seen += ` | model yes -> ${m.answer} [${m.keys}]`;
    pass = pass && hit(m.answer, m.keys);
  }
  if (pass) ok++;
  else fails.push(`${JSON.stringify(row.text)} went ${seen}, want ${row.answer} [${expected}]`);
}
console.log(`parser=${armPath ?? "current"}: ${ok}/${rows.length} rows pass`);
for (const f of fails) console.log(`  FAIL ${f}`);
