import { attention } from "@thenetwork/engine";
import type { QueueRow, RecipientCheck } from "../../blooio/src/outbound-queue.ts";
import {
  gatheringInvitationMayAdmit, gatheringInvitationRecipientCurrent, gatheringInvitationReviewCurrent, monthlyGatheringInvitePrefix,
} from "../../core/src/generated/monthlyGatheringDelivery.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { gatheringEventPreference, storedGatheringInviteRecipientCurrent, type NetworkState } from "../src/network.ts";
import { BlooioAdapter } from "./channel.ts";
import { currentGatheringMember, gatheringRsvpReference, type GatheringRsvpKey } from "./monthly-gathering-rsvp.ts";
import { gatheringVenueStillCurrent } from "./monthly-gatherings.ts";
import { lockPublicEventCatalog } from "./public-events.ts";
import type { NetworkRuntime } from "./runtime.ts";

export { monthlyGatheringInvitePrefix };

type GatheringAccounts = Pick<Accounts, "activeMembership" | "lowestAge">;
interface InviteeRow extends GatheringRsvpKey { member_id: string }
interface ReviewedInvite {
  city: string; status: string; revision: number; capacity: number; month: string;
  venue_kind: "curated" | "listing"; venue_ref: string; venue_name: string;
  reviewed_at: Date; selection_reviewed_at: Date; starts_at: Date; ends_at: Date;
  has_rsvp: boolean; reserved: number;
}

export function gatheringDeliveryId(event: GatheringRsvpKey, memberId: string, prefix = monthlyGatheringInvitePrefix): string {
  return `${prefix}${event.id}:${event.revision}:${memberId}`;
}

export function gatheringDeliveryEvent(row: Pick<QueueRow, "id" | "memberId">, prefix = monthlyGatheringInvitePrefix): GatheringRsvpKey | undefined {
  if (!row.memberId || !row.id.startsWith(prefix)) return;
  const [id, rawRevision] = row.id.slice(prefix.length).split(":", 2);
  const revision = Number(rawRevision);
  if (id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) && Number.isSafeInteger(revision) && revision > 0 &&
    revision <= 2_147_483_647 && row.id === gatheringDeliveryId({ id, revision }, row.memberId, prefix)) return { id, revision };
}

const localStart = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
});

export const gatheringLocalStart = (startsAt: Date): string => localStart.format(startsAt);

function invitationCard(event: ReviewedInvite, id: string): string {
  return attention.withPausePath(`The Network's monthly gathering is ${gatheringLocalStart(event.starts_at)} New York time at ${event.venue_name}. Reply with the line below to reserve a place.\n`
    + `RSVP GATHERING ${gatheringRsvpReference(id)} ${event.revision} YES`);
}

async function reviewedInvite(tx: SQL, app: AppInfo, key: GatheringRsvpKey, memberId: string): Promise<ReviewedInvite | undefined> {
  const [event] = await tx<ReviewedInvite[]>`select g.*,r.reviewed_at as selection_reviewed_at,
      exists (select 1 from network.monthly_gathering_rsvps s where s.app_id=g.app_id and s.gathering_id=g.id
        and s.revision=g.revision and s.member_id=i.member_id) as has_rsvp,
      (select count(*)::int from network.monthly_gathering_rsvps s where s.app_id=g.app_id and s.gathering_id=g.id
        and s.revision=g.revision and s.choice<>'withdrawn') as reserved
    from network.monthly_gatherings g join network.monthly_gathering_invitation_reviews r
      on r.app_id=g.app_id and r.gathering_id=g.id and r.revision=g.revision
    join network.monthly_gathering_invitees i on i.app_id=r.app_id and i.gathering_id=r.gathering_id and i.revision=r.revision
    where g.app_id=${app.id} and g.city='nyc' and g.id=${key.id} and g.revision=${key.revision}
      and i.member_id=${memberId} and i.position<=r.recipient_count and r.recipient_count<=g.capacity`;
  return event;
}

async function reviewCurrent(tx: SQL, event: ReviewedInvite, revision: number, rollout: boolean, now: number): Promise<boolean> {
  return gatheringInvitationReviewCurrent(rollout, event.status === "approved", event.revision === revision, true,
    event.reviewed_at?.getTime() ?? 0, event.selection_reviewed_at.getTime(), event.starts_at.getTime(), now)
    && await gatheringVenueStillCurrent(tx, event, now);
}

async function recipientCurrent(tx: SQL, accounts: GatheringAccounts, app: AppInfo, event: ReviewedInvite,
  memberId: string, address: string, trustedActive: boolean, now: number): Promise<boolean> {
  const [member] = await tx<{ prefs: Parameters<typeof gatheringEventPreference>[0] }[]>`select prefs from network.members where app_id=${app.id} and id=${memberId}`;
  const current = !!member && await currentGatheringMember(tx, accounts, { app, memberId, e164: address }, event.city, now);
  return gatheringInvitationRecipientCurrent(current, trustedActive, gatheringEventPreference(member?.prefs), event.has_rsvp, event.reserved < event.capacity);
}

