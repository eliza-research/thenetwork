// runEngine: the v1 matching and opportunity pipeline (Sections 14.1, 33). Pure function of
// (snapshot, config, deps): no clock reads, no Math.random, deterministic ordering; the run log
// carries everything needed to replay it (ME-004). Nothing is emitted unless the whole run
// completes (ME-010: no partial proposals).
import type { LLM, MemberId, WorldSnapshot } from "@thenetwork/core";
import { configHash, ENGINE_VERSION, resolveConfig, type EngineConfig, type EngineConfigInput } from "./config.ts";
import { localEmbed, type EmbedFn } from "./embed.ts";
import { explain, privateVocabulary } from "./explain.ts";
import { candidateAgeReason, involvedMembers, isMinor, memberReason, publicEventPreferencesAllow, screenCandidate } from "./filters.ts";
import type { GenCtx } from "./genkit.ts";
import { JudgeCache, judgeCandidates, runCachedPass } from "./judge.ts";
import { checkMemberFacing, redactPrivate } from "./judgeCommon.ts";
import { gateMemberFacing, hardGate, prepareDeepReview, type DeepVerdict } from "./judgeDeep.ts";
import { prepareScreen, screenDecision, screenSnapshot, type ScreenVerdict } from "./judgeScreen.ts";
import { emptyIntentWaitOver } from "../../core/src/generated/emptyIntentFollowup.ts";
import { initial as initialJudgmentRun, step as stepJudgmentRun } from "../../core/src/generated/judgmentRun.ts";
import { standingIntentCandidateInScope } from "../../core/src/generated/standingIntent.ts";
import { listedEventMinimumAge } from "../../core/src/public-event-age.ts";
import { blockingPairs, fairnessMetrics, planAsks, selectProposals, updateExposureDebt } from "./policy.ts";
import { EngineRng as Rng } from "@thenetwork/core";
import { sha256 } from "./hash.ts";
import { scoreCandidate, type Scored } from "./scoring.ts";
import type { Candidate, EngineAsk, EngineInput, EngineProposal, JudgeVerdict, MatchingRunLog, MemberStandingRow, Role } from "./types.ts";
import type { AppPack } from "./pack.ts";
import { networkPack } from "./packs/network/index.ts";
import { World } from "./world.ts";

export interface EngineDeps {
  llm?: LLM;
  embed?: EmbedFn;
  /** Judge verdict cache shared across runs (ME-008). A fresh one is used if omitted. */
  judgeCache?: JudgeCache;
  /** Pass-1 (screen) and pass-3 (deep review) verdict caches, same expiry rules. */
  screenCache?: JudgeCache<ScreenVerdict>;
  deepCache?: JudgeCache<{ verdict: DeepVerdict; refs: Record<MemberId, string> }>;
  /** Identifier of the embedding model for the run log (ME-004). */
  embedModel?: string;
  judgeModel?: string;
  /**
   * The app pack (default networkPack). Identity travels here, beside the config, never inside it:
   * the config hash, run id and run log are unchanged for networkPack (byte-identity rules 1-2).
   */
  pack?: AppPack;
}

/**
 * `asks` (v1.2, config.ask / config.romance.requireStatedPrefs): questions to send instead of, or
 * before, proposals. Empty when both flags are off.
 */
export interface EngineResult {
  proposals: EngineProposal[];
  asks: EngineAsk[];
  runLog: MatchingRunLog;
  /** Private standing inserts and updates. The caller persists them separately from matching logs. */
  memberStanding?: readonly MemberStandingRow[];
}

