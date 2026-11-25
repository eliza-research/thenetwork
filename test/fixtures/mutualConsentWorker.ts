import type { ConsentPhase, Event, MutualConsentJourney, ReceiptResult } from "../../packages/core/src/generated/mutualConsentJourney.ts";
import type { TurnReceiptRequest } from "../../packages/core/src/svc/contract.ts";
import { holdEveryItem } from "../../packages/engine/src/reviewJudge.ts";
import { startClimbingRequestFixture } from "./climbingRequestFixture.ts";
import { serveJourney } from "./serveJourney.ts";

let fixture: ReturnType<typeof startClimbingRequestFixture> | undefined;
let bookingReceipt: TurnReceiptRequest | undefined;
let output: ReceiptResult[] = [];
const learnedWindowAt = Date.UTC(2026, 9, 9, 20, 59); // Last minute of the afternoon bucket and inside every learned slot.

function current() {
  if (!fixture) throw new Error("Reset the mutual consent journey before using it");
  return fixture.ready;
}

try {
  await serveJourney<Event>({
    async reset() {
      await fixture?.close();
      fixture = startClimbingRequestFixture(holdEveryItem.judge);
      const { item, service, decideReview } = await fixture.ready;
      await service.reviewJudgeTick();
      const review = await decideReview(item, "approve");
      const body: unknown = await review.json();
      if (!review.ok || !body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
        throw new Error("The staff member did not approve the climbing introduction that the judge held");
      }
      bookingReceipt = undefined;
      output = [];
      return null;
    },

    async dispatch(_key, event): Promise<"accepted" | "refused"> {
      const { item, service, clock, requester, candidate, sendTurn, sendReceipt } = await current();
      output = [];
      if (event.type === "reachLateSendWindow") {
        clock.set(Math.max(clock.now(), learnedWindowAt));
        if (!await service.tick()) throw new Error("The service did not take its send-window tick");
      } else if (event.type === "recordBookingReceipt") {
        if (!bookingReceipt) return "refused";
        const acknowledgement = await sendReceipt(bookingReceipt);
        const body: unknown = await acknowledgement.json();
        if (!acknowledgement.ok || !body || typeof body !== "object" || !("ok" in body) || body.ok !== true ||
            !("replayed" in body) || typeof body.replayed !== "boolean") {
          throw new Error("The exact booking receipt was refused");
        }
        output = [body.replayed ? "BookingReceiptReplayed" : "BookingReceiptStored"];
      } else {
        const { phone } = event.byMember === "Requester" ? requester : candidate;
        const text = event.answer === "ExplicitYes" ? "Yes, the first time works." : "Maybe, but I have to check.";
        const { response, messageId } = await sendTurn(phone, text, { app: "friends", observeDryRunSideEffects: true });
        if (response.outcome === "handled" && response.replyIds.length) {
          const [collected] = await service.sql<{ id: string }[]>`
            select id from network.messages where app_id = 'friends' and opportunity_id = ${item.oppId}
              and inbound_id = ${`msg:blooio:${messageId}`} and type = 'proposal' and status = 'collected'`;
          if (collected) {
            if (bookingReceipt || !response.replyIds.includes(collected.id)) throw new Error("The signed turn did not bind exactly one booking response");
            bookingReceipt = {
              channel: "blooio", messageId, replyIds: response.replyIds, outcome: "accepted",
              providerMessageIds: ["synthetic-booking-receipt"], historyRecorded: true,
            };
          }
        }
      }
      return "accepted";
    },

    async observe(): Promise<MutualConsentJourney> {
      const { item, service, clock, requesterId, candidate } = await current();
      const [meeting] = await service.sql<{ state: string; meeting_at: Date | null; requester: string; partner: string; partner_id: string }[]>`
        select o.state, o.meeting_at, r.status as requester, p.status as partner, m.id as partner_id
        from network.opportunities o
        join network.participations r on r.opportunity_id = o.id and r.member_id = ${requesterId}
        join network.participations p on p.opportunity_id = o.id and p.member_id <> r.member_id
        join network.members m on m.id = p.member_id and m.person_id = ${candidate.personId}
        where o.app_id = 'friends' and o.id = ${item.oppId}`;
      if (!meeting) throw new Error("The stored opportunity and both participants are required");
      const messages = await service.sql<{ type: "probe" | "proposal"; member_id: string; status: string; body: string }[]>`
        select type, member_id, status, body from network.messages
        where app_id = 'friends' and opportunity_id = ${item.oppId} and direction = 'outbound' and type in ('probe', 'proposal')`;
      const requesterProbes = messages.filter(message => message.type === "probe" && message.member_id === requesterId);
      const partnerProbes = messages.filter(message => message.type === "probe" && message.member_id === meeting.partner_id);
      let phase: ConsentPhase;
      if (meeting.state === "PROPOSED" && meeting.requester === "checking" && meeting.partner === "pending" && !meeting.meeting_at) {
        phase = "WaitingForRequester";
      } else if (meeting.state === "PROPOSED" && meeting.requester === "available" && meeting.partner === "checking" && !meeting.meeting_at) {
        phase = partnerProbes.length ? "WaitingForPartner" : "WaitingForPartnerWindow";
      } else if (meeting.state === "SCHEDULED" && meeting.meeting_at && meeting.requester === "confirmed" && meeting.partner === "confirmed") {
        phase = "MeetingScheduled";
      } else throw new Error(`Unexpected booking or consent state ${JSON.stringify(meeting)}`);

      const [firstProbe] = requesterProbes;
      if (!firstProbe || requesterProbes.length !== 1 || firstProbe.status !== "dry_run" || /\b(?:Ari|Bo)\b/i.test(firstProbe.body)) {
        throw new Error("The requester must have only the first anonymous probe");
      }
      const offeredTime = /I could do ([^.;]+?)(?: or |;)/.exec(firstProbe.body)?.[1];
      for (const probe of partnerProbes) {
        if (!offeredTime || !probe.body.includes(`I could do ${offeredTime}.`) || probe.status !== "dry_run" || /\b(?:Ari|Bo)\b/i.test(probe.body)) {
          throw new Error("The partner's anonymous probe must carry only the chosen time");
        }
      }
      const bookings = messages.filter(message => message.type === "proposal");
      const firstBooking = bookings.find(message => message.member_id === requesterId);
      const secondBooking = bookings.find(message => message.member_id === meeting.partner_id);
      if (bookings.length && (firstBooking?.status !== "dry_run" || !secondBooking || !["collected", "sent"].includes(secondBooking.status))) {
        throw new Error("The scheduled opportunity has unexpected booking delivery records");
      }
      const state = await service.runtimeFor("friends")?.pg.load();
      const partner = state?.members.find(member => member.id === meeting.partner_id);
      if (!partner?.replies) throw new Error("The stored partner reply samples are missing");
      return {
        phase, partnerReplies: Math.min(partner.replies.length, 5), lateWindow: clock.now() >= learnedWindowAt,
        partnerProbeCount: partnerProbes.length, bookingCount: bookings.length, partnerBookingSent: secondBooking?.status === "sent",
      };
    },
    observeOutput: () => output,
  });
} finally {
  await fixture?.close();
}
