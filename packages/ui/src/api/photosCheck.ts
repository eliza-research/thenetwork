// spec/photosCheckPage.md, "The open answer shows the proposal, the photos to choose from, or why the link does not work"
import { photoPagePurposeHeader } from "../../../core/src/generated/photoRelayItem.ts";
import type { CheckAnswer, CheckAnswerKind, CheckOpenAnswer, CheckOpenAnswerKind } from "../../../core/src/generated/photosCheckPage.ts";
import { type StepAnswer, stepCall } from "./stepPages.ts";

/** One photo of the member as the check page shows it: its number, its name, the day it was added (`YYYY-MM-DD` in the member's zone), and if the receiver already has it. */
export interface CheckPhoto {
  n: number;
  label: string | null;
  addedOn: string;
  shared: boolean;
}

/** What the open answer gives the page: the receiver's first name, the notice, the revision, every photo and the numbers that the proposal names. */
export interface CheckProposal {
  toFirstName: string;
  notice: string;
  revision: number;
  photos: CheckPhoto[];
  proposed: number[];
}

/** What the page asks: send the proposal that it shows, or ask for a new proposal of the marked numbers. */
export type CheckRequest = { answer: "send" } | { answer: "pick"; numbers: readonly number[] };

/** The answer to "Send" or "Choose these": the machine answer, the text from the server, the new proposal and its revision. */
export interface CheckReply {
  answer: CheckAnswer;
  text: string;
  proposed: number[];
  revision: number | undefined;
}

const pagePath = "/api/photos/page/";
const pageHeaders = { [photoPagePurposeHeader]: "check" };
const slotsMax = 6;
const textMax = 1600;
const nameMax = 30;
const labelMax = 24;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

const photoOf = (value: unknown): CheckPhoto | undefined => {
  if (!isRecord(value)) return undefined;
  const { n, label, addedOn, shared } = value;
  if (!isCount(n) || n > slotsMax) return undefined;
  if (label !== null && (typeof label !== "string" || label.length > labelMax)) return undefined;
  if (typeof addedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(addedOn)) return undefined;
  if (typeof shared !== "boolean") return undefined;
  return { n, label, addedOn, shared };
};

/**
 * Reads a list of distinct photo numbers that are all in `known`. Returns undefined for anything else.
 * @model spec/photosCheckPage.md
 */
export function checkNumbersIn(value: unknown, known: readonly number[]): number[] | undefined {
  if (!Array.isArray(value) || !value.every((n) => isCount(n) && known.includes(n))) return undefined;
  const numbers = value as number[];
  return new Set(numbers).size === numbers.length ? [...numbers].sort((a, b) => a - b) : undefined;
}

const proposalOf = (data: Readonly<Record<string, unknown>>): CheckProposal | undefined => {
  const { purpose, toFirstName, notice, revision, photos, proposed } = data;
  if (purpose !== "check" || typeof toFirstName !== "string" || toFirstName.trim() === "" || toFirstName.length > nameMax) return undefined;
  if (typeof notice !== "string" || notice.length > textMax || !isCount(revision) || !Array.isArray(photos)) return undefined;
  const list = photos.map(photoOf);
  if (list.some((photo) => photo === undefined)) return undefined;
  const shown = list as CheckPhoto[];
  const numbers = shown.map((photo) => photo.n);
  if (new Set(numbers).size !== numbers.length) return undefined;
  const named = checkNumbersIn(proposed, numbers);
  if (!named) return undefined;
  const name = toFirstName.trim();
  return { toFirstName: name, notice: notice.replaceAll("{{recipient}}", name), revision, photos: [...shown].sort((a, b) => a.n - b.n), proposed: named };
};

const openKindOf = (answer: StepAnswer): CheckOpenAnswerKind => {
  if (!answer.reached) return "CheckOpenUnreachable";
  const { status, code } = answer;
  if (status === 200) return "CheckOpenShown";
  if (status === 404 && code === "link_unavailable") return "CheckOpenGone";
  if (status === 410 && code === "link_expired") return "CheckOpenExpired";
  if (status === 403 && code === "other_device") return "CheckOpenOtherDevice";
  if (status === 502 || status === 503) return "CheckOpenUnreachable";
  return "CheckOpenInvalid";
};

