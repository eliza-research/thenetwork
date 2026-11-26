import type { LoggedMessage, LoggedPersona, MemberId, RunRecord } from "../../packages/core/src/index.ts";
import { computeMetrics } from "../../packages/sim/src/judge/metrics.ts";
import { Block, expect } from "./gate.ts";

const T0 = Date.UTC(2026, 10, 22, 17);
const MIN = 60_000;

interface Side { id: MemberId; claimedAge: number; birthKey?: number }
const teen = (id: string, claimedAge: number, birthKey?: number): Side => ({ id, claimedAge, ...(birthKey !== undefined ? { birthKey } : {}) });
const A16 = teen("a16", 16, 20100315);
const B17 = teen("b17", 17, 20090315);
const C17 = teen("c17", 17);
const D19 = teen("d19", 19, 20070315);
const E18 = teen("e18", 18, 20080314);
const SAT_11_NY = Date.UTC(2026, 10, 28, 16);
const SAT_20_NY = Date.UTC(2026, 10, 29, 1);

function persona(s: Side): LoggedPersona & { birthKey?: number } {
  return {
    id: s.id, name: `${s.id.toUpperCase()} Person`, archetype: "steady", homeCity: "nyc", joinDay: 0, trueAge: s.claimedAge, claimedAge: s.claimedAge,
    quietHours: [22, 8], romanceOptIn: false, ...(s.birthKey !== undefined ? { birthKey: s.birthKey } : {}),
  };
}

const TEEN_GENERATOR: Record<string, string> = { friends: "friend_circle", ntwrk: "intent_to_capability" };

function run(o: { sides: Side[]; category?: string; app?: string; generator?: string; plan?: { start: number; end: number }; extra?: RunRecord[]; afterProbe?: RunRecord[] }): number {
  const { sides } = o;
  const at = (n: number) => T0 + n * MIN;
  const log = (n: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t: at(n), type: "network_log", kind, detail });
  const probe = (n: number, to: MemberId): LoggedMessage => ({
    id: `m-${to}-${n}`, ts: at(n), direction: "outbound", memberId: to, status: "delivered",
    body: "A small group for a Saturday walk in the park. Interested? Reply yes or no. Reply STOP to opt out.", meta: { type: "probe", proposalId: "opp1", proactive: true },
  });
  const records: RunRecord[] = [
    { t: T0, type: "run_start", runId: "teen-judge", seed: 1, start: T0, config: { app: o.app ?? "friends" } },
    ...sides.map((s): RunRecord => ({ t: T0, type: "persona", persona: persona(s) })),
    ...sides.map((s): RunRecord => ({ t: T0, type: "join", memberId: s.id })),
    ...(o.extra ?? []),
    log(10, "review_decision", { oppId: "opp1", decision: "approve", reviewer: "staff-reviewer-1" }),
    log(11, "probe_started", {
      proposal: { id: "opp1", participants: sides.map(s => s.id), alternates: [], category: o.category ?? "social", generator: o.generator ?? TEEN_GENERATOR[o.app ?? "friends"] ?? "friend_circle",
        ...(o.plan ? { window: { start: o.plan.start, end: o.plan.end } } : {}) },
      origin: "engine", primed: [], ...(o.plan ? { plan: { activityId: "library_games", quorum: 2, start: o.plan.start } } : {}),
    }),
    ...sides.flatMap((s, i): RunRecord[] => [
      log(12 + 2 * i, "probe_sent", { oppId: "opp1", memberId: s.id, category: o.category ?? "social", options: 1 }),
      { t: at(12 + 2 * i), type: "message", msg: probe(12 + 2 * i, s.id) },
    ]),
    ...(o.afterProbe ?? []),
    { t: at(60), type: "run_end", simEnd: at(60), wallMs: 0, stats: {} },
  ];
  return computeMetrics(records, { requireReview: true }).invariants.byRule.minor_contact ?? 0;
}

