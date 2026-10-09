// Photos on the live path, without a database (photoRating.ts, the slop probe hook): the rater
// adapter's scale and tags, the appearance term in the slop pack, and the probe photo rules.
import { describe, expect, test } from "bun:test";
import type { EngineInput } from "@thenetwork/engine";
import { slopProfiles, SLOP_DEFAULT_OPTIONS } from "@thenetwork/engine";
import { adultsOnly, parseAppearance, type AppearanceRater } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { appearanceFactor, bodyTypeFactor } from "@thenetwork/engine/src/packs/slop/score.ts";
import { baseMember, emptyInput } from "@thenetwork/engine/src/testkit.ts";
import type { HookOpp } from "../src/apphooks.ts";
import { appWiring, slopHooks } from "../service/packs.ts";
import { appearanceRatingFacet, photoRaterFrom, photoRaterFromEnv, probePhotoCheck, scoresOf, type ProbePhotoFacts } from "../service/photoRating.ts";

const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
const AT = Date.UTC(2026, 9, 8, 12);

/** A rater that counts its calls and returns what it is given. */
function fakeRater(score: Partial<Parameters<typeof scoresOf>[0]> | null) {
  const calls: number[] = [];
  const r: AppearanceRater = {
    id: "fake-v1",
    rate: async (_s, photos) => { calls.push(photos.length); return score && { face: 0, body: 0, overall: 0, confidence: 0.8, model: "fake-v1", ...score }; },
  };
  return { r, calls };
}