/**
 * Opens the check link once. The token goes only in the JSON body, never in the address. The first open binds the link to this browser with a cookie.
 * A 200 with a body that the page cannot read is a page fault (`CheckOpenInvalid`).
 * @model spec/photosCheckPage.md
 */
export async function openPhotoCheck(token: string): Promise<{ opened: CheckOpenAnswer; proposal: CheckProposal | undefined }> {
  const answer = await stepCall(`${pagePath}open`, { method: "POST", json: { token }, headers: pageHeaders });
  const kind = openKindOf(answer);
  if (kind !== "CheckOpenShown" || !answer.reached) return { opened: { kind, photoCount: 0, proposedCount: 0 }, proposal: undefined };
  const proposal = proposalOf(answer.data);
  if (!proposal) return { opened: { kind: "CheckOpenInvalid", photoCount: 0, proposedCount: 0 }, proposal: undefined };
  return { opened: { kind, photoCount: proposal.photos.length, proposedCount: proposal.proposed.length }, proposal };
}

const statesShown: Readonly<Record<string, CheckAnswerKind>> = {
  offered: "CheckOffered",
  proposed: "CheckProposed",
  changed: "CheckChanged",
  lapsed: "CheckLapsed",
  refused: "CheckRefused",
  cancelled: "CheckClosed",
};

const answerKindOf = (answer: StepAnswer): CheckAnswerKind => {
  if (!answer.reached) return "CheckUnreachable";
  const { status, code, data } = answer;
  if (status === 200) return (typeof data.state === "string" ? statesShown[data.state] : undefined) ?? "CheckInvalid";
  if (status === 404 && code === "link_unavailable") return "CheckClosed";
  if (status === 410 && code === "link_expired") return "CheckLapsed";
  if (status === 403 && code === "other_device") return "CheckOtherDevice";
  if (status === 502 || status === 503) return "CheckUnreachable";
  return "CheckInvalid";
};

const textOf = (answer: StepAnswer): string => {
  if (!answer.reached || typeof answer.data.text !== "string") return "";
  const text = answer.data.text.trim();
  return text.length <= textMax ? text : "";
};

/**
 * Sends "Send" or "Choose these" with the revision of the proposal that the page shows. `known` holds the numbers of the photos that the page shows:
 * a new proposal that names any other number is a page fault (`CheckInvalid`).
 * @model spec/photosCheckPage.md
 */
export async function answerPhotoCheck(token: string, revision: number, request: CheckRequest, known: readonly number[]): Promise<CheckReply> {
  const json = request.answer === "pick" ? { token, revision, answer: "pick", numbers: [...request.numbers] } : { token, revision, answer: "send" };
  const answer = await stepCall(`${pagePath}answer`, { method: "POST", json, headers: pageHeaders });
  const kind = answerKindOf(answer);
  if (kind !== "CheckProposed" || !answer.reached) return { answer: { kind, proposedCount: 0 }, text: kind === "CheckOffered" || kind === "CheckRefused" ? textOf(answer) : "", proposed: [], revision: undefined };
  const proposed = checkNumbersIn(answer.data.proposed, known);
  if (!proposed) return { answer: { kind: "CheckInvalid", proposedCount: 0 }, text: "", proposed: [], revision: undefined };
  const next = answer.data.revision;
  return { answer: { kind, proposedCount: proposed.length }, text: "", proposed, revision: isCount(next) ? next : undefined };
}

/**
 * Loads one photo as bytes through a POST, so that the token never goes in an image address. Returns undefined when the photo does not load.
 * @model spec/photosCheckPage.md
 */
export async function loadCheckPhoto(token: string, n: number): Promise<Blob | undefined> {
  try {
    const response = await fetch(`${pagePath}image`, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...pageHeaders, "content-type": "application/json", accept: "image/*" },
      body: JSON.stringify({ token, n }),
    });
    if (response.status !== 200 || !(response.headers.get("content-type") ?? "").startsWith("image/")) return undefined;
    return await response.blob();
  } catch {
    return undefined;
  }
}
