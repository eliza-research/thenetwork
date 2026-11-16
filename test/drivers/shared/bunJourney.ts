import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

function startWorker(file: string) {
  const root = process.env.THENETWORK_VIBESTACK_REPO;
  if (!root) throw new Error("Run the journey through scripts/vibestack.ts");
  const child = spawn("bun", ["run", "--no-env-file", join(root, "test/fixtures", file)], {
    cwd: root,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, USER: process.env.USER },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const replies = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const closed = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${file} exited with code ${code}`)));
  });
  // The current exchange reports a failed process. Disposal awaits the same result.
  void closed.catch(() => {});
  child.stdin.on("error", () => {});

  return {
    async exchange<T>(request: object): Promise<T> {
      child.stdin.write(JSON.stringify(request) + "\n");
      const reply = await Promise.race([replies.next(), closed.then(() => ({ done: true as const }))]);
      if (reply.done) throw new Error(`${file} closed before it replied`);
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

export function bunJourney<Event, State, Output>(file: string) {
  let worker: ReturnType<typeof startWorker> | undefined;
  return {
    async reset() {
      worker ??= startWorker(file);
      await worker.exchange({ method: "reset" });
    },
    dispatch: (key: string, event: Event) => worker!.exchange<"accepted" | "refused">({ method: "dispatch", key, event }),
    observe: (key: string) => worker!.exchange<State>({ method: "observe", key }),
    observeOutput: (key: string) => worker!.exchange<Output>({ method: "observeOutput", key }),
    async [Symbol.asyncDispose]() {
      await worker?.close();
    },
  };
}
