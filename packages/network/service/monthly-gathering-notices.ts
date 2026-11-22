import { DAY } from "@thenetwork/core";
import type { QueueRow, RecipientCheck } from "../../blooio/src/outbound-queue.ts";
import {
  gatheringAttendancePromptDelayMs, gatheringAttendancePromptLimitMs, gatheringNoticeAllowed, gatheringNoticeMayClaim,
  gatheringNoticeWindow, monthlyGatheringNoticePrefix, type GatheringNoticeKind,
} from "../../core/src/generated/monthlyGatheringNotices.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { bookedReminderWindow, gatheringEventPreference, storedGatheringInviteRecipientCurrent, type NetworkState } from "../src/network.ts";
import { BlooioAdapter } from "./channel.ts";
import { gatheringDeliveryEvent, gatheringDeliveryId, gatheringLocalStart, lockGatheringAdmission } from "./monthly-gathering-delivery.ts";
import { currentGatheringMember, gatheringRsvpReference, type GatheringRsvpKey } from "./monthly-gathering-rsvp.ts";
import { gatheringVenueStillCurrent } from "./monthly-gatherings.ts";
import type { NetworkRuntime } from "./runtime.ts";

export { monthlyGatheringNoticePrefix };

type GatheringAccounts = Pick<Accounts, "activeMembership" | "lowestAge">;
const labelByKind = { GatheringDayBefore: "day-before", GatheringNearStart: "near-start", GatheringAttendancePrompt: "attendance" } satisfies Record<GatheringNoticeKind, string>;
const kinds = Object.keys(labelByKind) as GatheringNoticeKind[];
const prefixFor = (kind: GatheringNoticeKind) => `${monthlyGatheringNoticePrefix}${labelByKind[kind]}:`;
const noticeKind = (id: string) => kinds.find(kind => id.startsWith(prefixFor(kind)));
const isAttendance = (kind: GatheringNoticeKind) => kind === "GatheringAttendancePrompt";

interface ReservedEvent extends GatheringRsvpKey {
  member_id: string; city: string; status: string; month: string; capacity: number;
  venue_kind: "curated" | "listing"; venue_ref: string; venue_name: string;
  reviewed_at: Date | null; starts_at: Date; ends_at: Date; responded_at: Date;
  choice: "attending" | "grouping" | "withdrawn";
  prefs: Parameters<typeof gatheringEventPreference>[0]; has_answer: boolean;
}

function inWindow(kind: GatheringNoticeKind, event: ReservedEvent, now: number): boolean {
  const booked = !isAttendance(kind) && bookedReminderWindow(kind === "GatheringDayBefore" ? "day-before-reminder" : "near-meeting-reminder", now, event.starts_at.getTime());
  return gatheringNoticeWindow(kind, booked, now - event.ends_at.getTime());
}

function card(event: ReservedEvent, kind: GatheringNoticeKind): string {
  const ref = `${gatheringRsvpReference(event.id)} ${event.revision}`;
  if (isAttendance(kind)) return "Did you attend the Network's monthly gathering? Reply with one line.\n"
    + `GATHERING ATTENDED ${ref} YES\nGATHERING ATTENDED ${ref} NO`;
  return `You're on the list for the Network's monthly gathering on ${gatheringLocalStart(event.starts_at)} New York time at ${event.venue_name}. To withdraw, reply with the line below.\n`
    + `WITHDRAW GATHERING ${ref}`;
}

async function reservedEvent(tx: SQL, app: AppInfo, key: GatheringRsvpKey, memberId: string): Promise<ReservedEvent | undefined> {
  const [event] = await tx<ReservedEvent[]>`select g.*,r.member_id,r.choice,r.responded_at,m.prefs,
      exists(select 1 from network.monthly_gathering_attendance a where a.app_id=g.app_id and a.gathering_id=g.id
        and a.revision=g.revision and a.member_id=r.member_id) as has_answer
    from network.monthly_gatherings g join network.monthly_gathering_rsvps r
      on r.app_id=g.app_id and r.gathering_id=g.id and r.revision=g.revision
    join network.members m on m.app_id=r.app_id and m.id=r.member_id
    where g.app_id=${app.id} and g.city='nyc' and g.id=${key.id} and g.revision=${key.revision} and r.member_id=${memberId}`;
  return event;
}

