import { readFileSync } from "node:fs";
import { REVIEW_JUDGE_PROMPT_VERSION } from "../../engine/src/reviewJudge.ts";

export interface JudgeQualification { model: string; promptVersion: string; n: number; mustFlagRecall: number; ciLow: number; mayApproveRate: number; minorMayApproveRate: number; at: string | number }
const QUALIFIED_PATH = new URL("../../../evals/review/qualified.json", import.meta.url);

function parseJudgeQualifications(value: unknown): JudgeQualification[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: JudgeQualification[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
    const r = row as Record<string, unknown>;
    const share = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
    if (typeof r.model !== "string" || typeof r.promptVersion !== "string" || typeof r.n !== "number" || !Number.isSafeInteger(r.n) || r.n < 0
      || !share(r.mustFlagRecall) || !share(r.ciLow) || !share(r.mayApproveRate) || !share(r.minorMayApproveRate)
      || (typeof r.at !== "string" && typeof r.at !== "number")) return undefined;
    rows.push({ model: r.model, promptVersion: r.promptVersion, n: r.n, mustFlagRecall: r.mustFlagRecall as number, ciLow: r.ciLow as number,
      mayApproveRate: r.mayApproveRate as number, minorMayApproveRate: r.minorMayApproveRate as number, at: r.at });
  }
  return rows;
}

export function readJudgeQualifications(log: (line: string) => void): JudgeQualification[] {
  let text: string;
  try { text = readFileSync(QUALIFIED_PATH, "utf8"); } catch (e) {
    if ((e as { code?: string }).code !== "ENOENT") log(`[review-judge] qualification record unreadable: ${(e as Error).message}`);
    return [];
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  const rows = parseJudgeQualifications(parsed);
  if (!rows) log("[review-judge] qualification record refused: not a list of qualification rows");
  return rows ?? [];
}

export function qualifiedJudge(rows: readonly JudgeQualification[], model: string): JudgeQualification | null {
  return [...rows].reverse().find(q => q.model === model && q.promptVersion === REVIEW_JUDGE_PROMPT_VERSION) ?? null;
}
