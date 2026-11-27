import { LeakGuard, type LLM } from "@thenetwork/core";
import { outputLeaks } from "../../../mcp/src/leaks.ts";
import {
  judgeConversationFriction,
  type ConversationFrictionVerdict,
} from "../judge/llmJudges.ts";
import type { JourneyChannelId } from "./channels.ts";

export interface JourneyTranscriptTurn {
  readonly atMs: number;
  readonly from: string;
  readonly to: string;
  readonly channel: JourneyChannelId;
  readonly text: string;
  readonly tag?: string;
}

export interface JourneyCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface JourneyTelemetry {
  llmCalls: number;
  llmCacheHits: number;
  llmCacheMisses: number;
  llmCacheCoalesced: number;
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costMicro: number;
  fallbackCount: number;
  budgetExhausted: boolean;
}

export interface JourneyOutcome {
  readonly id: string;
  readonly title: string;
  readonly category:
    | "speaking_style"
    | "age_policy"
    | "channel_surface"
    | "bad_actor"
    | "league_bilateral"
    | "clarity_band";
  readonly channel: JourneyChannelId;
  readonly pass: boolean;
  readonly checks: readonly JourneyCheck[];
  readonly transcript: readonly JourneyTranscriptTurn[];
  readonly leakCount: number;
  readonly rankingLeakCount: number;
  readonly summary: string;
  llmRubric?: ConversationFrictionVerdict;
}

export function emptyJourneyTelemetry(): JourneyTelemetry {
  return {
    llmCalls: 0,
    llmCacheHits: 0,
    llmCacheMisses: 0,
    llmCacheCoalesced: 0,
    promptTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    costMicro: 0,
    fallbackCount: 0,
    budgetExhausted: false,
  };
}

export interface DeterministicLeakAudit {
  readonly leakCount: number;
  readonly rankingLeakCount: number;
  readonly reasons: readonly string[];
}

export function auditTranscriptLeaks(
  transcript: readonly JourneyTranscriptTurn[],
  privateFacts: readonly { owner: string; text: string; canary?: string }[],
): DeterministicLeakAudit {
  const guard = new LeakGuard({
    forbidden: privateFacts.map(f => ({ text: f.text, owner: f.owner })),
    facts: privateFacts.map(f => ({ text: f.text, owner: f.owner })),
    canaries: privateFacts.map(f => f.canary).filter((c): c is string => Boolean(c)),
    canaryShapes: true,
    contacts: false,
  });

  const reasons: string[] = [];
  let leakCount = 0;
  let rankingLeakCount = 0;

  for (const turn of transcript) {
    if (turn.from !== "Eliza" && turn.from !== "Network") continue;
    const found = guard.check(turn.text, { exceptOwner: turn.to, contacts: false });
    if (turn.channel === "mcp_claude" || turn.channel === "mcp_openai") {
      const mcpReasons = outputLeaks(turn.text, {
        facts: privateFacts.filter(f => f.owner !== turn.to).map(f => f.text),
        contacts: true,
      });
      for (const r of mcpReasons) {
        if (!found.includes(r)) found.push(r);
      }
    }
    for (const r of found) {
      reasons.push(`${turn.to}:${r}`);
      leakCount += 1;
      if (r === "internal:ranking") rankingLeakCount += 1;
    }
  }

  return { leakCount, rankingLeakCount, reasons };
}

export async function scoreJourneyWithLLM(
  judge: LLM,
  outcome: JourneyOutcome,
  privateFacts: readonly string[],
): Promise<ConversationFrictionVerdict> {
  const lines = outcome.transcript
    .map(t => `[${t.channel}] ${t.from} -> ${t.to}: ${t.text}`)
    .join("\n");
  return judgeConversationFriction(
    judge,
    {
      transcript: lines || "(no turns)",
      context: `Journey ${outcome.id} (${outcome.category}): ${outcome.title}`,
      privateFacts,
    },
    { maxTokens: 1200 },
  );
}
