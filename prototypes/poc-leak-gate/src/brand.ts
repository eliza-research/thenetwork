// Code enforcement (P21 item 4, PRD 28.5 "every outbound message passes the leak check, enforced in code").
// LeakCheckedMessage carries a brand keyed by a module-private unique symbol. The symbol is not
// exported, so no other module can name the brand type or construct a value of it; the only way
// to obtain one is mintLeakChecked(), which is NOT re-exported from index.ts and is called only by gate.ts.
declare const leakCheckedBrand: unique symbol;

export type LeakCheckedMessage = {
  readonly recipientId: string;
  readonly body: string;
  readonly checkedAt: number;
  readonly gateVersion: string;
  readonly [leakCheckedBrand]: true;
};

/** Internal: only the gate may call this (enforced by not exporting it from the package entry). */
export function mintLeakChecked(recipientId: string, body: string, checkedAt: number, gateVersion: string): LeakCheckedMessage {
  return Object.freeze({ recipientId, body, checkedAt, gateVersion }) as LeakCheckedMessage;
}

export interface OutboundTransport { deliver(to: string, body: string): Promise<void> }

/** The only send API: accepts a LeakCheckedMessage, never a string or a structurally similar object. */
export async function send(msg: LeakCheckedMessage, transport: OutboundTransport): Promise<void> {
  await transport.deliver(msg.recipientId, msg.body);
}
