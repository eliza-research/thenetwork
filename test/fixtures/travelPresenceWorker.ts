import { isDeepStrictEqual } from "node:util";
import type { Event, SavedTrip, TravelEffect, TravelPresenceJourney } from "../../packages/core/src/generated/travelPresenceJourney.ts";
import { CITY_TZ, fromLocal, localParts } from "../../packages/core/src/index.ts";
import type { TurnRequest, TurnResponse } from "../../packages/core/src/svc/contract.ts";
import { loadSnapshot } from "../../packages/network/service/snapshot.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { serveJourney } from "./serveJourney.ts";
import { withSignedTurnFixture, type FixtureMember } from "./signedTurnFixture.ts";

type Member = FixtureMember & { friendsMemberId: string; slopMemberId: string };
type SavedReply = { request: TurnRequest; response: TurnResponse };

function datesFor(clockTime: number) {
  const zone = CITY_TZ.sf;
  const { year, month, day } = localParts(clockTime, zone);
  const first = new Date(Date.UTC(year, month - 1, day));
  const last = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    from: fromLocal(year, month, day, 0, zone),
    to: fromLocal(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate(), 0, zone),
    text: `from ${first.toISOString().slice(0, 10)} until ${last.toISOString().slice(0, 10)}`,
  };
}

function readTravelReply(response: TurnResponse, city: string, dates: string): TravelEffect {
  if (response.outcome !== "handled" || response.delivery !== "collected" || response.app !== "friends" || response.reason !== "travel_presence") {
    throw new Error("The response did not come from the signed Friends travel command");
  }
  const [reply] = response.replies;
  if (!response.replies.length && !response.replyIds.length && response.memberId === null) return "NoTravelReply";
  if (!reply || response.replies.length !== 1 || response.replyIds.length !== 1) throw new Error("The travel statement must collect one scoped reply");
  const confirmation = `in friends.help: ${city} ${dates} (end date excluded).`;
  if (reply === `Saved ${confirmation}`) return "TripSaved";
  if (reply === `Already saved ${confirmation}`) return "TripAlreadySaved";
  if (reply.includes("YYYY-MM-DD until YYYY-MM-DD")) return "DatesNeeded";
  if (reply.includes("overlap a different city already saved in friends.help")) return "DatesConflict";
  throw new Error("Unexpected travel reply");
}

await withSignedTurnFixture(async ({ clock, service, createMember, sendTurn, replayTurn }) => {
  let member: Member;
  let dates: ReturnType<typeof datesFor>;
  let saved: SavedReply | undefined;
  let output: TravelEffect[] = [];

  const membership = (app: "friends" | "slop") => service.accounts.activeMembership(APPS[app], {
    e164: member.phone, personId: member.personId,
  });

  await serveJourney<Event>({
    async reset() {
      const identity = await createMember();
      const [friends, slop] = await Promise.all([
        service.accounts.store.getMembership(identity.personId, "friends"),
        service.accounts.store.getMembership(identity.personId, "slop"),
      ]);
      if (!friends || !slop) throw new Error("Travel fixture needs both app memberships");
      member = { ...identity, friendsMemberId: friends.memberId, slopMemberId: slop.memberId };
      dates = datesFor(clock.now());
      saved = undefined;
      output = [];
      return null;
    },

    async dispatch(_key, event): Promise<"accepted" | "refused"> {
      output = [];
      switch (event.type) {
        case "reachTripEnd":
          clock.set(Math.max(clock.now(), dates.to));
          break;
        case "leaveTravelApp": {
          const active = await membership("friends");
          const { response } = await sendTurn(member.phone, "leave friends.help", { app: "friends" });
          if (active && (response.outcome !== "handled" || response.reason !== "left" || response.consent?.scope !== "app" ||
              response.consent.app !== "friends" || response.consent.state !== "opted_out")) {
            throw new Error("The signed leave did not withdraw Friends consent");
          }
          break;
        }
        case "declareTrip": {
          const city = event.city === "SanFrancisco" ? "San Francisco" : "Los Angeles";
          const text = `I will be in ${city}${event.hasDates ? ` ${dates.text}` : " this weekend"}.`;
          const { response, request } = await sendTurn(member.phone, text, { app: "friends" });
          const effect = readTravelReply(response, city, dates.text);
          output = [effect];
          if (effect === "TripSaved") {
            if (saved || response.outcome !== "handled" || response.memberId !== member.friendsMemberId) throw new Error("A save must have one member-owned signed reply");
            const [collected] = await service.sql<{ body: string; status: string; app_id: string; member_id: string }[]>`
              select body, status, app_id, member_id from network.messages
              where id = ${response.replyIds[0]} and inbound_id = ${`msg:blooio:${request.messageId}`}`;
            if (collected?.body !== response.replies[0] || collected?.status !== "collected" || collected.app_id !== "friends" ||
                collected.member_id !== member.friendsMemberId) throw new Error("The trip confirmation was not collected for this member in Friends");
            saved = { request, response };
          }
          break;
        }
        case "retryTripSave": {
          if (!saved) return "refused";
          const reply = await replayTurn(saved.request);
          const body: unknown = await reply.json();
          if (reply.status === 200 && isDeepStrictEqual(body, saved.response)) output = ["SaveReplayed"];
          else if (reply.status === 409 && isDeepStrictEqual(body, { error: "turn_unresolved", retryable: false })) output = ["ReplayRefused"];
          else throw new Error(`Unexpected historical travel replay ${reply.status}`);
          break;
        }
      }
      return "accepted";
    },

    async observe(): Promise<TravelPresenceJourney> {
      const [friends, slop, rows, snapshot] = await Promise.all([
        membership("friends"),
        membership("slop"),
        service.sql<{ app_id: string; city: string; home_city: string; from_at: Date; to_at: Date; areas: string[] }[]>`
          select p.app_id, p.city, p.from_at, p.to_at, p.areas, m.home_city from network.presence p
          join network.members m on m.id = p.member_id and m.app_id = p.app_id
          where p.type = 'temporary' and p.member_id in (${member.friendsMemberId}, ${member.slopMemberId})`,
        loadSnapshot(service.sql, clock.now(), { app: "friends" }),
      ]);
      const friendsRows = rows.filter(row => row.app_id === "friends");
      const [row] = friendsRows;
      let trip: SavedTrip = "NoTrip";
      if (row) {
        if (friendsRows.length !== 1 || row.home_city !== "nyc" || row.areas.length ||
            row.from_at.getTime() !== dates.from || row.to_at.getTime() !== dates.to) throw new Error("Friends must retain one coarse trip in destination-local time and keep the home city");
        if (row.city === "sf") trip = "SanFranciscoTrip";
        else if (row.city === "la") trip = "LosAngelesTrip";
        else throw new Error("The trip was stored in an unexpected city");
      }
      const matchingTrips = snapshot.presence.filter(presence => presence.memberId === member.friendsMemberId && presence.type === "temporary");
      if (matchingTrips.length && (matchingTrips.length !== 1 || matchingTrips[0]?.city !== row?.city)) {
        throw new Error("The matching snapshot points to a different trip");
      }
      return {
        activeFriends: !!friends, activeSlop: !!slop, reachedEnd: clock.now() >= dates.to, trip,
        hasSaveToRetry: !!saved, visibleForMatching: matchingTrips.length > 0, slopTripCount: rows.filter(r => r.app_id === "slop").length,
      };
    },
    observeOutput: () => output,
  });
});
