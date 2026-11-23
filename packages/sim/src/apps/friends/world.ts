import { requireSimulationCount } from "../../input.ts";
import { canBeMatched, earliestDayKeyOf, latestDayKeyOf, type AgeSide, type Category, type Member, type MemberId } from "@thenetwork/core";
import { ageOnDay } from "../../../../core/src/generated/memberAge.ts";
import { groupAgeAllowed, rosterHasMinor, teenPlaceAllowed, teenRosterSizeAllowed } from "../../../../core/src/generated/friendIntroAge.ts";
import type { Crew } from "@thenetwork/engine/src/plans.ts";
import type { InteractionRecord } from "@thenetwork/engine/src/types.ts";
import { activityAllAges, activityById, venueAllAges } from "@thenetwork/engine/src/packs/network/activities.ts";
import { SLOT_TIME, hood, nycVenues } from "@thenetwork/engine/src/packs/friends/index.ts";
import { Rng, hash32 } from "@thenetwork/core";
import { Coins, signature } from "../../coins.ts";
import { ageSideOrUnknown, teenMinutesAllowed, teenShape, teenWindowAllowed } from "../../teen.ts";
import { FriendsOracle, ORACLE_PARAMS, type HarmEvent, type OracleParams } from "./oracle.ts";
import { FRIEND_ACTIVITIES, NYC_TZ, SLOTS, generateFriendsPersonas, isReal, type FriendsGenOptions, type FriendsPersona } from "./persona.ts";
import { buildFriendsSnapshot, emptyFriendsState, slotDay, slotTime, weekTime, type CrewState, type FriendsNetworkState, type FriendsSnapshot } from "./snapshot.ts";

export type ProposalKind = "plan" | "partner" | "repeat" | "crew_offer" | "crew_session";
export interface FriendsProposal {
  kind: ProposalKind;
  invited: MemberId[]; alternates: MemberId[];
  activity: string;
  /** Neighborhood id of the venue. */
  venueHood: string; venueId?: string;
  /** Slot indices into SLOTS (1-3). */
  options: number[];
  quorum: number;
  /** Seats: at most this many yes-sayers are booked per table (default 6); the rest hear "this one filled up". */
  maxSeats?: number;
  /** Tables are formed from who said yes: further tables at other options when enough yes-sayers remain. */
  split?: boolean;
  crewId?: string;
  /** crew_offer: the crew proposed (members = invited). */
  crew?: Crew;
  category?: Category;
  generator?: string;
  format?: string;
  roles?: Readonly<Record<MemberId, string>>;
  hostId?: MemberId;
  times?: readonly { start: number; end: number }[];
  via?: MemberId;
  anchor?: { type: string; id: string };
}
export interface MatcherContext { week: number; snapshot: FriendsSnapshot; rng: Rng }
export interface FriendsMatcher { name: string; propose(ctx: MatcherContext): FriendsProposal[] | Promise<FriendsProposal[]> }

export interface MeetupRecord {
  key: string; week: number; day: number; kind: ProposalKind | "crew_self"; activity: string; venueHood: string;
  attendees: MemberId[]; enjoy: Record<MemberId, number>; good: boolean; travel: Record<MemberId, number>;
  crewId?: string;
}
export interface FlowRecord extends RosterAge {
  key: string; week: number; kind: ProposalKind; invited: MemberId[];
  additionalTable?: true;
  stage: "dropped_policy" | "no_quorum" | "backout" | "no_show" | "held" | "crew_declined";
  probed: number; yes: number; replied: number; going: MemberId[]; booked: MemberId[]; attended: MemberId[];
  ageRuleBroken: boolean; harms: HarmEvent[]; capDrops: number;
  expected: number;
  meetAt?: number;
}
export interface RosterAge {
  roster: MemberId[]; sides: AgeSide[]; category?: Category;
  teenIntros: boolean; minDay: number; maxDay: number;
  laneOk: boolean; placeOk: boolean; ruleOk: boolean;
}
type RosterProposal = Pick<FriendsProposal, "category" | "generator" | "format" | "roles" | "via" | "anchor" | "activity" | "options" | "venueId" | "times">;

