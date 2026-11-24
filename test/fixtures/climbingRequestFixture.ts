import type { ReviewJudge } from "../../packages/engine/src/reviewJudge.ts";
import { withSignedTurnFixture, type SignedTurnFixture } from "./signedTurnFixture.ts";
import { deferred } from "./deferred.ts";

type Item = { oppId: string; deadline: number; origin: "request"; revision: number };

async function requestClimbingPartner(fixture: SignedTurnFixture) {
  const signup = { apps: ["friends"], interests: ["climbing", "hiking"], neighborhood: "Greenpoint" } satisfies Parameters<SignedTurnFixture["createMember"]>[1];
  const requester = await fixture.createMember({}, { ...signup, firstName: "Ari" });
  const candidate = await fixture.createMember({}, { ...signup, firstName: "Bo" });
  for (const member of [requester, candidate]) {
    await fixture.verifyFriendsAdult(member);
    for (const text of ["I enjoy climbing and hiking.", "Weekends mostly.", "One-on-one is good."]) {
      await fixture.sendTurn(member.phone, text, { app: "friends" });
    }
  }
  const { response } = await fixture.sendTurn(requester.phone,
    "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.", { app: "friends" });
  if (response.outcome !== "handled" || !response.memberId) throw new Error("The signed request did not reach a member conversation");
  const rows = await fixture.service.sql<{ id: string; deadline: Date; rerolls: number }[]>`
    select o.id, r.deadline, r.rerolls from network.review_items r join network.opportunities o on o.id = r.opportunity_id
    where o.app_id = 'friends' and o.state = 'IN_REVIEW' and r.origin = 'request' and r.decision is null`;
  const [row] = rows;
  if (!row || rows.length !== 1) throw new Error("The climbing request must queue one opportunity for review");
  const item: Item = { oppId: row.id, deadline: row.deadline.getTime(), origin: "request", revision: row.rerolls };
  return { ...fixture, item, requesterId: response.memberId, requester, candidate };
}

export function startClimbingRequestFixture(reviewJudge?: ReviewJudge, env?: Record<string, string>) {
  const ready = deferred<Awaited<ReturnType<typeof requestClimbingPartner>>>();
  const finished = deferred<void>();
  const closed = withSignedTurnFixture(async fixture => {
    ready.resolve(await requestClimbingPartner(fixture));
    await finished.promise;
  }, { friendsReview: true, ...(reviewJudge ? { reviewJudge } : {}), ...(env ? { env } : {}) });
  void closed.catch(ready.reject);
  return {
    ready: ready.promise,
    async close() { finished.resolve(); await closed; },
  };
}
