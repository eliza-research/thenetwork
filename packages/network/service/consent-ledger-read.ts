import type { SQL } from "../../core/src/runtime/postgres.ts";
import { resolveConsent, type ConsentState } from "../../platform/src/consent.ts";
import type { AppId } from "../../platform/src/apps.ts";

export async function ledgerOptedOut(tx: SQL, e164: string, app: AppId): Promise<boolean> {
  const events = await tx<{ app_id: AppId | null; state: ConsentState; at: Date }[]>`select distinct on (app_id) app_id,state,at from platform.consent_events
    where e164=${e164} and (app_id=${app} or app_id is null) order by app_id,at desc,id desc`;
  const event = (scope: AppId | null) => {
    const e = events.find(r => r.app_id === scope);
    return e ? { e164, app: scope, source: "canonical-ledger", state: e.state, at: new Date(e.at).getTime() } : undefined;
  };
  return resolveConsent({ app: event(app), global: event(null) }) === "opted_out";
}

export async function personLedgerOptedOut(tx: SQL, personId: string, app: AppId): Promise<boolean> {
  const phones = await tx<{ e164: string }[]>`select e164 from platform.phone_identities where person_id=${personId} order by e164`;
  for (const phone of phones) if (await ledgerOptedOut(tx, phone.e164, app)) return true;
  return false;
}
