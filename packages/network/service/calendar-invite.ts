import { createHash, randomBytes } from "node:crypto";
import { CITY_TZ, localParts } from "@thenetwork/core";
import { calendarChoice, calendarDownloadAllowed, calendarInviteExpiresAt, calendarInvitePath, calendarMeetingEligible } from "../../core/src/generated/calendarInvite.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { canMatchInApp } from "../../platform/src/age.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const NO_BOOKING = "I couldn't find a confirmed upcoming meeting for that calendar invite.";
const WHICH_BOOKING = "Which meeting should I use? Send ‘calendar invite on YYYY-MM-DD at HH:MM’ with the New York date and 24-hour time.";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

type CalendarRequest = { localStart?: string };

export function calendarInviteRequest(text: string): CalendarRequest | undefined {
  const match = /^(?:please )?(?:send me (?:a )?)?calendar invite(?: on (\d{4}-\d{2}-\d{2}) at ((?:[01]\d|2[0-3]):[0-5]\d))?[.!?]?$/i.exec(text.trim().replace(/\s+/g, " "));
  if (match) return match[1] ? { localStart: `${match[1]} ${match[2]}` } : {};
}

function localStart(at: number): string {
  const { year, month, day, hour, minute } = localParts(at, CITY_TZ.nyc);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
}

interface Booking {
  id: string;
  meeting_at: Date;
  venue: string | null;
  venue_area: string | null;
  end_at: number | null;
  revision: number;
  booking_told: boolean;
}

interface CalendarGrant {
  member_id: string;
  phone_hash: string;
  opportunity_id: string;
  network_id: string;
  meeting_at: Date;
  schedule_revision: number;
  issued_at: Date;
  expires_at: Date;
}

/** Read only the booked member's confirmed seat and public time and venue. */
async function bookings(tx: SQL, app: AppInfo, networkId: string, memberId: string, now: number, id?: string) {
  return await tx<Booking[]>`select opp.id,opp.meeting_at,item->>'venue' as venue,item->>'venueArea' as venue_area,
    (item#>>'{plan,window,end}')::float8 as end_at,coalesce((item->>'scheduleRevision')::int,0) as revision,
    coalesce(item->'bookedTold' ? ${memberId},false) as booking_told
    from network.opportunities opp
    join network.participations seat on seat.app_id=opp.app_id and seat.opportunity_id=opp.id and seat.member_id=${memberId}
    join network.network_state saved on saved.app_id=opp.app_id and saved.id=${networkId}
    join lateral jsonb_array_elements(saved.state->'opps') item on item->>'id'=opp.id
    where opp.app_id=${app.id} and opp.state='SCHEDULED' and opp.meeting_at>${new Date(now)}
      and seat.role='participant' and seat.status='confirmed' and item->>'stage'='scheduled'
      and coalesce(jsonb_typeof(item->'seat'),'null')<>'object'
      ${id ? tx`and opp.id=${id}` : tx``}
    order by opp.meeting_at,opp.id`;
}

function eligible(row: Booking, now: number): boolean {
  return calendarMeetingEligible(true, true, true, row.booking_told, !!row.venue?.trim(), row.meeting_at.getTime() - now);
}

export async function issueCalendarInvite(tx: SQL, accounts: Accounts, owner: MemberCommandOwner, networkId: string,
  request: CalendarRequest, origin: string, now: number): Promise<{ body: string; link?: string } | undefined> {
  const binding = await memberCommandOwner(tx, accounts, owner);
  if (!binding?.member || !canMatchInApp(await accounts.lowestAge(owner.e164, binding.person), owner.app)) return;
  const rows = await bookings(tx, owner.app, networkId, owner.memberId, now);
  const wanted = rows.filter(row => eligible(row, now) && (!request.localStart || localStart(row.meeting_at.getTime()) === request.localStart));
  const choice = calendarChoice(wanted.length);
  if (choice !== "PickBooking") return { body: choice === "AskForBooking" ? WHICH_BOOKING : NO_BOOKING };
  const row = wanted[0]!;
  const token = randomBytes(32).toString("base64url");
  const until = calendarInviteExpiresAt(now, row.meeting_at.getTime());
  await tx`insert into platform.calendar_invites(app_id,token_hash,member_id,phone_hash,network_id,opportunity_id,
    meeting_at,schedule_revision,issued_at,expires_at) values (${owner.app.id},${digest(token)},${owner.memberId},${accounts.phoneHash(owner.e164)},
    ${networkId},${row.id},${row.meeting_at},${row.revision},${new Date(now)},${new Date(until)})`;
  const link = new URL(`${calendarInvitePath}?code=${token}`, origin).href;
  return { body: `Open this file to add your meeting to your calendar.\n${link}`, link };
}

