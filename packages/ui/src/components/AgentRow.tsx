// spec/landingEntry.md, "A desktop-only tile is hidden on a phone, and a copy-only tile needs the page script"
import type { ComponentProps } from "react";
import { type AgentId, type DeviceKind, agentOrder, tileShown } from "../../../core/src/generated/landingEntry.ts";
import { agentHref, type LandingLinks } from "../brand/landing.ts";
import { cn } from "../lib/cn.ts";
import { AgentTile } from "./AgentTile.tsx";

export type AgentRowProps = Omit<ComponentProps<"nav">, "children"> & {
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
 * The agents in their fixed order, each as a logo tile. A tile shows only where the generated `tileShown` allows it.
 * @model spec/landingEntry.md
 */
export function AgentRow({ links, mounted = false, device = "NotDetected", onChoose, className, "aria-label": label = "Open your agent", ...props }: AgentRowProps) {
  return (
    <nav aria-label={label} className={cn("flex flex-wrap gap-2", className)} {...props}>
      {agentOrder
        .filter((agent) => tileShown(agent, mounted, device))
        .map((agent) => (
          <AgentTile key={agent} agent={agent} href={agentHref(agent, links)} onChoose={onChoose} />
        ))}
    </nav>
  );
}
