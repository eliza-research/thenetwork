// What a live engine run read, stored so it can be replayed (audit ME-004; PRD 32.20; migration 0016).
// network.matching_runs keeps the summary; network.matching_run_inputs keeps, per run, the engine input
// (phone numbers scrubbed), the resolved config, the exposure debt carried in, the model versions and
// the proposals, for 30 days. replayRun() runs the engine again on a stored row and diffs the proposals
// (scripts/replay-run.ts).
import type { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { resolveConfig, runEngine, type EngineConfigInput, type EngineInput, type EngineProposal, type MatchingRunLog } from "@thenetwork/engine";
import { appWiring } from "./packs.ts";

export const RUN_INPUT_RETENTION_MS = 30 * DAY;
/** A phone number (E.164 or a formatted US number) anywhere in a string. */
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d{8,15}\b/g;

/** A deep copy with every phone number in a string replaced by "[phone]". */
export function scrubPhones<T>(x: T): T {
  if (typeof x === "string") return x.replace(PHONE, "[phone]") as T;
  if (Array.isArray(x)) return x.map(scrubPhones) as T;
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, scrubPhones(v)])) as T;
  return x;
}

/** JSON that keeps non-finite numbers (the engine config has Infinity caps): { "$num": "Infinity" }. */
export const toStored = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? { $num: String(v) } : v)));
export const fromStored = <T>(x: unknown): T => JSON.parse(typeof x === "string" ? x : JSON.stringify(x), (_k, v) =>
  (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$num === "string" ? Number(v.$num) : v));

/** The proposals in the shape a diff compares (id, participants, kind, score). */
export const proposalKeys = (ps: EngineProposal[]) => ps.map(p => ({ id: p.id, participants: [...p.participants].sort(), kind: p.kind, score: Math.round(p.score * 1e6) / 1e6 }));

/** The row for one run. */
export function runInputRow(o: { runId: string; app: string; city: string; at: number; log: MatchingRunLog; proposals: EngineProposal[]; input: EngineInput; config: EngineConfigInput; pack?: string }) {
  const resolved = resolveConfig(o.config);
  return {
    run_id: o.runId, app_id: o.app, at: new Date(o.at), city: o.city, engine_version: o.log.engineVersion,
    input: toStored(scrubPhones(o.input)),
    config: toStored(resolved),
    exposure_debt: toStored(o.input.exposureDebt ?? {}),
    models: { engine: o.log.engineVersion, embed: o.log.embedModel, judge: o.log.judgeModel ?? null, pack: o.pack ?? null, inputHash: o.log.inputHash, configHash: o.log.configHash, seed: o.log.seed },
    proposals: proposalKeys(o.proposals),
    expires_at: new Date(o.at + RUN_INPUT_RETENTION_MS),
  };
}

/** Write the rows (inside the unit's transaction) and drop this app's rows past their retention. */
export async function writeRunInputs(tx: SQL, app: string, rows: Record<string, unknown>[], now: number) {
  for (const r of rows) await tx`insert into network.matching_run_inputs ${tx(r)} on conflict (run_id) do nothing`;
  if (rows.length) await tx`delete from network.matching_run_inputs where app_id = ${app} and expires_at < ${new Date(now)}`;
}

export interface ReplayDiff {
  runId: string; app: string;
  same: boolean;
  /** The engine's input and config hashes now against the stored ones (a different hash: the stored input changed, or the engine did). */
  inputHash: { stored: string | null; replay: string }; configHash: { stored: string | null; replay: string };
  added: ReturnType<typeof proposalKeys>; removed: ReturnType<typeof proposalKeys>; changed: { id: string; stored: number; replay: number }[];
}

/** Run the engine again on a stored row (the app's pack, no LLM) and compare the proposals. */
export async function replayRun(row: Record<string, any>): Promise<ReplayDiff> {
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  const input = fromStored<EngineInput>(row.input), config = fromStored<EngineConfigInput>(row.config), models = parse(row.models) ?? {};
  const pack = appWiring(row.app_id).pack;
  const r = await runEngine(input, config, pack ? { pack } : {});
  const stored = (parse(row.proposals) ?? []) as ReturnType<typeof proposalKeys>;
  const now = proposalKeys(r.proposals);
  const key = (p: { participants: string[]; kind: string }) => `${p.kind}:${p.participants.join(",")}`;
  const before = new Map(stored.map(p => [key(p), p])), after = new Map(now.map(p => [key(p), p]));
  const added = now.filter(p => !before.has(key(p))), removed = stored.filter(p => !after.has(key(p)));
  const changed = now.filter(p => before.has(key(p)) && Math.abs(before.get(key(p))!.score - p.score) > 1e-6).map(p => ({ id: p.id, stored: before.get(key(p))!.score, replay: p.score }));
  return {
    runId: row.run_id, app: row.app_id, same: !added.length && !removed.length && !changed.length,
    inputHash: { stored: models.inputHash ?? null, replay: r.runLog.inputHash }, configHash: { stored: models.configHash ?? null, replay: r.runLog.configHash },
    added, removed, changed,
  };
}
