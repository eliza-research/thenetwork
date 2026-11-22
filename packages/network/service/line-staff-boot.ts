import { lineAndStaffProblems, type LineAndStaffProblems } from "../../core/src/generated/bootPolicy.ts";
import { parseTokenGrants } from "../../observatory/src/staff.ts";

type Env = Record<string, string | undefined>;

export interface LineAndStaffFacts { turnSecretLength: number; staffTokenCount: number; shortestStaffTokenLength: number; turnSecretIsStaffToken: boolean }

export function lineAndStaffFacts(e: Env, production: boolean): LineAndStaffFacts {
  let tokens: string[];
  try { tokens = [...parseTokenGrants(e.NETWORK_SERVICE_TOKENS, { explicitApp: production }).keys()]; }
  catch (err) { throw new Error(String((err as Error).message).replace("OBSERVATORY_TOKENS", "NETWORK_SERVICE_TOKENS")); }
  const turnSecret = e.SERVICE_TURN_SECRET ?? "";
  return {
    turnSecretLength: turnSecret.length, staffTokenCount: tokens.length,
    shortestStaffTokenLength: Math.min(...tokens.map(t => t.length), 0x7fffffff),
    turnSecretIsStaffToken: turnSecret !== "" && tokens.includes(turnSecret),
  };
}

export function lineAndStaffProblemsFor(deployed: boolean, f: LineAndStaffFacts): LineAndStaffProblems {
  return lineAndStaffProblems(deployed, f.turnSecretLength, f.staffTokenCount, f.shortestStaffTokenLength, f.turnSecretIsStaffToken);
}

export function lineAndStaffMessages(p: LineAndStaffProblems, minimum: number): string[] {
  const out: string[] = [];
  if (p.turnSecretShort) out.push(`SERVICE_TURN_SECRET of at least ${minimum} characters (the Eliza gateway's signed routes)`);
  if (p.staffTokensMissing) out.push("NETWORK_SERVICE_TOKENS (the staff API: review and safety)");
  if (p.staffTokenShort) out.push(`every NETWORK_SERVICE_TOKENS token to have at least ${minimum} characters`);
  if (p.turnSecretReused) out.push("a SERVICE_TURN_SECRET that is not also a NETWORK_SERVICE_TOKENS token");
  return out;
}
