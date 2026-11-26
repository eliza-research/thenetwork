// R16-TA: an opportunity's detail must show that opportunity's own
// messages — not a reply the member sent about a different opportunity,
// and not without the member's own cancel notice for its meeting.
//
// Journey: pipeline card click -> OpportunityPanel -> GET /api/opportunity/:id
// -> GameSource.opportunity() (game mode). The detail's History lists
// d.messages; admin-console.md 3.5 promises "drill into one opportunity
// with its messages". The real-mode twin (sources/real.ts messages())
// selects strictly `opportunity_id = ${id}`, and the Network's own
// decision record carries the proposal the reply answers
// (packages/sim/src/world.ts: a persona reply is scheduled with
// inReplyTo: msg.id, and the decision record carries proposalId).
//
// Game mode attributed inbound messages with a 2-day nearness window
// (sources/game.ts opportunity()): any inbound message within two days
// after an outbound message about this opportunity was shown as this
// opportunity's message — even when its inReplyTo named a message about
// another opportunity. The fix attributes an inbound message only when
// the message its inReplyTo points at is about this opportunity, and
// keeps a member's meeting notice (world.ts personaSend logs it with
// bookingNoticeMeetingId, resolved to a proposalId through the
// meeting_scheduled record) in the opportunity it cancels.
//
// This drives the real GameSource (consent network, auto review, 120
// personas, 14 simulated days) for seeds 1-3, the same worlds the
// review of #704 measured: on develop they hold 49/33/51 replies to
// another opportunity and 4 cancel notices the head filter drops
// (3 CANCELLED, 1 ABANDONED).
import { DAY, HOUR } from "@thenetwork/core";
import { expect, test } from "vitest";
import { GameSource } from "../src/sources/game.ts";

for (const seed of [1, 2, 3]) {
  test(`seed ${seed}: opportunity detail shows only its own messages, including a member's cancel notice`, { timeout: 600_000 }, async () => {
    const g = new GameSource({ seed, personas: 120, days: 14, network: "consent", pushMs: HOUR, tickMs: HOUR });
    try {
      await g.init();
      expect((await g.control({ type: "step", ms: 14 * DAY })).ok).toBe(true);
      // World-record links: meeting -> proposal, notice message -> proposal.
      const meetingOpp = new Map<string, string>();
      for (const r of g.world.records) if (r.type === "meeting_scheduled") meetingOpp.set(r.meetingId, r.proposalId);
      const noticeOpp = new Map<string, { memberId: string; proposalId: string }>();
      for (const r of g.world.records) {
        if (r.type !== "message" || !r.bookingNoticeMeetingId) continue;
        const proposalId = meetingOpp.get(r.bookingNoticeMeetingId);
        if (proposalId) noticeOpp.set(r.msg.id, { memberId: r.msg.memberId, proposalId });
      }
      // Live API detail per opportunity, keyed memberId:messageId.
      const detail = new Map<string, Set<string>>();
      for (const o of g.store.opps.values()) {
        const d = await g.opportunity(o.id);
        detail.set(o.id, new Set((d?.messages ?? []).map(m => `${m.memberId}:${m.id}`)));
      }
      // No detail shows an inbound reply whose inReplyTo names another opportunity's message.
      for (const o of g.store.opps.values()) {
        for (const mid of o.participants) {
          const all = g.world.channel.messagesFor(mid);
          const oppOf = new Map(all.map(x => [x.id, x.meta?.proposalId ?? x.meta?.probe?.key]));
          for (const x of all) {
            if (x.direction !== "inbound" || x.meta?.inReplyTo === undefined) continue;
            const target = oppOf.get(x.meta.inReplyTo);
            if (target !== undefined && target !== o.id) {
              expect(detail.get(o.id)?.has(`${mid}:${x.id}`),
                `seed ${seed}: ${o.id} shows ${x.id}, a reply about ${target}`).toBe(false);
            }
          }
        }
      }
      // Every meeting notice shows in the opportunity it cancels, and in no other.
      for (const [msgId, n] of noticeOpp) {
        expect(detail.get(n.proposalId)?.has(`${n.memberId}:${msgId}`),
          `seed ${seed}: ${n.proposalId} drops its cancel notice ${msgId}`).toBe(true);
        for (const o of g.store.opps.values()) {
          if (o.id === n.proposalId || !o.participants.includes(n.memberId)) continue;
          expect(detail.get(o.id)?.has(`${n.memberId}:${msgId}`),
            `seed ${seed}: ${o.id} shows ${msgId}, a notice about ${n.proposalId}`).toBe(false);
        }
      }
    } finally {
      await g.dispose();
    }
  });
}
