import { LAUNCH_CITIES, seedVenuesForCity, type CityId, type VenueRecord } from "@thenetwork/core";
import { cofounderDeliveryIdPrefix } from "../../core/src/generated/cofounderDispatch.ts";
import { venueBookingLinkAllowed, venueBookingLinkMayDeliver } from "../../core/src/generated/venueBookingLink.ts";
import { VENUES } from "./geo.ts";

interface VenueBooking {
  stage: string;
  review?: { decision?: string; invalidated?: string };
  participants: readonly string[];
  meetingAt?: number;
  scheduleRevision?: number;
  venueId?: string;
  venue?: string;
  venueArea?: string;
  city?: CityId;
  publicEventRevision?: string;
  plan?: { eventId?: string };
  seat?: object;
}

export const venueBookingNoticePrefix = "venue-booking:";
const cofounderRevealPrefix = `${cofounderDeliveryIdPrefix}reveal:`;

export function venueBookingNoticeKey(opportunity: string, member: string, venue: string): string {
  return venueBookingNoticePrefix + [opportunity, member, venue].map(encodeURIComponent).join(":");
}

export function venueBookingNoticeBase(id: string): string | undefined {
  const key = id.startsWith(cofounderRevealPrefix) ? id.slice(cofounderRevealPrefix.length) : id;
  if (key.startsWith(venueBookingNoticePrefix)) return key;
}

function seedBookingUrl(
  matcher: (venue: VenueRecord) => boolean,
  city?: CityId,
): string | undefined {
  const cities: readonly CityId[] = city ? [city] : LAUNCH_CITIES;
  for (const c of cities) {
    const seed = seedVenuesForCity(c).find(matcher) as (VenueRecord & { bookingUrl?: string }) | undefined;
    if (seed?.bookingUrl) return seed.bookingUrl;
  }
  return undefined;
}

export function venueBookingLink(venueName: string, city?: CityId): string | undefined;
export function venueBookingLink(booking: VenueBooking, recipient: string, accepted: boolean, now: number, city?: CityId): string | undefined;
export function venueBookingLink(
  bookingOrVenueName: VenueBooking | string,
  recipientOrCity?: string | CityId,
  accepted?: boolean,
  now?: number,
  city?: CityId,
): string | undefined {
  if (typeof bookingOrVenueName === "string") {
    const query = bookingOrVenueName.trim().toLowerCase();
    if (!query) return undefined;
    const nyc = VENUES.find(venue => venue.name.trim().toLowerCase() === query || venue.id.trim().toLowerCase() === query);
    if (nyc?.bookingUrl) return nyc.bookingUrl;
    return seedBookingUrl(
      venue => venue.name.trim().toLowerCase() === query || venue.id.trim().toLowerCase() === query,
      recipientOrCity,
    );
  }
  const booking = bookingOrVenueName;
  if (booking.publicEventRevision || booking.plan?.eventId || booking.seat) return;
  const curated = VENUES.find(venue => venue.id === booking.venueId && venue.name === booking.venue && venue.neighborhood === booking.venueArea);
  const link = curated?.bookingUrl ?? seedBookingUrl(
    venue => venue.id === booking.venueId && venue.name === booking.venue && venue.neighborhood === booking.venueArea,
    city ?? booking.city,
  );
  const reviewed = booking.review?.decision === "approve" && !booking.review.invalidated;
  const currentNow = now ?? 0;
  if (venueBookingLinkAllowed(reviewed, booking.stage === "scheduled", !!accepted && !!recipientOrCity && booking.participants.includes(recipientOrCity), !!link, (booking.meetingAt ?? currentNow) > currentNow)) return link;
}

export function approvedVenueBookingLink(booking: VenueBooking, recipient: string, accepted: boolean, now: number, text: string, exactMessage: boolean, city?: CityId): string | undefined {
  const link = venueBookingLink(booking, recipient, accepted, now, city);
  const exactFinalLine = !!link && text.endsWith(`\n${link}`) && text.indexOf(link) === text.lastIndexOf(link);
  if (venueBookingLinkMayDeliver(!!link, (booking.scheduleRevision ?? 0) === 0, exactMessage, exactFinalLine)) return link;
}
