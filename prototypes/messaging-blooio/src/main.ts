// Tiny local webhook receiver. Sends are DRY-RUN unless BLOOIO_ALLOW_SEND=1.
//   BLOOIO_WEBHOOK_SECRET=whsec_... bun run src/main.ts
// Expose with a tunnel (e.g. `ngrok http 8787`) and point a Blooio webhook at https://<tunnel>/webhooks/blooio.
// Creating that webhook is a configuration change on the Blooio account: a human does it, not this script.

import { resolve } from "node:path";
import { RealClock } from "../../../packages/core/src/clock.ts";
import { BlooioClient } from "./blooio/client.ts";
import { BlooioAdapter, DryRunAdapter } from "./adapters/blooio-adapter.ts";
import { InMemoryDedupeStore } from "./dedupe.ts";
import { Gateway } from "./gateway.ts";
import { FileConsentStore } from "./consent-store.ts";
import { ConsentLedger, defaultCopy } from "./keywords.ts";
import { resolveSenderLine } from "./line.ts";
import { OutboundQueue } from "./outbound-queue.ts";
import { createWebhookHandler, WEBHOOK_PATH } from "./server.ts";

const secret = process.env.BLOOIO_WEBHOOK_SECRET;
if (!secret) {
  console.error("BLOOIO_WEBHOOK_SECRET is required (the whsec_ value shown once when the webhook was created).");
  process.exit(1);
}
const apiKey = process.env.BLOOIO_API_KEY;
const allowSend = process.env.BLOOIO_ALLOW_SEND === "1";
const clock = new RealClock();
const from = resolveSenderLine(); // BLOOIO_FROM (alias BLOOIO_FROM_NUMBER), E.164

const real = apiKey ? new BlooioAdapter(new BlooioClient({ apiKey }), from) : null;
const adapter = allowSend && real ? real : new DryRunAdapter(real ?? { kind: "blooio", send: async () => { throw new Error("unreachable"); } });

// Opt-outs survive restarts. runs/ is gitignored. Production: Postgres.
const consentPath = process.env.BLOOIO_CONSENT_FILE ?? resolve(import.meta.dir, "../../../runs/blooio/consent.jsonl");
const consent = new ConsentLedger(clock, "address", new FileConsentStore(consentPath));
// No member store in this prototype, so no recipientPolicy: the Network runtime must supply one before live
// agent-initiated sends (it re-checks paused/blocked/held/minor at send time).
const queue = new OutboundQueue({
  clock, adapters: { blooio: adapter }, consent, defaultFrom: from ? { blooio: from } : undefined,
  onAlert: (r, why) => console.warn(`[alert] ${r.id} ${why}`),
});
const gateway = new Gateway({
  dedupe: new InMemoryDedupeStore(clock),
  consent,
  copy: defaultCopy(process.env.NETWORK_SUPPORT_CONTACT),
  queue,
  onMessage: (m, { optedOut }) => console.log(`[inbound] ${m.channel}/${m.transport} ${m.isGroup ? "group " : ""}chat=${m.chatId} optedOut=${optedOut} len=${m.text.length}`),
  onSafety: (s) => console.warn(`[safety] ${s.type} action=${s.action} line=${s.line}`),
});

const port = Number(process.env.PORT ?? 8787);
Bun.serve({ port, fetch: createWebhookHandler({ secret, clock, gateway, log: console.log }) });
setInterval(() => void queue.drain(), 5_000);
console.log(`Blooio receiver on http://localhost:${port}${WEBHOOK_PATH} (sends ${allowSend && real ? "LIVE" : "dry-run"})`);
