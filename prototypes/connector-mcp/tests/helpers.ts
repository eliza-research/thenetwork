import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DAY, SimClock } from "@thenetwork/core";
import { loadConfig, resolveClient } from "../src/config.ts";
import { FakeNetwork, seedWorld, type ConnectorPrincipal, type FakeMember } from "../src/fake-network.ts";
import { DEFAULT_SCOPES } from "../src/schemas.ts";
import { createMcpServer } from "../src/server.ts";
import { UI_EXTENSION } from "../src/widget.ts";

export const cfg = loadConfig({});

/** CIMD client ids as the hosts publish them. */
export const CLIENTS = {
  chatgpt: "https://chatgpt.com/oauth/client.json",
  claude: "https://claude.ai/oauth/mcp-client-metadata.json",
  gemini_enterprise: "https://vertexaisearch.cloud.google.com/oauth/client.json",
  unknown: "https://assistant.example.test/client.json",
} as const;
export type ClientName = keyof typeof CLIENTS;

export function world() {
  const clock = new SimClock();
  const net = new FakeNetwork(clock);
  const seed = seedWorld(net);
  return { clock, net, ...seed };
}

let grantSeq = 0;
/** A principal as the HTTP layer would build it from a verified token. */
export function principal(
  w: { clock: SimClock }, member: FakeMember,
  o: { client?: ClientName; scopes?: string[]; grantId?: string; grantAgeMs?: number } = {},
): ConnectorPrincipal {
  const c = resolveClient(CLIENTS[o.client ?? "claude"]);
  return {
    memberId: member.id, grantId: o.grantId ?? `grt_test${++grantSeq}`, clientId: c.clientId, hostKey: c.hostKey,
    hostDisplayName: c.displayName, scopes: o.scopes ?? [...DEFAULT_SCOPES], surfaceProfile: c.profile,
    trustTier: c.trustTier, grantCreatedAt: w.clock.now() - (o.grantAgeMs ?? 7 * DAY),
  };
}

export interface CallResult { raw: any; text: string; isError: boolean; data: any; meta: any }

/** Connect an MCP client for `p`. tools/list is fetched first so the SDK client (Ajv) validates every structuredContent. */
export async function connect(net: FakeNetwork, p: ConnectorPrincipal, opts: { ui?: boolean; guard?: boolean; clientName?: string } = {}) {
  const server = createMcpServer(net, p, { cfg, guard: opts.guard });
  const client = new Client(
    { name: opts.clientName ?? "test-host", version: "0.0.1" },
    { capabilities: opts.ui ? { extensions: { [UI_EXTENSION]: { mimeTypes: ["text/html;profile=mcp-app"] } } } as any : {} },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  const call = async (name: string, args: Record<string, unknown>): Promise<CallResult> => {
    const r: any = await client.callTool({ name, arguments: args });
    return { raw: r, text: r.content?.[0]?.text ?? "", isError: !!r.isError, data: r.structuredContent, meta: r._meta };
  };
  return { client, server, call, tools };
}

let n = 0;
export const key = () => `key_${(++n).toString().padStart(8, "0")}`;

/** Parse the ```json blocks of the approved design doc (tests compare our contracts to it). */
export function designJsonBlocks(): any[] {
  const doc = readFileSync(new URL("../../../docs/research/mcp-server-design.md", import.meta.url), "utf8");
  return [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!.replaceAll("<network-domain>", "ntwrk.party")));
}

/** Every model-visible string across a result (content text + structuredContent). */
export const visible = (r: CallResult) => `${r.text}\n${JSON.stringify(r.data ?? null)}`;
