// spec/consoleWorkspace.md, "The propose tray sends a proposal for two to six adults with a spark left"
// spec/consoleNavigation.md, "Picks exist only for a viewer who plays the simulated world"
import type { ComponentProps, ReactNode } from "react";
import { maxPicks } from "../../../../core/src/generated/consoleNavigation.ts";
import type { TrayPhase } from "../../../../core/src/generated/consoleWorkspace.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Icon } from "../Icon.tsx";
import { Input } from "../Input.tsx";
import { Select, SelectItem } from "../Select.tsx";
import { StatusMark } from "./StatusMark.tsx";

/** One picked member. */
export type TrayPick = { id: string; name: string; minor?: boolean; busy?: boolean };

export type ProposeTrayProps = Omit<ComponentProps<"div">, "children"> & {
  /** The phase of the tray; `TraySending` shows Propose busy. Render the tray only where the generated `trayShown(staff, pickCount)` is true. */
  phase: TrayPhase;
  /** The picks, oldest first. */
  picks: TrayPick[];
  /** The generated `proposalFormShown(pickCount)`: the category, the plan, the reason and Propose show. */
  formShown: boolean;
  /** The generated `groupProposal(pickCount)`: the proposal is a group, not an intro. */
  group: boolean;
  /** The generated `canSubmitProposal(w, pickCount, minorPicked, sparksLeft, gameOver)`. */
  canPropose: boolean;
  /** True when a picked member is under 18; Propose then says why it is off. */
  minorPicked: boolean;
  sparksLeft: number;
  /** The categories of a proposal. */
  categories: string[];
  category: string;
  onCategoryChange: (category: string) => void;
  /** The plan of a group, or who an intro is for. */
  objective: string;
  onObjectiveChange: (objective: string) => void;
  /** Why, as the members will read it. */
  why: string;
  onWhyChange: (why: string) => void;
  /** Sends the proposal: the generated `submitProposal`. */
  onPropose: () => void;
  /** Asks the oracle, at a cost of 25 points. */
  onPeek: () => void;
  /** Removes every pick. */
  onClear: () => void;
  /** Removes one pick: the generated `togglePick`. */
  onRemove: (id: string) => void;
  /** The oracle answer, as an `Alert`. */
  peek?: ReactNode;
};

/**
 * The tray of the simulated world: the picked members and the proposal for them.
 * @model spec/consoleWorkspace.md
 */
export function ProposeTray({
  phase,
  picks,
  formShown,
  group,
  canPropose,
  minorPicked,
  sparksLeft,
  categories,
  category,
  onCategoryChange,
  objective,
  onObjectiveChange,
  why,
  onWhyChange,
  onPropose,
  onPeek,
  onClear,
  onRemove,
  peek,
  className,
  ...props
}: ProposeTrayProps) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg", className)} {...props}>
      <ul aria-label="Picked members" className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {picks.map((pick) => (
          <li key={pick.id} className="flex items-center gap-1">
            {pick.name}
            {pick.minor ? <StatusMark tone="destructive" label="under 18" /> : pick.busy ? <StatusMark tone="warn" label="busy" /> : null}
            <Button variant="ghost" size="icon" aria-label={`Remove ${pick.name}`} onClick={() => onRemove(pick.id)} className="size-5 rounded-sm text-muted-foreground">
              <Icon name="close" size="sm" />
            </Button>
          </li>
        ))}
        {formShown ? null : <li className="text-muted-foreground">Shift-click 1-{maxPicks - 1} more</li>}
      </ul>
      {formShown ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-36" aria-label="Category" value={category} onValueChange={onCategoryChange}>
            {categories.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </Select>
          <Input className="min-w-32 flex-1" aria-label={group ? "Plan" : "Intro for"} placeholder={group ? "Plan" : "Intro for"} value={objective} onChange={(event) => onObjectiveChange(event.target.value)} />
          <Input className="min-w-32 flex-1" aria-label="Why (shown to them)" placeholder="Why (shown to them)" value={why} onChange={(event) => onWhyChange(event.target.value)} />
          <Button disabled={!canPropose} loading={phase === "TraySending"} title={minorPicked ? "Members under 18 are never introduced" : undefined} onClick={onPropose}>
            Propose {group ? "group" : "intro"} · {sparksLeft} sparks
          </Button>
          <Button variant="outline" title="Ask the oracle (−25 points)" onClick={onPeek}>
            Peek −25
          </Button>
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>
      ) : null}
      {peek}
    </div>
  );
}
