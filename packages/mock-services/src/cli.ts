#!/usr/bin/env -S node --import=tsx
import { parseArgs } from "node:util";
import { startMockServices } from "./index.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: process.env.MOCK_SERVICES_PORT ?? "4900" },
    host: { type: "string", default: process.env.MOCK_SERVICES_HOST ?? "127.0.0.1" },
    seed: { type: "string", default: process.env.MOCK_SERVICES_SEED ?? "1" },
    "s3-dir": { type: "string" },
  },
});

const port = Number.parseInt(values.port ?? "4900", 10);
const seed = Number.parseInt(values.seed ?? "1", 10);
const hostname = values.host ?? "127.0.0.1";

const mock = await startMockServices({
  hostname,
  port: Number.isFinite(port) ? port : 4900,
  seed: Number.isFinite(seed) ? seed : 1,
  s3Dir: values["s3-dir"],
});

console.log(
  `[mock-services] listening on ${mock.url} (seed=${seed}, control plane: ${mock.url}/_mock/health)`,
);

const shutdown = async () => {
  await mock.stop(true);
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
