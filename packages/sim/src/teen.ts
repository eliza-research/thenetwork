import { ageSideOf, localParts, type AgeSide, type Member } from "@thenetwork/core";
import { teenFriendRole, teenIntroShape } from "../../core/src/generated/friendIntroAge.ts";
import { teenFriendCategory, teenFriendLane, teenGenerator, type MatchLane } from "../../core/src/generated/matchLane.ts";
import { teenMeetingAllowed } from "../../core/src/generated/teenIntroSwitch.ts";

export const UNKNOWN_AGE_SIDE: AgeSide = { adult: false, ready: false, birthKey: 0 };

export const ageSideOrUnknown = (m: Member | undefined): AgeSide => (m ? ageSideOf(m) : UNKNOWN_AGE_SIDE);

export interface TeenShapeInput {
  category?: string; lane?: MatchLane; generator?: string; format?: string;
  roles?: Readonly<Record<string, string>>; via?: unknown; anchor?: { type?: string };
}

export function teenShape(app: string, ids: readonly string[], x: TeenShapeInput): { lane: boolean; laneOk: boolean } {
  const lane = x.category !== undefined && teenFriendCategory(app, x.category) && (x.lane === undefined || teenFriendLane(app, x.lane));
  const everyRoleTeen = ids.every(id => { const role = x.roles?.[id]; return role !== undefined && teenFriendRole(role); });
  const laneOk = lane && x.generator !== undefined && teenGenerator(app, x.generator)
    && x.format !== undefined && teenIntroShape(lane, x.format, everyRoleTeen, x.via !== undefined, x.anchor?.type === "event");
  return { lane, laneOk };
}

export const teenMinutesAllowed = (startMinute: number, minutes: number): boolean =>
  teenMeetingAllowed(true, false, startMinute, startMinute + minutes, false);

export function teenWindowAllowed(tz: string, start: number, end: number): boolean {
  const local = localParts(start, tz);
  return teenMinutesAllowed(local.hour * 60 + local.minute, Math.ceil((end - start) / 60_000));
}
