// Build a core WorldSnapshot from personas' PUBLIC side (what an ideal onboarding would
// capture). This is what an Engine receives; it never includes hidden truth, except that
// private disclosures are present as agent_private facets (that is realistic: members tell
// the agent things in confidence) so engines can be tested for privacy leaks.
import { DAY, HOUR, parseReply, type Category, type City, type Edge, type Facet, type Intent, type Member, type MemberId, type OpportunityKind, type Presence, type Proposal, type WorldSnapshot } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { intentHorizonDays, intentRecordTiming, type Persona } from "./persona.ts";
import { hash32 } from "@thenetwork/core";
import { desireById, SKILLS } from "./taxonomy.ts";
import { VAGUE_INTENT, type Knowledge } from "./sources.ts";
import { PLAN_AGAIN_RE, planAgainAnswer } from "./plans.ts";

/**
 * What the snapshot exposes beyond the legacy public profile (2026-10-07, engine v1.2). Each is
 * information a production Network has; none is hidden truth the member did not share.
 */
export interface SnapshotFeatures {
  /** Public event listings per city per week (the Network ingests public events; M1). 0 = none. */
  eventsPerWeek: number;
  /**
   * Members agreed that some interests they told the agent may be mentioned in introductions
   * (scope "shareable"; per interest, SHARE_CONSENT of the time, as in the synthetic dataset).
   * Enables theme groups (group_composer).
   */
  shareInterests: boolean;
  /** Hosting / cooking-for-groups skills carry the "host" tag (newcomer_welcome needs hosts). */
  hostTags: boolean;
  /** Members opted in to romance stated who they hope to meet (romance:is / seeks / age tags, agent_private). */
  romancePrefs: boolean;
  /**
   * Plans v1.1 (default off; WorldOptions.plans turns it on): a member's answer to "Would you do this
   * again?" after a plan becomes would_interact_again edges to the others who came (planAgainEdges).
   * Needs SnapshotState.records.
   */
  planAgainEdges?: boolean;
}
/** Default since engine v1.2 (docs/results/2026-10-07-engine-v1.2.md). */
export const SNAPSHOT_FEATURES: SnapshotFeatures = { eventsPerWeek: 6, shareInterests: true, hostTags: true, romancePrefs: true };
/** Share of stated interests a member agrees to have mentioned (synthetic dataset: 0.6). */
export const SHARE_CONSENT = 0.6;

export interface SnapshotState {
  now: number; worldStart: number;
  joined: Map<string, number>;          // memberId -> joinedAt
  optedOut: Set<string>;
  blocks: { from: string; to: string; at: number }[];
  unanswered: Map<string, number>;
  recentProposals: Proposal[];
  /** Snapshot features (default SNAPSHOT_FEATURES). */
  features?: Partial<SnapshotFeatures>;
  /**
   * The run's records so far. When given, the snapshot also carries what the Network itself
   * recorded: interactions and feedback (pair cooldowns, second encounters, response history),
   * open opportunities, and which proposals were never sent (networkStateFromRecords).
   */
  records?: readonly RunRecord[];
}

/** Engine-extension fields (structurally the engine's EngineInput extensions; sim does not import the engine). */
export interface SimEvent { id: string; title: string; city: City; start: number; end: number; tags: string[]; category: Category }
export interface SimInteraction {
  id: string; kind: OpportunityKind; category: Category; participants: MemberId[]; at: number;
  outcome: "pending" | "accepted" | "declined" | "expired" | "completed" | "no_show";
  declinedBy?: MemberId[]; acceptedBy?: MemberId[]; noResponse?: MemberId[];
}
export interface SimFeedback { id: string; from: MemberId; about: MemberId; opportunityId: string; at: number; sentiment: "positive" | "neutral" | "negative"; wouldMeetAgain: boolean }
export interface SimOpenOpportunity { id: string; participants: MemberId[]; stage: "inviting" | "scheduled"; until?: number }
export interface SimSnapshot extends WorldSnapshot {
  events?: SimEvent[];
  interactions?: SimInteraction[];
  feedback?: SimFeedback[];
  openOpportunities?: SimOpenOpportunity[];
  unsentProposalIds?: string[];
}

/** Longest look-back any engine budget uses (Quiet: 1 per 30 days). */
export const RECENT_PROPOSAL_DAYS = 30;

export function quietHoursOf(p: Persona): [number, number] {
  return [Math.min(p.routine.sleep === 0 ? 24 : p.routine.sleep, 22) % 24, Math.max(p.routine.wake + 1, 8)];
}

