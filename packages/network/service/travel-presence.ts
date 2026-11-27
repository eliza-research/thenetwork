import { CITY_TZ, fromLocal, temporaryPresenceWindow, type City } from "@thenetwork/core";
import {
  decideTravelEntry, presenceWindowsOverlap, samePresenceWindow, travelEntryReplyAllowed, type PresenceWindow,
} from "../../core/src/generated/travelPresence.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { homeCityOf, type Accounts } from "../../platform/src/accounts.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";
import { presenceOf } from "./snapshot.ts";

const CITY_NAME: Record<City, string> = { nyc: "New York City", sf: "San Francisco", la: "Los Angeles" };
const EMPTY_WINDOW: PresenceWindow = { from: 0, to: 0 };
type TravelCommand = { city: City; dates?: { from: string; to: string; window: PresenceWindow } };

function localMidnight(input: string, city: City): number | undefined {
  const date = new Date(`${input}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input) return;
  return fromLocal(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 0, CITY_TZ[city]);
}

/** A direct first-person travel statement. Only exact dates are eligible to write. */
export function travelPresenceCommand(text: string): TravelCommand | undefined {
  const line = text.trim().replace(/[.!]$/, "").replace(/[^\S\n]+/g, " ");
  const declaration = /^(?:i will|i['’]ll) be in (new york city|new york|nyc|san francisco|sf|los angeles|la)(?: (.*))?$/i.exec(line);
  if (!declaration) return;
  const named = declaration[1]!.toLowerCase();
  const resolved = homeCityOf(named);
  const city: City | undefined =
    resolved === "nyc" || resolved === "sf" || resolved === "la"
      ? resolved
      : named === "la" || named === "los angeles"
        ? "la"
        : undefined;
  if (!city) return;
  const dates = /^from ([1-9]\d{3}-\d{2}-\d{2}) (?:until|to) ([1-9]\d{3}-\d{2}-\d{2})$/i.exec(declaration[2] ?? "");
  if (!dates) return { city };
  const from = dates[1]!, to = dates[2]!;
  const start = localMidnight(from, city), end = localMidnight(to, city);
  return start === undefined || end === undefined ? { city } : { city, dates: { from, to, window: { from: start, to: end } } };
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
