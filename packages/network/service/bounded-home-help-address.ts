import { homeHelpAddressStep, type HomeHelpAddressStep } from "../../core/src/generated/privateHomeHelpVenue.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { BoundedHomeHelpConsent, HomeHelpConsentKey } from "../src/bounded-home-help-consent.ts";
import { homeHelpPlanCode } from "./bounded-home-help-consent-command.ts";

function homeHelpAddressPage(origin: string, key: { id: string; revision: number }): string {
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

export async function homeHelpAddressStepOf(tx: SQL, consent: Pick<BoundedHomeHelpConsent, "currentConsent">, key: HomeHelpConsentKey,
  memberId: string, now: number): Promise<HomeHelpAddressStep> {
  const plan = await consent.currentConsent(tx, key);
  const [row] = plan ? await tx<{ revision: number; expires_at: Date; sealed: boolean }[]>`select revision, expires_at, ciphertext is not null as sealed
    from network.bounded_home_help_venue where app_id=${plan.app} and plan_id=${plan.id}` : [];
  const stored = !!plan && !!row && row.sealed && row.revision === plan.revision && row.expires_at.getTime() === plan.draft.expiresAt;
  return homeHelpAddressStep(plan?.requesterId === memberId, !!plan?.helperIds.includes(memberId), !!plan, stored, !!row && !stored,
    now, plan?.draft.expiresAt ?? now);
}

type HomeHelpAddressStatus = { role: "requester" | "helper"; addressSaved: boolean };

export function homeHelpAddressStatus(step: HomeHelpAddressStep): HomeHelpAddressStatus | undefined {
  switch (step) {
    case "RequesterAddsAddress": return { role: "requester", addressSaved: false };
    case "RequesterAddressSaved": return { role: "requester", addressSaved: true };
    case "HelperReadsAddress": return { role: "helper", addressSaved: true };
    case "AddressStepClosed": return undefined;
    default: { const _exhaustive: never = step; return _exhaustive; }
  }
}

export async function homeHelpAddressReply(tx: SQL, consent: Pick<BoundedHomeHelpConsent, "currentConsent">, key: HomeHelpConsentKey,
  memberId: string, origin: string, now: number): Promise<{ body: string; link?: string }> {
  const step = await homeHelpAddressStepOf(tx, consent, key, memberId, now);
  if (step === "AddressStepClosed") return { body: CLOSED };
  const link = homeHelpAddressPage(origin, key);
  return { body: text(step, link), link };
}
