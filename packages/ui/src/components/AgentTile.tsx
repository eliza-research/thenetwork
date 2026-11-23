// spec/landingEntry.md, "The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link"
import type { HTMLAttributes } from "react";
import { type AgentId, agentName, tileKindFor, tileLabelLead } from "../../../core/src/generated/landingEntry.ts";
import { cn, focusRing } from "../lib/cn.ts";
import { AgentLogo } from "./AgentLogo.tsx";
import { Tooltip } from "./Tooltip.tsx";

export type AgentTileProps = Omit<HTMLAttributes<HTMLElement>, "children" | "onClick" | "aria-label"> & {
  /** The agent of the tile. Its tile kind decides between a link and a copy button. */
  agent: AgentId;
  /** The agent's link with the prompt filled in. A copy-only tile has none. */
  href?: string;
  /** Called when the person presses the tile. A link tile still follows its link. */
  onChoose?: (agent: AgentId) => void;
};

const tile = cn(
  focusRing,
  "grid size-12 shrink-0 place-items-center rounded-lg border border-border bg-transparent text-foreground transition duration-base ease-standard hover:-translate-y-0.5 hover:border-foreground hover:bg-inverse hover:text-inverse-foreground active:scale-95 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
);

/**
 * One agent as a logo only. The hover label is the agent's name; the accessible name says what the tile does ("Open in ChatGPT", "Copy the prompt for Muse").
 * @model spec/landingEntry.md
 */
export function AgentTile({ agent, href, onChoose, className, ...props }: AgentTileProps) {
  const name = agentName(agent);
  const logo = <AgentLogo agent={agent} aria-hidden className="size-5" />;
  const choose = () => onChoose?.(agent);
  const label = `${tileLabelLead(agent)}${name}`;
  return (
    <Tooltip content={name} side="bottom">
      {tileKindFor(agent) === "CopyOnly" || href === undefined ? (
        <button type="button" aria-label={label} className={cn(tile, className)} onClick={choose} {...props}>
          {logo}
        </button>
      ) : (
        <a href={href} target="_blank" rel="noopener" aria-label={label} className={cn(tile, className)} onClick={choose} {...props}>
          {logo}
        </a>
      )}
    </Tooltip>
  );
}
