import { phoneChangePagePath } from "../../core/src/generated/phoneChange.ts";

export function phoneChangeLinkRequest(text: string): boolean {
  return /^\s*(?:please\s+)?(?:change|update)\s+(?:my\s+)?(?:phone\s+)?number[\s.!?]*$/i.test(text);
}

export function phoneChangeLinkReply(origin: string): string {
  const page = new URL(phoneChangePagePath, origin);
  return `To change the number on your account, open ${page.href} and sign in with your current number. Then enter the new number and the code that we text to it.`;
}
