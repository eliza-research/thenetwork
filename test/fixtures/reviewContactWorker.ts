import type { ContactReview, Event, ReviewContactJourney, ReviewReply } from "../../packages/core/src/generated/reviewContactJourney.ts";
import { serveJourney } from "./serveJourney.ts";
import { withSignedTurnFixture, type SignedTurnFixture } from "./signedTurnFixture.ts";

type Item = { oppId: string; deadline: number; origin: "request" };

function isRequestItem(value: unknown): value is Item {
  return !!value && typeof value === "object" && "origin" in value && value.origin === "request" &&
    "oppId" in value && typeof value.oppId === "string" && "deadline" in value &&
    typeof value.deadline === "number" && Number.isSafeInteger(value.deadline);
}

async function requestClimbingPartner(fixture: SignedTurnFixture) {
  const signup = { apps: ["friends"], interests: ["climbing", "hiking"], neighborhood: "Greenpoint" } satisfies Parameters<SignedTurnFixture["createMember"]>[1];
  const requester = await fixture.createMember({}, { ...signup, firstName: "Ari" });
  const candidate = await fixture.createMember({}, { ...signup, firstName: "Bo" });
  for (const { phone } of [requester, candidate]) {
    for (const text of ["I enjoy climbing and hiking.", "Weekends mostly.", "One-on-one is good."]) {
      await fixture.sendTurn(phone, text, { app: "friends" });
    }
  }
  const { response } = await fixture.sendTurn(requester.phone,
    "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.", { app: "friends" });
  if (response.outcome !== "handled" || !response.memberId) throw new Error("The signed request did not reach a member conversation");
  const reply = await fixture.reviewQueue();
  const queue: unknown = await reply.json();
  if (!reply.ok || !queue || typeof queue !== "object" || !("items" in queue) || !Array.isArray(queue.items)) {
    throw new Error("The reviewer could not read the stored queue");
  }
  const items = queue.items.filter(isRequestItem);
  const [item] = items;
  if (!item || items.length !== 1) throw new Error("The climbing request must queue one opportunity for human review");
  return { ...fixture, item, requesterId: response.memberId };
}

function startReviewJourney() {
  const ready = Promise.withResolvers<Awaited<ReturnType<typeof requestClimbingPartner>>>();
  const finished = Promise.withResolvers<void>();
  const closed = withSignedTurnFixture(async fixture => {
    ready.resolve(await requestClimbingPartner(fixture));
    await finished.promise;
  }, { friendsReview: true });
  void closed.catch(ready.reject);
  return {
    ready: ready.promise,
    async close() { finished.resolve(); await closed; },
  };
}

const decisions = { approve: "ReviewerApproved", reject: "ReviewerRejected", expired: "ReviewExpired" } satisfies Record<string, ContactReview>;
type StoredDecision = keyof typeof decisions;
let fixture: ReturnType<typeof startReviewJourney> | undefined;
let output: ReviewReply[] = [];

async function current() {
  if (!fixture) throw new Error("Reset the review journey before using it");
  return fixture.ready;
}

try {
  await serveJourney<Event>({
    async reset() {
      await fixture?.close();
      fixture = startReviewJourney();
      await fixture.ready;
      output = [];
      return null;
    },
    async dispatch(_key, event): Promise<"accepted"> {
      const { clock, service, item, decideReview } = await current();
      if (event.type === "runServiceTick") {
        if (!await service.tick()) throw new Error("The service did not take its tick");
        output = [];
      } else {
        if (event.atDeadline) clock.set(item.deadline);
        const result = event.approve ? await decideReview(item.oppId, "approve") : await decideReview(item.oppId, "reject", "weak_reason");
        const body: unknown = await result.json();
        if (result.status === 200 && body && typeof body === "object" && "ok" in body && body.ok === true) {
          output = ["DecisionAccepted"];
        } else if (result.status === 409 && body && typeof body === "object" && "reason" in body) {
          if (body.reason === "review_expired") output = ["DeadlinePassed"];
          else if (body.reason === "not_in_review") output = ["NoLongerPending"];
          else throw new Error(`The service refused the review with ${String(body.reason)}`);
        } else throw new Error(`Unexpected review result ${result.status}: ${JSON.stringify(body)}`);
      }
      return "accepted";
    },

    async observe(): Promise<ReviewContactJourney> {
      const { service, item, requesterId } = await current();
      const [row] = await service.sql<{ state: string; decision: StoredDecision | null; reviewer: string | null }[]>`
        select o.state, r.decision, r.reviewer from network.review_items r join network.opportunities o on o.id = r.opportunity_id
        where o.app_id = 'friends' and o.id = ${item.oppId}`;
      if (!row) throw new Error("The opportunity or review record is missing");
      const review = row.decision === null ? "AwaitingReviewer" : decisions[row.decision];
      const expectedState = review === "AwaitingReviewer" ? "IN_REVIEW" : review === "ReviewerApproved" ? "PROPOSED" : "SKIPPED";
      if (row.state !== expectedState) throw new Error(`Recorded review ${review} has an unexpected opportunity state ${row.state}`);
      if ((review === "ReviewerApproved" || review === "ReviewerRejected") && !row.reviewer?.startsWith("token:reviewer#")) {
        throw new Error("The stored decision has no reviewer of record");
      }
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
