import { describe, expect, test } from "vitest";
import { AntiFraudEngine, type AntiFraudEvaluationInput } from "../src/antifraud.ts";

const NOW_MS = Date.parse("2026-11-27T00:00:00.000Z");
const engine = new AntiFraudEngine({ clock: { now: () => NOW_MS } });

function baseInput(
  overrides: Partial<AntiFraudEvaluationInput>,
): AntiFraudEvaluationInput {
  return {
    campaignId: "camp-tier1",
    personKey: "person-tier1",
    workerId: "worker-tier1",
    taskId: null,
    vestingTier: 1,
    amountCents: 1_500,
    phoneLineType: "postpaid",
    priorLifetimeCents: 0,
    annualWorkerCents: 0,
    hasW9: false,
    createdAtIso: "2026-11-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("anti-fraud tier-1 zero-hold release", () => {
  test("a clean tier-1 claim created a week ago is approved and payable in full", () => {
    const res = engine.evaluateClaim(baseInput({}));
    expect(res.status).toBe("approved");
    expect(res.allowed).toBe(true);
    expect(res.payableCents).toBe(1_500);
    expect(res.reasons).toEqual([]);
  });

  test("a clean tier-1 claim evaluated at its creation instant is already released", () => {
    const res = engine.evaluateClaim(
      baseInput({ createdAtIso: "2026-11-27T00:00:00.000Z" }),
    );
    expect(res.status).toBe("approved");
    expect(res.allowed).toBe(true);
    expect(res.payableCents).toBe(1_500);
  });

  test("a clean tier-1 prepaid claim inside the MVNO cap is approved and payable", () => {
    const res = engine.evaluateClaim(
      baseInput({ phoneLineType: "prepaid", amountCents: 150 }),
    );
    expect(res.status).toBe("approved");
    expect(res.allowed).toBe(true);
    expect(res.payableCents).toBe(150);
  });

  test("a tier-0 claim stays vesting and unpaid", () => {
    const res = engine.evaluateClaim(baseInput({ vestingTier: 0 }));
    expect(res.status).toBe("vesting");
    expect(res.allowed).toBe(false);
    expect(res.payableCents).toBe(0);
  });

  test("a tier-1 VoIP claim is still rejected", () => {
    const res = engine.evaluateClaim(baseInput({ phoneLineType: "voip" }));
    expect(res.status).toBe("rejected");
    expect(res.allowed).toBe(false);
    expect(res.payableCents).toBe(0);
  });

  test("a tier-1 claim over the lifetime bonus cap is still rejected", () => {
    const res = engine.evaluateClaim(baseInput({ amountCents: 2_500 }));
    expect(res.status).toBe("rejected");
    expect(res.allowed).toBe(false);
    expect(res.payableCents).toBe(0);
  });

  test("a tier-2 trusted postpaid claim inside its 7-day hold stays vesting", () => {
    const res = engine.evaluateClaim(
      baseInput({
        vestingTier: 2,
        trustedOperator: true,
        createdAtIso: "2026-11-25T00:00:00.000Z",
      }),
    );
    expect(res.status).toBe("vesting");
    expect(res.allowed).toBe(false);
    expect(res.payableCents).toBe(0);
  });

  test("a tier-2 trusted postpaid claim past its 7-day hold is approved", () => {
    const res = engine.evaluateClaim(
      baseInput({
        vestingTier: 2,
        trustedOperator: true,
        createdAtIso: "2026-11-17T00:00:00.000Z",
      }),
    );
    expect(res.status).toBe("approved");
    expect(res.allowed).toBe(true);
    expect(res.payableCents).toBe(1_500);
  });
});
