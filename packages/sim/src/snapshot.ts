// Build a core WorldSnapshot from personas' PUBLIC side (what an ideal onboarding would
// capture). This is what an Engine receives; it never includes hidden truth, except that
// private disclosures are present as agent_private facets (that is realistic: members tell
// the agent things in confidence) so engines can be tested for privacy leaks.
import { DAY, type Edge, type Facet, type Intent, type Member, type Presence, type Proposal, type WorldSnapshot } from "@thenetwork/core";
import type { Persona } from "./persona.ts";
import { desireById, SKILLS } from "./taxonomy.ts";

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
  const cats = Array.from(new Set(["social", ...p.public.statedIntents.map(i => i.category)])) as Member["prefs"]["categoriesOptIn"];
  const romance = p.public.statedIntents.some(i => i.category === "romance") || (p.hidden.romance.optIn && p.hidden.adversarial !== "minor");
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
  };
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
      const def = desireById.get(it.desireId);
      intents.push({
        id: `${p.id}:i${i}`, memberId: p.id, objective: it.text, category: it.category,
        details: def ? `format: ${def.format}; tags: ${[...def.needsInterests, ...def.needsSkills, def.pool ?? ""].filter(Boolean).join(",")}` : undefined,
        horizonDays: 60, status: "active", createdAt: jt,
      });
    });
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