export function memberOf(p: Persona, s: Pick<SnapshotState, "joined" | "optedOut" | "unanswered">): Member {
  const formats: Member["prefs"]["formats"] = p.hidden.preferredGroupSize <= 2 ? ["one_to_one", "small_group"] : ["small_group", "one_to_one", "event"];
  const k = p.knowledge;
  // With a Knowledge profile only the intents the member actually told the agent count, and a
  // minimal-tier member never set a romance opt-in unless their one want was romance.
  const known = k ? k.chat.intents.map(i => p.public.statedIntents[i]!).filter(Boolean) : p.public.statedIntents;
  const cats = Array.from(new Set(["social", ...known.map(i => i.category)])) as Member["prefs"]["categoriesOptIn"];
  const romance = p.public.claimedAge >= 18 && (known.some(i => i.category === "romance")
    || (p.hidden.romance.optIn && p.hidden.adversarial !== "minor" && k?.richness !== "minimal"));
  return {
    id: p.id, name: p.name, homeCity: p.homeCity,
    state: s.optedOut.has(p.id) ? "paused" : p.archetype === "busy_parent" ? "quiet" : "normal",
    prefs: {
      categoriesOptIn: romance && !cats.includes("romance") ? [...cats, "romance"] : cats,
      quietHours: quietHoursOf(p), romanceOptIn: romance, formats,
      maxTravelMinutes: p.archetype === "busy_parent" ? 20 : 35, onlyWhenAsked: (s.unanswered.get(p.id) ?? 0) >= 2,
    },
    invitedBy: p.invitedBy, joinedAt: s.joined.get(p.id) ?? 0, age: p.public.claimedAge,
    unansweredProactive: s.unanswered.get(p.id) ?? 0,
    ...(k ? { connectedSources: k.sources.map(x => ({ ...x })) } : {}),
  };
}

/**
 * Facets/intents for a persona with a Knowledge profile: only what they told the agent (chat
 * coverage) plus facets from their active connected sources. Hidden truth labels are stripped.
 * Minors (stated age < 18): every facet agent_private.
 */
function pushKnownFacets(p: Persona, k: Knowledge, jt: number, now: number, unresponsive: (id: string) => boolean, facets: Facet[], intents: Intent[], feat: SnapshotFeatures) {
  const minor = p.public.claimedAge < 18;
  const c = k.chat;
  const said = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], i: number): Facet =>
    ({ id: `${p.id}:f${facets.length}:${i}`, memberId: p.id, kind, value, tags, scope: minor ? "agent_private" : scope, provenance: "said", confidence: 0.8,
      validFrom: jt, source: "chat", observedAt: jt, inferred: false, confirmedByMember: true });
  c.interests.forEach((t, i) => facets.push(said("interest", t.replace(/_/g, " "), [t], interestScope(p, t, feat), i)));
  c.skills.forEach((t, i) => facets.push(said("skill", SKILLS.find(x => x.tag === t)?.label ?? t, skillTags(t, feat), "matchable", i)));
  c.boundaries.forEach(i => { const b = p.hidden.boundaries[i]; if (b) facets.push(said("boundary", b, ["boundary"], "agent_private", i)); });
  if (c.disclosure && p.hidden.privateDisclosure) {
    const d = p.hidden.privateDisclosure;
    facets.push(said("fact", `${d.fact} (ref ${d.canary})`, ["sensitive"], "agent_private", 0));
  }
  if (c.neighborhood) facets.push(said("fact", `lives near ${p.routine.homeArea}`, ["neighborhood"], "shareable", 0));
  k.observations.forEach((o, i) => facets.push({ ...o.facet, tags: [...o.facet.tags], id: `${p.id}:s${facets.length}:${i}`, memberId: p.id, scope: minor ? "agent_private" : o.facet.scope }));
  for (const i of c.intents) {
    const it = p.public.statedIntents[i];
    const rec = it && intentRecordTiming(p, i, now, jt, { unresponsive: unresponsive(p.id) });
    if (!it || !rec) continue;
    const def = desireById.get(it.desireId);
    intents.push({
      id: `${p.id}:i${i}`, memberId: p.id, objective: c.intentMode === "vague" ? VAGUE_INTENT[it.category] ?? "meet some new people" : it.text, category: it.category,
      details: c.intentMode === "detailed" && def ? `format: ${def.format}; tags: ${[...def.needsInterests, ...def.needsSkills, def.pool ?? ""].filter(Boolean).join(",")}` : undefined,
      horizonDays: intentHorizonDays(it.category), status: rec.status, createdAt: rec.createdAt,
    });
  }
}

