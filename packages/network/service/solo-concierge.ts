import {
  cityTimezone, DAY, estimateTravelMinutes, findNeighborhood, fromLocal, isMinor, LAUNCH_CITIES, localParts, proposeTopOne, seedVenuesForCity, temporaryPresenceWindow, validAge,
  type CityId, type MemberVenuePrefs, type NetworkEvent,
} from "@thenetwork/core";
import {
  soloReplyHasRoom, soloEventAgeAllowed, soloEventCityAllowed, soloEventEligible, soloEventPrecedes,
} from "../../core/src/generated/soloConcierge.ts";
import { requestedAreaAllowsEvent, recommendationLocation } from "../../core/src/generated/plansLocation.ts";
import { presenceWindowCovers, presenceWindowsOverlap, type PresenceWindow } from "../../core/src/generated/travelPresence.ts";
import { listedEventMinimumAge } from "../../core/src/public-event-age.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { plansPlaceQuestionForCity, publicPlanLocation } from "../src/classify.ts";
import { NEIGHBORHOOD, travelMinutes } from "../src/geo.ts";
import { statedWindows } from "../src/plans.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";
import { listActiveVenues } from "./meetup-store.ts";
import { readPublicEvents } from "./public-events.ts";
import { automatedFacetPredicate, presenceOf } from "./snapshot.ts";

