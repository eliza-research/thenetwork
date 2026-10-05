// Read-only verification of BLOOIO_API_KEY: GET /me, /me/numbers, /channels, /webhooks, /webhooks/versions.
// Sends nothing and changes nothing. Prints no secrets (webhook URLs are reduced to their host).
//   bun run scripts/verify-readonly.ts

import { BlooioClient } from "../src/blooio/client.ts";
import { loadRootEnv } from "./env.ts";

loadRootEnv();
const apiKey = process.env.BLOOIO_API_KEY;
if (!apiKey) { console.error("BLOOIO_API_KEY not set"); process.exit(1); }
const c = new BlooioClient({ apiKey });

const me = await c.getMe();
console.log(`key valid: ${me.valid} (auth ${me.auth_type}); org ${me.organization?.name ?? "?"} [${me.organization_id}]`);
console.log(`usage on this key: inbound ${me.usage?.inbound_messages ?? "?"}, outbound ${me.usage?.outbound_messages ?? "?"}`);

console.log("\nlines owned by this key (/me/numbers):");
for (const n of await c.listNumbers()) {
  console.log(`  ${n.phone_number}  plan=${n.plan_kind}  status=${n.status}  active=${n.is_active}  suspended=${n.suspended}`);
}

console.log("\norganization channels (/channels):");
for (const ch of (await c.listChannels()).data) {
  console.log(`  ${ch.address}  ${ch.type}  ${ch.status}  protocols=${ch.capabilities?.protocols?.join("/")}  actions=${ch.capabilities?.actions?.join("/")}  id=${ch.id}`);
}

console.log("\nwebhooks (/webhooks):");
for (const w of (await c.listWebhooks()).data) {
  let host = "?";
  try { host = new URL(w.url).host; } catch {}
  console.log(`  ${w.id}  ${w.status}  scope=${w.scope}  api_version=${w.api_version}  -> ${host}`);
}

const versions = (await c.listWebhookVersions()) as { data?: { version: string; latest?: boolean }[] };
console.log(`\nwebhook payload versions: ${versions.data?.map((v) => `${v.version}${v.latest ? " (latest)" : ""}`).join(", ")}`);