function stableStringifyWithoutEmbedding(v: unknown): string {
  if (v === null || v === undefined) return "null";
  const t = typeof v;
  if (t === "number") return Number.isFinite(v as number) ? JSON.stringify(v) : "null";
  if (t === "boolean" || t === "string") return JSON.stringify(v);
  if (t !== "object") return "null";
  if (Array.isArray(v)) {
    const parts = new Array<string>(v.length);
    for (let i = 0; i < v.length; i++) {
      const el = v[i];
      parts[i] = el === undefined || typeof el === "function" || typeof el === "symbol"
        ? "null"
        : stableStringifyWithoutEmbedding(el);
    }
    return `[${parts.join(",")}]`;
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  const entries: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (k === "embedding") continue;
    const val = o[k];
    if (val === undefined || typeof val === "function" || typeof val === "symbol") continue;
    entries.push(`${JSON.stringify(k)}:${stableStringifyWithoutEmbedding(val)}`);
  }
  return `{${entries.join(",")}}`;
}

function hashInput({ memberStanding: _privateStanding, ...input }: EngineInput): string {
  return sha256(stableStringifyWithoutEmbedding(input)).slice(0, 16);
}

export function canonicalInput(input: EngineInput): EngineInput {
  const keyOf = (x: unknown): string => {
    const id = (x as { id?: unknown }).id;
    return typeof id === "string" ? `0|${id}` : `1|${stableStringifyWithoutEmbedding(x)}`;
  };
  const out: Record<string, unknown> = { ...input };
  for (const [k, v] of Object.entries(input)) {
    if (!Array.isArray(v)) continue;
    const keyed = v.map(x => ({ x, k: typeof x === "string" ? x : keyOf(x) }));
    keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    out[k] = keyed.map(e => e.x);
  }
  return out as unknown as EngineInput;
}

function resolvePostSelection(raw: EngineConfig["judge"]["postSelection"]): {
  enabled: boolean; minConfidence: number; maxConfidence: number; backups: number;
} {
  if (!raw) return { enabled: false, minConfidence: 0.35, maxConfidence: 0.72, backups: 1 };
  if (raw === true) return { enabled: true, minConfidence: 0.35, maxConfidence: 0.72, backups: 1 };
  return {
    enabled: raw.enabled ?? true,
    minConfidence: raw.minConfidence ?? 0.35,
    maxConfidence: raw.maxConfidence ?? 0.72,
    backups: raw.backups ?? 1,
  };
}

