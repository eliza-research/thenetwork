import { DAY, HOUR } from "@thenetwork/core";
import { homeHelpDraftAllowed, type HomeHelpAlternative, type HomeHelpTask } from "../../core/src/generated/boundedHelp.ts";
import { parseHomeHelpDraft, type HomeHelpDraft } from "../src/bounded-help.ts";
import { NEIGHBORHOOD } from "../src/geo.ts";
import { homeHelpPlanId } from "./bounded-home-help-consent-command.ts";

type HomeHelpDetails = Omit<HomeHelpDraft, "expiresAt">;
type HomeHelpVersion = { id: string; revision: number };

export type BoundedHomeHelpCommand =
  | { kind: "submit"; draft: HomeHelpDetails }
  | ({ kind: "revise"; draft: HomeHelpDetails } & HomeHelpVersion)
  | ({ kind: "close" } & HomeHelpVersion)
  | { kind: "offer" }
  | { kind: "withdraw_offer" }
  | { kind: "invalid" };

const INTAKE_FIELDS = "task | NYC neighborhood | start | end | whole minutes | service choice";
const INTAKE_CHOICES = "For the task, use move furniture or carry boxes. For the service choice, use no suitable service, service unavailable, or declined service. Use YYYY-MM-DDTHH:mm with Z or an offset such as -05:00.";

export const BOUNDED_HOME_HELP_PROMPT = [
  "A team member must review home help before anyone can be asked. No one has been contacted.",
  "Consider a service first. Reply with only the fields below. Leave out the street address.",
  `SUBMIT HOME HELP | ${INTAKE_FIELDS}`,
  INTAKE_CHOICES,
].join("\n");

export const BOUNDED_HOME_HELP_CLARIFICATION = [
  "I need one of these formats for home help. Use the plan ID and current revision for an update or closure.",
  `SUBMIT HOME HELP | ${INTAKE_FIELDS}`,
  `REVISE HOME HELP <plan ID> <revision> | ${INTAKE_FIELDS}`,
  "CLOSE HOME HELP <plan ID> <revision>",
  INTAKE_CHOICES,
  "Leave out the street address.",
].join("\n");

const TASKS = new Map<string, HomeHelpTask>([["move furniture", "MoveFurniture"], ["carry boxes", "CarryBoxes"]]);
const ALTERNATIVES = new Map<string, HomeHelpAlternative>([
  ["no suitable service", "NoSuitableService"], ["service unavailable", "ServiceUnavailable"], ["declined service", "MemberDeclinedService"],
]);
const AREAS = new Map([...NEIGHBORHOOD.keys()].map(area => [area.toLowerCase(), area]));
const MAX_SQL_INT = 2_147_483_647;

function positiveInteger(text: string): number | undefined {
  if (!/^[1-9]\d{0,9}$/.test(text)) return;
  const value = Number(text);
  if (value <= MAX_SQL_INT) return value;
}

/** Accept only an explicit instant and reject calendar dates that Date.parse would roll forward. */
function zonedInstant(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-](\d{2}):(\d{2}))$/i.exec(text);
  if (!match) return;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHours, offsetMinutes] = match;
  const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > (monthDays[month - 1] ?? 0) || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText ?? 0) > 59) return;
  const tzHours = Number(offsetHours ?? 0), tzMinutes = Number(offsetMinutes ?? 0);
  if (zone === "-00:00" || tzMinutes > 59 || tzHours * 60 + tzMinutes > 14 * 60) return;
  const result = Date.parse(text);
  if (Number.isSafeInteger(result) && result >= 0) return result;
}

function parseDetails(fields: string[]): HomeHelpDetails | undefined {
  if (fields.length !== 6) return;
  const [taskText, areaText, startText, endText, minutesText, alternativeText] = fields;
  const task = TASKS.get(taskText!.toLowerCase()), area = AREAS.get(areaText!.toLowerCase());
  const startsAt = zonedInstant(startText!), endsAt = zonedInstant(endText!);
  const effortMinutes = positiveInteger(minutesText!), alternative = ALTERNATIVES.get(alternativeText!.toLowerCase());
  if (task && area && startsAt !== undefined && endsAt !== undefined && effortMinutes !== undefined && alternative) {
    return { task, area, startsAt, endsAt, effortMinutes, alternative };
  }
}

/** Parse an explicit signed member command. The caller owns authentication, authorization and storage. */
export function boundedHomeHelpCommand(text: string): BoundedHomeHelpCommand | undefined {
  const normalized = text.normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/gu, " ").trim();
  if (/^offer home help$/i.test(normalized)) return { kind: "offer" };
  if (/^withdraw home help offer$/i.test(normalized)) return { kind: "withdraw_offer" };
  if (/^(?:offer home help|withdraw home help offer)\b/i.test(normalized)) return { kind: "invalid" };
  if (!/^(?:submit|revise|close) home help\b/i.test(normalized)) return;
  if (normalized.length > 512) return { kind: "invalid" };
  const [head, ...fields] = normalized.split("|").map(part => part.trim());
  if (head?.toLowerCase() === "submit home help") {
    const draft = parseDetails(fields);
    return draft ? { kind: "submit", draft } : { kind: "invalid" };
  }
  const version = /^(revise|close) home help (\S+) ([1-9]\d{0,9})$/i.exec(head ?? "");
  if (!version) return { kind: "invalid" };
  const [, action, rawId, rawRevision] = version;
  const id = homeHelpPlanId(rawId!), revision = positiveInteger(rawRevision!);
  if (!id || revision === undefined) return { kind: "invalid" };
  if (action!.toLowerCase() === "close") return fields.length ? { kind: "invalid" } : { kind: "close", id, revision };
  const draft = parseDetails(fields);
  return draft ? { kind: "revise", id, revision, draft } : { kind: "invalid" };
}

/** Use the ordinary review SLA or one hour for a same-day window. A revision never extends the deadline. */
export function boundedHomeHelpDraft(
  details: HomeHelpDetails,
  now: number,
  { reviewSlaHours = 12, previousExpiresAt }: { reviewSlaHours?: number; previousExpiresAt?: number } = {},
): HomeHelpDraft | undefined {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(reviewSlaHours) || reviewSlaHours <= 0
    || (previousExpiresAt !== undefined && !Number.isSafeInteger(previousExpiresAt))) return;
  const reviewWindow = Math.trunc((details.endsAt - now <= DAY ? 1 : reviewSlaHours) * HOUR);
  const expiresAt = Math.min(details.startsAt, now + reviewWindow, previousExpiresAt ?? Infinity);
  const draft = parseHomeHelpDraft({ ...details, expiresAt });
  if (draft && homeHelpDraftAllowed(true, true, true, true, now, expiresAt, draft.startsAt, draft.endsAt, draft.effortMinutes)) {
    return draft;
  }
}
