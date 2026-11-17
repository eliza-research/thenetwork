import type { ConsentUpdate, Event, LineConsent } from "../../packages/core/src/generated/sharedLineConsentJourney.ts";
import { withSignedTurnFixture, type FixtureMember } from "./signedTurnFixture.ts";
import { serveJourney } from "./serveJourney.ts";

type ConsentMember = FixtureMember & { lastStopAt?: number; output: ConsentUpdate[] };

await withSignedTurnFixture(async ({ service, createMember, sendTurn }) => {
  const members = new Map<string, ConsentMember>();

  async function memberFor(key: string): Promise<ConsentMember> {
    const current = members.get(key);
    if (current) return current;
    const member = { ...await createMember(), output: [] };
    members.set(key, member);
    return member;
  }

  await serveJourney<Event>({
    reset: () => { members.clear(); return null; },
    async dispatch(key, event) {
      const member = await memberFor(key);
      const { response, receivedAt } = event.type === "textStop"
        ? await sendTurn(member.phone, "STOP")
        : await sendTurn(member.phone, "START", {
          app: event.app === "Slop" ? "slop" : "friends",
          receivedAt: event.sentWithLastStop ? member.lastStopAt : undefined,
        });
      if (response.outcome !== "handled" || response.delivery !== "collected")
        throw new Error("The signed consent turn must collect its reply");
      if (event.type === "textStop") member.lastStopAt = receivedAt;
      member.output = [];
      if (response.consent) {
        const { scope, state, app, at } = response.consent;
        if (at !== receivedAt) throw new Error("The consent update lost the gateway receipt time");
        if (scope === "all" && state === "opted_out" && app === null) member.output = ["AllOptedOut"];
        else if (scope === "app" && state === "opted_in" && app === "slop") member.output = ["SlopOptedIn"];
        else if (scope === "app" && state === "opted_in" && app === "friends") member.output = ["FriendsOptedIn"];
        else throw new Error(`Unexpected consent update ${JSON.stringify(response.consent)}`);
      }
      return "accepted";
    },
    async observe(key): Promise<LineConsent> {
      const { phone } = await memberFor(key);
      return {
        slopMayText: await service.accounts.optedIn("slop", phone),
        friendsMayText: await service.accounts.optedIn("friends", phone),
      };
    },
    async observeOutput(key) { return (await memberFor(key)).output; },
  });
});
