import {
  CITY_IDS,
  DAY,
  findNeighborhood,
  getCity,
  type City,
} from "@thenetwork/core";
import { describe, expect, test } from "vitest";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { humanVectorOf } from "../src/humanVector.ts";
import { hood } from "../src/packs/friends/geo.ts";
import {
  buildDeepContext,
  buildPassContext,
  buildPublicView,
  screenConfigOf,
} from "../src/packs/network/judgeContext.ts";
import {
  CLEF_QUESTIONS,
  WorkersAIClefRater,
  type ClefAnswer,
  type ClefFetch,
} from "../src/packs/slop/clef.ts";
import {
  extractSlopProfile,
  extractSlopProfileLLM,
  LLM_FILL_BELOW,
  slopReaderPrompt,
  validateSlopReading,
  type SlopReader,
} from "../src/packs/slop/extract.ts";
import { latLonToHex, SpatialIndex, type SpatialMemberInput } from "../src/spatialIndex.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { Candidate } from "../src/types.ts";
import { World } from "../src/world.ts";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);

function makeSpatialInput(id: string, city: City, areas: string[]): SpatialMemberInput {
  const m = baseMember(id, { homeCity: city, age: 28 });
  const vec = localEmbed(`${id} climbing coffee`);
  return {
    m,
    held: false,
    tags: new Set(["climbing", "coffee"]),
    profileEmb: vec,
    capEmb: vec,
    desireEmb: vec,
    presence: [{ memberId: id, city, type: "home", areas }],
    allFacets: [],
    lowExposureOrNew: false,
    statusPercentile: 0.5,
  };
}

function fakeClefAnswers(faceScore: number): Record<string, ClefAnswer> {
  const out: Record<string, ClefAnswer> = {};
  for (const [id, q] of Object.entries(CLEF_QUESTIONS)) {
    if (q.type === "noul") out[id] = { noul: 0.95, confidence: 0.9 };
    else if (q.type === "score") out[id] = { score: id === "rate.face" ? faceScore : 3, confidence: 0.9 };
    else out[id] = { choice: "average", confidence: 0.9 };
  }
  return out;
}

