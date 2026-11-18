import { homeHelpAddressStep, type HomeHelpAddressStep } from "../../core/src/generated/privateHomeHelpVenue.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { BoundedHomeHelpConsent, HomeHelpConsentKey } from "../src/bounded-home-help-consent.ts";
import { homeHelpPlanCode } from "./bounded-home-help-consent-command.ts";

/** The private page that calls POST /api/home-help/venue. The fragment never reaches a server log. */
export function homeHelpAddressPage(origin: string, key: { id: string; revision: number }): string {
  return `${origin}/home-help#${homeHelpPlanCode(key.id)}-${key.revision}`;
}

const CLOSED = "The private address step for that home-help plan is not open. It opens only when everyone on the current plan agrees.";

function text(step: HomeHelpAddressStep, link: string): string {
  switch (step) {
    case "RequesterAddsAddress": return `Everyone on this plan agreed. Add the street address only on this private page, after you confirm your phone there: ${link}\nDo not send the address in this conversation.`;
    case "RequesterAddressSaved": return `Your address is saved for this plan. Only the people who agreed can read it on the private page. To remove it, use the same page: ${link}`;
    case "HelperReadsAddress": return `The address for this plan is on a private page. Confirm your phone there to read it: ${link}`;
    case "AddressStepClosed": return CLOSED;
    default: { const _exhaustive: never = step; return _exhaustive; }
  }
}

/**
 * spec/privateHomeHelpVenue.md, "The conversation points each participant to the private page".
 * Call inside the signed member's unit after the sender check. The reply carries a link and never the address.
 */
export async function homeHelpAddressReply(tx: SQL, consent: Pick<BoundedHomeHelpConsent, "currentConsent">, key: HomeHelpConsentKey,
  memberId: string, origin: string, now: number): Promise<{ body: string; link?: string }> {
  const plan = await consent.currentConsent(tx, key);
  const [stored] = plan ? await tx`select 1 from network.bounded_home_help_venue
    where app_id=${plan.app} and plan_id=${plan.id} and revision=${plan.revision} and ciphertext is not null
      and expires_at=${new Date(plan.draft.expiresAt)}` : [];
  const step = homeHelpAddressStep(plan?.requesterId === memberId, !!plan?.helperIds.includes(memberId), !!plan, !!stored,
    now, plan?.draft.expiresAt ?? now);
  if (step === "AddressStepClosed") return { body: CLOSED };
  const link = homeHelpAddressPage(origin, key);
  return { body: text(step, link), link };
}
