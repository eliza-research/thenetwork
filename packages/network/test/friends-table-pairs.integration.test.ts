import { expect, test } from "vitest";
import { DAY, HOUR, type Facet, type MemberId } from "@thenetwork/core";
import { DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS, friendsPack, localEmbed, planFriendsWeek, resolveConfig, World, type EngineInput, type FriendsPlan, type plans } from "@thenetwork/engine";
import { requiredPairValues } from "../../engine/src/filters.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { Mini, START } from "./mini.ts";

const TZ = "America/New_York";
const ids: MemberId[] = Array.from({ length: 12 }, (_, k) => `m${String(k).padStart(2, "0")}`);
// Every day from Tuesday to Sunday, 09:00-22:00 New York.
const windows = Array.from({ length: 6 }, (_, k) => { const start = Date.UTC(2026, 9, 6 + k, 13); return { start, end: start + 13 * HOUR }; });

function friendsInput(): EngineInput {
  const venue = PLAN_VENUES.find(v => v.activities.includes("coffee_crawl"))!;
  const mini = new Mini(ids.map((id, k) => ({
    id, name: `Member ${id}`, age: 28 + (k % 5), area: venue.area,
    interests: k % 3 === 0 ? ["cooking", "climbing", "hiking"] : k % 3 === 1 ? ["cooking", "climbing", "board_games"] : ["cooking", "hiking", "board_games"],
  })));
  for (const id of ids) mini.facets.push({ id: `${id}:verified`, memberId: id, kind: "fact", value: "Verified", tags: ["verify:liveness:pass", "verify:age:pass"], scope: "agent_private", provenance: "said", confidence: 1 } satisfies Facet);
  return JSON.parse(JSON.stringify(mini.ctx().snapshot())) as EngineInput;
}

function planWeek(input: EngineInput) {
  const w = new World(input, resolveConfig({ seed: 1, cities: ["nyc"] }), localEmbed, friendsPack);
  const evidence = new Map<MemberId, plans.PlanEvidence>(ids.map(id => [id, { memberId: id, tz: TZ, quietHours: [22, 8], stated: { windows, at: START, until: START + 7 * DAY } }]));
  const week = planFriendsWeek(w, { now: START, tz: TZ, evidence, venues: PLAN_VENUES, crews: [], outcomes: [], offered: [] }, DEFAULT_FRIENDS_POLICY, FRIENDS_PLANS);
  return { w, week };
}

/** The pairs of a table (invitees and alternates) that have no pair value in the Friend lane. */
function unvaluedPairs(w: World, p: FriendsPlan): string[] {
  const seats = [...p.invited, ...p.alternates], out: string[] = [];
  for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
    const values = requiredPairValues(w, { participants: [seats[i]!, seats[j]!], lane: "Friend" });
    if (!values || values.some(v => v < 0)) out.push(`${seats[i]}+${seats[j]}`);
  }
  return out;
}

test("friends: two alternates of a new plan who blocked each other are never both on the table", () => {
  // spec/models/candidate_pool.md, newPlanSeatsApart and newPlanSeatsValued: an open table probes its
  // alternates with its invitees, and finish() seats alternates when invitees drop, so every pair of
  // invitees and alternates needs a pair value from the one pair gate.
  const base = friendsInput();
  const before = planWeek(base);
  const table = before.week.plans.find(p => p.alternates.length >= 2);
  expect(table, "a new plan with two alternates").toBeDefined();
  const [x, y] = table!.alternates as [MemberId, MemberId];

  const blocked: EngineInput = { ...base, edges: [{ from: x, to: y, type: "blocked", strength: 1, explicit: true, createdAt: START - DAY }] };
  const after = planWeek(blocked);
  const tables = [...after.week.plans, ...after.week.repeats, ...after.week.sessions];
  expect(tables.length).toBeGreaterThan(0);
  expect(tables.filter(p => [...p.invited, ...p.alternates].includes(x) && [...p.invited, ...p.alternates].includes(y)).map(p => p.id)).toEqual([]);
  expect(tables.flatMap(p => unvaluedPairs(after.w, p))).toEqual([]);
});
