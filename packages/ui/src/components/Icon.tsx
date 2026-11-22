import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

const glyphs = {
  chevronRight: "m6 4 4 4-4 4",
  chevronDown: "m4 6 4 4 4-4",
  close: "m4 4 8 8M12 4l-8 8",
  back: "M13 8H3m4-4L3 8l4 4",
} as const;

/** The name of a glyph that `Icon` draws. */
export type IconName = keyof typeof glyphs;

const iconVariants = cva("shrink-0", {
  variants: { size: { sm: "size-3", md: "size-4" } },
  defaultVariants: { size: "md" },
});

export type IconProps = Omit<ComponentProps<"svg">, "children"> &
  VariantProps<typeof iconVariants> & {
    /** The glyph to draw. */
    name: IconName;
    /** The accessible name. Without it the icon is decoration and assistive technology does not see it. */
    label?: string;
  };

/** One line glyph in the current text color, such as the chevron of a part that opens or the cross of a close button. */
export function Icon({ name, size, label, className, ...props }: IconProps) {
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(iconVariants({ size }), className)}
      {...props}
    >
      <path d={glyphs[name]} />
    </svg>
  );
}
