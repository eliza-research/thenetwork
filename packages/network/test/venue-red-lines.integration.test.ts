import { describe, expect, test } from "vitest";
import {
  fromLocal,
  personaStatusActive,
  prospectConsentSingleOnly,
  sanitizeProspectFacets,
  seedVenuesForCity,
  timeZoneOf,
  type ExternalEventDraft,
  type VenueRecord,
} from "@thenetwork/core";
import { objectivesFor } from "../../engine/src/packs/network/taxonomy.ts";
import { parseOntologyTags } from "../../engine/src/packs/network/ontology.ts";
import { understandPrompt, validateUnderstood } from "../src/extract.ts";
import { Mini } from "./mini.ts";

describe("Track B safety, red lines, multi-city extraction, and external bridge", () => {
  test("unknown-age member fails closed on 21+ bars and venue picks, while verified teens get allAges venues only", async () => {
    const mini = new Mini([
      { id: "m-unk", name: "Alex", area: "West Village", interests: ["coffee"] },
      { id: "m-adult", name: "Jordan", age: 29, area: "East Village", interests: ["coffee"] },
      { id: "m-teen-1", name: "Maya", age: 16, area: "West Village", interests: ["books"] },
      { id: "m-teen-2", name: "Leo", age: 17, area: "East Village", interests: ["books"] },
    ]);
    await mini.onboard("m-unk", "m-adult", "m-teen-1", "m-teen-2");
    const nycStart = fromLocal(2026, 11, 18, 20, timeZoneOf("nyc"));
    const nycDay = fromLocal(2026, 11, 18, 14, timeZoneOf("nyc"));
    const barVenue: VenueRecord = {
      ...seedVenuesForCity("nyc")[0]!,
      id: "test-bar-21",
      name: "Test Bar 21",
      category: "cocktail_bar",
      isBarOnly: true,
      isAlcoholCentric: true,
      alcoholOptional: false,
      ageMin: 21,
      allAges: false,
      priceTier: 2,
    };
    expect(mini.net.venuePassesRedLines(barVenue, ["m-unk", "m-adult"], nycStart)).toBe(false);
    const pick = mini.net.pickVenueWithRedLines(["m-unk", "m-adult"], nycStart, { city: "nyc", mode: "date" });
    expect(pick.primary).toBeUndefined();

    expect(mini.net.venuePassesRedLines(barVenue, ["m-teen-1", "m-teen-2"], nycDay)).toBe(false);
    const teenPick = mini.net.pickVenueWithRedLines(["m-teen-1", "m-teen-2"], nycDay, {
      city: "nyc",
      mode: "group",
      teenFriendAllowed: true,
    });
    expect(teenPick.primary).toBeDefined();
    expect(teenPick.primary!.venue.allAges).toBe(true);
    expect(teenPick.primary!.venue.isBarOnly).toBe(false);
  });

  test("red-line venue selection enforces budget tiers (0..4), feedback exclusions, and fails closed when unsatisfiable", async () => {
    const mini = new Mini([
      { id: "m-chi-1", name: "Nadia", age: 29, area: "West Loop", interests: ["coffee"] },
      { id: "m-chi-2", name: "Omar", age: 31, area: "River North", interests: ["coffee"] },
    ], { city: "chicago" });
    mini.facets.push(
      {
        id: "m-chi-1:spend",
        memberId: "m-chi-1",
        kind: "preference",
        value: "low budget only",
        tags: ["spend:low", "strict_sober"],
        scope: "matchable",
        provenance: "said",
        confidence: 1,
      },
    );
    await mini.onboard("m-chi-1", "m-chi-2");
    const chiStart = fromLocal(2026, 11, 18, 14, timeZoneOf("chicago"));
    const pick1 = mini.net.pickVenueWithRedLines(["m-chi-1", "m-chi-2"], chiStart, { city: "chicago", mode: "date" });
    expect(pick1.primary).toBeDefined();
    expect(pick1.primary!.venue.city).toBe("chicago");
    expect(pick1.primary!.venue.priceTier).toBeLessThanOrEqual(1);
    expect(pick1.primary!.venue.isAlcoholCentric).toBe(false);

    const expensiveVenue: VenueRecord = {
      ...pick1.primary!.venue,
      id: "chi-expensive-3",
      priceTier: 3,
    };
    expect(mini.net.venuePassesRedLines(expensiveVenue, ["m-chi-1", "m-chi-2"], chiStart)).toBe(false);

    mini.net.applyVenueFeedbackFor(pick1.primary!.venue.id, "m-chi-1", {
      outcome: "too_loud",
      reportedClosed: false,
    });
    const pick2 = mini.net.pickVenueWithRedLines(["m-chi-1", "m-chi-2"], chiStart, { city: "chicago", mode: "date" });
    if (pick2.primary) {
      expect(pick2.primary.venue.id).not.toBe(pick1.primary!.venue.id);
    }

    mini.facets.push({
      id: "m-chi-1:impossible",
      memberId: "m-chi-1",
      kind: "boundary",
      value: "daytime only",
      tags: ["daytime_only"],
      scope: "agent_private",
      provenance: "said",
      confidence: 1,
    });
    const chiLate = fromLocal(2026, 11, 18, 22, timeZoneOf("chicago"));
    const latePick = mini.net.pickVenueWithRedLines(["m-chi-1", "m-chi-2"], chiLate, { city: "chicago", mode: "date" });
    expect(latePick.primary).toBeUndefined();
  });

  test("extract.ts validates all 5 launch cities, extended ontology, red lines, and shifts static vocab to system prompt", () => {
    const msgs = understandPrompt("Just moved to West Loop, looking for a ceramics guild, keep it low budget and halal.", {});
    const sysLen = msgs[0]!.content.length;
    const usrLen = msgs[1]!.content.length;
    expect(sysLen / (sysLen + usrLen)).toBeGreaterThan(0.75);

    const parsed = validateUnderstood({
      consent: null,
      times: [],
      wants: ["step_ahead_career_mentor", "craft_maker_guild"],
      notWanted: [],
      interests: ["ceramics"],
      skills: [],
      area: "West Loop",
      selfAge: 28,
      redLines: ["strict_sober", "halal"],
      spendTier: "low",
      transitions: ["relocated_city"],
      guilds: ["ceramics_guild"],
    });
    expect(parsed.area).toBe("West Loop / Fulton Market");
    expect(parsed.wants).toContain("step_ahead_career_mentor");
    expect(parsed.redLines).toEqual(["strict_sober", "halal"]);
    expect(parsed.spendTier).toBe("low");
    expect(parsed.transitions).toEqual(["relocated_city"]);
    expect(parsed.guilds).toEqual(["ceramics_guild"]);

    expect(validateUnderstood({ wants: [], notWanted: [], interests: [], skills: [], area: "River North" }).area).toBe("River North");
    expect(validateUnderstood({ wants: [], notWanted: [], interests: [], skills: [], area: "Brickell" }).area).toBe("Brickell");
    expect(validateUnderstood({ wants: [], notWanted: [], interests: [], skills: [], area: "Silver Lake" }).area).toBe("Silver Lake");
    expect(validateUnderstood({ wants: [], notWanted: [], interests: [], skills: [], area: "Hayes Valley" }).area).toBe("Hayes Valley");
    expect(() => validateUnderstood({ wants: [], notWanted: [], interests: [], skills: [], area: "Atlantis" })).toThrow("bad_area");
  });

  test("taxonomy regexes avoid false positives and ontology splits strictSober vs nonDrinker", () => {
    expect(objectivesFor("I run a startup in the long run")).toHaveLength(0);
    expect(objectivesFor("going to the hardware store")).toHaveLength(0);
    expect(objectivesFor("can you send a photo of the menu")).toHaveLength(0);
    expect(objectivesFor("find people to run with").map(o => o.id)).toContain("run_club");
    expect(objectivesFor("find a hardware collaborator for a side project").map(o => o.id)).toContain("hardware_collab");
    expect(objectivesFor("go on photo walks").map(o => o.id)).toContain("photo_walks");

    const nonDrink = parseOntologyTags([{
      id: "f1", memberId: "m1", kind: "preference", value: "", tags: ["slop:drinking:never"],
      scope: "matchable", provenance: "said", confidence: 1,
    }]);
    expect(nonDrink.strictSober).toBe(false);
    expect(nonDrink.nonDrinker).toBe(true);

    const strict = parseOntologyTags([{
      id: "f2", memberId: "m1", kind: "boundary", value: "", tags: ["strict_sober"],
      scope: "agent_private", provenance: "said", confidence: 1,
    }]);
    expect(strict.strictSober).toBe(true);
    expect(strict.nonDrinker).toBe(true);
  });

  test("external matchmaker whitelist, safety bridge (review + LeakGuard + minor lock), and cold-start remedy", async () => {
    const clean = sanitizeProspectFacets({
      wants_kids: "yes",
      religion: "jewish",
      politics: "moderate",
      drinking: "sometimes",
      smoking: "never",
      "slop:wants_kids:yes": true,
      "slop:religion:jewish": true,
      income: "250k",
      appearance_score: "9.5",
      raw_html: "<html>secret</html>",
    });
    expect(clean.wants_kids).toBe("yes");
    expect(clean.religion).toBe("jewish");
    expect(clean.politics).toBe("moderate");
    expect(clean.drinking).toBe("sometimes");
    expect(clean.smoking).toBe("never");
    expect(clean["slop:wants_kids:yes"]).toBe(true);
    expect(clean.income).toBeUndefined();
    expect(clean.appearance_score).toBeUndefined();
    expect(clean.raw_html).toBeUndefined();

    const mini = new Mini([
      { id: "m-adult", name: "Elena", age: 29, area: "West Village", romance: { is: "woman", seeks: ["man"] } },
      { id: "m-minor", name: "Riley", age: 16, area: "East Village", interests: ["books"] },
    ]);
    mini.facets.push({
      id: "secret-canary",
      memberId: "m-minor",
      kind: "fact",
      value: "CANARY-EXT-BRIDGE-991 private note",
      tags: ["note"],
      scope: "agent_private",
      provenance: "said",
      confidence: 1,
    });
    await mini.onboard("m-adult", "m-minor");

    const baseBridge = {
      statedAge: 30,
      reviewApproved: true,
      personaDisclosed: true,
      optedOut: false,
      declined: false,
      suppressed: false,
      isSmsHandoff: false,
      hasLoggedOffAppConsent: false,
      personaStatus: personaStatusActive,
      dailyOutboundCount: 2,
      dailyOutboundCap: 10,
      evasionAttempt: false,
      memberHeld: false,
      prospectHeld: false,
      memberBanned: false,
      prospectBanned: false,
      personaMatchesLock: true,
      consentState: prospectConsentSingleOnly,
      cacheAgeDays: 1,
      draftText: "Hi Sam, I'm Maya, a local matchmaker — would you like to meet Elena for coffee?",
    };

    const ok = mini.net.evaluateExternalOutreachBridge("m-adult", { ...baseBridge, chargeExposure: true });
    expect(ok.allowed).toBe(true);
    expect(ok.exposureDebt).toBe(1);

    const minorBlocked = mini.net.evaluateExternalOutreachBridge("m-minor", baseBridge);
    expect(minorBlocked.allowed).toBe(false);
    expect(minorBlocked.reasons).toContain("member_not_verified_adult");

    const unreviewed = mini.net.evaluateExternalOutreachBridge("m-adult", { ...baseBridge, reviewApproved: false });
    expect(unreviewed.allowed).toBe(false);
    expect(unreviewed.reasons).toContain("external_contact_gate_rejected");

    const leaked = mini.net.evaluateExternalOutreachBridge("m-adult", {
      ...baseBridge,
      draftText: "Hi Sam, CANARY-EXT-BRIDGE-991 private note",
    });
    expect(leaked.allowed).toBe(false);
    expect(leaked.reasons).toContain("leak_or_clef_guard_blocked");

    const baseDraft: ExternalEventDraft = {
      id: "ext-ev-1",
      city: "nyc",
      platform: "luma",
      source: "host_native",
      title: "Sunday Coffee & Books",
      interest: "books",
      description: "Casual afternoon coffee and book chat at a public cafe.",
      venueName: "Central Cafe",
      venueAddress: "123 Main St",
      arrivalLandmark: "Front window table",
      isPublicVenue: true,
      venueWalkInCapacity: 12,
      startIso: "2026-11-22T15:00:00Z",
      endIso: "2026-11-22T17:00:00Z",
      timezone: "America/New_York",
      anchorFirstName: "Elena",
      confirmedNetworkAnchors: 1,
      confirmedNetworkTotal: 2,
      targetRoomSize: 6,
      reviewApproved: true,
      allParticipantsAdult: true,
      hideGuestList: true,
      approvalRequired: true,
      externalCrowdDisclosed: true,
    };
    expect(mini.net.evaluateExternalEventPublish(baseDraft, ["m-adult"]).allowed).toBe(true);
    expect(mini.net.evaluateExternalEventPublish(baseDraft, ["m-adult", "m-minor"]).allowed).toBe(false);
    expect(mini.net.evaluateExternalEventPublish({
      ...baseDraft,
      description: "Bring CANARY-EXT-BRIDGE-991 private note",
    }).allowed).toBe(false);

    const minorRemedy = mini.net.coldStartRemedyFor("i-minor", "m-minor", "density_gap", { densityTier: "sparse", appId: "friends" });
    expect(minorRemedy?.stage).toBe("single_player_concierge");
    expect(minorRemedy?.remedyKind).toBe("local_public_events");
    expect(minorRemedy?.involvesOtherMembers).toBe(false);
  });
});
