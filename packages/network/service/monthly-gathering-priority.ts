import { gatheringRsvpWindow } from "../../core/src/generated/monthlyGatheringRsvp.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { currentGatheringMember, rankGatheringInvitees, type GatheringRsvpKey } from "./monthly-gathering-rsvp.ts";
import type { NetworkRuntime } from "./runtime.ts";

const GATHERING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface GatheringRow {
  status: string;
  revision: number;
  capacity: number;
  reviewed_at: Date | null;
  starts_at: Date;
  ends_at: Date;
}

interface MemberPhones { id: string; phones: string[] }
export async function eligibleGatheringInvitees(tx: SQL, accounts: Pick<Accounts, "activeMembership" | "lowestAge">,
  app: AppInfo, key: GatheringRsvpKey, ranked: readonly string[], capacity: number, now: number): Promise<string[]> {
  if (app.id !== "ntwrk" || !ranked.length) return [];
  const city = "nyc";
  const members = await tx<MemberPhones[]>`select m.id,array_agg(p.e164 order by p.e164) as phones
    from network.members m join platform.phone_identities p on p.person_id=m.person_id and p.hold is null
    where m.app_id=${app.id} and m.home_city=${city} and m.account_status='active' and not m.opted_out
      and m.id=any(${tx.array([...ranked], "TEXT")})
      and not exists (select 1 from network.monthly_gathering_rsvps r
        where r.app_id=m.app_id and r.member_id=m.id and r.gathering_id=${key.id} and r.revision=${key.revision})
    group by m.id`;
  const phones = new Map(members.map(member => [member.id, member.phones]));
  const result: string[] = [];
  for (const memberId of ranked) {
    if (result.length >= capacity) break;
    for (const e164 of phones.get(memberId) ?? []) {
      if (!await currentGatheringMember(tx, accounts, { app, e164, memberId }, city, now)) continue;
      result.push(memberId);
      break;
    }
  }
  return result;
}
export async function readGatheringInvitees(rt: NetworkRuntime, accountsFor: (tx: SQL) => Pick<Accounts, "activeMembership" | "lowestAge">,
  key: GatheringRsvpKey, now: () => number): Promise<string[] | undefined> {
  const { app, city } = rt;
  if (app.id !== "ntwrk" || city !== "nyc" || !GATHERING_ID.test(key.id) || !Number.isSafeInteger(key.revision) ||
    key.revision < 1 || key.revision > 2_147_483_647) return;
  const currentEvent = async (tx: SQL, at: number) => {
    const [event] = await tx<GatheringRow[]>`select status,revision,capacity,reviewed_at,starts_at,ends_at
      from network.monthly_gatherings where app_id=${app.id} and city=${city} and id=${key.id}`;
    if (!event || !gatheringRsvpWindow(event.status === "approved", event.revision === key.revision, false,
      event.reviewed_at?.getTime() ?? 0, event.starts_at.getTime(), event.ends_at.getTime(), at, at)) return;
    return event;
  };
  if (!await rt.scoped(tx => currentEvent(tx, now()))) return;
  const ranked = await rt.readState(net => rankGatheringInvitees(net.gatheringPriorityEvidence(now())));
  return rt.scoped(async tx => {
    const checkedAt = now();
    const event = await currentEvent(tx, checkedAt);
    if (!event) return;
    const result = await eligibleGatheringInvitees(tx, accountsFor(tx), app, key, ranked, event.capacity, checkedAt);
    return now() < event.starts_at.getTime() ? result : undefined;
  });
}
