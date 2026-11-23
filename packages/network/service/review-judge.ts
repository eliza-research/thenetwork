import type { SQL } from "../../core/src/runtime/postgres.ts";
import { LLMError, type Clock, type LLMErrorCode, type MemberId } from "@thenetwork/core";
import {
  judgeCallDeadlineMs, judgeCallDecision, judgeCallsPerRun, judgeClaimDecision, judgeLeaseMs, judgmentRetained, reviewJudgmentRetentionMs, type JudgeCall,
} from "../../core/src/generated/automatedReview.ts";
import { sha256, stableStringify } from "../../engine/src/hash.ts";
import {
  CANNOT_RUN_REASONS, CODE_FLAG_REASONS, FLAG_REASONS, JUDGE_VERDICTS, REVIEW_JUDGE_PROMPT_VERSION, SIMULATED_REASONS, UNDECIDED_REASONS,
  uncalledJudgment, type JudgeReasonCode, type JudgeVerdictName, type ReviewJudge, type ReviewJudgment, type ReviewPacket,
} from "../../engine/src/reviewJudge.ts";
import type { JudgeWork } from "../src/network.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { TeenAgeFacts } from "../../platform/src/accounts.ts";
import { dayOf } from "./cost.ts";
import type { NetworkRuntime } from "./runtime.ts";

type Env = Record<string, string | undefined>;

interface ReviewJudgeLimits { budgetMicros: number; requestLimit: number }
interface EngineJudgeLimits { maxCostMicro: number; maxRequests: number }
type JudgeCostPurpose = "review_judge" | "engine_judge";

function positiveUsd(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  const n = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number of US dollars (got ${JSON.stringify(raw)})`);
  return n;
}

function positiveMicros(env: Env, name: string, fallback: number): number {
  const micros = Math.round(positiveUsd(env, name, fallback) * 1e6);
  if (micros <= 0) throw new Error(`${name} must be at least 0.000001 US dollars (got ${JSON.stringify(env[name])})`);
  return micros;
}

function positiveCount(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  const n = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number (got ${JSON.stringify(raw)})`);
  return n;
}

export function reviewJudgeLimitsFromEnv(env: Env): ReviewJudgeLimits {
  return {
    budgetMicros: positiveMicros(env, "NETWORK_REVIEW_JUDGE_BUDGET_USD", 5),
    requestLimit: positiveCount(env, "NETWORK_REVIEW_JUDGE_MAX_REQUESTS", 400),
  };
}

export function engineJudgeLimitsFromEnv(env: Env): EngineJudgeLimits {
  return {
    maxCostMicro: positiveMicros(env, "NETWORK_ENGINE_JUDGE_BUDGET_USD", 2),
    maxRequests: positiveCount(env, "NETWORK_ENGINE_JUDGE_MAX_REQUESTS", 200),
  };
}

export async function llmSpentMicros(sql: SQL, app: AppId, day: string, purpose: JudgeCostPurpose): Promise<number> {
  const [row] = await sql<{ usd: number }[]>`select coalesce(sum(cost_usd), 0)::float8 as usd from network.cost_ledger
    where app_id = ${app} and day = ${day} and kind = 'llm' and detail->>'purpose' = ${purpose}`;
  return Math.round(Number(row?.usd ?? 0) * 1e6);
}

const KNOWN_REASONS: ReadonlySet<string> = new Set<JudgeReasonCode>(["none", ...FLAG_REASONS, ...CODE_FLAG_REASONS, ...UNDECIDED_REASONS, ...CANNOT_RUN_REASONS, ...SIMULATED_REASONS]);
const isJudgeReason = (v: unknown): v is JudgeReasonCode => typeof v === "string" && KNOWN_REASONS.has(v);
const isJudgeVerdict = (v: unknown): v is JudgeVerdictName => typeof v === "string" && (JUDGE_VERDICTS as readonly string[]).includes(v);
const isRubric = (v: unknown): v is ReviewPacket["rubric"] => v === "adult" || v === "minor";

const ERROR_OUTCOME = {
  budget: { verdict: "cannot_run", reason: "budget_reached" },
  timeout: { verdict: "cannot_run", reason: "timeout" },
  deadline: { verdict: "cannot_run", reason: "timeout" },
  bad_response: { verdict: "undecided", reason: "unparseable" },
  truncated: { verdict: "undecided", reason: "unparseable" },
  no_json: { verdict: "undecided", reason: "unparseable" },
  http: { verdict: "cannot_run", reason: "model_error" },
  network: { verdict: "cannot_run", reason: "model_error" },
  aborted: { verdict: "cannot_run", reason: "model_error" },
} as const satisfies Record<LLMErrorCode, { verdict: JudgeVerdictName; reason: JudgeReasonCode }>;

