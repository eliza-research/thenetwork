import { channelCredentialsMissing, channelSettingInvalid, minimumSecretLength, sendChannel, workersAiSetupMissing, type LineAndStaffProblems, type SendChannel } from "../../core/src/generated/bootPolicy.ts";
import { parseTokenGrants } from "../../../apps/observatory/src/staff.ts";
import { networkRoutePolicy } from "./route-authority.ts";

type Env = Record<string, string | undefined>;

export interface LineAndStaffFacts { turnSecretLength: number; staffTokenCount: number; shortestStaffTokenLength: number; turnSecretIsStaffToken: boolean }

export function serviceTokenGrants(value: string | undefined, production: boolean): ReturnType<typeof parseTokenGrants> {
  return parseTokenGrants(value, { explicitApp: production, variable: "NETWORK_SERVICE_TOKENS" });
}

export function lineAndStaffFacts(e: Env, production: boolean): LineAndStaffFacts {
  const tokens = [...serviceTokenGrants(e.NETWORK_SERVICE_TOKENS, production).keys()];
  const turnSecret = e.SERVICE_TURN_SECRET ?? "";
  return {
    turnSecretLength: turnSecret.length, staffTokenCount: tokens.length,
    shortestStaffTokenLength: Math.min(...tokens.map(t => t.length), 0x7fffffff),
    turnSecretIsStaffToken: turnSecret !== "" && tokens.includes(turnSecret),
  };
}

export function lineAndStaffMessages(p: LineAndStaffProblems): string[] {
  const out: string[] = [];
  if (p.turnSecretShort) out.push(`SERVICE_TURN_SECRET of at least ${minimumSecretLength} characters (the Eliza gateway's signed routes)`);
  if (p.staffTokensMissing) out.push("NETWORK_SERVICE_TOKENS (the staff API: review and safety)");
  if (p.staffTokenShort) out.push(`every NETWORK_SERVICE_TOKENS token to have at least ${minimumSecretLength} characters`);
  if (p.turnSecretReused) out.push("a SERVICE_TURN_SECRET that is not also a NETWORK_SERVICE_TOKENS token");
  return out;
}

export type ChannelName = "dry-run" | "blooio" | "eliza_cloud";

const CHANNEL_NAMES = {
  DryRunChannel: "dry-run", BlooioChannel: "blooio", ElizaCloudChannel: "eliza_cloud",
} as const satisfies Record<SendChannel, ChannelName>;

export function configuredChannel(e: Env, argv: readonly string[]): ChannelName {
  if (channelSettingInvalid(e.NETWORK_CHANNEL ?? "")) throw new Error(`NETWORK_CHANNEL=${e.NETWORK_CHANNEL} is not blooio or eliza_cloud; leave it empty for dry-run sends`);
  const channel = sendChannel(e.NETWORK_CHANNEL ?? "", argv.includes("--dry-run"), networkRoutePolicy(e) !== undefined);
  if (channelCredentialsMissing(channel, Boolean(e.BLOOIO_API_KEY), Boolean(e.BLOOIO_FROM || e.BLOOIO_FROM_NUMBER),
    Boolean(e.NETWORK_CLOUD_DELIVERY_ORIGIN), (e.SERVICE_TURN_SECRET ?? "").length)) {
    throw new Error(channel === "BlooioChannel" ? "NETWORK_CHANNEL=blooio needs BLOOIO_API_KEY and BLOOIO_FROM"
      : `NETWORK_CHANNEL=eliza_cloud needs NETWORK_CLOUD_DELIVERY_ORIGIN, BLOOIO_FROM and SERVICE_TURN_SECRET of at least ${minimumSecretLength} characters`);
  }
  return CHANNEL_NAMES[channel];
}

export function workersAiProblem(deployed: boolean, production: boolean, e: Env): string | undefined {
  return workersAiSetupMissing(deployed, production, Boolean(e.CLOUDFLARE_AI_TOKEN), Boolean(e.CLOUDFLARE_ACCOUNT_ID))
    ? (production ? "CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID (photo ratings and the relay classifier, which production needs)"
      : "CLOUDFLARE_ACCOUNT_ID with CLOUDFLARE_AI_TOKEN (photo ratings and the relay classifier)") : undefined;
}
