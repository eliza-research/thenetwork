import type { ContactReview, Event, ReviewContactJourney, ReviewReply } from "../../packages/core/src/generated/reviewContactJourney.ts";
import { REVIEW_JUDGE_PROMPT_VERSION, SIM_REVIEW_JUDGE, type ReviewJudge } from "../../packages/engine/src/reviewJudge.ts";
import { startClimbingRequestFixture } from "./climbingRequestFixture.ts";
import { serveJourney } from "./serveJourney.ts";

type StoredDecision = "approve" | "reject" | "expired";
let fixture: ReturnType<typeof startClimbingRequestFixture> | undefined;
let output: ReviewReply[] = [];
const verdict: { next: "approve" | "flag" } = { next: "flag" };
const judge: ReviewJudge = {
  reviewer: SIM_REVIEW_JUDGE,
  judge: async () => ({
    verdict: verdict.next, reason: verdict.next === "approve" ? "none" : "other_concern", explanation: "journey judgment",
    model: "simulated", promptVersion: REVIEW_JUDGE_PROMPT_VERSION,
  }),
};

async function current() {
  if (!fixture) throw new Error("Reset the review journey before using it");
  return fixture.ready;
}

async function reviewOf(): Promise<{ review: ContactReview; state: string; reviewer: string | null }> {
  const { service, item } = await current();
  const [row] = await service.sql<{ state: string; decision: StoredDecision | null; reviewer: string | null; approver: "judge" | "staff" | null; exception_reason: string | null }[]>`
    select o.state, r.decision, r.reviewer, r.approver, r.exception_reason from network.review_items r join network.opportunities o on o.id = r.opportunity_id
    where o.app_id = 'friends' and o.id = ${item.oppId}`;
  if (!row) throw new Error("The opportunity or review record is missing");
  const review: ContactReview = row.decision === null ? (row.exception_reason === null ? "AwaitingJudge" : "HeldForStaff")
    : row.decision === "approve" ? (row.approver === "judge" ? "JudgeApproved" : "StaffApproved")
    : row.decision === "reject" ? "ReviewerRejected"
    : row.exception_reason !== null && row.exception_reason !== "judge_overdue" ? "HeldExpired" : "ReviewExpired";
  return { review, state: row.state, reviewer: row.reviewer };
}

try {
  await serveJourney<Event>({
    async reset() {
      await fixture?.close();
      fixture = startClimbingRequestFixture(judge);
      await fixture.ready;
      output = [];
      return null;
    },
    async dispatch(_key, event): Promise<"accepted"> {
      const { clock, service, item, decideReview } = await current();
      const runtime = service.runtimeFor("friends");
      if (!runtime) throw new Error("The friends network is missing");
      if (event.type === "runServiceTick") {
        if (!await runtime.tick()) throw new Error("The network did not take its tick");
        output = [];
      } else if (event.type === "recordJudgment") {
        const before = await reviewOf();
        if (before.review !== "AwaitingJudge") {
          const refused = await runtime.unitOfWork(n => n.recordJudgment({
            oppId: item.oppId, revision: item.revision, verdict: event.approve ? "approve" : "flag", reason: event.approve ? "none" : "other_concern",
            reviewer: n.judgeReviewer, rubric: "adult", basePacketHash: "", packetHash: "",
          }));
          if (refused.ok || refused.reason !== "judgment_stale") throw new Error(`A judgment after review applied: ${JSON.stringify(refused)}`);
          output = ["NoLongerPending"];
        } else {
          if (event.atDeadline) clock.set(item.deadline);
          verdict.next = event.approve ? "approve" : "flag";
          if (!await service.tick()) throw new Error("The service did not take its tick");
          const after = await reviewOf();
          if (after.review === "ReviewExpired") output = ["DeadlinePassed"];
          else if (after.review === "JudgeApproved" || after.review === "HeldForStaff") output = ["DecisionAccepted"];
          else throw new Error(`The judge step left the review ${after.review}`);
        }
      } else {
        if (event.atDeadline) clock.set(item.deadline);
        const result = event.approve ? await decideReview(item, "approve") : await decideReview(item, "reject", "weak_reason");
        const body: unknown = await result.json();
        if (result.status === 200 && body && typeof body === "object" && "ok" in body && body.ok === true) {
          output = ["DecisionAccepted"];
        } else if (result.status === 409 && body && typeof body === "object" && "reason" in body) {
          if (body.reason === "review_expired") output = ["DeadlinePassed"];
          else if (body.reason === "not_in_review") output = ["NoLongerPending"];
          else if (body.reason === "not_held_for_staff") output = ["NotHeldForStaff"];
          else throw new Error(`The service refused the review with ${String(body.reason)}`);
        } else throw new Error(`Unexpected review result ${result.status}: ${JSON.stringify(body)}`);
      }
      return "accepted";
    },

    async observe(): Promise<ReviewContactJourney> {
      const { service, item, requesterId } = await current();
      const { review, state, reviewer } = await reviewOf();
      const expectedState = review === "AwaitingJudge" || review === "HeldForStaff" ? "IN_REVIEW"
        : review === "JudgeApproved" || review === "StaffApproved" ? "PROPOSED" : "SKIPPED";
      if (state !== expectedState) throw new Error(`Recorded review ${review} has an unexpected opportunity state ${state}`);
      if ((review === "StaffApproved" || review === "ReviewerRejected") && !reviewer?.startsWith("token:reviewer#")) {
        throw new Error("The stored staff decision has no reviewer of record");
      }
      if (review === "JudgeApproved" && reviewer !== SIM_REVIEW_JUDGE) throw new Error("The stored judge approval does not name the judge");
      const messages = await service.sql<{ member_id: string; type: string; status: string; body: string }[]>`
        select member_id, type, status, body from network.messages
        where app_id = 'friends' and opportunity_id = ${item.oppId} and direction = 'outbound'`;
      for (const message of messages) {
        if (message.member_id !== requesterId || message.type !== "probe" || message.status !== "dry_run" || /\b(?:Ari|Bo)\b/i.test(message.body)) {
          throw new Error("The first contact must be an anonymous dry-run probe to the requester");
        }
      }
      return { review, probeCount: messages.length };
    },
    observeOutput: () => output,
  });
} finally {
  await fixture?.close();
}