interface Decided { verdict: JudgeVerdictName; reason: JudgeReasonCode; explanation: string | null; model: string | null; promptVersion: string; reviewer: string }
interface Item { work: JudgeWork; packet: ReviewPacket }
interface Claimed extends Item { claims: number }
interface StoredRow { opportunity_id: string; revision: number; packet_hash: string; base_packet_hash: string; rubric: string; verdict: string; reason: string; reviewer: string }

interface ReviewJudgeWorkerOptions {
  clock: Clock;
  judgeFor: (app: AppId) => ReviewJudge | undefined;
  teenFacts: (rt: NetworkRuntime, memberId: MemberId) => Promise<TeenAgeFacts>;
  limits: ReviewJudgeLimits;
  log: (line: string) => void;
}

export class ReviewJudgeWorker {
  constructor(private readonly o: ReviewJudgeWorkerOptions) {}

  async run(rt: NetworkRuntime, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const now = this.o.clock.now();
    const { work, close, openCaseMembers } = await rt.readState(n => ({
      ...n.judgePackets(now),
      openCaseMembers: n.safetyCases().filter(c => c.status !== "closed").map(c => c.memberId),
    }));
    if (close.length) await rt.unitOfWork(n => n.closeUnjudgeable(close));
    const judge = this.o.judgeFor(rt.app.id);
    const reviewer = rt.net.judgeReviewer;
    const items = await Promise.all(work.map(w => this.enrich(rt, w)));
    if (items.length) {
      const spentMicros = await rt.scoped(tx => llmSpentMicros(tx, rt.app.id, dayOf(now), "review_judge"));
      const calls: Claimed[] = [];
      for (const item of items) {
        if (calls.length >= judgeCallsPerRun) break;
        const claimed = await rt.scoped(tx => this.claim(tx, rt, item, judge !== undefined, spentMicros, reviewer, now));
        if (claimed) calls.push(claimed);
      }
      if (judge) await Promise.all(calls.map(c => this.callAndStore(rt, judge, c, signal)));
      if (!signal.aborted) await this.apply(rt, items);
    }
    await this.purge(rt, now, new Set(openCaseMembers));
  }

  private async enrich(rt: NetworkRuntime, work: JudgeWork): Promise<Item> {
    const roster = await Promise.all(work.packet.roster.map(async m => {
      const memberId = work.members[m.ref];
      if (!m.teen || memberId === undefined) return m;
      return { ...m, teen: { ...m.teen, ...await this.o.teenFacts(rt, memberId) } };
    }));
    const enriched = { ...work.packet, roster };
    return { work, packet: { ...enriched, packetHash: sha256(stableStringify({ ...enriched, packetHash: undefined })) } };
  }

