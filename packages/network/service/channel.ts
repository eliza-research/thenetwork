import type { SQL } from "../../core/src/runtime/postgres.ts";
import { DAY, isBusinessDomain, isCity, isDatingDomain, isFriendshipDomain, type City, type MemberId, type Presence, type TimeOption, type WorkIntroState } from "@thenetwork/core";
import { plans } from "@thenetwork/engine";
import { blooioRecipientPolicy, bookedReminderKey, bookedReminderKind, bookedReminderWindow, forbiddenProvider, gatheringRepeatOppPrefix, meetingFeedbackKey, presentFor, replacementProbeKey, replacementProbePrefix, reviewApproved, storedInterruptionSurveyCurrent, type BookedReminderKind, type NetworkState, type StoredReview } from "../src/network.ts";
import { interruptionFeedbackPrefix } from "../src/interruption-feedback.ts";
import { canBeMatched } from "../../core/src/policy.ts";
import { cleanPhrase } from "../../core/src/smsCopy.ts";
import { RESCHEDULE_QUEUE_PREFIX, rescheduleNoticeCurrent, rescheduleUpdateKey, rescheduleUpdatePrefix } from "../src/rescheduling.ts";
import { OutboundQueue, WAITING, type AppChecks, type ClaimCheck, type MessageKind, type QueueRow, type RecipientCheck } from "../../blooio/src/outbound-queue.ts";
import { ChannelSendError, type Clock, type ChannelAdapter as ProviderAdapter, type StatusUpdate } from "../../blooio/src/types.ts";
import type { NetworkRuntime } from "./runtime.ts";
import { APPS } from "../../platform/src/apps.ts";
import { isMemberInvitationLink } from "../src/invitation.ts";
import { EXPECTED_INVITATION_PREFIX } from "./expected-invitation-store.ts";
import { cofounderDeliveryIdPrefix } from "../../core/src/generated/cofounderDispatch.ts";
import { bookingNoticeRosterCurrent, originalBookingNoticeCurrent } from "../../core/src/generated/meetingReschedule.ts";
import { bookingNoticePending, bookingNoticeReceived, bookingNoticeReceiptMayArrive, bookingNoticeRetryMs, dayBeforeReminderEndMs, meetingFeedbackPrefix, meetingFeedbackWindow, queuedBookingCancellationClaim, queuedMeetingFeedbackClaim, queuedReminderClaim, settlementDelayMs } from "../../core/src/generated/meetingSettlement.ts";
import { lateArrivalDeliveryPrefix } from "../../core/src/generated/groupLateArrival.ts";
import { parseLateArrivalDeliveryId } from "../src/group-late-arrival.ts";
import { bookedCancellationAllowed, bookedCancellationPrefix, closedOpportunityRowStale, queuedProbePolicy } from "../../core/src/generated/outboundAdmission.ts";
import { engineQuestionDeliveryPrefix, queuedEngineQuestionAllowed } from "../../core/src/generated/engineAsks.ts";
import { friendPlanProbeDeliveryPrefix } from "../../core/src/generated/friendsPlanTimeChoice.ts";
import { queuedPlanProbeAllowed } from "../../core/src/generated/planDispatch.ts";
import { queuedProbeRosterAdmission } from "./probe-roster-admission.ts";
import { probeAvailability } from "../../core/src/generated/probeDispatch.ts";
import { reengagementDeliveryPrefix, reengagementMayDispatch } from "../../core/src/generated/outreachPolicy.ts";
import { recoveryPlanCanProceed } from "../../core/src/generated/bookedGroupReplacement.ts";
import { effectiveParticipation, presenceOf } from "./snapshot.ts";
import { lockGatheringAdmission, monthlyGatheringInvitePrefix } from "./monthly-gathering-delivery.ts";
import { lockGatheringNoticeAdmission, monthlyGatheringNoticePrefix } from "./monthly-gathering-notices.ts";
import { lockPublicEventContact, publicEventContactAdmission } from "./public-event-admission.ts";
import { lockPeerOpportunityContact, peerOpportunityContactRestricted } from "./peer-opportunity-admission.ts";
import { approvedVenueBookingLink, venueBookingNoticeBase, venueBookingNoticeKey } from "../src/venue-booking-link.ts";
import { friendsPlanOfferedWindows, friendsPlanProbeDeliveryKey, friendsPlanTimeOptions } from "../src/friends-plan-time-choice.ts";
import { NY } from "../src/outreach.ts";

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