export function buildSnapshot(personas: Persona[], s: SnapshotState): SimSnapshot {
  const feat: SnapshotFeatures = { ...SNAPSHOT_FEATURES, ...(s.features ?? {}) };
  const joined = personas.filter(p => s.joined.has(p.id));
  const ids = new Set(joined.map(p => p.id));
  const members = joined.map(p => memberOf(p, s));
  const facets: Facet[] = [];
  const intents: Intent[] = [];
  const presence: Presence[] = [];
  const edges: Edge[] = [];
  for (const p of joined) {
    const jt = s.joined.get(p.id)!;
    const k = p.knowledge;
    if (k) pushKnownFacets(p, k, jt, s.now, id => (s.unanswered.get(id) ?? 0) >= 2, facets, intents, feat);
    else {
      const f = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], i: number): Facet =>
        ({ id: `${p.id}:f${facets.length}:${i}`, memberId: p.id, kind, value, tags, scope, provenance: "said", confidence: 0.8, validFrom: jt });
      p.public.statedInterests.forEach((t, i) => facets.push(f("interest", t.replace(/_/g, " "), [t], interestScope(p, t, feat), i)));
      p.public.statedSkills.forEach((t, i) => {
        const sk = SKILLS.find(x => x.tag === t);
        facets.push(f("skill", sk?.label ?? t, skillTags(t, feat), "matchable", i));
      });
      p.hidden.boundaries.forEach((b, i) => facets.push(f("boundary", b, ["boundary"], "agent_private", i)));
      if (p.hidden.privateDisclosure) {
        const d = p.hidden.privateDisclosure;
        facets.push(f("fact", `${d.fact} (ref ${d.canary})`, ["sensitive"], "agent_private", 0));
      }
      facets.push(f("fact", `lives near ${p.routine.homeArea}`, ["neighborhood"], "shareable", 0));
      p.public.statedIntents.forEach((it, i) => {
        // Anchored to the snapshot's `now`: stated at join (or statedAt), re-confirmed at the
        // check-ins the member answered, withdrawn once the want lapsed (persona.ts).
        const rec = intentRecordTiming(p, i, s.now, jt, { unresponsive: (s.unanswered.get(p.id) ?? 0) >= 2 });
        if (!rec) return;
        const def = desireById.get(it.desireId);
        intents.push({
          id: `${p.id}:i${i}`, memberId: p.id, objective: it.text, category: it.category,
          details: def ? `format: ${def.format}; tags: ${[...def.needsInterests, ...def.needsSkills, def.pool ?? ""].filter(Boolean).join(",")}` : undefined,
          horizonDays: intentHorizonDays(it.category), status: rec.status, createdAt: rec.createdAt,
        });
      });
    }
    if (feat.romancePrefs) {
      const m = members.find(x => x.id === p.id)!;
      if (m.prefs.romanceOptIn && (!k || knowsRomance(p, k))) facets.push(romancePrefFacet(p, jt, facets.length));
    }
    presence.push({ memberId: p.id, city: p.homeCity, type: "home", areas: [p.routine.homeArea, p.routine.workArea] });
    if (p.secondaryCity) presence.push({ memberId: p.id, city: p.secondaryCity, type: "routine", areas: [] });
    // Trips become known once announced (we expose them from 2 days before departure).
    for (const tr of p.hidden.trips) {
      const from = s.worldStart + tr.fromDay * DAY, to = s.worldStart + (tr.toDay + 1) * DAY;
      if (s.now >= from - 2 * DAY && s.now < to) presence.push({ memberId: p.id, city: tr.city, type: "temporary", areas: [], from, to });
    }
    if (p.invitedBy && ids.has(p.invitedBy))
      edges.push({ from: p.invitedBy, to: p.id, type: "invited_by", strength: 0.7, explicit: true, createdAt: jt });
    for (const r of p.relationships) {
      if (r.type === "ex" || !ids.has(r.to) || p.id > r.to) continue; // exes are not disclosed; one edge per pair
      edges.push({ from: p.id, to: r.to, type: "knows", strength: r.closeness, explicit: true, createdAt: jt });
    }
  }
  for (const b of s.blocks) if (ids.has(b.from)) edges.push({ from: b.from, to: b.to, type: "blocked", strength: 1, explicit: true, createdAt: b.at });
  // Recent proposals by time, not by count: the engine's budgets look back up to 30 days (Quiet),
  // so a fixed last-200 cut silently forgot proposals once a run produced more than 200 in that
  // window, and members were over-proposed.
  const since = s.now - RECENT_PROPOSAL_DAYS * DAY;
  const snap: SimSnapshot = { now: s.now, members, facets, intents, presence, edges, recentProposals: s.recentProposals.filter(p => p.createdAt >= since && p.createdAt <= s.now) };
  if (feat.eventsPerWeek > 0) snap.events = publicEvents(snap, feat.eventsPerWeek);
  if (s.records) Object.assign(snap, networkStateFromRecords(s.records, s.now));
  if (feat.planAgainEdges && s.records) snap.edges.push(...planAgainEdges(s.records, s.now).filter(e => ids.has(e.from) && ids.has(e.to)));
  return snap;
}