export const teenSlotAllowed = (slot: number, durationMin: number): boolean => teenMinutesAllowed(Math.round(SLOT_TIME[SLOTS[slot]!].hour * 60), durationMin);

export function rosterAge(s: FriendsSnapshot, members: ReadonlyMap<MemberId, Member>, ids: readonly MemberId[], pr: RosterProposal, week: number): RosterAge {
  const sides = ids.map(id => ageSideOrUnknown(members.get(id)));
  const activity = activityById.get(pr.activity);
  const durationMin = activity?.durationMin ?? 120;
  const meetingEnd = Math.max(s.now, ...pr.options.map(o => slotTime(week, o) + durationMin * 60_000), ...(pr.times ?? []).map(t => t.end));
  const minDay = earliestDayKeyOf(s.now), maxDay = latestDayKeyOf(meetingEnd);
  const teenIntros = s.teenIntros === true;
  const { lane, laneOk } = teenShape("friends", ids, pr);
  const venue = pr.venueId === undefined ? undefined : VENUE_BY_ID.get(pr.venueId);
  const placeOk = teenPlaceAllowed(true, activity !== undefined, activity !== undefined && activityAllAges(activity), venue !== undefined && venueAllAges(venue))
    && pr.options.every(o => teenSlotAllowed(o, durationMin))
    && (pr.times === undefined ? pr.options.length > 0 : pr.times.length > 0 && pr.times.every(t => teenWindowAllowed(NYC_TZ, t.start, t.end)));
  const ruleOk = !rosterHasMinor(sides) || (teenIntros && laneOk && placeOk && teenRosterSizeAllowed(true, ids.length)
    && groupAgeAllowed(teenIntros, lane, minDay, maxDay, sides));
  return { roster: [...ids], sides, ...(pr.category ? { category: pr.category } : {}), teenIntros, minDay, maxDay, laneOk, placeOk, ruleOk };
}
export interface Contact { a: MemberId; b: MemberId; day: number; key: string }

export interface FriendsRunOptions extends Omit<FriendsGenOptions, "seed"> {
  seed: number; weeks?: number;
  matcher: FriendsMatcher | ((w: FriendsWorld) => FriendsMatcher);
  personas?: FriendsPersona[];
  params?: Partial<OracleParams>;
  /** Plan allowance: new-plan invites per member per week (default 1). */
  planCap?: number;
  /** Booked meetups per member per week (default 2). */
  bookCap?: number;
  /** Intro cap: new one-to-one (activity partner) invites per member per week (default 2, attention v1.2 Normal). */
  introCap?: number;
  teenStop?: boolean;
}

export interface FriendsWorld {
  seed: number; weeks: number; personas: FriendsPersona[]; oracle: FriendsOracle; state: FriendsNetworkState;
  /** Hidden ledgers (harness only). */
  hours: Map<string, number>; hoursByWeek: Map<string, number[]>; meetupsTogether: Map<string, number>;
  /** Hours at meetups both enjoyed (drives the familiarity term of enjoyment). */
  bond: Map<string, number>;
  /** Pairs who both said (truly) they'd see each other again at some meetup. */
  mutual: Set<string>;
  /** Pairs where one did NOT want to see the other again (back-out risk at a reveal). */
  disliked: Set<string>;
  /** Latest meetup enjoyment from completed weeks, used by this week's invitations. */
  lastEnjoy: Map<MemberId, number>;
  selfHangouts: number;
  /** Hangouts a pair arranged on its own (hidden). */
  selfTogether: Map<string, number>;
  coins: Coins;
}
export interface FriendsRunResult { world: FriendsWorld; flows: FlowRecord[]; meetups: MeetupRecord[]; contacts: Contact[]; matcher: string; valueDays: Map<MemberId, number[]> }

