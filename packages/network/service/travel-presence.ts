import { CITY_TZ, fromLocal, isCity, localParts, resolveCity, temporaryPresenceWindow, type City } from "@thenetwork/core";
import {
  decideTravelDestinationCorrection, decideTravelEntry, presenceWindowsOverlap, samePresenceWindow, travelEntryReplyAllowed, type PresenceWindow,
} from "../../core/src/generated/travelPresence.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { homeCityOf, type Accounts } from "../../platform/src/accounts.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";
import { presenceOf } from "./snapshot.ts";

const CITY_NAME: Record<City, string> = {
  nyc: "New York City",
  sf: "San Francisco",
  la: "Los Angeles",
  chicago: "Chicago",
  miami: "Miami",
};
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_RX = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const NATURAL_SAME_MONTH = new RegExp(
  `^(?:from )?(${MONTH_RX})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|until|through|thru)\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,? ([1-9]\\d{3}))?$`,
  "i",
);
const NATURAL_TWO_MONTHS = new RegExp(
  `^(?:from )?(${MONTH_RX})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? ([1-9]\\d{3}))?\\s*(?:-|–|—|to|until|through|thru)\\s*(${MONTH_RX})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? ([1-9]\\d{3}))?$`,
  "i",
);
const EMPTY_WINDOW: PresenceWindow = { from: 0, to: 0 };
type TravelCommand = { city: City; dates?: { from: string; to: string; window: PresenceWindow } };

