import type { ApprovedRelayPhoto } from "../../core/src/svc/contract.ts";
// Outbound channels for the production service (service.ts). The Network composes every message;
// a ChannelAdapter only delivers what the Network already decided to send.
//  - DryRunAdapter (the default): nothing leaves the machine. The service stores each send in
//    network.messages with status "dry_run", and the adapter logs one line (no message text).
//  - BlooioAdapter: the persisted queue (packages/blooio outbound-queue.ts, platform.outbound). The
//    runtime writes each send into the queue in the same transaction as the Network state; the queue
//    delivers after the commit, with the Network's send-time checks (consent, the recipient, the person
//    cap, the leak lists). It sends only when BLOOIO_ALLOW_SEND=1, NTWRK_LIVE_APPROVED=1 and the app's
//    own <APP>_LIVE_APPROVED=1 (founder approval per app; for ntwrk the last two are the same flag).
//    Otherwise every message is refused ("refused_not_approved") and the provider is never called.
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { MemberId } from "@thenetwork/core";
import { plans } from "@thenetwork/engine";
import { blooioRecipientPolicy, bookedReminderKey, bookedReminderKind, bookedReminderWindow, forbiddenProvider, gatheringRepeatOppPrefix, meetingFeedbackKey, replacementProbeKey, replacementProbePrefix, storedInterruptionSurveyCurrent, type BookedReminderKind, type NetworkState } from "../src/network.ts";
import { interruptionFeedbackPrefix } from "../src/interruption-feedback.ts";
import { canBeMatched } from "../../core/src/policy.ts";
import { RESCHEDULE_QUEUE_PREFIX, rescheduleNoticeCurrent, rescheduleUpdateKey, rescheduleUpdatePrefix } from "../src/rescheduling.ts";
import { OutboundQueue, WAITING, type AppChecks, type ClaimCheck, type MessageKind, type QueueRow, type RecipientCheck } from "../../blooio/src/outbound-queue.ts";
import type { Clock, ChannelAdapter as ProviderAdapter, StatusUpdate } from "../../blooio/src/types.ts";
import type { NetworkRuntime } from "./runtime.ts";
import { APPS } from "../../platform/src/apps.ts";
import { isMemberInvitationLink } from "../src/invitation.ts";
import { EXPECTED_INVITATION_PREFIX } from "./expected-invitation-store.ts";
import { cofounderDeliveryIdPrefix } from "../../core/src/generated/cofounderDispatch.ts";
import { bookingNoticeRosterCurrent, originalBookingNoticeCurrent } from "../../core/src/generated/meetingReschedule.ts";
import { bookingNoticeReceived, bookingNoticeReceiptMayArrive, bookingNoticeRetryMs, dayBeforeReminderEndMs, meetingFeedbackPrefix, meetingFeedbackWindow, queuedBookingCancellationClaim, queuedMeetingFeedbackClaim, queuedReminderClaim, settlementDelayMs } from "../../core/src/generated/meetingSettlement.ts";
import { lateArrivalDeliveryPrefix } from "../../core/src/generated/groupLateArrival.ts";
import { parseLateArrivalDeliveryId } from "../src/group-late-arrival.ts";
import { bookedCancellationAllowed, bookedCancellationPrefix, closedOpportunityRowStale, queuedProbePolicy } from "../../core/src/generated/outboundAdmission.ts";
import { queuedPlanProbeAllowed } from "../../core/src/generated/planDispatch.ts";
import { reengagementDeliveryPrefix, reengagementMayDispatch } from "../../core/src/generated/outreachPolicy.ts";
import { recoveryPlanCanProceed } from "../../core/src/generated/bookedGroupReplacement.ts";
import { effectiveParticipation } from "./snapshot.ts";
import { lockGatheringAdmission, monthlyGatheringInvitePrefix } from "./monthly-gathering-delivery.ts";
import { lockGatheringNoticeAdmission, monthlyGatheringNoticePrefix } from "./monthly-gathering-notices.ts";
import { lockPublicEventContact, publicEventContactAdmission } from "./public-event-admission.ts";
import { lockPeerOpportunityContact, peerOpportunityContactRestricted } from "./peer-opportunity-admission.ts";
import { approvedVenueBookingLink, venueBookingNoticeBase, venueBookingNoticeKey } from "../src/venue-booking-link.ts";

/** The apps' own domains: the Network's fixed copy names them ("you're in friends.help and peon.biz"), so the contact check allows them. */
const OWN_DOMAINS = Object.values(APPS).flatMap(a => [`https://${a.domain}`, `www.${a.domain}`, a.domain]);

type TerminalNotice = "acceptance" | "booking";

async function rescheduleAdmission(tx: SQL, row: QueueRow, runtimeId: string, now: number): Promise<RecipientCheck> {
  const refused: RecipientCheck = { ok: false, reason: "reschedule_changed" };
  if (!row.memberId || !row.oppId || (row.kind !== "transactional" && row.kind !== "reply")) return refused;
  const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where app_id=${row.app} and id=${runtimeId}`;
  const booking = saved?.state.opps.find(opp => opp.id === row.oppId);
  if (!booking) return refused;
  const accepted = new Set(booking.status.filter(([, status]) => status === "yes").map(([id]) => id));
  const roster = [...new Set(booking.participants.filter(id => accepted.has(id)))].sort();
  return rescheduleNoticeCurrent({ ...booking, current: booking.stage === "scheduled" }, roster, row.memberId, row.id, now)
    ? { ok: true } : refused;
}

async function interruptionSurveyAdmission(tx: SQL, row: QueueRow, runtimeId: string, now: number): Promise<RecipientCheck> {
  const refused: RecipientCheck = { ok: false, reason: "interruption_survey_changed" };
  if (row.kind !== "proactive" || !row.memberId) return refused;
  const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where app_id=${row.app} and id=${runtimeId}`;
  if (!saved || !storedInterruptionSurveyCurrent(saved.state, row.app, row.memberId, row.id, now)) return refused;
  const [member] = await tx<(Parameters<typeof effectiveParticipation>[0] & { age: number | null })[]>`select ages.age,m.participation_state,m.participation_window,m.opted_out
    from network.members m join platform.matching_ages ages on ages.app_id=m.app_id and ages.member_id=m.id
    where m.app_id=${row.app} and m.id=${row.memberId} and m.account_status='active' and not m.opted_out`;
  return member && canBeMatched(member.age ?? undefined) && effectiveParticipation(member, now).state !== "paused" ? { ok: true } : refused;
}