describe("the rater adapter", () => {
  test("engine scores keep the pack's z-like scale, clamped, with conf and body type", async () => {
    const { r, calls } = fakeRater({ face: 4.2, body: -0.5, overall: 1.234, confidence: 1.4, bodyType: "athletic", bodyTypeConfidence: 0.7 });
    const s = await photoRaterFrom(r).rate([{ id: "ph_1", bytes: JPEG, contentType: "image/jpeg" }], { age: 30 });
    expect(calls).toEqual([1]);
    expect(s).toEqual({ face: 3, body: -0.5, overall: 1.234, confidence: 1, model: "fake-v1", bodyType: "athletic", bodyTypeConfidence: 0.7 });
    const f = appearanceRatingFacet("slop_m1", 30, s!, AT);
    expect(f.id).toBe("slop_m1:appearance");
    expect(f.scope).toBe("agent_private");
    expect(f.tags).toEqual(["appearance:face=3.00", "appearance:body=-0.50", "appearance:overall=1.23", "appearance:conf=1.00", "appearance:bodyType=athletic", "appearance:bodyTypeConf=0.70"]);
    // The value names no score: the tags carry it.
    expect(f.value).not.toMatch(/\d/);
    expect(parseAppearance(f.tags)).toEqual({ face: 3, body: -0.5, overall: 1.23, confidence: 1, bodyType: "athletic", bodyTypeConfidence: 0.7 });
  });

  test("an unknown body type is dropped; no body type means no body tags", () => {
    const f = appearanceRatingFacet("slop_m1", 30, { face: 0, body: 0, overall: 0.5, confidence: 0.6, model: "x", bodyType: "giant" }, AT);
    expect(f.tags.some(t => t.startsWith("appearance:bodyType"))).toBe(false);
  });

  test("adults only: a minor's facet throws, and the guarded rater never sees a minor's photo", async () => {
    expect(() => appearanceRatingFacet("slop_m2", 17, { face: 0, body: 0, overall: 0, confidence: 0.5, model: "x" }, AT)).toThrow(/adults only/);
    const { r, calls } = fakeRater({ overall: 1 });
    expect(await photoRaterFrom(adultsOnly(r)).rate([{ id: "ph_1", bytes: JPEG, contentType: "image/jpeg" }], { age: 16 })).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("a rater that cannot rate gives undefined (the platform tries again later)", async () => {
    expect(await photoRaterFrom(fakeRater(null).r).rate([], { age: 30 })).toBeUndefined();
  });

  test("no rater without its environment; the Clef rater with it", () => {
    expect(photoRaterFromEnv({})).toBeUndefined();
    expect(photoRaterFromEnv({ CLOUDFLARE_AI_TOKEN: "t" })).toBeUndefined();
    expect(photoRaterFromEnv({ CLOUDFLARE_AI_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" })?.id).toMatch(/^clef-/);
  });
});

/** Five adults in slop's input with the writer's rating facets (and two old-style per-photo facets). */
function ratedInput(): EngineInput {
  const input = emptyInput(AT);
  const overall = [-1.5, -0.5, 0.2, 0.9, 2.1];
  overall.forEach((o, i) => {
    const id = `m${i}`;
    input.members.push(baseMember(id, { homeCity: "nyc", age: 30, prefs: { categoriesOptIn: ["romance"], romanceOptIn: true } }));
    input.facets.push(appearanceRatingFacet(id, 30, { face: o, body: o, overall: o, confidence: 0.8, model: "fake", bodyType: i % 2 ? "athletic" : "curvy", bodyTypeConfidence: 0.8 }, AT));
  });
  // The first rater's tags (0..1, one facet per photo): the pack never read them.
  input.facets.push({ id: "m9:photo:ph_x", memberId: "m4", kind: "trait", value: "photo rating", tags: ["slop:rating:overall=0.9"], scope: "agent_private", provenance: "inferred", confidence: 0.5 });
  return input;
}

describe("the appearance term in the slop pack", () => {
  test("rated members get a rating in their profile and a non-zero appearance term", () => {
    const P = slopProfiles(ratedInput());
    expect([...P.values()].every(p => p.appearance)).toBe(true);
    // m3 and m4 are both above the protected bottom 40%: their 1.2 rating gap lowers the pair's value.
    const f = appearanceFactor(P.get("m3")!, P.get("m4")!, SLOP_DEFAULT_OPTIONS);
    expect(f).toBeLessThan(1);
    expect(f).toBeGreaterThan(0);
    // Body type against a stated preference moves the value both ways.
    const a = { ...P.get("m3")!, wantsBody: ["athletic"] };
    expect(bodyTypeFactor(a, P.get("m4")!, SLOP_DEFAULT_OPTIONS)).toBeLessThan(1); // m4 is curvy
    expect(bodyTypeFactor(a, P.get("m3")!, SLOP_DEFAULT_OPTIONS)).toBeGreaterThan(1);
  });

  test("the old per-photo tags alone give no rating (the term was dead on the live path)", () => {
    const input = emptyInput(AT);
    input.members.push(baseMember("x", { homeCity: "nyc", age: 30 }), baseMember("y", { homeCity: "nyc", age: 30 }));
    for (const id of ["x", "y"]) input.facets.push({ id: `${id}:photo:ph_1`, memberId: id, kind: "trait", value: "photo rating", tags: ["slop:rating:face=0.4", "slop:rating:body=0.5", "slop:rating:overall=0.9"], scope: "agent_private", provenance: "inferred", confidence: 0.5 });
    const P = slopProfiles(input);
    expect(P.get("x")!.appearance).toBeUndefined();
    expect(appearanceFactor(P.get("x")!, P.get("y")!, SLOP_DEFAULT_OPTIONS)).toBe(1);
  });

  test("a rating on a member under 18 is ignored by the pack", () => {
    const input = ratedInput();
    input.members[0] = { ...input.members[0]!, age: 17 };
    expect(slopProfiles(input).get("m0")!.appearance).toBeUndefined();
  });
});

const opp = (participants: string[] = ["a", "b"]): HookOpp => ({ id: "o1", category: "romance", participants });
function probeInput(ageB = 29): EngineInput {
  const input = emptyInput(AT);
  input.members.push(baseMember("a", { homeCity: "nyc", age: 31 }), baseMember("b", { homeCity: "nyc", age: ageB }));
  return input;
}

describe("the probe photo (SLOP_PROBE_PHOTO)", () => {
  test("without the flag the probe names no photo", () => {
    const hooks = slopHooks(SLOP_DEFAULT_OPTIONS);
    expect(hooks.probePhoto!(opp(), "a", { input: probeInput })).toBeUndefined();
    expect(appWiring("slop", {}).hooks!.probePhoto!(opp(), "a", { input: probeInput })).toBeUndefined();
    expect(appWiring("slop", { SLOP_PROBE_PHOTO: "true" }).hooks!.probePhoto!(opp(), "a", { input: probeInput })).toBeUndefined();
  });

  test("with the flag it names the other person, adults only, romance pairs only", () => {
    const hooks = appWiring("slop", { SLOP_PROBE_PHOTO: "1" }).hooks!;
    expect(hooks.probePhoto!(opp(), "a", { input: probeInput })).toBe("b");
    expect(hooks.probePhoto!(opp(), "b", { input: probeInput })).toBe("a");
    expect(hooks.probePhoto!(opp(), "a", { input: () => probeInput(17) })).toBeUndefined();
    expect(hooks.probePhoto!({ ...opp(), category: "social" }, "a", { input: probeInput })).toBeUndefined();
    expect(hooks.probePhoto!(opp(["a", "b", "c"]), "a", { input: probeInput })).toBeUndefined();
  });

  const ok: ProbePhotoFacts = {
    flag: true, app: "slop",
    recipient: { age: 31, verified: true, banned: false }, subject: { age: 29, verified: true, banned: false },
    policy: { ok: true }, showConsent: true, photo: { id: "ph_1", moderation: "approved" },
    caption: "There's someone I think you might like to go on a date with: coffee, this week. Want me to check if they're up for it?", guard: [],
    scoreTags: ["appearance:overall=0.42"],
  };

  test("an approved photo of an adult rides on the probe", () => {
    expect(probePhotoCheck(ok)).toEqual({ ok: true });
  });

  test("never without the flag, never a minor or an unknown age, never banned or held, never without consent to show it, never unapproved", () => {
    const no = (f: Partial<ProbePhotoFacts>) => { const r = probePhotoCheck({ ...ok, ...f }); return r.ok ? "ok" : r.reason; };
    expect(no({ flag: false })).toBe("flag_off");
    expect(no({ app: "peon" })).toBe("app");
    expect(no({ subject: { age: 17, verified: true, banned: false } })).toBe("subject_not_adult");
    expect(no({ recipient: { age: 16, verified: true, banned: false } })).toBe("recipient_not_adult");
    expect(no({ subject: { age: null, verified: true, banned: false } })).toBe("subject_not_adult");
    expect(no({ subject: { age: 29, verified: false, banned: false } })).toBe("subject_not_adult");
    expect(no({ subject: { age: 29, verified: true, banned: true } })).toBe("subject_banned");
    expect(no({ policy: { ok: false, reason: "held" } })).toBe("policy_held");
    expect(no({ showConsent: false })).toBe("no_show_consent");
    expect(no({ photo: undefined })).toBe("no_photo");
    expect(no({ photo: { id: "ph_1", moderation: "pending" } })).toBe("not_approved");
    expect(no({ photo: { id: "ph_1", moderation: "rejected" } })).toBe("not_approved");
  });

  test("a caption with a rating word, a score tag or a leak is blocked", () => {
    const no = (caption: string, guard: string[] = []) => { const r = probePhotoCheck({ ...ok, caption, guard }); return r.ok ? "ok" : r.reason; };
    expect(no("Someone attractive wants coffee this week.")).toBe("appearance_leak");
    expect(no("You two have similar looks. Coffee this week?")).toBe("appearance_leak");
    expect(no("They're athletic and into climbing.")).toBe("appearance_leak");
    expect(no("Coffee this week? appearance:overall=0.42")).toBe("appearance_leak");
    expect(no(ok.caption, ["fact:private"])).toBe("leak_guard");
    expect(no(ok.caption)).toBe("ok");
  });
});
