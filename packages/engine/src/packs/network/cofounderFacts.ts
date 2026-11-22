import type { AppId, MemberId } from "@thenetwork/core";
import {
  cofounderFactsFit, unstatedCofounderFacts, type CofounderCommitment, type CofounderFacts, type CofounderIdea, type CofounderImportance, type CofounderRole,
} from "../../../../core/src/generated/cofounderIntent.ts";
import { standingFacetReadable } from "../../../../core/src/generated/memberStanding.ts";
import type { EntityTags } from "../../match/profile.ts";
import type { World } from "../../world.ts";

const ROLE: Readonly<Record<string, CofounderRole>> = { technical: "TechnicalCofounder", business: "BusinessCofounder", both: "BothRoles" };
const COMMITMENT: Readonly<Record<string, CofounderCommitment>> = { full_time_now: "FullTimeNow", part_time: "PartTimeNow", full_time_later: "FullTimeLater" };
const IDEA: Readonly<Record<string, CofounderIdea>> = { has_idea: "HasIdea", open: "OpenToIdea", either: "IdeaEither" };
const COMMITMENT_TAG: Readonly<Record<CofounderCommitment, string>> = { FullTimeNow: "full_time_now", PartTimeNow: "part_time", FullTimeLater: "full_time_later", CommitmentUnstated: "" };

export function cofounderFactsOf(w: World, id: MemberId, app: AppId): CofounderFacts {
  const tags = (w.get(id)?.match ?? [])
    .filter(f => (f.app ?? app) === app && standingFacetReadable(f.scope, f.provenance, f.confirmedByMember === true, f.sensitive !== undefined, f.inferred === true))
    .flatMap(f => f.tags);
  const value = (prefix: string) => tags.find(t => t.startsWith(prefix))?.slice(prefix.length) ?? "";
  const importance = (field: string): CofounderImportance =>
    tags.includes(`cofounder:must:${field}`) ? "MustHave" : tags.includes(`cofounder:prefer:${field}`) ? "Preference" : "DoNotMind";
  return {
    ...unstatedCofounderFacts,
    role: ROLE[value("cofounder:role:")] ?? "RoleUnstated", roleImportance: importance("role"),
    commitment: COMMITMENT[value("cofounder:commitment:")] ?? "CommitmentUnstated", commitmentImportance: importance("commitment"),
    idea: IDEA[value("cofounder:idea:")] ?? "IdeaUnstated", ideaImportance: importance("idea"),
  };
}

export function cofounderMustHavesFit(w: World, a: MemberId, b: MemberId, app: AppId): boolean {
  return cofounderFactsFit(cofounderFactsOf(w, a, app), cofounderFactsOf(w, b, app));
}

export function cofounderFactTags(f: CofounderFacts): Pick<EntityTags, "offers" | "seeks"> {
  const offers: string[] = [], seeks: string[] = [];
  const rated = (i: CofounderImportance) => i !== "DoNotMind";
  if (f.role === "TechnicalCofounder" || f.role === "BothRoles") offers.push("cofounder_role:technical");
  if (f.role === "BusinessCofounder" || f.role === "BothRoles") offers.push("cofounder_role:business");
  if (f.commitment !== "CommitmentUnstated") offers.push(`cofounder_commitment:${COMMITMENT_TAG[f.commitment]}`);
  if (f.idea === "HasIdea" || f.idea === "IdeaEither") offers.push("cofounder_idea:has_idea");
  if (f.idea === "OpenToIdea" || f.idea === "IdeaEither") offers.push("cofounder_idea:open");
  if (rated(f.roleImportance) && f.role === "TechnicalCofounder") seeks.push("cofounder_role:business");
  if (rated(f.roleImportance) && f.role === "BusinessCofounder") seeks.push("cofounder_role:technical");
  if (rated(f.commitmentImportance) && f.commitment !== "CommitmentUnstated") seeks.push(`cofounder_commitment:${COMMITMENT_TAG[f.commitment]}`);
  if (rated(f.ideaImportance) && f.idea === "HasIdea") seeks.push("cofounder_idea:open");
  if (rated(f.ideaImportance) && f.idea === "OpenToIdea") seeks.push("cofounder_idea:has_idea");
  return { offers, seeks };
}
