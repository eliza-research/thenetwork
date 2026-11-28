import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import {
  appWiring, businessHooks, datingHooks, datingOnboarding, datingVenue, domainWiring, peonHooks, slopHooks,
  slopOnboarding, slopVenue,
} from "../service/packs.ts";
import { NetworkService, smsDomainCommand } from "../service/service.ts";

describe("generic domain wiring (packs.ts)", () => {
  test("domainWiring matches legacy appWiring for dating, business, friendship, and network", () => {
    const dWiring = domainWiring("dating", "nyc");
    const sWiring = appWiring("slop", "nyc");
    expect(dWiring.pack?.id).toBe(sWiring.pack?.id);
    expect(dWiring.engine).toEqual(sWiring.engine);
    expect(dWiring.plans).toBe(sWiring.plans);
    expect(dWiring.prefs(28)).toEqual(sWiring.prefs(28));
    expect(dWiring.prefs(16)).toEqual(sWiring.prefs(16));
    expect(dWiring.prefs(16)).toEqual({ categoriesOptIn: [], romanceOptIn: false });
    expect(typeof dWiring.hooks?.probe).toBe("function");
    expect(typeof dWiring.hooks?.onboarding?.read).toBe("function");

    const bWiring = domainWiring("business", "sf");
    const pWiring = appWiring("peon", "sf");
    expect(bWiring.pack).toBe(pWiring.pack);
    expect(bWiring.engine).toEqual(pWiring.engine);
    expect(bWiring.plans).toBe(pWiring.plans);
    expect(bWiring.hooks?.postings).toBe(true);
    expect(bWiring.prefs(30)).toEqual(pWiring.prefs(30));

    const fWiring = domainWiring("friendship", "la");
    const frWiring = appWiring("friends", "la");
    expect(fWiring.pack).toBe(frWiring.pack);
    expect(fWiring.engine).toEqual(frWiring.engine);
    expect(fWiring.plansConfig).toBe(frWiring.plansConfig);
    expect(fWiring.prefs(16)).toEqual(frWiring.prefs(16));

    const nWiring = domainWiring("network", "nyc");
    const ntWiring = appWiring("ntwrk", "nyc");
    expect(nWiring.pack).toBeUndefined();
    expect(nWiring.prefs(25)).toEqual(ntWiring.prefs(25));

    expect(slopHooks).toBe(datingHooks);
    expect(peonHooks).toBe(businessHooks);
    expect(slopOnboarding).toBe(datingOnboarding);
    expect(slopVenue).toBe(datingVenue);
  });

  test("smsDomainCommand parses domain commands without hijacking participation category controls", () => {
    expect(smsDomainCommand("enable dating")).toEqual({ action: "enable", domains: ["dating"] });
    expect(smsDomainCommand("enable business")).toEqual({ action: "enable", domains: ["business"] });
    expect(smsDomainCommand("also match me for business")).toEqual({ action: "enable", domains: ["business"] });
    expect(smsDomainCommand("disable dating")).toEqual({ action: "disable", domains: ["dating"] });
    expect(smsDomainCommand("my domains")).toEqual({ action: "list", domains: [] });
    expect(smsDomainCommand("Turn on dating suggestions")).toBeNull();
    expect(smsDomainCommand("Turn off hobby suggestions")).toBeNull();
    expect(smsDomainCommand("We're hiring a data analyst, start in 2 weeks")).toBeNull();
    expect(smsDomainCommand("I have to drop my friend off at the airport")).toBeNull();
    expect(smsDomainCommand("Pause me until next Friday, I'm slammed at work")).toBeNull();
  });
});

