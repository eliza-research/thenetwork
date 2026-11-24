import { HOUR } from "../../packages/core/src/index.ts";
import type { Event, MemberRequestJourney, RequestEffect } from "../../packages/core/src/generated/memberRequestJourney.ts";
import { Mini } from "../../packages/network/test/mini.ts";
import { serveJourney } from "./serveJourney.ts";

const requester = { id: "requester", name: "Ari Fixture", age: 30, interests: ["climbing"] };
const candidate = {
  id: "candidate", name: "Bo Fixture", age: 32, interests: ["climbing"], skills: ["climbing_belay"], shareable: true,
};

let network: Mini;
let effects: RequestEffect[];
const activeCandidate = () => network.net.memberList().some(member => member.id === candidate.id && member.stage === "active");
const reviewIds = () => network.net.exportState().opps.filter(opportunity => opportunity.stage === "review").map(opportunity => opportunity.id);

await serveJourney<Event>({
  async reset() {
    network = new Mini([requester], { seed: 1, inlineJudge: undefined, onboardingRequests: false });
    await network.onboard(requester.id);
    effects = [];
    return null;
  },

  async dispatch(_key, event) {
    const before = new Set(reviewIds());
    const from = network.mark();
    switch (event.type) {
      case "textRequest":
        await network.say(requester.id, "Find me a climbing partner.");
        break;
      case "textWithdrawal":
        await network.say(requester.id, "I no longer want a climbing partner.");
        break;
      case "candidateArrives":
        if (!activeCandidate()) {
          network.add(candidate);
          await network.onboard(candidate.id);
          // Monday 13:00 local to the next daily run at Tuesday 09:00 (Mini.START).
          await network.run(20 * HOUR);
        }
        break;
      case "restartJourney":
        network.restart();
        break;
    }
    const after = new Set(reviewIds());
    effects = [];
    for (const id of after) if (!before.has(id)) effects.push("ReviewQueued");
    for (const id of before) if (!after.has(id)) effects.push("ReviewCleared");
    if (network.sent.slice(from).some(message => message.meta.type === "probe" || message.meta.type === "reveal")) {
      effects.push("ParticipantContacted");
    }
    return "accepted";
  },

  observe(): MemberRequestJourney {
    const requests = network.net.exportState().requests.filter(request => request.memberId === requester.id && request.kind === "people");
    const last = requests.at(-1);
    let request: MemberRequestJourney["request"];
    if (!last) request = "NoRequest";
    else if (last.withdrawn && last.closed && last.outcome === "none") request = "WithdrawnRequest";
    else if (last.outcome === "none" && !last.closed) request = "WaitingForCandidate";
    else if (last.outcome === "probing" && last.oppId && reviewIds().includes(last.oppId)) request = "PendingReview";
    else throw new Error("The request is outside the expected waiting, review, and withdrawal states");
    return { candidateAvailable: activeCandidate(), request, requestCount: requests.length, attempts: last?.tries ?? 0 };
  },

  observeOutput: () => effects,
});