/** spec/outreachPolicy.md, "Re-engagement requires current evidence of silence" */
async function reengagementAdmission(tx: SQL, row: QueueRow, runtimeId: string, now: number): Promise<RecipientCheck> {
  const refused: RecipientCheck = { ok: false, reason: "reengagement_changed" };
  if (row.kind !== "proactive" || !row.memberId) return refused;
  const [entry] = await tx<(Parameters<typeof effectiveParticipation>[0] & {
    ts: Date; age: number | null; onlyWhenAsked: boolean | null; reengaged: boolean | null;
    lastInbound: number | null; lastAskAt: number | null; heldHighAt: number | null;
  })[]>`select msg.ts, ages.age, current.participation_state, current.participation_window, current.opted_out,
      member."onlyWhenAsked", member.reengaged, member."lastInbound", member."lastAskAt", member."heldHighAt"
    from network.messages msg
    join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    join lateral jsonb_to_recordset(saved.state->'members') as member(
      id text, "onlyWhenAsked" boolean, reengaged boolean, "lastInbound" float8, "lastAskAt" float8, "heldHighAt" float8
    ) on member.id=msg.member_id
    join network.members current on current.app_id=msg.app_id and current.id=msg.member_id
    join platform.matching_ages ages on ages.app_id=msg.app_id and ages.member_id=msg.member_id
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId}
      and current.account_status='active' and not current.opted_out
      and msg.direction='outbound' and msg.type='question' and msg.body=${row.text}`;
  return entry && canBeMatched(entry.age ?? undefined) && effectiveParticipation(entry, now).state !== "paused"
    && entry.lastInbound !== null && entry.lastAskAt !== null
    && reengagementMayDispatch(entry.onlyWhenAsked === true, entry.reengaged === true, entry.lastInbound, entry.lastAskAt,
      entry.heldHighAt ?? 0, entry.ts.getTime(), now) ? { ok: true } : refused;
}

async function venueBookingNoticesCurrent(tx: SQL, app: string, runtimeId: string, ids: string[], now: number,
  queued?: Pick<QueueRow, "id" | "memberId" | "oppId" | "text">): Promise<boolean> {
  const linked = ids.filter(venueBookingNoticeBase);
  if (!linked.length) return true;
  const rows = await tx<{ id: string; member_id: string; body: string; booking: NetworkState["opps"][number] }[]>`select msg.id, msg.member_id, msg.body, item.value as booking
    from network.messages msg
    join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    join lateral jsonb_array_elements(saved.state->'opps') item(value) on item.value->>'id'=msg.opportunity_id
    where msg.app_id=${app} and msg.id in ${tx(linked)} and msg.direction='outbound' and msg.type='proposal' and msg.body is not null`;
  return rows.length === linked.length && rows.every(({ id, member_id, body, booking }) => {
    const exactMessage = !!booking.venueId && venueBookingNoticeBase(id) === venueBookingNoticeKey(booking.id, member_id, booking.venueId)
      && (!queued || (queued.id === id && queued.memberId === member_id && queued.oppId === booking.id && queued.text === body));
    const accepted = booking.status.some(([member, status]) => member === member_id && status === "yes");
    return !!approvedVenueBookingLink(booking, member_id, accepted, now, body, exactMessage);
  });
}

export async function originalBookingNoticeStale(tx: SQL, app: string, runtimeId: string, ids: string[], clock: Clock,
  queued?: Pick<QueueRow, "id" | "memberId" | "oppId" | "text">): Promise<boolean> {
  if (!ids.length) return false;
  const rows = await tx<{
    scheduled: boolean; confirmed: boolean | null; revision: number | null; meeting_at: Date | null;
    group_booking: boolean | null; roster_recorded: boolean; roster_includes_recipient: boolean | null; roster_confirmed: boolean;
  }[]>`select opp.meeting_at,
    (booking.id is not null and opp.state='SCHEDULED') as scheduled,
    (seat.role='participant' and seat.status='confirmed') as confirmed,booking."scheduleRevision" as revision,
    opp.kind='group' as group_booking,msg.booking_roster_member_ids is not null as roster_recorded,
    msg.member_id=any(msg.booking_roster_member_ids) as roster_includes_recipient,
    not exists (select 1 from unnest(msg.booking_roster_member_ids) named(member_id) where not exists (
      select 1 from network.participations current_seat where current_seat.app_id=msg.app_id
        and current_seat.opportunity_id=msg.opportunity_id and current_seat.member_id=named.member_id
        and current_seat.role='participant' and current_seat.status='confirmed'
    )) as roster_confirmed
    from network.messages msg
    left join network.opportunities opp on opp.app_id=msg.app_id and opp.id=msg.opportunity_id
    left join network.participations seat on seat.app_id=msg.app_id and seat.opportunity_id=msg.opportunity_id and seat.member_id=msg.member_id
    left join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    left join lateral jsonb_to_recordset(saved.state->'opps') as booking(id text,"scheduleRevision" int) on booking.id=msg.opportunity_id
    where msg.app_id=${app} and msg.id in ${tx(ids)} and msg.direction='outbound' and msg.type='proposal' and msg.opportunity_id is not null`;
  const now = clock.now();
  return rows.some(row => !originalBookingNoticeCurrent(row.scheduled === true, row.confirmed === true,
    (row.revision ?? 0) === 0, (row.meeting_at?.getTime() ?? now) - now)
    || !bookingNoticeRosterCurrent(row.group_booking === true, row.roster_recorded, row.roster_includes_recipient === true, row.roster_confirmed))
    || !await venueBookingNoticesCurrent(tx, app, runtimeId, ids, now, queued);
}

