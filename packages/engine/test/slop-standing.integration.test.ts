import { DAY, type Facet } from "@thenetwork/core";
import { describe, expect, test } from "vitest";
import { localEmbed } from "../src/embed.ts";
import { appearanceFacet, type AppearanceScore } from "../src/packs/slop/appearance.ts";
import { CLEF_QUESTIONS, CLEF_STATE, WorkersAIClefRater, type ClefFetch } from "../src/packs/slop/clef.ts";
import { slopPack, SLOP_ENGINE_DEFAULTS } from "../src/packs/slop/index.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { InteractionRecord } from "../src/types.ts";
import { World } from "../src/world.ts";

const ADULT = { age: 30, ageVerified: true };

function clefAnswering(levels: readonly number[]): ClefFetch {
  let call = 0;
  return async () => {
    const level = levels[call++]!;
    const score = (n: number) => ({ score: n, confidence: 0.8 });
    const answers = {
      "gate.one_adult": { noul: 0.97 }, "gate.face_visible": { noul: 0.9 }, "gate.body_visible": { noul: 0.2 },
      "rate.face": score(level), "rate.body": score(level), "rate.overall": score(level),
    };
    return { ok: true, status: 200, json: async () => ({ success: true, result: { answers } }) };
  };
}
const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, bytes: new Uint8Array([0xff, 0xd8, 0xff, i]) }));
const rate = (levels: readonly number[]) =>
  new WorkersAIClefRater({ token: "t", accountId: "a", fetch: clefAnswering(levels) }).rate(ADULT, photos(levels.length));

type Dater = { id: string; is: "woman" | "man"; rating?: AppearanceScore };

function slopWorld(daters: readonly Dater[], interactions: InteractionRecord[] = []): World {
  const input = emptyInput();
  for (const d of daters) {
    input.members.push(baseMember(d.id, { homeCity: "nyc", prefs: { romanceOptIn: true, categoriesOptIn: ["romance"] } }));
    input.facets.push(facet(d.id, 0, "preference", "Private dating preferences", [
      `romance:is:${d.is}`, `romance:seeks:${d.is === "woman" ? "man" : "woman"}`, "romance:age:18-65", "slop:zip:11222", "slop:max_miles:10",
    ], "agent_private"));
    if (d.rating) input.facets.push(appearanceFacet(d.id, ADULT, d.rating, input.now - DAY) satisfies Facet);
  }
  input.interactions = interactions;
  return new World(input, SLOP_ENGINE_DEFAULTS, localEmbed, slopPack);
}
const dateProfile = (w: World, id: string) => w.match.profilesOf(id).find(p => p.lane === "Date");
const pool = (prefix: string, is: Dater["is"], count: number): Dater[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i).padStart(2, "0")}`, is,
    rating: { face: 0, body: 0, overall: -1.2 + 0.1 * i, confidence: 0.8, photos: 3, spread: 0.02, model: "clef-test" },
  }));

describe("slop.date private standing", () => {
  test("the production rater reports how many photos it rated and how much they disagree", async () => {
    const agreeing = await rate([4, 4, 4, 4]);
    const disagreeing = await rate([1, 5, 2]);
    const single = await rate([4]);
    expect(agreeing).toMatchObject({ photos: 4, spread: 0 });
    expect(disagreeing?.photos).toBe(3);
    expect(disagreeing?.spread).toBeGreaterThan(1);
    expect(single?.photos).toBe(1);
    expect(single?.spread).toBeUndefined();

    const women = pool("w", "woman", 24);
    const w = slopWorld([
      ...women, ...pool("m", "man", 24),
      { id: "agree", is: "woman", rating: agreeing! }, { id: "disagree", is: "woman", rating: disagreeing! },
      { id: "single", is: "woman", rating: single! }, { id: "unrated", is: "woman" },
    ]);
    expect(dateProfile(w, "agree")?.uncertainty).toBe(12);
    expect(dateProfile(w, "disagree")?.uncertainty).toBe(20);
    expect(dateProfile(w, "single")?.uncertainty).toBe(20);
    expect(dateProfile(w, "unrated")).toMatchObject({ standing: 50, uncertainty: 20 });
  });

  test("standing is the midrank percentile in the member's pool; a small pool keeps the middle", () => {
    const w = slopWorld([...pool("w", "woman", 24), ...pool("m", "man", 10)]);
    expect(dateProfile(w, "w00")?.standing).toBe(2);
    expect(dateProfile(w, "w23")?.standing).toBe(97);
    expect(dateProfile(w, "w12")?.standing).toBe(52);
    for (const id of ["m00", "m09"]) expect(dateProfile(w, id)).toMatchObject({ standing: 50, uncertainty: 20 });
  });

  test("standing is switched off while real outcomes show that the gap predicts nothing, and back on when it does", () => {
    const daters = [...pool("w", "woman", 24), ...pool("m", "man", 24)];
    const now = emptyInput().now;
    const outcome = (i: number, w: string, m: string, liked: boolean): InteractionRecord => ({
      id: `i${i}`, kind: "intro", category: "romance", participants: [w, m], at: now - 2 * DAY,
      ...(liked ? { outcome: "completed", acceptedBy: [w, m] } : { outcome: "declined", acceptedBy: [w], declinedBy: [m] }),
    });
    const id = (prefix: string, i: number) => `${prefix}${String(i).padStart(2, "0")}`;
    const outcomes = (nearLiked: boolean) => Array.from({ length: 48 }, (_, k) => {
      const i = k % 24;
      return [outcome(2 * k, id("w", i), id("m", i), nearLiked), outcome(2 * k + 1, id("w", i), id("m", 23 - i), !nearLiked)];
    }).flat();

    const predictive = slopWorld(daters, outcomes(true));
    expect(dateProfile(predictive, "w23")).toMatchObject({ standing: 97 });
    const useless = slopWorld(daters, outcomes(false));
    for (const member of ["w00", "w23", "m00", "m23"]) expect(dateProfile(useless, member)).toMatchObject({ standing: 50, uncertainty: 20 });
    const few = slopWorld(daters, outcomes(false).slice(0, 40));
    expect(dateProfile(few, "w23")).toMatchObject({ standing: 97 });
  });

  test("the Clef photo question bank asks nothing about identity", () => {
    const forbidden = /\b(gender|sex|sexual|male|female|man|woman|men|women|trans\w*|non-?binary|orientation|gay|lesbian|straight|bi(sexual)?|queer|race|racial|ethnic\w*|skin|complexion|nationality|religio\w*|faith|disab\w*|wheelchair|age|aged|ages|old|older|young|younger|years?|elderly|teen\w*)\b/i;
    const texts = [CLEF_STATE, ...Object.values(CLEF_QUESTIONS).flatMap(q => [q.instructions, ...(q.type === "choice" ? Object.values(q.criteria) : q.type === "score" ? q.criteria : [])])];
    expect(texts.filter(t => forbidden.test(t))).toEqual([]);
    expect(texts.filter(t => /most (dating[- ]app )?users/i.test(t))).toEqual([]);
  });
});
