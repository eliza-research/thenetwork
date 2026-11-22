import type { ConsentUpdate, Event, LineConsent, OtherWording, StopWording } from "../../packages/core/src/generated/sharedLineConsentJourney.ts";
import { withSignedTurnFixture, type FixtureMember } from "./signedTurnFixture.ts";
import { serveJourney } from "./serveJourney.ts";

type ConsentMember = FixtureMember & { lastStopAt?: number; output: ConsentUpdate[] };

const stopMessages: Record<StopWording, string> = {
  StopKeyword: "STOP",
  StopTextsKeepCalls: "Don't stop calling and stop texting me",
  QuitNow: "QUIT NOW",
  EndPlease: "END PLEASE",
  StopTextsAnymore: "I don't want texts anymore",
  SpanishCourtesyStop: "por favor basta",
};

const otherMessages: Record<OtherWording, string> = {
  CoordinatedNegation: "I don't want you to stop and unsubscribe me",
  AppNamedInClause: "Don't stop calling and unsubscribe from friends.help",
  ReportedUnsubscribe: "Don't stop calling and I can tell them to unsubscribe",
  CancelPlease: "cancel please",
  TextsAboutOneCategory: "I don't want any texts about jobs",
  TextsUntilAugust: "I don't want any messages until August",
  SpanishCancelPlease: "cancelar por favor",
  SpanishBajaNow: "baja ya",
};

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
      const { response, receivedAt } = event.type === "textStart"
        ? await sendTurn(member.phone, "START", {
          app: event.app === "Slop" ? "slop" : "friends",
          receivedAt: event.sentWithLastStop ? member.lastStopAt : undefined,
        })
        : await sendTurn(member.phone, event.type === "textStop" ? stopMessages[event.wording] : otherMessages[event.other]);
      member.output = [];
      if (event.type === "textOther" && response.outcome === "open") return "accepted";
      if (response.outcome !== "handled" || response.delivery !== "collected")
        throw new Error("The signed consent turn must collect its reply");
      if (event.type === "textStop") member.lastStopAt = receivedAt;
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