function terminalNotice(row: QueueRow): TerminalNotice | undefined {
  if (!row.oppId || !row.memberId || (row.kind !== "transactional" && row.kind !== "reply")) return;
  const key = `${row.oppId}:${row.memberId}`;
  if (row.id === `opportunity-release:${key}`) return "acceptance";
  if (row.kind === "transactional" && row.id === `${bookedCancellationPrefix}${key}`) return "booking";
}

type BookingReceipt = { status: string; sent_at: Date | null };

function receivedBookingNotice(receipt: BookingReceipt, now: number): boolean {
  return bookingNoticeReceived(receipt.status, receipt.sent_at?.getTime() ?? -1, now);
}

export async function currentBookingReceipt(tx: SQL, app: string, oppId: string, memberId: MemberId,
  revision: number, lane: string | null): Promise<BookingReceipt | undefined> {
  const key = rescheduleUpdateKey(oppId, revision, memberId);
  const changed = lane === "Cofounder" ? `${cofounderDeliveryIdPrefix}reveal:${key}` : key;
  const notices = await tx<BookingReceipt[]>`select receipt.status,receipt.sent_at from network.messages notice
    join platform.outbound receipt on receipt.app_id=notice.app_id and receipt.id=notice.id and receipt.member_id=notice.member_id
    where notice.app_id=${app} and notice.opportunity_id=${oppId} and notice.member_id=${memberId}
      and notice.direction='outbound' and ${revision === 0 ? tx`notice.type='proposal'` : tx`notice.type='scheduling' and notice.id=${changed}`}
    order by notice.id limit 2 for share of receipt`;
  return notices.length === 1 ? notices[0] : undefined;
}

async function cancellationBookingReceipts(tx: SQL, app: string, oppId: string, memberId: string,
  revision: number, lane: string | null): Promise<BookingReceipt[]> {
  const deliveryPrefix = lane === "Cofounder" ? `${cofounderDeliveryIdPrefix}reveal:` : "";
  const prefix = `${deliveryPrefix}${rescheduleUpdatePrefix(oppId)}`;
  const suffix = `:${memberId}`;
  const notices = await tx<(BookingReceipt & { id: string; type: string })[]>`select notice.id,notice.type,receipt.status,receipt.sent_at
    from network.messages notice join platform.outbound receipt
      on receipt.app_id=notice.app_id and receipt.id=notice.id and receipt.member_id=notice.member_id
    where notice.app_id=${app} and notice.opportunity_id=${oppId} and notice.member_id=${memberId} and notice.direction='outbound'
      and (notice.type='proposal' or (${revision > 0} and notice.type='scheduling' and starts_with(notice.id,${prefix})))
    for share of receipt`;
  return notices.filter(notice => {
    if (notice.type === "proposal") return true;
    const candidate = Number(notice.id.slice(prefix.length, -suffix.length));
    return Number.isSafeInteger(candidate) && candidate > 0 && candidate <= revision
      && notice.id === `${deliveryPrefix}${rescheduleUpdateKey(oppId, candidate, memberId)}`;
  });
}

/** The exact outbound record and accepted seat authorize a closed outcome notice. */
async function releaseAdmission(tx: SQL, row: QueueRow, kind: TerminalNotice, runtimeId: string, now: number): Promise<ClaimCheck> {
  const refused = { ok: false, reason: "opportunity_release_changed" } as const;
  if (!row.memberId || !row.oppId) return refused;
  const booked = kind === "booking";
  const proof = [{ id: row.oppId, stage: "closed", closedFrom: "scheduled", bookedTold: [row.memberId] }];
  const [release] = await tx<{ state: string; meeting_at: Date | null; status: string; told: boolean; revision: number; lane: string | null }[]>`select opp.state,opp.meeting_at,seat.status,
    coalesce(schedule."scheduleRevision",0) as revision,schedule.lane,
    coalesce((saved.state->'opps') @> ${proof}::jsonb,false) as told from network.messages msg
    join network.opportunities opp on opp.app_id=msg.app_id and opp.id=msg.opportunity_id
    join network.participations seat on seat.app_id=msg.app_id and seat.opportunity_id=opp.id and seat.member_id=msg.member_id
    left join network.network_state saved on ${booked} and saved.app_id=msg.app_id and saved.id=${runtimeId}
    left join lateral jsonb_to_recordset(saved.state->'opps') as schedule(id text,"scheduleRevision" int,lane text) on schedule.id=opp.id
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId} and msg.opportunity_id=${row.oppId}
      and msg.direction='outbound' and msg.type='cancellation' and msg.body=${row.text} and seat.role='participant'`;
  if (!release) return refused;
  if (!booked) return release.state === "SKIPPED" && release.status === "available" ? { ok: true } : refused;
  const start = release.meeting_at?.getTime() ?? now;
  const current = bookedCancellationAllowed(release.state === "CANCELLED", release.status === "accepted", release.told, start - now);
  const receipts = current ? await cancellationBookingReceipts(tx, row.app, row.oppId, row.memberId, release.revision, release.lane) : [];
  switch (queuedBookingCancellationClaim(current, receipts.some(receipt => receivedBookingNotice(receipt, now)),
    receipts.some(receipt => bookingNoticeReceiptMayArrive(receipt.status)))) {
    case "SendCancellation": return { ok: true };
    case "WaitForCancellationReceipt":
      return { ok: false, reason: "booking_notice_pending", retryAt: Math.min(now + bookingNoticeRetryMs, start) };
    default: return refused;
  }
}

