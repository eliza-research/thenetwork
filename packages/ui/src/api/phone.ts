// spec/phonePage.md, "The new number goes to the server only when it is valid and the mode is known"
import type { PhoneConfirmAnswer, PhoneStartAnswer } from "../../../core/src/generated/phonePage.ts";
import { type StepAnswer, stepCall } from "./stepPages.ts";

const unreachable = (result: StepAnswer): boolean => !result.reached || result.status === 502 || result.status === 503;

const startRefusals: Readonly<Record<string, PhoneStartAnswer>> = {
  "400 invalid_phone": "PhoneStartInvalidPhone",
  "400 same_number": "PhoneStartSameNumber",
  "400 no_person": "PhoneStartNoPerson",
  "403 reauth": "PhoneStartReauth",
  "403 review": "PhoneStartReview",
};

const confirmRefusals: Readonly<Record<string, PhoneConfirmAnswer>> = {
  "400 invalid_code": "PhoneConfirmInvalidCode",
  "400 no_person": "PhoneConfirmNoPerson",
  "403 review": "PhoneConfirmReview",
  "409 no_pending_change": "PhoneConfirmNoPending",
  "409 number_in_use": "PhoneConfirmNumberInUse",
};

/** The answer to a change start, with the wait in whole seconds from `retry-after` when the server refused for too many tries. */
export interface PhoneStartResult {
  answer: PhoneStartAnswer;
  retryAfterSeconds?: number;
}

/**
 * Asks the server to text a change code to the new number (`POST /api/me/phone/start`). The server `message` is not shown: the page has its own fixed copy.
 * @model spec/phonePage.md
 */
export async function startNumberChange(phone: string): Promise<PhoneStartResult> {
  const result = await stepCall("/api/me/phone/start", { method: "POST", json: { phone } });
  if (!result.reached || unreachable(result)) return { answer: "PhoneStartUnreachable" };
  if (result.status === 200) return { answer: "PhoneStartSent" };
  if (result.status === 401) return { answer: "PhoneStartSignedOut" };
  if (result.status === 429) return { answer: "PhoneStartRateLimited", ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }) };
  return { answer: startRefusals[`${result.status} ${result.code}`] ?? "PhoneStartFailed" };
}

/** The answer to a change code, with the masked new number that the server gives on a move. */
export interface ConfirmAnswer {
  answer: PhoneConfirmAnswer;
  phoneMasked?: string;
}

/**
 * Sends the change code from the text to the new number (`POST /api/me/phone/confirm`).
 * @model spec/phonePage.md
 */
export async function confirmNumberChange(code: string): Promise<ConfirmAnswer> {
  const result = await stepCall("/api/me/phone/confirm", { method: "POST", json: { code } });
  if (!result.reached || unreachable(result)) return { answer: "PhoneConfirmUnreachable" };
  if (result.status === 200) {
    const { phoneMasked } = result.data;
    return { answer: "PhoneConfirmMoved", ...(typeof phoneMasked === "string" ? { phoneMasked } : {}) };
  }
  if (result.status === 401) return { answer: "PhoneConfirmSignedOut" };
  return { answer: confirmRefusals[`${result.status} ${result.code}`] ?? "PhoneConfirmFailed" };
}
