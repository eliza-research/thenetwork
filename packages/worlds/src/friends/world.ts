// The friends.help harness: weekly rounds over ~400 New Yorkers. Each week:
//   0. the opt-in weekly check-in ("what's your week like?") is answered (visible as stated windows);
//   1. the matcher reads ONLY the snapshot and returns proposals: new plans (groups of 3-6, or an
//      activity pair), "same table again" repeats, crew offers and crew sessions;
//   2. probes are anonymous, activity-first, with 1-3 time options; each member answers with the
//      options they are truly free for; a plan books the option most yes-sayers picked once quorum
//      is reached (alternates are probed to backfill); a pair is asked first-then-second;
//   3. the reveal is the booked plan (names exchanged: this is a "contact"); a member may back out;
//   4. attendance, enjoyment (least misery), harms, private "see again?" answers, hours together;
//   5. crews: an offer is opted into person by person (>= 3 form it); sessions weekly; after 3
//      sessions the crew is handed to its own group chat and keeps meeting on its own (decaying);
//   6. pairs who both want to see each other again also meet on their own (hidden hangouts).
// Caps (attention v1.2 + plans v1.1 founder decisions, carried to every app, PRD 40.4): at most 1
// new-plan invite per member per week (plan allowance; repeats count, crew sessions and crew offers
// do not), at most 2 booked meetups per member per week and never two in one slot. Proposals past a
// cap lose that member silently. A proposal naming a member with a CLAIMED age under 18 is dropped
// and counted (policy violation; must be 0).
import { canBeMatched, type MemberId } from "@thenetwork/core";
import type { Crew } from "@thenetwork/engine/src/plans.ts";
import type { InteractionRecord } from "@thenetwork/engine/src/types.ts";
import { activityById } from "@thenetwork/engine/src/packs/network/activities.ts";
import { hood, nycVenues } from "@thenetwork/engine/src/packs/friends/index.ts";
import { Rng, hash32 } from "@thenetwork/sim/src/rng.ts";
import { FriendsOracle, ORACLE_PARAMS, type HarmEvent, type OracleParams } from "./oracle.ts";
import { FRIEND_ACTIVITIES, SLOTS, generateFriendsPersonas, isReal, type FriendsGenOptions, type FriendsPersona } from "./persona.ts";
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
}
export interface MatcherContext { week: number; snapshot: FriendsSnapshot; rng: Rng }
export interface FriendsMatcher { name: string; propose(ctx: MatcherContext): FriendsProposal[] }

export interface MeetupRecord {
  key: string; week: number; day: number; kind: ProposalKind | "crew_self"; activity: string; venueHood: string;
  attendees: MemberId[]; enjoy: Record<MemberId, number>; good: boolean; travel: Record<MemberId, number>;
  crewId?: string;
}
export interface FlowRecord {
  key: string; week: number; kind: ProposalKind; invited: MemberId[];
  stage: "dropped_policy" | "no_quorum" | "backout" | "no_show" | "held" | "crew_declined";
  probed: number; yes: number; replied: number; going: MemberId[]; booked: MemberId[]; attended: MemberId[];
  declaredMinor: boolean; harms: HarmEvent[]; capDrops: number;
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
  lastEnjoy: Map<MemberId, number>;
  selfHangouts: number;
}
export interface FriendsRunResult { world: FriendsWorld; flows: FlowRecord[]; meetups: MeetupRecord[]; contacts: Contact[]; matcher: string; valueDays: Map<MemberId, number[]> }

