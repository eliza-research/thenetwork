import type { SQL } from "../../core/src/runtime/postgres.ts";
import { resolveConsent } from "../../platform/src/consent.ts";
import type { AppId } from "../../platform/src/apps.ts";

/** The canonical consent ledger for one number and app: STOP is canonical before its projection reaches the member row. */
export async function ledgerOptedOut(tx: SQL, e164: string, app: AppId): Promise<boolean> {
  const events = await tx`select distinct on (app_id) app_id,state,at from platform.consent_events
    where e164=${e164} and (app_id=${app} or app_id is null) order by app_id,at desc,id desc`;
  const event = (scope: AppId | null) => {
    const e = events.find((r: any) => r.app_id === scope);
    return e ? { e164, app: scope, source: "canonical-ledger", state: e.state, at: new Date(e.at).getTime() } : undefined;
  };
  return resolveConsent({ app: event(app), global: event(null) }) === "opted_out";
}

/** True when the ledger of any number of the person says STOP for this app. */
export async function personLedgerOptedOut(tx: SQL, personId: string, app: AppId): Promise<boolean> {
  const phones = await tx`select e164 from platform.phone_identities where person_id=${personId} order by e164`;
  for (const phone of phones) if (await ledgerOptedOut(tx, phone.e164 as string, app)) return true;
  return false;
}
