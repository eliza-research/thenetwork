import type { SQL } from "../../core/src/runtime/postgres.ts";
import { canBeMatched, type AgeSide } from "@thenetwork/core";
import { earliestDayKeyOf, latestDayKeyOf } from "../../core/src/birth-date.ts";
import { groupAgeAllowed, rosterHasMinor, teenReady, teenRosterSizeAllowed } from "../../core/src/generated/friendIntroAge.ts";
import { teenFriendApp, teenFriendCategory } from "../../core/src/generated/matchLane.ts";
import { personMinorSignalOpen } from "../../core/src/generated/safetyCase.ts";
import { storedTeenStop, teenMeetingEndOf, teenRosterWithHost, teenStoredItemShape, type NetworkState } from "../src/network.ts";
import { birthFieldsOf } from "./snapshot.ts";

const OPEN = new Set(["review", "probing", "scheduled"]);

type StoredOpp = NetworkState["opps"][number];
type StoredMember = NetworkState["members"][number];
type RosterSide = AgeSide & { minor: boolean };

export type StoredTeenStatus = "unmarked" | "adult" | "current" | "failed";

async function rosterSides(tx: SQL, app: string, st: NetworkState | undefined, ids: readonly string[], now: number): Promise<RosterSide[]> {
  const rows = await tx`select m.id, a.age as matching_age, a.minor_signal_at,
      a.birth_date as ab_birth_date, a.birth_lower as ab_birth_lower, a.birth_upper as ab_birth_upper, a.birth_youngest as ab_birth_youngest,
      a.floor_birth_lower as ab_floor_birth_lower, a.floor_birth_upper as ab_floor_birth_upper, a.floor_birth_youngest as ab_floor_birth_youngest,
      a.teen_pool_barred as ab_teen_pool_barred,
      exists (select 1 from platform.teen_pool_holds h join platform.people hp on hp.phone_hash=h.phone_hash
        where hp.id=m.person_id and h.app_id<>m.app_id) as ab_teen_pool_held
    from network.members m left join platform.matching_ages a on a.app_id=m.app_id and a.member_id=m.id
    where m.app_id=${app} and m.id in ${tx([...ids])} order by m.id`;
  return ids.map(id => {
    const row = rows.find(r => r.id === id);
    const member: StoredMember | undefined = st?.members.find(x => x.id === id);
    if (!row) return { adult: false, ready: false, birthKey: 0, minor: false };
    const fields = birthFieldsOf(row, now);
    const age = fields.age ?? (row.matching_age === null ? undefined : Number(row.matching_age));
    const minor = member?.minor === true || (age !== undefined && !canBeMatched(age));
    if (!st || !member || st.declinedIds.includes(id)) return { adult: false, ready: false, birthKey: 0, minor };
    const signalAt = row.minor_signal_at ? new Date(row.minor_signal_at).getTime() : undefined;
    const signal = personMinorSignalOpen(signalAt !== undefined, signalAt ?? 0, member.minorClearedAt !== undefined, member.minorClearedAt ?? 0) || member.minorSignal;
    const doubt = member.ageConflict === true || member.ageUnknown === true;
    const adult = canBeMatched(age) && !member.minor && !member.minorSignal && !doubt && !member.minorReported;
    const held = (st.reports ?? []).some(r => r.subjectId === id && (r.status === "open" || r.status === "held"))
      || (st.trust ?? []).some(t => t.id === id && t.level === "hold");
    const ready = teenReady(fields.birthExact === true, fields.ageConflict === true || doubt, signal, member.minorReported === true,
      member.olderReported === true, fields.teenBarred === true || fields.teenHeld === true || held);
    return { adult, ready, birthKey: fields.birthKey ?? 0, minor };
  });
}

export async function storedTeenStatus(tx: SQL, app: string, oppId: string, now: number, roster: readonly string[] = []): Promise<{ status: StoredTeenStatus; minor: boolean }> {
  const [saved] = await tx<{ state: NetworkState | string }[]>`select state from network.network_state
    where app_id=${app} and state->'opps' @> ${JSON.stringify([{ id: oppId }])}::jsonb order by id limit 1`;
  const st = saved ? (typeof saved.state === "string" ? JSON.parse(saved.state) : saved.state) as NetworkState : undefined;
  const opp: StoredOpp | undefined = st?.opps.find(o => o.id === oppId);
  const marked = !!st && !!opp && opp.teenRuleAt !== undefined;
  if (!marked && !roster.length) return { status: "unmarked", minor: false };
  const ids = [...new Set([...(opp ? teenRosterWithHost(opp) : []), ...roster])];
  const sides = ids.length ? await rosterSides(tx, app, st, ids, now) : [];
  const minor = sides.some(x => x.minor);
  if (!st || !opp || !marked) return { status: "unmarked", minor };
  if (!rosterHasMinor(sides)) return { status: "adult", minor };
  const end = teenMeetingEndOf(opp, now);
  const current = OPEN.has(opp.stage) && teenFriendApp(app) && !storedTeenStop(st) && teenStoredItemShape(app, opp)
    && teenRosterSizeAllowed(true, teenRosterWithHost(opp).length)
    && groupAgeAllowed(true, teenFriendCategory(app, opp.category), earliestDayKeyOf(now), latestDayKeyOf(Math.max(now, end)), sides);
  return { status: current ? "current" : "failed", minor };
}