export const pk = (a: MemberId, b: MemberId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const dk = (a: MemberId, b: MemberId) => `${a}>${b}`;

export function createFriendsWorld(o: Omit<FriendsRunOptions, "matcher">): FriendsWorld {
  const weeks = o.weeks ?? 8;
  const personas = o.personas ?? generateFriendsPersonas({ ...o, seed: o.seed });
  return {
    seed: o.seed, weeks, personas, oracle: new FriendsOracle(personas, o.seed, { ...ORACLE_PARAMS, ...(o.params ?? {}) }), state: emptyFriendsState(),
    hours: new Map(), hoursByWeek: new Map(), meetupsTogether: new Map(), bond: new Map(), mutual: new Set(), disliked: new Set(), lastEnjoy: new Map(), selfHangouts: 0,
  };
}

export function runFriendsWorld(o: FriendsRunOptions): FriendsRunResult {
  const world = createFriendsWorld(o);
  const matcher = typeof o.matcher === "function" ? o.matcher(world) : o.matcher;
  const { oracle, state } = world;
  const planCap = o.planCap ?? 1, bookCap = o.bookCap ?? 2, introCap = o.introCap ?? 2;
  const flows: FlowRecord[] = [], meetups: MeetupRecord[] = [], contacts: Contact[] = [];
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
    state.week = week;
    state.now = weekTime(week, 0, 9); // Monday 09:00 local: the weekly planner run
    // 0. check-ins
    state.checkIns = new Map();
    for (const p of world.personas) {
      const h = p.hidden;
      if (!h.checkIn || !canBeMatched(p.stated.claimedAge) || oracle.u("checkin", p.id, week) >= h.replyProb) continue;
      const free = SLOTS.map((s, k) => [s, k] as const).filter(([, k]) => (oracle.free(p.id, week, k) ? oracle.u("ci", p.id, week, k) < 0.85 : oracle.u("ci", p.id, week, k) < 0.05)).map(([s]) => s);
      state.checkIns.set(p.id, free);
    }
    const snapshot = buildFriendsSnapshot(world.personas, state);
    const proposals = matcher.propose({ week, snapshot, rng: new Rng(hash32(o.seed, "matcher", week)) });
    const planInvites = new Map<MemberId, number>(), introInvites = new Map<MemberId, number>(), booked = new Map<MemberId, number>(), bookedSlots = new Set<string>(), answered = new Map<MemberId, number>();
    const canBook = (id: MemberId, slot: number) => (booked.get(id) ?? 0) < bookCap && !bookedSlots.has(`${id}|${slot}`);

    proposals.forEach((pr, idx) => {
      const key = `w${week}:${idx}:${pr.kind}`;
      const f: FlowRecord = { key, week, kind: pr.kind, invited: [...pr.invited], stage: "dropped_policy", probed: 0, yes: 0, replied: 0, going: [], booked: [], attended: [], declaredMinor: false, harms: [], capDrops: 0 };
      flows.push(f);
      const everyone = [...pr.invited, ...pr.alternates];
      if (everyone.some(id => !oracle.byId.has(id))) return;
      if (everyone.some(id => !canBeMatched(oracle.p(id).stated.claimedAge))) { f.declaredMinor = true; return; }
      if (!pr.options.length || !activityById.has(pr.activity)) return;
      // Initial invites: new plans use the plan allowance, one-to-one partner intros the intro cap.
      // Repeats and crew offers ride on the member's own post-meetup answer; crew sessions are opted in.
      const cap = pr.kind === "plan" ? { m: planInvites, n: planCap } : pr.kind === "partner" ? { m: introInvites, n: introCap } : undefined;
      const crewState = pr.crewId ? state.crews.find(c => c.id === pr.crewId) : undefined;
      if (pr.kind === "crew_session" && (!crewState || crewState.handedOff)) return;
      const prevEnjoy = (id: MemberId) => (pr.kind === "plan" || pr.kind === "partner" ? undefined : world.lastEnjoy.get(id));
      const size = Math.max(2, pr.invited.length);
      const ask = (id: MemberId, options: number[]) => {
        if (cap) {
          if ((cap.m.get(id) ?? 0) >= cap.n) { f.capDrops++; return null; }
          cap.m.set(id, (cap.m.get(id) ?? 0) + 1);
          if (pr.kind === "plan") state.lastPlannedAt.set(id, state.now);
        }
        f.probed++;
        const primed = (state.checkIns.get(id) ?? []).some(s => options.includes(SLOTS.indexOf(s)));
        const a = oracle.answer(id, key, { week, activity: pr.activity, venueHood: pr.venueHood, size, options, prevEnjoy: prevEnjoy(id), crew: pr.kind === "crew_session" || pr.kind === "crew_offer", fatigue: answered.get(id) ?? 0, primed });
        answered.set(id, (answered.get(id) ?? 0) + 1);
        if (a.replied) f.replied++;
        if (a.yes) f.yes++;
        return a;
      };

      // Crew offer: opt in person by person; >= 3 form the crew, whose first session is this proposal.
      let invited = [...pr.invited];
      if (pr.kind === "crew_offer" && pr.crew) {
        state.offered.push({ ...pr.crew });
        const optIn = invited.filter(id => oracle.crewOptIn(id, key, world.lastEnjoy.get(id) ?? 0.5));
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
        for (const s of pr.options) { const c = [...picks.values()].filter(x => x.includes(s)).length; if (c > n) { n = c; best = s; } }
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
        const g = table === 0 ? f : { ...f, key: `${key}:t${table}`, probed: 0, yes: 0, replied: 0, capDrops: 0, harms: [], going: [], booked: [], attended: [], stage: "no_quorum" as FlowRecord["stage"] };
        if (table > 0) flows.push(g);
        bookTable(g, going, slot);
        table++;
        if (!pr.split || partner) break;
      }

      function bookTable(g: FlowRecord, going: MemberId[], slot: number) {
        const tkey = g.key;
        g.going = going;
        // 3. reveal: names exchanged (contact), bots show themselves in the thread
        const day = slotDay(week, slot), at = slotTime(week, slot);
        for (let i = 0; i < going.length; i++) for (let j = i + 1; j < going.length; j++) contacts.push({ a: going[i]!, b: going[j]!, day, key: tkey });
        for (const b of going.filter(id => oracle.p(id).hidden.adversary === "bot"))
          for (const v of going.filter(id => isReal(oracle.p(id)))) g.harms.push({ kind: "bot_contact", offender: b, victim: v, reported: oracle.u("report", tkey, b, v) < 0.25 });
        const out = going.filter(id => oracle.backsOut(id, tkey, going.some(j => j !== id && world.disliked.has(dk(id, j)))));
        g.booked = going.filter(id => !out.includes(id));
        if (g.booked.length < 2) { g.stage = "backout"; record(tkey, "cancelled", going, at); applyHarms(g.harms, at); return; }
        for (const id of g.booked) { booked.set(id, (booked.get(id) ?? 0) + 1); bookedSlots.add(`${id}|${slot}`); }
        // 4. the meetup
        g.attended = g.booked.filter(id => oracle.attends(id, tkey, week, slot, pr.venueHood));
        if (g.attended.length < 2) { g.stage = "no_show"; record(tkey, "no_show", g.booked, at); applyHarms(g.harms, at); return; }
        g.stage = "held";
        const res = held(tkey, pr.kind, g.attended, pr.activity, pr.venueHood, week, day, pr.crewId ?? (pr.kind === "crew_offer" ? state.crews[state.crews.length - 1]!.id : undefined));
        g.harms.push(...res.harms);
        record(tkey, "completed", g.attended, at);
        // Feedback the Network receives (private): rating and "see again?" per person.
        const reportedPositive: MemberId[] = [];
        for (const i of g.attended) {
          const h = oracle.p(i).hidden;
          if (oracle.u("fb", tkey, i) >= h.replyProb * 0.9) continue;
          const honest = oracle.u("honest", tkey, i) < h.honesty;
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

    // Handed-off crews keep meeting on their own (decaying); members still count it as time together.
    for (const c of state.crews) {
      if (!c.handedOff) continue;
      const age = week - c.formedWeek;
      const slot = SLOTS.indexOf(slotOfCrew(c));
      const came = c.members.filter(id => !state.safetyHolds.some(h => h.memberId === id) && oracle.u("crewself", c.id, id, week) < 0.75 * Math.pow(0.97, age) * (1 - oracle.p(id).hidden.flakiness) && (booked.get(id) ?? 0) < bookCap);
      if (came.length < 2 || slot < 0) continue;
      held(`self:${c.id}:w${week}`, "crew_self", came, c.activityId, hoodOfVenue(c.venueId) ?? oracle.p(c.members[0]!).hidden.home, week, slotDay(week, slot), c.id);
    }
    // Hidden hangouts between pairs who both want more.
    for (const k of [...world.mutual].sort()) {
      const [a, b] = k.split("|") as [MemberId, MemberId];
      if (oracle.selfHangout(a, b, week, world.meetupsTogether.get(k) ?? 0)) { addHours(a, b, P.selfHours, week); world.selfHangouts++; }
    }
  }
  return { world, flows, meetups, contacts, matcher: matcher.name, valueDays };

  function held(key: string, kind: MeetupRecord["kind"], attendees: MemberId[], activity: string, venueHood: string, week: number, day: number, crewId?: string) {
    const res = oracle.meetup(key, attendees, activity, venueHood, (a, b) => world.bond.get(pk(a, b)) ?? 0);
    const dur = activityById.get(activity)?.durationMin ?? 120;
    const travel: Record<MemberId, number> = {};
    for (const id of attendees) { travel[id] = oracle.travel(id, venueHood); addValue(id, day); world.lastEnjoy.set(id, res.enjoy[id]!); }
    for (let i = 0; i < attendees.length; i++) for (let j = i + 1; j < attendees.length; j++) {
      const a = attendees[i]!, b = attendees[j]!, k = pk(a, b);
      const h = oracle.pairHours(dur, attendees.length, res.enjoy[a]!, res.enjoy[b]!);
      addHours(a, b, h, week);
      world.meetupsTogether.set(k, (world.meetupsTogether.get(k) ?? 0) + 1);
      if (res.seeAgain[a]!.includes(b) && res.seeAgain[b]!.includes(a)) { world.mutual.add(k); world.bond.set(k, (world.bond.get(k) ?? 0) + h); }
      if (!res.seeAgain[a]!.includes(b)) world.disliked.add(dk(a, b));
      if (!res.seeAgain[b]!.includes(a)) world.disliked.add(dk(b, a));
      state.edges.push({ from: a, to: b, type: "met", strength: 0.5, explicit: true, createdAt: slotTime(week, 0) });
    }
    meetups.push({ key, week, day, kind, activity, venueHood, attendees: [...attendees], enjoy: res.enjoy, good: res.good, travel, ...(crewId ? { crewId } : {}) });
    return res;
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
const VENUE_HOOD = new Map(VENUES.map(v => [v.id, hood(v.area)!.id]));
const hoodOfVenue = (venueId?: string) => (venueId ? VENUE_HOOD.get(venueId) : undefined);
