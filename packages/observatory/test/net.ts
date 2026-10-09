// A ConsentNetwork in memory for console tests: a fixed clock, a public snapshot of a few NYC
// members, every send and log kept. Members start onboarded (stage "active") so the review, compose
// and shadow paths can be tested without the interview. Never touches a channel or a database.
import { HOUR, SimClock, type Member, type SimMessage, type WorldSnapshot } from "@thenetwork/core";
import { ConsentNetwork, type NetworkOptions } from "@thenetwork/network";
import { appWiring } from "../../network/service/packs.ts";
import type { AppId } from "../../platform/src/apps.ts";

/** Tue 2026-10-06 14:00 New York. */
export const T0 = Date.UTC(2026, 9, 6, 18);

/** `tags`: profile tags the member stated (slop: "romance:is:woman", "romance:seeks:man"). */
export interface TestMember { id: string; age: number; area?: string; name?: string; interests?: string[]; tags?: string[] }

export function testNetwork(o: { app?: AppId; members: TestMember[]; network?: Partial<NetworkOptions>; now?: number }) {
  const app = o.app ?? "ntwrk";
  const clock = new SimClock(o.now ?? T0);
  const sent: SimMessage[] = [];
  const logs: { type: string; detail: Record<string, unknown> }[] = [];
  const romance = app === "slop";
  const members: Member[] = o.members.map(m => ({
    id: m.id, name: m.name ?? `${m.id[0]!.toUpperCase()}${m.id.slice(1)} Test`, homeCity: "nyc", state: "normal", joinedAt: (o.now ?? T0) - 30 * 24 * HOUR, age: m.age, unansweredProactive: 0,
    prefs: { categoriesOptIn: romance ? ["romance"] : ["social", "hobby"], quietHours: [22, 8], romanceOptIn: romance && m.age >= 18, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
  }));
  const snapshot = (): WorldSnapshot => ({
    now: clock.now(), members,
    facets: o.members.flatMap(m => [
      ...(m.interests ?? []).map((t, i) => ({ id: `${m.id}:i${i}`, memberId: m.id, kind: "interest" as const, value: t, tags: [t], scope: "shareable" as const, provenance: "said" as const, confidence: 0.9 })),
      ...(m.tags ?? []).map((t, i) => ({ id: `${m.id}:t${i}`, memberId: m.id, kind: "preference" as const, value: t, tags: [t], scope: "agent_private" as const, provenance: "said" as const, confidence: 0.9 })),
    ]),
    intents: [], presence: o.members.map(m => ({ memberId: m.id, city: "nyc" as const, type: "home" as const, areas: [m.area ?? "East Village"] })), edges: [], recentProposals: [],
  });
  const w = appWiring(app);
  const net = new ConsentNetwork({
    app, seed: 7, review: "human", selective: false, matchingEnabled: true, growth: false,
    ...(w.pack ? { pack: w.pack } : {}), ...(w.hooks ? { hooks: w.hooks } : {}), ...(w.plans !== undefined ? { plans: w.plans } : {}),
    ...(w.engine ? { engine: w.engine } : {}), reviewSlaHours: w.reviewSlaHours,
    ...o.network,
  });
  net.init({
    clock, snapshot,
    send: (memberId, body, x) => { const m: SimMessage = { id: `s${sent.length}`, ts: clock.now(), direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: "delivered", meta: x?.meta ?? {} }; sent.push(m); return m; },
    recordProposal: () => {}, recordMeeting: m => m.proposalId, recordBlock: () => {},
    log: (type, detail) => { logs.push({ type, detail }); },
  });
  // Onboarded members: the record's area, stage "active".
  for (const m of o.members) net.member(m.id);
  const st = net.exportState();
  for (const m of st.members) { m.stage = "active"; m.area = o.members.find(x => x.id === m.id)?.area ?? "East Village"; }
  net.importState(st);
  return {
    net, clock, sent, logs,
    /** Tick hourly up to `until` (inclusive). */
    async runUntil(until: number) { while (clock.now() + HOUR <= until) { clock.advance(HOUR); await net.tick(clock.now()); } },
  };
}


