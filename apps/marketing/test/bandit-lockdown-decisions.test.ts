import { describe, expect, test } from "vitest";
import {
  computeBanditAllocations,
  createDefaultNycBanditArms,
  type BanditArm,
} from "../src/bandit.ts";

const NOW_ISO = "2026-11-27T00:00:00.000Z";

function armsByKey(arms: readonly BanditArm[]): Map<string, BanditArm> {
  return new Map(arms.map((a) => [a.armKey, a]));
}

describe("bandit lockdown and zero-budget decisions", () => {
  test("lockdown decisions report the share each arm held before the lockdown", () => {
    const arms = createDefaultNycBanditArms("camp-lock", NOW_ISO);
    const before = armsByKey(arms);
    const result = computeBanditAllocations({
      campaignId: "camp-lock",
      arms,
      availableCents: 1_000_000,
      seed: 42,
      nowIso: NOW_ISO,
      riskDial: "lockdown",
    });
    expect(result.totalAllocatedCents).toBe(0);
    for (const decision of result.decisions) {
      expect(decision.previousShareBps).toBe(before.get(decision.armKey)?.allocatedShareBps);
      expect(decision.nextShareBps).toBe(0);
      expect(decision.allocatedCents).toBe(0);
      expect(decision.bucket).toBe("locked");
      expect(decision.killReason).toBe("campaign_lockdown");
    }
    for (const arm of result.arms) {
      expect(arm.allocatedShareBps).toBe(0);
      expect(arm.allocatedCents).toBe(0);
    }
  });

  test("zero-budget decisions report the share each arm held before the rebalance", () => {
    const arms = createDefaultNycBanditArms("camp-zero", NOW_ISO);
    const before = armsByKey(arms);
    const result = computeBanditAllocations({
      campaignId: "camp-zero",
      arms,
      availableCents: 0,
      seed: 42,
      nowIso: NOW_ISO,
      riskDial: "balanced",
    });
    expect(result.totalAllocatedCents).toBe(0);
    for (const decision of result.decisions) {
      expect(decision.previousShareBps).toBe(before.get(decision.armKey)?.allocatedShareBps);
      expect(decision.nextShareBps).toBe(0);
      expect(decision.allocatedCents).toBe(0);
      expect(decision.bucket).toBe("locked");
      expect(decision.killReason).toBeNull();
    }
  });

  test("a funded rebalance still reports the previous share of every arm", () => {
    const arms = createDefaultNycBanditArms("camp-live", NOW_ISO);
    const before = armsByKey(arms);
    const result = computeBanditAllocations({
      campaignId: "camp-live",
      arms,
      availableCents: 1_000_000,
      seed: 42,
      nowIso: NOW_ISO,
      riskDial: "balanced",
      dayOfCampaign: 1,
    });
    expect(result.totalAllocatedCents).toBeGreaterThan(0);
    for (const decision of result.decisions) {
      expect(decision.previousShareBps).toBe(before.get(decision.armKey)?.allocatedShareBps);
    }
  });
});
