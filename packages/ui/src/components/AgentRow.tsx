// spec/landingEntry.md, "A desktop-only tile is hidden on a phone, and a copy-only tile needs the page script"
import type { ComponentProps } from "react";
import type { AppKey } from "../../../core/src/generated/brandIdentity.ts";
import { type AgentId, type DeviceKind, tileShown } from "../../../core/src/generated/landingEntry.ts";
import { agentHref, type LandingLinks, landingAgents } from "../brand/landing.ts";
import { cn } from "../lib/cn.ts";
import { AgentTile } from "./AgentTile.tsx";

export type AgentRowProps = Omit<ComponentProps<"nav">, "children"> & {
  /** The app of the site: the row leaves out an agent that this app's connector refuses. */
  app: AppKey;
  /** The prompt and the skill URL that the tile links carry. */
  links: Pick<LandingLinks, "prompt" | "skillUrl">;
  /** True when the page script runs. */
  mounted?: boolean;
  /** The detected device. */
  device?: DeviceKind;
  /** Called when the person presses a tile. */
  onChoose?: (agent: AgentId) => void;
};

/**
 * The agents of the app in their fixed order, each as a logo tile. The row has only the agents of `landingAgents` (spec/landingEntry.md, "The agent row never shows an agent that the app's connector refuses"), and a tile shows only where the generated `tileShown` allows it.
 * @model spec/landingEntry.md
 */
export function AgentRow({ app, links, mounted = false, device = "NotDetected", onChoose, className, "aria-label": label = "Open your agent", ...props }: AgentRowProps) {
  return (
    <nav aria-label={label} className={cn("flex flex-wrap gap-2", className)} {...props}>
      {landingAgents(app)
        .filter((agent) => tileShown(agent, mounted, device))
        .map((agent) => (
          <AgentTile key={agent} agent={agent} href={agentHref(agent, links)} onChoose={onChoose} />
        ))}
    </nav>
  );
}
