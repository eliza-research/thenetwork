// FIRST REAL SEND. Sends ONE plain-text message to YOUR OWN phone.
//   bun run scripts/first-send.ts --to +1YOURNUMBER --confirm [--from +1LINE] [--text "..."]
// Refuses to run unless BOTH --to and --confirm are given. Never run this against anyone else's number:
// Blooio counts first-contact messages against the line's new-conversation allowance and one-way-outreach signals.

import { parseArgs } from "node:util";
import { BlooioClient } from "../src/blooio/client.ts";
import { ChannelSendError } from "../src/types.ts";
import { checkFirstSendArgs } from "../src/first-send-guard.ts";
import { resolveSenderLine } from "../src/line.ts";
import { toE164 } from "../src/phone.ts";
import { loadRootEnv } from "./env.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { to: { type: "string" }, confirm: { type: "boolean", default: false }, from: { type: "string" }, text: { type: "string" } },
  strict: true,
});

const problem = checkFirstSendArgs(values);
if (problem) { console.error(problem); process.exit(2); }

loadRootEnv();
const apiKey = process.env.BLOOIO_API_KEY;
if (!apiKey) { console.error("BLOOIO_API_KEY not set"); process.exit(1); }
// BLOOIO_FROM is canonical; BLOOIO_FROM_NUMBER is accepted as an alias (src/line.ts).
const from = values.from ? toE164(values.from) ?? undefined : resolveSenderLine();
if (values.from && !from) { console.error("--from must be an E.164 number"); process.exit(2); }
if (from && toE164(values.to!) === from) { console.error("Refusing to send: --to is the sending line itself"); process.exit(2); }
const text = values.text ?? "The Network: first Blooio test message. Reply anything to confirm inbound works, or STOP to test opt-out.";
const client = new BlooioClient({ apiKey });

// Same recipient + same UTC day => same key, so an accidental double run does not double-text.
const idempotencyKey = `tn-first-send:${values.to}:${new Date().toISOString().slice(0, 10)}`;
console.log(`Sending 1 message from ${from ?? "(automatic sender)"} to ${values.to} (idempotency key ${idempotencyKey})`);

try {
  const r = await client.send({ to: values.to!, from, text, idempotencyKey });
  console.log(`accepted: id=${r.providerMessageId} chat=${r.chatId} status=${r.status} protocol=${r.transport}${r.replayed ? " (idempotent replay: NOT sent again)" : ""}`);
  if (r.chatId) {
    for (let i = 0; i < 6; i++) {
      await Bun.sleep(5_000);
      const s = (await client.getMessageStatus(r.chatId, r.providerMessageId)) as Record<string, unknown>;
      const d = (s.data ?? s) as Record<string, unknown>;
      console.log(`  t+${(i + 1) * 5}s status=${d.status} protocol=${d.protocol}`);
      if (d.status === "delivered" || d.status === "read" || d.status === "failed") break;
    }
  }
} catch (e) {
  if (e instanceof ChannelSendError) console.error(`send failed: ${e.message} [${e.failure}]`);
  else console.error(`send failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