function isoDate(year: number, month: number, day: number): string | undefined {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

function nextIsoDay(iso: string): string | undefined {
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return;
  return new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
}

function localMidnight(input: string, city: City): number | undefined {
  const date = new Date(`${input}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input) return;
  return fromLocal(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, CITY_TZ[city]);
}

function parseNaturalDates(tail: string, city: City, now?: number): TravelCommand["dates"] | undefined {
  const same = NATURAL_SAME_MONTH.exec(tail);
  const two = !same ? NATURAL_TWO_MONTHS.exec(tail) : null;
  if (!same && !two) return;
  let startMonth: number, startDay: number, endMonth: number, endDay: number;
  let explicitStartYear: number | undefined, explicitEndYear: number | undefined;
  if (same) {
    startMonth = MONTHS[same[1]!.toLowerCase()]!;
    startDay = Number(same[2]);
    endMonth = startMonth;
    endDay = Number(same[3]);
    if (same[4]) explicitStartYear = explicitEndYear = Number(same[4]);
  } else {
    startMonth = MONTHS[two![1]!.toLowerCase()]!;
    startDay = Number(two![2]);
    endMonth = MONTHS[two![4]!.toLowerCase()]!;
    endDay = Number(two![5]);
    if (two![3]) explicitStartYear = Number(two![3]);
    if (two![6]) explicitEndYear = Number(two![6]);
  }
  const baseYear = explicitStartYear ?? explicitEndYear ?? (now !== undefined ? localParts(now, CITY_TZ[city]).year : undefined);
  if (baseYear === undefined) return;
  const resolveForYear = (startYear: number) => {
    const endYear = explicitEndYear ?? (endMonth < startMonth || (endMonth === startMonth && endDay < startDay) ? startYear + 1 : startYear);
    const fromIso = isoDate(startYear, startMonth, startDay);
    const inclusiveEndIso = isoDate(endYear, endMonth, endDay);
    if (!fromIso || !inclusiveEndIso) return;
    const toIso = nextIsoDay(inclusiveEndIso);
    if (!toIso) return;
    const start = localMidnight(fromIso, city);
    const end = localMidnight(toIso, city);
    if (start === undefined || end === undefined || start >= end) return;
    return { from: fromIso, to: toIso, window: { from: start, to: end } };
  };
  let resolved = resolveForYear(explicitStartYear ?? baseYear);
  if (resolved && explicitStartYear === undefined && explicitEndYear === undefined && now !== undefined && resolved.window.to <= now) {
    resolved = resolveForYear(baseYear + 1);
  }
  return resolved;
}

/** A direct first-person travel statement. Only exact dates are eligible to write. */
export function travelPresenceCommand(text: string, now?: number): TravelCommand | undefined {
  const line = text.trim().replace(/[.!]$/, "").replace(/[^\S\n]+/g, " ");
  const declaration = /^(?:(?:i will|i['’]ll) be in|(?:i am|i['’]m) (?:visiting|in|going to|heading to|traveling to|travelling to)) (new york city|new york|nyc|san francisco|bay area|sf|los angeles|la|chicago|chi|miami|mia)(?: (.*))?$/i.exec(line);
  if (!declaration) return;
  const named = declaration[1]!.toLowerCase();
  const resolved = homeCityOf(named) ?? resolveCity(named);
  const city: City | undefined = isCity(resolved) ? resolved : undefined;
  if (!city) return;
  const tail = (declaration[2] ?? "").trim();
  const dates = /^from ([1-9]\d{3}-\d{2}-\d{2}) (?:until|to) ([1-9]\d{3}-\d{2}-\d{2})$/i.exec(tail);
  if (dates) {
    const from = dates[1]!, to = dates[2]!;
    const start = localMidnight(from, city), end = localMidnight(to, city);
    return start === undefined || end === undefined ? { city } : { city, dates: { from, to, window: { from: start, to: end } } };
  }
  const natural = tail ? parseNaturalDates(tail, city, now) : undefined;
  return natural ? { city, dates: natural } : { city };
}

const CITY_RX = "(new york city|new york|nyc|san francisco|bay area|sf|los angeles|la|chicago|chi|miami|mia)";

/** A direct first-person correction of a saved trip's destination city. */
export function travelDestinationCorrectionCommand(text: string): { city: City; replaces: City } | undefined {
  const line = text.trim().replace(/[.!]$/, "").replace(/[^\S\n]+/g, " ");
  const match = new RegExp(
    `^(?:actually,? )?(?:(?:i will|i['’]ll) be in|(?:i am|i['’]m) (?:visiting|in|going to|heading to|traveling to|travelling to)) ${CITY_RX},? not ${CITY_RX}$`,
    "i",
  ).exec(line);
  if (!match) return;
  const resolve = (named: string): City | undefined => {
    const resolved = homeCityOf(named.toLowerCase()) ?? resolveCity(named.toLowerCase());
    return isCity(resolved) ? resolved : undefined;
  };
  const city = resolve(match[1]!), replaces = resolve(match[2]!);
  return city && replaces && city !== replaces ? { city, replaces } : undefined;
}

/** Same canonical and app-local guard on the write and on any later reply replay. */
export async function travelOwner(tx: SQL, accounts: Pick<Accounts, "activeMembership">, owner: MemberCommandOwner): Promise<boolean> {
  const binding = await memberCommandOwner(tx, accounts, owner);
  return travelEntryReplyAllowed(!!binding, !!binding?.member);
}

/** Returns copy for the canonical owner, inside the transaction that saves the reply. */
export async function saveTravelPresence(tx: SQL, accounts: Pick<Accounts, "activeMembership">, owner: MemberCommandOwner, command: TravelCommand, now: number): Promise<string | undefined> {
  const authorized = await travelOwner(tx, accounts, owner);
  const { city, dates } = command;
  const desired = dates?.window ?? EMPTY_WINDOW;
  const { app, memberId } = owner;
  const current = authorized && dates ? await tx`select member_id, city, type, from_at, to_at from network.presence
    where app_id=${app.id} and member_id=${memberId} and type='temporary'` : [];
  const trips = current.map(presenceOf).flatMap(p => {
    const window = temporaryPresenceWindow(p);
    return window ? [{ city: p.city, window }] : [];
  });
  const conflict = trips.some(p => p.city !== city && presenceWindowsOverlap(p.window, desired));
  const saved = trips.some(p => p.city === city && samePresenceWindow(p.window, desired));
  const decision = decideTravelEntry(authorized, !!dates, desired, now, conflict, saved);
  const name = CITY_NAME[city];
  switch (decision) {
    case "TravelUnavailable": return;
    case "TravelNeedsDates": return `Send both dates like this: I will be in ${name} from YYYY-MM-DD until YYYY-MM-DD. Use the first day you will be away from ${name} as the end date.`;
    case "TravelDateConflict": return `Those dates overlap a different city already saved in ${app.domain}. Send dates that don't overlap.`;
    case "TravelSave":
      await tx`insert into network.presence (app_id, member_id, city, type, from_at, to_at)
        values (${app.id}, ${memberId}, ${city}, 'temporary', ${new Date(desired.from)}, ${new Date(desired.to)})`;
      break;
    case "TravelAlreadySaved": break;
  }
  return `${decision === "TravelSave" ? "Saved" : "Already saved"} in ${app.domain}: ${name} from ${dates!.from} until ${dates!.to} (end date excluded).`;
}

/** Replaces the owner's earliest current or future trip to the replaced city, keeping its calendar dates. */
export async function correctTravelPresence(tx: SQL, accounts: Pick<Accounts, "activeMembership">, owner: MemberCommandOwner, command: { city: City; replaces: City }, now: number): Promise<string | undefined> {
  const authorized = await travelOwner(tx, accounts, owner);
  const { app, memberId } = owner;
  const current = authorized ? await tx`select member_id, city, type, from_at, to_at from network.presence
    where app_id=${app.id} and member_id=${memberId} and type='temporary' and city=${command.replaces} and to_at > ${new Date(now)}
    order by from_at asc` : [];
  const trips = current.map(presenceOf).flatMap(p => {
    const window = temporaryPresenceWindow(p);
    return window ? [window] : [];
  });
  switch (decideTravelDestinationCorrection(authorized, trips.length)) {
    case "TravelCorrectUnavailable": return;
    case "TravelCorrectNone": return `No saved ${CITY_NAME[command.replaces]} trip in ${app.domain}.`;
    case "TravelCorrectOne": break;
  }
  const trip = trips[0]!;
  const fromParts = localParts(trip.from, CITY_TZ[command.replaces]);
  const toParts = localParts(trip.to, CITY_TZ[command.replaces]);
  const from = isoDate(fromParts.year, fromParts.month, fromParts.day);
  const to = isoDate(toParts.year, toParts.month, toParts.day);
  const start = from ? localMidnight(from, command.city) : undefined;
  const end = to ? localMidnight(to, command.city) : undefined;
  if (!from || !to || start === undefined || end === undefined) return;
  await tx`delete from network.presence
    where ctid in (select ctid from network.presence
      where app_id=${app.id} and member_id=${memberId} and type='temporary' and city=${command.replaces} and to_at > ${new Date(now)}
      order by from_at asc limit 1)`;
  await tx`insert into network.presence (app_id, member_id, city, type, from_at, to_at)
    values (${app.id}, ${memberId}, ${command.city}, 'temporary', ${new Date(start)}, ${new Date(end)})`;
  return `Saved in ${app.domain}: ${CITY_NAME[command.city]} from ${from} until ${to} (end date excluded).`;
}
