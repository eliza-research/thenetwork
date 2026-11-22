import { isDeepStrictEqual } from "node:util";
import { CITY_TZ, MINUTE, localParts } from "../../packages/core/src/index.ts";
import type {
  Audience, CollectedAnswer, ConciergeEffect, ConciergeReplay, Event, PublicListing, PublishedCatalog, SoloConciergeJourney,
} from "../../packages/core/src/generated/soloConciergeJourney.ts";
import type { TurnRequest, TurnResponse } from "../../packages/core/src/svc/contract.ts";
import { importPublicEvents } from "../../packages/network/service/import-public-events.ts";
import { serveJourney } from "./serveJourney.ts";
import { withSignedTurnFixture, type FixtureMember } from "./signedTurnFixture.ts";

type Member = FixtureMember & { friendsId: string };
type SavedReply = { request: TurnRequest; response: Extract<TurnResponse, { outcome: "handled" }>; listings: PublicListing[] };

const venue = "McCarren Park";
const noOptions = "I couldn't find any current NYC Parks listings that fit your request.";

function upcomingListings(now: number) {
  const { year, month, day } = localParts(now, CITY_TZ.nyc);
  function listing(guid: string, title: string, categories: string, hour: number, daysAhead = 1) {
    const isoDay = new Date(Date.UTC(year, month - 1, day + daysAhead)).toISOString().slice(0, 10);
    const start = `${isoDay}T${hour.toString().padStart(2, "0")}:00:00`;
    const end = `${isoDay}T${(hour + 1).toString().padStart(2, "0")}:00:00`;
    return {
      guid, title, categories, starttime: start, endtime: end, location: venue, coordinates: "40.7206,-73.9518",
      link: { url: `https://www.nycgovparks.org/events/${isoDay.replaceAll("-", "/")}/example-${guid}` },
      localHour: `${hour - 12}:00 PM`,
    };
  }
  const recommended = {
    NatureWalk: listing("101", "Nature sketch walk", "Nature | All ages", 16),
    ArtTour: listing("102", "Public art tour", "Arts", 15),
    HistoryTour: listing("103", "Garden history tour", "History", 17),
  } satisfies Record<PublicListing, ReturnType<typeof listing>>;
  return {
    recommended,
    catalogs: {
      NoPublishedEvents: [],
      FullCatalog: [
        ...Object.values(recommended),
        listing("104", "Public chess group", "Chess", 18),
        listing("105", "Park nature workshop 21+", "Nature | All ages", 14),
        listing("106", "Late week garden walk", "Nature | All ages", 14, 8),
      ],
      ReducedCatalog: [recommended.NatureWalk, recommended.HistoryTour],
    } satisfies Record<PublishedCatalog, ReturnType<typeof listing>[]>,
  };
}

function readListings(body: string, data: ReturnType<typeof upcomingListings>): PublicListing[] {
  if (body === noOptions) return [];
  return body.split("\n").map(line => {
    for (const key of ["NatureWalk", "ArtTour", "HistoryTour"] satisfies PublicListing[]) {
      const item = data.recommended[key];
      const reason = key === "NatureWalk" ? "Fits one of your interests." : "Within your travel range.";
      if (line.startsWith(`${item.title} — `) && line.includes(`${item.localHour} `)
          && line.endsWith(` at ${venue}. ${reason} ${item.link.url}`)) return key;
    }
    throw new Error(`An unexpected listing or reason was collected: ${line}`);
  });
}

