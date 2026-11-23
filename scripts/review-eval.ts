import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_MODEL, judgeLLM, LLMBudget, LLMError } from "../packages/core/src/index.ts";
import { judgeCallDeadlineMs } from "../packages/core/src/generated/automatedReview.ts";
import { sha256, stableStringify } from "../packages/engine/src/hash.ts";
import { JUDGE_VERDICTS, modelReviewJudge, packetSuspect, REVIEW_JUDGE_PROMPT_VERSION, type JudgeVerdictName, type ReviewPacket } from "../packages/engine/src/reviewJudge.ts";

const EVALS = join(import.meta.dirname, "..", "evals", "review");
const PACKETS = join(EVALS, "review-packets.jsonl");
const ANSWERS = join(EVALS, "judge-answers.jsonl");
const QUALIFIED = join(EVALS, "qualified.json");

const argv = process.argv.slice(2);
const has = (k: string) => argv.includes(`--${k}`);
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
function die(message: string): never { console.error(message); process.exit(2); }
const positive = (k: string, fallback: number) => {
  const raw = arg(k);
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n) || n <= 0) die(`--${k} must be a positive number`);
  return n;
};

type Label = "must_flag" | "may_approve";
type UnhashedPacket = Omit<ReviewPacket, "basePacketHash" | "packetHash">;
interface CorpusRow { id: string; label: Label; note: string; packet: ReviewPacket }
interface Answer { key: string; id: string; model: string; promptVersion: string; verdict: JudgeVerdictName; reason: string; explanation: string; costMicro: number }
type Outcome = { id: string; label: Label; rubric: ReviewPacket["rubric"]; source: "code" | "model"; verdict: JudgeVerdictName; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function corpusRow(line: string, n: number): CorpusRow {
  const raw: unknown = JSON.parse(line);
  if (!isObject(raw) || typeof raw.id !== "string" || (raw.label !== "must_flag" && raw.label !== "may_approve") || typeof raw.note !== "string" || !isObject(raw.packet)
    || (raw.packet.rubric !== "adult" && raw.packet.rubric !== "minor") || !Array.isArray(raw.packet.roster)) die(`review-packets.jsonl line ${n}: not a corpus row`);
  const unhashed = raw.packet as unknown as UnhashedPacket;
  const basePacketHash = sha256(stableStringify(unhashed));
  return { id: raw.id, label: raw.label, note: raw.note, packet: { ...unhashed, basePacketHash, packetHash: basePacketHash } };
}

function answerRow(line: string): Answer | undefined {
  const raw: unknown = JSON.parse(line);
  if (!isObject(raw) || typeof raw.key !== "string" || typeof raw.id !== "string" || typeof raw.model !== "string" || typeof raw.promptVersion !== "string"
    || typeof raw.verdict !== "string" || !(JUDGE_VERDICTS as readonly string[]).includes(raw.verdict) || typeof raw.reason !== "string"
    || typeof raw.explanation !== "string" || typeof raw.costMicro !== "number") return undefined;
  return raw as unknown as Answer;
}

function wilson(k: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: (c - m) / d, high: (c + m) / d };
}

const rows = (await readFile(PACKETS, "utf8")).trim().split("\n").filter(Boolean).map((line, i) => corpusRow(line, i + 1));
const model = process.env.JUDGE_MODEL ?? DEFAULT_MODEL;
const keyOf = (packet: ReviewPacket) => `${packet.packetHash}:${REVIEW_JUDGE_PROMPT_VERSION}:${model}`;
const answers = new Map<string, Answer>();
if (existsSync(ANSWERS)) {
  for (const line of (await readFile(ANSWERS, "utf8")).split("\n").filter(Boolean)) {
    const answer = answerRow(line);
    if (answer) answers.set(answer.key, answer);
  }
}

const codeHeld = (row: CorpusRow) => packetSuspect(row.packet, row.packet.roster.map(m => m.firstName));
const missing = rows.filter(row => !codeHeld(row) && !answers.has(keyOf(row.packet)));
const live = has("live");
const failures: string[] = [];
if (live && missing.length) {
  const budget = new LLMBudget({ maxCostMicro: Math.round(positive("budget-usd", 1) * 1e6), maxRequests: positive("max-requests", 90) });
  let spent = 0;
  const judge = modelReviewJudge(judgeLLM({ budget, onResponse: info => { spent += info.costMicro; } }), model);
  for (const row of missing) {
    const before = spent;
    try {
      const reply = await judge.judge(row.packet, { signal: AbortSignal.timeout(judgeCallDeadlineMs), deadlineMs: judgeCallDeadlineMs });
      const answer: Answer = { key: keyOf(row.packet), id: row.id, model: reply.model, promptVersion: reply.promptVersion, verdict: reply.verdict, reason: reply.reason, explanation: reply.explanation, costMicro: spent - before };
      answers.set(answer.key, answer);
      await appendFile(ANSWERS, `${JSON.stringify(answer)}\n`);
    } catch (e) {
      const code = e instanceof LLMError ? e.code : "error";
      failures.push(`${row.id}: ${code}`);
      if (code === "budget") break;
    }
  }
}