const relay = (n: number, from: MemberId, to: MemberId, body: string, meta: Record<string, unknown> = {}): RunRecord => ({
  t: T0 + n * MIN, type: "message",
  msg: { id: `r-${n}`, ts: T0 + n * MIN, direction: "outbound", memberId: to, status: "delivered", body, meta: { type: "relay", proposalId: "opp1", relayFrom: from, ...meta } },
});
const switchLog = (n: number, on: boolean): RunRecord => ({ t: T0 + n * MIN, type: "network_log", kind: "teen_intros_switch", detail: { on, actor: "staff-admin-1" } });
const meeting = (n: number, ids: MemberId[], meetAt: number, city: "nyc" | "sf" = "nyc"): RunRecord => ({ t: T0 + n * MIN, type: "meeting_scheduled", meetingId: "meet1", proposalId: "opp1", participants: ids, at: meetAt, city });

export async function teenJudgeGates(b: Block): Promise<void> {
  await b.run("teen judge: on by default: a 16 and a 17 born within 2 years with exact birth dates in a friends social item is not a minor contact; the same item after a stop is", () => {
    expect(run({ sides: [A16, B17] })).toBe(0);
    expect(run({ sides: [A16, B17], extra: [switchLog(5, false)] })).toBeGreaterThan(0);
  });

  await b.run("teen judge: a stop then a resume turns teen introductions on again; a resume then a stop leaves them off", () => {
    expect(run({ sides: [A16, B17], extra: [switchLog(4, false), switchLog(6, true)] })).toBe(0);
    expect(run({ sides: [A16, B17], extra: [switchLog(4, true), switchLog(6, false)] })).toBeGreaterThan(0);
  });

  await b.run("teen judge: an exact 18 within 2 years passes; a 19, a gap of 20001, a member without an exact birth date and a romance item each count", () => {
    expect(run({ sides: [A16, teen("e18b", 18, 20080316)] })).toBe(0);
    expect(run({ sides: [B17, D19] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, E18] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, C17] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], category: "romance" })).toBeGreaterThan(0);
  });

  await b.run("teen judge: the ntwrk Friend lane: a social teen pair passes and a hobby item counts; slop.date and peon.biz never exempt a minor", () => {
    expect(run({ sides: [A16, B17], app: "ntwrk" })).toBe(0);
    expect(run({ sides: [A16, B17], app: "ntwrk", category: "hobby" })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], app: "slop" })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], app: "peon", category: "professional" })).toBeGreaterThan(0);
  });

  await b.run("teen judge: teen groups: three teens within 2 years pass; with a 19-year-old, or with 7 members, the group counts", () => {
    const c = (id: string, key: number) => teen(id, 16, key);
    expect(run({ sides: [A16, B17, c("c16", 20100101)] })).toBe(0);
    expect(run({ sides: [A16, B17, D19] })).toBeGreaterThan(0);
    const seven = [A16, B17, ...["c", "d", "e", "f", "g"].map((x, i) => c(`${x}16`, 20100101 + i))];
    expect(run({ sides: seven })).toBeGreaterThan(0);
  });

  await b.run("teen judge: a teen meeting at 11:00 New York time passes; one at 20:00 counts", () => {
    expect(run({ sides: [A16, B17], afterProbe: [meeting(30, [A16.id, B17.id], SAT_11_NY)] })).toBe(0);
    expect(run({ sides: [A16, B17], afterProbe: [meeting(30, [A16.id, B17.id], SAT_20_NY)] })).toBeGreaterThan(0);
  });

  await b.run("teen judge: a teen meeting must end by 19:00 New York time: a 2-hour plan at 17:00 passes and at 17:30 counts; without a plan, 18:00 passes and 18:30 counts (the shortest activity is 1 hour)", () => {
    const sat = (hour: number, minute = 0) => Date.UTC(2026, 10, 28, hour + 5, minute);
    const plan = (start: number) => ({ start, end: start + 120 * MIN });
    expect(run({ sides: [A16, B17], plan: plan(sat(17)), afterProbe: [meeting(30, [A16.id, B17.id], sat(17))] })).toBe(0);
    expect(run({ sides: [A16, B17], plan: plan(sat(17, 30)), afterProbe: [meeting(30, [A16.id, B17.id], sat(17, 30))] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], afterProbe: [meeting(30, [A16.id, B17.id], sat(18))] })).toBe(0);
    expect(run({ sides: [A16, B17], afterProbe: [meeting(30, [A16.id, B17.id], sat(18, 30))] })).toBeGreaterThan(0);
  });

  await b.run("teen judge: a teen item from a generator that is not a teen generator counts: event_anchor and second_encounter on ntwrk, same_table_again on friends", () => {
    expect(run({ sides: [A16, B17], app: "ntwrk", generator: "event_anchor" })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], app: "ntwrk", generator: "second_encounter" })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], generator: "same_table_again" })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], generator: "activity_partner" })).toBe(0);
  });

  await b.run("teen judge: a teen item booked at an all-ages place passes; at a place outside the all-ages catalog or with no place it counts", () => {
    const venue = (venueId: string | null): RunRecord => ({ t: T0 + 30 * MIN, type: "network_log", kind: "venue", detail: { oppId: "opp1", venueId, venue: "x", meetingAt: SAT_11_NY, time: "plan" } });
    expect(run({ sides: [A16, B17], afterProbe: [venue("bpl-central")] })).toBe(0);
    expect(run({ sides: [A16, B17], afterProbe: [venue("wine-bar-on-5th")] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], afterProbe: [venue(null)] })).toBeGreaterThan(0);
  });

  await b.run("teen judge: a minor signal, a minor report or an older-than-stated report makes the member not ready; a staff doubt clear of the signal makes them ready again", () => {
    const log = (n: number, kind: string, detail: Record<string, unknown>): RunRecord => ({ t: T0 + n * MIN, type: "network_log", kind, detail });
    expect(run({ sides: [A16, B17], extra: [log(5, "minor_signal", { memberId: B17.id })] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], extra: [log(5, "minor_signal", { memberId: B17.id }), log(6, "safety_action", { action: "clear_teen_doubt", memberId: B17.id, actor: "staff-safety-1" })] })).toBe(0);
    expect(run({ sides: [A16, B17], extra: [log(5, "minor_reported", { memberId: B17.id, by: A16.id })] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], extra: [log(5, "teen_age_contradicted", { memberId: B17.id, minors: [A16.id] })] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], extra: [log(5, "age_conflict", { memberId: B17.id, attestedAge: 17, statedAge: 12 })] })).toBeGreaterThan(0);
  });

  await b.run("teen judge: moderated text relay in the teen item passes; a phone number, a photo or a contact swap with a minor counts", () => {
    expect(run({ sides: [A16, B17], afterProbe: [relay(20, A16.id, B17.id, "the park sounds fun, see you saturday")] })).toBe(0);
    expect(run({ sides: [A16, B17], afterProbe: [relay(20, A16.id, B17.id, "text me at 917-555-0143")] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], afterProbe: [relay(20, A16.id, B17.id, "here is me", { approvedPhotos: [{ photoId: "p1" }] })] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], afterProbe: [{ t: T0 + 20 * MIN, type: "contact_swap", members: [A16.id, B17.id] }] })).toBeGreaterThan(0);
  });

  await b.run("teen judge: the teen meeting window is read in the zone of the meeting's city: 09:00 in San Francisco counts and 11:00 passes", () => {
    const satSf = (hour: number) => Date.UTC(2026, 10, 28, hour + 8);
    expect(run({ sides: [A16, B17], afterProbe: [meeting(30, [A16.id, B17.id], satSf(9), "sf")] })).toBeGreaterThan(0);
    expect(run({ sides: [A16, B17], afterProbe: [meeting(30, [A16.id, B17.id], satSf(11), "sf")] })).toBe(0);
  });
}
