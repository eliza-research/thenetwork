// spec/sitePages.md, "An unknown path shows the not-found page and every served page exists"
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";
import { Link } from "./Link.tsx";

export type NotFoundViewProps = ComponentProps<"div"> & {
  /** The name of the site, for the link back to its landing page. */
  name: string;
  /** The landing page of the site. */
  href?: string;
};

/**
 * The content of the not-found page: the heading, one line and a link back to the landing page.
 * @model spec/sitePages.md
 */
export function NotFoundView({ name, href = "/", className, ...props }: NotFoundViewProps) {
  return (
    <div className={cn("flex max-w-2xl flex-col gap-4", className)} {...props}>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Not found</h1>
      <p className="text-muted-foreground">There is no page here.</p>
      <p>
        <Link href={href}>Back to {name}</Link>
      </p>
    </div>
  );
}
