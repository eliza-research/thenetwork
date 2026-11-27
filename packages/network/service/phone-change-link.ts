const PHONE_CHANGE_PAGE = "/phone";

const NUMBER_TAIL = String.raw`(?:(?:\s+(?:to|is)|\s*:)\s*[+]?\d[\d\s().-]{5,}\d)?`;
const OWN_NUMBER = String.raw`(?:my\s+)?(?:phone\s+)?number`;

const PHONE_CHANGE_REQUEST = new RegExp(String.raw`^\s*(?:please\s+)?(?:(?:change|update)\s+${OWN_NUMBER}|i\s+(?:just\s+)?(?:have\s+)?(?:changed|switched|moved)\s+${OWN_NUMBER}|my\s+(?:phone\s+)?number\s+(?:has\s+)?changed|i\s+(?:have|got)\s+a\s+new\s+(?:phone\s+)?number|my\s+new\s+(?:phone\s+)?number)${NUMBER_TAIL}[\s.!?]*$`, "i");

export function phoneChangeLinkRequest(text: string): boolean {
  return PHONE_CHANGE_REQUEST.test(text);
}

export function phoneChangeLinkReply(origin: string): string {
  return `To change the number on your account, open ${origin.replace(/\/+$/, "")}${PHONE_CHANGE_PAGE} and sign in with your current number. Then enter the new number and the code that we text to it.`;
}
