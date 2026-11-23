import type { HomeHelpConsentNotice } from "../src/bounded-home-help-consent.ts";
import { NY } from "../src/outreach.ts";

const ACTIONS = { yes: "accept", no: "decline", withdraw: "withdraw" } as const;
const MAX_REVISION = 2_147_483_647;
const PREFIX = /^(?:yes|no|withdraw)[ \t]+home[ \t]+help\b/i;
const OFFER = /^withdraw[ \t]+home[ \t]+help[ \t]+offer\b/i;
const ANSWER = /^(yes|no|withdraw)[ \t]+home[ \t]+help[ \t]+([a-z0-9_-]{1,36})[ \t]+([1-9]\d{0,9})$/i;
const ADDRESS_PREFIX = /^home[ \t]+help[ \t]+address\b/i;
const ADDRESS = /^home[ \t]+help[ \t]+address[ \t]+([a-z0-9_-]{1,36})[ \t]+([1-9]\d{0,9})$/i;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const DISPLAY_CODE = /^hh_([a-p]{8})([a-p]{4})([a-p]{4})([a-p]{4})([a-p]{12})$/;
const HEX = "0123456789abcdef";
const LETTERS = "abcdefghijklmnop";

/** Display the same plan ID without digit runs that the contact leak guard can read as a phone. */
export function homeHelpPlanCode(id: string): string {
  return `hh_${id.toLowerCase().replaceAll("-", "").replace(/[0-9a-f]/g, digit => LETTERS.charAt(HEX.indexOf(digit)))}`;
}

/** Decode the displayed plan ID or a canonical UUID from an earlier intake message. */
export function homeHelpPlanId(code: string): string | undefined {
  const key = code.toLowerCase();
  if (UUID.test(key)) return key;
  const match = DISPLAY_CODE.exec(key);
  if (match) return match.slice(1).join("-").replace(/[a-p]/g, letter => HEX.charAt(LETTERS.indexOf(letter)));
}

export type BoundedHomeHelpConsentCommand =
  | { kind: "answer"; id: string; revision: number; decision: typeof ACTIONS[keyof typeof ACTIONS] }
  | { kind: "address"; id: string; revision: number }
  | { kind: "invalid" };

export const BOUNDED_HOME_HELP_CONSENT_CLARIFICATION = "To answer, copy an exact command from the home-help message. Include the plan ID and revision. Leave out the street address.";

function homeHelpAddressCommand(key: { id: string; revision: number }): string {
  return `HOME HELP ADDRESS ${homeHelpPlanCode(key.id)} ${key.revision}`;
}

/** Decode text from the signed member turn. The app, member, and phone come from the authenticated turn. */
export function boundedHomeHelpConsentCommand(text: string): BoundedHomeHelpConsentCommand | undefined {
  const line = text.trim();
  if (ADDRESS_PREFIX.test(line)) {
    const [, code, rawRevision] = ADDRESS.exec(line) ?? [];
    const id = code && homeHelpPlanId(code), revision = Number(rawRevision);
    return id && revision <= MAX_REVISION ? { kind: "address", id, revision } : { kind: "invalid" };
  }
  if (!PREFIX.test(line) || OFFER.test(line)) return;
  const [, verb, code, rawRevision] = ANSWER.exec(line) ?? [];
  if (!verb || !code || !rawRevision) return { kind: "invalid" };
  const id = homeHelpPlanId(code);
  const action = verb.toLowerCase();
  const revision = Number(rawRevision);
  if (!id || revision > MAX_REVISION || (action !== "yes" && action !== "no" && action !== "withdraw")) return { kind: "invalid" };
  return { kind: "answer", id, revision, decision: ACTIONS[action] };
}

type CardDetails = Pick<HomeHelpConsentNotice, "id" | "revision" | "role" | "task" | "area" | "effortMinutes" | "startsAt" | "endsAt">;
const TASK = { MoveFurniture: "Move furniture", CarryBoxes: "Carry boxes" } satisfies Record<CardDetails["task"], string>;
const SCHEDULE = new Intl.DateTimeFormat("en-US", {
  timeZone: NY, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

/** Render only the coarse details of an authorized pending notice. The queue applies its leak guard. */
export function boundedHomeHelpConsentCard(notice: CardDetails): string {
  const { id, revision, role, task, area, effortMinutes, startsAt, endsAt } = notice;
  const key = `${homeHelpPlanCode(id)} ${revision}`;
  return [
    role === "requester" ? "Do you agree to this home-help plan?" : "Can you help with this home-help plan?",
    `${TASK[task]} inside a home in ${area}, NYC. About ${effortMinutes} minutes of help.`,
    `${SCHEDULE.formatRange(startsAt, endsAt)}.`,
    "If everyone agrees, only this group can get the address in a private session.",
    `YES HOME HELP ${key}`,
    `NO HOME HELP ${key}`,
    "You can withdraw a yes with this command.",
    `WITHDRAW HOME HELP ${key}`,
    "Reply STOP anytime to opt out.",
  ].join("\n");
}

const REPLY = {
  Accepted: "I've recorded your yes. The address stays private until everyone agrees.",
  Declined: "I've recorded your decline.",
  Withdrawn: "I've withdrawn your consent.",
};

/** Acknowledge only the sender's own choice. A stale or ineligible command gets the same answer. */
export function boundedHomeHelpConsentReply(result: keyof typeof REPLY | undefined, key: { id: string; revision: number }): string {
  if (!result) return "That home-help plan is unavailable. Check the plan ID and revision on your message.";
  return result === "Accepted" ? `${REPLY.Accepted} To check the private address step, send:\n${homeHelpAddressCommand(key)}` : REPLY[result];
}
