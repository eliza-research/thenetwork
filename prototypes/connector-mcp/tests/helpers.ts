import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SimClock } from "@thenetwork/core";
import { FakeNetwork, seedWorld } from "../src/fake-network.ts";
import { createMcpServer } from "../src/server.ts";

export function world() {
  const clock = new SimClock();
  const net = new FakeNetwork(clock);
  const seed = seedWorld(net);
  return { clock, net, ...seed };
}

/** Connect an MCP client as `memberId`. Pass `elicit` to advertise form elicitation and answer prompts. */
export async function connect(
  net: FakeNetwork, memberId: string,
  opts: { clientId?: string; elicit?: (message: string) => boolean; guard?: boolean } = {},
) {
  const server = createMcpServer(net, { memberId, clientId: opts.clientId ?? "test-client" }, { guard: opts.guard });
  const client = new Client({ name: "test-host", version: "0.0.1" }, { capabilities: opts.elicit ? { elicitation: { form: {} } } : {} });
  if (opts.elicit) {
    const answer = opts.elicit;
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      const yes = answer(String((req.params as any).message));
      return yes ? { action: "accept", content: { confirm: true } } : { action: "decline" };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name, arguments: args });
    const text: string = r.content?.[0]?.text ?? "";
    return { raw: r, text, isError: !!r.isError, data: r.structuredContent ?? JSON.parse(text || "null") };
  };
  return { client, server, call };
}

let n = 0;
export const rid = () => `req_${(++n).toString().padStart(8, "0")}`;
