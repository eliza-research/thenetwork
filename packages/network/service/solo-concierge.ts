import { CITY_TZ, fromLocal, localParts, temporaryPresenceWindow, validAge, type NetworkEvent } from "@thenetwork/core";
import {
  maxSoloEventOptions, soloEventAgeAllowed, soloEventCityAllowed, soloEventEligible, soloEventPrecedes,
} from "../../core/src/generated/soloConcierge.ts";
import { presenceWindowCovers, presenceWindowsOverlap, type PresenceWindow } from "../../core/src/generated/travelPresence.ts";
import { listedEventMinimumAge } from "../../core/src/public-event-age.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { NEIGHBORHOOD, travelMinutes } from "../src/geo.ts";
import { statedWindows } from "../src/plans.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";
import { readPublicEvents } from "./public-events.ts";
import { automatedFacetPredicate, presenceOf } from "./snapshot.ts";

type Period = "today" | "tomorrow" | "this weekend" | "this week" | "next seven days";
type Option = { event: NetworkEvent & { listing: NonNullable<NetworkEvent["listing"]> }; fit: number; minutes?: number; scheduled: boolean };
interface SoloReply { body: string; publicLinks: string[] }
const NY = CITY_TZ.nyc;
const when = new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const like = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Recognize a solo request without claiming arbitrary open conversation or proposal replies. */
export function soloConciergeRequest(text: string): Period | undefined {
  const request = /^(?:(?:anything fun|what(?:['’]s| is) happening) (today|tomorrow|this weekend|this week)|(?:find|show me|suggest|recommend) (?:some )?(?:public )?(?:events|things to do)(?: (today|tomorrow|this weekend|this week))?)[.!?]?$/i.exec(text.trim());
  if (request) return (request[1] ?? request[2] ?? "next seven days").toLowerCase() as Period;
}

function requestedWindow(period: Period, now: number): PresenceWindow {
  const parts = localParts(now, NY);
  const midnight = (offset: number) => {
    const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
    return fromLocal(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, NY);
  };
  if (period === "this weekend") {
    const start = 5 - parts.weekday;
    return { from: Math.max(now, midnight(start)), to: midnight(start + 2) };
  }
  if (period === "tomorrow") return { from: midnight(1), to: midnight(2) };
  const end = period === "today" ? 1 : period === "this week" ? 7 - parts.weekday : 7;
  return { from: now, to: midnight(end) };
}

const precedes = (a: Option, b: Option) => soloEventPrecedes(a.fit, a.minutes ?? Number.MAX_SAFE_INTEGER, a.event.start, b.fit, b.minutes ?? Number.MAX_SAFE_INTEGER, b.event.start);

/** Read only this app member's allowed inputs and the operator's published catalog. */
export async function soloConciergeReply(tx: SQL, accounts: Pick<Accounts, "activeMembership" | "lowestAge">, owner: MemberCommandOwner, period: Period, now: number): Promise<SoloReply | undefined> {
  const binding = await memberCommandOwner(tx, accounts, owner);
  if (!binding?.member) return;
  const age = await accounts.lowestAge(owner.e164, binding.person);
  if (!validAge(age)) return;
  const { member } = binding;
  const app = owner.app.id, id = owner.memberId;
  const [events, rawPresence, facets] = await Promise.all([
    readPublicEvents(tx, now, "nyc"),
    tx`select member_id, city, type, from_at, to_at from network.presence where app_id=${app} and member_id=${id} and type='temporary'`,
    tx<{ kind: "interest" | "availability_pattern"; tags: string[] }[]>`select kind, tags from network.facets where app_id=${app} and member_id=${id}
      and kind in ('interest','availability_pattern') and status='confirmed' and privacy_scope in ('matchable','shareable')
      and (valid_from is null or valid_from <= ${new Date(now)}) and (valid_to is null or valid_to > ${new Date(now)}) and ${automatedFacetPredicate(tx)}`,
  ]);
  const trips = rawPresence.map(presenceOf).flatMap(p => {
    const window = temporaryPresenceWindow(p);
    return window ? [{ city: p.city, window }] : [];
  });
  const interest = new Set(facets.filter(f => f.kind === "interest").flatMap(f => f.tags.map(like)).filter(Boolean));
  const available = statedWindows(facets.filter(f => f.kind === "availability_pattern").flatMap(f => f.tags), now, NY)?.windows;
  const home = member.home_city === "nyc" && member.home_area ? NEIGHBORHOOD.get(member.home_area) : undefined;
  const travelLimit = member.prefs.maxTravelMinutes;
  const limit = typeof travelLimit === "number" && Number.isFinite(travelLimit) && travelLimit >= 0 ? travelLimit : undefined;
  const requested = requestedWindow(period, now);
  const options: Option[] = [];

  for (const event of events) {
    if (!event.listing) continue;
    const eventWindow = { from: event.start, to: event.end };
    const away = trips.some(p => p.city !== event.city && presenceWindowsOverlap(p.window, eventWindow));
    const visiting = trips.some(p => p.city === event.city && presenceWindowCovers(p.window, eventWindow));
    const present = soloEventCityAllowed(member.home_city === event.city, visiting, away);
    const scheduled = available?.some(s => presenceWindowCovers({ from: s.start, to: s.end }, eventWindow)) ?? false;
    const area = event.area ? NEIGHBORHOOD.get(event.area) : undefined;
    const minutes = home && area ? travelMinutes(home, area) : undefined;
    const allAges = event.tags.some(tag => like(tag) === "all ages");
    if (!soloEventAgeAllowed(age, listedEventMinimumAge(event), allAges)
      || !soloEventEligible(true, presenceWindowCovers(requested, eventWindow), present, !!available, scheduled, minutes !== undefined && limit !== undefined, minutes ?? 0, limit ?? 0)) continue;
    const fit = new Set(event.tags.map(like).filter(tag => interest.has(tag))).size;
    options.push({ event: { ...event, listing: event.listing }, fit, minutes, scheduled });
  }

  const picks: string[] = [];
  const publicLinks: string[] = [];
  for (const { event, fit, minutes, scheduled } of options.sort((a, b) => precedes(a, b) ? -1 : precedes(b, a) ? 1 : a.event.id.localeCompare(b.event.id))) {
    const why = fit > 0 ? "Fits one of your interests." : scheduled ? "Fits your saved availability." : minutes !== undefined && limit !== undefined ? "Within your travel range." : "Within the time you asked about.";
    const line = `${event.title} — ${when.format(event.start)} at ${event.listing.venue}. ${why} ${event.listing.url}`;
    if ([...picks, line].join("\n").length > 1500) continue;
    picks.push(line);
    publicLinks.push(event.listing.url);
    if (picks.length === maxSoloEventOptions) break;
  }
  return { body: picks.length ? picks.join("\n") : "I couldn't find any current NYC Parks listings that fit your request.", publicLinks };
}
