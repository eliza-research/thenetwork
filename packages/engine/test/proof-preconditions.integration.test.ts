// The preconditions of the proved engine cores (LemmaScript `requires`), enforced where production
// resolves config and builds the World. Driven through the public entry points (runEngine, the World,
// resolveAttention, resolvePlans, validatePack, capFor). No fakes and no model. Each case failed
// before its fix: the config or id was accepted and the run went on outside the proof.
import { describe, expect, test } from "bun:test";
import { capFor, defaultCadence, type MemberAttention } from "../src/attention.ts";
import { DEFAULT_ATTENTION, resolveAttention, resolveConfig, resolvePlans, type AttentionConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine } from "../src/engine.ts";
import { validatePack } from "../src/pack.ts";
import { networkPack } from "../src/packs/network/index.ts";
import { baseMember, emptyInput } from "../src/testkit.ts";
import { World } from "../src/world.ts";

const NOW = Date.UTC(2026, 9, 5, 16);
const twoMembers = (a: string, b: string) => {
  const inp = emptyInput(NOW);
  inp.members = [baseMember(a, { homeCity: "sf" }), baseMember(b, { homeCity: "sf" })];
  return inp;
};

describe("engine config: the proved cores' preconditions", () => {
  test("netValueOf needs norm > 0: positive weights summing to 0 are refused", async () => {
    const weights = { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0 };
    await expect(runEngine(twoMembers("a", "b"), { weights })).rejects.toThrow(/weights/);
    expect(() => new World(twoMembers("a", "b"), { ...resolveConfig(), weights: { ...resolveConfig().weights, ...weights } }, localEmbed)).toThrow(/weights/);
  });
  test("debtStep needs 0 <= 2 x cap: a negative exposure debt cap is refused", () => {
    expect(() => resolveConfig({ selection: { exposureDebtCap: -1 } })).toThrow(/exposureDebtCap/);
  });
  test("acceptanceEstimate needs strength > 0 and a prior in [0, 1]", () => {
    expect(() => resolveConfig({ acceptance: { strength: 0 } })).toThrow(/acceptance/);
    expect(() => resolveConfig({ acceptance: { prior: 1.5 } })).toThrow(/acceptance/);
    expect(() => resolveConfig({ acceptance: { prior: Number.NaN } })).toThrow(/acceptance/);
  });
  test("the defaults and the pack defaults pass", () => {
    expect(() => resolveConfig()).not.toThrow();
    expect(() => resolveAttention()).not.toThrow();
    expect(() => resolvePlans()).not.toThrow();
    expect(() => validatePack(networkPack)).not.toThrow();
  });
});

describe("attention and plans config: capValue and stricterCap", () => {
  test("capValue needs limit >= 0 and periodDays > 0 for every state cap and the minors cap", () => {
    expect(() => resolveAttention({ caps: { normal: { periodDays: 0 } } })).toThrow(/caps\.normal/);
    expect(() => resolveAttention({ caps: { quiet: { limit: -1 } } })).toThrow(/caps\.quiet/);
    expect(() => resolveAttention({ minors: { cap: { periodDays: 0 } } })).toThrow(/minors\.cap/);
  });
  test("capFor refuses a config it was handed unresolved", () => {
    const bad: AttentionConfig = { ...DEFAULT_ATTENTION, caps: { ...DEFAULT_ATTENTION.caps, normal: { limit: 2, periodDays: 0 } } };
    const m: MemberAttention = { memberId: "a", state: "normal", age: 30, tz: "America/New_York", quietHours: [22, 8], onlyWhenAsked: false, prefs: defaultCadence("normal") };
    expect(() => capFor(m, bad)).toThrow(/caps\.normal/);
    expect(capFor(m, DEFAULT_ATTENTION).limit).toBe(2);
  });
  test("stricterCap needs allowance periodDays > 0 (and the allowance feeds capValue, so limit >= 0)", () => {
    expect(() => resolvePlans({ allowance: { periodDays: 0 } })).toThrow(/allowance/);
    expect(() => resolvePlans({ allowance: { limit: -1 } })).toThrow(/allowance/);
  });
  test("validatePack refuses pack defaults that break a precondition", () => {
    const engine = { ...networkPack.defaults.engine, acceptance: { prior: 0.45, strength: -2 } };
    expect(() => validatePack({ ...networkPack, defaults: { ...networkPack.defaults, engine } })).toThrow(/acceptance/);
    const attention = { ...DEFAULT_ATTENTION, minors: { ...DEFAULT_ATTENTION.minors, cap: { limit: 1, periodDays: 0 } } };
    expect(() => validatePack({ ...networkPack, defaults: { ...networkPack.defaults, attention } })).toThrow(/minors\.cap/);
  });
});

describe("pairKey injectivity: member ids never hold the separator", () => {
  test("World build refuses a member id with '|' (fail closed)", () => {
    // Before the rule, ids "a" and "b|c" gave the same key as "a|b" and "c": a block of one pair
    // also blocked the other, and a used pair hid another pair.
    expect(() => new World(twoMembers("a", "b|c"), resolveConfig(), localEmbed)).toThrow(/separator/);
  });
  test("runEngine refuses it too; ordinary ids pass", async () => {
    await expect(runEngine(twoMembers("x|y", "z"))).rejects.toThrow(/separator/);
    expect(() => new World(twoMembers("nyc-g2-0001", "m_7f3a"), resolveConfig(), localEmbed)).not.toThrow();
  });
});