async function runJudgmentPasses(
  w: World,
  cfg: EngineConfig,
  deps: EngineDeps,
  llm: LLM,
  scored: Scored[],
  targetKeys: ReadonlySet<string> | null,
  runLog: MatchingRunLog,
  lap: (name: string, since: number) => number,
  tStart: number,
): Promise<{ scored: Scored[]; t: number }> {
  let t = tStart;
  const J = w.pack.judge!;
  const screen = J.screen;
  let judgment = stepJudgmentRun(initialJudgmentRun, {
    type: "configureRun",
    rubricOption: { enabled: cfg.judge.enabled, limit: cfg.judge.topK, supported: Boolean(llm && J) },
    screenOption: { enabled: targetKeys === null && cfg.judge.screen.enabled, limit: cfg.judge.screen.topK, supported: Boolean(screen) },
  });
  if (judgment.phase === "Complete") return { scored, t };

  let nextScored = scored;
  const byScore = (xs: Scored[]) => [...xs].sort((a, b) => (b.score - a.score) || (a.c.key < b.c.key ? -1 : 1));
  const pickTop = (xs: Scored[], k: number, gk: number) => {
    const filtered = targetKeys !== null ? xs.filter(s => targetKeys.has(s.c.key)) : xs;
    return [
      ...filtered.filter(s => s.c.participants.length <= 2).slice(0, k),
      ...filtered.filter(s => s.c.participants.length > 2).slice(0, gk),
    ];
  };

  let pool = byScore(nextScored.filter(s => s.eligible && (J.reviewCandidate?.(s.c) ?? true)));
  if (judgment.phase === "Screening" && screen) {
    const sc = cfg.judge.screen;
    const toScreen = pickTop(pool, sc.topK, sc.groupTopK).map(s => s.c);
    const screenStats = { calls: 0, cacheHits: 0, failures: 0 };
    const screenLog: { key: string; cacheKey: string; verdict: ScreenVerdict | null; cached: boolean }[] = [];
    const snap = screenSnapshot(w);
    const res = await runCachedPass(w, toScreen, llm, deps.screenCache ?? new JudgeCache<ScreenVerdict>(cfg.judge.ttlMs),
      screenStats, c => prepareScreen(w, c, sc.maxTokens, snap), screenLog, runLog.judgeModel);
    runLog.judge.screen = { ...screenStats, verdicts: screenLog };
    const rejected = new Set([...res].filter(([, v]) => v && !screenDecision(v)).map(([k]) => k));
    nextScored = nextScored.map(s => (rejected.has(s.c.key) ? { ...s, eligible: false, reason: "screen_reject" } : s));
    pool = pool.filter(s => res.has(s.c.key) && !rejected.has(s.c.key));
    t = lap("judge_screen", t);
    judgment = stepJudgmentRun(judgment, { type: "finishScreen" });
  }
  if (judgment.phase === "Rubric") {
    const toJudge = pickTop(pool, cfg.judge.topK, cfg.judge.groupTopK).map(s => s.c);
    const verdicts = await judgeCandidates(w, toJudge, llm, deps.judgeCache ?? new JudgeCache(cfg.judge.ttlMs), runLog.judge, runLog.judge.verdicts, runLog.judgeModel);
    nextScored = nextScored.map(s => {
      const v = verdicts.get(s.c.key);
      if (!v) return s;
      const r = scoreCandidate(w, s.c, v);
      const judged = r.score > s.score ? { ...s, verdict: v, eligible: r.eligible, reason: r.reason } : r;
      return s.eligible ? judged : { ...judged, eligible: false, reason: s.reason ?? "below_threshold" };
    });
    t = lap("judge", t);
    judgment = stepJudgmentRun(judgment, {
      type: "finishRubric",
      deepOption: { enabled: cfg.judge.deep.enabled, limit: cfg.judge.deep.topK, supported: Boolean(J.deep) },
    });
  }
  if (judgment.phase === "DeepReview" && J.deep) {
    const dc = cfg.judge.deep;
    const deepPool = byScore(nextScored.filter(s => s.eligible && s.verdict && s.verdict.verdict !== "no"));
    const survivors = (targetKeys !== null ? deepPool.filter(s => targetKeys.has(s.c.key)) : deepPool).slice(0, dc.topK);
    const deepLog: { key: string; cacheKey: string; verdict: { verdict: DeepVerdict; refs: Record<MemberId, string> } | null; cached: boolean }[] = [];
    const stats = { calls: 0, cacheHits: 0, failures: 0 };
    const res = await runCachedPass(w, survivors.map(s => s.c), llm, deps.deepCache ?? new JudgeCache<{ verdict: DeepVerdict; refs: Record<MemberId, string> }>(cfg.judge.ttlMs),
      stats, c => prepareDeepReview(w, c, dc.maxTokens), deepLog, runLog.judgeModel);
    runLog.judge.deep = { ...stats, verdicts: [] };
    nextScored = nextScored.map(s => {
      const r = res.get(s.c.key);
      if (!r) return s;
      const v = r.verdict;
      const gate = hardGate(w, s.c);
      const gated = gateMemberFacing(w, s.c, v, r.refs);
      runLog.judge.deep!.verdicts.push({
        key: s.c.key, verdict: v.verdict, matchProbability: v.matchProbability, rubric: { ...v.rubric },
        reasoning: redactPrivate(v.reasoning).slice(0, 600), hardGate: gate ?? undefined,
        question: v.question && gateQuestion(w, s.c, v.question.question) ? { memberId: r.refs[v.question.ref], question: v.question.question } : undefined,
        memberFacingRejected: gated.rejected.length,
      });
      if (gate) return { ...s, eligible: false, reason: `hard_gate:${gate}` };
      if (v.verdict === "no") return { ...s, eligible: false, reason: "deep_reject" };
      if (v.verdict === "insufficient_information") return { ...s, eligible: false, reason: "deep_insufficient" };
      return { ...s, memberWhy: gated.why };
    });
    runLog.judge.deep.verdicts.sort((a, b) => (a.key < b.key ? -1 : 1));
    t = lap("judge_deep", t);
    judgment = stepJudgmentRun(judgment, { type: "finishDeepReview" });
  }
  return { scored: nextScored, t };
}