/** The live NYC runtime owns outbound staging; review alone never creates an outbound row. */
export async function queueReviewedGatheringInvitations(rt: NetworkRuntime, accountsFor: (tx: SQL) => GatheringAccounts, now: () => number): Promise<void> {
  const { app, adapter } = rt;
  if (app.id !== "ntwrk" || rt.city !== "nyc" || !rt.matchingAllowed || !rt.net.matchingEnabled() || !(adapter instanceof BlooioAdapter) || !adapter.live) return;
  const candidates = await rt.scoped(tx => tx<InviteeRow[]>`select g.id,g.revision,i.member_id
    from network.monthly_gatherings g join network.monthly_gathering_invitees i on i.app_id=g.app_id and i.gathering_id=g.id and i.revision=g.revision
    where g.app_id=${app.id} and g.city='nyc' and g.status='approved' and g.starts_at>${new Date(now())}
      and not exists (select 1 from network.monthly_gathering_rsvps s where s.app_id=g.app_id and s.gathering_id=g.id
        and s.revision=g.revision and s.member_id=i.member_id)
      and not exists (select 1 from network.messages m where m.app_id=g.app_id
        and m.id=${monthlyGatheringInvitePrefix} || g.id::text || ':' || g.revision::text || ':' || i.member_id)
    order by g.starts_at,g.id,i.position`);
  if (!candidates.length) return;
  await rt.unitOfWork(async net => {
    if (!net.matchingEnabled() || !adapter.live) return;
    for (const candidate of candidates) {
      const memberId = candidate.member_id;
      const address = rt.addressOf(memberId);
      if (!address) continue;
      const id = gatheringDeliveryId(candidate, memberId);
      const notice = await rt.scoped(async tx => {
        const [stored] = await tx`select id from network.messages where app_id=${app.id} and id=${id}`;
        if (stored) return;
        const event = await reviewedInvite(tx, app, candidate, memberId);
        const at = now();
        if (event && await reviewCurrent(tx, event, candidate.revision, true, at) &&
          await recipientCurrent(tx, accountsFor(tx), app, event, memberId, address, true, at)) return invitationCard(event, candidate.id);
      });
      if (notice) net.askReviewedGatheringInvitation(memberId, id, notice);
    }
  });
}

/** Match the Network save lock order before serializing with the RSVP and member fences. */
export async function lockGatheringAdmission(tx: SQL, app: string, runtimeId: string, row: QueueRow, prefix = monthlyGatheringInvitePrefix): Promise<void> {
  const key = gatheringDeliveryEvent(row, prefix);
  if (app !== "ntwrk" || row.app !== app || !key) return;
  await tx`select id from network.network_state where id=${runtimeId} and app_id=${app} for share`;
  const [event] = await tx<{ venue_kind: string }[]>`select venue_kind from network.monthly_gatherings where app_id=${app} and id=${key.id} for share`;
  if (event?.venue_kind === "listing") await lockPublicEventCatalog(tx);
}

/** Last app-owned check, inside the persisted outbound claim after the shared send gates. */
export async function gatheringInvitationAdmission(tx: SQL, app: AppInfo, runtimeId: string, accounts: GatheringAccounts,
  row: QueueRow, now: number): Promise<RecipientCheck> {
  const refused: RecipientCheck = { ok: false, reason: "gathering_invitation_changed" };
  const key = gatheringDeliveryEvent(row);
  const memberId = row.memberId;
  if (!key || !memberId || app.id !== "ntwrk" || row.app !== app.id || row.kind !== "proactive" || row.oppId ||
    row.mediaUrls.length || row.approvedPhotos?.length) return refused;
  const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where id=${runtimeId} and app_id=${app.id}`;
  const event = await reviewedInvite(tx, app, key, memberId);
  if (!saved || !event) return refused;
  const currentReview = await reviewCurrent(tx, event, key.revision, saved.state.matchingEnabled, now);
  const eligible = currentReview && await recipientCurrent(tx, accounts, app, event, memberId, row.to,
    storedGatheringInviteRecipientCurrent(saved.state, memberId), now);
  const [message] = await tx`select id from network.messages where app_id=${app.id} and id=${row.id} and member_id=${memberId}
      and direction='outbound' and type='info' and not system and proactive and opportunity_id is null and body=${row.text}`;
  return gatheringInvitationMayAdmit(currentReview, eligible, row.text === invitationCard(event, key.id), true, !!message) ? { ok: true } : refused;
}
