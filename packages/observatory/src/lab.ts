// Simulation lab (admin-console 3.13, gap 12): start background runs of the experiment arms, watch
// their status, and read the results (everyone-yes, accept, meetings, judge invariants, canary leaks,
// minor contacts). Each seed is one child process of packages/network/harness/experiment.ts (the
// same arms and the same judge numbers as the results docs), at most 2 at a time; the rest wait in a
// queue. Each run is saved to runs/lab/<id>.json and loaded again when the server starts.
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_IDS, DEFAULT_APP, isAppId, matchingAllowed, type AppId } from "./apps.ts";
import { REPO } from "./staff.ts";
import type { LabArm, LabArmResult, LabRequest, LabRun } from "./types.ts";

export const LAB_ARMS: readonly LabArm[] = ["push_baseline", "push_v2", "consent"];
export const LAB_LIMITS = { maxSeeds: 5, maxDays: 60, concurrency: 2 } as const;

export interface LabOptions {
  /** Where results are saved (default runs/lab). */
  dir?: string;
  /** The child script (default packages/network/harness/experiment.ts). It gets --only, --days and --seed and prints { results: [...] } JSON. */
  script?: string;
  concurrency?: number;
}

/** Check a request; returns the normalized request or why it is refused. */
export function validateLab(body: unknown): LabRequest | string {
  const b = (body ?? {}) as Partial<LabRequest>;
  const arms = Array.isArray(b.arms) ? [...new Set(b.arms)] : [];
  const seeds = Array.isArray(b.seeds) ? [...new Set(b.seeds)] : [];
  if (!arms.length || arms.some(a => !LAB_ARMS.includes(a))) return `arms must be some of ${LAB_ARMS.join(", ")}`;
  if (!seeds.length || seeds.length > LAB_LIMITS.maxSeeds || seeds.some(s => !Number.isInteger(s) || s < 1 || s > 1_000_000)) return `seeds must be 1-${LAB_LIMITS.maxSeeds} positive integers`;
  if (!Number.isInteger(b.days) || b.days! < 1 || b.days! > LAB_LIMITS.maxDays) return `days must be an integer from 1 to ${LAB_LIMITS.maxDays}`;
  const app = b.app ?? DEFAULT_APP;
  if (!isAppId(app)) return `app must be one of ${APP_IDS.join(", ")}`;
  return { arms, seeds, days: b.days!, app };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One arm's result from the child's JSON (experiment.ts ArmResult; a child without the judge fields gives nulls). */
export function parseArm(r: Record<string, any>, seed: number): LabArmResult {
  return {
    arm: String(r.arm), seed,
    everyoneYes: num(r.proposalAllYesRate), accept: num(r.inviteAcceptRate), meetings: num(r.meetingsHeld),
    judgeInvariants: num(r.judge?.invariants), canaryLeaks: num(r.judge?.canaryLeaks), minorContacts: num(r.judge?.minorContacts),
  };
}

/** The child's results: its whole stdout as JSON (experiment.ts prints it indented), else the last line that is a JSON object. */
export function resultsOf(out: string): { results?: Record<string, any>[] } | undefined {
  const text = out.trim();
  try { return JSON.parse(text); } catch { /* not one JSON document: a log line came first */ }
  for (const line of text.split("\n").reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try { return JSON.parse(line); } catch { /* keep looking */ }
  }
  const start = text.indexOf("\n{");
  if (start >= 0) { try { return JSON.parse(text.slice(start + 1)); } catch { /* none */ } }
  return undefined;
}

/**
 * The child's arguments. An app whose pack has not shipped (slop, peon) runs with no new
 * opportunities (--max-new 0): joins, onboarding and safety only. The experiment world is The
 * Network's NYC world for every app; it has no per-app join age yet.
 */
export function labArgs(r: LabRequest, seed: number): string[] {
  const app = isAppId(r.app) ? r.app : DEFAULT_APP;
  return ["--only", r.arms.join(","), "--days", String(r.days), "--seed", String(seed), ...(matchingAllowed(app) ? [] : ["--max-new", "0"])];
}

export class Lab {
  private runs = new Map<string, LabRun>();
  private queue: { run: LabRun; seed: number }[] = [];
  private active = 0;
  private seq = 0;
  private loaded: Promise<void>;
  private children = new Set<ReturnType<typeof Bun.spawn>>();
  readonly dir: string;
  private script: string;
  private concurrency: number;

  constructor(o: LabOptions = {}) {
    this.dir = o.dir ?? join(REPO, "runs", "lab");
    this.script = o.script ?? join(REPO, "packages", "network", "harness", "experiment.ts");
    this.concurrency = o.concurrency ?? LAB_LIMITS.concurrency;
    this.loaded = this.load();
  }

  /** Earlier runs from disk. One that was running when the server stopped is marked failed. */
  private async load() {
    await mkdir(this.dir, { recursive: true });
    for (const f of (await readdir(this.dir)).filter(x => x.endsWith(".json"))) {
      try {
        const r = JSON.parse(await readFile(join(this.dir, f), "utf8")) as LabRun;
        if (r.status === "queued" || r.status === "running") Object.assign(r, { status: "failed", error: "the server stopped before the run finished" });
        this.runs.set(r.id, r);
      } catch { /* a file that is not a run */ }
    }
  }

  /** Newest first. With `app`: that app's runs only (a run from before the four apps is ntwrk). */
  async list(app?: AppId): Promise<LabRun[]> {
    await this.loaded;
    return [...this.runs.values()].filter(r => !app || (r.request.app ?? DEFAULT_APP) === app).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** A run as saved: a status change is returned only after its file is written. */
  async get(id: string) { await this.loaded; await this.saving.get(id); return this.runs.get(id); }

  /** Queue a run: one child per seed. */
  async start(req: LabRequest, requestedBy: string): Promise<LabRun> {
    await this.loaded;
    const now = Date.now();
    const id = `lab-${new Date(now).toISOString().replace(/[-:]/g, "").replace(/\..*/, "")}-${++this.seq}`;
    const run: LabRun = {
      id, request: req, requestedBy, status: "queued", createdAt: now, progress: { done: 0, total: req.seeds.length }, results: [],
      file: join(this.dir, `${id}.json`),
    };
    this.runs.set(id, run);
    for (const seed of req.seeds) this.queue.push({ run, seed });
    await this.save(run);
    this.pump();
    return run;
  }

  /** Children running now. */
  get running() { return this.active; }

  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      this.exec(job.run, job.seed).finally(() => { this.active--; this.pump(); });
    }
  }

  private async exec(run: LabRun, seed: number) {
    if (run.status === "queued") { run.status = "running"; run.startedAt = Date.now(); await this.save(run); }
    const r = run.request;
    try {
      const child = Bun.spawn([process.execPath, "run", this.script, ...labArgs(r, seed)], {
        cwd: REPO, stdout: "pipe", stderr: "pipe", env: { ...process.env, LIVE_TESTS: "" },
      });
      this.children.add(child);
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      this.children.delete(child);
      if (code !== 0) throw new Error(`seed ${seed}: exit ${code}: ${err.trim().split("\n").slice(-3).join(" | ").slice(0, 400)}`);
      const json = resultsOf(out);
      if (!json) throw new Error(`seed ${seed}: no results on stdout`);
      for (const a of json.results ?? []) run.results.push(parseArm(a, seed));
    } catch (e) {
      run.error = [run.error, String((e as Error).message ?? e)].filter(Boolean).join("; ");
    }
    run.progress.done++;
    if (run.progress.done === run.progress.total) {
      run.status = run.error ? "failed" : "done";
      run.finishedAt = Date.now();
      run.results.sort((a, b) => a.arm.localeCompare(b.arm) || a.seed - b.seed);
    }
    await this.save(run);
  }

  private saving = new Map<string, Promise<void>>();
  /**
   * Saves of one run happen one after another (two seeds can finish together). Each save writes a
   * temporary file and renames it, so a reader never sees half a file.
   */
  private save(run: LabRun): Promise<void> {
    const text = JSON.stringify(run, null, 2);
    const next = (this.saving.get(run.id) ?? Promise.resolve()).then(async () => { await writeFile(`${run.file}.tmp`, text); await rename(`${run.file}.tmp`, run.file); });
    this.saving.set(run.id, next.catch(() => {}));
    return next;
  }

  /** Stop children (server shutdown). */
  dispose() { for (const c of this.children) c.kill(); this.children.clear(); this.queue = []; }
}
