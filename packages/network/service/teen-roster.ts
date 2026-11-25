import type { SQL } from "../../core/src/runtime/postgres.ts";
import { canBeMatched, type AgeSide } from "@thenetwork/core";
import { earliestDayKeyOf, latestDayKeyOf } from "../../core/src/birth-date.ts";
import { groupAgeAllowed, rosterHasMinor, teenReady, teenRosterSizeAllowed } from "../../core/src/generated/friendIntroAge.ts";
import { teenFriendApp, teenFriendCategory } from "../../core/src/generated/matchLane.ts";
import { personMinorSignalOpen } from "../../core/src/generated/safetyCase.ts";
import { storedTeenStop, teenMeetingEndOf, teenRosterWithHost, teenStoredItemShape, type NetworkState } from "../src/network.ts";
import { birthColumns, birthFieldsOf, effectiveAgeOf, type AgeRow } from "./snapshot.ts";

const OPEN = new Set(["review", "probing", "scheduled"]);

type StoredOpp = NetworkState["opps"][number];
type StoredMember = NetworkState["members"][number];
type RosterSide = AgeSide & { id: string; minor: boolean };

export type StoredTeenStatus = "unmarked" | "adult" | "current" | "failed";

interface TeenReadings { birthKey?: number; birthExact: boolean; ageConflict: boolean; barred: boolean; minorSignalAt?: number }

export type StoredAgeFlags = Partial<Pick<StoredMember, "minor" | "minorSignal" | "minorReported" | "ageConflict" | "ageUnknown" | "minorClearedAt">>;

export function storedAgeReading(age: number | undefined, flags: StoredAgeFlags, birthConflict: boolean, minorSignalAt: number | undefined) {
  const signal = personMinorSignalOpen(minorSignalAt !== undefined, minorSignalAt ?? 0, flags.minorClearedAt !== undefined, flags.minorClearedAt ?? 0)
    || flags.minorSignal === true;
  const doubt = birthConflict || flags.ageConflict === true || flags.ageUnknown === true;
  return { signal, doubt, adult: canBeMatched(age) && flags.minor !== true && !signal && !doubt && flags.minorReported !== true };
}

function storedAgeSideOf(st: NetworkState, member: StoredMember, age: number | undefined, r: TeenReadings): AgeSide {
  const { signal, doubt, adult } = storedAgeReading(age, member, r.ageConflict, r.minorSignalAt);
  const held = (st.reports ?? []).some(x => x.subjectId === member.id && (x.status === "open" || x.status === "held"))
    || (st.trust ?? []).some(t => t.id === member.id && t.level === "hold");
  return {
    adult,
    ready: r.birthKey !== undefined
      && teenReady(r.birthExact, doubt, signal, member.minorReported === true, member.olderReported === true, r.barred || held),
    birthKey: r.birthKey ?? 0,
  };
}

async function rosterSides(tx: SQL, app: string, st: NetworkState | undefined, ids: readonly string[], now: number): Promise<RosterSide[]> {
  const rows = await tx<(AgeRow & { id: string; minor_signal_at: Date | null })[]>`select m.id, a.age as matching_age, a.minor_signal_at,
      ${birthColumns(tx)}, a.teen_pool_barred as ab_teen_pool_barred, a.teen_pool_held as ab_teen_pool_held
    from network.members m left join platform.matching_ages a on a.app_id=m.app_id and a.member_id=m.id
    where m.app_id=${app} and m.id in ${tx([...ids])} order by m.id`;
  return ids.map(id => {
    const row = rows.find(r => r.id === id);
    const member = st?.members.find(x => x.id === id);
    const age = row ? effectiveAgeOf(row, now) : undefined;
    const minor = !row || !canBeMatched(age) || (member ? member.minor === true : row.minor_signal_at !== null);
    if (!row || !st || !member || st.declinedIds.includes(id)) return { id, adult: false, ready: false, birthKey: 0, minor };
    const fields = birthFieldsOf(row, now);
    const side = storedAgeSideOf(st, member, age, {
      birthKey: fields.birthKey, birthExact: fields.birthExact === true, ageConflict: fields.ageConflict === true,
      barred: fields.teenBarred === true || fields.teenHeld === true,
      ...(row.minor_signal_at ? { minorSignalAt: new Date(row.minor_signal_at).getTime() } : {}),
    });
    return { ...side, id, minor };
  });
}

export async function storedTeenStatus(tx: SQL, app: string, oppId: string, now: number, roster: readonly string[] = []): Promise<{ status: StoredTeenStatus; minor: boolean; contactMinor: boolean }> {
  const [saved] = await tx<{ state: NetworkState }[]>`select state from network.network_state
    where app_id=${app} and state->'opps' @> ${tx.json([{ id: oppId }])}::jsonb order by id limit 1`;
  const st = saved?.state;
  const opp: StoredOpp | undefined = st?.opps.find(o => o.id === oppId);
  const marked = !!st && !!opp && opp.teenRuleAt !== undefined;
  if (!marked && !roster.length) return { status: "unmarked", minor: false, contactMinor: false };
  const ids = [...new Set([...(opp ? teenRosterWithHost(opp) : []), ...roster])];
  const sides = ids.length ? await rosterSides(tx, app, st, ids, now) : [];
  const minor = sides.some(x => x.minor);
  const contactMinor = sides.some(side => side.minor && roster.includes(side.id));
  if (!st || !opp || !marked) return { status: "unmarked", minor, contactMinor };
  if (!rosterHasMinor(sides)) return { status: "adult", minor, contactMinor };
  const end = teenMeetingEndOf(opp, now);
  const current = OPEN.has(opp.stage) && teenFriendApp(app) && !storedTeenStop(st) && teenStoredItemShape(app, opp)
    && teenRosterSizeAllowed(true, teenRosterWithHost(opp).length)
    && groupAgeAllowed(true, teenFriendCategory(app, opp.category), earliestDayKeyOf(now), latestDayKeyOf(Math.max(now, end)), sides);
  return { status: current ? "current" : "failed", minor, contactMinor };
}