/** A queued venue-swap notice goes out only while the seat and the named venue are current. */
async function venueSwapNoticeAdmission(tx: SQL, row: QueueRow, runtimeId: string): Promise<RecipientCheck> {
  const refused = { ok: false, reason: "venue_swap_changed" } as const;
  if (row.kind !== "transactional" || !row.memberId || !row.oppId) return { ok: true };
  const named = /^(?:.*?\s)?Quick tweak for .+: let's do (.+) instead\. Still works for you\?$/.exec(row.text);
  if (!named) return { ok: true };
  const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where app_id=${row.app} and id=${runtimeId}`;
  const opp = saved?.state.opps.find(o => o.id === row.oppId);
  if (!opp || opp.stage !== "scheduled" || !opp.venue) return refused;
  if (new Map(opp.status).get(row.memberId) !== "yes") return refused;
  const name = cleanPhrase(opp.venue);
  const withArea = opp.venueArea ? `${name} (${cleanPhrase(opp.venueArea)})` : name;
  return named[1] === name || named[1] === withArea ? { ok: true } : refused;
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
    work_intro: WorkIntroState | null;
    group_booking: boolean | null; roster_recorded: boolean; roster_includes_recipient: boolean | null; roster_accepted: boolean;
  }[]>`select opp.meeting_at,
    booking."workIntro" as work_intro,
    (booking.id is not null and opp.state='SCHEDULED') as scheduled,
    (seat.role='participant' and seat.status='confirmed') as confirmed,booking."scheduleRevision" as revision,
    opp.kind='group' as group_booking,msg.booking_roster_member_ids is not null as roster_recorded,
    msg.member_id=any(msg.booking_roster_member_ids) as roster_includes_recipient,
    not exists (select 1 from unnest(msg.booking_roster_member_ids) named(member_id) where not exists (
      select 1 from network.participations current_seat
      join lateral jsonb_array_elements(booking.status) accepted(seat)
        on accepted.seat->>0=current_seat.member_id and accepted.seat->>1='yes'
      where current_seat.app_id=msg.app_id and current_seat.opportunity_id=msg.opportunity_id
        and current_seat.member_id=named.member_id and current_seat.role='participant'
        and current_seat.status in ('pending','confirmed')
    )) as roster_accepted
    from network.messages msg
    left join network.opportunities opp on opp.app_id=msg.app_id and opp.id=msg.opportunity_id
    left join network.participations seat on seat.app_id=msg.app_id and seat.opportunity_id=msg.opportunity_id and seat.member_id=msg.member_id
    left join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    left join lateral jsonb_to_recordset(saved.state->'opps') as booking(id text,"scheduleRevision" int,status jsonb,"workIntro" jsonb) on booking.id=msg.opportunity_id
    where msg.app_id=${app} and msg.id in ${tx(ids)} and msg.direction='outbound' and msg.type='proposal' and msg.opportunity_id is not null`;
  const now = clock.now();
  return rows.some(row => {
    const deadlineAt = row.work_intro
      ? (row.work_intro.videoSlotAt ?? row.work_intro.followupDueAt ?? (row.meeting_at?.getTime() ?? now) + 7 * DAY)
      : (row.meeting_at?.getTime() ?? now);
    return !originalBookingNoticeCurrent(row.scheduled === true, row.confirmed === true,
      (row.revision ?? 0) === 0, deadlineAt - now)
      || !bookingNoticeRosterCurrent(row.group_booking === true, row.roster_recorded, row.roster_includes_recipient === true, row.roster_accepted);
  })
    || !await venueBookingNoticesCurrent(tx, app, runtimeId, ids, now, queued);
}

function terminalNotice(row: QueueRow): TerminalNotice | undefined {
  if (!row.oppId || !row.memberId || (row.kind !== "transactional" && row.kind !== "reply")) return;
  const key = `${row.oppId}:${row.memberId}`;
  if (row.id === `opportunity-release:${key}`) return "acceptance";
  if (row.kind === "transactional" && row.id === `${bookedCancellationPrefix}${key}`) return "booking";
}

type BookingReceipt = { status: string; sent_at: Date | null; gateway_reply: boolean };

function receivedBookingNotice(receipt: BookingReceipt, now: number): boolean {
  return bookingNoticeReceived(receipt.status, receipt.sent_at?.getTime() ?? -1, now);
}

type BookingReceiptRequest = { oppId: string; memberId: MemberId; revision: number; lane: string | null };

export async function currentBookingReceipts(tx: SQL, app: string, bookings: readonly BookingReceiptRequest[]): Promise<Map<number, BookingReceipt | undefined>> {
  const expected = bookings.map(({ oppId, memberId, revision, lane }, idx) => {
    const key = rescheduleUpdateKey(oppId, revision, memberId);
    return { idx, opp_id: oppId, member_id: memberId, kind: revision === 0 ? "proposal" : "scheduling",
      notice_id: revision === 0 ? null : lane === "Cofounder" ? `${cofounderDeliveryIdPrefix}reveal:${key}` : key };
  });
  const notices = await tx<(BookingReceipt & { idx: number })[]>`select expected.idx, exact.status, exact.sent_at, exact.gateway_reply
    from jsonb_to_recordset(${expected}::jsonb) as expected(idx int,opp_id text,member_id text,kind text,notice_id text)
    cross join lateral (
      select receipt.status,receipt.sent_at,notice.inbound_id is not null as gateway_reply from network.messages notice
      join platform.outbound receipt on receipt.app_id=notice.app_id and receipt.id=notice.id and receipt.member_id=notice.member_id
      where notice.app_id=${app} and notice.opportunity_id=expected.opp_id and notice.member_id=expected.member_id
        and notice.direction='outbound' and notice.type=expected.kind and (expected.notice_id is null or notice.id=expected.notice_id)
      order by notice.id limit 2 for share of receipt
    ) as exact`;
  const receipts = new Map<number, BookingReceipt | undefined>();
  for (const notice of notices) receipts.set(notice.idx, receipts.has(notice.idx) ? undefined : notice);
  return receipts;
}

export async function currentBookingReceipt(tx: SQL, app: string, oppId: string, memberId: MemberId,
  revision: number, lane: string | null): Promise<BookingReceipt | undefined> {
  return (await currentBookingReceipts(tx, app, [{ oppId, memberId, revision, lane }])).get(0);
}

async function cancellationBookingReceipts(tx: SQL, app: string, oppId: string, memberId: string,
  revision: number, lane: string | null): Promise<BookingReceipt[]> {
  const deliveryPrefix = lane === "Cofounder" ? `${cofounderDeliveryIdPrefix}reveal:` : "";
  const prefix = `${deliveryPrefix}${rescheduleUpdatePrefix(oppId)}`;
  const suffix = `:${memberId}`;
  const notices = await tx<(BookingReceipt & { id: string; type: string })[]>`select notice.id,notice.type,receipt.status,receipt.sent_at,
    notice.inbound_id is not null as gateway_reply
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
    receipts.some(receipt => bookingNoticeReceiptMayArrive(receipt.status, receipt.gateway_reply)))) {
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
  switch (queuedReminderClaim(current, !!receipt && receivedBookingNotice(receipt, now),
    !!receipt && bookingNoticePending(receipt.status, receipt.gateway_reply))) {
    case "SendReminder": return { ok: true };
    case "WaitForBookingNotice": {
      const cutoff = start - (kind === "day-before-reminder" ? dayBeforeReminderEndMs : 0);
      return { ok: false, reason: "booking_notice_pending", retryAt: Math.min(now + bookingNoticeRetryMs, cutoff) };
    }
    default: return refused;
  }
}