async function bookedReminderAdmission(tx: SQL, row: QueueRow, kind: BookedReminderKind, runtimeId: string, now: number): Promise<ClaimCheck> {
  const refused = { ok: false, reason: "booking_reminder_changed" } as const;
  if (!row.memberId || !row.oppId || row.kind !== "transactional") return refused;
  const [meeting] = await tx<{ meeting_at: Date | null; revision: number; lane: string | null }[]>`select opp.meeting_at,
    coalesce(schedule."scheduleRevision",0) as revision,schedule.lane from network.messages msg
    join network.opportunities opp on opp.app_id=msg.app_id and opp.id=msg.opportunity_id
    join network.participations seat on seat.app_id=msg.app_id and seat.opportunity_id=opp.id and seat.member_id=msg.member_id
    join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    join lateral jsonb_to_recordset(saved.state->'opps') as schedule(id text,"scheduleRevision" int,lane text,stage text) on schedule.id=opp.id
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId} and msg.opportunity_id=${row.oppId}
      and msg.direction='outbound' and msg.type='reminder' and msg.body=${row.text} and opp.state='SCHEDULED'
      and seat.role='participant' and seat.status='confirmed' and schedule.stage='scheduled'`;
  if (!meeting?.meeting_at) return refused;
  const start = meeting.meeting_at.getTime();
  const current = row.id === bookedReminderKey(kind, row.oppId, row.memberId, meeting.revision)
    && bookedReminderWindow(kind, now, start);
  const receipt = current ? await currentBookingReceipt(tx, row.app, row.oppId, row.memberId, meeting.revision, meeting.lane) : undefined;
  const status = receipt?.status;
  const accepted = !!receipt && receivedBookingNotice(receipt, now);
  const pending = status !== undefined && (WAITING.includes(status) || ["collected", "send_unknown", "parked_leak_review"].includes(status));
  switch (queuedReminderClaim(current, accepted, pending)) {
    case "SendReminder": return { ok: true };
    case "WaitForBookingNotice": {
      const cutoff = start - (kind === "day-before-reminder" ? dayBeforeReminderEndMs : 0);
      return { ok: false, reason: "booking_notice_pending", retryAt: Math.min(now + bookingNoticeRetryMs, cutoff) };
    }
    default: return refused;
  }
}

/** spec/meetingSettlement.md, "Send feedback requests during the open attendance period" */
async function meetingFeedbackAdmission(tx: SQL, row: QueueRow, runtimeId: string, now: number): Promise<ClaimCheck> {
  const refused = { ok: false, reason: "meeting_feedback_changed" } as const;
  if (!row.memberId || !row.oppId || row.kind !== "transactional") return refused;
  const [meeting] = await tx<{ meeting_at: Date | null; revision: number; lane: string | null; open: boolean; accepted: boolean }[]>`select
      opp.meeting_at,coalesce(schedule."scheduleRevision",0) as revision,schedule.lane,
      (opp.state='COMPLETED' and schedule.stage='done' and not coalesce(schedule.finalized,false)
        and not coalesce(schedule."feedbackFrom" ? ${row.memberId},false)) as open,
      (seat.role='participant' and seat.status='attended') as accepted
    from network.messages msg
    join network.opportunities opp on opp.app_id=msg.app_id and opp.id=msg.opportunity_id
    join network.participations seat on seat.app_id=msg.app_id and seat.opportunity_id=opp.id and seat.member_id=msg.member_id
    join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    join lateral jsonb_to_recordset(saved.state->'opps') as schedule(id text,"scheduleRevision" int,lane text,stage text,
      finalized boolean,"feedbackFrom" jsonb) on schedule.id=opp.id
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId} and msg.opportunity_id=${row.oppId}
      and msg.direction='outbound' and msg.type='feedback_request' and msg.body=${row.text}`;
  if (!meeting?.meeting_at) return refused;
  const start = meeting.meeting_at.getTime();
  const elapsed = now - start;
  const exact = row.id === meetingFeedbackKey(row.oppId, row.memberId, meeting.revision);
  const receipt = meeting.open && meeting.accepted && exact && meetingFeedbackWindow(elapsed)
    ? await currentBookingReceipt(tx, row.app, row.oppId, row.memberId, meeting.revision, meeting.lane) : undefined;
  switch (queuedMeetingFeedbackClaim(meeting.open, meeting.accepted, exact, elapsed,
    !!receipt && receivedBookingNotice(receipt, now), !!receipt && bookingNoticeReceiptMayArrive(receipt.status))) {
    case "SendMeetingFeedback": return { ok: true };
    case "WaitForMeetingBookingReceipt":
      return { ok: false, reason: "booking_notice_pending", retryAt: Math.min(now + bookingNoticeRetryMs, start + settlementDelayMs) };
    default: return refused;
  }
}

type QueuedProbe = Parameters<typeof effectiveParticipation>[0] & {
  type: string | null;
  category: string | null;
  prefs: { categoriesOptIn?: unknown; romanceOptIn?: unknown } | null;
};

/** Called after the queue locks the member row that owns these settings. */
async function probeAdmission(tx: SQL, row: QueueRow, rt: NetworkRuntime, now: number): Promise<RecipientCheck> {
  if (row.kind !== "proactive" || !row.memberId) return { ok: true };
  const [probe] = await tx<QueuedProbe[]>`select msg.type,opp.category,member.prefs,member.participation_state,member.participation_window,member.opted_out
    from network.messages msg join network.members member on member.app_id=msg.app_id and member.id=msg.member_id
    left join network.opportunities opp on opp.app_id=msg.app_id and opp.id=msg.opportunity_id and opp.id=${row.oppId ?? null}
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId} and msg.direction='outbound'`;
  if (probe?.type !== "probe" && probe?.type !== "plan_probe") return { ok: true };
  const paused = effectiveParticipation(probe, now).state === "paused";
  const categories = probe.prefs?.categoriesOptIn;
  const categoryAllowed = probe.category !== null && Array.isArray(categories) && categories.includes(probe.category)
    && (probe.category !== "romance" || probe.prefs?.romanceOptIn === true);
  if (queuedProbePolicy(true, paused, categoryAllowed) !== "Proceed") return { ok: false, reason: "matching_settings_changed" };
  if (probe.type !== "plan_probe") return { ok: true };

  // lockPeerOpportunityContact already shares the exact runtime row against
  // updates to either the plan or the recipient's check-in state.
  const [current] = await tx<{
    stage: string | null; review_decision: string | null; review_invalidated: string | null;
    pending_seat: boolean | null; probe_deadline: number | null;
    activity_window: plans.StatedWindows["windows"][number] | null; stated: plans.StatedWindows | null;
  }[]>`select plan.stage, plan.review->>'decision' as review_decision, plan.review->'invalidated' as review_invalidated,
      plan."planRun"->'answers'->>${row.memberId}::text='pending' as pending_seat,
      (plan.plan->>'probeDeadline')::double precision as probe_deadline, plan.plan->'window' as activity_window, member.stated
    from network.network_state saved
    join lateral jsonb_to_recordset(saved.state->'opps') as plan(id text,stage text,review jsonb,"planRun" jsonb,plan jsonb) on plan.id=${row.oppId ?? null}
    join lateral jsonb_to_recordset(saved.state->'members') as member(id text,stated jsonb) on member.id=${row.memberId}
    where saved.app_id=${row.app} and saved.id=${rt.pg.id}`;
  if (!current?.stage || !current.activity_window || current.probe_deadline === null) return { ok: false, reason: "plan_probe_changed" };
  const laneOpen = rt.net.planProbeWindowOpen(current.stage, { window: current.activity_window, probeDeadline: current.probe_deadline }, now);
  if (!queuedPlanProbeAllowed(current.review_decision === "approve" && !current.review_invalidated, current.pending_seat === true, laneOpen)) {
    return { ok: false, reason: "plan_probe_changed" };
  }
  return plans.planWindowMatchesStated(current.stated ?? undefined, current.activity_window, now)
    ? { ok: true } : { ok: false, reason: "plan_availability_changed" };
}

