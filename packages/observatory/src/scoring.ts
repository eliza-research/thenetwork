// Game scoring and missions (docs/observatory.md section 4). One scoring function for every source,
// so the player, engine-v1 and the random baseline are compared on the same hidden ground truth.
import { DAY, type MemberId } from "@thenetwork/core";
import { isTerminal } from "./projector.ts";
import type { Mission, ObsOpportunity, ParticipantStatus, ScoreLine } from "./types.ts";

export const POINTS = { accept: 10, decline: -2, noShow: -15, unsafe: -150, meetingScale: 100, peek: -25 } as const;
const SAID_YES: ReadonlySet<ParticipantStatus> = new Set(["accepted", "countered", "confirmed", "attended", "no_show", "cancelled_with_notice"]);
const HELD = new Set(["COMPLETED", "FEEDBACK_COLLECTED"]);

export const isHeld = (o: ObsOpportunity) => HELD.has(o.state);
export function meanEnjoyment(o: ObsOpportunity): number {
  const v = Object.values(o.enjoyment);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

export interface OppScore { points: number; parts: { label: string; points: number }[] }

/** Points one opportunity earned so far. */
export function scoreOpportunity(o: ObsOpportunity): OppScore {
  const parts: OppScore["parts"] = [];
  const yes = o.participants.filter(id => SAID_YES.has(o.status[id]!)).length;
  const no = o.participants.filter(id => o.status[id] === "declined").length;
  const noShow = o.participants.filter(id => o.status[id] === "no_show").length;
  if (yes) parts.push({ label: `${yes} accepted`, points: yes * POINTS.accept });
  if (no) parts.push({ label: `${no} declined`, points: no * POINTS.decline });
  if (isHeld(o)) parts.push({ label: `met · ${(meanEnjoyment(o) * 100).toFixed(0)}% enjoyment`, points: Math.round(POINTS.meetingScale * meanEnjoyment(o)) });
  if (noShow) parts.push({ label: `${noShow} no-show`, points: noShow * POINTS.noShow });
  if (o.oracle?.unsafe) parts.push({ label: `unsafe (${o.oracle.flags.join(", ") || "policy"})`, points: POINTS.unsafe });
  return { points: parts.reduce((a, p) => a + p.points, 0), parts };
}

const LABELS: Record<string, string> = { player: "You", engine: "engine-v1", network: "Random baseline", scenario: "Scenario" };

export function scoreboard(opps: Iterable<ObsOpportunity>, extra: Record<string, number> = {}): ScoreLine[] {
  const by = new Map<string, ObsOpportunity[]>();
  for (const o of opps) {
    if (o.source === "shadow" || o.source === "scenario") continue;
    if (!by.has(o.source)) by.set(o.source, []);
    by.get(o.source)!.push(o);
  }
  if (!by.has("player")) by.set("player", []);
  return [...by.entries()].map(([source, list]) => {
    let points = extra[source] ?? 0, accepted = 0, declined = 0, meetings = 0, attended = 0, slots = 0, enj = 0, enjN = 0, compatible = 0, judged = 0, unsafe = 0;
    for (const o of list) {
      points += scoreOpportunity(o).points;
      for (const id of o.participants) {
        const st = o.status[id]!;
        if (SAID_YES.has(st)) accepted++;
        if (st === "declined") declined++;
        if (st === "attended" || st === "no_show" || st === "cancelled_with_notice") { slots++; if (st === "attended") attended++; }
      }
      if (isHeld(o)) { meetings++; enj += meanEnjoyment(o); enjN++; }
      if (o.oracle) { judged++; if (o.oracle.compatible) compatible++; if (o.oracle.unsafe) unsafe++; }
    }
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return {
      source, label: LABELS[source] ?? source, points, proposals: list.length, accepted, declined, meetings,
      showRate: r(slots ? attended / slots : 0), meanEnjoyment: r(enjN ? enj / enjN : 0), precision: r(judged ? compatible / judged : 0),
      unsafe, perProposal: r(list.length ? points / list.length : 0),
    };
  }).sort((a, b) => (a.source === "player" ? -1 : b.source === "player" ? 1 : b.points - a.points));
}

export interface MissionContext {
  now: number; start: number;
  community: (id: MemberId) => string | undefined;
  newcomer: (id: MemberId) => boolean;
  scores: ScoreLine[];
}

interface MissionDef { id: string; title: string; description: string; check(player: ObsOpportunity[], ctx: MissionContext): { done: boolean; progress: string } }

export const MISSIONS: MissionDef[] = [
  { id: "first_spark", title: "First spark", description: "Get one of your intros accepted.",
    check: p => { const n = p.filter(o => o.participants.some(id => SAID_YES.has(o.status[id]!))).length; return { done: n > 0, progress: `${n}/1` }; } },
  { id: "good_chemistry", title: "Good chemistry", description: "A meeting you arranged averages at least 70% enjoyment.",
    check: p => { const best = Math.max(0, ...p.filter(isHeld).map(meanEnjoyment)); return { done: best >= 0.7, progress: `best ${(best * 100).toFixed(0)}%` }; } },
  { id: "bridge_builder", title: "Bridge builder", description: "Bring together people from different communities, and they both enjoy it (60%+).",
    check: (p, ctx) => { const ok = p.some(o => isHeld(o) && new Set(Object.keys(o.enjoyment).map(ctx.community)).size >= 2 && Object.values(o.enjoyment).every(e => e >= 0.6)); return { done: ok, progress: ok ? "1/1" : "0/1" }; } },
  { id: "welcome_wagon", title: "Welcome wagon", description: "A newcomer (joined in the last 30 days) has a meeting you arranged.",
    check: (p, ctx) => { const ok = p.some(o => isHeld(o) && Object.keys(o.enjoyment).some(ctx.newcomer)); return { done: ok, progress: ok ? "1/1" : "0/1" }; } },
  { id: "dinner_party", title: "Dinner party", description: "A group of 3 or more you put together actually meets.",
    check: p => { const ok = p.some(o => isHeld(o) && Object.keys(o.enjoyment).length >= 3); return { done: ok, progress: ok ? "1/1" : "0/1" }; } },
  { id: "do_no_harm", title: "Do no harm", description: "Play 7 sim days and make at least 3 proposals with no unsafe ones.",
    check: (p, ctx) => { const days = Math.floor((ctx.now - ctx.start) / DAY); const bad = p.filter(o => o.oracle?.unsafe).length; return { done: days >= 7 && p.length >= 3 && bad === 0, progress: `day ${Math.min(days, 7)}/7 · ${p.length} proposals · ${bad} unsafe` }; } },
  { id: "beat_engine", title: "Beat the engine", description: "After 7 sim days, earn more points per proposal than engine-v1 (at least 5 proposals).",
    check: (p, ctx) => {
      const me = ctx.scores.find(s => s.source === "player"), eng = ctx.scores.find(s => s.source === "engine");
      const days = Math.floor((ctx.now - ctx.start) / DAY);
      const resolved = p.filter(o => isTerminal(o.state)).length;
      const ok = !!me && !!eng && days >= 7 && me.proposals >= 5 && me.perProposal > eng.perProposal;
      return { done: ok, progress: `${me?.perProposal ?? 0} vs ${eng?.perProposal ?? 0} pts/proposal · ${resolved} resolved` };
    } },
];

export function evaluateMissions(opps: Iterable<ObsOpportunity>, ctx: MissionContext, prev: Mission[] = []): Mission[] {
  const player = [...opps].filter(o => o.source === "player");
  return MISSIONS.map(m => {
    const before = prev.find(x => x.id === m.id);
    if (before?.done) return before; // missions stay done
    const r = m.check(player, ctx);
    return { id: m.id, title: m.title, description: m.description, done: r.done, progress: r.progress, doneAt: r.done ? ctx.now : undefined };
  });
}
