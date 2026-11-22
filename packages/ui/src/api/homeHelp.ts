// spec/homeHelpPage.md, "The page reads the plan code and the revision from the fragment, and a bad link stops the page"
import {
  type HelpAddressCheck,
  type HelpLinkSource,
  type HelpPlanCode,
  type HelpVenueAnswer,
  homeHelpAddressCheck,
  homeHelpLinkWellFormed,
  homeHelpRevisionAccepted,
} from "../../../core/src/generated/homeHelpPage.ts";
import { stepCall, type StepAnswer } from "./stepPages.ts";

/** The plan and the revision that a home-help link names. */
export interface HomeHelpLink {
  /** The plan code from the link: `hh_` and 32 letters, or a UUID. The server decodes it. */
  id: string;
  /** The reviewed revision of the plan, from 1 to 2147483647. */
  revision: number;
}

/** What the page read from the link. `link` is set only when the link is well formed. */
export interface HomeHelpLinkRead {
  source: HelpLinkSource;
  wellFormed: boolean;
  link?: HomeHelpLink;
  /** The link as the page keeps it across Cloud sign-in: `<code>-<revision>`, or "" when there is no link. */
  text: string;
}

/** The three actions of the address step. */
export type VenueAction = "submit" | "reveal" | "revoke";

/** One server answer of the address step, and the address only for a revealed answer. */
export interface VenueResult {
  answer: HelpVenueAnswer;
  address?: string;
}

const shortCode = /^hh_[a-p]{32}$/;
const uuidCode = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badAddressChars = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

const planCodeOf = (code: string): HelpPlanCode => (shortCode.test(code) ? "PlanCodeShort" : uuidCode.test(code) ? "PlanCodeUuid" : "PlanCodeBad");

/**
 * Reads a home-help link: the plan code and the revision, split at the last "-". The generated decisions say if it is well formed.
 * @param fragment The fragment without "#", from the address or from the link kept before Cloud sign-in.
 * @param kept True when the fragment is the kept link.
 * @model spec/homeHelpPage.md
 */
export function parseHomeHelpLink(fragment: string, kept = false): HomeHelpLinkRead {
  const text = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (text === "") return { source: "LinkMissing", wellFormed: false, text: "" };
  const source: HelpLinkSource = kept ? "LinkFromKept" : "LinkFromAddress";
  const split = text.lastIndexOf("-");
  const id = split < 0 ? text : text.slice(0, split);
  const revisionText = split < 0 ? "" : text.slice(split + 1);
  const digitsOnly = /^\d+$/.test(revisionText);
  const revision = digitsOnly ? Number(revisionText) : 0;
  const wellFormed = homeHelpLinkWellFormed(planCodeOf(id), homeHelpRevisionAccepted(digitsOnly, revisionText.length, revision));
  return wellFormed ? { source, wellFormed, link: { id, revision }, text: `${id}-${revision}` } : { source, wellFormed, text: "" };
}

/**
 * Checks the trimmed address with the generated decision: empty, bad characters, or more than 300 characters or UTF-8 bytes.
 * @model spec/homeHelpPage.md
 */
export function addressCheckOf(address: string): HelpAddressCheck {
  const trimmed = address.trim();
  return homeHelpAddressCheck(trimmed === "", [...trimmed].length, new TextEncoder().encode(trimmed).length, badAddressChars.test(trimmed));
}

/**
 * The JSON body of one request: exactly `action`, `id` and `revision`, and `address` only for a submit.
 * @model spec/homeHelpPage.md
 */
export function venueBody(action: VenueAction, link: HomeHelpLink, address?: string): Readonly<Record<string, unknown>> {
  const base = { action, id: link.id, revision: link.revision };
  return action === "submit" ? { ...base, address: (address ?? "").trim() } : base;
}

/**
 * Maps one server answer to one answer of the page machine. Each status and code goes to one answer.
 * @model spec/homeHelpPage.md
 */
export function venueAnswerOf(action: VenueAction, answer: StepAnswer): VenueResult {
  if (!answer.reached) return { answer: "VenueUnreachable" };
  switch (answer.status) {
    case 200: {
      if (action === "submit") return { answer: "VenueStored" };
      if (action === "revoke") return { answer: "VenueRemoved" };
      const address = answer.data.address;
      return typeof address === "string" && address !== "" ? { answer: "VenueRevealed", address } : { answer: "VenueFailed" };
    }
    case 401:
      return { answer: "VenueSignedOut" };
    case 404:
      return { answer: "VenueNotWired" };
    case 409:
      return { answer: "VenueClosed" };
    case 502:
      return { answer: "VenueUnreachable" };
    case 503:
      return { answer: answer.code === "proxy_not_configured" ? "VenueUnreachable" : "VenueServerError" };
    default:
      return { answer: "VenueFailed" };
  }
}

/**
 * Sends one action of the address step to `POST /api/home-help/venue` on the page's own origin.
 * The revealed address is returned to the caller only. Nothing here logs or stores it.
 * @model spec/homeHelpPage.md
 */
export async function sendVenue(action: VenueAction, link: HomeHelpLink, address?: string): Promise<VenueResult> {
  return venueAnswerOf(action, await stepCall("/api/home-help/venue", { method: "POST", json: venueBody(action, link, address) }));
}