type Period = "today" | "tonight" | "tomorrow" | "this weekend" | "this week" | "next seven days";
interface SoloRequest { period: Period; area?: string; mentioned?: boolean; placeText?: string }
type Option = { event: NetworkEvent & { listing: NonNullable<NetworkEvent["listing"]> }; fit: number; minutes?: number; scheduled: boolean };
interface SoloReply { body: string; publicLinks: string[] }
const formatWhen = (tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const like = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Recognize a solo request without claiming arbitrary open conversation or proposal replies. */
export function soloConciergeRequest(text: string, city?: CityId): SoloRequest | undefined {
  const request = /^(?:(?:anything fun|what(?:['’]s| is) happening) (today|tonight|tomorrow|this weekend|this week)|(?:find|show me|suggest|recommend) (?:some )?(?:public )?(?:events|things to do)(?: (today|tonight|tomorrow|this weekend|this week))?)[.!?]?$/i.exec(text.trim());
  if (request) return { period: (request[1] ?? request[2] ?? "next seven days").toLowerCase() as Period };
  const localized = /^(?:any plans|anything fun|what(?:['’]s| is) happening|(?:find|show me|suggest|recommend) (?:some )?(?:public )?(?:events|things to do))(?: (today|tonight|tomorrow|this weekend|this week))? ((?:in|near|around|at|by) [^!?\r\n]+?)(?: (today|tonight|tomorrow|this weekend|this week))?[!?]?$/i.exec(text.trim());
  if (!localized) return;
  const placeText = localized[2]!;
  let place = city ? publicPlanLocation(placeText, true, city) : publicPlanLocation(placeText, true);
  if (!city && !place.area) {
    for (const launchCity of LAUNCH_CITIES) {
      if (launchCity === "nyc") continue;
      const candidate = publicPlanLocation(placeText, true, launchCity);
      if (candidate.area || candidate.mentioned) {
        place = candidate;
        if (candidate.area) break;
      }
    }
  }
  if (place.mentioned) return { period: (localized[1] ?? localized[3] ?? "next seven days").toLowerCase() as Period, ...place, placeText };
}

function requestedWindow(period: Period, now: number, tz: string): PresenceWindow {
  const parts = localParts(now, tz);
  const midnight = (offset: number) => {
    const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
    return fromLocal(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, tz);
  };
  if (period === "this weekend") {
    const start = 5 - parts.weekday;
    return { from: Math.max(now, midnight(start)), to: midnight(start + 2) };
  }
  if (period === "tonight") {
    const evening = fromLocal(parts.year, parts.month, parts.day, 17, tz);
    return { from: Math.max(now, evening), to: midnight(1) };
  }
  if (period === "tomorrow") return { from: midnight(1), to: midnight(2) };
  const end = period === "today" ? 1 : period === "this week" ? 7 - parts.weekday : 7;
  return { from: now, to: midnight(end) };
}

const precedes = (a: Option, b: Option) => soloEventPrecedes(a.fit, a.minutes ?? Number.MAX_SAFE_INTEGER, a.event.start, b.fit, b.minutes ?? Number.MAX_SAFE_INTEGER, b.event.start);

/** Read only this app member's allowed inputs and the operator's published catalog. */
export async function soloConciergeReply(tx: SQL, accounts: Pick<Accounts, "activeMembership" | "lowestAge">, owner: MemberCommandOwner, request: SoloRequest, now: number): Promise<SoloReply | undefined> {
  const binding = await memberCommandOwner(tx, accounts, owner);
  if (!binding?.member) return;
  const age = await accounts.lowestAge(owner.e164, binding.person);
  if (!validAge(age)) return;
  const { member } = binding;
  const app = owner.app.id, id = owner.memberId;
  const city = member.home_city || "nyc";
  const resolvedPlace = request.placeText ? publicPlanLocation(request.placeText, true, city) : { area: request.area, mentioned: request.mentioned === true };
  const requestedArea = resolvedPlace.area;
  const placeMentioned = resolvedPlace.mentioned || request.mentioned === true;
  if (recommendationLocation(requestedArea !== undefined, placeMentioned) === "AskForArea") {
    return { body: plansPlaceQuestionForCity(city), publicLinks: [] };
  }
  const [rawPresence, facets] = await Promise.all([
    tx`select member_id, city, type, from_at, to_at from network.presence where app_id=${app} and member_id=${id} and type='temporary'`,
    tx<{ kind: "interest" | "availability_pattern"; tags: string[] }[]>`select kind, tags from network.facets where app_id=${app} and member_id=${id}
      and kind in ('interest','availability_pattern') and status='confirmed' and privacy_scope in ('matchable','shareable')
      and (valid_from is null or valid_from <= ${new Date(now)}) and (valid_to is null or valid_to > ${new Date(now)}) and ${automatedFacetPredicate(tx)}`,
  ]);
  const trips = rawPresence.map(presenceOf).flatMap(p => {
    const window = temporaryPresenceWindow(p);
    return window ? [{ city: p.city, window }] : [];
  });
  // A trip away takes precedence over home city: read listings for every city the member may
  // be in during the requested period, and judge each listing in its own city's time.
  const horizon = { from: now, to: now + 8 * DAY };
  const cities = [...new Set([city, ...trips.filter(p => presenceWindowsOverlap(p.window, horizon)).map(p => p.city)])];
  const events = (await Promise.all(cities.map(c => readPublicEvents(tx, now, c)))).flat();
  const tzOf = (c: string) => cityTimezone(c) ?? "America/New_York";
  const requestedByCity = new Map(cities.map(c => [c, requestedWindow(request.period, now, tzOf(c))]));
  const availabilityTags = facets.filter(f => f.kind === "availability_pattern").flatMap(f => f.tags);
  const availableByCity = new Map(cities.map(c => [c, statedWindows(availabilityTags, now, tzOf(c))?.windows]));
  const interest = new Set(facets.filter(f => f.kind === "interest").flatMap(f => f.tags.map(like)).filter(Boolean));
  const home = city === "nyc" && member.home_area ? NEIGHBORHOOD.get(member.home_area) : undefined;
  const multiCityHome = city !== "nyc" && member.home_area && findNeighborhood(city, member.home_area) ? member.home_area : undefined;
  const travelLimit = member.prefs.maxTravelMinutes;
  const limit = typeof travelLimit === "number" && Number.isFinite(travelLimit) && travelLimit >= 0 ? travelLimit : undefined;
  const options: Option[] = [];

  for (const event of events) {
    if (!event.listing) continue;
    if (!requestedAreaAllowsEvent(requestedArea !== undefined, event.area === requestedArea)) continue;
    const eventWindow = { from: event.start, to: event.end };
    const away = trips.some(p => p.city !== event.city && presenceWindowsOverlap(p.window, eventWindow));
    const visiting = trips.some(p => p.city === event.city && presenceWindowCovers(p.window, eventWindow));
    const present = soloEventCityAllowed(member.home_city === event.city, visiting, away);
    const available = availableByCity.get(event.city);
    const requested = requestedByCity.get(event.city) ?? requestedWindow(request.period, now, tzOf(event.city));
    const scheduled = available?.some(s => presenceWindowCovers({ from: s.start, to: s.end }, eventWindow)) ?? false;
    const area = city === "nyc" && event.area ? NEIGHBORHOOD.get(event.area) : undefined;
    const minutes = home && area
      ? travelMinutes(home, area)
      : multiCityHome && event.area && findNeighborhood(city, event.area)
        ? estimateTravelMinutes(city, multiCityHome, event.area)
        : undefined;
    const allAges = event.tags.some(tag => like(tag) === "all ages");
    if (!soloEventAgeAllowed(age, listedEventMinimumAge(event), allAges)
      || !soloEventEligible(true, presenceWindowCovers(requested, eventWindow), present, !!available, scheduled, minutes !== undefined && limit !== undefined, minutes ?? 0, limit ?? 0)) continue;
    const fit = new Set(event.tags.map(like).filter(tag => interest.has(tag))).size;
    options.push({ event: { ...event, listing: event.listing }, fit, minutes, scheduled });
  }

  const picks: string[] = [];
  const publicLinks: string[] = [];
  for (const { event, fit, minutes, scheduled } of options.sort((a, b) => precedes(a, b) ? -1 : precedes(b, a) ? 1 : a.event.id.localeCompare(b.event.id))) {
    if (!soloReplyHasRoom(picks.length)) break;
    const why = fit > 0 ? "Fits one of your interests." : scheduled ? "Fits your saved availability." : minutes !== undefined && limit !== undefined ? "Within your travel range." : "Within the time you asked about.";
    const line = `${event.title} — ${formatWhen(tzOf(event.city)).format(event.start)} at ${event.listing.venue}. ${why} ${event.listing.url}`;
    if ([...picks, line].join("\n").length > 1500) continue;
    picks.push(line);
    publicLinks.push(event.listing.url);
  }
  if (picks.length) return { body: picks.join("\n"), publicLinks };

  const homeRequested = requestedByCity.get(city)!;
  const spotCity = trips.find(p => p.window.from <= homeRequested.from && homeRequested.from < p.window.to)?.city ?? city;
  const requested = requestedByCity.get(spotCity) ?? homeRequested;
  const emptyPrefix = spotCity === "nyc"
    ? "I couldn't find any current NYC Parks listings that fit your request."
    : "I couldn't find any current public listings that fit your request.";
  const dbVenues = await listActiveVenues(tx, spotCity).catch(() => []);
  const venuePool = dbVenues.length ? dbVenues : spotCity === "nyc" ? [] : seedVenuesForCity(spotCity);
  if (venuePool.length) {
    const soloPrefs: MemberVenuePrefs = {
      memberId: id,
      age,
      drinksAlcohol: !isMinor(age),
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      maxBudgetTier: 2,
      ...(limit !== undefined ? { maxTravelMinutes: limit } : {}),
      visitedVenueIds: [],
      rejectedVenueIds: [],
      hobbies: [...interest],
    };
    const memberAreas = requestedArea ? [requestedArea] : spotCity === city && member.home_area ? [member.home_area] : [];
    const proposal = proposeTopOne(
      venuePool,
      {
        city: spotCity,
        memberAreas,
        members: [soloPrefs],
        startMs: requested.from,
        mode: "solo",
        app,
        isFirstMeet: false,
        ...(interest.size ? { targetHobbies: [...interest] } : {}),
      },
      now
    );
    const spot = proposal.current?.venue;
    if (spot && (!isMinor(age) || spot.allAges === true)) {
      return {
        body: `${emptyPrefix} If you want a public spot to drop into on your own, try ${spot.name} in ${spot.neighborhood}.`,
        publicLinks,
      };
    }
  }
  return { body: emptyPrefix, publicLinks };
}