async function currentCalendarInvite(tx: SQL, accounts: Accounts, app: AppInfo, token: string, clock: () => number, owner?: MemberCommandOwner) {
  if (!TOKEN.test(token)) return;
  const [grant] = await tx<CalendarGrant[]>`select member_id,phone_hash,opportunity_id,network_id,meeting_at,schedule_revision,issued_at,expires_at
    from platform.calendar_invites where app_id=${app.id} and token_hash=${digest(token)} and expires_at>${new Date(clock())}`;
  if (!grant || (owner && (owner.memberId !== grant.member_id || accounts.phoneHash(owner.e164) !== grant.phone_hash))) return;
  // The runtime updates this row before projecting changes to the booking and its member seats.
  const locked = await tx`select id from network.network_state where app_id=${app.id} and id=${grant.network_id} for share`;
  if (!locked.length) return;
  const phone = owner ? { e164: owner.e164 } : await accounts.byPhoneHash(grant.phone_hash);
  const binding = phone ? await memberCommandOwner(tx, accounts, { app, memberId: grant.member_id, e164: phone.e164 }) : undefined;
  const currentOwner = phone && binding?.member ? canMatchInApp(await accounts.lowestAge(phone.e164, binding.person), app) : false;
  const [current] = currentOwner ? await bookings(tx, app, grant.network_id, grant.member_id, clock(), grant.opportunity_id) : [];
  const now = clock();
  if (!current || !calendarDownloadAllowed(currentOwner, eligible(current, now), current.meeting_at.getTime() === grant.meeting_at.getTime(),
    current.revision === grant.schedule_revision, now, grant.expires_at.getTime())) return;
  return { current, issued: grant.issued_at.getTime(), memberId: grant.member_id };
}

export async function calendarReplyCurrent(tx: SQL, accounts: Accounts, owner: MemberCommandOwner, reply: string, clock: () => number): Promise<boolean> {
  if (reply === NO_BOOKING || reply === WHICH_BOOKING) {
    const binding = await memberCommandOwner(tx, accounts, owner);
    return !!binding?.member && canMatchInApp(await accounts.lowestAge(owner.e164, binding.person), owner.app);
  }
  const link = reply.match(/\nhttps:\/\/[^/\s]+\/api\/calendar\/invite\?code=([A-Za-z0-9_-]{43})$/)?.[1];
  return !!link && !!await currentCalendarInvite(tx, accounts, owner.app, link, clock, owner);
}

// RFC 5545 uses a 75-octet content-line limit, including the leading space on continuations.
function foldLine(line: string): string {
  const parts: string[] = [];
  let part = "", bytes = 0;
  for (const character of line) {
    const width = Buffer.byteLength(character);
    if (bytes + width > 75) { parts.push(part); part = " "; bytes = 1; }
    part += character;
    bytes += width;
  }
  return [...parts, part].join("\r\n");
}

const calendarText = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\\,;]/g, "\\$&");
const utc = (at: number) => new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, "");

export async function requestedCalendarFile(tx: SQL, accounts: Accounts, app: AppInfo, token: string, clock: () => number): Promise<Response> {
  const value = await currentCalendarInvite(tx, accounts, app, token, clock);
  const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
  if (!value) return Response.json({ ok: false, error: "not_found" }, { status: 404, headers });
  const { current, issued, memberId } = value;
  const start = current.meeting_at.getTime();
  const location = [current.venue, current.venue_area].filter(Boolean).join(", ");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Network//Meeting//EN", "BEGIN:VEVENT",
    `UID:${digest(`${app.id}:${current.id}:${memberId}`)}@${app.domain}`, `DTSTAMP:${utc(issued)}`, `DTSTART:${utc(start)}`,
    ...(current.end_at && current.end_at > start ? [`DTEND:${utc(current.end_at)}`] : []),
    `SEQUENCE:${current.revision}`, "SUMMARY:The Network meeting", `LOCATION:${calendarText(location)}`, "END:VEVENT", "END:VCALENDAR", ""];
  return new Response(lines.map(foldLine).join("\r\n"), { headers: { ...headers, "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="network-meeting.ics"' } });
}
