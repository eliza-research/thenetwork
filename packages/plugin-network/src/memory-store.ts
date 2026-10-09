/** Deterministic, app-scoped in-memory NetworkStore for the simulator. */
import type { AppId } from "../../platform/src/apps.js";
import { assertNetworkMemberScope } from "./types.js";
import type {
  NetworkMemberContext,
  NetworkMemberScope,
  NetworkSignal,
  NetworkStore,
  SetStateExecution,
  SetStateInput,
} from "./types.js";

export class InMemoryNetworkStore implements NetworkStore {
  readonly members = new Map<string, NetworkMemberContext>();
  readonly events: Array<{ id: string; type: string; app: AppId; memberId: string; payload: unknown }> = [];
  readonly signals: Array<{ app: AppId; memberId: string; messageId: string; signal: NetworkSignal }> = [];
  private readonly ledger = new Map<string, { exec: SetStateExecution; payload: string }>();
  private seq = 0;

  constructor(
    members: NetworkMemberContext[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const m of members) this.members.set(this.memberKey(m), structuredClone(m));
  }

  private memberKey(scope: NetworkMemberScope): string {
    assertNetworkMemberScope(scope);
    return JSON.stringify([scope.app, scope.memberId]);
  }

  async getMemberContext(memberId: string, app: AppId): Promise<NetworkMemberContext | null> {
    const m = this.members.get(this.memberKey({ app, memberId }));
    return m ? structuredClone(m) : null;
  }

  async setState(input: SetStateInput): Promise<SetStateExecution> {
    const memberKey = this.memberKey(input);
    const member = this.members.get(memberKey);
    if (!member) throw new Error(`unknown Network membership ${memberKey}`);
    const ledgerKey = JSON.stringify([input.app, input.memberId, input.idempotencyKey]);
    // Same key + different payload is a conflict, never a replay of someone else's change
    // (audit plugin-prototypes-4). Cloud's store must do the same.
    const payload = JSON.stringify([input.app, input.memberId, input.state, input.from ?? null, input.until ?? null]);
    const prior = this.ledger.get(ledgerKey);
    if (prior) {
      if (prior.payload !== payload) throw new Error(`idempotency key reused with a different payload: ${input.idempotencyKey}`);
      return { ...prior.exec, replayed: true };
    }
    const previous = member.state;
    const from = input.from ?? null;
    if (previous === input.state && (member.stateFrom ?? null) === from && (member.stateUntil ?? null) === (input.until ?? null)) {
      const noop: SetStateExecution = {
        eventId: null, previous, current: previous, from, until: input.until,
        committedAt: this.now(), replayed: false, unchanged: true,
      };
      this.ledger.set(ledgerKey, { exec: noop, payload });
      return noop;
    }
    member.state = input.state;
    member.stateFrom = from;
    member.stateUntil = input.until;
    this.seq += 1;
    const eventId = `evt-${String(this.seq).padStart(6, "0")}`;
    this.events.push({
      id: eventId,
      type: "member.state_changed",
      app: input.app,
      memberId: input.memberId,
      payload: { previous, current: input.state, from, until: input.until, note: input.note },
    });
    const exec: SetStateExecution = {
      eventId,
      previous,
      current: input.state,
      from,
      until: input.until,
      committedAt: this.now(),
      replayed: false,
      unchanged: false,
    };
    this.ledger.set(ledgerKey, { exec, payload });
    return exec;
  }

  async recordSignals(input: NetworkMemberScope & {
    messageId: string;
    signals: NetworkSignal[];
  }): Promise<{ recorded: number }> {
    const memberKey = this.memberKey(input);
    if (!this.members.has(memberKey)) throw new Error(`unknown Network membership ${memberKey}`);
    for (const signal of input.signals) {
      this.signals.push({ app: input.app, memberId: input.memberId, messageId: input.messageId, signal });
    }
    return { recorded: input.signals.length };
  }
}
