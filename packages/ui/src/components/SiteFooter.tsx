// spec/sitePages.md, "Every page links the privacy policy and the terms in its footer"
import type { ComponentProps } from "react";
import { footerLinks, type SitePage } from "../../../core/src/generated/sitePages.ts";
import { sitePageLinks } from "../brand/landing.ts";
import { cn } from "../lib/cn.ts";
import { Link } from "./Link.tsx";

export type SiteFooterProps = Omit<ComponentProps<"footer">, "children"> & {
  /** The pages the footer links, in order. */
  pages?: readonly SitePage[];
  /** The origin of the site whose pages the links open, such as `https://slop.date`, when another site renders the footer. Without it, the links stay relative. */
  origin?: string;
};

/**
 * The footer of every site page: the privacy policy and the terms.
 * Its rules come from `spec/sitePages.md`, a spec of decisions with no state of its own.
 */
export function SiteFooter({ pages = footerLinks, origin = "", className, ...props }: SiteFooterProps) {
  return (
    <footer className={cn("flex flex-wrap gap-x-5 gap-y-1.5 pt-5 pb-7 text-sm", className)} {...props}>
      {pages.map((page) => {
        const link = sitePageLinks[page];
        return link ? (
          <Link key={page} variant="quiet" href={`${origin}${link.href}`} className="font-normal text-muted-foreground hover:text-foreground">
            {link.label}
          </Link>
        ) : null;
      })}
    </footer>
  );
}