export const pk = (a: MemberId, b: MemberId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const dk = (a: MemberId, b: MemberId) => `${a}>${b}`;

export function createFriendsWorld(o: Omit<FriendsRunOptions, "matcher">): FriendsWorld {
  const weeks = o.weeks ?? 8;
  requireSimulationCount(weeks, "weeks", 1);
  const personas = o.personas ?? generateFriendsPersonas({ ...o, seed: o.seed });
  return {
    seed: o.seed, weeks, personas, oracle: new FriendsOracle(personas, o.seed, { ...ORACLE_PARAMS, ...(o.params ?? {}) }), state: emptyFriendsState(o.teenStop === true),
    hours: new Map(), hoursByWeek: new Map(), meetupsTogether: new Map(), bond: new Map(), mutual: new Set(), disliked: new Set(), lastEnjoy: new Map(), selfHangouts: 0, selfTogether: new Map(), coins: new Coins(),
  };
}

export function runFriendsWorld(o: FriendsRunOptions): FriendsRunResult {
  const world = createFriendsWorld(o);
  const matcher = typeof o.matcher === "function" ? o.matcher(world) : o.matcher;
  const run = friendsWeeks(o, world, matcher.name);
  let step = run.next();
  while (!step.done) {
    const out = matcher.propose(step.value);
    if (out instanceof Promise) throw new Error(`matcher ${matcher.name} is async: use runFriendsWorldAsync`);
    step = run.next(out);
  }
  return step.value;
}

export async function runFriendsWorldAsync(o: FriendsRunOptions): Promise<FriendsRunResult> {
  const world = createFriendsWorld(o);
  const matcher = typeof o.matcher === "function" ? o.matcher(world) : o.matcher;
  const run = friendsWeeks(o, world, matcher.name);
  let step = run.next();
  while (!step.done) step = run.next(await matcher.propose(step.value));
  return step.value;
}

function* friendsWeeks(o: FriendsRunOptions, world: FriendsWorld, matcherName: string): Generator<MatcherContext, FriendsRunResult, FriendsProposal[]> {
  const { oracle, state, coins } = world;
  const planCap = o.planCap ?? 1, bookCap = o.bookCap ?? 2, introCap = o.introCap ?? 2;
  const flows: FlowRecord[] = [], meetups: MeetupRecord[] = [], contacts: Contact[] = [];
  const completedEnjoyment: { at: number; values: Record<MemberId, number> }[] = [];
  const valueDays = new Map<MemberId, number[]>();
  const addValue = (id: MemberId, day: number) => { if (!valueDays.has(id)) valueDays.set(id, []); valueDays.get(id)!.push(day); };
  const addHours = (a: MemberId, b: MemberId, h: number, week: number) => {
    const k = pk(a, b);
    world.hours.set(k, (world.hours.get(k) ?? 0) + h);
    if (!world.hoursByWeek.has(k)) world.hoursByWeek.set(k, Array(world.weeks).fill(0));
    world.hoursByWeek.get(k)![week]! += h;
  };
  const P = oracle.P;

  for (let week = 0; week < world.weeks; week++) {
    completedEnjoyment.length = 0;
    state.week = week;
    state.now = weekTime(week, 0, 9); // Monday 09:00 local: the weekly planner run
    // 0. check-ins
    state.checkIns = new Map();
    for (const p of world.personas) {
      const h = p.hidden;
      if (!h.checkIn || !canBeMatched(ageOnDay(p.stated.birthKey, earliestDayKeyOf(state.now))) || oracle.u("checkin", p.id, week) >= h.replyProb) continue;
      const free = SLOTS.map((s, k) => [s, k] as const).filter(([, k]) => (oracle.free(p.id, week, k) ? oracle.u("ci", p.id, week, k) < 0.85 : oracle.u("ci", p.id, week, k) < 0.05)).map(([s]) => s);
      state.checkIns.set(p.id, free);
    }
    const independentCrews = state.crews.filter(c => c.handedOff);
    const snapshot = buildFriendsSnapshot(world.personas, state);
    const membersById = new Map(snapshot.members.map(m => [m.id, m]));
    const proposals = yield { week, snapshot, rng: new Rng(hash32(o.seed, "matcher", week)) };
    const planInvites = new Map<MemberId, number>(), introInvites = new Map<MemberId, number>(), booked = new Map<MemberId, number>(), bookedSlots = new Set<string>(), answered = new Map<MemberId, number>();
    const canBook = (id: MemberId, slot: number) => (booked.get(id) ?? 0) < bookCap && !bookedSlots.has(`${id}|${slot}`);
    const reserve = (id: MemberId, slot: number) => {
      booked.set(id, (booked.get(id) ?? 0) + 1);
      bookedSlots.add(`${id}|${slot}`);
    };

    proposals.forEach((pr, idx) => {
      const key = `w${week}:${idx}:${pr.kind}`;
      const everyone = [...pr.invited, ...pr.alternates, ...(pr.hostId !== undefined && !pr.invited.includes(pr.hostId) ? [pr.hostId] : [])];
      const age = rosterAge(snapshot, membersById, everyone, pr, week);
      const f: FlowRecord = { key, week, kind: pr.kind, invited: [...pr.invited], stage: "dropped_policy", probed: 0, yes: 0, replied: 0, going: [], booked: [], attended: [], ageRuleBroken: false, harms: [], capDrops: 0, expected: 0, ...age };
      flows.push(f);
      if (everyone.some(id => !oracle.byId.has(id))) return;
      if (!age.ruleOk) { f.ageRuleBroken = true; return; }
      if (!pr.options.length || !activityById.has(pr.activity)) return;
      // Initial invites: new plans use the plan allowance, one-to-one partner intros the intro cap.
      // Repeats and crew offers ride on the member's own post-meetup answer; crew sessions are opted in.
      const cap = pr.kind === "plan" ? { m: planInvites, n: planCap } : pr.kind === "partner" ? { m: introInvites, n: introCap } : undefined;
      const crewState = pr.crewId ? state.crews.find(c => c.id === pr.crewId) : undefined;
      if (pr.kind === "crew_session" && (!crewState || crewState.handedOff)) return;
      const prevEnjoy = (id: MemberId) => (pr.kind === "plan" || pr.kind === "partner" ? undefined : world.lastEnjoy.get(id));
      const size = Math.max(2, pr.invited.length);
      const crew = pr.kind === "crew_session" || pr.kind === "crew_offer";
      const primedFor = (id: MemberId, options: number[]) => (state.checkIns.get(id) ?? []).some(s => options.includes(SLOTS.indexOf(s)));
      f.expected = oracle.expectedGood({ ...pr, week }, id => ({ prevEnjoy: prevEnjoy(id), crew, fatigue: 0, primed: primedFor(id, pr.options) }), (a, b) => world.bond.get(pk(a, b)) ?? 0);
      const ask = (id: MemberId, options: number[]) => {
        if (cap) {
          if ((cap.m.get(id) ?? 0) >= cap.n) { f.capDrops++; return null; }
          cap.m.set(id, (cap.m.get(id) ?? 0) + 1);
          if (pr.kind === "plan") state.lastPlannedAt.set(id, state.now);
        }
        f.probed++;
        const primed = primedFor(id, options);
        const coin = coins.key(`probe:w${week}:${pr.kind}:${pr.activity}:${id}`, `${key}|${id}`);
        const a = oracle.answer(id, coin, { week, activity: pr.activity, venueHood: pr.venueHood, size, options, prevEnjoy: prevEnjoy(id), crew, fatigue: answered.get(id) ?? 0, primed });
        answered.set(id, (answered.get(id) ?? 0) + 1);
        if (a.replied) f.replied++;
        if (a.yes) f.yes++;
        return a;
      };

      // Crew offer: opt in person by person; >= 3 form the crew, whose first session is this proposal.
      let invited = [...pr.invited];
      if (pr.kind === "crew_offer" && pr.crew) {
        state.offered.push({ ...pr.crew });
        const optIn = invited.filter(id => oracle.crewOptIn(id, coins.key(`crew:w${week}:${pr.activity}:${signature(invited)}:${id}`, `${key}|${id}`), world.lastEnjoy.get(id) ?? 0.5));
        if (optIn.length < 3) { f.stage = "crew_declined"; return; }
        const crew: CrewState = { ...pr.crew, members: [...optIn].sort(), sessions: [], handedOff: false, sessionsHeld: 0, formedWeek: week };
        state.crews.push(crew);
        invited = crew.members;
      }

      // Probing. Pairs: first, then the second with the first's picks. Groups: in parallel, then alternates.
      const picks = new Map<MemberId, number[]>();
      const partner = invited.length === 2 && (pr.kind === "partner" || (pr.quorum === 2 && pr.kind !== "crew_session"));
      if (partner) {
        const a1 = ask(invited[0]!, pr.options);
        if (a1?.yes) { const a2 = ask(invited[1]!, a1.picks); if (a2?.yes) { picks.set(invited[0]!, a1.picks); picks.set(invited[1]!, a2.picks); } }
      } else {
        for (const id of invited) { const a = ask(id, pr.options); if (a?.yes) picks.set(id, a.picks); }
      }
      const bestOption = () => {
        let best = pr.options[0]!, n = -1;
        for (const slot of pr.options) {
          const available = [...picks].filter(([id, slots]) => slots.includes(slot) && canBook(id, slot)).length;
          if (available > n) { n = available; best = slot; }
        }
        return { slot: best, n };
      };
      const quorum = pr.kind === "crew_session" || pr.kind === "crew_offer" ? Math.min(pr.quorum, 2) : pr.quorum;
      let opt = bestOption();
      const bench = partner ? [] : [...pr.alternates];
      while (opt.n < quorum && bench.length) { const id = bench.shift()!; const a = ask(id, pr.options); if (a?.yes) picks.set(id, a.picks); opt = bestOption(); }
      if (opt.n < quorum) { f.stage = "no_quorum"; record(key, "declined", invited, slotTime(week, pr.options[0]!)); return; }
      // Book a table at the option most yes-sayers picked; with `split`, the remaining yes-sayers can
      // fill further tables at other options (tables are formed from who said yes).
      const seats = Math.min(6, pr.maxSeats ?? 6);
      let table = 0;
      while (true) {
        const o2 = bestOption();
        if (o2.n < quorum) break;
        const slot = o2.slot;
        const going = [...picks.keys()].filter(id => picks.get(id)!.includes(slot) && canBook(id, slot)).slice(0, seats);
        for (const id of [...picks.keys()].filter(id => picks.get(id)!.includes(slot))) if (!going.includes(id) && !pr.split) picks.delete(id);
        for (const id of going) picks.delete(id);
        if (going.length < quorum) { if (table === 0) { f.stage = "no_quorum"; record(key, "declined", invited, slotTime(week, slot)); } break; }
        const g: FlowRecord = table === 0 ? f : { ...f, key: `${key}:t${table}`, additionalTable: true,
          probed: 0, yes: 0, replied: 0, capDrops: 0, harms: [], going: [], booked: [], attended: [], stage: "no_quorum" };
        if (table > 0) flows.push(g);
        bookTable(g, going, slot);
        table++;
        if (!pr.split || partner) break;
      }

      function bookTable(g: FlowRecord, going: MemberId[], slot: number) {
        const tkey = g.key;
        g.going = going;
        const reveal = coins.key(`reveal:w${week}:${pr.activity}:${signature(going)}`, tkey);
        // 3. reveal: names exchanged (contact), bots show themselves in the thread
        const day = slotDay(week, slot), at = slotTime(week, slot);
        g.meetAt = at;
        for (let i = 0; i < going.length; i++) for (let j = i + 1; j < going.length; j++) contacts.push({ a: going[i]!, b: going[j]!, day, key: tkey });
        for (const b of going.filter(id => oracle.p(id).hidden.adversary === "bot"))
          for (const v of going.filter(id => isReal(oracle.p(id)))) g.harms.push({ kind: "bot_contact", offender: b, victim: v, reported: oracle.u("report", reveal, b, v) < 0.25 });
        const out = going.filter(id => oracle.backsOut(id, reveal, going.some(j => j !== id && world.disliked.has(dk(id, j)))));
        const confirmed = going.filter(id => !out.includes(id));
        if (confirmed.length < 2) { g.stage = "backout"; record(tkey, "cancelled", going, at); applyHarms(g.harms, at); return; }
        g.booked = confirmed;
        for (const id of g.booked) reserve(id, slot);
        // 4. the meetup
        g.attended = g.booked.filter(id => oracle.attends(id, coins.key(`attend:w${week}:s${slot}:${id}`, `${tkey}|${id}`), week, slot, pr.venueHood));
        if (g.attended.length < 2) { g.stage = "no_show"; record(tkey, "no_show", g.booked, at); applyHarms(g.harms, at); return; }
        g.stage = "held";
        const res = held(tkey, pr.kind, g.attended, pr.activity, pr.venueHood, week, day, at, pr.crewId ?? (pr.kind === "crew_offer" ? state.crews[state.crews.length - 1]!.id : undefined));
        g.harms.push(...res.harms);
        record(tkey, "completed", g.attended, at);
        // Feedback the Network receives (private): rating and "see again?" per person.
        const reportedPositive: MemberId[] = [];
        for (const i of g.attended) {
          const h = oracle.p(i).hidden;
          if (oracle.u("fb", res.coin, i) >= h.replyProb * 0.9) continue;
          const honest = oracle.u("honest", res.coin, i) < h.honesty;
          const e = res.enjoy[i]!;
          const sentiment = e >= P.positive ? "positive" : e <= 0.35 ? "negative" : "neutral";
          if ((honest && sentiment === "positive") || (!honest && sentiment === "neutral")) reportedPositive.push(i);
          for (const j of g.attended) {
            if (j === i) continue;
            const truth = res.seeAgain[i]!.includes(j);
            const said = honest ? truth : !truth;
            state.feedback.push({ id: `fb:${tkey}:${i}:${j}`, from: i, about: j, opportunityId: tkey, at: at + 20 * 3600_000, sentiment: honest ? sentiment : "neutral", wouldMeetAgain: said });
            if (said) state.edges.push({ from: i, to: j, type: "would_interact_again", strength: 0.7, explicit: true, createdAt: at });
          }
        }
        state.outcomes.push({ planId: tkey, activityId: pr.activity, ...(pr.venueId ? { venueId: pr.venueId } : {}), city: "nyc", at, attended: [...g.attended], positive: reportedPositive, recurringWant: [] });
        applyHarms(g.harms, at);
        if (crewState || pr.kind === "crew_offer") {
          const c = crewState ?? state.crews[state.crews.length - 1]!;
          c.sessionsHeld++; c.sessions.push(tkey);
          if (c.sessionsHeld >= 3) c.handedOff = true; // handed to its own group chat
        }
      }

      function record(id: string, outcome: InteractionRecord["outcome"], participants: MemberId[], when: number) {
        state.interactions.push({ id, kind: participants.length >= 3 ? "group" : "intro", category: "social", participants: [...participants], at: when, outcome });
      }
    });

    // Crews handed off before this round can meet independently, within the same booking limits.
    for (const c of independentCrews) {
      const age = week - c.formedWeek;
      const slot = SLOTS.indexOf(slotOfCrew(c));
      if (slot < 0) continue;
      const came = c.members.filter(id => canBook(id, slot) && !state.safetyHolds.some(h => h.memberId === id) &&
        oracle.u("crewself", coins.key(`crewself:w${week}:${c.activityId}:${signature(c.members)}:${id}`, c.id)) < 0.75 * Math.pow(0.97, age) * (1 - oracle.p(id).hidden.flakiness));
      if (came.length < 2) continue;
      for (const id of came) reserve(id, slot);
      held(`self:${c.id}:w${week}`, "crew_self", came, c.activityId, hoodOfVenue(c.venueId) ?? oracle.p(c.members[0]!).hidden.home, week, slotDay(week, slot), slotTime(week, slot), c.id);
    }
    // Invitations precede this week's meetups: keep their prior experience fixed, then keep the
    // latest outcome by meetup time, because proposal order is not time order (PR #450).
    for (const m of completedEnjoyment.sort((x, y) => x.at - y.at))
      for (const [id, enjoyed] of Object.entries(m.values)) world.lastEnjoy.set(id, enjoyed);
    // Hidden hangouts between pairs who both want more.
    for (const k of [...world.mutual].sort()) {
      const [a, b] = k.split("|") as [MemberId, MemberId];
      if (oracle.selfHangout(a, b, week, world.meetupsTogether.get(k) ?? 0)) { addHours(a, b, P.selfHours, week); world.selfHangouts++; world.selfTogether.set(k, (world.selfTogether.get(k) ?? 0) + 1); }
    }
  }
  return { world, flows, meetups, contacts, matcher: matcherName, valueDays };

  function held(key: string, kind: MeetupRecord["kind"], attendees: MemberId[], activity: string, venueHood: string, week: number, day: number, at: number, crewId?: string) {
    const coin = coins.key(`meet:w${week}:${activity}:${signature(attendees)}`, key);
    const res = oracle.meetup(coin, attendees, activity, venueHood, (a, b) => world.bond.get(pk(a, b)) ?? 0);
    completedEnjoyment.push({ at, values: res.enjoy });
    const dur = activityById.get(activity)?.durationMin ?? 120;
    const travel: Record<MemberId, number> = {};
    for (const id of attendees) { travel[id] = oracle.travel(id, venueHood); addValue(id, day); }
    for (let i = 0; i < attendees.length; i++) for (let j = i + 1; j < attendees.length; j++) {
      const a = attendees[i]!, b = attendees[j]!, k = pk(a, b);
      const h = oracle.pairHours(dur, attendees.length, res.enjoy[a]!, res.enjoy[b]!);
      addHours(a, b, h, week);
      world.meetupsTogether.set(k, (world.meetupsTogether.get(k) ?? 0) + 1);
      if (res.seeAgain[a]!.includes(b) && res.seeAgain[b]!.includes(a)) { world.mutual.add(k); world.bond.set(k, (world.bond.get(k) ?? 0) + h); }
      if (!res.seeAgain[a]!.includes(b)) world.disliked.add(dk(a, b));
      if (!res.seeAgain[b]!.includes(a)) world.disliked.add(dk(b, a));
      state.edges.push({ from: a, to: b, type: "met", strength: 0.5, explicit: true, createdAt: at });
    }
    meetups.push({ key, week, day, kind, activity, venueHood, attendees: [...attendees], enjoy: res.enjoy, good: res.good, travel, ...(crewId ? { crewId } : {}) });
    return { ...res, coin };
  }
  /** Reported harms (reported right after the meetup): the offender is held, the victim blocks them. */
  function applyHarms(harms: HarmEvent[], at: number) {
    for (const h of harms) {
      if (!h.reported) continue;
      if (!state.safetyHolds.some(x => x.memberId === h.offender)) state.safetyHolds.push({ memberId: h.offender, from: at, reason: `reported: ${h.kind}` });
      if (h.kind !== "minor_contact") state.edges.push({ from: h.victim, to: h.offender, type: "blocked", strength: 1, explicit: true, createdAt: at });
    }
  }
}

/** A crew's weekly slot (from its founding plan time). */
export function slotOfCrew(c: Crew): (typeof SLOTS)[number] {
  const d = new Date(c.slot.start);
  const lp = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(d);
  const wd = lp.find(x => x.type === "weekday")!.value, hr = Number(lp.find(x => x.type === "hour")!.value);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  const map: Record<number, string> = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 0: "sun" };
  const part = day === 0 || day === 6 ? (hr < 12 ? "am" : hr < 17 ? "pm" : "eve") : "eve";
  return `${map[day]}_${part}` as (typeof SLOTS)[number];
}
/** The shared public venue catalog (engine pack) and each venue's neighborhood. */
export const VENUES = nycVenues(FRIEND_ACTIVITIES);
export const VENUE_BY_ID = new Map(VENUES.map(v => [v.id, v]));
const VENUE_HOOD = new Map(VENUES.map(v => [v.id, hood(v.area)!.id]));
const hoodOfVenue = (venueId?: string) => (venueId ? VENUE_HOOD.get(venueId) : undefined);
