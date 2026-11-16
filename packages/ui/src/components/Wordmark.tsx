// spec/brandIdentity.md, "Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline"
import type { ComponentProps, ReactNode } from "react";
import type { Brand } from "../../../core/src/generated/brandIdentity.ts";
import { cn, focusRing } from "../lib/cn.ts";
import { BrandMark } from "./BrandMark.tsx";

export type WordmarkProps = ComponentProps<"a"> & {
  /** The brand record of the site. The mark draws its logo and the text is its name. */
  brand: Brand;
  /** The text beside the logo, such as the domain on a connector page; the brand name when left out. */
  children?: ReactNode;
};

/**
 * The header mark of a site: the logo and the name, as a link to the landing page.
 * @model spec/brandIdentity.md
 */
export function Wordmark({ brand, href = "/", className, children = brand.name, ...props }: WordmarkProps) {
  return (
    <a href={href} className={cn(focusRing, "inline-flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-tight text-foreground no-underline", className)} {...props}>
      <BrandMark logo={brand.logo} />
      {children}
    </a>
  );
}
