// spec/landingEntry.md, "The Copy button shows only when the page script runs"
import type { ComponentProps, Ref } from "react";
import { type CopyState, copyLabel } from "../../../core/src/generated/landingEntry.ts";
import { cn } from "../lib/cn.ts";
import { Button } from "./Button.tsx";

export type PromptCopyProps = ComponentProps<"div"> & {
  /** The signup prompt. It stays selectable text when the Copy button is hidden. */
  prompt: string;
  /** The state of the Copy button; it gives the label. */
  copy: CopyState;
  /** The Copy button shows only when this is true: the generated `canPressCopy` of the landing state. */
  canCopy?: boolean;
  /** Called when the person presses Copy. */
  onCopy?: () => void;
  /** Receives the prompt text element, so that the page can select it when the clipboard refuses. */
  promptRef?: Ref<HTMLElement>;
};

/**
 * The signup prompt as selectable text, with a Copy button whose label comes from the copy state.
 * @model spec/landingEntry.md
 */
export function PromptCopy({ prompt, copy, canCopy = false, onCopy, promptRef, className, ...props }: PromptCopyProps) {
  return (
    <div className={cn("flex max-w-2xl flex-col items-stretch gap-2 rounded-xl border border-border p-2 pt-3.5 sm:min-h-16 sm:flex-row sm:items-center sm:gap-3 sm:py-2 sm:pl-5", className)} {...props}>
      <code ref={promptRef} className="min-w-0 flex-1 px-2 pb-1.5 font-mono text-sm break-all text-foreground select-all sm:p-0 sm:py-2">
        {prompt}
      </code>
      {canCopy && (
        <Button size="lg" className="h-11 min-w-20 shrink-0 rounded-lg text-base font-semibold" onClick={onCopy}>
          {copyLabel(copy)}
        </Button>
      )}
    </div>
  );
}
