import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const cwd = fileURLToPath(new URL("../", import.meta.url));

test.each(["start", "dev"])("the Observatory package %s command serves the console", async script => {
  const isolated = process.platform !== "win32";
  const child = spawn("corepack", ["pnpm@10.24.0", "run", script, "--mode", "game", "--port", "0", "--days", "1", "--personas", "12"], {
    cwd,
    detached: isolated,
    env: { ...process.env, OBSERVATORY_HOST: "127.0.0.1", PLATFORM_ENV: "dev", OBSERVATORY_REAL_ONLY: "0", SURPLUS_API_KEY: "", OPENAI_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      child.stdout.setEncoding("utf8").on("data", chunk => {
        stdout += chunk;
        const ready = stdout.match(/The Network Observatory → (http:\/\/127\.0\.0\.1:\d+)\//);
        if (ready?.[1]) resolve(ready[1]);
      });
      child.once("error", reject);
      void closed.then(() => reject(new Error(`Observatory exited before serving the console\n${stderr}`)));
      timer = setTimeout(() => reject(new Error(`Observatory did not serve the console\n${stderr}`)), 20_000);
    });
    const health = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(5_000) });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    const page = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Observatory");
    const styles = await fetch(`${url}/assets/styles.css`, { signal: AbortSignal.timeout(5_000) });
    expect(styles.status).toBe(200);
    expect(styles.headers.get("content-type")).toContain("text/css");
    expect(await styles.text()).toContain(".bg-background");
  } finally {
    clearTimeout(timer);
    try {
      if (isolated && child.pid && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
      else child.kill();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
    await closed;
  }
}, 30_000);
