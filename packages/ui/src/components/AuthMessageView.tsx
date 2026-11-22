// spec/authorizationPages.md, "A message page shows no credential field and at most a retry link"
import { type AuthView, chromeFor, offersFor } from "../../../core/src/generated/authorizationPages.ts";
import { type ConsentsView, chromeFor as consentsChromeFor, offersFor as consentsOffersFor } from "../../../core/src/generated/connectedAssistants.ts";
import type { AuthShellProps } from "./AuthShell.tsx";
import { AuthShell } from "./AuthShell.tsx";
import { Link } from "./Link.tsx";

/** A view that stops the connection: a message of connector authorization or of the connected assistants page. */
export type AuthMessage =
  | Extract<
      AuthView,
      | "LinkInvalidView"
      | "TooManyTriesView"
      | "NotAvailableView"
      | "PageExpiredView"
      | "AlreadySignedInView"
      | "CheckNumberView"
      | "ConnectAgainView"
      | "PleaseRetryView"
      | "SignInUnavailableView"
      | "NotAllowedView"
    >
  | Extract<ConsentsView, "SignInFirstView" | "RetryLaterView">;

const retryLine = "We can’t check your connection right now. Try again shortly, or return to your agent or text conversation.";

const copy: Record<AuthMessage, { title: string; line: string }> = {
  LinkInvalidView: { title: "This link does not work", line: "Go back to the assistant and connect again." },
  TooManyTriesView: { title: "Too many tries", line: "Please wait an hour and try again." },
  NotAvailableView: { title: "Not available", line: "This assistant connection is not available on this site." },
  PageExpiredView: { title: "This page has expired", line: "Go back to the assistant and connect again." },
  AlreadySignedInView: { title: "Already signed in", line: "Go back to the previous page to finish." },
  CheckNumberView: { title: "We need to check this number", line: "We need to check this number before it can be used here. Please try again later, or email us for help." },
  ConnectAgainView: { title: "Connect again", line: "Return to your agent or text conversation and connect again." },
  PleaseRetryView: { title: "Please try again", line: retryLine },
  SignInUnavailableView: { title: "Sign-in unavailable", line: "Go back to the assistant and try again later." },
  NotAllowedView: { title: "Not allowed", line: "This form must be sent from this site." },
  SignInFirstView: { title: "Sign in first", line: "Connect this app in your agent and confirm your phone during authorization, then open this page again." },
  RetryLaterView: { title: "Please try again", line: retryLine },
};

export type AuthMessageViewProps = Omit<AuthShellProps, "title" | "chrome" | "children"> & {
  /** The view that the server reply selected. */
  view: AuthMessage;
  /** The one sentence, when the reason needs other words than the view's own. */
  text?: string;
  /** The same-site path that "Try again" opens; shown only on a view that offers a retry. */
  retryHref?: string;
};

/**
 * A page that stops the connection: one heading, one sentence and, only on "Please try again", a "Try again" link.
 * @model spec/authorizationPages.md
 * @model spec/connectedAssistants.md
 */
export function AuthMessageView({ view, text, retryHref, ...props }: AuthMessageViewProps) {
  const consents = view === "SignInFirstView" || view === "RetryLaterView";
  const retryLink = consents ? consentsOffersFor(view).retryLink : offersFor(view).retryLink;
  const chrome = consents ? consentsChromeFor(view) : chromeFor(view);
  const href = retryHref?.startsWith("/") && !retryHref.startsWith("//") ? retryHref : undefined;
  return (
    <AuthShell title={copy[view].title} chrome={chrome} {...props}>
      <p>{text ?? copy[view].line}</p>
      {retryLink && href ? (
        <Link href={href} className="self-start">
          Try again
        </Link>
      ) : null}
    </AuthShell>
  );
}