await withSignedTurnFixture(async ({ clock, service, createMember, sendTurn, replayTurn }) => {
  let members: Record<Audience, Member>;
  let data: ReturnType<typeof upcomingListings>;
  const answers = new Map<Audience, SavedReply>();
  let lastReplay: ConciergeReplay = "NoReplay";
  let output: ConciergeEffect[] = [];

  async function enroll(age: number, firstName: string): Promise<Member> {
    const member = await createMember({}, { apps: ["friends"], age, firstName, interests: ["nature"], neighborhood: "Greenpoint" });
    const friends = await service.accounts.store.getMembership(member.personId, "friends");
    if (!friends) throw new Error("Solo fixture signup did not create a Friends membership");
    return { ...member, friendsId: friends.memberId };
  }

  async function publish(catalog: PublishedCatalog) {
    const listings = data.catalogs[catalog];
    clock.advance(MINUTE);
    const receipt = await importPublicEvents(service.sql, clock, async () => Response.json(listings));
    if (!receipt.published || receipt.events !== listings.length) throw new Error("The Parks importer did not publish the full fixture");
  }

  async function assertCollected(saved: SavedReply, member: Member) {
    const { request, response } = saved;
    const rows = await service.sql<{ id: string; body: string; status: string; app_id: string; member_id: string }[]>`
      select id, body, status, app_id, member_id from network.messages where inbound_id = ${`msg:blooio:${request.messageId}`}
        and direction = 'outbound'`;
    const [row] = rows;
    if (rows.length !== 1 || row.id !== response.replyIds[0] || row.body !== response.replies[0] || row.status !== "collected"
        || row.app_id !== "friends" || row.member_id !== member.friendsId) {
      throw new Error("The signed answer must create one collected reply for its requesting Friends member");
    }
  }

  function observeAnswer(who: Audience): CollectedAnswer {
    const saved = answers.get(who);
    return saved ? { tag: "Answered", listings: saved.listings } : { tag: "NoAnswer" };
  }

  await serveJourney<Event>({
    async reset() {
      members = { AdultMember: await enroll(20, "Ari"), YoungerMember: await enroll(16, "Jo") };
      data = upcomingListings(clock.now());
      answers.clear();
      lastReplay = "NoReplay";
      output = [];
      await publish("NoPublishedEvents");
      return null;
    },

    async dispatch(_key, event) {
      output = [];
      switch (event.type) {
        case "publishCatalog":
          await publish(event.catalog);
          break;
        case "askForIdeas": {
          const member = members[event.who];
          const { request, response } = await sendTurn(member.phone, "Show me public events", { app: "friends" });
          if (response.outcome !== "handled" || response.reason !== "solo_events" || response.delivery !== "collected" || response.replyKind !== "reply"
              || response.app !== "friends" || response.memberId !== member.friendsId || response.replies.length !== 1 || response.replyIds.length !== 1) {
            throw new Error(`Signed solo request has an unexpected response: ${JSON.stringify(response)}`);
          }
          const listings = readListings(response.replies[0], data);
          const saved = { request, response, listings };
          await assertCollected(saved, member);
          answers.set(event.who, saved);
          output = listings.length ? [{ tag: "Recommendations", listings }] : [{ tag: "NoFittingEvent" }];
          break;
        }
        case "retryIdeas": {
          const saved = answers.get(event.who);
          if (!saved) return "refused";
          const replay = await replayTurn(saved.request);
          const body: unknown = await replay.json();
          if (replay.status === 200 && isDeepStrictEqual(body, saved.response)) lastReplay = "ReplayedAnswer";
          else if (replay.status === 409 && isDeepStrictEqual(body, { error: "turn_concierge_changed", retryable: false })) lastReplay = "RefusedStaleAnswer";
          else throw new Error(`Unexpected solo reply replay: ${replay.status} ${JSON.stringify(body)}`);
          await assertCollected(saved, members[event.who]);
          output = [{ tag: "ReplayObserved", result: lastReplay }];
          break;
        }
      }
      return "accepted";
    },

    async observe(): Promise<SoloConciergeJourney> {
      const [listings, [sideEffects]] = await Promise.all([
        service.sql<{ source_id: string }[]>`select source_id from network.public_events where source = 'nyc-parks' order by source_id`,
        service.sql<{ requests: number; opportunities: number }[]>`select
          (select count(*)::int from network.requests where app_id = 'friends') as requests,
          (select count(*)::int from network.opportunities where app_id = 'friends') as opportunities`,
      ]);
      const ids = listings.map(({ source_id }) => source_id);
      const catalog = (["NoPublishedEvents", "FullCatalog", "ReducedCatalog"] satisfies PublishedCatalog[])
        .find(candidate => isDeepStrictEqual(ids, data.catalogs[candidate].map(listing => listing.guid)));
      if (!catalog || !sideEffects) throw new Error("Postgres has an unexpected catalog or missing side-effect counts");
      return { catalog, adultAnswer: observeAnswer("AdultMember"), youngerAnswer: observeAnswer("YoungerMember"), lastReplay, ...sideEffects };
    },

    observeOutput: () => output,
  });
});
