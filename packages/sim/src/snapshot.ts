// Build a core WorldSnapshot from personas' PUBLIC side (what an ideal onboarding would
// capture). This is what an Engine receives; it never includes hidden truth, except that
// private disclosures are present as agent_private facets (that is realistic: members tell
// the agent things in confidence) so engines can be tested for privacy leaks.
import { DAY, type Edge, type Facet, type Intent, type Member, type Presence, type Proposal, type WorldSnapshot } from "@thenetwork/core";
import { intentHorizonDays, intentRecordTiming, type Persona } from "./persona.ts";
import { desireById, SKILLS } from "./taxonomy.ts";
import { VAGUE_INTENT, type Knowledge } from "./sources.ts";

export interface SnapshotState {
  now: number; worldStart: number;
  joined: Map<string, number>;          // memberId -> joinedAt
  optedOut: Set<string>;
  blocks: { from: string; to: string; at: number }[];
  unanswered: Map<string, number>;
  recentProposals: Proposal[];
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
function pushKnownFacets(p: Persona, k: Knowledge, jt: number, now: number, unresponsive: (id: string) => boolean, facets: Facet[], intents: Intent[]) {
  const minor = p.public.claimedAge < 18;
  const c = k.chat;
  const said = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], i: number): Facet =>
    ({ id: `${p.id}:f${facets.length}:${i}`, memberId: p.id, kind, value, tags, scope: minor ? "agent_private" : scope, provenance: "said", confidence: 0.8,
      validFrom: jt, source: "chat", observedAt: jt, inferred: false, confirmedByMember: true });
  c.interests.forEach((t, i) => facets.push(said("interest", t.replace(/_/g, " "), [t], "matchable", i)));
  c.skills.forEach((t, i) => {
    const sk = SKILLS.find(x => x.tag === t);
    facets.push(said("skill", sk?.label ?? t, [t, ...(sk?.teaches ? [sk.teaches] : [])], "matchable", i));
  });
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

export function buildSnapshot(personas: Persona[], s: SnapshotState): WorldSnapshot {
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
    if (k) pushKnownFacets(p, k, jt, s.now, id => (s.unanswered.get(id) ?? 0) >= 2, facets, intents);
    else {
      const f = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], i: number): Facet =>
        ({ id: `${p.id}:f${facets.length}:${i}`, memberId: p.id, kind, value, tags, scope, provenance: "said", confidence: 0.8, validFrom: jt });
      p.public.statedInterests.forEach((t, i) => facets.push(f("interest", t.replace(/_/g, " "), [t], "matchable", i)));
      p.public.statedSkills.forEach((t, i) => {
        const sk = SKILLS.find(x => x.tag === t);
        facets.push(f("skill", sk?.label ?? t, [t, ...(sk?.teaches ? [sk.teaches] : [])], "matchable", i));
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
  return { now: s.now, members, facets, intents, presence, edges, recentProposals: s.recentProposals.filter(p => p.createdAt >= since && p.createdAt <= s.now) };
}