describe("Pass 2 engine fixes", () => {
  test("spatialIndex resolves SF/LA/Chicago/Miami neighborhoods via findNeighborhood and preserves NYC hood fallback", () => {
    const cases: { id: string; city: City; area: string; expected: { lat: number; lng: number } }[] = [
      { id: "sf-m", city: "sf", area: "Hayes Valley", expected: findNeighborhood("sf", "Hayes Valley")! },
      { id: "la-m", city: "la", area: "Silver Lake", expected: findNeighborhood("la", "Silver Lake")! },
      { id: "chi-m", city: "chicago", area: "Lincoln Park", expected: findNeighborhood("chicago", "Lincoln Park")! },
      { id: "mia-m", city: "miami", area: "Wynwood", expected: findNeighborhood("miami", "Wynwood")! },
      { id: "mia-midtown", city: "miami", area: "Midtown", expected: findNeighborhood("miami", "Midtown")! },
      { id: "nyc-astoria", city: "nyc", area: "Astoria", expected: hood("Astoria")! },
      { id: "nyc-harlem", city: "nyc", area: "Harlem", expected: hood("Harlem")! },
    ];

    const dim = localEmbed("dim").length;
    const index = new SpatialIndex(
      cases.map(c => makeSpatialInput(c.id, c.city, [c.area])),
      { now: NOW, windowDays: 14, adultMin: 18, dim, seed: 42 },
    );

    for (const c of cases) {
      const slot = index.idToSlot.get(c.id);
      expect(slot).toBeDefined();
      const cells = index.memberHex6.get(slot!) ?? [];
      expect(cells.map(cell => cell.key)).toEqual([latLonToHex(c.expected.lat, c.expected.lng, 6).key]);
    }

    const nycMidtownKey = latLonToHex(hood("Midtown")!.lat, hood("Midtown")!.lng, 6).key;
    const miamiMidtownSlot = index.idToSlot.get("mia-midtown")!;
    expect(index.memberHex6.get(miamiMidtownSlot)![0]!.key).not.toBe(nycMidtownKey);
  });

  test("humanVector computes real latLonToHex homeH3 and derives transitMode from CitySpec primaryMode", () => {
    const input = emptyInput(NOW);
    const members: { id: string; city: City; area?: string; maxTravel: number }[] = [
      { id: "m-sf", city: "sf", area: "Mission District", maxTravel: 20 },
      { id: "m-la", city: "la", area: "Silver Lake", maxTravel: 25 },
      { id: "m-la-center", city: "la", maxTravel: 15 },
      { id: "m-miami", city: "miami", area: "Brickell", maxTravel: 20 },
      { id: "m-nyc", city: "nyc", area: "Astoria", maxTravel: 60 },
      { id: "m-chi", city: "chicago", area: "Wicker Park", maxTravel: 55 },
    ];

    for (const cfg of members) {
      const m = baseMember(cfg.id, { homeCity: cfg.city, age: 29 });
      m.prefs.maxTravelMinutes = cfg.maxTravel;
      input.members.push(m);
      input.presence.push({
        memberId: cfg.id,
        city: cfg.city,
        type: "home",
        areas: cfg.area ? [cfg.area] : [],
      });
    }

    const w = new World(input, resolveConfig({}), localEmbed);

    const sfVec = humanVectorOf(w, "m-sf")!;
    const sfHood = findNeighborhood("sf", "Mission District")!;
    expect(sfVec.horizontal.geoAndTime.homeH3).toBe(latLonToHex(sfHood.lat, sfHood.lng, 6).key);
    expect(sfVec.horizontal.geoAndTime.homeH3.startsWith("h6:")).toBe(true);
    expect(sfVec.horizontal.geoAndTime.transitMode).toBe("transit");

    const laVec = humanVectorOf(w, "m-la")!;
    const laHood = findNeighborhood("la", "Silver Lake")!;
    expect(laVec.horizontal.geoAndTime.homeH3).toBe(latLonToHex(laHood.lat, laHood.lng, 6).key);
    expect(laVec.horizontal.geoAndTime.transitMode).toBe("car");

    const laCenterVec = humanVectorOf(w, "m-la-center")!;
    const laCenter = getCity("la")!.center;
    expect(laCenterVec.horizontal.geoAndTime.homeH3).toBe(latLonToHex(laCenter.lat, laCenter.lng, 6).key);
    expect(laCenterVec.horizontal.geoAndTime.transitMode).toBe("car");

    const miamiVec = humanVectorOf(w, "m-miami")!;
    const miamiHood = findNeighborhood("miami", "Brickell")!;
    expect(miamiVec.horizontal.geoAndTime.homeH3).toBe(latLonToHex(miamiHood.lat, miamiHood.lng, 6).key);
    expect(miamiVec.horizontal.geoAndTime.transitMode).toBe("car");

    const nycVec = humanVectorOf(w, "m-nyc")!;
    const astoria = hood("Astoria")!;
    expect(nycVec.horizontal.geoAndTime.homeH3).toBe(latLonToHex(astoria.lat, astoria.lng, 6).key);
    expect(nycVec.horizontal.geoAndTime.transitMode).toBe("transit");

    const chiVec = humanVectorOf(w, "m-chi")!;
    const wicker = findNeighborhood("chicago", "Wicker Park")!;
    expect(chiVec.horizontal.geoAndTime.homeH3).toBe(latLonToHex(wicker.lat, wicker.lng, 6).key);
    expect(chiVec.horizontal.geoAndTime.transitMode).toBe("transit");
  });

  test("slop/extract derives 5-market prompt from CITY_IDS and guards selfAge LLM skip without missing minor disclosures", async () => {
    const prompt = slopReaderPrompt("open to chicago and miami", { missing: ["distance"] });
    const sys = prompt[0]!.content;
    expect(sys).toContain(`from ${CITY_IDS.join("/")}`);
    expect(sys).toContain("chicago");
    expect(sys).toContain("miami");

    const validated = validateSlopReading(
      { distance: { value: { mode: "multi", markets: ["chicago", "miami"] }, quote: "chicago and miami" } },
      "open to chicago and miami",
    );
    expect(validated.distance?.value).toEqual({ mode: "multi", markets: ["chicago", "miami"] });

    const complete = extractSlopProfile([
      "I'm a 28 year old woman looking for men 25-35 within 5 mi of 11211",
      "Looking for something long term, no smokers, love climbing, down for coffee on a first date",
    ]);
    expect(complete.age?.value).toBe(28);
    expect(complete.age?.confidence).toBeGreaterThanOrEqual(LLM_FILL_BELOW);
    expect(complete.activities.length).toBeGreaterThan(0);
    expect(complete.interests.length).toBeGreaterThan(0);
    expect(complete.dealbreakers.length).toBeGreaterThan(0);
    expect(complete.goal?.value).toBe("long_term");

    let readerCalls = 0;
    const countingReader: SlopReader = async () => {
      readerCalls++;
      return undefined;
    };

    await extractSlopProfileLLM(["sounds great"], complete, {
      llm: { enabled: true, reader: countingReader },
    });
    expect(readerCalls).toBe(0);

    const lowAgeConf = structuredClone(complete);
    lowAgeConf.age = { ...complete.age!, confidence: LLM_FILL_BELOW - 0.1 };
    await extractSlopProfileLLM(["sounds great"], lowAgeConf, {
      llm: { enabled: true, reader: countingReader },
    });
    expect(readerCalls).toBe(1);

    let minorCalls = 0;
    const minorReader: SlopReader = async (text, ctx) => {
      minorCalls++;
      expect(ctx.missing).toEqual(["selfAge"]);
      return { selfAge: { value: 17, quote: text } };
    };

    const turned17 = await extractSlopProfileLLM(["actually I just turned 17"], complete, {
      llm: { enabled: true, reader: minorReader },
    });
    expect(turned17.minor).toBe(true);
    expect(turned17.age?.value).toBe(17);

    const minorCallsBefore = minorCalls;
    const bornLater = await extractSlopProfileLLM(["actually I was born in 2010"], complete, {
      llm: { enabled: true, reader: minorReader },
    });
    expect(minorCalls).toBe(minorCallsBefore + 1);
    expect(bornLater.minor).toBe(true);
    expect(bornLater.age?.value).toBe(17);
  });

  test("clef.ts passes AbortSignal.timeout and parallelizes features() while preserving deterministic photo order", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const started: string[] = [];
    const resolvers = new Map<string, () => void>();
    const faceScores: Record<string, number> = { p1: 1, p2: 3, p3: 5 };

    const mockFetch: ClefFetch = async (_url, init) => {
      signals.push(init.signal);
      const body = JSON.parse(init.body) as { images: string[] };
      const b64 = body.images[0]!.split(",")[1]!;
      const photoId = Buffer.from(b64, "base64").toString("utf8");
      started.push(photoId);
      await new Promise<void>(resolve => {
        resolvers.set(photoId, resolve);
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: { answers: fakeClefAnswers(faceScores[photoId]!) },
        }),
      };
    };

    const rater = new WorkersAIClefRater({
      token: "test-token",
      accountId: "test-account",
      fetch: mockFetch,
    });

    const photos = [
      { id: "p1", bytes: new Uint8Array(Buffer.from("p1")) },
      { id: "p2", bytes: new Uint8Array(Buffer.from("p2")) },
      { id: "p3", bytes: new Uint8Array(Buffer.from("p3")) },
    ];

    const pending = rater.features({ age: 27, ageVerified: true }, photos);
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(["p1", "p2", "p3"]);
    expect(signals).toHaveLength(3);
    for (const sig of signals) {
      expect(sig).toBeInstanceOf(AbortSignal);
      expect(sig!.aborted).toBe(false);
    }

    resolvers.get("p3")!();
    resolvers.get("p1")!();
    resolvers.get("p2")!();

    const rows = await pending;
    expect(rows.map(r => r.photoId)).toEqual(["p1", "p2", "p3"]);
    expect(rows[0]!.x["rate.face"]).toBeLessThan(rows[1]!.x["rate.face"]!);
    expect(rows[1]!.x["rate.face"]).toBeLessThan(rows[2]!.x["rate.face"]!);
  });

  test("judgeContext uses indexed lookups while keeping buildPublicView and buildDeepContext output exact", () => {
    const input = emptyInput(NOW);
    input.members.push(baseMember("ada", { homeCity: "sf" }), baseMember("grace", { homeCity: "sf" }), baseMember("lin", { homeCity: "sf" }));
    input.idAliases = { "ada-old": "ada" };
    input.presence.push(
      { memberId: "ada", city: "sf", type: "home", areas: ["Mission District"] },
      { memberId: "grace", city: "sf", type: "home", areas: ["Mission District"] },
    );
    input.facets.push(
      { ...facet("ada-old", 0, "interest", "Climbing", ["climbing"]), scope: "shareable", observedAt: NOW - 2 * DAY },
      { ...facet("ada", 1, "trait", "Prefers quiet cafes", ["quiet"]), scope: "matchable", observedAt: NOW - 3 * DAY },
      { ...facet("ada", 2, "boundary", "No bars or alcohol", ["sober"]), scope: "agent_private", observedAt: NOW - DAY },
      { ...facet("ada", 3, "interest", "Expired fact", ["old"]), scope: "shareable", validTo: NOW - DAY },
      { ...facet("grace", 0, "interest", "Bouldering", ["climbing"]), scope: "shareable", observedAt: NOW - DAY },
    );
    input.intents.push({
      id: "i-ada",
      memberId: "ada",
      status: "active",
      category: "hobby",
      objective: "Find a climbing partner",
      createdAt: NOW - DAY,
      horizonDays: 14,
    });
    input.edges.push(
      { from: "ada-old", to: "grace", type: "knows", explicit: true, strength: 0.8, createdAt: NOW - 5 * DAY },
      { from: "grace", to: "ada-old", type: "avoid", explicit: true, strength: 1, createdAt: NOW - 2 * DAY },
    );
    input.feedback = [
      { id: "fb-other", from: "ada", about: "lin", sentiment: "positive", at: NOW - 10 * DAY },
      { id: "fb-self", from: "ada", about: "ada", sentiment: "positive", at: NOW - 9 * DAY },
      ...Array.from({ length: 8 }, (_, idx) => ({
        id: `fb-${idx}`,
        from: idx % 2 === 0 ? "ada-old" : "grace",
        about: idx % 2 === 0 ? "grace" : "ada",
        sentiment: (idx === 7 ? "negative" : "positive") as "positive" | "negative",
        wouldMeetAgain: idx !== 7,
        at: NOW - (8 - idx) * DAY,
      })),
    ];

    const w = new World(input, resolveConfig({}), localEmbed);
    const cand: Candidate = {
      key: "ada-grace",
      kind: "intro",
      generator: "intent_to_capability",
      category: "hobby",
      participants: ["ada", "grace"],
      roles: { ada: "peer", grace: "peer" },
      format: "one_to_one",
      objective: "Go climbing",
      city: "sf",
      channels: new Set(),
      evidence: {},
      fit: 1,
      benefit: {},
      warm: 0,
      alternates: [],
      exploration: false,
      safetyClass: "low",
      timeSensitive: false,
      riskText: "climbing",
      lane: "Friend",
    };

    const deep = buildDeepContext(w, cand);
    expect(deep.refs).toEqual({ P1: "ada", P2: "grace" });
    expect(deep.context.people[0]!.facts.map(f => f.value)).toEqual(["Climbing", "Prefers quiet cafes"]);
    expect(deep.context.people[0]!.private_context_never_quote).toEqual([{ field: "boundary", value: "No bars or alcohol" }]);
    expect(deep.context.pairs).toHaveLength(1);
    const pair = deep.context.pairs[0]!;
    expect(pair.edges).toEqual(["P2 avoid P1", "knows"]);
    expect(pair.feedback).toHaveLength(6);
    expect(pair.feedback.map(f => f.days_ago)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(pair.feedback[5]).toEqual({ from: "P2", about: "P1", sentiment: "negative", would_meet_again: false, days_ago: 1 });

    const pubV2 = buildPublicView(w.input, screenConfigOf(w, cand), { version: "v2" });
    expect(pubV2.people.map(p => p.ref)).toEqual(["P1", "P2"]);
    expect(pubV2.people[0]!.intents).toEqual([{ objective: "Find a climbing partner", category: "hobby" }]);

    const pubV3 = buildPublicView(w.input, screenConfigOf(w, cand), { version: "v3" });
    expect(pubV3.people[0]!.intents[0]!.created_days_ago).toBe(1);

    const passCtx = buildPassContext(w, cand, "private");
    expect(passCtx).toEqual(deep);
  });
});
