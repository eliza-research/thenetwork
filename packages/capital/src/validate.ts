// Input checks for the NC ledger (audit capital-3). `record` runs `validateCapitalEvent` before it
// changes any state, so a bad event is rejected whole: a NaN time no longer turns off the time-order
// check, an Infinity time no longer locks the ledger, and a NaN count no longer poisons a balance.
import type { CapitalEvent, Verification } from "./types.ts";

/** Thrown by `CapitalLedger.record` for an event it will not take. The ledger is unchanged. */
export class CapitalEventRejected extends Error {
  constructor(readonly eventId: string, readonly reason: string) {
    super(`capital event rejected (${eventId}): ${reason}`);
    this.name = "CapitalEventRejected";
  }
}

const VERIFICATIONS = new Set<Verification>(["counterpart", "checkin", "organizer", "reviewer"]);
const ORIGINS = new Set(["engine", "member", "organizer"]);
const KINDS = new Set(["intro", "group", "plan", "event", "crew"]);
const REMOVAL = new Set(["serious_abuse", "left", "other"]);
const ABUSE = new Set(["spam", "harassment", "scam", "policy"]);
const STATES = new Set(["open", "normal", "quiet", "receiving", "paused"]);

const str = (x: unknown) => typeof x === "string" && x.length > 0;
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const bool = (x: unknown) => typeof x === "boolean";
const ids = (x: unknown) => Array.isArray(x) && x.every(str);
const optIds = (x: unknown) => x === undefined || ids(x);
const verif = (x: unknown) => Array.isArray(x) && x.every(v => VERIFICATIONS.has(v as Verification));
const age = (x: unknown) => x === null || num(x);

/** Why this event is malformed, or undefined when it is well formed. Pure; never throws. */
export function validateCapitalEvent(ev: unknown): string | undefined {
  if (typeof ev !== "object" || ev === null) return "not an object";
  const e = ev as Record<string, unknown>;
  if (!str(e.id)) return "id must be a non-empty string";
  if (!num(e.t)) return "t must be a finite number";
  const need = (ok: boolean, what: string) => (ok ? undefined : what);
  switch (e.type as CapitalEvent["type"]) {
    case "member_joined":
      return need(str(e.member), "member") ?? need(age(e.age), "age must be a finite number or null") ?? need(e.vouchedBy === undefined || str(e.vouchedBy), "vouchedBy");
    case "age_updated":
      return need(str(e.member), "member") ?? need(age(e.age), "age must be a finite number or null");
    case "member_activated": case "data_shared": case "help_asked":
      return need(str(e.member), "member");
    case "value_received":
      return need(str(e.member), "member") ?? need(ids(e.with), "with must be member ids") ?? need(optIds(e.confirmedBy), "confirmedBy")
        ?? need(e.verifiedBy === undefined || verif(e.verifiedBy), "verifiedBy");
    case "safety_flag":
      return need(str(e.member), "member") ?? need(bool(e.serious), "serious");
    case "member_removed":
      return need(str(e.member), "member") ?? need(REMOVAL.has(e.reason as string), "reason");
    case "abuse_confirmed":
      return need(str(e.member), "member") ?? need(ABUSE.has(e.kind as string), "kind");
    case "plan_accepted":
      return need(str(e.member), "member") ?? need(str(e.planId), "planId") ?? need(KINDS.has(e.kind as string), "kind") ?? need(num(e.startsAt), "startsAt must be a finite number");
    case "plan_confirmed": case "plan_cancelled": case "plan_no_show": case "plan_ghosted": case "feedback_given":
      return need(str(e.member), "member") ?? need(str(e.planId), "planId");
    case "plan_attended":
      return need(str(e.member), "member") ?? need(str(e.planId), "planId") ?? need(ids(e.counterparts), "counterparts") ?? need(verif(e.verifiedBy), "verifiedBy")
        ?? need(ORIGINS.has(e.origin as string), "origin") ?? need(bool(e.publicVenue), "publicVenue") ?? need(optIds(e.confirmers), "confirmers");
    case "help_given":
      return need(str(e.helper), "helper") ?? need(str(e.recipient), "recipient") ?? need(str(e.helpId), "helpId");
    case "help_confirmed":
      return need(str(e.helpId), "helpId") ?? need(str(e.recipient), "recipient") ?? need(bool(e.useful), "useful");
    case "organized":
      return need(str(e.organizer), "organizer") ?? need(str(e.planId), "planId") ?? need(bool(e.publicVenue), "publicVenue") ?? need(bool(e.recurring), "recurring")
        ?? need(ids(e.attendees), "attendees") ?? need(typeof e.label === "string", "label");
    case "need_answered":
      return need(str(e.member), "member") ?? need(str(e.needId), "needId") ?? need(str(e.confirmedBy), "confirmedBy") ?? need(e.label === undefined || typeof e.label === "string", "label");
    case "review_completed":
      return need(str(e.member), "member") ?? need(num(e.items) && (e.items as number) >= 0, "items must be a finite number, 0 or more");
    case "fraud_confirmed":
      return need(ids(e.members) && (e.members as unknown[]).length > 0, "members must be a non-empty list of member ids");
    case "declined":
      return need(str(e.member), "member") ?? need(e.planId === undefined || str(e.planId), "planId");
    case "state_changed":
      return need(str(e.member), "member") ?? need(STATES.has(e.state as string), "state");
    default:
      return `unknown type ${JSON.stringify(e.type)}`;
  }
}
