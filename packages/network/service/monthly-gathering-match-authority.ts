import type { ParticipationState, Preferences } from "@thenetwork/core";
import { gatheringFollowupWindowMs } from "../../core/src/generated/monthlyGatheringFollowup.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { sameGatheringRepeatSource, type GatheringRepeatSource, type NetworkState } from "../src/network.ts";
import { gatheringRepeatSourcesForEvent, type FollowupAccounts, type GatheringFollowupRecipient } from "./monthly-gathering-followup.ts";
import { gatheringRsvpKey } from "./monthly-gathering-rsvp.ts";
import { effectiveParticipation } from "./snapshot.ts";

interface MemberAdmission {
  id: string;
  prefs: Partial<Preferences> | null;
  participation_state: ParticipationState;
  participation_window: unknown;
  opted_out: boolean;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function validSource(source: GatheringRepeatSource): boolean {
  return UUID.test(source.gatheringId) && UUID.test(source.groupReviewId)
    && gatheringRsvpKey(source.gatheringId, String(source.revision))?.id === source.gatheringId
    && Array.isArray(source.members) && source.members.length === 2
    && source.members.every(id => typeof id === "string" && id.length > 0) && source.members[0] < source.members[1]
    && /^[0-9a-f]{64}$/.test(source.consentVersion);
}

/** Caller holds the runtime lock. Read the active window without inventing a new epoch for a repeated scan. */
export async function currentGatheringRepeatSources(tx: SQL, accounts: FollowupAccounts, app: AppInfo, now: number, state?: NetworkState): Promise<GatheringRepeatSource[]> {
  if (app.id !== "ntwrk") return [];
  const events = await tx<{ id: string; revision: number }[]>`select event.id,event.revision from network.monthly_gatherings event
    where event.app_id=${app.id} and event.city='nyc' and event.status='approved'
      and event.ends_at>${new Date(now - gatheringFollowupWindowMs)} and event.ends_at<=${new Date(now)}
      and exists (select 1 from network.monthly_gathering_followup_choices choice where choice.app_id=event.app_id
        and choice.gathering_id=event.id and choice.revision=event.revision and choice.wanted)
    order by event.ends_at,event.id`;
  if (!events.length) return [];
  if (!state) {
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where app_id=${app.id} and id='ntwrk:nyc'`;
    state = saved?.state;
  }
  if (!state) return [];
  const result: GatheringRepeatSource[] = [];
  for (const event of events) result.push(...await gatheringRepeatSourcesForEvent(tx, accounts, app, event, now, { state }));
  return result;
}

/** State is already locked when claiming. Lock the event before the two persons, including the peer. */
export async function lockGatheringMatchSource(tx: SQL, app: AppInfo, source: GatheringRepeatSource): Promise<void> {
  if (app.id !== "ntwrk" || !validSource(source)) return;
  const [event] = await tx`select id from network.monthly_gatherings where app_id=${app.id} and city='nyc'
    and id=${source.gatheringId} and revision=${source.revision} for share`;
  if (!event) return;
  await tx`select person.id from platform.people person join network.members member on member.person_id=person.id
    where member.app_id=${app.id} and member.id=any(${tx.array(source.members, "TEXT")}) order by person.id for update of person`;
  await tx`select id from network.members where app_id=${app.id} and id=any(${tx.array(source.members, "TEXT")}) order by id for share`;
  await tx`select membership.member_id from platform.memberships membership
    join network.members member on member.app_id=membership.app_id and member.id=membership.member_id and member.person_id=membership.person_id
    join platform.phone_identities phone on phone.person_id=membership.person_id
    where membership.app_id=${app.id} and membership.member_id=any(${tx.array(source.members, "TEXT")})
    order by membership.person_id,phone.e164 for share of membership,phone`;
}

/** Used under claim locks before contact and as a read-only check during human review and reply replay. */
export async function gatheringMatchSourceCurrent(tx: SQL, accounts: FollowupAccounts, app: AppInfo, source: GatheringRepeatSource,
  now: number, recipient?: GatheringFollowupRecipient, state?: NetworkState): Promise<boolean> {
  if (app.id !== "ntwrk" || !validSource(source) || (recipient && !source.members.includes(recipient.memberId))) return false;
  if (!state) {
    const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state where app_id=${app.id} and id='ntwrk:nyc'`;
    state = saved?.state;
  }
  if (!state) return false;
  const stored = state;
  if (source.members.some(id => stored.members.find(member => member.id === id)?.onlyWhenAsked)) return false;
  const members = await tx<MemberAdmission[]>`select id,prefs,participation_state,participation_window,opted_out from network.members
    where app_id=${app.id} and account_status='active' and not opted_out and home_city='nyc' and id=any(${tx.array(source.members,"TEXT")})`;
  if (members.length !== 2 || members.some(({ prefs, ...member }) => !prefs || prefs.onlyWhenAsked
    || !Array.isArray(prefs.categoriesOptIn) || !prefs.categoriesOptIn.includes("social")
    || !Array.isArray(prefs.formats) || !prefs.formats.includes("one_to_one") || effectiveParticipation(member, now).state === "paused")) return false;

  const latest = await gatheringRepeatSourcesForEvent(tx, accounts, app, { id: source.gatheringId, revision: source.revision },
    now, { state, expected: source, recipient });
  return latest.length === 1 && sameGatheringRepeatSource(latest[0]!, source);
}
