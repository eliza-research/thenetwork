import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Driver, Options } from "../../gen/sharedLineConsentJourney.conformance.ts";

function startWorker() {
  const root = process.env.THENETWORK_VIBESTACK_REPO;
  if (!root) throw new Error("Run the consent driver through scripts/vibestack.ts");
  const child = spawn("bun", ["run", "--no-env-file", join(root, "test/fixtures/sharedLineConsentWorker.ts")], {
    cwd: root,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, USER: process.env.USER },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const closed = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Consent fixture exited with code ${code}`)));
  });
  // The current exchange reports a failed process. Disposal awaits the same result.
  void closed.catch(() => {});
  child.stdin.on("error", () => {});

  return {
    async exchange<T>(request: object): Promise<T> {
      child.stdin.write(JSON.stringify(request) + "\n");
      const reply = await Promise.race([replies.next(), closed.then(() => ({ done: true as const }))]);
      if (reply.done) throw new Error("Consent fixture closed before it replied");
      const result: { value: T } | { error: string } = JSON.parse(reply.value);
      if ("error" in result) throw new Error(result.error);
      return result.value;
    },
    async close() {
      child.stdin.end();
      await closed;
    },
  };
}

let worker: ReturnType<typeof startWorker> | undefined;
export const driver: Driver & AsyncDisposable = {
  async reset() {
    worker ??= startWorker();
    await worker.exchange({ method: "reset" });
  },
  dispatch: (key, event) => worker!.exchange({ method: "dispatch", key, event }),
  observe: key => worker!.exchange({ method: "observe", key }),
  observeOutput: key => worker!.exchange({ method: "observeOutput", key }),
  async [Symbol.asyncDispose]() {
    await worker?.close();
  },
};

export const options: Options = { keys: ["member-a", "member-b"], walks: 6, steps: 9 };
