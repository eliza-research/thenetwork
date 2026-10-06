// Type-level proof that the gate cannot be bypassed: every line marked @ts-expect-error MUST fail
// to compile. If any of them ever compiles, tsc reports "Unused '@ts-expect-error' directive" and
// tests/brand.test.ts fails.
import { runGate, send, type LeakCheckedMessage, type OutboundTransport } from "../src/index.ts";
import type { GateInput } from "../src/types.ts";

declare const transport: OutboundTransport;
declare const input: GateInput;

export async function bypassAttempts() {
  // @ts-expect-error a raw string is not a LeakCheckedMessage
  await send("hi Maya, Sam is going through a divorce", transport);

  // @ts-expect-error a structurally similar object literal lacks the private brand
  await send({ recipientId: "ny-0001", body: "hi", checkedAt: 0, gateVersion: "x" }, transport);

  const forged = { recipientId: "ny-0001", body: "hi", checkedAt: 0, gateVersion: "x" };
  // @ts-expect-error an unbranded variable is rejected too
  await send(forged, transport);

  // @ts-expect-error mintLeakChecked is not part of the public API
  const { mintLeakChecked } = await import("../src/index.ts");

  const out = await runGate(input);
  // @ts-expect-error a held outcome has no message; you must narrow on decision === "pass"
  await send(out.message, transport);

  // The sanctioned path compiles:
  if (out.decision === "pass") await send(out.message, transport);
  const ok: LeakCheckedMessage | undefined = out.decision === "pass" ? out.message : undefined;
  return { ok, mintLeakChecked };
}
