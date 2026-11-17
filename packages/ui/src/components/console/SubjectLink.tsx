// spec/consoleNavigation.md, "Focus on a new subject keeps the last one in a short history"
import type { ComponentProps } from "react";
import type { Subject } from "../../../../core/src/generated/consoleNavigation.ts";
import { cn } from "../../lib/cn.ts";
import { Link } from "../Link.tsx";

const linkStyle = "inline hover:text-primary";

export type SubjectLinkProps = Omit<ComponentProps<"button">, "onClick" | "type"> & {
  /** The kind of subject that the link opens. */
  subject: Exclude<Subject, "Overview">;
  /** Moves the console focus to the subject: the generated `focusOn`. The click does not reach the row under the link. */
  onOpen: () => void;
};

/**
 * A name that opens its subject in the inspector. Without a name, in `children`, `aria-label` or `aria-labelledby`, nothing shows: a link that nobody can name cannot be found.
 * @model spec/consoleNavigation.md
 */
export function SubjectLink({ subject, onOpen, className, ...props }: SubjectLinkProps) {
  if ((props.children == null || props.children === "") && !props["aria-label"] && !props["aria-labelledby"]) return null;
  return (
    <Link asChild variant="quiet" className={cn(linkStyle, className)}>
      <button
        type="button"
        data-subject={subject}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        {...props}
      />
    </Link>
  );
}

export type MemberLinkProps = Omit<SubjectLinkProps, "subject">;

/** A member name that opens the member. */
export function MemberLink(props: MemberLinkProps) {
  return <SubjectLink subject="MemberSubject" {...props} />;
}

/** An opportunity name, such as "Maya + Jon", that opens the opportunity. */
export function OpportunityLink(props: MemberLinkProps) {
  return <SubjectLink subject="OpportunitySubject" {...props} />;
}

/** A neighborhood name that opens the neighborhood. */
export function AreaLink(props: MemberLinkProps) {
  return <SubjectLink subject="NeighborhoodSubject" {...props} />;
}

export type VenueLinkProps = Omit<ComponentProps<"button">, "onClick" | "type"> & {
  /** Shows the venue on the map: the generated `flyToVenue`. */
  onShow: () => void;
};

/** A venue name that shows the venue on the map. */
export function VenueLink({ onShow, title = "Show on the map", className, ...props }: VenueLinkProps) {
  return (
    <Link asChild variant="quiet" className={cn(linkStyle, className)}>
      <button
        type="button"
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          onShow();
        }}
        {...props}
      />
    </Link>
  );
}
