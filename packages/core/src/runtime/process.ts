import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { basename, delimiter, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { nodeReadable } from "./streams.ts";

type StandardIO = "pipe" | "inherit" | "ignore";
type Options = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: StandardIO | Blob;
  stdout?: StandardIO;
  stderr?: StandardIO;
};

export function spawnProcess(argv: readonly string[], options: Options = {}) {
  const { cwd, env, stdin, stdout = "pipe", stderr = "pipe" } = options;
  const input = stdin instanceof Blob ? stdin : undefined;
  const io: SpawnOptions["stdio"] = [input ? "pipe" : (stdin as StandardIO | undefined) ?? "ignore", stdout, stderr];
  const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: io });
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => resolve(code ?? 1));
  });
  if (input && child.stdin) void pipeline(nodeReadable(input.stream()), child.stdin).catch(() => {});
  return {
    pid: child.pid,
    stdin: child.stdin,
    stdout: child.stdout ? Readable.toWeb(child.stdout) as ReadableStream<Uint8Array> : null,
    stderr: child.stderr ? Readable.toWeb(child.stderr) as ReadableStream<Uint8Array> : null,
    exited,
    kill: (signal?: number | NodeJS.Signals) => child.kill(signal),
  };
}

export function spawnProcessSync(argv: readonly string[], options: Omit<Options, "stdin"> & { stdin?: StandardIO } = {}) {
  const result = spawnSync(argv[0]!, argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "pipe"],
  });
  return {
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.from(result.error?.message ?? ""),
    exitCode: result.status ?? 1,
    success: result.status === 0,
  };
}

export function findExecutable(name: string): string | null {
  const paths = basename(name) === name
    ? (process.env.PATH ?? "").split(delimiter).map(part => join(part, name)) : [name];
  const candidates = process.platform === "win32" && !extname(name)
    ? paths.flatMap(path => [path, `${path}.exe`]) : paths;
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* Try the next path. */ }
  }
  return null;
}