describe.skipIf(!pgAvailable)("unified domain onboarding & mid-lifecycle SMS expansion", () => {
  const secret = "synthetic-unified-domains-test-secret-2026";
  const clock = new SimClock(Date.UTC(2026, 10, 20, 16));
  let url = "";
  let sql: SQL;
  let service: NetworkService;
  let seq = 0;

  const sendTurn = async (from: string, text: string, app?: TurnRequest["app"]) => {
    clock.advance(MINUTE);
    const input: TurnRequest = {
      messageId: `ud-${++seq}`,
      from,
      text,
      channel: "blooio",
      to: null,
      transport: "imessage",
      receivedAt: clock.now(),
      ...(app ? { app } : {}),
    };
    const body = JSON.stringify(input);
    const auth = await svcSign(secret, {
      method: "POST",
      path: TURN_PATH,
      id: input.messageId,
      body,
      nowS: Math.floor(clock.now() / 1000),
    });
    const res = await service.fetch(new Request(`http://localhost${TURN_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body,
    }));
    expect(res.status).toBe(200);
    return res.json() as Promise<{ outcome: string; app?: string; replies?: string[] }>;
  };

  beforeAll(async () => {
    url = await migratedDb("unified_domains");
    sql = new SQL(url);
    service = new NetworkService({
      url,
      clock,
      log: () => {},
      photoStorage: null,
      adapter: () => new DryRunAdapter(() => {}),
      env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret },
      networks: [
        { id: "ntwrk:nyc", matchingEnabled: false },
        { id: "slop:nyc", matchingEnabled: false },
        { id: "peon:nyc", matchingEnabled: false },
        { id: "friends:nyc", matchingEnabled: false },
      ],
    });
    await service.start();
  }, 120_000);

  afterAll(async () => {
    await service?.close();
    await sql?.close();
    if (url) await dropDb(url);
  });

  test("lander onboarding initializes default domain (slop -> dating, peon -> business, friends -> friendship)", async () => {
    const cases: Array<{ phone: string; app: "slop" | "peon" | "friends"; expected: string[] }> = [
      { phone: "+12125550201", app: "slop", expected: ["dating"] },
      { phone: "+12125550202", app: "peon", expected: ["business"] },
      { phone: "+12125550203", app: "friends", expected: ["friendship"] },
    ];
    for (const c of cases) {
      const joined = await service.accounts.join(APPS[c.app], { e164: c.phone, personId: null }, {
        firstName: "Alex",
        age: 29,
        homeCity: "nyc",
        consent: { sms: true, wording: APPS[c.app].consent.text },
      });
      expect(joined.ok).toBe(true);
      const person = (await service.accounts.personFor(c.phone))!;
      const domains = await service.accounts.memberDomains(person.id, c.phone);
      expect(domains.enabledDomains).toEqual(c.expected);
    }

    // SMS join on a lander also initializes the lander's default domain.
    const smsPhone = "+12125550204";
    await sendTurn(smsPhone, "slop.date");
    await sendTurn(smsPhone, "Sam, 31");
    const smsPerson = (await service.accounts.personFor(smsPhone))!;
    const smsDomains = await service.accounts.memberDomains(smsPerson.id, smsPhone);
    expect(smsDomains.enabledDomains).toEqual(["dating"]);
  }, 60_000);

  test("adult mid-lifecycle SMS expansion enables business, lists domains, and disables dating cleanly", async () => {
    const phone = "+12125550210";
    const joined = await service.accounts.join(APPS.slop, { e164: phone, personId: null }, {
      firstName: "Maya",
      age: 30,
      homeCity: "nyc",
      consent: { sms: true, wording: APPS.slop.consent.text },
    });
    expect(joined.ok).toBe(true);
    const person = (await service.accounts.personFor(phone))!;
    expect((await service.accounts.memberDomains(person.id, phone)).enabledDomains).toEqual(["dating"]);

    // Enable business via SMS
    const enableBiz = await sendTurn(phone, "enable business", "slop");
    expect(enableBiz.outcome).toBe("handled");
    expect(enableBiz.replies?.[0]).toContain("Enabled Business");
    expect(enableBiz.replies?.[0]).toContain("Dating");
    expect(enableBiz.replies?.[0]).toContain("Business");

    const afterEnable = await service.accounts.memberDomains(person.id, phone);
    expect(afterEnable.enabledDomains).toEqual(["dating", "business"]);
    const peonMembership = await service.people.getMembership(person.id, "peon");
    expect(peonMembership?.state).toBe("active");
    const peonMembers = await sql`select id, account_status, participation_state from network.members where app_id = 'peon' and person_id = ${person.id}::uuid`;
    expect(peonMembers).toHaveLength(1);
    expect(peonMembers[0]).toMatchObject({ account_status: "active", participation_state: "normal" });
    expect(await service.accounts.optedIn("peon", phone)).toBe(true);

    // Check "my domains"
    const listed = await sendTurn(phone, "my domains", "slop");
    expect(listed.outcome).toBe("handled");
    expect(listed.replies?.[0]).toContain("Dating, Business");
    expect(listed.replies?.[0]).toContain("Friendship");

    // Disable dating via SMS without affecting business
    const disableDating = await sendTurn(phone, "disable dating", "slop");
    expect(disableDating.outcome).toBe("handled");
    expect(disableDating.replies?.[0]).toContain("Disabled Dating");
    expect(disableDating.replies?.[0]).toContain("Business");

    const afterDisable = await service.accounts.memberDomains(person.id, phone);
    expect(afterDisable.enabledDomains).toEqual(["business"]);
    const slopMembership = await service.people.getMembership(person.id, "slop");
    expect(slopMembership?.state).toBe("paused");
    const slopMembers = await sql`select participation_state from network.members where app_id = 'slop' and person_id = ${person.id}::uuid`;
    expect(slopMembers[0]?.participation_state).toBe("paused");
    const peonAfter = await service.people.getMembership(person.id, "peon");
    expect(peonAfter?.state).toBe("active");

    // Re-enable dating via SMS resumes backing partition
    const reEnableDating = await sendTurn(phone, "also match me for dating", "peon");
    expect(reEnableDating.outcome).toBe("handled");
    expect(reEnableDating.replies?.[0]).toContain("Enabled Dating");
    expect((await service.accounts.memberDomains(person.id, phone)).enabledDomains).toEqual(["dating", "business"]);
    expect((await service.people.getMembership(person.id, "slop"))?.state).toBe("active");
    const slopResumed = await sql`select participation_state from network.members where app_id = 'slop' and person_id = ${person.id}::uuid`;
    expect(slopResumed[0]?.participation_state).toBe("normal");
  }, 60_000);

  test("minor (13-17) gets hard refusal for enable dating / enable business while friendship keeps working", async () => {
    const phone = "+12125550220";
    const joined = await service.accounts.join(APPS.friends, { e164: phone, personId: null }, {
      firstName: "Jordan",
      age: 16,
      homeCity: "nyc",
      consent: { sms: true, wording: APPS.friends.consent.text },
    });
    expect(joined.ok).toBe(true);
    const person = (await service.accounts.personFor(phone))!;
    expect((await service.accounts.memberDomains(person.id, phone))).toEqual({
      enabledDomains: ["friendship"],
      availableDomains: ["friendship"],
    });

    const tryDating = await sendTurn(phone, "enable dating", "friends");
    expect(tryDating.outcome).toBe("handled");
    expect(tryDating.replies?.[0]).toContain("under 18");
    expect(tryDating.replies?.[0]).toContain("friendship");
    expect(await service.people.getMembership(person.id, "slop")).toBeUndefined();

    const tryBusiness = await sendTurn(phone, "enable business", "friends");
    expect(tryBusiness.outcome).toBe("handled");
    expect(tryBusiness.replies?.[0]).toContain("under 18");
    expect(await service.people.getMembership(person.id, "peon")).toBeUndefined();

    const listed = await sendTurn(phone, "my domains", "friends");
    expect(listed.outcome).toBe("handled");
    expect(listed.replies?.[0]).toContain("Friendship");
    expect(listed.replies?.[0]).not.toContain("Dating");
    expect(listed.replies?.[0]).not.toContain("Business");

    // Verify 0 dating/business rows in member_domains and network.members
    const finalDomains = await service.accounts.memberDomains(person.id, phone);
    expect(finalDomains.enabledDomains).toEqual(["friendship"]);
    const forbiddenMembers = await sql`select app_id from network.members where app_id in ('slop', 'peon') and person_id = ${person.id}::uuid`;
    expect(forbiddenMembers).toHaveLength(0);
    expect((await service.people.getMembership(person.id, "friends"))?.state).toBe("active");
  }, 60_000);
});
