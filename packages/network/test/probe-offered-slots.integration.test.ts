import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import type { NetworkState } from "../src/network.ts";
import { Mini } from "./mini.ts";

const thursday = { label: "Thursday 7pm", start: Date.UTC(2026, 9, 15, 23) };
const friday = { label: "Friday 7pm", start: Date.UTC(2026, 9, 16, 23) };
const saturday = { label: "Saturday 11am", start: Date.UTC(2026, 9, 17, 15) };
const earlierSaturday = { label: "Saturday 10am", start: Date.UTC(2026, 9, 17, 14) };
const sunday = { label: "Sunday 2pm", start: Date.UTC(2026, 9, 18, 18) };
const three = [thursday, saturday, sunday];
const weekend = [saturday.start, sunday.start];
const clarifyTime = "Which of the offered times work for you? Reply with the letters or the times.";

type Scenario = {
  scene: string;
  slots: typeof three;
  text: string;
  picked: number[];
  legacyClarification?: true;
  generalPrelude?: true;
  followUp?: { text: string; picked: number[]; closeReason?: string; restart?: true; general?: true; unqualified?: string[] };
};

const scenarios: Scenario[] = [
  { scene: "both names and a separate refusal leave another time unmentioned",
    slots: [thursday, friday, saturday, sunday], text: "Both Saturday and Sunday, not Thursday.", picked: weekend },
  { scene: "a later exclusion withdraws an earlier name",
    slots: three, text: "Both Saturday and Sunday except Sunday.", picked: [saturday.start] },
  { scene: "both follows the abbreviated offered days",
    slots: three, text: "Sat and Sun both, not Thursday.", picked: weekend },
  { scene: "an unpunctuated separate exclusion keeps the named pair",
    slots: three, text: "Sat and Sun both except Thursday.", picked: weekend },
  { scene: "a reported pair does not add a choice to the sender's own answer",
    slots: three, text: "Saturday works. Ana said, Sat and Sun both.", picked: [saturday.start] },
  { scene: "a trailing clock does not silently select mismatched times",
    slots: three, text: "Sat and Sun both at 11am.", picked: [],
    followUp: { text: "Sat and Sun both.", picked: weekend,
      unqualified: ["Both work.", "Ana said Saturday and Sunday both work.", "\"Saturday and Sunday both work.\"", "Ana said, the third works."] } },
  { scene: "an unavailable partly named pair needs clarification",
    slots: [thursday, friday, saturday], text: "Sat and Sun both.", picked: [] },
  { scene: "an unrelated refusal cannot complete one named choice",
    slots: three, text: "Both Saturday, not Thursday.", picked: [], generalPrelude: true,
    followUp: { text: "Sunday works.", picked: [sunday.start], restart: true } },
  { scene: "two aliases of one offered time do not name a pair",
    slots: three, text: "Both Saturday and the second time, not Thursday.", picked: [] },
  { scene: "either names offered times",
    slots: three, text: "Either Saturday or Sunday.", picked: weekend },
  { scene: "bare either accepts the whole offer",
    slots: three, text: "Either works.", picked: three.map(slot => slot.start) },
  { scene: "an ordinary first-turn yes accepts the whole offer",
    slots: three, text: "Yes.", picked: three.map(slot => slot.start) },
  { scene: "a plain yes after a new general clarification accepts the whole offer",
    slots: three, text: "Maybe.", picked: [],
    followUp: { text: "Yes.", picked: three.map(slot => slot.start), general: true } },
  { scene: "both selects two offered times after a time clarification",
    slots: [saturday, sunday], text: "Thursday works.", picked: [],
    followUp: { text: "Both of those work.", picked: weekend } },
  { scene: "explicit acceptance of all offered times resolves a time clarification",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Any of those work.", picked: three.map(slot => slot.start) } },
  { scene: "an unrelated availability statement does not select a specific offered time",
    slots: [thursday, friday, saturday], text: "Monday works.", picked: [],
    followUp: { text: "Weekends work best. Saturday at 11am works.", picked: [saturday.start],
      unqualified: ["Weekends work best.", "Saturdays work best.", "I am usually free Saturday.", "Mornings work best.",
        "She can do Saturday 11am.", "Ana can do Saturday 11am.", "Saturday in two weeks works.", "Saturday after next works."] } },
  { scene: "a direct weekend preference still selects the offered weekend on a first reply",
    slots: [thursday, friday, saturday], text: "Weekends work best.", picked: [saturday.start] },
  { scene: "the named pair is the only availability",
    slots: three, text: "Either Saturday or Sunday only, no other times.", picked: weekend },
  { scene: "either named slot can be the single booking",
    slots: three, text: "Either Saturday or Sunday but not both.", picked: weekend },
  { scene: "both of the offered times are refused",
    slots: [saturday, sunday], text: "Yes, both of them don't work.", picked: [] },
  { scene: "a refusal alone does not book",
    slots: three, text: "Thursday doesn't work.", picked: [] },
  { scene: "a trailing refusal applies to both full dayparts after time clarification",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Saturday morning and Sunday afternoon don't work for me, Thursday works.", picked: [thursday.start] } },
  { scene: "a compact list of abbreviated days refuses both days",
    slots: three, text: "Sat/Sun don't work for me, Thursday works.", picked: [thursday.start] },
  { scene: "both belongs to the refused time list instead of the separate choice",
    slots: three, text: "Thursday works, Saturday and Sunday both don't.", picked: [thursday.start] },
  { scene: "a broad yes with both named refusals does not pick an unnamed time",
    slots: three, text: "Yes, Saturday and Sunday both don't work.", picked: [] },
  { scene: "saying two times are not booked does not refuse either time",
    slots: three, text: "Saturday and Sunday aren't booked and both work for me.", picked: weekend },
  { scene: "a favorable assessment keeps both named picks instead of an unnamed time",
    slots: three, text: "Saturday and Sunday aren't bad, so both work for me.", picked: weekend },
  { scene: "a complete clock refusal does not book an earlier joined clock",
    slots: three, text: "Saturday at 11am and Sunday at 2pm don't work for me.", picked: [] },
  { scene: "a schedule explanation leaves the earlier joined times refused",
    slots: three, text: "Saturday and Sunday don't work with my schedule. Thursday works.", picked: [thursday.start] },
  { scene: "a trailing qualifier does not revive a refused time",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Saturday and Sunday don't work for me anymore. Thursday works.", picked: [thursday.start] } },
  { scene: "a time that does not fit the member's schedule stays refused",
    slots: three, text: "Saturday and Sunday don't fit my schedule. Thursday works.", picked: [thursday.start] },
  { scene: "a scheduling reason does not weaken the shared refusal after clarification",
    slots: three, text: "Monday works.", picked: [],
    followUp: { text: "Saturday and Sunday don't work for me due to work. Thursday works.", picked: [thursday.start] } },
  { scene: "a complete refusal of ordinal options leaves only the third choice",
    slots: three, text: "The first option and the second option don't work for me. The third works.", picked: [sunday.start] },
  { scene: "a time noun in a joined ordinal refusal leaves only the third choice",
    slots: three, text: "The first time and second aren't available. The third works.", picked: [sunday.start] },
  { scene: "a complete refusal of the first and second waits for a time",
    slots: three, text: "The first and second aren't available for me.", picked: [] },
  { scene: "an affirmative ordinal pair retains both precise positions",
    slots: three, text: "The first and second work for me.", picked: [thursday.start, saturday.start] },
  { scene: "an ordinal and a day can share a refusal without discarding the positive day",
    slots: three, text: "The first option and Sunday don't work for me. Saturday works.", picked: [saturday.start] },
  { scene: "a redundant daypart still identifies the exact refused clock",
    slots: three, text: "Saturday at 11am in the morning and Sunday at 2pm in the afternoon don't work for me.", picked: [] },
  { scene: "a refused exact clock does not remove a distinct clock in the same daypart",
    slots: [thursday, earlierSaturday, saturday, sunday], text: "Monday works.", picked: [],
    followUp: { text: "Saturday at 11am in the morning and Sunday at 2pm in the afternoon don't work. Saturday 10am works.",
      picked: [earlierSaturday.start] } },
  { scene: "a repeated clock keeps its trailing day and leaves a distinct clock available",
    slots: [thursday, earlierSaturday, saturday, sunday], text: "Monday works.", picked: [],
    followUp: { text: "11am in the morning on Saturday and 2pm in the afternoon on Sunday don't work. Saturday 10am works.",
      picked: [earlierSaturday.start] } },
  { scene: "none of those work records unavailability after a time clarification",
    slots: three, text: "Both Saturday, not Thursday.", picked: [],
    followUp: { text: "None of those work.", picked: [], closeReason: "no common time" } },
  { scene: "an outright decline still closes a probe after a time clarification",
    slots: three, text: "Both Saturday, not Thursday.", picked: [],
    followUp: { text: "No.", picked: [] } },
  { scene: "a stored legacy clarification still needs an explicit time choice",
    slots: three, text: "Yes.", picked: [], legacyClarification: true,
    followUp: { text: "Sunday works.", picked: [sunday.start] } },
];

// spec/probeReply.md, "A model reading cannot replace a definite or qualified answer"
test.skipIf(!pgAvailable).each(scenarios)("a signed probe books only accepted offered times when $scene", async ({ slots, text, picked, followUp, legacyClarification, generalPrelude }) => {
  const url = await migratedDb("probe_offered_slots");
  const clock = new SimClock(Date.UTC(2026, 9, 12, 16));
  const app = APPS.friends;
  const networkId = "friends:nyc";
  const secret = "synthetic-probe-offered-slots-test-secret";
  let service: NetworkService | undefined;
  let server: Awaited<ReturnType<typeof serveHttp>> | undefined;
  const start = async () => {
    const current = new NetworkService({
      url, clock, photoStorage: null, networks: [{ id: networkId, matchingEnabled: false }],
      env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
      network: { seed: 1, plans: false, growth: false }, notify: false,
      log: () => {}, adapter: () => new DryRunAdapter(() => {}),
    });
    service = current;
    await current.start();
    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => current.fetch(req) });
    return current;
  };
  const stop = async () => {
    await server?.stop(true);
    await service?.close();
  };
  try {
    const initial = await start();
    const recipients = [{ name: "Jo", e164: "+12125550431" }, { name: "Rae", e164: "+12125550432" }];
    const people = [];
    for (const { name, e164 } of recipients) {
      const joined = await initial.accounts.join(app, { e164, personId: null }, {
        firstName: name, age: 30, consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      people.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint" });
    }
    const [first, second] = people.map(person => person.id) as [string, string];
    const fixture = new Mini(people, { app: app.id, plans: false, growth: false });
    fixture.clock.set(clock.now());
    await fixture.onboard(first, second);
    const now = clock.now();
    // Start from a delivered probe. The service currently emits up to three options, and the
    // four-option case restores an explicit offer to exercise the extra unmentioned time.
    const offered = slots.map((slot, i) => ({ ...slot, key: "abcd"[i]!, end: slot.start + 2 * HOUR }));
    const id = "fixture-probe-offered-slots";
    const opportunity: NetworkState["opps"][number] = {
      id, origin: "player", kind: "intro", category: "hobby", objective: "play chess over the board",
      detail: "", participants: [first, second], alternates: [], primed: [first],
      status: [[first, "available"], [second, "probing"]], explanations: {}, stage: "probing",
      review: { queuedAt: now - HOUR, deadline: now + DAY, decision: "approve", reviewer: "fixture-staff", decidedAt: now - HOUR },
      deadline: now + DAY, createdAt: now - HOUR, score: 0.5, generator: "fixture",
      components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
        interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
      exploration: false, sameDay: false, contacted: [first, second], reminded: [], tags: [], replacements: 0, feedbackFrom: [],
      first, sentAt: { [first]: now - HOUR, [second]: now }, offered: { [first]: offered, [second]: offered },
      picks: { [first]: offered.map(slot => slot.start) },
    };
    const runtime = () => service!.runtimes.get(networkId)!;
    await runtime().unitOfWork(net => net.importState({
      ...net.exportState(), opps: [opportunity], members: fixture.net.exportState().members.map(member =>
        member.id === second ? {
          ...member, awaiting: { kind: "probe", oppId: id, at: now, ...(legacyClarification ? { clarified: true } : {}) },
        } : member),
    }));
    const signed = async (messageId: string, text: string) => {
      clock.advance(MINUTE);
      const input: TurnRequest = { app: app.id, channel: "blooio", from: recipients[1]!.e164, to: null, text,
        messageId, transport: "imessage", receivedAt: clock.now() };
      const body = JSON.stringify(input);
      const signature = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body,
        nowS: Math.floor(clock.now() / 1000) });
      const response = await fetch(new URL(TURN_PATH, server!.url), {
        method: "POST", headers: { "content-type": "application/json", ...signature }, body,
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    const savedOpportunity = async () => (await runtime().pg.load())?.opps.find(opp => opp.id === id);
    const booking = async () => {
      const saved = await savedOpportunity();
      return { stage: saved?.stage, picked: saved?.picks?.[second] ?? [], meetingAt: saved?.meetingAt };
    };
    const awaiting = async () => (await runtime().pg.load())?.members.find(member => member.id === second)?.awaiting;
    const clarifyGeneral = "Just to check: is that a yes or a no? Either is fine.";
    if (generalPrelude) {
      const general = await signed("probe-offered-slots-general", "Maybe.");
      expect(general).toMatchObject({ outcome: "handled", replies: [clarifyGeneral] });
      expect(await awaiting()).toMatchObject({ kind: "probe", oppId: id, timeChoice: false });
    }
    const reply = await signed("probe-offered-slots-answer", text);
    expect(await booking()).toEqual({
      stage: picked.length ? "scheduled" : "probing", picked, meetingAt: picked[0],
    });
    if (followUp) {
      const pendingChoice = { kind: "probe", oppId: id, timeChoice: !followUp.general };
      const waiting = { stage: "probing", picked: [], meetingAt: undefined };
      expect(reply).toMatchObject({ outcome: "handled", replies: [followUp.general ? clarifyGeneral : clarifyTime] });
      expect(await awaiting()).toMatchObject(pendingChoice);
      if (followUp.restart) {
        await stop();
        await start();
        expect(await awaiting()).toMatchObject(pendingChoice);
      }
      if (!followUp.general) {
        for (const [index, unqualified] of ["Yes.", ...followUp.unqualified ?? []].entries()) {
          await signed(`probe-offered-slots-unqualified-${index}`, unqualified);
          expect(await booking()).toEqual(waiting);
          expect(await awaiting()).toMatchObject(pendingChoice);
        }
      }
      await signed("probe-offered-slots-follow-up", followUp.text);
      expect(await booking()).toEqual({
        stage: followUp.picked.length ? "scheduled" : "closed",
        picked: followUp.picked, meetingAt: followUp.picked[0],
      });
      if (followUp.closeReason) {
        const saved = await savedOpportunity();
        expect(saved?.closedReason).toBe(followUp.closeReason);
        expect(saved?.picks?.[second]).toEqual([]);
      }
    }
  } finally {
    await stop();
    await dropDb(url);
  }
}, 60_000);
