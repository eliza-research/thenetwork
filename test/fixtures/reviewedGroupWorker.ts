import { HOUR } from "../../packages/core/src/index.ts";
import type { Event, GroupEffect, Hiker, ReviewedGroupJourney } from "../../packages/core/src/generated/reviewedGroupJourney.ts";
import { Mini, type Spec } from "../../packages/network/test/mini.ts";
import { serveJourney } from "./serveJourney.ts";
import { holdEveryItem, simulatedReviewJudge, type InlineReviewJudge } from "../../packages/engine/src/reviewJudge.ts";

const hikers = ["FirstHiker", "SecondHiker", "ThirdHiker"] as const satisfies readonly Hiker[];
const people: Record<Hiker, Spec> = {
  FirstHiker: { id: "ari", name: "Ari Fixture", age: 30 },
  SecondHiker: { id: "bo", name: "Bo Fixture", age: 31 },
  ThirdHiker: { id: "cy", name: "Cy Fixture", age: 32 },
};
const names = /\b(?:Ari|Bo|Cy)\b/i;
let world: Mini;
let groupId: string;
let effects: GroupEffect[];
let judge: InlineReviewJudge = () => null;

function group() {
  const item = world.net.exportState().opps.find(opportunity => opportunity.id === groupId);
  if (!item) throw new Error("The planned hike is missing");
  return item;
}

function groupEffects(messages: Mini["sent"]): GroupEffect[] {
  const recipients = new Map<GroupEffect, Set<string>>();
  function delivered(effect: GroupEffect, recipient: string): GroupEffect[] {
    const audience = recipients.get(effect) ?? new Set<string>();
    if (!hikers.some(hiker => people[hiker].id === recipient) || audience.has(recipient)) {
      throw new Error("Each hike message must reach an invited participant exactly once");
    }
    audience.add(recipient);
    recipients.set(effect, audience);
    return [effect];
  }

  return messages.flatMap((message): GroupEffect[] => {
    if (message.meta.type === "plan_probe" && message.meta.plan?.planId === groupId) {
      if (names.test(message.body) || !message.body.includes("Inwood Hill Park")) {
        throw new Error("A hike invitation must name the public venue and withhold participant names");
      }
      return delivered("AnonymousInvite", message.to);
    }
    if (message.meta.type === "proposal" && message.meta.booked?.proposalId === groupId) {
      const booked = group();
      const others = Object.values(people).filter(person => person.id !== message.to);
      if (others.length !== 2 || !others.every(person => message.body.includes(person.name.replace(" Fixture", " F."))) ||
          !message.body.includes("Inwood Hill Park") || message.meta.meetingAt !== booked.plan?.window.start) {
        throw new Error("The hike booking must reveal only the expected participants, public venue and agreed time");
      }
      return delivered("GroupReveal", message.to);
    }
    if (message.meta.type === "cancellation" && message.meta.proposalId === groupId) {
      if (names.test(message.body) || !message.body.includes("this one is off")) {
        throw new Error("A cancellation must say the hike ended without naming the member who withdrew");
      }
      return delivered("PrivateCancellation", message.to);
    }
    return [];
  });
}

