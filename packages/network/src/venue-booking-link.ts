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

export function venueBookingLink(booking: VenueBooking, recipient: string, accepted: boolean, now: number): string | undefined {
  if (booking.publicEventRevision || booking.plan?.eventId || booking.seat) return;
  const curated = VENUES.find(venue => venue.id === booking.venueId && venue.name === booking.venue && venue.neighborhood === booking.venueArea);
  const link = curated?.bookingUrl;
  const reviewed = booking.review?.decision === "approve" && !booking.review.invalidated;
  if (venueBookingLinkAllowed(reviewed, booking.stage === "scheduled", accepted && booking.participants.includes(recipient), !!link, (booking.meetingAt ?? now) > now)) return link;
}

export function approvedVenueBookingLink(booking: VenueBooking, recipient: string, accepted: boolean, now: number, text: string, exactMessage: boolean): string | undefined {
  const link = venueBookingLink(booking, recipient, accepted, now);
  const exactFinalLine = !!link && text.endsWith(`\n${link}`) && text.indexOf(link) === text.lastIndexOf(link);
  if (venueBookingLinkMayDeliver(!!link, (booking.scheduleRevision ?? 0) === 0, exactMessage, exactFinalLine)) return link;
}