function interestScope(p: Persona, tag: string, feat: SnapshotFeatures): Facet["scope"] {
  if (!feat.shareInterests || p.public.claimedAge < 18) return "matchable";
  return (hash32("share-consent", p.id, tag) % 1000) / 1000 < SHARE_CONSENT ? "shareable" : "matchable";
}
function skillTags(t: string, feat: SnapshotFeatures): string[] {
  const sk = SKILLS.find(x => x.tag === t);
  return [t, ...(sk?.teaches ? [sk.teaches] : []), ...(feat.hostTags && (t === "hosting" || t === "chef") ? ["host"] : [])];
}
/**
 * With a Knowledge profile, romance preferences are known except for minimal-tier members (one
 * vague want, no details): the engine asks them first (engine v1.2 romance gate).
 */
function knowsRomance(_p: Persona, k: Knowledge): boolean {
  return k.richness !== "minimal";
}
/** Same tags and wording as the synthetic dataset (scripts/synthetic/generate.ts). */
function romancePrefFacet(p: Persona, jt: number, n: number): Facet {
  const r = p.hidden.romance;
  const who = r.seeking.map(g => (g === "nonbinary" ? "nonbinary people" : g === "woman" ? "women" : "men")).join(" and ");
  return {
    id: `${p.id}:f${n}:romance`, memberId: p.id, kind: "preference", value: `Open to dating; interested in ${who}, ages ${r.ageRange[0]}-${r.ageRange[1]}`,
    tags: [`romance:is:${p.gender}`, ...r.seeking.map(g => `romance:seeks:${g}`), `romance:age:${r.ageRange[0]}-${r.ageRange[1]}`],
    scope: "agent_private", provenance: "said", confidence: 0.8, validFrom: jt,
    source: "chat", observedAt: jt, inferred: false, confirmedByMember: true,
  };
}

/**
 * Public event listings: `perWeek` events per city per week, this week and next, around the
 * interests most common among the city's adult members (a city has listings for what its people
 * like; the engine sees only title, time, place and tags). Deterministic.
 */
export function publicEvents(snap: Pick<WorldSnapshot, "now" | "members" | "facets">, perWeek: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (const city of ["sf", "nyc"] as const) {
    const ids = new Set(snap.members.filter(m => m.homeCity === city && m.age >= 18).map(m => m.id));
    const counts = new Map<string, number>();
    for (const f of snap.facets) if (ids.has(f.memberId) && f.kind === "interest" && f.tags[0]) counts.set(f.tags[0], (counts.get(f.tags[0]) ?? 0) + 1);
    const tags = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).map(([t]) => t);
    const week = Math.floor(snap.now / (7 * DAY));
    for (let w = 0; w < 2; w++) for (let k = 0; k < perWeek; k++) {
      const tag = tags[(k + (week + w) * perWeek) % Math.max(1, tags.length)];
      if (!tag) continue;
      const start = (week + w) * 7 * DAY + ((k % 6) + 1) * DAY + (city === "sf" ? 26 : 23) * HOUR; // ~7pm local
      if (start < snap.now) continue;
      events.push({ id: `ev:${city}:${week + w}:${k}`, title: `${tag.replace(/_/g, " ")} night`, city, start, end: start + 3 * HOUR, tags: [tag], category: "social" });
    }
  }
  return events;
}

