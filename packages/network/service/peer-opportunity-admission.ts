import type { SQL } from "../../core/src/runtime/postgres.ts";
import { peerContactSeatStatuses, peerContactTypes, queuedPeerContactPolicy } from "../../core/src/generated/outboundAdmission.ts";

function peerRosters(tx: SQL, app: string, recipient: string, ids: string[]) {
  return tx`select msg.id as message_id, member.id as member_id, member.person_id
    from network.messages msg
    join lateral (
      select msg.member_id
      union select unnest(msg.booking_roster_member_ids)
      union select seat.member_id from network.participations seat
        where msg.booking_roster_member_ids is null and seat.app_id=msg.app_id and seat.opportunity_id=msg.opportunity_id
          and seat.role='participant' and seat.status in ${tx(peerContactSeatStatuses)}
    ) roster on true
    join network.members member on member.app_id=msg.app_id and member.id=roster.member_id
    where msg.app_id=${app} and msg.id in ${tx(ids)} and msg.member_id=${recipient}
      and msg.direction='outbound' and msg.opportunity_id is not null and msg.type in ${tx(peerContactTypes)}`;
}

/** Take the same state/person order as the writer, before the queue pins its recipient. */
export async function lockPeerOpportunityContact(tx: SQL, app: string, runtime: string, recipient: string, id: string): Promise<void> {
  const [saved] = await tx`select saved.id from network.network_state saved
    join network.messages msg on msg.app_id=saved.app_id and msg.id=${id}
    where saved.id=${runtime} and msg.app_id=${app} and msg.member_id=${recipient}
      and msg.direction='outbound' and msg.opportunity_id is not null and msg.type in ${tx(peerContactTypes)} for share of saved`;
  if (!saved) return;
  await tx`select person.id from platform.people person
    where person.id in (select person_id from (${peerRosters(tx, app, recipient, [id])}) roster)
    order by person.id for update`;
}

/** Recheck participant authority in the provider claim or signed handoff transaction. */
export async function peerOpportunityContactRestricted(tx: SQL, app: string, recipient: string, ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const [row] = await tx<{ blocked: boolean; staff_held: boolean }[]>`with roster as (${peerRosters(tx, app, recipient, ids)})
    select exists (
      select 1 from roster a join roster b on b.message_id=a.message_id and a.member_id<b.member_id
      where exists (select 1 from network.edges edge where edge.app_id=${app} and edge.type='blocked'
        and ((edge.from_id=a.member_id and edge.to_id=b.member_id) or (edge.from_id=b.member_id and edge.to_id=a.member_id)))
      or exists (select 1 from platform.person_blocks block
        where (block.from_person=a.person_id and block.to_person=b.person_id) or (block.from_person=b.person_id and block.to_person=a.person_id))
    ) as blocked, exists (select 1 from roster join platform.matching_ages authority
      on authority.app_id=${app} and authority.member_id=roster.member_id where authority.staff_held) as staff_held`;
  return row?.staff_held === true || queuedPeerContactPolicy(row?.blocked === true) !== "Proceed";
}