async function meetingFeedbackAdmission(tx: SQL, row: QueueRow, runtimeId: string, now: number): Promise<ClaimCheck> {
  const refused = { ok: false, reason: "meeting_feedback_changed" } as const;
  if (!row.memberId || !row.oppId || row.kind !== "transactional") return refused;
  // An accepted seat can receive a prompt while attendance is still open.
  // The console records attendance only after settlement.
  const [meeting] = await tx<{ meeting_at: Date | null; revision: number; lane: string | null; open: boolean; accepted: boolean }[]>`select
      opp.meeting_at,coalesce(schedule."scheduleRevision",0) as revision,schedule.lane,
      (opp.state='COMPLETED' and schedule.stage='done' and not coalesce(schedule.finalized,false)
        and not coalesce(schedule."feedbackFrom" ? ${row.memberId},false)) as open,
      (seat.role='participant' and coalesce(schedule.status @> jsonb_build_array(jsonb_build_array(msg.member_id,'yes'::text)),false)) as accepted
    from network.messages msg
    join network.opportunities opp on opp.app_id=msg.app_id and opp.id=msg.opportunity_id
    join network.participations seat on seat.app_id=msg.app_id and seat.opportunity_id=opp.id and seat.member_id=msg.member_id
    join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    join lateral jsonb_to_recordset(saved.state->'opps') as schedule(id text,"scheduleRevision" int,lane text,stage text,
      finalized boolean,"feedbackFrom" jsonb,status jsonb) on schedule.id=opp.id
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId} and msg.opportunity_id=${row.oppId}
      and msg.direction='outbound' and msg.type='feedback_request' and msg.body=${row.text}`;
  if (!meeting?.meeting_at) return refused;
  const start = meeting.meeting_at.getTime();
  const elapsed = now - start;
  const exact = row.id === meetingFeedbackKey(row.oppId, row.memberId, meeting.revision);
  const receipt = meeting.open && meeting.accepted && exact && meetingFeedbackWindow(elapsed)
    ? await currentBookingReceipt(tx, row.app, row.oppId, row.memberId, meeting.revision, meeting.lane) : undefined;
  switch (queuedMeetingFeedbackClaim(meeting.open, meeting.accepted, exact, elapsed,
    !!receipt && receivedBookingNotice(receipt, now), !!receipt && bookingNoticeReceiptMayArrive(receipt.status, receipt.gateway_reply))) {
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
  exact_message: boolean | null;
};

type StoredPlanProbe = {
  stage: string | null; review: StoredReview | null;
  review_revision: number;
  pending_seat: boolean | null; probe_deadline: number | null;
  activity_window: plans.StatedWindows["windows"][number] | null; stated: plans.StatedWindows | null;
  reviewed_offer: boolean; partner: boolean | null; invited: MemberId[] | null;
  reviewed_options: plans.Plan["reviewedOptions"] | null; offered: TimeOption[] | null;
  pending_delivery: boolean | null; peer_id: MemberId | null; peer_stated: plans.StatedWindows | null;
  first_answer: string | null; first_picks: number[] | null; first_offered: TimeOption[] | null;
};

const sameTimeOption = (left: TimeOption, right: TimeOption): boolean =>
  left.key === right.key && left.start === right.start && left.end === right.end && left.label === right.label;

type ClaimPresence = Map<MemberId, { homeCity: City; rows: Presence[] }>;

async function claimPresence(tx: SQL, app: string, memberIds: readonly MemberId[]): Promise<ClaimPresence> {
  const ids = [...new Set(memberIds)];
  const [members, presence] = await Promise.all([
    tx<{ id: string; home_city: string }[]>`select id, home_city from network.members where app_id=${app} and id in ${tx(ids)}`,
    tx`select member_id, city, type, areas, from_at, to_at from network.presence where app_id=${app} and member_id in ${tx(ids)}`,
  ]);
  const out: ClaimPresence = new Map();
  for (const member of members) if (isCity(member.home_city)) out.set(member.id, { homeCity: member.home_city, rows: [] });
  for (const row of presence) out.get(row.member_id)?.rows.push(presenceOf(row));
  return out;
}

function claimPresent(presence: ClaimPresence, id: MemberId, from: number, to: number, city: City): boolean {
  const member = presence.get(id);
  return presentFor(member, member?.rows ?? [], from, to, city);
}

/** A previously rendered offer can only go out with the exact, still-permitted choices. */
function reviewedFriendPlanProbe(current: StoredPlanProbe, row: QueueRow, exactMessage: boolean, now: number, slotPresent: (slot: { end: number }) => boolean): RecipientCheck {
  const refused = { ok: false, reason: "plan_probe_changed" } as const;
  const invited = Array.isArray(current.invited) ? current.invited : [];
  const [first, second] = invited;
  const selected = row.memberId === first ? undefined : Array.isArray(current.first_picks) ? current.first_picks : [];
  const reviewed = current.reviewed_options;
  const offered = current.offered;
  if (!exactMessage || !row.oppId || !row.memberId || row.id !== friendsPlanProbeDeliveryKey(row.oppId, current.review_revision, row.memberId)
    || !isFriendshipDomain(row.app) || current.stage !== "probing" || current.partner !== true
    || invited.length !== 2 || !first || !second || first === second || !current.pending_delivery
    || (row.memberId !== first && row.memberId !== second) || !current.peer_id
    || !Array.isArray(reviewed) || !Array.isArray(offered) || !offered.length) return refused;
  if (selected !== undefined && current.first_answer !== "yes") return refused;
  const picks = selected === undefined ? undefined
    : (Array.isArray(current.first_offered) ? current.first_offered : []).filter(option => selected.includes(option.start));
  const allowed = friendsPlanOfferedWindows(reviewed, picks, slot => slot.start > now
    && plans.planWindowMatchesStated(current.stated ?? undefined, slot, now)
    && plans.planWindowMatchesStated(current.peer_stated ?? undefined, slot, now)
    && slotPresent(slot));
  const currentOptions = friendsPlanTimeOptions(reviewed, allowed, NY);
  let reviewedIndex = -1;
  for (const option of offered) {
    const index = currentOptions.findIndex(candidate => sameTimeOption(candidate, option));
    if (index <= reviewedIndex) return { ok: false, reason: "plan_availability_changed" };
    reviewedIndex = index;
  }
  return { ok: true };
}

/** Recheck the exact engine question under the current runtime and recipient locks. */
async function engineQuestionAdmission(tx: SQL, row: QueueRow, runtimeId: string, now: number): Promise<RecipientCheck> {
  const refused = { ok: false, reason: "engine_question_changed" } as const;
  if (!row.memberId || (row.kind !== "proactive" && row.kind !== "transactional")) return refused;
  const [question] = await tx<(Parameters<typeof effectiveParticipation>[0] & {
    awaited_id: string | null; asked_at: number | null; only_when_asked: boolean | null; age: number | null;
    restricted_age: boolean; held: boolean;
  })[]>`select current.awaiting->>'engineQuestionDeliveryId' as awaited_id, current."openAskAt" as asked_at,
      current."onlyWhenAsked" as only_when_asked, ages.age,
      coalesce(current.minor or current."ageConflict",false) as restricted_age,
      (ages.banned or ages.staff_held or ages.report_held) as held,
      member.participation_state,member.participation_window,member.opted_out
    from network.messages msg
    join network.members member on member.app_id=msg.app_id and member.id=msg.member_id
    join platform.matching_ages ages on ages.app_id=member.app_id and ages.member_id=member.id
    join network.network_state saved on saved.app_id=msg.app_id and saved.id=${runtimeId}
    join lateral jsonb_to_recordset(saved.state->'members') as current(id text,stage text,minor boolean,"ageConflict" boolean,awaiting jsonb,
      "openAskAt" double precision,"onlyWhenAsked" boolean) on current.id=member.id
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId} and msg.direction='outbound'
      and msg.type='question' and msg.body=${row.text} and current.stage='active' and current.awaiting->>'kind'='interview'
      and member.account_status='active' and not member.opted_out`;
  if (!question) return refused;
  const eligible = canBeMatched(question.age ?? undefined) && !question.restricted_age && !question.held && !question.only_when_asked
    && effectiveParticipation(question, now).state !== "paused";
  return queuedEngineQuestionAllowed(question.awaited_id === row.id, eligible, question.asked_at ?? -1, now) ? { ok: true } : refused;
}

/** Called after the queue locks the member row that owns these settings. */
async function probeAdmission(tx: SQL, row: QueueRow, rt: NetworkRuntime, now: number): Promise<RecipientCheck> {
  const reviewedKey = row.id.startsWith(friendPlanProbeDeliveryPrefix);
  const refused = { ok: false, reason: "plan_probe_changed" } as const;
  if (!row.memberId) return reviewedKey ? refused : { ok: true };
  if (row.kind !== "proactive") return reviewedKey ? refused : queuedProbeRosterAdmission(tx, row, rt.pg.id);
  const [probe] = await tx<QueuedProbe[]>`select msg.type,opp.category,member.prefs,member.participation_state,member.participation_window,member.opted_out,
      (msg.opportunity_id=${row.oppId ?? null} and msg.body=${row.text}) as exact_message
    from network.messages msg join network.members member on member.app_id=msg.app_id and member.id=msg.member_id
    left join network.opportunities opp on opp.app_id=msg.app_id and opp.id=msg.opportunity_id and opp.id=${row.oppId ?? null}
    where msg.app_id=${row.app} and msg.id=${row.id} and msg.member_id=${row.memberId} and msg.direction='outbound'`;
  if (reviewedKey && probe?.type !== "plan_probe") return refused;
  if (probe?.type !== "probe" && probe?.type !== "plan_probe") return { ok: true };
  const paused = effectiveParticipation(probe, now).state === "paused";
  const categories = probe.prefs?.categoriesOptIn;
  const categoryAllowed = probe.category !== null && Array.isArray(categories) && categories.includes(probe.category)
    && (probe.category !== "romance" || probe.prefs?.romanceOptIn === true);
  if (queuedProbePolicy(true, paused, categoryAllowed) !== "Proceed") return { ok: false, reason: "matching_settings_changed" };
  const city = isCity(rt.city) ? rt.city : "nyc";
  if (probe.type !== "plan_probe") {
    const presence = await claimPresence(tx, row.app, [row.memberId]);
    if (probeAvailability(claimPresent(presence, row.memberId, now, now + 6 * DAY, city), false) === "ParticipantAway") {
      return { ok: false, reason: "participant_away" };
    }
    return queuedProbeRosterAdmission(tx, row, rt.pg.id);
  }

  // lockPeerOpportunityContact already shares the exact runtime row against
  // updates to either the plan or the recipient's check-in state.
  const [current] = await tx<StoredPlanProbe[]>`select plan.stage, plan.review,
      case when jsonb_typeof(plan.review->'rerolls')='array' then jsonb_array_length(plan.review->'rerolls') else 0 end as review_revision,
      plan."planRun"->'answers'->>${row.memberId}::text='pending' as pending_seat,
      (plan.plan->>'probeDeadline')::double precision as probe_deadline, plan.plan->'window' as activity_window, member.stated,
      plan.plan ? 'reviewedOptions' as reviewed_offer, plan.plan->'partner'='true'::jsonb as partner, plan.plan->'invited' as invited,
      plan.plan->'reviewedOptions' as reviewed_options, plan.offered->${row.memberId}::text as offered,
      (member.awaiting->>'kind'='probe' and member.awaiting->>'oppId'=plan.id and member.awaiting->>'probeReceiptId'=${row.id}) as pending_delivery,
      peer.id as peer_id, peer.stated as peer_stated, plan."planRun"->'answers'->>(plan.plan->'invited'->>0) as first_answer,
      plan.picks->(plan.plan->'invited'->>0) as first_picks, plan.offered->(plan.plan->'invited'->>0) as first_offered
    from network.network_state saved
    join lateral jsonb_to_recordset(saved.state->'opps') as plan(id text,stage text,review jsonb,"planRun" jsonb,plan jsonb,offered jsonb,picks jsonb) on plan.id=${row.oppId ?? null}
    join lateral jsonb_to_recordset(saved.state->'members') as member(id text,stated jsonb,awaiting jsonb) on member.id=${row.memberId}
    left join lateral jsonb_to_recordset(case when plan.plan ? 'reviewedOptions' then saved.state->'members' else '[]'::jsonb end)
      as peer(id text,stated jsonb) on peer.id=case when member.id=plan.plan->'invited'->>0 then plan.plan->'invited'->>1 else plan.plan->'invited'->>0 end
    where saved.app_id=${row.app} and saved.id=${rt.pg.id}`;
  if (!current?.stage || !current.activity_window || current.probe_deadline === null) return refused;
  const laneOpen = rt.net.planProbeWindowOpen(current.stage, { window: current.activity_window, probeDeadline: current.probe_deadline }, now);
  if (!queuedPlanProbeAllowed(reviewApproved(current.review ?? undefined), current.pending_seat === true, laneOpen)) {
    return refused;
  }
  if (current.reviewed_offer || reviewedKey) {
    if (!reviewedKey || !current.reviewed_offer) return refused;
    const presence = await claimPresence(tx, row.app, [row.memberId, ...(current.peer_id ? [current.peer_id] : [])]);
    return reviewedFriendPlanProbe(current, row, probe.exact_message === true, now,
      slot => claimPresent(presence, row.memberId!, now, slot.end, city)
        && (!current.peer_id || claimPresent(presence, current.peer_id, now, slot.end, city)));
  }
  const presence = await claimPresence(tx, row.app, [row.memberId]);
  if (!claimPresent(presence, row.memberId, now, current.activity_window.end, city)) {
    return { ok: false, reason: "plan_availability_changed" };
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
  const pending = replacement.stage === "probing" && reviewApproved(replacement.review)
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

const DRY_RUN_LINE = "dry-run";

export class DryRunAdapter implements ChannelAdapter {
  readonly name = "dry_run" as const;
  readonly storedStatus = "dry_run";
  private q?: OutboundQueue;
  constructor(private log: (line: string) => void = console.log) {}
  attach(rt: NetworkRuntime) {
    const provider: ProviderAdapter = { kind: "sim", send: async () => { throw new ChannelSendError("A dry run never sends", "invalid"); } };
    this.q = lineQueue(rt, { provider, clock: rt.clock, line: DRY_RUN_LINE, app: rt.app.id, env: {}, live: () => false, log: this.log });
  }
  get queue(): OutboundQueue {
    if (!this.q) throw new Error("DryRunAdapter is not attached to a network runtime");
    return this.q;
  }
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
  provider: ProviderAdapter;
  clock: Clock;
  from?: string;
  app?: string;
  city?: string;
  env?: Record<string, string | undefined>;
  limits?: { perLinePerDay?: number; newChatsPerLinePerDay?: number; perRecipientPerHour?: number; baseBackoffMs?: number; leaseMs?: number };
  log?: (line: string) => void;
}

interface LineQueueOptions {
  provider: ProviderAdapter;
  clock: Clock;
  line: string;
  app: string;
  env: Record<string, string | undefined>;
  live: () => boolean;
  limits?: BlooioAdapterOptions["limits"];
  log: (line: string) => void;
}

function lineQueue(rt: NetworkRuntime, o: LineQueueOptions): OutboundQueue {
  const policy = blooioRecipientPolicy(rt.net, rt.memberOf);
  const leaks = forbiddenProvider(rt.net, to => rt.memberOf(to));
  const num = (k: string) => { const v = Number(o.env[k]); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const checks: AppChecks = {
    live: o.live,
    stale: async row => row.id.startsWith("ntf_") ? !await rt.notificationCurrent(row.id)
      : !!row.oppId && (row.id.startsWith("relay:") ? (rt.net.opps.get(row.oppId)?.stage ?? "closed") === "closed"
        : closedOpportunityRowStale(CLOSED_STAGES.has(rt.net.opps.get(row.oppId)?.stage ?? ""),
          terminalNotice(row) !== undefined || row.id.startsWith(meetingFeedbackPrefix))),
    optedOut: row => rt.optedOut(row.id, row.memberId as MemberId | undefined, row.to),
    privatePayload: row => row.id.startsWith(EXPECTED_INVITATION_PREFIX) || row.id.startsWith("relay:"),
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
      if (venueBookingNoticeBase(row.id)
        && !rt.net.approvedBookingLink(row.oppId, (row.memberId as MemberId | undefined) ?? rt.memberOf(row.to), row.text, row.id)) {
        return { ok: false, reason: "booking_changed" };
      }
      return !row.memberId && !rt.memberOf(row.to) ? { ok: true }
        : policy(row.to, { kind: row.kind, ...(row.oppId && !terminalNotice(row) ? { briefId: row.oppId } : {}), agentInitiated });
    },
    leaks: async row => {
      const sender = rt.net.relaySenderOf(row.id), recipient = (row.memberId as MemberId | undefined) ?? rt.memberOf(row.to);
      const base = sender && recipient ? rt.net.leakSources([recipient], [sender]) : leaks(row.to);
      const digestLink = row.id.startsWith("ntf_") ? await rt.notificationHandoffUrl(row.id, row.text) : undefined;
      if (digestLink) return { ...base, contactAllow: [digestLink] };
      const inviteLink = row.id.startsWith(EXPECTED_INVITATION_PREFIX) && row.text.split("\n")[1];
      if (inviteLink && isMemberInvitationLink(rt.app, inviteLink)) return { ...base, contactAllow: [inviteLink] };
      const from = rt.net.relayContactShareFrom(row.id), number = from && rt.addressOf(from);
      const venueAddress = rt.net.publicMeetupVenueAddress(row.oppId, row.text);
      const bookingLink = row.kind === "reply" || row.kind === "transactional"
        ? rt.net.approvedBookingLink(row.oppId, recipient, row.text, row.id) : undefined;
      const allow = [...(number ? [number] : []), ...(venueAddress ? [venueAddress] : [])];
      return allow.length ? { ...base, allow }
        : bookingLink ? { ...base, contactAllow: [bookingLink] } : base;
    },
    lockAdmission: async (row, tx) => {
      if (!(await rt.stateCurrent(tx))) return false;
      if (isDatingDomain(row.app) && row.oppId) await rt.lockSlopPairAdmission(tx, row);
      if (row.oppId) await lockPublicEventContact(tx, row, rt.pg.id);
      if (row.id.startsWith(monthlyGatheringInvitePrefix)) await lockGatheringAdmission(tx, rt.app.id, rt.pg.id, row);
      if (row.id.startsWith(monthlyGatheringNoticePrefix)) await lockGatheringNoticeAdmission(tx, rt.app.id, rt.pg.id, row);
      if (row.oppId?.startsWith(gatheringRepeatOppPrefix)) await rt.lockGatheringRepeatClaim(tx, row.oppId);
      if (row.id.startsWith("home-help-consent:")) await rt.lockHomeHelpConsentAdmission(tx, row.id, row.memberId);
      if (row.oppId && row.memberId) await lockPeerOpportunityContact(tx, row.app, rt.pg.id, row.memberId, row.id);
      return true;
    },
    admit: async (row, tx) => {
      if (row.id.startsWith("ntf_")) {
        return await rt.notificationClaimCurrent(tx, row) ? { ok: true } : { ok: false, reason: "notification_obsolete" };
      }
      if (isDatingDomain(row.app) && row.oppId) {
        const authority = await rt.slopPairAdmission(tx, row);
        if (!authority.ok) return authority;
      }
      if (isBusinessDomain(row.app) && row.oppId) {
        const authority = await rt.peonHireAdmission(tx, row);
        if (!authority.ok) return authority;
      }
      if (row.id.startsWith(monthlyGatheringInvitePrefix)) return rt.gatheringInvitationAdmission(tx, row);
      if (row.id.startsWith(monthlyGatheringNoticePrefix)) return rt.gatheringNoticeAdmission(tx, row);
      if (row.oppId?.startsWith(gatheringRepeatOppPrefix) && !await rt.gatheringRepeatClaim(tx, row)) return { ok: false, reason: "gathering_repeat_changed" };
      if (row.oppId) {
        const event = await publicEventContactAdmission(tx, row, rt.pg.id, rt.city, o.clock.now());
        if (!event.ok) return event;
      }
      if (row.oppId && row.memberId && await peerOpportunityContactRestricted(tx, row.app, row.memberId, [row.id], o.clock.now())) {
        return { ok: false, reason: "opportunity_roster_blocked" };
      }
      if ((row.oppId || venueBookingNoticeBase(row.id)) && await originalBookingNoticeStale(tx, row.app, rt.pg.id, [row.id], o.clock, row)) return { ok: false, reason: "booking_changed" };
      if (row.id.startsWith(RESCHEDULE_QUEUE_PREFIX)) return rescheduleAdmission(tx, row, rt.pg.id, o.clock.now());
      const venueSwap = await venueSwapNoticeAdmission(tx, row, rt.pg.id);
      if (!venueSwap.ok) return venueSwap;
      if (row.id.startsWith(interruptionFeedbackPrefix)) return interruptionSurveyAdmission(tx, row, rt.pg.id, o.clock.now());
      if (row.id.startsWith(reengagementDeliveryPrefix)) return reengagementAdmission(tx, row, rt.pg.id, o.clock.now());
      if (row.id.startsWith(replacementProbePrefix)) return replacementProbeAdmission(tx, row, rt, o.clock.now());
      if (row.id.startsWith("relay:")) return rt.relayAdmission(tx, row);
      if (row.id.startsWith(lateArrivalDeliveryPrefix)) return rt.groupLateArrivalAdmission(tx, row);
      if (row.id.startsWith(cofounderDeliveryIdPrefix)) {
        const authority = await rt.cofounderAdmission(tx, row);
        const prefix = `${cofounderDeliveryIdPrefix}reveal:`;
        if (!authority.ok || !row.id.startsWith(`${prefix}${RESCHEDULE_QUEUE_PREFIX}`)) return authority;
        return rescheduleAdmission(tx, { ...row, id: row.id.slice(prefix.length) }, rt.pg.id, o.clock.now());
      }
      if (row.id.startsWith("invite-notice:")) return await rt.invitationNoticeAdmission(tx, row.id, row.memberId)
        ? { ok: true } : { ok: false, reason: "invitation_notice_changed" };
      if (row.id.startsWith("home-help-consent:")) return await rt.homeHelpConsentAdmission(tx, row)
        ? { ok: true } : { ok: false, reason: "home_help_consent_changed" };
      if (row.id.startsWith(EXPECTED_INVITATION_PREFIX)) return !row.memberId && row.kind === "transactional" && await rt.expectedInvitationAdmission(tx, row)
        ? { ok: true } : { ok: false, reason: "expected_invitation_changed" };
      const notice = terminalNotice(row);
      if (notice) return releaseAdmission(tx, row, notice, rt.pg.id, o.clock.now());
      if (row.id.startsWith(bookedCancellationPrefix)) return { ok: false, reason: "opportunity_release_changed" };
      const reminder = bookedReminderKind(row.id);
      if (reminder) return bookedReminderAdmission(tx, row, reminder, rt.pg.id, o.clock.now());
      if (row.id.startsWith(meetingFeedbackPrefix)) return meetingFeedbackAdmission(tx, row, rt.pg.id, o.clock.now());
      if (row.id.startsWith(engineQuestionDeliveryPrefix)) return engineQuestionAdmission(tx, row, rt.pg.id, o.clock.now());
      return probeAdmission(tx, row, rt, o.clock.now());
    },
    claimed: async (row, tx) => {
      if (row.id.startsWith(EXPECTED_INVITATION_PREFIX)) await rt.expectedInvitationClaimed(tx, row);
    },
    capTake: row => rt.capTake(row.id, row.memberId as MemberId),
    capRelease: row => rt.capRelease(row.id),
  };
  const admitStored = checks.admit!;
  checks.admit = async (row, tx) => {
    const decision = await admitStored(row, tx);
    return decision.ok && !await rt.view.isCurrent(tx) ? { ok: false, reason: "network_state_changed", retryAt: o.clock.now() } : decision;
  };
  return new OutboundQueue({
    sql: rt.db, clock: o.clock, provider: o.provider, line: o.line, app: o.app, checks, instance: rt.instance,
    recipientWindowKey: rt.outboundRecipientKey,
    perLinePerDay: num("BLOOIO_LINE_DAILY_CAP"), newChatsPerLinePerDay: num("BLOOIO_LINE_NEW_CHATS_PER_DAY"), ...o.limits, leakAllow: OWN_DOMAINS,
    onAlert: (id, why) => o.log(`[blooio] alert ${why} on ${id} (${o.app})`),
  });
}

export class BlooioAdapter implements ChannelAdapter {
  readonly name: ChannelAdapter["name"] = "blooio";
  readonly storedStatus = "queued";
  readonly app: string;
  private readonly env: Record<string, string | undefined>;
  private readonly log: (line: string) => void;
  private readonly city: string;
  private q?: OutboundQueue;
  private rt?: NetworkRuntime;

  constructor(private readonly o: BlooioAdapterOptions) {
    this.env = o.env ?? process.env;
    this.log = o.log ?? console.log;
    this.app = o.app ?? "ntwrk";
    this.city = o.city ?? "nyc";
    if (!o.from) throw new Error("the Blooio adapter needs the sending line (BLOOIO_FROM)");
  }

  get queue(): OutboundQueue {
    if (!this.q) throw new Error("BlooioAdapter is not attached to a network runtime");
    return this.q;
  }

  attach(rt: NetworkRuntime) {
    this.rt = rt;
    this.q = lineQueue(rt, { provider: this.o.provider, clock: this.o.clock, line: this.o.from!, app: this.app, env: this.env,
      live: () => true, limits: this.o.limits, log: this.log });
  }

  async enqueue(tx: SQL, msgs: Outbound[], forgotten: ReadonlySet<MemberId>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const go = msgs.filter(m => {
      return m.to ? true : (out.set(m.id, "failed_no_address"), false);
    });
    await this.queue.enqueue(tx, go.map(m => ({
      // A member the unit forgets gets the one decline as a text to a non-member: nothing about them is kept.
      id: m.id, ...(forgotten.has(m.memberId) ? {} : { memberId: m.memberId }), to: m.to!, kind: m.kind, text: m.body,
      ...(m.mediaUrls?.length ? { mediaUrls: m.mediaUrls } : {}), ...(m.oppId ? { oppId: m.oppId } : {}), city: this.city,
    })));
    return out;
  }

  async deliver(_msgs: Outbound[]): Promise<Delivery[]> { return this.queue.drain(); }
  async flush(): Promise<Delivery[]> { return []; }
  recover() { return this.queue.recover(); }

  async direct(to: string, body: string, id: string, kind: DirectKind): Promise<string> {
    await this.queue.enqueue(this.queue.sql, [{ id, to, kind, text: body, city: this.city }]);
    await this.rt!.deliver();
    return (await this.queue.statusOf(id)) ?? "failed";
  }

  async engaged(address: string) { await this.queue.inbound(address); }
  purge() { return this.queue.purge(); }
  status(u: StatusUpdate): Promise<Delivery | undefined> { return this.queue.applyStatus(u); }
  lineSafety(action: string | undefined, eventType?: string) { return this.queue.setLineSafety(action, eventType); }
}

export function collectedReplyGuard(adapter: ChannelAdapter): OutboundQueue {
  if (adapter instanceof BlooioAdapter || adapter instanceof DryRunAdapter) return adapter.queue;
  throw new Error(`The ${adapter.name} adapter has no line queue for collected replies`);
}
