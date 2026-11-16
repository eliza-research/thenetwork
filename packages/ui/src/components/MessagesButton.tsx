// spec/landingEntry.md, "The Messages entry writes `join <keyword>` to the shared line"
import type { ComponentProps } from "react";
import { messagesEntryLabel } from "../../../core/src/generated/landingEntry.ts";
import { cn } from "../lib/cn.ts";
import { Button } from "./Button.tsx";

export type MessagesButtonProps = Omit<ComponentProps<"a">, "children"> & {
  /** The `sms:` link to the shared line with the join message as its body. */
  href: string;
};

/**
 * The Messages entry: a link that starts a text with the join message to the shared line.
 * @model spec/landingEntry.md
 */
export function MessagesButton({ href, className, ...props }: MessagesButtonProps) {
  return (
    <Button asChild size="lg" className={cn("h-12 gap-2.5 rounded-lg bg-foreground px-6 text-base font-semibold text-background hover:bg-foreground/90", className)}>
      <a href={href} {...props}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-6 shrink-0">
          <path d="M5.285 0A5.273 5.273 0 0 0 0 5.285v13.43A5.273 5.273 0 0 0 5.285 24h13.43A5.273 5.273 0 0 0 24 18.715V5.285A5.273 5.273 0 0 0 18.715 0ZM12 4.154a8.809 7.337 0 0 1 8.809 7.338A8.809 7.337 0 0 1 12 18.828a8.809 7.337 0 0 1-2.492-.303A8.656 7.337 0 0 1 5.93 19.93a9.929 7.337 0 0 0 1.54-2.155 8.809 7.337 0 0 1-4.279-6.283A8.809 7.337 0 0 1 12 4.154" />
        </svg>
        <span>{messagesEntryLabel}</span>
      </a>
    </Button>
  );
}