/**
 * What the Network itself recorded, rebuilt from the run's records up to `now`: interactions
 * (with who said yes, who declined and who never answered), meeting feedback, opportunities still
 * open (invite pending or meeting ahead) and proposals it never sent. No hidden truth: a member's
 * answer is read from the reply they actually sent (an ignored invite is "no response", never the
 * persona's private decision), and feedback comes only from feedback requests a member answered,
 * read from their words (never from the oracle's enjoyment). Attendance comes from the outcome.
 */
export function networkStateFromRecords(records: readonly RunRecord[], now: number): Required<Pick<SimSnapshot, "interactions" | "feedback" | "openOpportunities" | "unsentProposalIds">> {
  const props = new Map<string, Proposal>();
  const skipped = new Set<string>();
  const declines = new Map<string, MemberId[]>(), yes = new Map<string, Set<MemberId>>(), invited = new Map<string, Map<MemberId, number>>();
  const scheduled = new Map<string, { at: number; participants: MemberId[] }>();
  const outcome = new Map<string, Extract<RunRecord, { type: "outcome" }>>();
  const answered = new Set<string>();
  // The open thread per member: the last delivered Network message that expects an answer.
  const thread = new Map<MemberId, { type?: string; proposalId?: string }>();
  const said: { from: MemberId; pid: string; at: number; text: string }[] = [];
  for (const r of records) {
    if (r.t > now) break;
    if (r.type === "proposal") props.set(r.proposal.id, r.proposal);
    else if (r.type === "network_log" && r.kind === "proposal_skipped") skipped.add(String(r.detail.proposalId));
    else if (r.type === "message" && !r.msg.system) {
      const m = r.msg;
      if (m.direction === "outbound") {
        const pid = m.meta?.proposalId;
        if (m.meta?.type === "proposal" && pid) { if (!invited.has(pid)) invited.set(pid, new Map()); invited.get(pid)!.set(m.memberId, m.ts); }
        if (m.status === "delivered" && m.meta?.type && !["info", "confirmation"].includes(m.meta.type)) thread.set(m.memberId, { type: m.meta.type, proposalId: pid });
      } else if (!m.keyword) {
        const th = thread.get(m.memberId);
        const key = `${th?.proposalId}|${m.memberId}`;
        if (th?.type !== "proposal" || !th.proposalId || answered.has(key)) continue;
        const a = inviteAnswer(m.body);
        if (!a) continue;
        answered.add(key);
        if (a === "no") { if (!declines.has(th.proposalId)) declines.set(th.proposalId, []); declines.get(th.proposalId)!.push(m.memberId); }
        else { if (!yes.has(th.proposalId)) yes.set(th.proposalId, new Set()); yes.get(th.proposalId)!.add(m.memberId); }
      }
    } else if (r.type === "meeting_scheduled") scheduled.set(r.proposalId, { at: r.at, participants: r.participants });
    else if (r.type === "outcome") outcome.set(r.proposalId, r);
    else if (r.type === "feedback" && r.proposalId) said.push({ from: r.memberId, pid: r.proposalId, at: r.t, text: r.text });
  }
  const interactions: SimInteraction[] = [];
  const feedback: SimFeedback[] = [];
  const openOpportunities: SimOpenOpportunity[] = [];
  for (const [pid, p] of props) {
    if (skipped.has(pid)) continue;
    const acceptedBy: MemberId[] = [], noResponse: MemberId[] = [];
    for (const [id, ts] of invited.get(pid) ?? new Map<MemberId, number>()) {
      if (answered.has(`${pid}|${id}`)) { if (yes.get(pid)?.has(id)) acceptedBy.push(id); }
      else if (now - ts > 48 * HOUR) noResponse.push(id); // an expired invite is an implicit no
    }
    let out: SimInteraction["outcome"] = "pending";
    let at = p.createdAt;
    const dec = declines.get(pid);
    const o = outcome.get(pid);
    const sched = scheduled.get(pid);
    if (dec?.length) out = "declined";
    else if (o) {
      const shows = Object.values(o.attendance).filter(a => a.showed).length;
      out = shows >= 2 ? "completed" : "no_show"; at = o.at;
    } else if (sched) {
      out = "accepted";
      if (sched.at > now) openOpportunities.push({ id: pid, participants: [...p.participants], stage: "scheduled", until: sched.at });
    } else if (now - p.createdAt > 3 * DAY) out = "expired";
    else openOpportunities.push({ id: pid, participants: [...p.participants], stage: "inviting", until: p.createdAt + 3 * DAY });
    interactions.push({
      id: pid, kind: p.kind, category: p.category ?? "social", participants: [...p.participants], at, outcome: out,
      ...(dec?.length ? { declinedBy: dec } : {}), ...(acceptedBy.length ? { acceptedBy } : {}), ...(noResponse.length ? { noResponse } : {}),
    });
  }
  for (const f of said) {
    const r = feedbackReading(f.text);
    if (!r || !props.has(f.pid)) continue;
    const others = (scheduled.get(f.pid)?.participants ?? props.get(f.pid)!.participants).filter(x => x !== f.from);
    for (const b of others) feedback.push({ id: `fb:${f.pid}:${f.from}:${b}`, from: f.from, about: b, opportunityId: f.pid, at: f.at, sentiment: r.sentiment, wouldMeetAgain: r.again });
  }
  return { interactions, feedback, openOpportunities, unsentProposalIds: [...skipped] };
}

