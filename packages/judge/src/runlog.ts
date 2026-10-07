// Run-log schema: one JSON object per line in runs/<runId>/events.jsonl. The simulator
// writes it; the metrics module (and later the admin console) reads it. Kept here so
// the judge package has no runtime dependency on the simulator.
import type { City, MemberId, Proposal } from "@thenetwork/core";

export interface LoggedMessage {
  id: string; ts: number; direction: "outbound" | "inbound"; memberId: MemberId; body: string;
  status: string; keyword?: string; system?: boolean;
  meta?: { type?: string; proposalId?: string; proactive?: boolean; firstContact?: boolean; [k: string]: unknown };
}

export interface LoggedPersona {
  id: MemberId; name: string; archetype: string; adversarial?: string; homeCity: City;
  joinDay: number; trueAge: number; claimedAge: number; quietHours: [number, number];
  canary?: string; privateFact?: string; romanceOptIn: boolean;
}

export interface OracleSummary {
  compatible: boolean; quality: number; minEnjoyment: number; flags: string[];
  /** Hard-safety verdict (e.g. any participant under 18). Optional for older run logs. */
  unsafe?: boolean;
  participants: Record<MemberId, { acceptProb: number; wouldAccept: boolean; showProb: number; wouldShow: boolean; enjoyment: number }>;
}

export type RunRecord =
  | { t: number; type: "run_start"; runId: string; seed: number | string; config: Record<string, unknown>; start: number }
  | { t: number; type: "persona"; persona: LoggedPersona }
  | { t: number; type: "join"; memberId: MemberId }
  | { t: number; type: "message"; msg: LoggedMessage }
  | { t: number; type: "decision"; memberId: MemberId; messageId: string; messageType: string; intent: string; decision: string; proposalId?: string; delayMs: number }
  | { t: number; type: "judgment"; memberId: MemberId; messageId: string; worthwhile: boolean; source: "policy" | "llm" }
  | { t: number; type: "proposal"; source: "network" | "engine" | "scenario" | "player"; proposal: Proposal; oracle: OracleSummary }
  | { t: number; type: "meeting_scheduled"; meetingId: string; proposalId: string; participants: MemberId[]; at: number; city: City }
  | { t: number; type: "outcome"; meetingId: string; proposalId: string; at: number; attendance: Record<MemberId, { showed: boolean; cancelledWithNotice: boolean; enjoyment: number }> }
  | { t: number; type: "feedback"; memberId: MemberId; proposalId?: string; text: string; enjoyment?: number }
  | { t: number; type: "block"; from: MemberId; to: MemberId }
  | { t: number; type: "opt_out"; memberId: MemberId }
  | { t: number; type: "adversarial_attempt"; memberId: MemberId; kind: string; messageId: string }
  | { t: number; type: "invariant_violation"; rule: string; detail: string; memberId?: MemberId }
  | { t: number; type: "latent_opportunities"; members: MemberId[]; pairs: { a: MemberId; b: MemberId; quality: number }[] }
  | { t: number; type: "scenario"; action: string; detail?: Record<string, unknown> }
  | { t: number; type: "network_error"; error: string }
  | { t: number; type: "network_log"; kind: string; detail: Record<string, unknown> }
  | { t: number; type: "run_end"; simEnd: number; wallMs: number; stats: Record<string, number> };

export type RunRecordType = RunRecord["type"];
/** A record before the logger stamps the sim time `t`. */
export type RunRecordInput = RunRecord extends infer R ? R extends RunRecord ? Omit<R, "t"> & { t?: number } : never : never;

/** Parse a JSONL run log. */
export function parseRunLog(text: string): RunRecord[] {
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as RunRecord);
}

export async function readRunLog(path: string): Promise<RunRecord[]> {
  return parseRunLog(await Bun.file(path).text());
}
