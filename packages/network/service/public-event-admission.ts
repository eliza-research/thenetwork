import { canBeMatched } from "@thenetwork/core";
import type { QueueRow, RecipientCheck } from "../../blooio/src/outbound-queue.ts";
import { publicEventClaimAllowed, publicEventMemberAllowsMatch, publicEventRevisionMatches } from "../../core/src/generated/publicEventCatalog.ts";
import { listedEventMinimumAge } from "../../core/src/public-event-age.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { NetworkState } from "../src/network.ts";
import { publicEventRevision } from "../src/public-event-revision.ts";
import { lockPublicEventCatalog, readPublicEvents } from "./public-events.ts";

interface EventContact {
  opportunity: NetworkState["opps"][number];
  member_id: string;
  type: "probe" | "plan_probe" | "scheduling" | "proposal" | "reminder";
  body: string | null;
}

async function eventContact(tx: SQL, row: QueueRow, runtimeId: string, lock: boolean): Promise<EventContact | undefined> {
  if (!row.oppId || !row.memberId) return;
  const [contact] = await tx<EventContact[]>`select item.value as opportunity,msg.member_id,msg.type,msg.body
    from network.network_state saved
    join network.messages msg on msg.app_id=saved.app_id and msg.id=${row.id}
    join lateral jsonb_array_elements(saved.state->'opps') item(value) on item.value->>'id'=msg.opportunity_id
    where saved.id=${runtimeId} and saved.app_id=${row.app} and msg.opportunity_id=${row.oppId}
      and msg.member_id=${row.memberId} and msg.direction='outbound'
      and msg.type in ('probe','plan_probe','scheduling','proposal','reminder') and item.value ? 'publicEventRevision'
    ${lock ? tx`for share of saved` : tx``}`;
  return contact;
}
export async function lockPublicEventContact(tx: SQL, row: QueueRow, runtimeId: string): Promise<void> {
  if (await eventContact(tx, row, runtimeId, true)) await lockPublicEventCatalog(tx);
}
export async function publicEventContactAdmission(tx: SQL, row: QueueRow, runtimeId: string, city: string, now: number): Promise<RecipientCheck> {
  const contact = await eventContact(tx, row, runtimeId, false);
  if (!contact) return { ok: true };
  const refused: RecipientCheck = { ok: false, reason: "public_event_changed" };
  const { opportunity: opp, member_id: recipient, type, body } = contact;
  const eventId = opp.plan?.eventId ?? opp.anchor?.id;
  if (!eventId || !opp.publicEventRevision) return refused;
  const bookingNotice = type === "proposal" || type === "reminder";
  const lateInvite = type === "plan_probe" && opp.stage === "scheduled" && opp.planRun?.answers[recipient] === "pending";
  const status = new Map(opp.status);
  const participants = opp.participants.filter(id => {
    const current = status.get(id);
    if (bookingNotice || lateInvite) return current === "yes" || (lateInvite && id === recipient);
    return current === "queued" || current === "probing" || current === "available" || current === "yes";
  });
  const expectedStage = bookingNotice || lateInvite ? "scheduled" : "probing";
  const exactContact = body === row.text && participants.includes(recipient) && opp.review?.decision === "approve"
    && !opp.review.invalidated && opp.stage === expectedStage;
  if (!exactContact) return refused;
  const [event] = await readPublicEvents(tx, now, city, eventId);
  if (!event || !publicEventRevisionMatches(opp.publicEventRevision, publicEventRevision(event))) return refused;

  const minimumAge = listedEventMinimumAge(event);
  const members = await tx<{ age: number | null; prefs: { categoriesOptIn?: unknown; formats?: unknown } | null }[]>`
    select ages.age,m.prefs from network.members m
    join platform.matching_ages ages on ages.app_id=m.app_id and ages.member_id=m.id
    where m.app_id=${row.app} and m.id=any(${tx.array(participants, "TEXT")}) and m.account_status='active' and not m.opted_out`;
  const participantsEligible = members.length === participants.length && members.every(({ age, prefs }) => publicEventMemberAllowsMatch(
    canBeMatched(age), (age ?? -1) >= minimumAge, Array.isArray(prefs?.categoriesOptIn) && prefs.categoriesOptIn.includes(opp.category),
    Array.isArray(prefs?.formats) && prefs.formats.includes("event"),
  ));
  return publicEventClaimAllowed(true, exactContact, participantsEligible) ? { ok: true } : refused;
}