  private async claim(tx: SQL, rt: NetworkRuntime, item: Item, providerReady: boolean, spentMicros: number, reviewer: string, now: number): Promise<Claimed | undefined> {
    const { packet } = item;
    const [row] = await tx<{ status: string; claims: number; lease_until: Date }[]>`select status, claims, lease_until from network.review_judgments
      where app_id = ${rt.app.id} and network_id = ${rt.id} and opportunity_id = ${packet.oppId} and revision = ${packet.revision} and packet_hash = ${packet.packetHash}
      for update`;
    const claims = row?.claims ?? 0;
    const claim = judgeClaimDecision(row !== undefined, row?.status === "decided", claims, row !== undefined && new Date(row.lease_until).getTime() <= now);
    if (claim === "UseStored" || claim === "WaitForLease") return undefined;
    if (claim === "ClaimsSpent") {
      await this.writeDecided(tx, rt, packet, claims, { verdict: "cannot_run", reason: "interrupted", explanation: null, model: null, promptVersion: REVIEW_JUDGE_PROMPT_VERSION, reviewer }, now);
      return undefined;
    }
    const day = dayOf(now);
    const [counter] = await tx<{ n: number }[]>`select n from network.review_judge_requests where app_id = ${rt.app.id} and day = ${day}`;
    const decide = (requestsUsed: number) => judgeCallDecision(item.work.packetClean, item.work.priorFlag, providerReady, spentMicros, this.o.limits.budgetMicros,
      requestsUsed, this.o.limits.requestLimit, packet.deadline - now);
    const uncalled = (call: Exclude<JudgeCall, "CallJudge">): Decided => {
      const j = uncalledJudgment(packet, call, reviewer);
      return { verdict: j.verdict, reason: j.reason, explanation: null, model: null, promptVersion: REVIEW_JUDGE_PROMPT_VERSION, reviewer };
    };
    const call = decide(counter?.n ?? 0);
    if (call !== "CallJudge") {
      if (claim === "ClaimFirst") await this.insertDecided(tx, rt, item, uncalled(call), now);
      else await this.writeDecided(tx, rt, packet, claims, uncalled(call), now);
      return undefined;
    }
    const leaseUntil = new Date(now + judgeLeaseMs);
    const taken = claim === "ClaimFirst"
      ? await tx`insert into network.review_judgments (app_id, network_id, opportunity_id, revision, packet_hash, base_packet_hash, packet, member_ids, rubric,
          status, claims, claimed_at, lease_until, prompt_version)
        values (${rt.app.id}, ${rt.id}, ${packet.oppId}, ${packet.revision}, ${packet.packetHash}, ${packet.basePacketHash}, ${packet}::jsonb,
          ${tx.array(Object.values(item.work.members), "TEXT")}, ${packet.rubric}, 'running', 1, ${new Date(now)}, ${leaseUntil}, ${REVIEW_JUDGE_PROMPT_VERSION})
        on conflict do nothing returning 1 as taken`
      : await tx`update network.review_judgments set claims = claims + 1, lease_until = ${leaseUntil}
        where app_id = ${rt.app.id} and network_id = ${rt.id} and opportunity_id = ${packet.oppId} and revision = ${packet.revision}
          and packet_hash = ${packet.packetHash} and status = 'running' and claims = ${claims}
        returning 1 as taken`;
    if (!taken.length) return undefined;
    const slot = await tx`insert into network.review_judge_requests (app_id, day, n) values (${rt.app.id}, ${day}, 1)
      on conflict (app_id, day) do update set n = network.review_judge_requests.n + 1 where network.review_judge_requests.n < ${this.o.limits.requestLimit}
      returning n`;
    if (!slot.length) {
      const full = decide(this.o.limits.requestLimit);
      if (full !== "CallJudge") await this.writeDecided(tx, rt, packet, claims + 1, uncalled(full), now);
      return undefined;
    }
    return { ...item, claims: claims + 1 };
  }

  private async callAndStore(rt: NetworkRuntime, judge: ReviewJudge, c: Claimed, signal: AbortSignal): Promise<void> {
    const decided = await this.call(judge, c.packet, signal);
    if (!decided) return;
    try {
      await rt.scoped(tx => this.writeDecided(tx, rt, c.packet, c.claims, decided, this.o.clock.now()));
    } catch (e) {
      this.o.log(`[review-judge] ${c.packet.app} ${c.packet.oppId} r${c.packet.revision}: the judgment was not stored (${e instanceof Error ? e.message : String(e)}); the lease stays`);
    }
  }

  private async call(judge: ReviewJudge, packet: ReviewPacket, signal: AbortSignal): Promise<Decided | undefined> {
    try {
      const reply = await judge.judge(packet, { signal, deadlineMs: judgeCallDeadlineMs });
      return { verdict: reply.verdict, reason: reply.reason, explanation: reply.explanation, model: reply.model, promptVersion: reply.promptVersion, reviewer: judge.reviewer };
    } catch (e) {
      if (signal.aborted) return undefined;
      const outcome = e instanceof LLMError ? ERROR_OUTCOME[e.code] : ERROR_OUTCOME.network;
      this.o.log(`[review-judge] ${packet.app} ${packet.oppId} r${packet.revision}: ${outcome.verdict} (${outcome.reason})`);
      return { verdict: outcome.verdict, reason: outcome.reason, explanation: null, model: null, promptVersion: REVIEW_JUDGE_PROMPT_VERSION, reviewer: judge.reviewer };
    }
  }

