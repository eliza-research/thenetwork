// spec/sitePages.md, "Every page links the privacy policy and the terms in its footer"
import type { ComponentProps } from "react";
import type { Brand } from "../../../core/src/generated/brandIdentity.ts";
import { cn } from "../lib/cn.ts";
import { SiteFooter } from "./SiteFooter.tsx";
import { SkipLink } from "./SkipLink.tsx";
import { Wordmark } from "./Wordmark.tsx";

export type PageShellProps = ComponentProps<"div"> & {
  /** The brand record of the site. */
  brand: Brand;
};

/**
 * The frame of a secondary site page: the skip link, the header mark that links to the landing page, the main content and the footer with the privacy policy and the terms.
 * @model spec/sitePages.md
 */
export function PageShell({ brand, className, children, ...props }: PageShellProps) {
  return (
    <div className={cn("mx-auto flex min-h-dvh w-full max-w-3xl flex-col bg-background px-4 text-foreground sm:px-6", className)} {...props}>
      <SkipLink>Skip to content</SkipLink>
      <header className="py-6">
        <Wordmark brand={brand} />
      </header>
      <main id="main" className="flex-1 pb-12">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