async function currentNotice(tx: SQL, accounts: GatheringAccounts, app: AppInfo, event: ReservedEvent,
  address: string, kind: GatheringNoticeKind, rollout: boolean, trusted: boolean, now: number): Promise<boolean> {
  if (!inWindow(kind, event, now)) return false;
  const approved = event.status === "approved" && !!event.reviewed_at && event.reviewed_at.getTime() <= now;
  const reserved = event.choice !== "withdrawn" && event.responded_at.getTime() <= now;
  const current = trusted && gatheringEventPreference(event.prefs)
    && await currentGatheringMember(tx, accounts, { app, memberId: event.member_id, e164: address }, event.city, now);
  const venue = !isAttendance(kind) && await gatheringVenueStillCurrent(tx, event, now);
  return gatheringNoticeAllowed(rollout, approved, reserved, current, true, venue, event.has_answer, kind);
}

/** Stage notices for current reservations in a normal locked Network unit. */
export async function queueGatheringNotices(rt: NetworkRuntime, accountsFor: (tx: SQL) => GatheringAccounts, now: () => number): Promise<void> {
  const { app, adapter } = rt;
  if (app.id !== "ntwrk" || rt.city !== "nyc" || !rt.matchingAllowed || !rt.net.matchingEnabled() || !(adapter instanceof BlooioAdapter) || !adapter.live) return;
  const at = now();
  const candidates = await rt.scoped(tx => tx<(GatheringRsvpKey & { member_id: string })[]>`select g.id,g.revision,r.member_id
    from network.monthly_gatherings g join network.monthly_gathering_rsvps r
      on r.app_id=g.app_id and r.gathering_id=g.id and r.revision=g.revision
    where g.app_id=${app.id} and g.city='nyc' and g.status='approved' and r.choice<>'withdrawn'
      and ((g.starts_at>${new Date(at)} and g.starts_at<=${new Date(at + DAY)})
        or (g.ends_at<=${new Date(at - gatheringAttendancePromptDelayMs)} and g.ends_at>${new Date(at - gatheringAttendancePromptLimitMs)}))
    order by g.starts_at,g.id,r.member_id`);
  if (!candidates.length) return;
  await rt.unitOfWork(async net => {
    if (!net.matchingEnabled() || !adapter.live) return;
    for (const candidate of candidates) {
      const address = rt.addressOf(candidate.member_id);
      if (!address) continue;
      const notice = await rt.scoped(async tx => {
        const event = await reservedEvent(tx, app, candidate, candidate.member_id);
        const at = now();
        const kind = event && kinds.find(kind => inWindow(kind, event, at));
        if (!event || !kind) return;
        const id = gatheringDeliveryId(event, event.member_id, prefixFor(kind));
        const [saved] = await tx`select id from network.messages where app_id=${app.id} and id=${id}`;
        if (!saved && await currentNotice(tx, accountsFor(tx), app, event, address, kind, true, true, at)) {
          return { id, body: card(event, kind), kind, startsAt: event.starts_at.getTime() };
        }
      });
      if (notice) net.sendGatheringRsvpNotice(candidate.member_id, notice);
    }
  });
}

export async function lockGatheringNoticeAdmission(tx: SQL, app: string, runtimeId: string, row: QueueRow): Promise<void> {
  const kind = noticeKind(row.id);
  if (kind) await lockGatheringAdmission(tx, app, runtimeId, row, prefixFor(kind));
}

/** Recheck the RSVP and exact, still timely payload under the queue's existing row fences. */
export async function gatheringNoticeAdmission(tx: SQL, app: AppInfo, runtimeId: string, accounts: GatheringAccounts,
  row: QueueRow, now: number): Promise<RecipientCheck> {
  const refused: RecipientCheck = { ok: false, reason: "gathering_notice_changed" };
  const kind = noticeKind(row.id);
  const key = kind && gatheringDeliveryEvent(row, prefixFor(kind));
  if (!kind || !key || !row.memberId || app.id !== "ntwrk" || row.app !== app.id || row.kind !== "transactional"
    || row.oppId || row.mediaUrls.length || row.approvedPhotos?.length) return refused;
  const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where id=${runtimeId} and app_id=${app.id}`;
  const event = await reservedEvent(tx, app, key, row.memberId);
  if (!saved || !event) return refused;
  const current = await currentNotice(tx, accounts, app, event, row.to, kind, saved.state.matchingEnabled,
    storedGatheringInviteRecipientCurrent(saved.state, row.memberId), now);
  const type = isAttendance(kind) ? "feedback_request" : "reminder";
  const [message] = await tx`select id from network.messages where app_id=${app.id} and id=${row.id} and member_id=${row.memberId}
    and direction='outbound' and type=${type} and not system and not proactive and opportunity_id is null and body=${row.text}`;
  return gatheringNoticeMayClaim(current, row.text === card(event, kind), !!message) ? { ok: true } : refused;
}
