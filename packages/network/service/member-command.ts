import type { City, Preferences } from "@thenetwork/core";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import type { Accounts } from "../../platform/src/accounts.ts";

export interface MemberCommandOwner { app: AppInfo; memberId: string; e164: string }
interface MemberRow { home_city: City; home_area: string | null; prefs: Partial<Preferences> }

export async function memberCommandOwner(tx: SQL, accounts: Pick<Accounts, "activeMembership">, owner: MemberCommandOwner) {
  const { app, memberId, e164 } = owner;
  const binding = await accounts.activeMembership(app, { e164, personId: null });
  if (!binding || binding.membership.memberId !== memberId) return;
  const [member] = await tx<MemberRow[]>`select home_city, home_area, prefs from network.members where app_id=${app.id} and id=${memberId}
    and person_id=${binding.person.id} and account_status='active' and not opted_out for update`;
  return { person: binding.person, member };
}
