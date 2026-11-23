import { beforeAll, describe, expect, test } from "vitest";
import { DAY, LLMError, MINUTE, OpenAILLM } from "@thenetwork/core";
import { judgeCallDeadlineMs, judgeLeaseMs } from "../../core/src/generated/automatedReview.ts";
import { sha256, stableStringify } from "../../engine/src/hash.ts";
import {
  holdEveryItem, modelReviewJudge, REVIEW_JUDGE_PROMPT_VERSION, SIM_REVIEW_JUDGE,
  type JudgeReasonCode, type ReviewJudge, type ReviewJudgeReply, type ReviewPacket,
} from "../../engine/src/reviewJudge.ts";
import { devPgUp } from "../../observatory/db/dev-pg.ts";
import { pgAvailable } from "../../observatory/test/pg.ts";
import { APPS } from "../../platform/src/apps.ts";
import { bootConfigProblems, MODEL_PROVIDER_MISSING } from "../../platform/src/env.ts";
import { dayOf } from "../service/cost.ts";
import { NetworkService } from "../service/service.ts";
import { startClimbingRequestFixture } from "../../../test/fixtures/climbingRequestFixture.ts";

const T = 300_000;

type Fixture = Awaited<ReturnType<typeof startClimbingRequestFixture>["ready"]>;
type Verdict = ReviewJudgeReply["verdict"];
interface JudgmentRow { status: string; claims: number; verdict: string | null; reason: string | null; model: string | null; explanation: string | null; member_ids: string[]; reviewer: string | null }

const reply = (verdict: Verdict, reason: JudgeReasonCode): ReviewJudgeReply =>
  ({ verdict, reason, explanation: "P1 and P2 both climb near Greenpoint and asked for a regular partner.", model: "scripted", promptVersion: REVIEW_JUDGE_PROMPT_VERSION });

function countingJudge(answer: (packet: ReviewPacket) => Promise<ReviewJudgeReply>) {
  const calls: ReviewPacket[] = [];
  const judge: ReviewJudge = { reviewer: SIM_REVIEW_JUDGE, judge: async packet => { calls.push(packet); return answer(packet); } };
  return { calls, judge };
}

const ADULT_CHECKS = "{\"fit\":\"pass\",\"texts_safe\":\"pass\",\"red_flags\":\"none\"}";
const EXPLANATION = "\"P1 and P2 both climb near Greenpoint and asked for a regular partner.\"";

function providerReplying(content: string) {
  return new OpenAILLM("synthetic-provider-key", "gpt-6-luna", "https://provider.invalid/v1", {
    maxRetries: 0,
    fetch: async () => Response.json({ model: "gpt-6-luna", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 30 } }),
  });
}

async function withItem(judge: ReviewJudge, body: (fx: Fixture) => Promise<void>, env?: Record<string, string>) {
  const fixture = startClimbingRequestFixture(judge, env);
  try { await body(await fixture.ready); } finally { await fixture.close(); }
}

const friends = (fx: Fixture) => fx.service.runtimeFor("friends")!;
const rowsOf = async (fx: Fixture) => await fx.service.sql`select status, claims, verdict, reason, model, explanation, member_ids, reviewer from network.review_judgments
  where app_id = 'friends' and opportunity_id = ${fx.item.oppId} order by claimed_at` as JudgmentRow[];
const audits = async (fx: Fixture) => ((await fx.service.sql`select count(*)::int as n from network.staff_audit
  where actor = 'review_judge' and action = 'review_judgment' and target_type = 'opportunity' and target_id = ${fx.item.oppId}`)[0] as { n: number }).n;
const outbound = async (fx: Fixture) => ((await fx.service.sql`select count(*)::int as n from network.messages
  where app_id = 'friends' and opportunity_id = ${fx.item.oppId} and direction = 'outbound'`)[0] as { n: number }).n;
const requestsToday = async (fx: Fixture) => ((await fx.service.sql`select coalesce(sum(n), 0)::int as n from network.review_judge_requests
  where app_id = 'friends' and day = ${dayOf(fx.clock.now())}`)[0] as { n: number }).n;
