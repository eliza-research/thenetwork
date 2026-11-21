// spec/authorizationPages.md, "Every page shows the brand mark and the legal links"
import type { ComponentProps } from "react";
import type { PageChrome } from "../../../core/src/generated/authorizationPages.ts";
import { type AppKey, brandFor } from "../../../core/src/generated/brandIdentity.ts";
import { brandIdFor } from "../brand/landing.ts";
import { cn } from "../lib/cn.ts";
import { SiteFooter } from "./SiteFooter.tsx";
import { Wordmark } from "./Wordmark.tsx";

export type AuthShellProps = Omit<ComponentProps<"div">, "title"> & {
  /** The app whose brand record gives the colors, the mark and the domain. */
  app: AppKey;
  /** The one heading of the page. */
  title: string;
  /** Which page parts show: the generated `chromeFor` of the view. */
  chrome?: PageChrome;
  /** Where the brand mark goes. Default: the home page of the app's site. */
  homeHref?: string;
  /**
   * The origin of the app's own site, such as `https://slop.date`, when another site (ntwrk.party) renders the page for the app.
   * The brand mark and the legal links then open the app's own pages. Without it, the links stay relative to the site that renders the page.
   */
  siteOrigin?: string;
};

/**
 * The frame of each connector page that the site renders: the brand mark that links home, one heading, the page and the Privacy and Terms links.
 * @model spec/authorizationPages.md
 */
export function AuthShell({ app, title, chrome = { brandMark: true, legalLinks: true }, homeHref, siteOrigin = "", className, children, ...props }: AuthShellProps) {
  const brand = brandFor(app);
  return (
    <div data-brand={brandIdFor[app]} className={cn("min-h-dvh bg-background font-sans text-foreground", className)} {...props}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-12 px-4 py-10">
        {chrome.brandMark ? (
          <Wordmark brand={brand} href={homeHref ?? `${siteOrigin}/`} className="self-start">
            {brand.domain}
          </Wordmark>
        ) : null}
        <main className="flex flex-col gap-6">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {children}
        </main>
        {chrome.legalLinks ? <SiteFooter className="p-0" origin={siteOrigin} /> : null}
      </div>
    </div>
  );
}
