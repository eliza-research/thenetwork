// The slop.date AppPack in the slop world: a SlopMatcher that runs the REAL engine (runEngine with
// slopPack) on the agent-visible snapshot each week and maps its output onto the harness:
//   EngineProposal (participants [first, partner], in selection order) -> SlopProposal with the
//   pack's booked first-date plan (activity, public venue, 2-3 time options, market);
//   EngineAsk (reason slop_*) -> SlopAsk (the member answers or not; visible next week).
// Exposure debt is carried between weeks (runLog.exposureDebt -> input.exposureDebt), and the
// asks the agent already sent are fed back as input.recentAsks (cooldowns, "answered").
// It reads ONLY ctx.snapshot (no hidden truth). This is also the wiring the platform needs for
// slop:<market>: snapshot fields -> EngineInput, asks out, the plan for the booked reveal.
import type { MemberId } from "@thenetwork/core";
import { runEngine } from "@thenetwork/engine/src/engine.ts";
import type { EngineConfigInput } from "@thenetwork/engine/src/config.ts";
import type { AppPack } from "@thenetwork/engine/src/pack.ts";
import { makeSlopPack, planFromInput, SLOP_ENGINE_CONFIG, slopProfiles, type SlopPackOptions } from "@thenetwork/engine/src/packs/slop/index.ts";
import type { DeepPartial } from "@thenetwork/engine/src/packs/slop/options.ts";
import type { AskRecord, EngineInput } from "@thenetwork/engine/src/types.ts";
import { hash32 } from "@thenetwork/core";
import type { SlopCity } from "./geo.ts";
import type { DateActivity } from "./persona.ts";
import type { SlopAskField, SlopSnapshot } from "./snapshot.ts";
import type { MatcherContext, SlopAsk, SlopMatcher, SlopProposal } from "./world.ts";

export interface SlopEngineMatcherOptions {
  name?: string;
  /** Pack options (ablations); ignored when `pack` is given. */
  options?: DeepPartial<SlopPackOptions>;
  pack?: AppPack & { options: SlopPackOptions };
  /** Engine config overrides on top of SLOP_ENGINE_CONFIG. */
  cfg?: EngineConfigInput;
  seed?: number;
  /** Diagnostics: the engine's funnel per week. */
  onRun?: (week: number, r: Awaited<ReturnType<typeof runEngine>>) => void;
}

const FIELD: Record<string, SlopAskField> = { slop_orientation: "orientation", slop_age_range: "age_range", slop_distance: "distance", slop_basics: "basics", slop_type: "type", slop_widen: "widen" };
const REASON: Record<SlopAskField, string> = { orientation: "slop_orientation", age_range: "slop_age_range", distance: "slop_distance", basics: "slop_basics", type: "slop_type", widen: "slop_widen" };

/** The engine input for a slop snapshot (what the platform builds from Postgres for slop:<market>). */
export function slopEngineInput(s: SlopSnapshot, exposureDebt: Record<MemberId, number> = {}): EngineInput {
  const recentAsks: AskRecord[] = s.asks.map(a => ({ memberId: a.memberId, at: a.at, reason: REASON[a.field], ...(a.answeredAt !== undefined ? { answeredAt: a.answeredAt } : {}) }));
  return {
    now: s.now, members: s.members, facets: s.facets, intents: s.intents, presence: s.presence, edges: s.edges, recentProposals: s.recentProposals,
    interactions: s.interactions, feedback: s.feedback, safetyHolds: s.safetyHolds, recentAsks, exposureDebt,
  };
}

export function slopEngineMatcher(o: SlopEngineMatcherOptions = {}): SlopMatcher {
  const pack = o.pack ?? makeSlopPack(o.options ?? {});
  let debt: Record<MemberId, number> = {};
  return {
    name: o.name ?? "slop-pack",
    async propose(ctx: MatcherContext) {
      const input = slopEngineInput(ctx.snapshot, debt);
      const cfg: EngineConfigInput = { ...SLOP_ENGINE_CONFIG, ...(o.cfg ?? {}), seed: hash32(o.seed ?? 0, "slop-engine", ctx.week) };
      const r = await runEngine(input, cfg, { pack });
      o.onRun?.(ctx.week, r);
      debt = r.runLog.exposureDebt;
      const markets = (cfg.cities ?? ["sf", "nyc", "la"]) as SlopCity[];
      const P = slopProfiles(input);
      const proposals: SlopProposal[] = [];
      for (const p of r.proposals) {
        const [first, partner] = p.participants as [MemberId, MemberId];
        const plan = planFromInput(input, first, partner, markets, pack.options);
        if (!plan) continue;
        // The probe's one shareable fact: an interest of the other person they chose to share, one the recipient has if possible.
        const pf = P.get(first), pp = P.get(partner);
        const fact = pp?.shareableInterests.find(t => pf?.interests.includes(t)) ?? pp?.shareableInterests[0];
        proposals.push({ first, partner, city: plan.market as SlopCity, activity: plan.activity as DateActivity, options: plan.options, ...(fact ? { sharedFact: fact } : {}) });
      }
      const asks: SlopAsk[] = r.asks.filter(a => FIELD[a.reason]).map(a => ({ memberId: a.memberId, field: FIELD[a.reason]! }));
      return { proposals, asks };
    },
  };
}
