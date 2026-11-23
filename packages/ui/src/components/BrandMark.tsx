// spec/brandIdentity.md, "Every site uses the same parts, and only peon.biz adds the browser join flow"
import type { ComponentProps } from "react";
import type { LogoMark } from "../../../core/src/generated/brandIdentity.ts";
import { cn } from "../lib/cn.ts";

export type BrandMarkProps = Omit<ComponentProps<"svg">, "children"> & {
  /** The logo of the brand record. */
  logo: LogoMark;
};

function MarkPaths({ logo }: { logo: LogoMark }) {
  switch (logo) {
    case "GraphMark":
      return (
        <>
          <rect width="64" height="64" rx="15" className="fill-primary" />
          <path d="M12 44L24 22L38 34L52 14M38 34L46 52" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-foreground" />
          <g className="fill-primary-foreground">
            <circle cx="12" cy="44" r="5" />
            <circle cx="24" cy="22" r="6" />
            <circle cx="38" cy="34" r="7" />
            <circle cx="52" cy="14" r="5" />
            <circle cx="46" cy="52" r="5" />
          </g>
        </>
      );
    case "HeartMark":
      return (
        <>
          <rect width="64" height="64" rx="15" className="fill-primary" />
          <g className="fill-primary-foreground">
            <path d="M32 46C12 32 10 20 19 14c6-4 11 0 13 4 2-4 7-8 13-4 9 6 7 18-13 32Z" />
            <rect x="21" y="34" width="5" height="16" rx="2.5" />
            <rect x="38" y="34" width="5" height="12" rx="2.5" />
            <circle cx="23.5" cy="56" r="2.5" />
          </g>
        </>
      );
    case "NecktieMark":
      return (
        <>
          <rect width="64" height="64" rx="15" className="fill-primary" />
          <g className="fill-primary-foreground">
            <path d="M26 8h12l-3 9h-6Z" />
            <path d="M28.5 19h7l6 26-9.5 12L22.5 45Z" />
          </g>
        </>
      );
    case "TwoCirclesMark":
      return (
        <>
          <circle cx="24" cy="32" r="15" className="fill-primary" />
          <circle cx="40" cy="32" r="15" className="fill-current" />
          <path d="M32 19.3a15 15 0 0 1 0 25.4 15 15 0 0 1 0-25.4Z" className="fill-background" />
        </>
      );
  }
}

/** The logo of a brand, drawn only with the brand's tokens and the current text color. It is decorative unless it gets an `aria-label`. */
export function BrandMark({ logo, className, ...props }: BrandMarkProps) {
  const named = props["aria-label"] !== undefined;
  return (
    <svg viewBox="0 0 64 64" role={named ? "img" : undefined} aria-hidden={named ? undefined : true} className={cn("size-8 shrink-0 text-foreground", className)} {...props}>
      <MarkPaths logo={logo} />
    </svg>
  );
}
