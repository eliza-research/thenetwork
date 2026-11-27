// Standalone multi-channel user journey evaluation runner (offline default or --live with defaultLLM/judgeLLM).
// Examples:
//   pnpm run journey-eval -- --offline --json /tmp/journeys-offline-check.json
//   pnpm run journey-eval -- --live --budget-usd 1.00 --max-requests 80 --cache runs/journeys-llm-cache.jsonl
import { writeFile } from "node:fs/promises";
import { endpointsFor } from "../packages/core/src/llm.ts";
import {
  JOURNEY_CHANNELS,
  buildStratifiedCast,
  castCoverageSummary,
  type JourneyChannel,
} from "../packages/sim/src/journeys/cast.ts";
import { createJourneyActor } from "../packages/sim/src/journeys/actors.ts";
import { runAllJourneyChannels } from "../packages/sim/src/journeys/channels.ts";
import {
  DEFAULT_JOURNEYS_CACHE_PATH,
  createJourneyLLMCache,
  verifyReplayCacheHitRate,
} from "../packages/sim/src/journeys/llmCache.ts";
import {
  evaluateJourneySignals,
  gradeTracesWithLiveJudge,
} from "../packages/sim/src/journeys/judge.ts";

const argv = process.argv.slice(2);
const has = (k: string) => argv.includes(`--${k}`);
const arg = (k: string): string | undefined => {
  const eq = argv.find(a => a.startsWith(`--${k}=`));
  if (eq) return eq.slice(k.length + 3);
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

const live = has("live") && !has("offline");
const seedRaw = arg("seed");
const seed = seedRaw === undefined ? 42 : Number(seedRaw);
if (!Number.isInteger(seed)) die("--seed must be an integer");

const budgetUsdRaw = arg("budget-usd");
const budgetUsd = budgetUsdRaw === undefined ? 1.0 : Number(budgetUsdRaw);
if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) die("--budget-usd must be a positive number");

const maxReqRaw = arg("max-requests");
const maxRequests = maxReqRaw === undefined ? 80 : Number(maxReqRaw);
if (!Number.isInteger(maxRequests) || maxRequests <= 0) die("--max-requests must be a positive integer");

const cachePath = arg("cache") ?? DEFAULT_JOURNEYS_CACHE_PATH;
const jsonOut = arg("json");
const showTranscripts = has("transcripts");

const channelRaw = arg("channel");
let selectedChannels: JourneyChannel[] | undefined;
if (channelRaw) {
  const parts = channelRaw.split(",").map(s => s.trim()).filter(Boolean);
  for (const ch of parts) {
    if (!(JOURNEY_CHANNELS as readonly string[]).includes(ch)) {
      die(`Unknown --channel ${JSON.stringify(ch)}; expected one of: ${JOURNEY_CHANNELS.join(", ")}`);
    }
  }
  selectedChannels = parts as JourneyChannel[];
}

if (live) {
  const endpoints = endpointsFor("surplus", process.env);
  if (endpoints.length === 0) {
    const skipped = {
      mode: "live",
      status: "skipped_missing_api_key",
      message: "Neither SURPLUS_API_KEY nor OPENAI_API_KEY is set. Set one in .env to run --live, or run with --offline.",
      seed,
      budgetUsd,
      maxRequests,
      cachePath,
    };
    console.log(`[journey-eval] ${skipped.message}`);
    if (jsonOut) {
      await writeFile(jsonOut, `${JSON.stringify(skipped, null, 2)}\n`, "utf8");
    }
    process.exit(0);
  }
}

const t0 = performance.now();
const cast = buildStratifiedCast(seed);
const coverage = castCoverageSummary(cast);

let llmCache = live
  ? createJourneyLLMCache({
      cachePath,
      maxBudgetUsd: budgetUsd,
      maxRequests,
      seed,
    })
  : undefined;

const actor = createJourneyActor({
  mode: live ? "live" : "offline",
  llmCache,
});

const bundle = await runAllJourneyChannels({
  cast,
  actor,
  channels: selectedChannels,
});

let replayCacheHitRate = 1;
let budgetBreaches = 0;
let liveRubric;
let llmTelemetry;

if (live && llmCache) {
  liveRubric = await gradeTracesWithLiveJudge(bundle.traces, llmCache, 5);
  llmTelemetry = llmCache.telemetry();
  budgetBreaches = llmTelemetry.budgetBreaches;
  // On first cold run, verify replay cache mechanism on warm entries; on warm replay run, report real hit rate.
  if (llmTelemetry.cacheHits > 0 && llmTelemetry.cacheHits + llmTelemetry.cacheMisses > 0) {
    replayCacheHitRate = llmTelemetry.replayCacheHitRate;
  } else {
    const check = await verifyReplayCacheHitRate();
    replayCacheHitRate = check.replayCacheHitRate;
    budgetBreaches += check.budgetBreaches;
  }
} else {
  const check = await verifyReplayCacheHitRate();
  replayCacheHitRate = check.replayCacheHitRate;
  budgetBreaches = check.budgetBreaches;
}

const elapsedMs = Math.round(performance.now() - t0);
const report = evaluateJourneySignals({
  mode: live ? "live" : "offline",
  seed,
  personasCount: cast.length,
  traces: bundle.traces,
  signals: bundle.signals,
  replayCacheHitRate,
  budgetBreaches,
  elapsedMs,
  llmTelemetry,
  liveRubric,
});

console.log(
  `[journey-eval] mode=${report.mode} seed=${seed} personas=${coverage.total} traces=${report.traceCount} elapsed=${report.elapsedMs}ms`,
);
for (const g of report.gates) {
  const tag = g.pass ? "PASS " : g.blocking ? "FAIL " : "track";
  console.log(`  ${tag} ${g.name}: ${g.detail}`);
}
if (llmTelemetry) {
  console.log(
    `[journey-eval] llm requests=${llmTelemetry.requests} hits=${llmTelemetry.cacheHits} misses=${llmTelemetry.cacheMisses} promptTok=${llmTelemetry.promptTokens} cachedTok=${llmTelemetry.cachedPromptTokens} completionTok=${llmTelemetry.completionTokens} reasoningTok=${llmTelemetry.reasoningTokens} cost=$${llmTelemetry.costUsd.toFixed(4)}`,
  );
}

if (showTranscripts) {
  for (const trace of bundle.traces) {
    console.log(`\n=== [${trace.channel}] ${trace.id}: ${trace.title} ===`);
    for (const turn of trace.turns) {
      console.log(`  [${turn.direction}] ${turn.actor}: ${turn.text}`);
    }
  }
}

if (jsonOut) {
  await writeFile(
    jsonOut,
    `${JSON.stringify({ coverage, report, traces: bundle.traces }, null, 2)}\n`,
    "utf8",
  );
}

const blockingFailures = report.gates.filter(g => g.blocking && !g.pass);
console.log(
  `\n${blockingFailures.length ? "FAIL" : "PASS"}: ${report.gates.filter(g => g.blocking && g.pass).length}/${report.gates.filter(g => g.blocking).length} blocking gates pass`,
);
process.exit(blockingFailures.length ? 1 : 0);
