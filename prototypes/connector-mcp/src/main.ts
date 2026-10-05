// Local run: `bun run src/main.ts`, then point MCP Inspector at http://localhost:8787/mcp with
// header `Authorization: Bearer dev-ava`. Synthetic world only.
import { SimClock, RealClock } from "@thenetwork/core";
import { FakeNetwork, seedWorld } from "./fake-network.ts";
import { createHttpHandler, StaticTokenVerifier } from "./http.ts";
import { SCOPES } from "./schemas.ts";

const port = Number(process.env.PORT ?? 8787);
const origin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
const clock = process.env.SIM_CLOCK ? new SimClock() : new RealClock();
const net = new FakeNetwork(clock);
const { ava } = seedWorld(net);
const verifier = new StaticTokenVerifier(
  { "dev-ava": { memberId: ava.id, clientId: "dev-inspector", scopes: Object.values(SCOPES), audience: `${origin}/mcp`, expiresAt: Number.MAX_SAFE_INTEGER } },
  () => clock.now(),
);
const handle = createHttpHandler(net, { origin, verifier });
Bun.serve({ port, fetch: handle });
console.log(`The Network connector prototype on ${origin}/mcp (token: dev-ava)`);