  private async insertDecided(tx: SQL, rt: NetworkRuntime, item: Item, d: Decided, now: number): Promise<void> {
    const { packet } = item;
    const at = new Date(now);
    const written = await tx`insert into network.review_judgments (app_id, network_id, opportunity_id, revision, packet_hash, base_packet_hash, packet, member_ids, rubric,
        status, claims, claimed_at, lease_until, verdict, reason, explanation, model, prompt_version, decided_at, reviewer)
      values (${rt.app.id}, ${rt.id}, ${packet.oppId}, ${packet.revision}, ${packet.packetHash}, ${packet.basePacketHash}, ${packet}::jsonb,
        ${tx.array(Object.values(item.work.members), "TEXT")}, ${packet.rubric}, 'decided', 0, ${at}, ${at}, ${d.verdict}, ${d.reason}, ${d.explanation}, ${d.model},
        ${d.promptVersion}, ${at}, ${d.reviewer})
      on conflict do nothing returning 1 as written`;
    if (written.length) await this.auditJudgment(tx, rt, packet, d, now);
  }

  private async writeDecided(tx: SQL, rt: NetworkRuntime, packet: ReviewPacket, claims: number, d: Decided, now: number): Promise<void> {
    const written = await tx`update network.review_judgments set status = 'decided', verdict = ${d.verdict}, reason = ${d.reason}, explanation = ${d.explanation},
        model = ${d.model}, prompt_version = ${d.promptVersion}, decided_at = ${new Date(now)}, reviewer = ${d.reviewer}
      where app_id = ${rt.app.id} and network_id = ${rt.id} and opportunity_id = ${packet.oppId} and revision = ${packet.revision}
        and packet_hash = ${packet.packetHash} and status = 'running' and claims = ${claims}
      returning 1 as written`;
    if (written.length) await this.auditJudgment(tx, rt, packet, d, now);
  }

  private async auditJudgment(tx: SQL, rt: NetworkRuntime, packet: ReviewPacket, d: Decided, now: number): Promise<void> {
    await tx`insert into network.staff_audit (at, actor, action, target_type, target_id, mode, ok, detail, app_id)
      values (${new Date(now)}, 'review_judge', 'review_judgment', 'opportunity', ${packet.oppId}, 'real', true,
        ${{ revision: packet.revision, verdict: d.verdict, reason: d.reason, rubric: packet.rubric, packetHash: packet.packetHash }}::jsonb, ${rt.app.id})`;
  }

  private async apply(rt: NetworkRuntime, items: readonly Item[]): Promise<void> {
    const ids = [...new Set(items.map(i => i.packet.oppId))];
    const rows = await rt.scoped(tx => tx<StoredRow[]>`select opportunity_id, revision, packet_hash, base_packet_hash, rubric, verdict, reason, reviewer
      from network.review_judgments where app_id = ${rt.app.id} and network_id = ${rt.id} and status = 'decided'
        and opportunity_id = any(${tx.array(ids, "TEXT")})`);
    const judgments: ReviewJudgment[] = [];
    for (const { packet } of items) {
      const row = rows.find(r => r.opportunity_id === packet.oppId && r.revision === packet.revision && r.packet_hash === packet.packetHash);
      if (!row) continue;
      if (!isJudgeVerdict(row.verdict) || !isJudgeReason(row.reason) || !isRubric(row.rubric)) {
        this.o.log(`[review-judge] ${rt.id} ${packet.oppId} r${packet.revision}: a stored judgment does not parse; it is not applied`);
        continue;
      }
      judgments.push({
        oppId: packet.oppId, revision: packet.revision, verdict: row.verdict, reason: row.reason, reviewer: row.reviewer, rubric: row.rubric,
        basePacketHash: row.base_packet_hash, packetHash: row.packet_hash,
      });
    }
    if (judgments.length) await rt.unitOfWork(n => n.recordJudgments(judgments));
  }

  private async purge(rt: NetworkRuntime, now: number, openCaseMembers: ReadonlySet<string>): Promise<void> {
    await rt.scoped(async tx => {
      const rows = await tx<{ opportunity_id: string; revision: number; packet_hash: string; claimed_at: Date; member_ids: string[] }[]>`
        select opportunity_id, revision, packet_hash, claimed_at, member_ids from network.review_judgments
        where app_id = ${rt.app.id} and network_id = ${rt.id} and claimed_at <= ${new Date(now - reviewJudgmentRetentionMs)}
          and not (member_ids && ${tx.array([...openCaseMembers], "TEXT")})
        order by claimed_at limit 500`;
      for (const r of rows) {
        if (judgmentRetained(now - new Date(r.claimed_at).getTime(), r.member_ids.some(id => openCaseMembers.has(id)))) continue;
        await tx`delete from network.review_judgments where app_id = ${rt.app.id} and network_id = ${rt.id}
          and opportunity_id = ${r.opportunity_id} and revision = ${r.revision} and packet_hash = ${r.packet_hash}`;
      }
    });
  }
}