const outcomes: Outcome[] = rows.flatMap(row => {
  if (codeHeld(row)) return [{ id: row.id, label: row.label, rubric: row.packet.rubric, source: "code" as const, verdict: "flag" as const, reason: "packet_suspect" }];
  const answer = answers.get(keyOf(row.packet));
  return answer ? [{ id: row.id, label: row.label, rubric: row.packet.rubric, source: "model" as const, verdict: answer.verdict, reason: answer.reason }] : [];
});
const mustFlag = outcomes.filter(o => o.label === "must_flag");
const caught = mustFlag.filter(o => o.verdict !== "approve");
const mayApprove = (rubric: ReviewPacket["rubric"]) => outcomes.filter(o => o.label === "may_approve" && o.rubric === rubric);
const rate = (list: Outcome[]) => list.length ? list.filter(o => o.verdict === "approve").length / list.length : 0;
const ci = wilson(caught.length, mustFlag.length);
const modelMustFlag = mustFlag.filter(o => o.source === "model");
const modelCaught = modelMustFlag.filter(o => o.verdict !== "approve");
const modelCi = wilson(modelCaught.length, modelMustFlag.length);
const codeHeldRows = rows.filter(codeHeld);
const codeHeldOf = (label: Label) => codeHeldRows.filter(row => row.label === label);
const labelled = (label: Label) => rows.filter(row => row.label === label).length;
const costMicro = rows.reduce((sum, row) => sum + (answers.get(keyOf(row.packet))?.costMicro ?? 0), 0);
const unanswered = rows.length - outcomes.length;
const report = {
  model, promptVersion: REVIEW_JUDGE_PROMPT_VERSION, rows: rows.length, answered: outcomes.length, unanswered,
  codeHeld: {
    n: codeHeldRows.length,
    mustFlag: { n: codeHeldOf("must_flag").length, of: labelled("must_flag") },
    mayApprove: { n: codeHeldOf("may_approve").length, of: labelled("may_approve"), rate: labelled("may_approve") ? codeHeldOf("may_approve").length / labelled("may_approve") : 0 },
    rows: codeHeldRows.map(row => `${row.id} (${row.label})`),
  },
  mustFlag: { n: mustFlag.length, caught: caught.length, recall: mustFlag.length ? caught.length / mustFlag.length : 0, ci95: ci, target: 1 },
  modelMustFlag: { n: modelMustFlag.length, caught: modelCaught.length, recall: modelMustFlag.length ? modelCaught.length / modelMustFlag.length : 0, ci95: modelCi, target: 1 },
  mayApprove: { adult: { n: mayApprove("adult").length, approvalRate: rate(mayApprove("adult")) }, minor: { n: mayApprove("minor").length, approvalRate: rate(mayApprove("minor")) } },
  missedMustFlag: mustFlag.filter(o => o.verdict === "approve").map(o => o.id),
  heldMayApprove: outcomes.filter(o => o.label === "may_approve" && o.verdict !== "approve").map(o => `${o.id}: ${o.verdict}/${o.reason}`),
  costUsd: costMicro / 1e6, failures,
};
console.log(JSON.stringify(report, null, 2));
if (live) console.log("cost: each answer keeps its cost in judge-answers.jsonl and the run total goes into qualified.json; this operator run uses fictional packets and no app database, so it writes no network.cost_ledger row");
if (!live) console.log(`offline: ${unanswered} packet(s) have no recorded answer; run with --live --budget-usd <usd> --max-requests <n> to fill them`);
if (live && unanswered === 0) {
  const record = existsSync(QUALIFIED) ? JSON.parse(await readFile(QUALIFIED, "utf8")) as unknown[] : [];
  record.push({
    model, promptVersion: REVIEW_JUDGE_PROMPT_VERSION, n: outcomes.length, mustFlagRecall: report.mustFlag.recall, ciLow: ci.low,
    modelMustFlagN: report.modelMustFlag.n, modelMustFlagRecall: report.modelMustFlag.recall, modelCiLow: modelCi.low,
    codeHeld: report.codeHeld.n, codeHeldMayApproveRate: report.codeHeld.mayApprove.rate,
    mayApproveRate: report.mayApprove.adult.approvalRate, minorMayApproveRate: report.mayApprove.minor.approvalRate, costUsd: report.costUsd, at: new Date().toISOString(),
  });
  await writeFile(QUALIFIED, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`qualification record written: ${QUALIFIED}`);
}