/**
 * would_interact_again edges from what members answered to "Would you do this again?" after a plan
 * (a feedback_request with SimMeta.plan or that wording; the member's next message within 3 days, read
 * with plans.ts planAgainAnswer). A yes from a member who came gives an edge from them to each other
 * member who came (the plan's outcome record). The latest answer per member and plan wins; a no removes
 * the edges. Only what the Network sees: its own question, the member's reply and attendance.
 */
export function planAgainEdges(records: readonly RunRecord[], now: number): Edge[] {
  const asked = new Map<MemberId, { pid?: string; at: number }>();
  const lastOutcome = new Map<MemberId, string>();
  const showedBy = new Map<string, MemberId[]>();
  const answers = new Map<string, { member: MemberId; pid: string; yes: boolean; at: number }>();
  for (const r of records) {
    if (r.t > now) break;
    if (r.type === "outcome") {
      const shows = Object.entries(r.attendance).filter(([, a]) => a.showed).map(([id]) => id);
      showedBy.set(r.proposalId, shows);
      for (const id of Object.keys(r.attendance)) lastOutcome.set(id, r.proposalId);
    } else if (r.type === "message" && !r.msg.system) {
      const m = r.msg;
      const meta = (m.meta ?? {}) as { type?: string; proposalId?: string; plan?: { planId?: string } };
      if (m.direction === "outbound" && meta.type === "feedback_request" && (meta.plan || PLAN_AGAIN_RE.test(m.body))) {
        asked.set(m.memberId, { pid: meta.proposalId ?? meta.plan?.planId ?? lastOutcome.get(m.memberId), at: m.ts });
      } else if (m.direction === "inbound") {
        const q = asked.get(m.memberId);
        if (!q || m.ts - q.at > 3 * DAY) continue;
        const a = planAgainAnswer(m.body);
        if (a === "unclear") continue;
        asked.delete(m.memberId);
        if (q.pid) answers.set(`${m.memberId}|${q.pid}`, { member: m.memberId, pid: q.pid, yes: a === "yes", at: m.ts });
      }
    }
  }
  const edges: Edge[] = [];
  for (const a of answers.values()) {
    const shows = showedBy.get(a.pid) ?? [];
    if (!a.yes || !shows.includes(a.member)) continue;
    for (const to of shows) if (to !== a.member) edges.push({ from: a.member, to, type: "would_interact_again", strength: 0.8, explicit: true, createdAt: a.at });
  }
  return edges;
}

/** A member's reply to an invite, read the way the Network reads it (shared parser): a counter is a yes to meeting. */
function inviteAnswer(body: string): "yes" | "no" | undefined {
  const r = parseReply(body);
  if (r.answer === "no") return "no";
  return r.answer === "yes" || r.counter ? "yes" : undefined;
}

/**
 * Sentiment of a feedback answer, from the member's words. Undefined when the member did not go
 * (nothing to say about the others). Negatives are checked first ("not great" is not "great").
 */
export function feedbackReading(text: string): { sentiment: SimFeedback["sentiment"]; again: boolean } | undefined {
  const t = text.toLowerCase();
  if (/couldn'?t make it|didn'?t make it|had to bail|can'?t make it/.test(t)) return undefined;
  if (/never showed|didn'?t show|no[- ]show|not great|terrible|rude|creepy|bummer|didn'?t have much|awful|block/.test(t)) return { sentiment: "negative", again: false };
  if (/great|clicked|loved|amazing|nice|easy to talk|fun|again/.test(t)) return { sentiment: "positive", again: /again|clicked/.test(t) };
  return { sentiment: "neutral", again: false };
}
