import { withSignedTurnFixture, type SignedTurnFixture } from "./signedTurnFixture.ts";

type Item = { oppId: string; deadline: number; origin: "request"; revision: number };

function isRequestItem(value: unknown): value is Item {
  return !!value && typeof value === "object" && "origin" in value && value.origin === "request" &&
    "oppId" in value && typeof value.oppId === "string" && "deadline" in value &&
    typeof value.deadline === "number" && Number.isSafeInteger(value.deadline) &&
    "revision" in value && typeof value.revision === "number" && Number.isSafeInteger(value.revision);
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
  return { ...fixture, item, requesterId: response.memberId, requester, candidate };
}

export function startClimbingRequestFixture() {
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
