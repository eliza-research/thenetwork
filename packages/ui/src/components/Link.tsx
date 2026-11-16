import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing } from "../lib/cn.ts";

const linkVariants = cva([focusRing, "rounded-sm font-medium underline-offset-4 transition-colors"], {
  variants: {
    variant: {
      inline: "text-primary underline hover:decoration-2",
      quiet: "text-foreground no-underline hover:underline",
    },
  },
  defaultVariants: { variant: "inline" },
});

export type LinkProps = ComponentProps<"a"> &
  VariantProps<typeof linkVariants> & {
    /** Gives the link's styles to the single child element, such as the link of a router. */
    asChild?: boolean;
  };

/** A way to another page or place. `inline` sits in running text; `quiet` sits in navigation. For a link that looks like a button, use `Button` with `asChild`. */
export function Link({ variant, asChild = false, className, ...props }: LinkProps) {
  const Comp = asChild ? Slot : "a";
  return <Comp className={cn(linkVariants({ variant }), className)} {...props} />;
}
