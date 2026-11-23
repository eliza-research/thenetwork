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
const sunday = { label: "Sunday 2pm", start: Date.UTC(2026, 9, 18, 18) };
const three = [thursday, saturday, sunday];
const weekend = [saturday.start, sunday.start];

// spec/probeReply.md, "A model reading cannot replace a definite or qualified answer"
test.skipIf(!pgAvailable).each([
  { scene: "both names and a separate refusal leave another time unmentioned",
    slots: [thursday, friday, saturday, sunday], text: "Both Saturday and Sunday, not Thursday.", picked: weekend },
  { scene: "a later exclusion withdraws an earlier name",
    slots: three, text: "Both Saturday and Sunday except Sunday.", picked: [saturday.start] },
  { scene: "both follows the abbreviated offered days",
    slots: three, text: "Sat and Sun both, not Thursday.", picked: weekend },
  { scene: "an unavailable partly named pair needs clarification",
    slots: [thursday, friday, saturday], text: "Sat and Sun both.", picked: [] },
  { scene: "an unrelated refusal cannot complete one named choice",
    slots: three, text: "Both Saturday, not Thursday.", picked: [] },
  { scene: "two aliases of one offered time do not name a pair",
    slots: three, text: "Both Saturday and the second time, not Thursday.", picked: [] },
  { scene: "either names offered times",
    slots: three, text: "Either Saturday or Sunday.", picked: weekend },
  { scene: "bare either accepts the whole offer",
    slots: three, text: "Either works.", picked: three.map(slot => slot.start) },
  { scene: "the named pair is the only availability",
    slots: three, text: "Either Saturday or Sunday only, no other times.", picked: weekend },
  { scene: "either named slot can be the single booking",
    slots: three, text: "Either Saturday or Sunday but not both.", picked: weekend },
  { scene: "both of the offered times are refused",
    slots: [saturday, sunday], text: "Yes, both of them don't work.", picked: [] },
  { scene: "a refusal alone does not book",
    slots: three, text: "Thursday doesn't work.", picked: [] },
])("a signed probe books only accepted offered times when $scene", async ({ slots, text, picked }) => {
  const url = await migratedDb("probe_offered_slots");
  const clock = new SimClock(Date.UTC(2026, 9, 12, 16));
  const app = APPS.friends;
  const networkId = "friends:nyc";
  const secret = "synthetic-probe-offered-slots-test-secret";
  const service = new NetworkService({
    url, clock, photoStorage: null, networks: [{ id: networkId, matchingEnabled: false }],
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    network: { seed: 1, plans: false, growth: false }, notify: false,
    log: () => {}, adapter: () => new DryRunAdapter(() => {}),
  });
  let server: Awaited<ReturnType<typeof serveHttp>> | undefined;
  try {
    await service.start();
    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req) });
    const recipients = [{ name: "Jo", e164: "+12125550431" }, { name: "Rae", e164: "+12125550432" }];
    const people = [];
    for (const { name, e164 } of recipients) {
      const joined = await service.accounts.join(app, { e164, personId: null }, {
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
    const runtime = service.runtimes.get(networkId)!;
    await runtime.unitOfWork(net => net.importState({
      ...net.exportState(), opps: [opportunity], members: fixture.net.exportState().members.map(member =>
        member.id === second ? { ...member, awaiting: { kind: "probe", oppId: id, at: now } } : member),
    }));
    clock.advance(MINUTE);
    const input: TurnRequest = { app: app.id, channel: "blooio", from: recipients[1]!.e164, to: null, text,
      messageId: "probe-offered-slots-answer", transport: "imessage", receivedAt: clock.now() };
    const body = JSON.stringify(input);
    const signature = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body,
      nowS: Math.floor(clock.now() / 1000) });
    const response = await fetch(new URL(TURN_PATH, server.url), {
      method: "POST", headers: { "content-type": "application/json", ...signature }, body,
    });
    expect(response.status).toBe(200);
    const saved = (await runtime.pg.load())?.opps.find(opp => opp.id === id);
    expect({ stage: saved?.stage, picked: saved?.picks?.[second] ?? [], meetingAt: saved?.meetingAt }).toEqual({
      stage: picked.length ? "scheduled" : "probing", picked, meetingAt: picked[0],
    });
  } finally {
    await server?.stop(true);
    await service.close();
    await dropDb(url);
  }
}, 60_000);
