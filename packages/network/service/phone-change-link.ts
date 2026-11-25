const PHONE_CHANGE_PAGE = "/phone";

export function phoneChangeLinkRequest(text: string): boolean {
  return /^\s*(?:please\s+)?(?:change|update)\s+(?:my\s+)?(?:phone\s+)?number[\s.!?]*$/i.test(text);
}

export function phoneChangeLinkReply(origin: string): string {
  return `To change the number on your account, open ${origin.replace(/\/+$/, "")}${PHONE_CHANGE_PAGE} and sign in with your current number. Then enter the new number and the code that we text to it.`;
}