const reviewRow = async (fx: Fixture) => (await fx.service.sql`select decision, approver, exception_reason from network.review_items
  where app_id = 'friends' and opportunity_id = ${fx.item.oppId}`)[0] as { decision: string | null; approver: string | null; exception_reason: string | null };
async function heldItem(fx: Fixture) {
  const res = await fx.reviewQueue();
  expect(res.status).toBe(200);
  const queue = await res.json() as { items?: { oppId: string; exception?: { verdict: string; reason: string } }[] };
  return (queue.items ?? []).find(x => x.oppId === fx.item.oppId);
}
async function settle(fx: Fixture) {
  await fx.service.reviewJudgeTick();
  fx.clock.advance(MINUTE);
  await friends(fx).tick();
}

describe.skipIf(!pgAvailable)("the review judge worker (NetworkService, Postgres)", () => {
  beforeAll(async () => { await devPgUp(); }, T);

  test("a judge approval is stored once, audited without the explanation, counted, and starts the first probe", async () => {
    const { calls, judge } = countingJudge(async () => reply("approve", "none"));
    await withItem(judge, async fx => {
      expect(await outbound(fx)).toBe(0);
      await settle(fx);
      expect(calls).toHaveLength(1);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", claims: 1, verdict: "approve", reason: "none", model: "scripted", reviewer: SIM_REVIEW_JUDGE })]);
      expect(await audits(fx)).toBe(1);
      const [audit] = await fx.service.sql`select detail from network.staff_audit where actor = 'review_judge' and target_id = ${fx.item.oppId}` as { detail: Record<string, unknown> }[];
      expect(Object.keys(audit!.detail).sort()).toEqual(["packetHash", "reason", "revision", "rubric", "verdict"]);
      expect(await requestsToday(fx)).toBe(1);
      expect(await reviewRow(fx)).toMatchObject({ decision: "approve", approver: "judge" });
      expect(await outbound(fx)).toBeGreaterThan(0);
      expect(await heldItem(fx)).toBeUndefined();
    });
  }, T);

  test("a flag holds the item in the staff queue with its reason, and nobody is contacted", async () => {
    const { judge } = countingJudge(async () => reply("flag", "red_flag"));
    await withItem(judge, async fx => {
      await settle(fx);
      expect(await heldItem(fx)).toMatchObject({ exception: { verdict: "flag", reason: "red_flag" } });
      expect(await reviewRow(fx)).toMatchObject({ decision: null, approver: null, exception_reason: "red_flag" });
      expect(await outbound(fx)).toBe(0);
    });
  }, T);

  test("a model reply with the verdict before the explanation is unparseable and holds the item", async () => {
    const judge = modelReviewJudge(providerReplying(`{"verdict":"approve","explanation":${EXPLANATION},"checks":${ADULT_CHECKS},"reason":"none"}`), "gpt-6-luna");
    await withItem(judge, async fx => {
      await settle(fx);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", verdict: "undecided", reason: "unparseable", explanation: "", model: "gpt-6-luna" })]);
      expect(await heldItem(fx)).toMatchObject({ exception: { verdict: "undecided", reason: "unparseable" } });
      expect(await outbound(fx)).toBe(0);
    });
  }, T);

  test("on the minor rubric an approval with a minor concern is inconsistent, and a minor check on the adult rubric does not parse", async () => {
    const content = `{"explanation":${EXPLANATION},"checks":{"fit":"pass","texts_safe":"pass","red_flags":"none","minor":"concern"},"verdict":"approve","reason":"none"}`;
    await withItem(holdEveryItem.judge, async fx => {
      const { work } = await friends(fx).readState(n => n.judgePackets(fx.clock.now()));
      const packet = work.find(w => w.packet.oppId === fx.item.oppId)!.packet;
      const judge = modelReviewJudge(providerReplying(content), "gpt-6-luna");
      const o = { signal: new AbortController().signal, deadlineMs: judgeCallDeadlineMs };
      expect(await judge.judge({ ...packet, rubric: "minor" }, o)).toMatchObject({ verdict: "undecided", reason: "inconsistent_reply" });
      expect(await judge.judge({ ...packet, rubric: "adult" }, o)).toMatchObject({ verdict: "undecided", reason: "unparseable", explanation: "" });
    });
  }, T);

  test("a model timeout is stored as cannot run, audited, and holds the item", async () => {
    const { calls, judge } = countingJudge(async () => { throw new LLMError("timeout", "synthetic provider timeout"); });
    await withItem(judge, async fx => {
      await settle(fx);
      expect(calls).toHaveLength(1);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", verdict: "cannot_run", reason: "timeout", model: null })]);
      expect(await audits(fx)).toBe(1);
      expect(await heldItem(fx)).toMatchObject({ exception: { verdict: "cannot_run", reason: "timeout" } });
      expect(await outbound(fx)).toBe(0);
    });
  }, T);

  test("a ledger at the daily review budget makes no call and holds the item as budget reached", async () => {
    const { calls, judge } = countingJudge(async () => reply("approve", "none"));
    await withItem(judge, async fx => {
      await fx.service.sql`insert into network.cost_ledger (id, app_id, day, at, kind, provider, quantity, cost_usd, estimated, detail)
        values ('cost_review_judge_budget_fixture', 'friends', ${dayOf(fx.clock.now())}, ${new Date(fx.clock.now())}, 'llm', 'provider.invalid', 1, 5, true,
          ${{ purpose: "review_judge" }}::jsonb)`;
      await settle(fx);
      expect(calls).toHaveLength(0);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", claims: 0, verdict: "cannot_run", reason: "budget_reached" })]);
      expect(await audits(fx)).toBe(1);
      expect(await heldItem(fx)).toMatchObject({ exception: { reason: "budget_reached" } });
      expect(await outbound(fx)).toBe(0);
    });
  }, T);

  test("a request counter at NETWORK_REVIEW_JUDGE_MAX_REQUESTS makes no call and holds the item as request limit reached", async () => {
    const { calls, judge } = countingJudge(async () => reply("approve", "none"));
    await withItem(judge, async fx => {
      await fx.service.sql`insert into network.review_judge_requests (app_id, day, n) values ('friends', ${dayOf(fx.clock.now())}, 1)`;
      await settle(fx);
      expect(calls).toHaveLength(0);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", verdict: "cannot_run", reason: "request_limit_reached" })]);
      expect(await requestsToday(fx)).toBe(1);
      expect(await heldItem(fx)).toMatchObject({ exception: { reason: "request_limit_reached" } });
    }, { NETWORK_REVIEW_JUDGE_MAX_REQUESTS: "1" });
  }, T);

  test("two services on one database judge one item with one call and one stored row", async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const judging = new Promise<void>(resolve => { entered = resolve; });
    const { calls, judge } = countingJudge(async () => {
      if (calls.length === 1) { entered(); await gate; }
      return reply("approve", "none");
    });
    await withItem(judge, async fx => {
      const peer = await fx.openPeer(judge);
      const first = fx.service.reviewJudgeTick();
      await judging;
      await peer.reviewJudgeTick();
      release();
      await first;
      await settle(fx);
      expect(calls).toHaveLength(1);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", claims: 1, verdict: "approve" })]);
      expect(await audits(fx)).toBe(1);
      expect(await requestsToday(fx)).toBe(1);
      expect(await reviewRow(fx)).toMatchObject({ decision: "approve", approver: "judge" });
    });
  }, T);

  test("a running row with an expired lease and two claims is decided as interrupted without a call", async () => {
    const { calls, judge } = countingJudge(async () => reply("approve", "none"));
    await withItem(judge, async fx => {
      const { work } = await friends(fx).readState(n => n.judgePackets(fx.clock.now()));
      const { packet, members } = work.find(w => w.packet.oppId === fx.item.oppId)!;
      const packetHash = sha256(stableStringify({ ...packet, packetHash: undefined }));
      const claimed = new Date(fx.clock.now() - 2 * judgeLeaseMs);
      await fx.service.sql`insert into network.review_judgments (app_id, network_id, opportunity_id, revision, packet_hash, base_packet_hash, packet, member_ids, rubric,
          status, claims, claimed_at, lease_until, prompt_version)
        values ('friends', 'friends:nyc', ${packet.oppId}, ${packet.revision}, ${packetHash}, ${packet.basePacketHash}, ${{ ...packet, packetHash }}::jsonb,
          ${fx.service.sql.array(Object.values(members), "TEXT")}, 'adult', 'running', 2, ${claimed}, ${new Date(fx.clock.now() - 1)}, ${REVIEW_JUDGE_PROMPT_VERSION})`;
      await settle(fx);
      expect(calls).toHaveLength(0);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", claims: 2, verdict: "cannot_run", reason: "interrupted" })]);
      expect(await audits(fx)).toBe(1);
      expect(await heldItem(fx)).toMatchObject({ exception: { verdict: "cannot_run", reason: "interrupted" } });
    });
  }, T);

  test("a stored approval written by another judge is not applied, and nobody is contacted", async () => {
    const { calls, judge } = countingJudge(async () => reply("approve", "none"));
    await withItem(judge, async fx => {
      const { work } = await friends(fx).readState(n => n.judgePackets(fx.clock.now()));
      const { packet, members } = work.find(w => w.packet.oppId === fx.item.oppId)!;
      const packetHash = sha256(stableStringify({ ...packet, packetHash: undefined }));
      const at = new Date(fx.clock.now());
      await fx.service.sql`insert into network.review_judgments (app_id, network_id, opportunity_id, revision, packet_hash, base_packet_hash, packet, member_ids, rubric,
          status, claims, claimed_at, lease_until, verdict, reason, prompt_version, decided_at, reviewer)
        values ('friends', 'friends:nyc', ${packet.oppId}, ${packet.revision}, ${packetHash}, ${packet.basePacketHash}, ${{ ...packet, packetHash }}::jsonb,
          ${fx.service.sql.array(Object.values(members), "TEXT")}, 'adult', 'decided', 1, ${at}, ${at}, 'approve', 'none', ${REVIEW_JUDGE_PROMPT_VERSION}, ${at}, 'judge-from-another-process')`;
      await settle(fx);
      expect(calls).toHaveLength(0);
      expect(await outbound(fx)).toBe(0);
      const review = await reviewRow(fx);
      expect([review?.decision ?? null, review?.approver ?? null]).toEqual([null, null]);
    });
  }, T);

  test("a call longer than one tick is not claimed again and its approval is applied once", async () => {
    const holder: { fx?: Fixture } = {};
    const { calls, judge } = countingJudge(async () => {
      holder.fx!.clock.advance(150_000);
      await holder.fx!.service.reviewJudgeTick();
      return reply("approve", "none");
    });
    await withItem(judge, async fx => {
      holder.fx = fx;
      await settle(fx);
      expect(calls).toHaveLength(1);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", claims: 1, verdict: "approve" })]);
      expect(await audits(fx)).toBe(1);
      expect(await requestsToday(fx)).toBe(1);
      expect(await reviewRow(fx)).toMatchObject({ decision: "approve", approver: "judge" });
      expect(await outbound(fx)).toBeGreaterThan(0);
    });
  }, T);

  test("a deployed start needs a model key, and a deployed service refuses an injected judge", () => {
    const deployed = { PLATFORM_ENV: "staging", PLATFORM_HASH_KEY: "h".repeat(40), SERVICE_TURN_SECRET: "t".repeat(40) };
    expect(bootConfigProblems(deployed)).toContain(MODEL_PROVIDER_MISSING);
    expect(bootConfigProblems({ ...deployed, SURPLUS_API_KEY: "synthetic-surplus-key" })).not.toContain(MODEL_PROVIDER_MISSING);
    for (const injected of [{ reviewJudge: holdEveryItem.judge }, { engineJudge: providerReplying("{}") }]) {
      expect(() => new NetworkService({ url: "postgres://synthetic@127.0.0.1:1/none", env: deployed, log: () => {}, ...injected }))
        .toThrow("reviewJudge and engineJudge injection is for tests in PLATFORM_ENV=dev");
    }
    for (const name of ["NETWORK_REVIEW_JUDGE_BUDGET_USD", "NETWORK_ENGINE_JUDGE_BUDGET_USD"]) {
      expect(() => new NetworkService({ url: "postgres://synthetic@127.0.0.1:1/none", env: { ...deployed, PLATFORM_ENV: "dev", [name]: "0.0000001" }, log: () => {} }))
        .toThrow(`${name} must be at least 0.000001 US dollars`);
    }
  });

  test("erasure deletes the member's judgments, the purge keeps an old judgment of a member with an open safety case, and the request counter stays", async () => {
    const { judge } = countingJudge(async () => reply("flag", "weak_fit"));
    await withItem(judge, async fx => {
      await settle(fx);
      expect(await rowsOf(fx)).toHaveLength(1);
      const [candidate] = await fx.service.sql`select m.id from network.members m join platform.phone_identities p on p.person_id = m.person_id
        where m.app_id = 'friends' and p.e164 = ${fx.candidate.phone}` as { id: string }[];
      const candidateId = candidate!.id;
      expect(await friends(fx).unitOfWork(n => n.holdMember(candidateId, "safety-fixture", "open case for the retention check"))).toEqual({ ok: true });
      expect(await friends(fx).readState(n => n.safetyCases().some(c => c.memberId === candidateId && c.status !== "closed"))).toBe(true);
      const older = new Date(fx.clock.now() - 92 * DAY), old = new Date(fx.clock.now() - 91 * DAY);
      await fx.service.sql`insert into network.review_judgments (app_id, network_id, opportunity_id, revision, packet_hash, base_packet_hash, packet, member_ids, rubric,
          status, claims, claimed_at, lease_until, verdict, reason, prompt_version, decided_at, reviewer)
        select 'friends', 'friends:nyc', 'opp-retained-fixture', g, 'hash-opp-retained-fixture', 'hash-opp-retained-fixture', '{}'::jsonb, ${fx.service.sql.array([candidateId], "TEXT")}, 'adult',
          'decided', 0, ${older}, ${older}, 'flag', 'weak_fit', ${REVIEW_JUDGE_PROMPT_VERSION}, ${older}, ${SIM_REVIEW_JUDGE}
        from generate_series(0, 500) g`;
      await fx.service.sql`insert into network.review_judgments (app_id, network_id, opportunity_id, revision, packet_hash, base_packet_hash, packet, member_ids, rubric,
          status, claims, claimed_at, lease_until, verdict, reason, prompt_version, decided_at, reviewer)
        values ('friends', 'friends:nyc', 'opp-purged-fixture', 0, 'hash-opp-purged-fixture', 'hash-opp-purged-fixture', '{}'::jsonb, ${fx.service.sql.array(["member-gone-fixture"], "TEXT")}, 'adult',
          'decided', 0, ${old}, ${old}, 'flag', 'weak_fit', ${REVIEW_JUDGE_PROMPT_VERSION}, ${old}, ${SIM_REVIEW_JUDGE})`;
      await fx.service.reviewJudgeTick();
      const kept = await fx.service.sql`select opportunity_id, count(*)::int as n from network.review_judgments where app_id = 'friends' and opportunity_id like 'opp-%-fixture'
        group by opportunity_id` as { opportunity_id: string; n: number }[];
      expect(kept).toEqual([{ opportunity_id: "opp-retained-fixture", n: 501 }]);
      expect(await requestsToday(fx)).toBe(1);
      expect(await fx.service.accounts.leave(APPS.friends, { e164: fx.requester.phone, personId: fx.requester.personId })).toBe(true);
      expect(await rowsOf(fx)).toEqual([]);
      expect((await fx.service.sql`select count(*)::int as n from network.review_judgments where app_id = 'friends' and opportunity_id = 'opp-retained-fixture'`)[0]!.n).toBe(501);
      expect(await requestsToday(fx)).toBe(1);
    });
  }, T);

  test("a reply with a second verdict and reason after a flag does not parse and holds the item", async () => {
    const content = `{"explanation":${EXPLANATION},"checks":${ADULT_CHECKS},"verdict":"flag","reason":"red_flag","verdict":"approve","reason":"none"}`;
    await withItem(modelReviewJudge(providerReplying(content), "gpt-6-luna"), async fx => {
      await settle(fx);
      expect(await rowsOf(fx)).toEqual([expect.objectContaining({ status: "decided", verdict: "undecided", reason: "unparseable" })]);
      expect(await heldItem(fx)).toMatchObject({ exception: { verdict: "undecided", reason: "unparseable" } });
      expect(await outbound(fx)).toBe(0);
    });
  }, T);
});