// spec/reviewedGroupJourney.md, "Story: Join a reviewed public hike only after the group agrees"
await serveJourney<Event>({
  async reset() {
    world = new Mini(Object.values(people).map(person => ({
      // Neighbors of the venue: a member's known trip must fit the travel limit (spec/planFormation.md).
      ...person, area: "Inwood", interests: ["hiking"], shareable: true,
    })), {
      inlineJudge: packet => judge(packet),
      growth: false,
      maxNewPerDay: 0,
      plansConfig: { minInvite: 3, size: { max: 3, target: 3 }, partnerPlans: false },
    });
    for (const hiker of hikers) {
      for (const reply of ["Hi!", "I like hiking and parks.", "Saturday afternoons and evenings work for me.", "Small groups are good."]) {
        await world.say(people[hiker].id, reply);
      }
    }
    judge = () => null;
    await world.run(HOUR);
    const reviews = world.net.exportState().opps.filter(item => item.origin === "planner" && item.stage === "review");
    const [review] = reviews;
    if (reviews.length !== 1 || !review || review.kind !== "group") {
      throw new Error("Expected the planner to submit one group hike for review");
    }
    groupId = review.id;
    const { plan } = group();
    if (plan?.activityId !== "day_hike" || plan.venueId !== "inwood-hill" || plan.quorum !== 3 || plan.alternates.length !== 0 ||
        !hikers.every(hiker => plan.invited.includes(people[hiker].id)) || plan.window.start !== Date.UTC(2026, 9, 10, 18)) {
      throw new Error("The fixture must plan the three invited hikers' Saturday afternoon at Inwood Hill Park");
    }
    effects = [];
    return null;
  },

  async dispatch(_key, event) {
    effects = [];
    const from = world.mark();
    const current = group();
    switch (event.type) {
      case "judgeGroup": {
        if (current.stage !== "review" || current.review?.exception !== undefined) return "refused";
        judge = event.approved ? simulatedReviewJudge({ exceptions: false }) : holdEveryItem.inline;
        await world.net.tick(world.clock.now());
        judge = () => null;
        break;
      }
      case "staffDecideGroup": {
        const result = world.net.decide(groupId, event.approved ? "approve" : "reject", { reviewer: "local-reviewer", reason: "weak_reason", revision: 0 });
        if (!result.ok) return "refused";
        break;
      }
      case "answerGroup": {
        const { id } = people[event.hiker];
        const awaiting = world.net.memberList().find(member => member.id === id)?.awaiting;
        if (awaiting?.kind !== "probe" || awaiting.oppId !== groupId) return "refused";
        await world.say(id, event.agrees ? "Yes." : "No thanks.");
        break;
      }
      case "expireGroup":
        if (current.stage !== "probing" || !current.plan) return "refused";
        world.clock.set(current.plan.probeDeadline);
        await world.net.tick(world.clock.now());
        break;
      case "withdrawFromGroup":
        if (current.stage !== "scheduled") return "refused";
        await world.say(people[event.hiker].id, "I can't make it.");
        break;
      case "restartGroup":
        world.restart();
        break;
    }
    effects = groupEffects(world.sent.slice(from));
    if (event.type === "withdrawFromGroup" && world.sent.slice(from).some(message =>
      message.meta.type === "cancellation" && message.meta.proposalId === groupId && message.to === people[event.hiker].id,
    )) throw new Error("The member who withdrew must not get the group's cancellation notice");
    return "accepted";
  },

  observe(): ReviewedGroupJourney {
    const current = group();
    let phase: ReviewedGroupJourney["phase"];
    if (current.stage === "review" && current.review?.exception === undefined) phase = "AwaitingGroupJudge";
    else if (current.stage === "review" && world.net.reviewQueue().some(item => item.oppId === groupId)) phase = "GroupHeldForStaff";
    else if (current.stage === "probing" && current.review?.decision === "approve") phase = "GroupInvited";
    else if (current.stage === "scheduled" && current.review?.decision === "approve") phase = "HikeBooked";
    else if (current.stage === "closed" && current.review?.decision === "reject") phase = "ReviewDenied";
    else if (current.stage === "closed" && current.closedReason === "plan did not come together") phase = "GroupUnderfilled";
    else if (current.stage === "closed" && current.closedReason === "participant dropped") phase = "HikeCancelled";
    else throw new Error("The hike is outside the modeled review, invitation, booking and closure states");

    const messages = groupEffects(world.sent);
    const bookings = world.meetings.filter(meeting => meeting.proposalId === groupId);
    for (const meeting of bookings) {
      if (meeting.kind !== "plan" || meeting.at !== current.plan?.window.start ||
          meeting.participants.length !== 3 || !hikers.every(hiker => meeting.participants.includes(people[hiker].id))) {
        throw new Error("The recorded meeting must be the agreed hike for the three invited members");
      }
    }
    const answers = current.planRun?.answers;
    return {
      phase,
      accepted: hikers.filter(hiker => answers?.[people[hiker].id] === "yes"),
      declined: hikers.filter(hiker => answers?.[people[hiker].id] === "no"),
      invites: messages.filter(message => message === "AnonymousInvite").length,
      meetings: bookings.length,
      reveals: messages.filter(message => message === "GroupReveal").length,
      cancellations: messages.filter(message => message === "PrivateCancellation").length,
    };
  },
  observeOutput: () => effects,
});