/** Recheck the reviewed replacement and its still-pending probe under the runtime state lock. */
async function replacementProbeAdmission(tx: SQL, row: QueueRow, rt: NetworkRuntime, now: number): Promise<RecipientCheck> {
  const refused: RecipientCheck = { ok: false, reason: "replacement_changed" };
  if (row.kind !== "proactive" || !row.oppId || !row.memberId || row.id !== replacementProbeKey(row.oppId, row.memberId)) return refused;
  const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state saved
    join network.messages msg on msg.app_id=saved.app_id and msg.id=${row.id}
    where saved.app_id=${row.app} and saved.id=${rt.pg.id} and msg.opportunity_id=${row.oppId} and msg.member_id=${row.memberId}
      and msg.type='plan_probe' and msg.direction='outbound' and msg.body=${row.text}`;
  const replacement = saved?.state.opps.find(o => o.id === row.oppId);
  if (!replacement?.replacementFor || !replacement.plan) return refused;
  const source = saved?.state.opps.find(o => o.id === replacement.replacementFor);
  const sourceClosed = source?.stage === "closed" && source.closedFrom === "scheduled" && source.closedReason === "participant dropped";
  const run = replacement.planRun;
  const pending = replacement.stage === "probing" && replacement.review?.decision === "approve" && !replacement.review.invalidated
    && run?.stage === "probing" && replacement.participants.includes(row.memberId) && run.answers[row.memberId] === "pending"
    && replacement.participants.every(id => run.answers[id] === "pending" || run.answers[id] === "yes");
  if (!recoveryPlanCanProceed(sourceClosed, pending, now < replacement.plan.probeDeadline)) return refused;
  return probeAdmission(tx, row, rt, now);
}

/** One message the Network sent in a unit of work. `id` is the Network's idempotency key and the network.messages id. */
export interface Outbound {
  id: string;
  memberId: MemberId;
  /** The member's address (E.164 or Apple ID email) from the address book; undefined when there is none. */
  to?: string;
  body: string;
  /** HTTPS links to attachments (a photo). */
  mediaUrls?: string[];
  approvedPhotos?: ApprovedRelayPhoto[];
  invitationJoins?: readonly MemberId[];
  bookingRoster?: readonly MemberId[];
  /** reply: an answer to the member's own message; compliance: STOP/HELP confirmations; proactive; transactional: everything else. */
  kind: MessageKind;
  type?: string;
  oppId?: string;
  proactive: boolean;
  system: boolean;
  ts: number;
  acceptedAt?: number;
}

/** Statuses that still wait for delivery (the queue's, and "queued" before the first drain). */
export const WAITING_STATUSES = ["queued", ...WAITING];

/** A message's delivery status now (network.messages.status). `app`: the app of the row (a receipt can be any app's). */
export interface Delivery { id: string; status: string; app?: string; memberId?: string }

export interface ChannelAdapter {
  readonly name: "dry_run" | "blooio" | "eliza_cloud";
  /** The status a send is stored with, in the same transaction as the Network state. */
  readonly storedStatus: string;
  /** Called once by the runtime that owns the adapter (the persisted queue needs its database and checks). */
  attach?(rt: NetworkRuntime): void;
  /**
   * A persisted adapter writes the unit's sends in the save transaction. Returns the status of each send
   * it did not queue (refused, no address). `forgotten`: members the unit forgets (their decline still goes).
   */
  enqueue?(tx: SQL, msgs: Outbound[], forgotten: ReadonlySet<MemberId>): Promise<Map<string, string>>;
  /** Deliver: a dry run returns the statuses of `msgs`; a persisted adapter drains its queue (msgs are already stored). */
  deliver(msgs: Outbound[]): Promise<Delivery[]>;
  /** Retry what waits (quiet hours, held until the member writes back). The service calls it on every tick. Returns changed statuses. */
  flush(): Promise<Delivery[]>;
  /** After a restart: rows a stopped worker held go back to the queue (sent again with the same provider key). */
  recover?(): Promise<number>;
  /** The person wrote (a message or a tapback) on the line: the streak resets and held messages can go. */
  engaged?(address: string): Promise<void>;
  /** A delivery receipt from the provider (any app on the line). */
  status?(u: StatusUpdate): Promise<Delivery | undefined>;
  /** Retention of the line's counters (addresses that are nobody's phone, idle for a day). */
  purge?(): Promise<number>;
  /** A line safety change from the provider. */
  lineSafety?(action: string | undefined, eventType?: string): Promise<void>;
  /**
   * A fixed text to someone who is not a member of this app (the invite-only reply, the join question,
   * an under-age decline, a keyword confirmation). The queue keeps the address and text only until the
   * row ends; the log line has no text. `kind`: "compliance" only for a STOP, HELP, START or leave
   * confirmation and the under-age decline (it skips the opt-out, quiet hours and the caps); "reply" for an answer to the person's
   * own message; "transactional" for a text the Network starts (a staff invite). See README "Direct texts".
   */
  direct(to: string, body: string, id: string, kind: DirectKind): Promise<string>;
}

/** The kinds of a direct text (never "proactive": a direct text is not an introduction or a probe). */
export type DirectKind = Exclude<MessageKind, "proactive">;

/** The app's own live flag: NTWRK_LIVE_APPROVED, SLOP_LIVE_APPROVED, ... */
export const liveFlag = (app: string) => `${app.toUpperCase()}_LIVE_APPROVED`;

/**
 * Live sends need BLOOIO_ALLOW_SEND=1 and NTWRK_LIVE_APPROVED=1 (the founder's approval), and for an
 * app other than ntwrk its own <APP>_LIVE_APPROVED=1 too.
 */
export function liveSendAllowed(env: Record<string, string | undefined> = process.env, app = "ntwrk"): boolean {
  return env.BLOOIO_ALLOW_SEND === "1" && env.NTWRK_LIVE_APPROVED === "1" && env[liveFlag(app)] === "1";
}

/** Nothing leaves the machine. The service stores every send with status "dry_run". */
export class DryRunAdapter implements ChannelAdapter {
  readonly name = "dry_run" as const;
  readonly storedStatus = "dry_run";
  constructor(private log: (line: string) => void = console.log) {}
  async deliver(msgs: Outbound[]): Promise<Delivery[]> {
    // The text is in network.messages; the log line never holds it.
    for (const m of msgs) this.log(`[dry-run] ${m.kind} ${m.type ?? "message"} to ${m.memberId}${m.oppId ? ` (${m.oppId})` : ""}, ${m.body.length} chars, id ${m.id}`);
    return msgs.map(m => ({ id: m.id, status: "dry_run" }));
  }
  async flush(): Promise<Delivery[]> { return []; }
  async direct(_to: string, body: string, id: string, kind: DirectKind): Promise<string> {
    this.log(`[dry-run] direct ${kind} message to a non-member, ${body.length} chars, id ${id}`);
    return "dry_run";
  }
}

/** Opportunity stages after which a waiting message about it is stale. */
const CLOSED_STAGES = new Set(["done", "closed"]);

export interface BlooioAdapterOptions {
  /** The provider (packages/blooio BlooioAdapter over a BlooioClient). The simulations pass a recording fake. */
  provider: ProviderAdapter;
  clock: Clock;
  /** The sending line (BLOOIO_FROM). Required: the queue's counters are per line. */
  from?: string;
  /** The app this adapter sends for (its live flag). Default "ntwrk". */
  app?: string;
  /** The network's city: its zone is the quiet-hours fallback. Default "nyc". */
  city?: string;
  /** Read for the live flags on every send. Default process.env. */
  env?: Record<string, string | undefined>;
  /**
   * Replaces the live flags. Accepted only with a provider whose kind is "sim" (a fake that cannot reach
   * Blooio): the pipeline simulation drives the real queue with it. Any real provider keeps the flags.
   */
  liveGate?: (app: string) => boolean;
  /** Queue limits (the per-line caps come from P3; defaults in outbound-queue.ts). Env: BLOOIO_LINE_DAILY_CAP, BLOOIO_LINE_NEW_CHATS_PER_DAY. */
  limits?: { perLinePerDay?: number; newChatsPerLinePerDay?: number; perRecipientPerHour?: number; baseBackoffMs?: number; leaseMs?: number };
  log?: (line: string) => void;
  /** Accepted for older callers and ignored: the runtime supplies the Network and the address book (attach). */
  net?: unknown;
  memberOf?: unknown;
}

/** Blooio behind the live flags, through the persisted queue (one queue object per app; one line lock for all). */
export class BlooioAdapter implements ChannelAdapter {
  readonly name: ChannelAdapter["name"] = "blooio";
  readonly storedStatus = "queued";
  readonly app: string;
  private readonly env: Record<string, string | undefined>;
  private readonly log: (line: string) => void;
  private readonly city: string;
  private readonly gate?: (app: string) => boolean;
  private q?: OutboundQueue;

  constructor(private readonly o: BlooioAdapterOptions) {
    this.env = o.env ?? process.env;
    this.log = o.log ?? console.log;
    this.app = o.app ?? "ntwrk";
    this.city = o.city ?? "nyc";
    if (!o.from) throw new Error("the Blooio adapter needs the sending line (BLOOIO_FROM)");
    if (o.liveGate && o.provider.kind !== "sim") throw new Error("liveGate is only for a simulated provider: a real provider always reads the live flags");
    this.gate = o.liveGate;
  }

  get live() { return this.gate ? this.gate(this.app) : liveSendAllowed(this.env, this.app); }
  private get flags() { return ["BLOOIO_ALLOW_SEND=1", "NTWRK_LIVE_APPROVED=1", ...(this.app === "ntwrk" ? [] : [`${liveFlag(this.app)}=1`])].join(", "); }

  /** The queue, after attach(). */
  get queue(): OutboundQueue {
    if (!this.q) throw new Error("BlooioAdapter is not attached to a network runtime");
    return this.q;
  }

  attach(rt: NetworkRuntime) {
    const policy = blooioRecipientPolicy(rt.net, rt.memberOf);
    const leaks = forbiddenProvider(rt.net, to => rt.memberOf(to));
    const num = (k: string) => { const v = Number(this.env[k]); return Number.isFinite(v) && v > 0 ? v : undefined; };
    const checks: AppChecks = {
      live: () => this.live,
      // A relayed item still goes after the date (the thread stays open for a week); a closed match stops it.
      stale: async row => row.id.startsWith("ntf_") ? !await rt.notificationCurrent(row.id)
        : !!row.oppId && (row.id.startsWith("relay:") ? (rt.net.opps.get(row.oppId)?.stage ?? "closed") === "closed"
          : closedOpportunityRowStale(CLOSED_STAGES.has(rt.net.opps.get(row.oppId)?.stage ?? ""),
            terminalNotice(row) !== undefined || row.id.startsWith(meetingFeedbackPrefix))),
      optedOut: row => rt.optedOut(row.id, row.memberId as MemberId | undefined, row.to),
      privatePayload: row => row.id.startsWith(EXPECTED_INVITATION_PREFIX),
      // A direct text to someone who is not a member of this app (no member on the row, none at the address)
      // is fixed copy: the member policy has nobody to check. Consent, quiet hours, caps and the leak guard still apply.
      recipient: (row, agentInitiated) => {
        if (row.id.startsWith(lateArrivalDeliveryPrefix)) {
          const notice = parseLateArrivalDeliveryId(row.id);
          return notice && notice.app === row.app && row.memberId === notice.to && rt.memberOf(row.to) === notice.to
            ? rt.net.recipientPolicy(notice.to, "relay", { about: [notice.from] })
            : { ok: false, reason: "group_late_arrival_changed" };
        }
        if (row.id.startsWith(reengagementDeliveryPrefix)) {
          return row.memberId && rt.memberOf(row.to) === row.memberId
            ? rt.net.recipientPolicy(row.memberId, "reengage", { proactive: true })
            : { ok: false, reason: "reengagement_changed" };
        }
        return !row.memberId && !rt.memberOf(row.to) ? { ok: true }
          : policy(row.to, { kind: row.kind, ...(row.oppId && !terminalNotice(row) ? { briefId: row.oppId } : {}), agentInitiated });
      },
      // A relayed item may carry its sender's own private facts, as the Network's guard allows (guardCheck
      // relayFrom): the queue excludes the sender's facts too, so it never parks what the Network passed.
      // Allow only this row's mutually approved number or its exact public booking link.
      leaks: async row => {
        const sender = rt.net.relaySenderOf(row.id), recipient = (row.memberId as MemberId | undefined) ?? rt.memberOf(row.to);
        const base = sender && recipient ? rt.net.leakSources([recipient], [sender]) : leaks(row.to);
        const digestLink = row.id.startsWith("ntf_") ? await rt.notificationHandoffUrl(row.id, row.text) : undefined;
        if (digestLink) return { ...base, contactAllow: [digestLink] };
        const inviteLink = row.id.startsWith(EXPECTED_INVITATION_PREFIX) && row.text.split("\n")[1];
        if (inviteLink && isMemberInvitationLink(rt.app, inviteLink)) return { ...base, contactAllow: [inviteLink] };
        const from = rt.net.relayContactShareFrom(row.id), number = from && rt.addressOf(from);
        const bookingLink = row.kind === "reply" || row.kind === "transactional"
          ? rt.net.approvedBookingLink(row.oppId, recipient, row.text, row.id) : undefined;
        return number ? { ...base, allow: [number] }
          : bookingLink ? { ...base, contactAllow: [bookingLink] } : base;
      },
      // PgStore.save locks the state before erasing members. Dispatch takes the
      // same order, then the existing admit check revalidates current parties.
      lockAdmission: async (row, tx) => {
        if (row.app === "slop" && row.oppId) await rt.lockSlopPairAdmission(tx, row);
        if (row.oppId) await lockPublicEventContact(tx, row, rt.pg.id);
        if (row.id.startsWith(monthlyGatheringInvitePrefix)) await lockGatheringAdmission(tx, rt.app.id, rt.pg.id, row);
        if (row.id.startsWith(monthlyGatheringNoticePrefix)) await lockGatheringNoticeAdmission(tx, rt.app.id, rt.pg.id, row);
        if (row.oppId?.startsWith(gatheringRepeatOppPrefix)) await rt.lockGatheringRepeatClaim(tx, row.oppId);
        if (row.id.startsWith(RESCHEDULE_QUEUE_PREFIX) || row.id.startsWith(interruptionFeedbackPrefix)
          || row.id.startsWith(reengagementDeliveryPrefix) || row.id.startsWith(replacementProbePrefix) || row.id.startsWith(meetingFeedbackPrefix)) {
          await tx`select id from network.network_state where id=${rt.pg.id} for share`;
        }
        if (row.id.startsWith(lateArrivalDeliveryPrefix)) await tx`select id from network.network_state where id=${rt.pg.id} for share`;
        if (row.id.startsWith("relay:") || row.id.startsWith("invite-notice:") || row.id.startsWith(EXPECTED_INVITATION_PREFIX) || row.id.startsWith(cofounderDeliveryIdPrefix)
          || bookedReminderKind(row.id) || terminalNotice(row) === "booking") {
          await tx`select id from network.network_state where id=${rt.pg.id} for share`;
        }
        if (row.id.startsWith("home-help-consent:")) await rt.lockHomeHelpConsentAdmission(tx, row.id, row.memberId);
        if (row.oppId && row.memberId) await lockPeerOpportunityContact(tx, row.app, rt.pg.id, row.memberId, row.id);
      },
      // A relayed item: its match and both members are read again inside the admission transaction (runtime.ts).
      admit: async (row, tx) => {
        if (row.approvedPhotos?.length && this.name !== "eliza_cloud") return { ok: false, reason: "approved_photos_require_cloud" };
        if (row.id.startsWith("ntf_")) {
          return await rt.notificationClaimCurrent(tx, row) ? { ok: true } : { ok: false, reason: "notification_obsolete" };
        }
        if (row.app === "slop" && row.oppId) {
          const authority = await rt.slopPairAdmission(tx, row);
          if (!authority.ok) return authority;
        }
        if (row.app === "peon" && row.oppId) {
          const authority = await rt.peonHireAdmission(tx, row);
          if (!authority.ok) return authority;
        }
        if (row.id.startsWith(monthlyGatheringInvitePrefix)) return rt.gatheringInvitationAdmission(tx, row);
        if (row.id.startsWith(monthlyGatheringNoticePrefix)) return rt.gatheringNoticeAdmission(tx, row);
        if (row.oppId?.startsWith(gatheringRepeatOppPrefix) && !await rt.gatheringRepeatClaim(tx, row)) return { ok: false, reason: "gathering_repeat_changed" };
        if (row.oppId) {
          const event = await publicEventContactAdmission(tx, row, rt.pg.id, rt.city, this.o.clock.now());
          if (!event.ok) return event;
        }
        if (row.oppId && row.memberId && await peerOpportunityContactRestricted(tx, row.app, row.memberId, [row.id])) {
          return { ok: false, reason: "opportunity_roster_blocked" };
        }
        if ((row.oppId || venueBookingNoticeBase(row.id)) && await originalBookingNoticeStale(tx, row.app, rt.pg.id, [row.id], this.o.clock, row)) return { ok: false, reason: "booking_changed" };
        if (row.id.startsWith(RESCHEDULE_QUEUE_PREFIX)) return rescheduleAdmission(tx, row, rt.pg.id, this.o.clock.now());
        if (row.id.startsWith(interruptionFeedbackPrefix)) return interruptionSurveyAdmission(tx, row, rt.pg.id, this.o.clock.now());
        if (row.id.startsWith(reengagementDeliveryPrefix)) return reengagementAdmission(tx, row, rt.pg.id, this.o.clock.now());
        if (row.id.startsWith(replacementProbePrefix)) return replacementProbeAdmission(tx, row, rt, this.o.clock.now());
        if (row.id.startsWith("relay:")) return rt.relayAdmission(tx, row);
        if (row.id.startsWith(lateArrivalDeliveryPrefix)) return rt.groupLateArrivalAdmission(tx, row);
        if (row.id.startsWith(cofounderDeliveryIdPrefix)) {
          const authority = await rt.cofounderAdmission(tx, row);
          const prefix = `${cofounderDeliveryIdPrefix}reveal:`;
          if (!authority.ok || !row.id.startsWith(`${prefix}${RESCHEDULE_QUEUE_PREFIX}`)) return authority;
          return rescheduleAdmission(tx, { ...row, id: row.id.slice(prefix.length) }, rt.pg.id, this.o.clock.now());
        }
        if (row.id.startsWith("invite-notice:")) return await rt.invitationNoticeAdmission(tx, row.id, row.memberId)
          ? { ok: true } : { ok: false, reason: "invitation_notice_changed" };
        if (row.id.startsWith("home-help-consent:")) return await rt.homeHelpConsentAdmission(tx, row)
          ? { ok: true } : { ok: false, reason: "home_help_consent_changed" };
        if (row.id.startsWith(EXPECTED_INVITATION_PREFIX)) return !row.memberId && row.kind === "transactional" && await rt.expectedInvitationAdmission(tx, row)
          ? { ok: true } : { ok: false, reason: "expected_invitation_changed" };
        const notice = terminalNotice(row);
        if (notice) return releaseAdmission(tx, row, notice, rt.pg.id, this.o.clock.now());
        if (row.id.startsWith(bookedCancellationPrefix)) return { ok: false, reason: "opportunity_release_changed" };
        const reminder = bookedReminderKind(row.id);
        if (reminder) return bookedReminderAdmission(tx, row, reminder, rt.pg.id, this.o.clock.now());
        if (row.id.startsWith(meetingFeedbackPrefix)) return meetingFeedbackAdmission(tx, row, rt.pg.id, this.o.clock.now());
        return probeAdmission(tx, row, rt, this.o.clock.now());
      },
      claimed: async (row, tx) => {
        if (row.id.startsWith(EXPECTED_INVITATION_PREFIX)) await rt.expectedInvitationClaimed(tx, row);
      },
      capTake: row => rt.capTake(row.id, row.memberId as MemberId),
      capRelease: row => rt.capRelease(row.id),
    };
    this.q = new OutboundQueue({
      sql: rt.db, clock: this.o.clock, provider: this.o.provider, line: this.o.from!, app: this.app, checks, instance: rt.instance,
      perLinePerDay: num("BLOOIO_LINE_DAILY_CAP"), newChatsPerLinePerDay: num("BLOOIO_LINE_NEW_CHATS_PER_DAY"), ...this.o.limits, leakAllow: OWN_DOMAINS,
      onAlert: (id, why) => this.log(`[blooio] alert ${why} on ${id} (${this.app})`),
    });
  }

  async enqueue(tx: SQL, msgs: Outbound[], forgotten: ReadonlySet<MemberId>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.live) {
      if (msgs.length) this.log(`[blooio] refused ${msgs.length} send(s): live sending needs ${this.flags}`);
      for (const m of msgs) out.set(m.id, "refused_not_approved");
      return out;
    }
    const go = msgs.filter(m => {
      if (m.approvedPhotos?.length && this.name !== "eliza_cloud") { out.set(m.id, "refused_photo_transport"); return false; }
      return m.to ? true : (out.set(m.id, "failed_no_address"), false);
    });
    await this.queue.enqueue(tx, go.map(m => ({
      // A member the unit forgets gets the one decline as a text to a non-member: nothing about them is kept.
      id: m.id, ...(forgotten.has(m.memberId) ? {} : { memberId: m.memberId }), to: m.to!, kind: m.kind, text: m.body,
      ...(m.mediaUrls?.length ? { mediaUrls: m.mediaUrls } : {}), ...(m.approvedPhotos?.length ? { approvedPhotos: m.approvedPhotos } : {}), ...(m.oppId ? { oppId: m.oppId } : {}), city: this.city,
    })));
    return out;
  }

  async deliver(_msgs: Outbound[]): Promise<Delivery[]> { return this.queue.drain(); }
  async flush(): Promise<Delivery[]> { return []; }
  recover() { return this.queue.recover(); }

  async direct(to: string, body: string, id: string, kind: DirectKind): Promise<string> {
    if (!this.live) { this.log(`[blooio] refused a direct send: live sending needs ${this.flags}`); return "refused_not_approved"; }
    await this.queue.enqueue(this.queue.sql, [{ id, to, kind, text: body, city: this.city }]);
    await this.queue.drain();
    return (await this.queue.statusOf(id)) ?? "failed";
  }

  async engaged(address: string) { await this.queue.inbound(address); }
  purge() { return this.queue.purge(); }
  status(u: StatusUpdate): Promise<Delivery | undefined> { return this.queue.applyStatus(u); }
  lineSafety(action: string | undefined, eventType?: string) { return this.queue.setLineSafety(action, eventType); }
}