export async function runEngine(snapshot: WorldSnapshot | EngineInput, cfgIn: EngineConfigInput = {}, deps: EngineDeps = {}): Promise<EngineResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (name: string, since: number) => { timings[name] = Math.round((performance.now() - since) * 100) / 100; return performance.now(); };
  const input = canonicalInput(snapshot as EngineInput);
  const cfg = resolveConfig(cfgIn);
  const rng = new Rng(cfg.seed);
  const embed = deps.embed ?? localEmbed;
  const pack = deps.pack ?? networkPack;
  const w = new World(input, cfg, embed, pack);
  let t = lap("index", t0);
  const inputHash = hashInput(input);
  const configFingerprint = configHash(cfg);

  const runLog: MatchingRunLog = {
    runId: sha256(`${inputHash}|${configFingerprint}|${cfg.seed}`).slice(0, 16),
    seed: cfg.seed, configHash: configFingerprint, inputHash, now: w.now,
    engineVersion: ENGINE_VERSION, embedModel: deps.embedModel ?? (deps.embed ? "custom" : "local-hash-v1"),
    judgeModel: deps.llm && cfg.judge.enabled ? (deps.judgeModel ?? process.env.RECOMMENDER_MODEL ?? process.env.DEFAULT_LLM_MODEL ?? "gpt-6-luna") : undefined,
    funnel: {
      generated: 0, byGenerator: {}, memberFunnel: {}, memberExclusions: {}, rejectedBy: {}, passedHardFilters: 0, deduped: 0,
      floorViolations: {}, dealbreakers: 0, belowThreshold: 0, eligible: 0, budgetSkips: 0, selected: 0, exploration: 0,
    },
    scored: [], judge: { calls: 0, cacheHits: 0, failures: 0, verdicts: [] }, proposalsByGenerator: {},
    fairness: undefined as any, emptyStates: [], timingsMs: timings, blockingPairs: 0, exposureDebt: {},
  };
  const f = runLog.funnel;

  // 0. Member funnel (one generic check per member, for the run report).
  f.memberFunnel.total = w.ids.length;
  for (const id of w.ids) {
    const r = memberReason(w, id, { category: pack.ontology.funnelProbe.lane, role: pack.ontology.funnelProbe.role, format: "one_to_one", timeSensitive: false });
    const k = r ?? "available";
    f.memberFunnel[k] = (f.memberFunnel[k] ?? 0) + 1;
  }

  // 1. Generators (retrieval + member-level hard filters inside).
  const ctx: GenCtx = { w, memberExclusions: f.memberExclusions, rng: rng.fork("gen"), unmatchedIntents: new Set() };
  const cands: Candidate[] = [];
  // The pack's generators, in the pack's order. A generator the config switches off is skipped
  // (networkPack: the GENERATOR_NAMES flags; a name the config does not know runs).
  const gate = cfg.generators as Record<string, boolean | undefined>;
  const intentScope = input.standingIntentSearch && new Set(input.standingIntentSearch);
  const publishedEvents = new Map(w.events.filter(event => event.listing).map(event => [event.id, listedEventMinimumAge(event)]));
  for (const g of pack.generators) {
    if (g.name in gate && !gate[g.name]) continue;
    const ts = performance.now();
    const proposed = g.run(ctx);
    const generated = publishedEvents.size ? proposed.filter(c => {
      const minimumAge = c.anchor?.type === "event" ? publishedEvents.get(c.anchor.id) : undefined;
      return minimumAge === undefined || c.participants.every(id => publicEventPreferencesAllow(w.get(id)?.m, c.category, minimumAge));
    }) : proposed;
    const got = intentScope ? generated.filter(c => standingIntentCandidateInScope(true,
      c.anchor?.type === "intent" && intentScope.has(c.anchor.id),
      c.anchor?.type === "event" && c.participants.some(id =>
        w.get(id)?.intents.some(intent => intentScope.has(intent.id) && intent.category === c.category)),
    )) : generated;
    f.byGenerator[g.name] = got.length;
    cands.push(...got);
    timings[`gen:${g.name}`] = Math.round((performance.now() - ts) * 100) / 100;
  }
  f.generated = cands.length;
  t = lap("generate", t);

  // 2. Full hard-filter check on every configuration (defense in depth; resolves city/window).
  const anchorReasons = new Map<string, Map<string, number>>();
  const passed: Candidate[] = [];
  for (const c of cands) {
    const alternateRole: Role | undefined = c.format === "small_group" ? "guest" : c.format === "one_to_one" ? "peer" : undefined;
    if (alternateRole && involvedMembers(c).some(id => isMinor(w, id))) {
      c.roles = { ...Object.fromEntries(c.alternates.filter(id => c.roles[id] === undefined).map(id => [id, alternateRole])), ...c.roles };
    }
    const screening = screenCandidate(w, c);
    if (screening.phase === "Refused") {
      const r = screening.refusal;
      f.rejectedBy[r] = (f.rejectedBy[r] ?? 0) + 1;
      if (c.anchor?.type === "intent") {
        if (!anchorReasons.has(c.anchor.id)) anchorReasons.set(c.anchor.id, new Map());
        const m = anchorReasons.get(c.anchor.id)!;
        m.set(r, (m.get(r) ?? 0) + 1);
      }
      continue;
    }
    if (!pack.geo.markets(cfg).includes(c.city!)) { f.rejectedBy.city_not_in_run = (f.rejectedBy.city_not_in_run ?? 0) + 1; continue; }
    c.alternates = screening.alternates;
    if (candidateAgeReason(w, c) !== null) { f.rejectedBy.underage = (f.rejectedBy.underage ?? 0) + 1; continue; }
    passed.push(c);
  }
  f.passedHardFilters = passed.length;
  t = lap("filter", t);

  // 3. Score; dedupe by participant set (prefer eligible, then keep best).
  let scored: Scored[] = passed.map(c => scoreCandidate(w, c));
  const bySet = new Map<string, Scored>();
  for (const s of scored) {
    const k = [...s.c.participants].sort().join(",");
    const cur = bySet.get(k);
    if (!cur || (s.eligible && !cur.eligible)
      || (s.eligible === cur.eligible && (s.score > cur.score || (s.score === cur.score && s.c.key < cur.c.key)))) bySet.set(k, s);
  }
  f.deduped = scored.length - bySet.size;
  scored = [...bySet.values()].sort((a, b) => (a.c.key < b.c.key ? -1 : 1));
  t = lap("score", t);

  const J = pack.judge;
  const llm = deps.llm;
  const postSel = resolvePostSelection(cfg.judge.postSelection);
  if (!postSel.enabled && llm && J) {
    const res = await runJudgmentPasses(w, cfg, deps, llm, scored, null, runLog, lap, t);
    scored = res.scored;
    t = res.t;
  }

  const priorDebt: Record<MemberId, number> = {};
  for (const [k, v] of Object.entries(input.exposureDebt ?? {})) priorDebt[w.canonical(k)] = (priorDebt[w.canonical(k)] ?? 0) + v;
  const askPlan = planAsks(w, input);
  f.asks = askPlan.asks.length;
  f.askFirst = askPlan.exclude.size;
  const selectionOptions = { exclude: askPlan.exclude, extraProactive: askPlan.extraProactive };

  let selection: ReturnType<typeof selectProposals>;
  let selected: ReturnType<typeof selectProposals>["selected"];
  let afterSelRejected = 0;

  if (!postSel.enabled) {
    selection = selectProposals(w, scored, rng.fork("select"), priorDebt, selectionOptions);
    selected = selection.selected.filter(x => candidateAgeReason(w, x.s.c) === null);
    afterSelRejected = selection.selected.length - selected.length;
  } else {
    const selectRng = rng.fork("select");
    selection = selectProposals(w, scored, selectRng.fork("pass1"), priorDebt, selectionOptions);
    selected = selection.selected.filter(x => candidateAgeReason(w, x.s.c) === null);
    afterSelRejected = selection.selected.length - selected.length;

    if (llm && J && cfg.judge.enabled && cfg.judge.topK > 0 && selected.length > 0) {
      const selectedKeys = new Set(selected.map(sel => sel.s.c.key));
      const targetKeys = new Set<string>();
      const calibratedConf = (s: Scored): number => {
        const marginProb = Math.max(0, Math.min(1, 0.5 + 1.8 * (s.score - s.threshold)));
        return 0.4 * s.components.confidence + 0.6 * marginProb;
      };
      const needsEscalation = (s: Scored): boolean => {
        if (s.c.safetyClass === "medium" || s.c.exploration) return true;
        const conf = calibratedConf(s);
        return conf >= postSel.minConfidence && conf <= postSel.maxConfidence;
      };
      const backupsByMember = new Map<MemberId, Scored[]>();
      const maxPerMemberBackups = Math.max(1, postSel.backups * 2);
      for (const s of [...scored].sort((a, b) => (b.score - a.score) || (a.c.key < b.c.key ? -1 : 1))) {
        if (!s.eligible || selectedKeys.has(s.c.key)) continue;
        for (const p of s.c.participants) {
          let list = backupsByMember.get(p);
          if (!list) { list = []; backupsByMember.set(p, list); }
          if (list.length < maxPerMemberBackups) list.push(s);
        }
      }
      for (const sel of selected) {
        if (!needsEscalation(sel.s)) continue;
        targetKeys.add(sel.s.c.key);
        if (postSel.backups > 0) {
          let added = 0;
          for (const participant of sel.s.c.participants) {
            if (added >= postSel.backups) break;
            const alts = backupsByMember.get(participant) ?? [];
            for (const b of alts) {
              if (added >= postSel.backups) break;
              if (!targetKeys.has(b.c.key)) {
                targetKeys.add(b.c.key);
                added++;
              }
            }
          }
        }
      }
      if (targetKeys.size > 0) {
        t = lap("select", t);
        const res = await runJudgmentPasses(w, cfg, deps, llm, scored, targetKeys, runLog, lap, t);
        scored = res.scored;
        t = res.t;
        selection = selectProposals(w, scored, selectRng.fork("pass2"), priorDebt, { ...selectionOptions, reuseEquilibrium: true });
        selected = selection.selected.filter(x => candidateAgeReason(w, x.s.c) === null);
        afterSelRejected = selection.selected.length - selected.length;
      }
    }
  }

  for (const s of scored) {
    if (s.reason === "below_threshold") f.belowThreshold++;
    else if (s.reason === "dealbreaker") f.dealbreakers++;
    else if (s.reason) f.floorViolations[s.reason] = (f.floorViolations[s.reason] ?? 0) + 1;
    if (s.eligible) f.eligible++;
  }

  if (afterSelRejected > 0) f.rejectedAfterSelection = { underage: afterSelRejected };
  const budgetSkips = selection.budgetSkips;
  f.budgetSkips = budgetSkips;
  f.selected = selected.length;
  f.exploration = selected.filter(s => s.exploration).length;
  if (runLog.judge.calls + runLog.judge.cacheHits + runLog.judge.failures > 0) {
    runLog.judge.coverage = { selected: selected.length, judged: selected.filter(s => !!s.s.verdict).length };
  }
  const search = w.match.tally();
  if (search.members > 0) {
    runLog.search = search;
    runLog.searchOutcomes = w.match.searchOutcomes();
  }
  t = lap(postSel.enabled && runLog.judge.calls + runLog.judge.cacheHits + runLog.judge.failures > 0 ? "reselect" : "select", t);

  // 6. Proposals with shareable-only explanations.
  const proposals: EngineProposal[] = selected.map(sel => {
    const { c, components, score, threshold, verdict } = sel.s;
    // Member-facing text never comes from a pass-2 "no" verdict (its "why" argues for a match the judge rejected).
    const v = verdict as JudgeVerdict | null | undefined;
    const { explanations, objective } = explain(w, c, v?.verdict === "no" ? null : v, sel.s.memberWhy);
    const sameDay = c.window ? c.window.start - w.now < 24 * 3_600_000 : false;
    return {
      id: `p_${sha256(`${c.key}|${w.now}`).slice(0, 16)}`,
      kind: c.kind, participants: [...c.participants], alternates: [...c.alternates], objective,
      city: c.city!, window: c.window ? { ...c.window } : undefined, score: round(score), components: roundAll(components),
      exploration: sel.exploration || c.exploration, explanations, generator: c.generator, createdAt: w.now,
      category: c.category, roles: { ...c.roles }, expiresAt: w.now + (sameDay ? cfg.sameDayInviteTtlMs : cfg.inviteTtlMs),
      anchor: c.anchor ? { ...c.anchor } : undefined, via: c.via, safetyClass: c.safetyClass, threshold,
      channels: [...c.channels].sort(), judged: !!verdict, selectorRank: sel.rank, selectionProbability: round(sel.probability),
      acceptance: Object.fromEntries(c.participants.map(id => [id, round(w.get(id)?.acceptance ?? cfg.acceptance.prior)])),
      ...(c.lane ? { lane: c.lane } : {}), ...(c.entities ? { entities: { ...c.entities } } : {}),
      ...(c.cofounderIntents ? { cofounderIntents: { ...c.cofounderIntents } } : {}),
      ...(involvedMembers(c).some(id => isMinor(w, id)) ? { format: c.format } : {}),
    };
  });
  for (const p of proposals) runLog.proposalsByGenerator[p.generator] = (runLog.proposalsByGenerator[p.generator] ?? 0) + 1;

  // 7. Logs: components for every scored configuration, fairness, empty states, debt.
  runLog.scored = scored.map(s => ({
    key: s.c.key, generator: s.c.generator, participants: s.c.participants, components: roundAll(s.components),
    score: round(s.score), eligible: s.eligible, reason: s.reason, judged: !!s.verdict,
  }));
  runLog.fairness = fairnessMetrics(w, selected, scored);
  runLog.blockingPairs = blockingPairs(w, selected, scored, selectionOptions);
  runLog.exposureDebt = updateExposureDebt(w, priorDebt, scored, selected);
  const inProposal = new Set(proposals.flatMap(p => p.participants));
  const eligibleByIntent = new Map<string, boolean>();
  for (const s of scored) if (s.c.anchor?.type === "intent") eligibleByIntent.set(s.c.anchor.id, (eligibleByIntent.get(s.c.anchor.id) ?? false) || s.eligible);
  for (const id of w.ids) for (const it of w.get(id)!.intents) {
    if (!emptyIntentWaitOver(w.now - it.createdAt, cfg.emptyStateDays) || inProposal.has(id)) continue;
    let reason = "no_candidates";
    const own = memberReason(w, id, { category: it.category, role: "seeker", format: "one_to_one", timeSensitive: false, ownIntentCreatedAt: it.createdAt });
    if (own) continue; // the owner is not currently matchable (paused, held, over budget...): not an empty state
    if (ctx.unmatchedIntents.has(it.id)) reason = "density_gap";
    else if (eligibleByIntent.get(it.id)) reason = "budget_or_selection";
    else if (eligibleByIntent.has(it.id)) reason = "below_threshold";
    else if (anchorReasons.has(it.id)) reason = `filtered:${[...anchorReasons.get(it.id)!.entries()].sort((a, b) => b[1] - a[1])[0]![0]}`;
    runLog.emptyStates.push({ intentId: it.id, memberId: id, reason });
  }
  lap("finalize", t);
  timings.total = Math.round((performance.now() - t0) * 100) / 100;
  const memberStanding = input.memberStanding === undefined ? undefined : w.match.memberStanding;
  return { proposals, asks: askPlan.asks, runLog, ...(memberStanding === undefined ? {} : { memberStanding }) };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
