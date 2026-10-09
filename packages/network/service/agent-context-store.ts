/**
 * Context-only adapter for a trusted host's verified phone and exact app membership.
 * Reads the canonical runtime snapshot; it provides no state or signal write methods.
 * Receiving and unknown participation states are unavailable because the plugin cannot
 * represent them. Windows and member-safe active-item summaries have no canonical owner yet.
 */
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { normalizePhone } from "../../platform/src/phone.ts";
import { outputLeaks } from "../../mcp/src/leaks.ts";
import { assertNetworkMemberScope, NETWORK_STATE_TO_PARTICIPATION } from "../../plugin-network/src/types.ts";
import type { NetworkContextStore, NetworkMemberContext, NetworkMemberScope } from "../../plugin-network/src/types.ts";
import type { NetworkRuntime } from "./runtime.ts";

export interface AgentContextStoreOptions extends NetworkMemberScope {
  /** Already verified by the trusted host; never taken from model output. */
  e164: string;
  personId: string;
  accounts: Pick<Accounts, "activeMembership">;
  runtime: NetworkRuntime;
}

export class AgentContextStore implements NetworkContextStore {
  private readonly options: Readonly<AgentContextStoreOptions>;

  constructor(options: AgentContextStoreOptions) {
    assertNetworkMemberScope(options);
    if (normalizePhone(options.e164) !== options.e164 || !options.personId.trim()
      || options.runtime.app.id !== options.app) throw new Error("Invalid Network context binding");
    this.options = Object.freeze({ ...options });
  }

  private async authorized(): Promise<boolean> {
    const o = this.options;
    const binding = await o.accounts.activeMembership(o.runtime.app, { e164: o.e164, personId: o.personId });
    return !!binding && binding.person.id === o.personId && binding.membership.app === o.app
      && binding.membership.personId === o.personId && binding.membership.memberId === o.memberId;
  }

  async getMemberContext(memberId: string, app: AppId): Promise<NetworkMemberContext | null> {
    const o = this.options;
    if (app !== o.app || memberId !== o.memberId || !(await this.authorized())) return null;
    return o.runtime.readSnapshot(async snapshot => {
      // A prior lookup is not a durable grant. Recheck after acquiring the runtime read lock.
      if (!(await this.authorized())) return null;
      const member = snapshot.members.find(m => m.id === memberId);
      if (!member) return null;
      const state = member.state === "open" || member.state === NETWORK_STATE_TO_PARTICIPATION.open ? "open"
        : member.state === NETWORK_STATE_TO_PARTICIPATION.busy ? "busy"
        : member.state === NETWORK_STATE_TO_PARTICIPATION.paused ? "paused" : null;
      if (!state) return null;
      const firstName = member.name.trim().split(/\s+/)[0] ?? "";
      const forbidden = [
        ...snapshot.members.flatMap(m => {
          if (m.id === memberId) return [m.id];
          const otherFirstName = m.name.trim().split(/\s+/)[0] ?? "";
          // The member's own name is allowed even when another member shares it.
          return [m.id, m.name, ...(otherFirstName && otherFirstName.toLowerCase() !== firstName.toLowerCase() ? [otherFirstName] : [])];
        }),
        ...snapshot.facets.map(f => f.id),
        o.e164, o.personId,
      ];
      const facts = snapshot.facets.filter(f => f.scope === "agent_private").map(f => f.value);
      const safe = (text: string) => outputLeaks(text, { forbidden, facts, contacts: true }).length === 0;
      if (!safe(firstName) || !safe(member.homeCity)) return null;
      const facets = snapshot.facets.filter(f => f.memberId === memberId && f.scope === "shareable"
        && f.confirmedByMember === true && !f.sensitive
        && (f.validFrom === undefined || f.validFrom <= snapshot.now)
        && (f.validTo === undefined || f.validTo > snapshot.now)
        && safe(f.value)).map(f => f.value);
      return {
        app, memberId, firstName, city: member.homeCity, state,
        stateFrom: null, stateUntil: null, facets, activeItems: null,
      };
    });
  }
}