function roundAll<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v as number)])) as T;
}

export interface CitySupplyDemandSignal {
  readonly city: string;
  readonly activeAdults: number;
  readonly openIntents: number;
  readonly eligibleCandidates: number;
  readonly selectedProposals: number;
  readonly unmatchedIntents: number;
  readonly fillRate: number;
  readonly densityTier: "sparse" | "growing" | "dense";
}

export function computeCitySupplyDemand(
  w: World,
  scored: readonly Scored[],
  selected: readonly { s: Scored }[],
  unmatchedIntents: ReadonlySet<string> = new Set(),
): CitySupplyDemandSignal[] {
  const activeAdults = new Map<string, number>();
  const openIntents = new Map<string, number>();
  const unmatchedByCity = new Map<string, number>();
  const eligibleByCity = new Map<string, number>();
  const selectedByCity = new Map<string, number>();
  const cities = new Set<string>(w.pack.geo.markets(w.cfg));

  for (const id of w.ids) {
    if (w.minors.has(id) || w.holds.has(id)) continue;
    const mi = w.get(id);
    if (!mi || mi.m.state === "paused") continue;
    const city = mi.m.homeCity;
    cities.add(city);
    activeAdults.set(city, (activeAdults.get(city) ?? 0) + 1);
    for (const it of mi.intents) {
      openIntents.set(city, (openIntents.get(city) ?? 0) + 1);
      if (unmatchedIntents.has(it.id)) {
        unmatchedByCity.set(city, (unmatchedByCity.get(city) ?? 0) + 1);
      }
    }
  }
  for (const s of scored) {
    if (!s.eligible) continue;
    const city = s.c.city ?? (s.c.participants[0] ? w.get(s.c.participants[0]!)?.m.homeCity : undefined);
    if (!city) continue;
    cities.add(city);
    eligibleByCity.set(city, (eligibleByCity.get(city) ?? 0) + 1);
  }
  for (const sel of selected) {
    const city = sel.s.c.city ?? (sel.s.c.participants[0] ? w.get(sel.s.c.participants[0]!)?.m.homeCity : undefined);
    if (!city) continue;
    cities.add(city);
    selectedByCity.set(city, (selectedByCity.get(city) ?? 0) + 1);
  }

  return [...cities].sort().map(city => {
    const adults = activeAdults.get(city) ?? 0;
    const intents = openIntents.get(city) ?? 0;
    const eligible = eligibleByCity.get(city) ?? 0;
    const picked = selectedByCity.get(city) ?? 0;
    const unmatched = unmatchedByCity.get(city) ?? 0;
    const denom = intents > 0 ? intents : Math.max(1, adults);
    const fillRate = round(Math.min(1, picked / denom));
    const densityTier: CitySupplyDemandSignal["densityTier"] =
      adults < 80 ? "sparse" : adults < 400 ? "growing" : "dense";
    return {
      city,
      activeAdults: adults,
      openIntents: intents,
      eligibleCandidates: eligible,
      selectedProposals: picked,
      unmatchedIntents: unmatched,
      fillRate,
      densityTier,
    };
  });
}

function gateQuestion(w: World, c: Candidate, q: string): boolean {
  return checkMemberFacing(q, privateVocabulary(w, [...c.participants, ...(c.via ? [c.via] : [])])).ok;
}
